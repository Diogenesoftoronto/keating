# Jev at the context limit

Live tests on November 20, 2026 found a production failure. Keating estimated the same 18,104 tokens for two 54,128-character review states. Jev read the final instruction correctly in the plain-English state. The state filled with synthetic notebook identifiers exceeded Jev’s context. The deployed Keating BYOK relay reported that the backend was unavailable. The deployed Not Organic account gateway returned HTTP 502.

The reverse error was also observable. The deployed relay accepted two untrimmed planning inputs that Keating estimated at 32,001 tokens. One contained four history messages. The other contained only the current message. Jev answered all 39 questions in each request. The earlier local implementation had discarded history in the first case and withheld the second. Railway matched the successful controls to `k3Fo9BXvRPeuSFGmo3UVLg` and `smLtvwp2SAKNc6jTBhdwDg`. [Control receipts](receipts.json)

The local fixes let hosted Jev confirm token fit at its advertised limits. Keating still enforces the transport’s hard byte and character limits and any explicitly smaller operator budget. On a model-confirmed overflow, Keating tries smaller question groups over identical history. If one question still exceeds capacity, it retries with an opening excerpt, recent whole turns and the intact current request. Each planning, draft-review and selection request gets its own window.

## Five conversations through the local Keating answer flow

The Flue host sent synthetic learner requests through Keating’s web draft gate, the local production-built Nitro BYOK relay, live Jev 1.14.0 and Gemini 3.1 Flash-Lite. Each answerable case had two successful, overlapping tutor HTTP requests. Jev reviewed each candidate and chose between their exact text hashes. The Flue conversation history contained the selected answer with the earlier workshop code and the correct perimeter of 24.

| Full planning estimate | Planning history Jev received | Tutor request overlap | Learner outcome |
| --- | --- | ---: | --- |
| 31,999 | All four messages | 1,771 ms | Correct answer |
| 32,000 | All four messages | 928 ms | Correct answer |
| 32,001 | Opening excerpt and newest turn after one older turn was removed | 1,472 ms | Correct answer |
| 18,104, dense identifiers | Full history rejected with 39 questions, then with one. Jev accepted an opening excerpt and the newest turn. | 837 ms | Correct answer |
| 32,001, current request alone | No request dispatched | — | Guidance to shorten the request. Zero tutor or Jev calls. |

The five cases used 31 provider requests. The first two rows describe **planning**. Adding a candidate reply changed the size of its subsequent review, which could require its own trim. No candidate text or current learner message was silently shortened.

An earlier test reservation prevented two second drafts from being sent. The harness reported that run as failed and now checks real network overlap, both completed reviews, selection and delivery. All five rows above come from the stronger run. [Application test](../../../web/scripts/jev-boundary-proof.ts) · [Request hashes, dispatch times and outcomes](receipts.json)

## The provider’s two limits

TypeSafe documents a 32k state-plus-one-question limit and a 64k whole-request limit. The direct probe increased deterministic synthetic text until each request changed from an accepted answer to HTTP 400 with `detail.error_type = max_tokens_exceeded`. The long-context option was off. [TypeSafe model limits](https://docs.typesafe.ai/models) · [Reproducible provider probe](../../../scripts/context-window/jev-provider-boundary.ts)

| Probe | Last accepted filler | First rejected filler | Provider input usage on acceptance |
| --- | ---: | ---: | ---: |
| One question | 45,691 characters | 45,857 characters | 32,924 tokens |
| Combined questions | 22,862 characters per section | 22,945 characters per section | 65,600 tokens |

The accepted requests correctly read the synthetic opening and closing markers. Both halves of the rejected combined batch succeeded with unchanged state and correctly read the markers. The reported input usage is the provider’s billing field. TypeSafe returned the error category on rejection without a token count for the offending component. These are observed boundaries for these fixtures. [Provider request IDs and answers](receipts.json)

## Production and the local gateway fix

| Route | Plain-English control | Dense identifiers |
| --- | --- | --- |
| Deployed Keating BYOK relay, from Chromium | HTTP 200, `birch`, 11,998 input tokens | HTTP 400, `backend-unavailable` |
| Deployed Not Organic, signed account, `judgement` route | HTTP 200, `judgement-jev/jev-1.14.0`, `birch`, 11,998 input tokens | HTTP 502, `judgement_upstream_error` |
| Patched local Not Organic with a signed test account and real TypeSafe | Compact retry returned HTTP 200, `birch`, 716 input tokens | HTTP 400, `context-limit-exceeded` |

Railway matched the deployed BYOK success and rejection to request IDs `vaHWEYAASHyh-ur4c9o55Q` and `8PnlqVFGTa2GoIZAHn5Ytg`. It matched the signed account requests to `Iv3i00blR8SKpaztc9o55Q` and `tEBIs5UST6iy7sH9Aax-fw`. The dedicated account’s ledger recorded 731 µUSD for the success and `upstream_400` for the rejection. Its failure row had no billed amount. The ledger correlation uses the isolated account, timestamps and matching success usage. [Redacted production and local receipts](receipts.json)

The signed application test connected Keating’s Flue draft gate to the browser account adapter and the patched Not Organic router in a single turn. A local test authority performed one PKCE exchange and the router verified a distinct DPoP proof on each of the 11 judgement requests. Jev rejected the dense history, then the application recovered automatically. Two live Gemini drafts overlapped for 1,027 ms, Jev compared them, and the learner received the correct answer. [Signed application receipts](receipts.json)

## The learner’s screen

Chromium sent a question through the normal composer in an isolated local chat with four seeded synthetic messages. The learner asked for two things in one sentence: the earlier workshop code and the perimeter of a rectangle with sides 7 and 5. The final answer gave **SAGE-C291B1B0** and **24**. After an offline reload, Chromium restored the identical assistant text and review receipt from storage, with zero new provider calls. [Reloaded chat screenshot](learner-chat.png) · [Chromium receipt](receipts.json)

The captured build labelled the turn “Requested part still open.” Both requested items appear in the published sentence. The receipt records that Jev selected draft 1, an addition was attempted and the opening answer was kept. The local progress view now describes that outcome as “Opening answer kept.” The original screenshot preserves what the learner actually saw.

The two code changes were tested locally against real providers. The production observations describe the deployments serving traffic during the test.
