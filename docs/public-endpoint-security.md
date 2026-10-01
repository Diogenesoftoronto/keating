# Public endpoint controls

Browsing and trying supported providers do not require a CAPTCHA or a new account.
The server limits expensive operations, not ordinary pages or static assets.

## Shared limits

Set server-only `KEATING_ABUSE_REDIS_URL` to a private Redis URL before deploying
the protected routes on Railway. The prepared production reference is
`${{Redis.REDIS_URL}}`. Local development uses a bounded memory store if unset.
On Railway, absent/unavailable Redis fails protected actions with a brief 503
and `Retry-After: 10`; it does not disable page browsing. Limits never silently
fall back to separate process budgets in production.

Redis reservations and concurrency leases are atomic across replicas. Counters
expire automatically, leases recover after process crashes, and failed storage
writes roll back byte reservations without decrementing a newer time window.
Keys hash IP/email identities and the environment namespace. Railway's
overwritten `X-Real-IP` is trusted; arbitrary forwarded chains are not. For
another trusted reverse proxy, explicitly set `KEATING_ABUSE_TRUST_PROXY_IP=true`
only if it overwrites this header. Never expose Redis through a public domain
or TCP proxy. Configure persistence, `maxmemory 128mb`, and `noeviction` so memory
pressure cannot silently discard active limits. Capacity failures return 503.

| Operation | Client budget | Global budget | Bounds |
| --- | --- | --- | --- |
| Chat proxy | 120/minute, 8 active streams | 600/minute, 64 streams | 8 MiB input, 32 MiB decoded output; 60 seconds for response headers, 10 minutes streaming |
| New share | 10/hour, 8 MiB/day | 300/hour, 64 MiB/day | 512 KiB raw input and stored share; existing links retain their data |
| Waitlist | 10/15 minutes, 5/email/15 minutes; 2 active/client, 1/email | 100/15 minutes, 8 active; 200 confirmation reservations/day | 2 KiB input, 10-second body timeout; provider operation deadline 60 seconds |
| OAuth exchange/refresh/device polling | 120/minute across endpoints | 1,200/minute across endpoints | 32 KiB JSON inputs; existing provider-specific polling behavior preserved |
| Diagnostics | Shared global limit | 30/15 minutes, 200 email reservations/day | 256 KiB input; email quota exhaustion retains the sanitized report in logs |
| Arize trace export | Configured rate, default 30/minute | 600/minute | 64 KiB input |

Windows begin with the first reservation. `Retry-After` reports the remaining
window or lease. Global admission precedes IP key allocation, bounding key churn
from distributed callers. These are abuse ceilings, not a throughput guarantee;
increase them with observed legitimate usage, especially for classrooms behind
shared IP addresses. Body limits are enforced while reading bytes, including
requests without Content-Length. Slow body reads expire rather than holding a
connection indefinitely.

## Proxy destinations and mail

Hosted proxy requests accept exact supported provider hosts and inference paths.
For custom gateways, put exact HTTPS origins in `KEATING_CHAT_PROXY_EXTRA_ORIGINS`,
separated by commas; tenant endpoints are not enabled by wildcard. An approved
origin is trusted operator configuration, so only approve destinations you
control or provider infrastructure. Local providers remain available in local
development. Redirects are rejected, credentials/cookies from Keating are not
forwarded, and proxy responses explicitly use `Cache-Control: no-store`.

Waitlist membership is saved before confirmation. Existing members do not get a
second email; retries retain the provider's idempotency key. When the daily email
budget is exhausted, signup still succeeds with confirmation unavailable. The
provider send is awaited within bounded concurrency rather than queued in an
ephemeral process. IP/global/daily mail thresholds have bounded server-side
overrides documented in `web/.env.example`. Email reservations remain consumed
after ambiguous provider failures to avoid doubling potential spend.

Share quotas bound new daily growth, not lifetime storage. Existing public links
are not expired or deleted. Before multiple replicas serve shares, use shared
durable share storage; shared Redis limits do not replicate filesystem data.

## Railway controls and validation

Production CDN caching is enabled for Keating and Twyne with automatic HTML
caching, 30-minute fallback TTL, and purge-all on deployment. Edge rules bypass
APIs, analytics, and service-worker/update files. Authentication headers and
streaming responses continue through to the origin.

A $75 workspace email alert is configured. It covers the whole workspace,
not just Keating. No hard billing cutoff is set. Keating's production resource
ceiling is 2 vCPU / 2 GB RAM per replica; Redis is 0.25 vCPU / 0.5 GB RAM. Review
these ceilings before increasing replicas or adding server computation. They
limit compute allocation, not egress or external provider bills. Keep Under
Attack Mode for an active incident; it can challenge browsers and obstruct API
clients.

Focused checks:

```sh
rtk bun test src/test/public-abuse.test.ts src/test/chat-proxy.test.ts src/test/share-abuse.test.ts src/test/credit-waitlist.test.ts src/test/public-oauth-limits.test.ts
# From web/, point only at a disposable Redis instance for cross-client tests:
rtk proxy env KEATING_ABUSE_TEST_REDIS_URL=redis://127.0.0.1:26379 rtk bun test src/test/public-abuse.test.ts
rtk bun run typecheck
rtk bun run build
```

After deployment, verify supported provider streaming, cancellation, a normal
anonymous share, signup deduplication, and real sign-in. Verify 429/413 handling
with a controlled test identity rather than flooding production. A local build
and Redis test do not establish a successful real provider exchange.
