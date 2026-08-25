# Not Organic hosted provider deployment

Hosted access powers the hosted chat model, credit packs, course workspaces, and
hosted notebooks. It is **off by default**. Pricing uses the provider's public
OAuth/DPoP client when that complete browser contract is configured; legacy
server-proxied hosted surfaces still require the session adapter described in
[Why server-proxied hosted calls still fail](#why-server-proxied-hosted-calls-still-fail).

## Where configuration lives

| File | Holds |
| --- | --- |
| `devenv.nix` (`env` block) | Non-secret defaults for the dev shell |
| `web/.env.example` | Every variable, with placeholders for secrets |
| This file | The deployment contract and the auth requirement |

These three must agree. That is enforced by a pre-commit hook and can be run
directly:

```
devenv tasks run keating:check-env
```

The check fails when code reads a `NOTORGANIC_*` variable that is not documented
here and in `.env.example`, or when the three files disagree. Add new variables
to all three in the same commit.

## Variables

Browser gate:

- `VITE_NOTORGANIC_ENABLED` — when `false`, hosted UI stays hidden rather than
  rendering controls that cannot work.
- `VITE_NOTORGANIC_PUBLIC_ISSUER` — public provider origin used for token,
  wallet, usage, checkout, and inference requests; omit `/v1`.
- `VITE_NOTORGANIC_AUTHORIZATION_URL` — provider authorization endpoint used to
  begin the PKCE redirect flow.
- `VITE_NOTORGANIC_CLIENT_ID` — public Keating OAuth client identifier.
- `VITE_NOTORGANIC_REDIRECT_URI` — exact registered callback URL for this
  Keating deployment.
- `VITE_NOTORGANIC_SCOPE` — requested public capability scopes. Keating needs
  `wallet:read usage:read billing:checkout infer:balanced` for the complete
  wallet, checkout, and balanced-inference surface.
- `VITE_NOTORGANIC_MAX_COST_MICROUSD` — positive per-request browser inference
  reservation ceiling; defaults to `100000` ($0.10). Direct browser inference
  must send this value as `x-notorganic-max-cost-microusd`.

`VITE_NOTORGANIC_ENABLED=true` alone does not enable checkout. Pricing offers
provider connection and purchase actions only when the issuer, authorization
URL, client ID, redirect URI, scope, and max-cost ceiling are all present. With
an incomplete contract it truthfully retains the credit-waitlist flow.

Nitro server:

- `NOTORGANIC_ENABLED` — gate for routes under `web/server/api/notorganic/**`.
- `NOTORGANIC_ISSUER` — HTTPS gateway origin, without `/v1` (normally
  `https://api.notorganic.info`). A path, query, or fragment is rejected at
  startup.
- `NOTORGANIC_MAX_COST_MICROUSD` — positive per-request reservation ceiling in
  micro-USD.

## Why server-proxied hosted calls still fail

Enabling those variables is **not sufficient to authenticate a user**. A Nitro
middleware/plugin must put a `NotOrganicSessionAdapter` on each authenticated
request at `event.context.notOrganicSessionAdapter`. That adapter must:

1. Resolve a durable, server-validated Better Auth session.
2. Resolve its linked ATProto DID without accepting a browser-provided DID or
   email as proof.
3. Sign and exchange the 60-second Keating product assertion.
4. Retain the five-minute capability token and DPoP private key server-side.
5. Implement refresh, revocation, and session-version checks.

**Nothing in the repository registers such an adapter outside of
`web/src/test/notorganic-provider.test.ts`.** Until Keating has that durable
auth/storage deployment, hosted calls return `503
notorganic_auth_adapter_unavailable`. This is intentional.

### What that means for the UI

Server-proxied surfaces remain inert while the adapter is missing. The public
pricing client has a separate deployment contract:

| Surface | Behaviour today |
| --- | --- |
| `/pricing` credit packs | Incomplete public config opens the waitlist; complete public config connects the provider and offers checkout |
| Courses access gate | "Check account" explains that hosted access is unavailable |
| Hosted chat model | Not offered in the model list |
| Hosted notebooks — TypeScript | Runs locally instead |
| Hosted notebooks — Python | Shows "Hosted runs unavailable" (no local Python runtime) |
| Wallet in settings | Balance does not load |

When adding a new hosted surface, make the disabled path say so. Do not call
`promptNotOrganicAccess()` and treat a `false` result as "the user declined" — it
returns `false` both when the user declines and when the feature is off. Check
`isNotOrganicFeatureEnabled()` first and show an explanation.

## Request headers

`NotOrganicFetchAdapter` sets, per request:

- `authorization: DPoP <capability>` and a matching `dpop` proof.
- `x-notorganic-max-cost-microusd` — only when a caller supplies a ceiling.
- `idempotency-key` — on **every** non-`GET`/`HEAD` request, generated when the
  caller does not supply one. This is deliberately independent of the cost
  ceiling: billing POSTs carry no ceiling, and they are exactly the requests
  where a retry must not become a second charge.
