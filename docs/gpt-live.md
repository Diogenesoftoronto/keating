# GPT Live in Keating

Choose **GPT Live · Not Organic** in Live or Learning → Speech. The model is
`gpt-live-1`; it uses your Not Organic account and its `realtime:connect`
permission. No OpenAI key is stored in Keating. Review the inline audio and
content-logging disclosure and explicitly approve consent before starting.
The displayed amount is a spending ceiling, not a quoted price. The server can
lower that ceiling to its own configured limit.

This gateway integration carries full-duplex voice, recent conversation and
bounded learner/course context. It has no camera, screen, image or tool lane.
Use chat for creating artifacts and executing Keating tools. The voice provider
does not advertise those actions or send unsupported tool declarations.

## Connection

The browser and Electron renderer use a same-origin WebSocket at `/api/live`.
Its first frame carries a fresh device-bound DPoP proof for
`GET https://api.notorganic.info/v1/live/sessions`, an account capability,
an idempotency key and the requested ceiling. These never appear in URLs.
The Nitro relay sends the credentials as headers to the fixed configured
Not Organic gateway. Browser clients cannot set WebSocket handshake headers
themselves. The relay rejects foreign origins, binary frames, duplicate
authentication, excess buffering and oversized messages.

After `keating.live.ready`, the client sends `session.start` with instructions.
It waits for `session.started` before capturing PCM16 mono audio at 24 kHz.
Microphone mute, playback, live transcript deltas and cancellation use the
existing Live surface. GPT Live emits transcript fragments without completed
turn markers; Keating preserves fragments and does not invent final turns from
network gaps. Stop halts microphone input immediately, sends `session.close`
and waits for the final `session.closed` event before closing the transport.
The gateway owns usage settlement, including disconnected clients.

Packaged desktop supplies the public gateway origin and a default $0.10 ceiling
to its local Nitro process. Explicit environment overrides, including disabling
Not Organic, are preserved. This contains no provider credentials.

## Gateway deployment requirements

The existing Not Organic source implements `GET /v1/live/sessions`. It requires
`OPENAI_LIVE_API_KEY`, a configured billing rate, the `realtime` enabled alias,
an account wallet and explicit stored realtime consent. Keating's consent
control uses `GET` and `POST /v1/realtime/consent`; only a user action issues POST.
The exact purpose and policy version are validated before showing approval.

On 2026-09-20, Keating web, the scoped Not Organic gateway and additive Convex
consent/accounting changes deployed successfully to production. The existing
OpenAI credential is configured server-side with
`OPENAI_LIVE_MICROUSD_PER_MINUTE=50000`. This preserves the exact upstream minute
rate while settling per-second usage; the deployed gateway retains its existing
20% markup. No paid Live session was opened, so provider entitlement and actual
audio behaviour remain unverified. No consent is silently granted on the user's
behalf. Existing account connections may need reconnecting to obtain the
`realtime:connect` permission before approving consent.

## Verification

Focused tests cover model/settings persistence, account-aware errors, explicit
consent, microphone readiness, exact transcript fragments, mute, cancellation,
late microphone cleanup, buffer limits and terminal close. Relay tests check
the proof target, fixed destination, account headers, spending ceiling and
sanitized upstream failures. Manual microphone, speaker and browser testing is
left to the user; no paid GPT Live call was made during release preparation.

Protocol references: [OpenAI GPT Live WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations).
