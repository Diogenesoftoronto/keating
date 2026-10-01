# Not Organic hosted provider deployment

Hosted access powers the hosted chat model, credit packs, course workspaces, and
hosted notebooks. Local defaults configure public sign-in at
`https://id.notorganic.info/authorize` with gateway `https://api.notorganic.info`.
Checkout and the legacy server integration remain **off by default**.
Pricing uses the provider's public OAuth/DPoP client; legacy
server-proxied hosted surfaces still require the session adapter described in
[Why server-proxied hosted calls still fail](#why-server-proxied-hosted-calls-still-fail).

The browser client requests a provider device session (`device_session: true`)
at sign-in. The five-minute capability token renews silently through
`/v1/public/device/token` with a DPoP proof bound to the rotating refresh token,
and the session is kept in `localStorage` so it survives reloads and new tabs.
Refresh is serialized across tabs with `navigator.locks`. Sign-out revokes the
device session through `/v1/public/device/revoke`. A 400/401/403 during refresh
signs the learner out; network errors keep the session for the next attempt.

## Where configuration lives

| File | Holds |
| --- | --- |
| `devenv.nix` (`env` block) | Non-secret defaults for the dev shell |
| `web/.env.example` | Every variable, with placeholders for secrets |
| This file | The deployment contract and the auth requirement |

These three must agree. That is enforced by a pre-commit hook and can be run
directly:

```
rtk devenv tasks run keating:check-env
```

The check covers the hosted-provider and judgement environment variables; it
fails when required documentation is missing or the configuration files disagree. Add new variables
to all three in the same commit.

## Variables

Browser gate:

- `VITE_NOTORGANIC_SUBSCRIPTION_CATALOG` — defaults to an empty string, disabling
  subscription checkout. Set to `keating_v2` only after verifying the provider's
  `keating_personal_v2` payment mapping. Also requires
  `VITE_NOTORGANIC_CHECKOUT_ENABLED=true` and a wallet response advertising that
  plan as available; the catalog flag alone does not enable purchases.

- `VITE_NOTORGANIC_CHECKOUT_ENABLED` — separate purchase gate, default `false`.
  Enable only after live payment credentials, approved prices and signed credit
  delivery have been verified. Account signup may be enabled independently.

- `VITE_NOTORGANIC_ENABLED` — controls hosted inference availability. Account
  sign-in remains available when the public issuer and authorization URL below
  are configured, including when this flag is `false`. Checkout has its own gate.
- `VITE_NOTORGANIC_PUBLIC_ISSUER` — public provider origin used for token,
  wallet, usage, checkout, and inference requests; omit `/v1`.
- `VITE_NOTORGANIC_AUTHORIZATION_URL` — provider authorization endpoint used to
  begin the PKCE redirect flow.
- `VITE_NOTORGANIC_ACCOUNT_URL` — optional HTTPS page for credits and account
  details, linked from Settings. When blank, uses `/account` on the
  authorization URL's origin.
- `VITE_NOTORGANIC_CLIENT_ID` — public Keating OAuth client identifier. When
  blank, uses the current HTTPS or HTTP loopback browser origin.
- `VITE_NOTORGANIC_REDIRECT_URI` — exact callback URL for this Keating deployment.
  When blank, uses `/notorganic/callback` on the current HTTPS or HTTP loopback
  origin. This keeps the callback on the origin holding the PKCE transaction.
- `VITE_NOTORGANIC_SCOPE` — requested public capability scopes. Keating needs
  `wallet:read usage:read billing:checkout infer:balanced realtime:connect` for the complete
  wallet, checkout, and balanced-inference surface.
- `VITE_NOTORGANIC_MAX_COST_MICROUSD` — positive per-request browser inference
  reservation ceiling; defaults to `100000` ($0.10). Direct browser inference
  must send this value as `x-notorganic-max-cost-microusd`.

`VITE_NOTORGANIC_ENABLED=true` alone does not enable checkout. Pricing offers
provider connection and purchase actions only when the issuer, authorization
URL, resolved client ID and redirect URI, scope, and max-cost ceiling are present. With
an incomplete contract it truthfully retains the credit-waitlist flow.

Nitro server:

- `NOTORGANIC_SUBSCRIPTION_CATALOG` — defaults to an empty string. Set to
  `keating_v2` to accept `keating_personal_v2` subscription selections through
  the authenticated server checkout fallback after verifying the provider
  payment mapping. This is separate from the browser flag and does not bypass
  the server route's authentication or hosted-provider gate.

- `NOTORGANIC_ENABLED` — gate for routes under `web/server/api/notorganic/**`
  and for the GPT Live relay at `web/server/api/live.ts`. While it is `false`,
  the browser gate above still offers GPT Live as a speech provider but every
  session is refused with `live_relay_unavailable`.
- `NOTORGANIC_ISSUER` — HTTPS gateway origin, without `/v1` (normally
  `https://api.notorganic.info`). A path, query, or fragment is rejected at
  startup.
- `NOTORGANIC_MAX_COST_MICROUSD` — positive per-request reservation ceiling in
  micro-USD.

## Why server-proxied hosted calls still fail

Enabling the legacy server route gate is **not sufficient to authenticate a user**. A Nitro
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
auth/storage deployment, legacy server-proxied calls return `503
notorganic_auth_adapter_unavailable`. The public browser OAuth/DPoP client does
not require this adapter. Local `/api/judgement` also has the explicit development
override described below.

### What that means for the UI

Legacy server-proxied surfaces remain inert while the adapter is missing.
Public browser chat, wallet, pricing, and judgement use their own OAuth/DPoP
client contract. Do not infer their availability from the legacy adapter:

The following disabled behavior applies when a surface uses the legacy adapter:

| Surface | Behaviour today |
| --- | --- |
| `/pricing` credit packs | Incomplete public config opens the waitlist; complete public config connects the provider and offers checkout |
| Courses access gate | "Check account" explains that hosted access is unavailable |
| Hosted chat via the legacy adapter | Unavailable; public browser chat uses its separate account client |
| Hosted notebooks — TypeScript | Runs locally instead |
| Hosted notebooks — Python | Shows "Hosted runs unavailable" (no local Python runtime) |
| Wallet via the legacy adapter | Balance does not load; the public wallet client uses its separate account session |

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

## Staging deployment

`rtk devenv up` snapshots the current branch, including uncommitted app changes,
and uploads it to [staging chat](https://keating-staging.up.railway.app/chat).
This runs once at startup; use `rtk devenv tasks run keating:staging-deploy` to
refresh later. Railway continues serving the snapshot after the local workspace
stops. `rtk devenv tasks run keating:staging-preview-status` reports the live
commit, content fingerprint, dirty status, and URL from `/staging-build.json`.

Only the application build inputs are copied. Gitignored files, `.env*`, blocked
credential file types, generated output, local databases, and symlinks are
excluded. Dirty application work is included; dirty status is measured across
the entire checkout. Use an explicit Devenv override to skip staging upload:

```bash
rtk devenv --option env.KEATING_STAGING_ENABLED:string false up
```

Successful staging uploads publish the exact source archive and candidate to
the `keating-promotion` service in Railway's production environment. Its cron
runs hourly at minute 17, independently of local processes or GitHub. Only clean
candidates qualify for automatic promotion, after eight hours from successful
staging verification. Dirty previews never promote, even with a manual immediate
request. The latest deployment, live receipt, archive checksum, and chat health
must match; superseded candidates cannot promote. The scheduler keeps its queue,
deployment lease, and successful rollback archives on its `/data` volume.

The scheduler requires two server secrets: `RAILWAY_TOKEN` scoped to production
and `RAILWAY_STAGING_TOKEN` scoped to staging. Both are still pending setup on
`keating-promotion`. `keating:staging-status` reports local candidate/health state;
Railway logs and `/data` hold authoritative hosted promotion history. Do not run
a separate local promoter against an independent queue to bypass a hosted lease.

`rtk devenv tasks run keating:promote-staging` asks the Railway worker to check
normal eligibility. Add `--input now=true` to request immediate promotion of the
current clean candidate, or also `--input sha=<full-previously-promoted-sha>`
to request a retained-archive rollback. These tasks submit work to Railway;
they do not upload production from a local queue. Immediate requests carry a
unique `KEATING_PROMOTION_REQUEST`, and the worker records completed IDs on
its shared volume. Read the worker's logs for the outcome; submission alone is
not proof of a production change.

The implementation and remaining verification are tracked in
[the staging runbook](../../../docs/plans/staging-chat-subdomain-promotion.md).
The original GitHub Actions workflow, staging-branch push trigger, and queue
branch are superseded.

## Staging provider origins and verification

Staging uses the production Not Organic issuer with its own approved HTTPS
origin. Both `CORS_ALLOWED_ORIGINS` and `PUBLIC_CLIENT_PRODUCT_CATALOG` at the
provider include `https://keating-staging.up.railway.app` and
`https://chat.keating.help`. Those provider changes are deployed and CORS
preflight returned HTTP 204. Real staging sign-in/token exchange, hosted chat
inference, and `judgement:evaluate` inference remain unverified.

Set `NOTORGANIC_CHECKOUT_RETURN_ORIGINS` to additional exact HTTPS return origins
(comma-separated, no trailing slash). The apex and `https://chat.keating.help`
are always approved checkout origins. Public client IDs and callback URLs derive
from the browser origin unless explicitly configured; keep them on the origin
holding the PKCE transaction.

As of 2026-09-24, staging deployment
`e586d68f-0d8b-46a5-b407-1e94cc1f8a38` reached `SUCCESS`, including the current
Claude-session application changes. The full web suite passed with 2,215 tests,
one existing Needle WASM skip, and no failures; web TypeScript passed. Production
promotion and rollback remain unvalidated.

`chat.keating.help` still needs its Railway DNS records: CNAME `chat` to
`j0huj6qp.up.railway.app`, and TXT `_railway-verify.chat` set to
`railway-verify=dfaa19d0dcbd8ef7825a346d91ed72659bd174c7766520005358d5fae4ca702c`.
Then verify certificate issuance, `/` → `/chat`, account sign-in, and shared
course/share storage. It is a fresh browser origin; there is no state migration.

## Local judgement

For local judgement only, enable `KEATING_JUDGEMENT_DEV_DIRECT=1|true` with
server-only `TYPESAFE_API_KEY`, and set
`VITE_KEATING_JUDGEMENT_SAME_ORIGIN=true` for the browser. Devenv's exported false
defaults may override `.env.local` flags. Store the key in gitignored
`web/.env.local` or the server environment and override both flags explicitly:

```bash
rtk devenv \
  --option env.KEATING_JUDGEMENT_DEV_DIRECT:string true \
  --option env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN:string true \
  tasks run keating:web
```

The override syntax and values were verified with `devenv eval`.
`KEATING_JUDGEMENT_ENDPOINT` defaults to
`https://api.typesafe.ai/v1/systemone`; overrides require HTTPS or HTTP loopback,
without URL credentials, query, or fragment. `KEATING_JUDGEMENT_MODEL` defaults
to `jev-latest`. Request validation, timeout, redirect refusal, and sanitized
errors still apply. A bare TypeSafe key never enables the bypass.

Keep both flags false in staging and production. The TypeSafe key never uses a
`VITE_` variable. The same-origin browser flag affects judgement only; it does
not disable Not Organic chat. Matching measured calibration is still required
for router-gated features; operation estimates remain labeled uncalibrated.
