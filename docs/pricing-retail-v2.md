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
