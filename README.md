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

- Linq is the only live integration.
- State and webhook deduplication are in memory and reset on restart.
- Restaurant results come from a deterministic Berkeley demo catalogue.
- Supabase, Prisma, user accounts, and deployment are intentionally excluded.

## Verify

```sh
npm run typecheck
npm test
npm run build
```
