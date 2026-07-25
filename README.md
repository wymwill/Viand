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

With `USE_MOCK_RESTAURANTS=false` and a `GOOGLE_MAPS_API_KEY` (Places API (New)
and Geocoding API enabled), results come from Google. A typed neighborhood, ZIP
code, or address is geocoded; a shared location — a coordinate pair or a map
link — is used directly with no geocoding call. Results are normalised to the
same shape as the demo catalogue and the group is told which source it got.

One limitation is worth knowing before switching it on: Places publishes a
single dietary signal (`servesVegetarianFood`) and nothing about vegan, halal,
kosher, gluten, or allergens. Viand reports only what Google actually states
and infers nothing from cuisine, because a dietary claim about a real
restaurant is something an allergic person acts on. Since every dietary
requirement is a hard restriction, a halal, kosher, gluten-free, or nut-free
request will find no live options and the group will be told so.

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

## Scope

- State and webhook deduplication are in memory and reset on restart.
- Restaurant results come from a deterministic Berkeley demo catalogue unless
  Google Places is switched on.
- The dashboard simulator always uses mock messaging, mock restaurants, and the
  deterministic parser, on its own isolated state — an unauthenticated page
  never spends Linq, Places, or model quota.
- Supabase, Prisma, user accounts, and deployment are intentionally excluded.

## Verify

```sh
npm run typecheck
npm test
npm run build
```
