# Viand

[![CI](https://github.com/wymwill/Viand/actions/workflows/ci.yml/badge.svg)](https://github.com/wymwill/Viand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A bot that lives in a group chat and gets everyone to one restaurant. Members
talk normally — "Mexican under $25", "I'm vegetarian", "the taco place works" —
and a deterministic state machine drives the group to a single decision.

The interesting problem is not finding good restaurants. It is that a group's
best option is rarely anyone's favourite. Viand optimises for the **least
satisfied member**, not the average.

That is measured, not asserted. `npm run eval` grades the shipped scorer against
alternatives on a seeded synthetic corpus, using latent preference vectors no
strategy is allowed to see:

| Strategy | Min satisfaction (fairness) | Mean satisfaction | Hard-constraint violations |
| --- | --- | --- | --- |
| Naive averaging of stated preferences | 0.276 | 0.541 | 9 |
| One unstructured prompt to Claude Haiku 4.5 | 0.206 | 0.473 | 8 |
| **The shipped deterministic scorer** | **0.450** | **0.624** | **0** |

<sub>15 groups, seed `20260815`, every strategy answering all fifteen.
Reproduce with `npm run eval -- --seed=20260815 --groups=15`.</sub>

The model row is the interesting one. Asked in prose to pick one restaurant for
a group, it broke a hard dietary constraint in **seven of fifteen groups**, and
scored worse on fairness than naive averaging. Not because it is weak, but
because "choose the best restaurant for these people" gives it no reason to
treat a dietary requirement as different in kind from a preference for Thai.
Structure does the work, which is why a model is spent on interpretation here
and never on the decision.

Two rules fall out of that. A dietary requirement is a **constraint**, never a
weighted preference — the type system makes conflating the two a compile error.
And the recommendation path is pure: no network, clock, randomness, or model,
enforced by a test.

Next.js 16, React 19, TypeScript strict, Vitest. Runs over Telegram, Discord,
Slack, or iMessage via Linq.

[**ARCHITECTURE.md**](ARCHITECTURE.md) covers the domain/adapter split, the
invariants as they appear in the type system, and why this is a state machine
rather than an LLM agent.

## Run locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000` for the simulator. Mock messaging and a local
restaurant catalogue are the defaults, so no account or database is required.

Viand stays silent in idle chats until intentionally invoked — a mention, a
slash command, or "pick a place". `HELP` and `CANCEL` always answer without
creating a session. Once a session is running, votes, vetoes, preferences and
`DONE` all work without repeating the mention.

## Transports

`MESSAGING_PROVIDER` selects the default, but each webhook route serves its own
transport whenever that transport is configured, so one deployment can answer
several at once. A route with no way to reply refuses rather than answering over
a different platform.

| Value | Transport | Cost |
| --- | --- | --- |
| `mock` | In-memory, records sends | free |
| `telegram` | Telegram Bot API | free |
| `slack` | Slack Events API | free |
| `discord` | Discord slash commands | free |
| `linq` | iMessage via Linq | per Linq's plan |

Each platform fails the same way when misconfigured — silently — so there is a
command per platform that names the specific setting that is wrong, and one that
checks them all against the live deployment:

```sh
APP_BASE_URL=https://your-app.vercel.app npm run transports:verify
```

It checks credentials, registration, and that each webhook accepts a genuine
request and rejects a forged or replayed one. Run it after rotating anything.

**Telegram** — create the bot with [@BotFather](https://t.me/BotFather), set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`, then
`npm run telegram:register-webhook` and `npm run telegram:register-commands`.
**Disable privacy mode** (`/setprivacy`) or the bot receives nothing in groups
but direct mentions.

**Slack** — create the app from
[`scripts/slack-app-manifest.yaml`](scripts/slack-app-manifest.yaml), set
`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` and `SLACK_BOT_USER_ID`, then
`npm run slack:doctor`. **Invite the bot to a channel** — Slack sends an app
nothing from channels it is not in.

**Discord** — set `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` and
`DISCORD_APPLICATION_ID`, point the Interactions Endpoint URL at
`/api/webhooks/discord`, then `npm run discord:register-command` and
`npm run discord:doctor`. Slash commands only: reading free text needs a
privileged intent over a Gateway socket, which a serverless function cannot
hold.

**Linq** — set `LINQ_API_KEY` and `LINQ_PHONE_NUMBER`, then
`npm run linq:register-webhook` and copy the printed secret into `.env.local`.

Every inbound route verifies the raw body before parsing, in constant time.
Slack and Linq deliveries older than five minutes are rejected: a signature does
not expire on its own, so without a freshness window a captured request could be
replayed indefinitely.

## Live restaurants

With `USE_MOCK_RESTAURANTS=false`, results come from **OpenStreetMap** —
Nominatim for geocoding, Overpass for listings. The group is always told which
source answered.

OSM carries `diet:*` tags, so halal, kosher, gluten-free, vegetarian and vegan
requests can be checked rather than inferred from cuisine. Only `yes` and `only`
count; `limited` is rejected, because a hard restriction must not be satisfied
by "a couple of things on the menu". Most listings carry no dietary tags at all,
and an absent tag is missing data rather than a refusal — so confirmed matches
are always preferred and never mixed with unconfirmed ones. Only when a dietary
need would otherwise leave the group with nothing does Viand fall back to
listings it could not check, and it says so.

`opening_hours` is parsed against a subset of the OSM grammar and read in the
restaurant's own time zone. A restaurant confirmed closed is eliminated before
ranking; anything the subset cannot parse is reported *unverified* rather than
guessed at.

A search is answered at the radius the group asked for. What scales with radius
is how many kinds of eating place are asked for at once: each amenity is an
independent spatial pass, and measured over central Boston at five miles, one
pass answered in under three seconds, two took thirty-eight, and three or more
failed. So a wide search asks only for restaurants; close-in searches also pick
up cafes, fast food and pubs. If the full radius cannot be reached, a close-in
search runs and the group is told — a narrower search is never presented as a
complete one.

The same restaurant is regularly entered twice in OSM under slightly different
names. Entries within sixty metres with near-identical names are collapsed, so
one business cannot occupy two slots on a shortlist of five.

Nominatim and the public Overpass endpoints are volunteer-run and rate limited.
Set an identifying `OSM_USER_AGENT`, and configure paid or self-hosted endpoints
for sustained traffic.

### Caching

Searches are cached and served stale if the source later fails. With
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` the cache is shared
across instances, which is what makes it useful on serverless — consecutive
messages from one group land on different processes, so a process-local cache
misses almost every time. A cache outage costs a slow search, never an error.

Before a demo or a busy period:

```sh
npm run demo:verify -- "Boston" "Los Angeles"
```

This runs a real group decision per location over real listings — location,
three people wanting different things, a shortlist, votes, a winner — and exits
non-zero if any step comes back empty. Warming alone only shows a search
returned rows. Freshness is bucketed by the hour, so run it within the hour you
intend to use it; an older entry still survives as the stale-on-failure
fallback. `npm run cache:warm` fetches without the decision.

## Optional: what a model does here

With `USE_AI_INTERPRETER=true` and an `OPENROUTER_API_KEY` or
`ANTHROPIC_API_KEY`, two things switch on. Both are strictly additive: anything
the deterministic parser recognises — a vote, `VETO`, `DONE`, `CANCEL`, and the
`STOP`/`START` compliance keywords — never reaches a model, so those meanings
never depend on inference or on an API being up.

**Interpretation.** Free-text messages are also read behind a strict JSON
schema, catching phrasings the rules parser misses ("the taco place works for
me" → vote 2). Bounded by an input-length cap and a timeout, with retries off:
anything slow, malformed, or low-confidence falls back to the rules.

**Cuisine mediation.** When two members want cuisines the scorer cannot bridge,
it does not compromise — it alternates, because every option scores the same for
whoever it fails. A split group is instead asked:

> You're split between korean and italian.
> Would japanese work for everyone?
> Reply YES if that suits you, or NO to just see both.

A proposal carries when **half the members or more** approve, and resolves as
soon as enough people answer. The model proposes a cuisine and nothing else: it
never sees a hard constraint, never picks a restaurant, and the same
deterministic scorer then does what it always did. What each member actually
said is left untouched.

Spend is capped per chat and per day through the shared store, with atomic
counters so the bound holds across instances. Exhausting a cap degrades to the
deterministic parser with a logged reason, exactly as a timeout does.

## What one person can do to a group

A group chat is already a trust boundary, so mostly the group polices itself.
Where that is not enough:

- **Anyone may `CANCEL`**, including a decision they did not start. The failure
  mode of the open rule is someone being annoying; of the closed rule, a stuck
  bot nobody can turn off.
- **Vetoing everything does not deadlock.** If every option is vetoed the
  least-vetoed one wins rather than the decision collapsing.

## Evaluating the recommender

```sh
npm run eval
```

Builds a seeded synthetic corpus — 50 groups of 2–6 people over a 60-restaurant
catalogue — and runs three strategies against the same candidates: naive
averaging, one unstructured model prompt, and the shipped scorer.

Each synthetic member has a **latent utility vector** no strategy sees; their
stated preference is a lossy projection of it. Satisfaction is graded against the
latent vector, so the scorer is not measured with its own objective.

A call that never reaches the provider — quota, a 5xx, a timeout — is counted
separately from one the model answered badly, and any of the former marks the run
**not publishable**. Without that, a rate-limited run looks exactly like a model
declining to answer, which would quietly overstate the shipped scorer.

Strategy (b) needs `OPENROUTER_API_KEY`, `GEMINI_API_KEY` or
`ANTHROPIC_API_KEY`; without one it is skipped and the report says so. The model
that answered is named in its row, because a fairness number is not comparable
across models. Everything else is deterministic — the corpus is a pure function
of `--seed`, pinned by a digest in `tests/unit/eval-harness.test.ts`.

**What it does not show.** The corpus is synthetic: it measures whether the
objective is optimised well, not whether the objective matches what real groups
want. Only live use answers that.

## Scope

- Sessions and webhook deduplication are in memory unless Upstash is configured,
  which switches both to Redis. Serverless needs this: functions do not share
  memory, so an in-memory session would evaporate mid-conversation.
- The simulator at `/` always uses mock messaging, mock restaurants and the
  deterministic parser on isolated state — an unauthenticated page never spends
  a real account, OSM quota, or model capacity.
- Supabase, Prisma, user accounts and auth are intentionally excluded.

## Verify

```sh
npm run typecheck
npm test
npm run build
```
