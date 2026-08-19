# Viand

[![CI](https://github.com/wymwill/Viand/actions/workflows/ci.yml/badge.svg)](https://github.com/wymwill/Viand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A bot that lives in a group chat and gets everyone to one restaurant. Members
talk normally — "Mexican under $25", "I'm vegetarian", "the taco place works" —
and a deterministic state machine drives the group to a single decision.

The interesting problem is not finding good restaurants. It is that a group's
best option is rarely anyone's favourite. Viand optimises for the **least
satisfied member**, not the average, so an option that delights three people and
fails a fourth loses to one everybody can live with.

That is measured rather than asserted. `npm run eval` grades the shipped scorer
against alternatives on a seeded synthetic corpus, using latent preference
vectors no strategy is allowed to see:

| Strategy | Min satisfaction (fairness) | Mean satisfaction | Hard-constraint violations |
| --- | --- | --- | --- |
| Naive averaging of stated preferences | 0.276 | 0.541 | 9 |
| **The shipped deterministic scorer** | **0.450** | **0.624** | **0** |

<sub>15 groups, seed `20260815`. Reproduce with `npm run eval -- --seed=20260815 --groups=15`.
See [Evaluating the recommender](#evaluating-the-recommender) for the method and its limits.</sub>

Two hard rules fall out of the design. A dietary requirement is a *constraint*,
never a weighted preference — the type system makes conflating the two a compile
error. And the recommendation path is pure: no network, no clock, no randomness,
no model, enforced by a test.

Runs on Next.js 16, React 19, TypeScript (strict) and Vitest, over iMessage
(via Linq) or Telegram.

[**ARCHITECTURE.md**](ARCHITECTURE.md) covers the pure-domain/adapter split, the
two invariants above as they appear in the type system, and why this is a state
machine rather than an LLM agent.

## Run locally

```sh
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000` and use the conversation simulator. Mock Linq and
the local restaurant catalogue are enabled by default, so no account or
database is required.

Viand stays silent in idle chats until someone intentionally invokes it — a
mention (“@Viand”, “Hey Viand”) or an explicit “pick a place” starts a
decision. `HELP` and `CANCEL` are always answered, without creating a session.
Everything else in an idle chat is ordinary conversation and is ignored. Once a
session is active the group answers normally — votes, vetoes, preferences and
`DONE` all work without repeating the mention.

## Optional: AI interpretation

With `USE_AI_INTERPRETER=true` and an `ANTHROPIC_API_KEY`, free-text messages
are also read by Claude Haiku 4.5 behind a strict JSON schema, which picks up
phrasings the rules parser misses (“the taco place works for me” → vote 2).

It is deliberately additive and cannot make the bot worse:

- Anything the deterministic parser recognises — a vote, `VETO`, `DONE`,
  `CANCEL`, and the `STOP`/`START` compliance keywords — never reaches the
  model, so those meanings never depend on inference or on an API being up.
- Every call is bounded by an input-length cap and a request timeout, with
  retries off. Anything slow, malformed, or low-confidence falls back to the
  rules parser.
- The layer performs no side effects: it reads a message and returns a value.

## Optional: live restaurants

With `USE_MOCK_RESTAURANTS=false`, results come from **OpenStreetMap**. A typed
neighborhood, ZIP code, or address is geocoded through Nominatim; a shared
location — a coordinate pair or a map link — is used directly with no geocoding
call. Restaurants are then fetched from Overpass and normalised to the same
shape as the demo catalogue. The group is always told which source answered.

OSM carries useful `diet:*` tags, so halal, kosher, gluten-free, vegetarian, and
vegan requests can be checked without inferring dietary support from cuisine.
Only `yes` and `only` count; `limited` is rejected because a hard restriction
must not be satisfied by “a couple of things on the menu”.

Most listings carry no dietary tags at all — in central Boston, none do — and an
absent tag is missing data rather than a refusal. Confirmed matches are always
preferred and are never mixed with unconfirmed ones. Only when a dietary need
would otherwise leave the group with nothing does Viand fall back to listings it
could not check, and it says so plainly rather than presenting them as matches.
Every other constraint still eliminates in that fallback. OSM does not provide
dependable ratings or prices; a listing missing either is treated as unknown and
falls back to a completeness proxy, never scored as though it rated badly.

`opening_hours` is parsed against a deliberate subset of the OSM grammar —
weekday ranges, multiple time spans, `off`/`closed`, and `24/7`. A restaurant
confirmed closed at the time of the search is **eliminated before ranking**,
like any other hard constraint, so no rating or proximity can promote it back.
Anything the subset cannot parse — holidays, calendar ranges, sun-relative
times — is reported as *unverified* rather than guessed at, and the group is
told to call ahead. Unverified is not closed: dropping those listings would
empty the list across most of OpenStreetMap, where `opening_hours` is often
absent.

The configured Overpass endpoints share one deadline and the first valid
response wins, so a hanging instance cannot block failover.

A wide search is answered at the radius the group asked for. What scales with
radius is how many kinds of eating place are asked for at once: each amenity is
an independent spatial pass, and measured against a public mirror over central
Boston at five miles, one pass answered in under three seconds, two took
thirty-eight, and three or more failed outright. So a wide search asks only for
restaurants — which fills the result ceiling on its own anywhere dense — while
close-in searches also pick up cafes, fast food, food courts, pubs and bars
that serve food.

If the requested radius cannot be reached at all, a close-in search runs instead
and the group is told the full radius could not be covered. A narrower search is
never presented as a complete one.

Successful searches are cached and can be served stale if the upstream source
later fails. With `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set the
cache is shared across instances, which is what makes it useful on serverless:
consecutive messages from one group land on different processes, so a
process-local cache misses almost every time and every miss is a live query
against a volunteer-run mirror. Without Redis it falls back to a process-local
map — a cache outage costs a slow search, never an error, which is the opposite
of the session store's behaviour and deliberate.

Shared coordinates are cached on a 750-metre grid, so two people sharing a
location from the same block hit one entry, and identical simultaneous searches
are coalesced into a single upstream request.

Before a demo or a busy period, prove it works and warm it in one step:

```sh
npm run demo:verify -- "Boston, MA" "Los Angeles, CA"
```

This runs the real state machine over real listings for each location — a
location, three people wanting different things, a shortlist, votes, a winner —
and exits non-zero if any step comes back empty. Warming alone only shows that a
search returned rows; this shows the group actually gets a decision. It runs
each location twice, so the second timing is what a demo-time search will cost.

`npm run cache:warm` does the fetching without the decision, if that is all you
need. Either way, freshness is bucketed by the hour, so run it within the hour
you intend to use it; an older entry still survives as the stale-on-failure
fallback.

Nominatim and the public Overpass instances are shared volunteer services with
usage policies and operational limits. Set an identifying `OSM_USER_AGENT`.
For sustained production traffic, configure `NOMINATIM_URL` and
`OVERPASS_URL` to paid or self-hosted instances rather than relying on the
public endpoints.

## Choosing a messaging transport

`MESSAGING_PROVIDER` selects what actually moves messages. Discord uses slash-command interactions only (no Gateway or message-content intent):

| Value | Transport | Cost |
| --- | --- | --- |
| `mock` | In-memory, records sends | free |
| `linq` | iMessage via Linq | per Linq's plan |
| `discord` | Discord slash commands | free |
| `telegram` | Telegram Bot API | free, no per-message fee |

Leave it unset to keep the older behaviour: `USE_MOCK_LINQ=true` means `mock`,
`false` means `linq`. Credentials are only required for the transport actually
selected, so a Telegram deploy needs no `LINQ_*` variables.

The browser simulator at `/` always uses the mock runtime and never spends a
real messaging account, whichever transport is configured.

## Connect Linq

For Discord, set `MESSAGING_PROVIDER=discord`, `DISCORD_PUBLIC_KEY`,
`DISCORD_BOT_TOKEN`, and `DISCORD_APPLICATION_ID`; configure the public HTTPS
interaction endpoint as `/api/webhooks/discord`, register at least one global
slash command, then run `npm run discord:doctor` to validate each setting.

1. Get a bearer token and provisioned phone number from Linq.
2. Set `LINQ_API_KEY`, `LINQ_PHONE_NUMBER`, and a public HTTPS `APP_BASE_URL`
   in `.env.local`.
3. Register the pinned `message.received` webhook:

```sh
npm run linq:register-webhook
```

4. Copy the one-time `LINQ_WEBHOOK_SECRET` printed by the command into
   `.env.local`, set `USE_MOCK_LINQ=false`, and restart the app.

The resulting subscription targets:

```text
https://your-host/api/webhooks/linq?version=2026-02-03
```

The route passes the unmodified request body and headers to
`client.webhooks.unwrap()` before processing.

## Connect Telegram

Free alternative to iMessage, with native group support.

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy
   the token it prints.
2. **Disable privacy mode**: BotFather → `/setprivacy` → pick the bot →
   *Disable*. Without this a bot in a group only receives messages that
   `@mention` it, so Viand would never see a member type "Mexican under $25".
   Remove and re-add the bot to any group it already joined.
3. In `.env.local` set `MESSAGING_PROVIDER=telegram`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_BOT_USERNAME` (without the `@`), a public HTTPS `APP_BASE_URL`,
   and any random string as `TELEGRAM_WEBHOOK_SECRET`.
4. Register the webhook:

```sh
npm run telegram:register-webhook
```

The resulting webhook targets:

```text
https://your-host/api/webhooks/telegram
```

Telegram echoes the secret back in `X-Telegram-Bot-Api-Secret-Token` on every
delivery; the route compares it in constant time and rejects anything else with
a 401. Deduplication keys off `update_id`, so Telegram's retries are safe.

A Telegram bot cannot open a conversation — someone has to message it first —
which is why `createChat` is unsupported on this transport. Nothing in the
conversation flow needs it.

## Evaluating the recommender

```sh
npm run eval
```

Builds a seeded synthetic corpus — 50 groups of 2–6 people over a 60-restaurant
catalogue — and runs three strategies against the same candidates:

| | Strategy |
| --- | --- |
| (a) | Naive averaging of the stated preference vectors |
| (b) | One unstructured model prompt over the raw member sentences |
| (c) | The shipped deterministic scorer |

Each synthetic member has a **latent utility vector** that no strategy sees, and
their stated preference is a lossy projection of it. Satisfaction is graded
against the latent vector, so the deterministic scorer is not measured with its
own objective — which would make it win by construction and prove nothing.

Reported per strategy: mean of each group's *least satisfied* member (the
fairness number), mean satisfaction, the worst single group, and hard-constraint
violations. A member whose hard constraint is broken scores 0, not a penalty.
Groups a strategy declined are reported separately rather than scored as zero:
"nothing here works for all of you" is a different outcome from a bad pick.

Strategy (b) needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`; without either it is
skipped and the report says so, so the harness is useful with no credentials.
Gemini is preferred when both are set — grading the shipped scorer against
another vendor's model is the harder claim to wave away. The model that answered
is named in the strategy's row, because a fairness number is not comparable
across models. Everything else is deterministic — the corpus is a pure function
of `--seed`, pinned by a digest in `tests/unit/eval-harness.test.ts`.

A call that never reaches the provider — quota, a 5xx, a timeout — is counted
separately from one the model answered badly, and any of the former marks the
run **not publishable** in the report. The distinction matters: without it a
rate-limited run looks exactly like a model that declines to answer, which would
quietly overstate the shipped scorer. Retries and `--concurrency` exist to get a
run to completion rather than to make it fast.

Measured over 15 groups at seed `20260815`:

| Strategy | Min sat. | Mean sat. | Worst grp | Violations | Answered | Abstained |
| --- | --- | --- | --- | --- | --- | --- |
| (a) naive averaging | 0.276 | 0.541 | 0.000 | 9 | 15 | 0 |
| (c) deterministic scorer | 0.450 | 0.624 | 0.253 | 0 | 14 | 1 |

The scorer wins on fairness and mean alike, and never breaks a hard constraint —
naive averaging breaks nine, because averaging a restriction with a preference is
exactly the mistake that produces "we found somewhere great, sorry about the
vegetarian". It also declined one group outright rather than answer badly.

**What this does not show.** Strategy (b) is implemented and tested but has not
completed a publishable run: the Gemini free tier allows 20 generate requests
per day per model, below what a 15-group run needs once retries are counted, so
every attempt so far has reported itself unpublishable. The comparison above is
therefore still only against a naive baseline. And the corpus is synthetic: it
measures whether the objective is optimised well, not whether the objective
matches what real groups want.

```sh
npm run eval -- --seed=7 --groups=20 --catalogue=mock --strategies=a,c --json
```

## Scope

- State and webhook deduplication are in memory and reset on restart, unless
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, which switches
  both to Redis. Serverless hosts need this: their functions do not share memory,
  so an in-memory session would evaporate mid-conversation.
- Restaurant results come from a deterministic Berkeley demo catalogue unless
  live data is switched on.
- The dashboard simulator always uses mock messaging, mock restaurants, and the
  deterministic parser, on its own isolated state — an unauthenticated page
  never spends Linq, OSM, or model capacity.
- Supabase, Prisma, user accounts, and deployment are intentionally excluded.

## Verify

```sh
npm run typecheck
npm test
npm run build
```
