# Not Organic hosted provider deployment

The browser integration is feature-gated with:

- `VITE_NOTORGANIC_ENABLED=true`
- `NOTORGANIC_ENABLED=true`

The Nitro server additionally requires:

- `NOTORGANIC_ISSUER` — HTTPS gateway origin, without `/v1` (normally `https://api.notorganic.info`)
- `NOTORGANIC_MAX_COST_MICROUSD` — positive per-request reservation ceiling

Enabling those variables is not sufficient to authenticate a user. A Nitro
middleware/plugin must put a `NotOrganicSessionAdapter` on each authenticated
request at `event.context.notOrganicSessionAdapter`. That adapter must:

1. Resolve a durable, server-validated Better Auth session.
2. Resolve its linked ATProto DID without accepting a browser-provided DID or
   email as proof.
3. Sign and exchange the 60-second Keating product assertion.
4. Retain the five-minute capability token and DPoP private key server-side.
5. Implement refresh, revocation, and session-version checks.

Until Keating has that durable auth/storage deployment, hosted calls return
`503 notorganic_auth_adapter_unavailable`. This is intentional.
