# Architecture

How Viand is put together, and why. For what it does and how to run it, see the
[README](README.md).

---

## The one structural rule

**`src/domain/` is pure. `src/lib/` touches the world.**

```
src/domain/    2,719 LOC   no I/O, no env, no clock, no randomness, no model
src/lib/       2,113 LOC   messaging, restaurants, storage, inference, config
src/app/         608 LOC   routes and the landing page
tests/         4,009 LOC
scripts/eval/  1,411 LOC   the strategy evaluation harness
```

Everything else follows from that line. The domain decides *what should
happen*; the adapter layer decides *how it happens* and is the only place
allowed to fail in interesting ways.

This is enforced, not merely intended.
`tests/unit/recommendation-purity.test.ts` walks the import graph from
`domain/recommendations/select.ts` and asserts the reachable set touches
nothing outside `src/domain`, imports no inference package, and reads no
environment variable, clock, or source of randomness. The only bare specifier
the pure domain may depend on is `zod`.

The point is not tidiness. It is that **ranking quality is reproducible and
reviewable without standing up a service.** A recommendation is a pure function
of `(candidates, preferences)`, so it can be tested exhaustively, diffed across
changes, and graded by the eval harness — none of which is possible if the
answer depends on what a network returned that afternoon.

---

## Why a state machine, not an LLM agent

This is the decision most worth explaining, because the obvious 2026 build of
this product is an agent with tools, and that build is worse.

A group deciding where to eat is not an open-ended task. It is a short,
well-understood protocol: establish where, collect what people want, propose
options, take votes, honour vetoes, declare a winner. Six states:

```
COLLECTING_LOCATION → COLLECTING_PREFERENCES → READY_TO_RECOMMEND
                            → VOTING → COMPLETED
                                     ↘ CANCELLED
```

`transition()` in `src/domain/state-machine/reducer.ts` is **pure and total**:
every one of the thirteen `Command` variants is handled in every one of those
states. An out-of-context command produces a helpful reply, never a crash and
never a silent no-op. It is a function from `(snapshot, event)` to
`{ snapshot, replies, effects }` — it performs no I/O itself, and the caller is
responsible for persisting the snapshot and running the effects.

Effects are a closed two-variant union — `RUN_RECOMMENDATION` and
`ANNOUNCE_WINNER` — precisely because the machine must not be able to invent an
action nobody reviewed.

What this buys, in order of how much it matters:

**A vote cannot be misread.** `VOTE 2`, `VETO 3`, `DONE`, `CANCEL`, and the
`STOP`/`START` compliance keywords are matched by a deterministic parser and
never reach a model. In an agent build, every one of those meanings is a
probability. Here, "2" means option two — on a bad day, during an outage, on the
thousandth message, forever. For a product whose entire claim is *fairness*,
inference in the vote path would be disqualifying.

**Legal keywords cannot be probabilistic.** `STOP` is a compliance obligation,
not a preference. It must work when the model API is down.

**The behaviour is inspectable.** A reducer with total case coverage can be read
and argued about. "The agent usually asks for a location first" cannot.

**It is cheap and fast.** The common path makes no model call at all.

The model is not absent — it is *confined*. See "Where inference is allowed".

---

## The layers

### `src/domain/` — the pure core

| Module | Responsibility |
| --- | --- |
| `state-machine/reducer.ts` | The single entry point for advancing a session |
| `state-machine/session.ts` | `SessionSnapshot`, `InboundEvent`, `Effect`, `OutboundIntent` |
| `recommendations/constraints.ts` | Splits a preference into hard and soft halves |
| `recommendations/scoring.ts` | Weighted group fit over the soft half |
| `recommendations/select.ts` | Eliminate, then rank, then diversify |
| `preferences/rules-parser.ts` | Sentence → `MemberPreference`, deterministically |
| `interpret/deterministic.ts` | Text → `Command`, rules only |
| `voting/tally.ts` | Ballots → outcome |
| `messages/copy.ts` | Every user-facing string in the product |
| `restaurants/provider.ts` | The `Restaurant` shape and provider interface |

`SessionSnapshot` is deliberately a plain data object. The same reducer runs
identically over a literal in a test and over a JSON blob rehydrated from Redis,
which is why persistence could be added later without touching decision logic.

### `src/lib/` — adapters

| Module | Responsibility |
| --- | --- |
| `messaging/` | mock, Linq (iMessage), Telegram, behind one provider interface |
| `restaurants/` | OSM provider, plus caching, failover, and geocoding wrappers |
| `store/` | `SessionStore` interface; in-memory and Redis implementations |
| `interpret/claude-interpreter.ts` | The optional inference layer |
| `conversation/service.ts` | Wires a verified inbound message through the reducer |
| `env.ts`, `runtime.ts` | Configuration, and provider selection |

