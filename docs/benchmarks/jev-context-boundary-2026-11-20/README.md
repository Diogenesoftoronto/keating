# Jev at the context limit

Live tests on November 20, 2026 found a production failure. Keating estimated the same 18,104 tokens for two 54,128-character review states. Jev read the final instruction correctly in the plain-English state. The state filled with synthetic notebook identifiers exceeded Jev’s context. The deployed Keating BYOK relay reported that the backend was unavailable. The deployed Not Organic account gateway returned HTTP 502.

The reverse error was also observable. The deployed relay accepted two untrimmed planning inputs that Keating estimated at 32,001 tokens. One contained four history messages. The other contained only the current message. Jev answered all 39 questions in each request. The earlier local implementation had discarded history in the first case and withheld the second. Railway matched the successful controls to `k3Fo9BXvRPeuSFGmo3UVLg` and `smLtvwp2SAKNc6jTBhdwDg`. [Control receipts](receipts.json)

The local fixes let hosted Jev confirm token fit at its advertised limits. Keating still enforces the transport’s hard byte and character limits and any explicitly smaller operator budget. On a model-confirmed overflow, Keating tries smaller question groups over identical history. If one question still exceeds capacity, it retries with an opening excerpt, recent whole turns and the intact current request. Each planning, draft-review and selection request gets its own window.

## What the original conversation recorded

The supplied ZIP had 12 turn-judgement rows. Eleven included a draft receipt. Seven of those receipts recorded a single attempt, three recorded two attempts and one recorded three. All 16 attempts were labelled `default` and none of the receipts recorded a parallel pair. Ten turns released a passing draft and one used the best-effort path. There were zero recorded context reductions and zero human judgement labels in this export. The live boundary cases below use separate synthetic conversations.

The local chat also rendered the ownership quotation from the archive. “Go to source” now uses the caption’s 14.3 px type and an inline underline. The control measured 31.2 px tall on desktop and retained a 44 px touch target. Keyboard activation highlighted the exact archived passage.

## Seven cases through the local Keating answer flow

The Flue host sent synthetic learner requests through Keating’s web draft gate, the local production-built Nitro BYOK relay, live Jev 1.14.0 and Gemini 3.1 Flash-Lite. The first four answerable cases each had two successful, overlapping tutor HTTP requests. Jev reviewed both candidates and chose between their exact text hashes. The Flue conversation history contained the workshop code and the correct perimeter of 24.

| Full planning estimate | Planning history Jev received | Tutor request overlap | Learner outcome |
| --- | --- | ---: | --- |
| 31,999 | All four messages | 1,011 ms | Correct answer |
| 32,000 | All four messages | 1,170 ms | Correct answer |
| 32,001 | All four messages | 656 ms | Correct answer |
| 32,001, current request alone | Entire current message | 893 ms | Correct answer |
| 18,104, dense identifiers in history | Full history rejected with 39 questions, then with one. Jev accepted an opening excerpt and the newest turn. | One tutor rate-limited | Correct answer from the completed draft |
| 18,104, dense current request alone | Jev rejected both the batch and a single question | — | Guidance to shorten the request. Zero tutor calls. |
| 96,001 state characters | Exceeded the gateway’s 96,000-character limit | — | Local notice. Zero network calls. |

The matrix used 34 provider requests with zero budget denials. Its two-draft check failed on the dense-history row because Google returned HTTP 429 to the second tutor. Keating still released the completed answer. For the four accepted controls around 32,000, subsequent draft reviews and selection kept the full history, too.

The dense-history case was then rerun on its own. Across all 13 requests, Jev rejected the original state with both 39 questions and one question, accepted the smaller window, reviewed both completed drafts, and selected the answer that appeared in the learner’s conversation. Both tutor requests returned HTTP 200 and overlapped for **2,465 ms**. All nine checks passed. [Separate run, timings and answer hashes](receipts.json)

An earlier test reservation also prevented two second drafts from being sent. The harness reported that run as failed and now checks real network overlap, both completed reviews, selection and delivery. The receipts preserve the operational 429 separately from the earlier reservation failures. [Application test](../../../web/scripts/jev-boundary-proof.ts) · [Request hashes, dispatch times and outcomes](receipts.json)

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

Chromium sent a question through the normal composer in an isolated local chat with four seeded synthetic messages. Both browser tests used real Jev and Gemini with external tools and web retrieval disabled. The learner asked for the earlier workshop code and the perimeter of a rectangle with sides 7 and 5 in one sentence. The final answer gave **SAGE-C291B1B0** and **24**. After an offline reload, Chromium restored the identical assistant text and review receipt from storage, with zero new provider calls. [Reloaded chat screenshot](learner-chat.png) · [Chromium receipt](receipts.json)

The captured build labelled the turn “Requested part still open.” Both requested items appear in the published sentence. The receipt records that Jev selected draft 1, an addition was attempted and the opening answer was kept. The local progress view now describes that outcome as “Opening answer kept.” The original screenshot preserves what the learner actually saw.

In a second Chromium session, Keating estimated **33,627 tokens** for the first review. Jev returned HTTP 200 for all 39 questions over the complete history and current message. All four authored history messages matched the originals in planning, both draft reviews and selection. The selected, stored and offline-restored answer had the same SHA-256. It read “The perimeter of a rectangle with sides 7 and 5 is 24, as calculated for workshop SAGE-4E924372.” The browser restored the conversation and all 58 check results with zero new provider calls. [Full-history chat after offline reload](full-history-chat.png) · [Chromium proof](../../../web/scripts/jev-boundary-browser.ts)

The only failed review check in that session was `requested_part_missing`. Jev assigned it probability 0.86 even though the answer included both the code and perimeter. Keating showed the selected answer while it tried an addition. The resulting addition did not pass through review and the stored answer stayed intact. The screenshot and receipt record the outcome before any further reviewer tuning. [Per-check scores and answer hashes](receipts.json)

## The relay byte limit

With an isolated upstream, the local Nitro relay accepted exactly 262,144 UTF-8 request bytes and returned HTTP 413 at 262,145. A separate web-gate test preserved an 86,000-character Chinese-language history by dividing the questions across requests. A protected current message too large to fit on its own caused zero provider dispatches. [Relay boundary test](../../../web/src/test/judgement-typesafe-relay.test.ts) · [Web draft gate tests](../../../web/src/test/draft-gate.test.ts)

The gateway build, repository TypeScript check and all 707 gateway tests passed locally. The production observations describe the deployments serving traffic during the test.
