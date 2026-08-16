# Roadmap

Where Viand is and what comes next. Ordered by impact, not by effort.

## Shipped

- Receive and verify signed `message.received` webhooks from Linq.
- Configurable messaging transport — mock, Linq (iMessage), or Telegram — behind
  one provider interface, with no cross-transport reply leakage.
- Deterministic state machine covering location, preferences, recommendations,
  voting, vetoes, and opt-out. `transition()` is pure and total: every command is
  handled in every state.
- Live restaurant data from OpenStreetMap (Nominatim + Overpass), with caching,
  multi-endpoint failover, and a stale-on-error path.
- Optional AI interpretation (Claude Haiku) for free-text phrasings, strictly
  additive — it never handles a command the rules parser already recognises.
- Browser simulator at `/` running the full conversation flow on mock everything.
- **Split constraint model.** `src/domain/recommendations/constraints.ts` splits a
  `MemberPreference` into `HardConstraints` and `SoftPreferences`. They share no
  field names and carry disjoint discriminants, so passing one where the other is
  expected is a compile error, not a runtime surprise — asserted in
  `tests/unit/constraint-split.test.ts`. A dietary requirement weighed against a
  star rating has stopped being a requirement; this is the bug the design prevents.
- **Evaluation harness.** `npm run eval` scores three recommendation strategies
  over a seeded synthetic corpus. See "Evaluating the recommender" in the README.
- **Purity boundary.** `tests/unit/recommendation-purity.test.ts` pins the
  recommendation path as a pure function of `(candidates, preferences)`: it reaches
  nothing outside `src/domain`, depends on no inference package, and reads no
  environment variable, clock, or randomness. Ranking quality is reproducible and
  reviewable without standing up a service.

## Next

- **Durable session storage.** State and webhook deduplication live in process
  memory and reset on restart. `SessionStore` is already fully async, so a
  Redis/Upstash implementation drops in behind the existing seam with no call-site
  changes. This is a hard blocker for a serverless deploy — functions do not share
  memory between invocations, so a group's session would evaporate mid-conversation.
  `InMemorySessionStore` stays for tests and the simulator; the suite must remain
  runnable with no external services.
- **Deploy a live bot.** A Telegram bot someone can add to a real group chat is
  worth more than everything else on this list combined. Free, no per-message cost.
- **CI.** Typecheck and test on every push.
- **Close the eval gap.** Strategy (b) — the unstructured model prompt — is skipped
  without an `ANTHROPIC_API_KEY`, so the headline comparison currently runs only
  against a naive baseline. Fund a run and publish the full table.

## Later

- Structured logging in place of the remaining bare `console.warn` calls.
- Parse OSM `opening_hours` so closed restaurants stop being recommended.
- Ratings and prices from a source that actually has them; OSM does not.

## Guardrails

Constraints on any change, not features.

- Never expose Linq or Telegram credentials to the browser.
- Always verify the raw webhook body before parsing or processing it.
- Hard constraints are eliminated before ranking, never weighed against a score.
- Never claim demo restaurant results are live or exhaustive — the group is always
  told which source answered.
- The simulator at `/` always uses the mock runtime. An unauthenticated page must
  never spend Linq, OSM, or model capacity.
