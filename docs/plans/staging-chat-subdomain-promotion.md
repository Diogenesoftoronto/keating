# Staging chat, promotion, and local judgement

> Updated implementation and runbook, 2026-09-24. The original GitHub Actions,
> push-to-`staging`, `promote-queue`, and pre-push recording proposal is superseded.
> Staging now snapshots the current checkout on `devenv up`; Railway runs the
> hourly promotion check independently of the developer's computer.

## Current status and remaining verification

[Staging chat](https://keating-staging.up.railway.app/chat) is deployed.
Deployment `7fe59e0f-300f-43f5-95a5-56bf04c0302f` reached Railway `SUCCESS` and
serves the current application work, including the uncommitted Claude-session
changes. Its dirty snapshot is a preview and cannot promote to production.

The full web suite passed: **2,215 passed, one skipped, zero failures**. The skip
is the published Needle WASM embedding check. Web TypeScript passed. These are
local checks, not proof of live account or model integration.
The canonical root suite also passed: **837 passed, zero failures**; snapshot
and promotion tests passed **19 tests**. An overly broad `bun test test` run
was stopped because it also selected mobile/native suites outside their required
working directories; use the repository's `bun run test` command for root tests.

The Railway cron worker completed a live run against the dirty candidate and
correctly skipped production promotion. It runs hourly with its `/data` volume.

Provider origin allowlists have been deployed; CORS preflight returned HTTP 204.
Real staging sign-in, token exchange, hosted chat inference, and hosted judgement
are still unverified. Production promotion and rollback have not been validated.

Outstanding deployment work:

- Verify `RAILWAY_TOKEN` (production-scoped) and `RAILWAY_STAGING_TOKEN`
  (staging-scoped) inside the production environment's `keating-promotion`
  worker. Both variables are present and sealed; their staged changes were
  committed. A fresh one-shot container on deployment
  `fb314935-7707-4db2-9cec-0597f886edb5` conclusively verified that
  `RAILWAY_STAGING_TOKEN` is nonempty and successfully reads staging deployments.
  `RAILWAY_TOKEN` is present but empty in that same container. Only the production
  token value needs correction; preserve the working staging token. The normal
  start command and hourly schedule were restored after the diagnostic. Do not
  interpret absence from `railway variable list` as absence of a sealed variable:
  query variable metadata or verify inside the container.
- Complete the `chat.keating.help` DNS records below and verify TLS, root
  redirect, sign-in, and shared content on the new origin.
- Validate a clean snapshot's full eight-hour promotion path, production health,
  and retained-archive rollback before calling the promotion system operational.

## Decisions retained

- Staging uses its Railway-generated domain and the production Not Organic issuer.
- `chat.keating.help` is an additional domain on the existing production web
  service, with the same Nitro server and share/course volumes. Apex URLs remain
  canonical for SEO.
- No origin migration bridge or sign-in notice. The planning-time production
  query found three Keating accounts; users sign in again on the new origin.
- Per-origin local storage, IndexedDB, PWA installations, and analytics identities
  remain independent.
- Every normal local operation has a `keating:*` Devenv task. No GitHub Actions,
  staging-branch trigger, or Radicle webhook participates in this deployment path.
- Server direct judgement is a local development opt-in. Hosted environments use
  account authorization and keep both development flags false.

## A. Local judgement

`web/server/utils/judgement-gateway.ts` allows SystemOne directly only when
`KEATING_JUDGEMENT_DEV_DIRECT=1|true` and server-only `TYPESAFE_API_KEY` are set.
It honors `KEATING_JUDGEMENT_ENDPOINT` (default
`https://api.typesafe.ai/v1/systemone`) and `KEATING_JUDGEMENT_MODEL` (default
`jev-latest`). Endpoint overrides require HTTPS or HTTP loopback and reject
credentials, query strings, and fragments. Redirects are disabled. Validation,
request timeout, and sanitized errors apply to both paths. A key alone never
bypasses the server account boundary.

`VITE_KEATING_JUDGEMENT_SAME_ORIGIN=true` makes the browser's hosted judgement
tier call `/api/judgement`. It does not change chat model routing or
`VITE_NOTORGANIC_ENABLED`. Without it, hosted judgement uses the public account
client when configured.

Put `TYPESAFE_API_KEY` in the gitignored `web/.env.local` or the server process
environment. Devenv's exported defaults can override values in `.env.local`;
use explicit options for the two flags:

```bash
rtk devenv \
  --option env.KEATING_JUDGEMENT_DEV_DIRECT:string true \
  --option env.VITE_KEATING_JUDGEMENT_SAME_ORIGIN:string true \
  tasks run keating:web
```

The option syntax and resulting string values were verified with `devenv eval`.
Settings → Judgement → Hosted then reaches SystemOne through the local server.
Router-gated features still need a matching measured calibration artifact;
operation-level estimates retain their uncalibrated status. Flag-on and flag-off
transport tests pass; a live local SystemOne exchange has not been established
by those tests.

## B. Staging snapshots

```bash
rtk devenv up
rtk devenv tasks run keating:staging-deploy
rtk devenv tasks run keating:staging-preview-status
```

`devenv up` runs `scripts/staging.ts deploy` once at startup. The second command
refreshes staging later; this is not a continuous file watcher. Railway keeps
serving the deployed snapshot after the local workspace stops.

The snapshot records the branch, HEAD SHA, content fingerprint, file count,
timestamp, and dirty state in `/staging-build.json`. It copies the Docker build's
application inputs from tracked files and non-ignored untracked files, including
uncommitted changes. It excludes `.env*`, credentials with blocked file types,
generated output, local databases, Git metadata, and symlinks. Dirty status is
measured across the checkout, not only the uploaded application paths.

The uploader waits for its deployment to reach `SUCCESS`, checks the served
fingerprint, and probes `/chat`. An unchanged successful snapshot is reused.
After success it publishes the matching candidate and source archive to the
`keating-promotion` service. This replaces the current candidate, so an old clean
candidate cannot silently promote while a newer dirty preview is active.

To start local processes without uploading staging:

```bash
rtk devenv --option env.KEATING_STAGING_ENABLED:string false up
```

## C. Railway promotion scheduler

`scripts/staging-scheduler/railway.toml` runs the promotion service hourly at
minute 17. Each cron run executes `scripts/promote-staging.ts run-hosted` and
exits. Scheduling continues when the developer's machine is off; the cron worker
is not a continuously running interactive server.

The scheduler image contains the candidate metadata and exact staging source
archive under `/candidate`. Its `/data` volume retains the promotion queue,
leases, and successfully promoted archives. Local diagnostic commands use local
state; they do **not** share the hosted volume or its deployment lease.

Automatic promotion requires all of the following:

1. The candidate is clean (`dirty=false`, `promotionEligible=true`) and has a
   verified source archive. Dirty previews never qualify, including with `--now`.
2. Eight hours have elapsed since successful staging verification (`verifiedAt`).
   Reusing the same successful deployment preserves that verification time.
3. The candidate deployment is still the latest staging deployment and has
   Railway status `SUCCESS`.
4. The live build receipt matches its commit, branch, fingerprint, and clean
   state, and the staging chat health probe succeeds.
5. The commit has not already promoted and no unresolved deployment lease exists.

The promoter checks the archive checksum and embedded receipt, acquires a
persistent lease, rechecks eligibility, and uploads that exact source archive to
production. It records success only after the production deployment succeeds
and its health probe passes. A failure after upload retains the lease for
inspection rather than permitting an automatic duplicate upload.

`keating:staging-status` reports the locally retained candidate and queue.
`keating:staging-scheduler` republishes the current staging snapshot/candidate.
There is no separate `record` action, queue branch, or Git push requirement.

Manual requests use `scripts/request-staging-promotion.ts` through Devenv:

```bash
# Ask the Railway worker to check normal eligibility, including the wait.
rtk devenv tasks run keating:promote-staging
# Skip only the wait for the current clean candidate.
rtk devenv tasks run keating:promote-staging --input now=true
# Restore an archive previously promoted successfully by this worker.
rtk devenv tasks run keating:promote-staging --input now=true --input sha=<full-previously-promoted-sha>
```

Immediate promotion and rollback attach a unique `KEATING_PROMOTION_REQUEST`
to the Railway service, wait for a deployment snapshot containing that exact
request, then start the idle worker for that deployment. Reusing an old image
without checking its configuration can retain stale requests. The worker consumes completed
request IDs once under its shared `/data` state and deployment lease. Successful
request submission does not mean production has changed: inspect the worker's
deployment logs for its result. A retained failed-upload lease requires inspecting
production and releasing the exact operation against that same state. Hosted
manual operation and rollback remain unverified; a separate local queue cannot
stand in for the hosted lease.

## D. Provider origins and chat domain

Both provider gates include `https://keating-staging.up.railway.app` and
`https://chat.keating.help`:

| Gate in `notorganic-provider` | Purpose |
| --- | --- |
| `CORS_ALLOWED_ORIGINS` in `.railway/railway.ts` | Browser cross-origin requests |
| `PUBLIC_CLIENT_PRODUCT_CATALOG` in `apps/gateway/src/public-client-product.ts` | Maps public client origins to Keating |

Authorization-page rendering alone does not prove either gate. The deployed CORS
204 check is confirmed; PKCE/DPoP token exchange and inference remain to be tried.

The application redirects `/` on `chat.keating.help` to `/chat`. Checkout return
URLs use the current browser origin; server validation allows apex, chat, and
explicit `NOTORGANIC_CHECKOUT_RETURN_ORIGINS`. Canonicals stay on the apex.

The production custom domain uses these DNS records at `keating.help`:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `chat` | `j0huj6qp.up.railway.app` |
| TXT | `_railway-verify.chat` | `railway-verify=dfaa19d0dcbd8ef7825a346d91ed72659bd174c7766520005358d5fae4ca702c` |

On September 28, 2026, both explicit records were added at Porkbun while
preserving all 23 existing records. All four authoritative nameservers and
Cloudflare/Google public resolvers returned the required values. Railway
verified ownership and completed certificate issuance after a public API
`customDomainIssueCertificate` request. Normal certificate-validated HTTPS
returned 200 for `https://chat.keating.help/chat` and `https://keating.help/`.
This verifies DNS/TLS and HTTP serving; browser redirect, sign-in, and hosted
judgement remain separate checks.

## Completion checks

- Try the deployed staging chat, complete real sign-in, and send a hosted message.
- Authorize `judgement:evaluate` and obtain a real hosted judgement response.
- Verify chat-domain DNS/TLS, `/` redirect, checkout return origin, and shares/courses.
- Provision both scheduler tokens and verify the clean-candidate promotion cycle.
- Exercise manual promotion, retained-archive rollback, and lease recovery using
  the hosted state; keep dirty previews ineligible throughout.
- Run `rtk devenv tasks run keating:check-env` after environment documentation
  changes. Keep local tests, browser integration, provider calls, and production
  deployment evidence separate.
