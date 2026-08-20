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

The model row is the interesting one. Asked in prose to pick for a group, it
broke a hard dietary constraint in **seven of fifteen groups** and scored worse
on fairness than naive averaging — not because it is weak, but because "choose
the best restaurant for these people" gives it no reason to treat a dietary
requirement as different in kind from wanting Thai. Structure does the work, so
a model is spent on interpretation and never on the decision.

Two rules follow. A dietary requirement is a **constraint**, never a weighted
preference; the type system makes conflating them a compile error. And the
recommendation path is pure — no network, clock, randomness or model, enforced
by a test.

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

`MESSAGING_PROVIDER` sets the default, but each route serves its own transport
whenever configured, so one deployment answers several at once. A route with no
way to reply refuses rather than answering over a different platform.

| Value | Transport | Cost |
| --- | --- | --- |
| `mock` | In-memory, records sends | free |
| `telegram` | Telegram Bot API | free |
| `slack` | Slack Events API | free |
| `discord` | Discord slash commands | free |
| `linq` | iMessage via Linq | per Linq's plan |

Every platform fails the same way when misconfigured: silently. So each has a
doctor command naming the offending setting, plus one that checks them all
against the live deployment:

```sh
APP_BASE_URL=https://your-app.vercel.app npm run transports:verify
```

It checks credentials, registration, and that each webhook accepts a genuine
request while rejecting a forged or replayed one. Run it after any rotation.

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

Every route verifies the raw body before parsing, in constant time. Deliveries
older than five minutes are rejected: a signature never expires on its own, so
without a freshness window a captured request replays forever.

## Live restaurants

With `USE_MOCK_RESTAURANTS=false`, results come from **OpenStreetMap** —
Nominatim for geocoding, Overpass for listings. The group is always told which
source answered.

**Dietary.** OSM's `diet:*` tags let halal, kosher, gluten-free, vegetarian and
vegan requests be checked rather than inferred from cuisine. Only `yes` and
`only` count — `limited` must not satisfy a hard restriction. Most listings carry
no tags at all, and absence is missing data, not refusal: confirmed matches are
always preferred and never mixed with unconfirmed ones. Only when a dietary need
would otherwise leave the group with nothing does Viand offer listings it could
not check, and it says so.

**Hours.** `opening_hours` is parsed against a subset of the OSM grammar, read in
the restaurant's own time zone. Confirmed-closed is eliminated before ranking;
anything unparseable is reported *unverified* rather than guessed at.

**Radius.** Searches answer at the radius asked for. What scales is how many
kinds of place are requested at once — each amenity is a separate spatial pass,
and over central Boston at five miles one pass took under three seconds, two
took thirty-eight, three or more failed. So wide searches ask only for
restaurants; close-in ones also pick up cafes, fast food and pubs. If the full
radius is unreachable, a close-in search runs and the group is told.

**Duplicates.** One restaurant is often entered twice under slightly different
names. Entries within sixty metres with near-identical names are collapsed, so
one business cannot take two of five slots.

Nominatim and public Overpass endpoints are volunteer-run and rate limited. Set
an identifying `OSM_USER_AGENT`; use paid or self-hosted endpoints for sustained
traffic.

### Caching

Searches are cached and served stale if the source later fails. With
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` the cache is shared
across instances — essential on serverless, where consecutive messages from one
group land on different processes and a local cache misses almost every time. A
cache outage costs a slow search, never an error.

Before a demo or a busy period:

```sh
npm run demo:verify -- "Boston" "Los Angeles"
```

This runs a real decision per location — location, three people wanting
different things, a shortlist, votes, a winner — and exits non-zero if any step
comes back empty. Warming alone only proves a search returned rows. Freshness is
hourly, so run it within the hour you need it; older entries still serve as the
outage fallback. `npm run cache:warm` fetches without the decision.

## Optional: what a model does here

With `USE_AI_INTERPRETER=true` and an `OPENROUTER_API_KEY` or
`ANTHROPIC_API_KEY`, two things switch on. Both are strictly additive: anything
the deterministic parser recognises — a vote, `VETO`, `DONE`, `CANCEL`, and the
`STOP`/`START` compliance keywords — never reaches a model, so those meanings
never depend on inference or on an API being up.

**Interpretation.** Free text is also read behind a strict JSON schema, catching
phrasings the rules parser misses ("the taco place works for me" → vote 2).
Bounded by an input-length cap and a timeout, retries off; anything slow,
malformed or low-confidence falls back to the rules.

**Cuisine mediation.** When two members want cuisines the scorer cannot bridge,
it does not compromise — it alternates, because every option scores the same for
whoever it fails. A split group is instead asked:

> You're split between korean and italian.
> Would japanese work for everyone?
> Reply YES if that suits you, or NO to just see both.

A proposal carries on **half the members or more**, resolving as soon as enough
answer. The model proposes a cuisine and nothing else — it never sees a hard
constraint, never picks a restaurant, and the same scorer then does what it
always did. What each member said is left untouched.

Spend is capped per chat and per day via atomic counters in the shared store, so
the bound holds across instances. Exhausting a cap degrades to the deterministic
parser with a logged reason, exactly as a timeout does.

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
stated preference is a lossy projection of it. Satisfaction is graded against
that vector, so the scorer is never measured with its own objective.

A call that never reached the provider — quota, 5xx, timeout — is counted apart
from one the model answered badly, and any of the former marks the run **not
publishable**. Otherwise a rate-limited run looks exactly like a model declining
to answer, quietly overstating the shipped scorer.

Strategy (b) needs `OPENROUTER_API_KEY`, `GEMINI_API_KEY` or
`ANTHROPIC_API_KEY`; without one it is skipped and the report says so. The model
is named in its row, since a fairness number is not comparable across models.
The corpus is a pure function of `--seed`, pinned by a digest in
`tests/unit/eval-harness.test.ts`.

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
