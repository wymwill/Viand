# MVP backlog

## Ready

- [x] Receive and verify Linq `message.received` webhooks.
- [x] Process location, preferences, recommendations, voting, and opt-out commands.
- [x] Provide a bare dashboard with an end-to-end message simulator.
- [ ] Replace the local restaurant catalogue with an approved nearby-places source.
- [ ] Replace process memory with durable storage after the MVP is validated.

## Guardrails

- Never expose Linq credentials to the browser.
- Always verify the raw webhook body before parsing or processing it.
- Do not claim demo restaurant results are live or exhaustive.