Adapters are chosen by environment variable, never by a conditional in the core.
`MESSAGING_PROVIDER` is the template: adding a transport means adding an
implementation, not editing the decision path.

---

## Two invariants worth the space

### Hard constraints never reach a scoring function

A scoring function's job is to trade things off. A dietary requirement is not a
thing to trade off. Handing one to a scorer is a category error that ends with
somebody served food they cannot eat.

So `constraints.ts` projects a `MemberPreference` into `HardConstraints` and
`SoftPreferences`, which **share no field names and carry disjoint `kind`
discriminants**. Neither is structurally assignable to the other, and the
unsplit record is assignable to neither. Three mistakes are therefore compile
errors rather than review comments:

```ts
scoreRestaurant(r, hardConstraintsOf(p))   // constraints into a scorer
hardRestrictions(r, softPreferencesOf(p))  // preferences used as a filter
scoreRestaurant(r, p)                      // the unsplit record
```

The third matters most: you cannot reach a scorer without first saying out loud
which half you meant. Pinned by `tests/unit/constraint-split.test.ts`.

Hard constraints are **eliminated before ranking, never penalised.** A member
whose constraint is broken scores 0 — not a deduction that a high rating could
outweigh.

### The weakest member is weighted highest

```ts
SCORE_WEIGHTS = {
  weakestMember: 0.35,   // ← the product thesis, as a number
  averageMember: 0.25,
  cuisineMatch:  0.15,
  distance:      0.10,
  rating:        0.10,
  priceMatch:    0.05,
}
```

An option that delights three people and fails a fourth loses to one everybody
can live with. That is the whole product, and it is measured rather than
asserted — `npm run eval` grades it against alternatives on a seeded synthetic
corpus using latent utility vectors no strategy is allowed to see, so the scorer
is never graded on its own objective.

---

## Where inference is allowed

Exactly one place: `src/lib/interpret/claude-interpreter.ts`, turning a sentence
into a `Command` or a `MemberPreference`. It is **strictly additive** and cannot
make the bot worse:

- Anything the deterministic parser recognises never reaches it.
- Every call is bounded by an input-length cap and a timeout, retries off.
- Anything slow, malformed, or low-confidence falls back to the rules parser.
- It performs no side effects: it reads a message and returns a value.
- `InboundEvent.preference` is optional, so the reducer parses the raw text
  itself when nothing was extracted — the machine is correct with no
  interpreter at all.

The recommender contains no model and no weight to zero. That is why the purity
test asserts unreachability rather than pinning a weight-zero equivalence: there
is nothing to zero, and a test that zeroed a weight would be testing nothing.

---

## Failure is a design surface

Error handling degrades rather than throws. Every external call has a bounded
deadline and a defined thing that happens when it is missed:

| Failure | Behaviour |
| --- | --- |
| Overpass endpoint hangs | Endpoints share one deadline; first valid response wins |
| Full-radius query fails | Serve the closer results **and say the radius was not reached** |
| Upstream down, cache warm | Serve stale, and say so |
| Interpreter slow or unsure | Fall back to the rules parser |
| Redis unavailable | Propagate — see below |

Two rules govern what the group is told. **Never claim demo results are live or
exhaustive**: the group is always told which source answered, and a narrower
search is never presented as a complete one. And **never expose transport
credentials to the browser** — the simulator at `/` always uses the mock
runtime, because an unauthenticated page must never spend a real account, OSM
quota, or model capacity.

Redis is the one deliberate exception to graceful degradation. It propagates
rather than falling back to a local map: on a serverless host, two invocations
for one chat can land on different instances, and contradictory partial state is
worse than a reply delayed until Redis recovers.

Webhooks are verified on the **raw body, before parsing** — Linq through
`client.webhooks.unwrap()`, Telegram by constant-time comparison of
`X-Telegram-Bot-Api-Secret-Token`. Deduplication uses an atomic `SET NX EX`,
since that is the idempotency gate for at-least-once delivery.

---

## What this design costs

Honest trade-offs, not a features list.

- **Novel phrasings need code.** An agent generalises to wording nobody
  anticipated; a rules parser needs a new rule. The interpreter narrows this gap
  but does not close it, and by design cannot touch votes.
- **The flow is fixed.** Six states handle group restaurant decisions. They do
  not handle "actually, let's do drinks first" without new states.
- **`copy.ts` is the personality ceiling.** Every string is written by a human,
  so the bot cannot improvise — deliberate, but it is a ceiling.
- **The eval corpus is synthetic.** It measures whether the objective is
  optimised well, not whether the objective matches what real groups want. Only
  live use answers that.
