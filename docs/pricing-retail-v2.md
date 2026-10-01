# Keating retail pricing

New Personal subscriptions use `keating_personal_v2`: $25 USD per month before
tax, including $5 of retail Not Organic credit each billing cycle. Unused monthly
credit rolls forward for one billing cycle. Existing subscriptions retain their
terms; no automatic migration is performed.

The local/BYOK client remains free. One-time $10/$25/$50 packs retain their IDs;
$25 is the default selection. Anyone with a free Not Organic account can buy
and use these standalone packs without a subscription. Top-ups do not expire. Retail wallet dollars buy
services at published Not Organic rates and do not represent raw provider cost.
Personal does not include custom training or premium voice.

## Subscriber benefits

Personal is the paid tier for managed encrypted cross-device sync, hosted
recovery, and a cloud sandbox. These are planned benefits, not launched services;
the pricing page labels them unavailable until the end-to-end integrations work.
The existing $25 price and $5 hosted AI credit are unchanged. No new sandbox
allowance or retention quota has been promised.

Free users retain local learning, local data, export/import backups, and local
sandbox execution where supported. User-provided storage or relays may be added
as a separate option; they are not implemented. Encryption is not a paid feature.

Subscriber access must come from authenticated Not Organic billing state for
the same DID, product `keating`, and plan `keating_personal_v2`, within the paid
period. Checkout catalog availability, purchased credits, browser flags, and a
trial do not establish a paid subscription. End-of-period cancellation retains
access until the recorded paid period ends. Renewal extends the provider period;
an expired period denies hosted access without deleting local data.

The managed `cloud` proxy now checks subscription authority and remains
unavailable until a runner enforces a durable compute allowance. A configured
user-owned `remote` runtime is separate. The existing server product-session
adapter is required; public-client login alone does not provide that adapter.

Hosted sync should use a private object bucket with short-lived authorized URLs
for direct device transfers, encrypted changed records, bounded history, and
occasional recovery snapshots. This avoids an always-on GUN relay and repeated
full-data downloads. A bucket transport, account lifecycle, merge/deletion
handling, quotas, subscriber authorization, and recovery verification still
need implementation before it can be enabled. Do not gate recovery-key access
or export of existing data on payment. On expiry, pause new hosted writes and
compute while allowing authenticated recovery/export during a stated retention
window; define that window before launch.

## Launch requirements

The central provider must configure a verified payment mapping for the new plan
and return it in `/v1/wallet` → `checkout.planIds`. Pack availability remains
separate in `checkout.packIds`. Do not substitute a legacy mapping.

The frontend requires the existing complete public client setup and
`VITE_NOTORGANIC_CHECKOUT_ENABLED=true` plus
`VITE_NOTORGANIC_SUBSCRIPTION_CATALOG=keating_v2`. The authenticated Nitro fallback
also requires `NOTORGANIC_SUBSCRIPTION_CATALOG=keating_v2` and independently checks
the provider wallet before creating a subscription checkout.

Validate an actual subscription payment, signed webhook, grant, renewal,
cancellation, and refund before enabling sales. A redirect alone does not prove
a payment. This change does not alter live billing configuration or subscriptions.
