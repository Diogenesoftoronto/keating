# Hosted credit email waitlist

Pack clicks open the email dialog; nothing is purchased. `POST /api/credit-waitlist` accepts JSON `{email, packId, consent: true, website: ""}`. Only after Resend contact persistence and membership in the configured dedicated segment does it return `joined: true`. Confirmation status is `sent`, `already_registered`, or `unavailable`; confirmation failure leaves the durable signup intact and is shown honestly. A sent response means Resend accepted the message, not proof of inbox delivery.

Server-only deployment variables:

- `RESEND_API_KEY`: permission to manage contacts/segments and send email.
- `KEATING_WAITLIST_SEGMENT_ID`: pre-provision a dedicated **Keating hosted credits launch · consent v1** segment in Resend; its membership is the durable launch-notification opt-in. Do not reuse a general marketing segment.
- `KEATING_WAITLIST_FROM`: sender at a Resend-verified domain, with a monitored reply mailbox, e.g. `Keating <hello@your-verified-domain>`.
- `KEATING_WAITLIST_ORIGIN`: canonical public origin, recommended behind a reverse proxy. Otherwise the request URL origin is used.

The route must be registered in Nitro. There are no browser secrets or ephemeral signup lists. Existing global unsubscribes are preserved. Pack intent is included in the confirmation email tags; the list itself is one hosted-credit launch segment. Use Resend broadcast unsubscribe handling for the eventual launch email. Confirmation is transactional and tells unexpected recipients to reply. This is explicit single opt-in, not proof of mailbox ownership or double opt-in.

Abuse controls: same-origin JSON only, 2 KiB streamed request limit, strict email/pack/consent validation, honeypot, and hashed validated-email limiter (5 attempts/15 minutes, 10,000 bounded buckets), plus 1,000 requests/15 minutes per-process global ceiling. Shared Railway proxy IPs cannot exhaust another email's allowance; forwarded headers are not trusted. Add an edge rate limit on `/api/credit-waitlist` for coordinated abuse across replicas. Provider requests have 8-second timeouts and up to two transient retries. Confirmation sends use a deterministic Resend idempotency key (provider retention 24 hours); existing segment members never trigger another confirmation. If confirmation fails, it is not queued for automatic later delivery; signup remains available for the launch notification.

Validation uses injected provider mocks; no test email is sent. Live segment persistence, verified-sender acceptance and mailbox delivery require separately authorized production verification.

API references: [contacts](https://resend.com/docs/api-reference/contacts/create-contact), [segment membership](https://resend.com/docs/api-reference/contacts/add-contact-to-segment), [email idempotency](https://resend.com/docs/api-reference/emails/send-email).
