# Viand MVP

A minimal Next.js app that receives signed `message.received` events through
the official Linq TypeScript SDK, processes them through a deterministic
restaurant-decision state machine, and replies in the same Linq chat.

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
must not be satisfied by “a couple of things on the menu”. OSM does not provide
dependable ratings or prices, and its `opening_hours` grammar is not currently
parsed.

The configured Overpass endpoints share one deadline and the first valid
response wins, so a hanging instance cannot block failover. Public queries are
capped at 1.5 kilometres and have a 30-second client budget. Successful
searches are cached in the current server process and can be served stale if
the upstream source later fails. This protects a warm process from short
outages, but it is not a durable cross-instance cache.

Nominatim and the public Overpass instances are shared volunteer services with
usage policies and operational limits. Set an identifying `OSM_USER_AGENT`.
For sustained production traffic, configure `NOMINATIM_URL` and
`OVERPASS_URL` to paid or self-hosted instances rather than relying on the
public endpoints.

## Choosing a messaging transport

`MESSAGING_PROVIDER` selects what actually moves messages:

| Value | Transport | Cost |
| --- | --- | --- |
| `mock` | In-memory, records sends | free |
| `linq` | iMessage via Linq | per Linq's plan |
| `telegram` | Telegram Bot API | free, no per-message fee |

Leave it unset to keep the older behaviour: `USE_MOCK_LINQ=true` means `mock`,
`false` means `linq`. Credentials are only required for the transport actually
selected, so a Telegram deploy needs no `LINQ_*` variables.

The browser simulator at `/` always uses the mock runtime and never spends a
real messaging account, whichever transport is configured.

## Connect Linq

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

## Scope

- State and webhook deduplication are in memory and reset on restart.
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
