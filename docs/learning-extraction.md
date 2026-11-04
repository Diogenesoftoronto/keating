# Grounded learning extraction and forecasts

The web teacher can extract exact learner reasoning, taught passages, explicit study constraints, memory candidates, and unresolved questions after a completed turn. Enable **Learning extraction and forecasts** in **Settings → Diagnostics → Advanced: technical logs and session inspector**, then connect an account with `extraction:run` permission. This is a separate opt-in from diagnostic capture and from durable memory admission.

Requests use the existing Not Organic public account client, DPoP, idempotency keys and per-request spending ceiling. There is no browser provider credential or direct Cloudflare fallback. Work is bounded to the latest learner and teacher text messages (12,000 characters per message), twelve fields per request, four requests per minute per account in the current browser runtime, an eight-second deadline, and a 128 KiB response. Unavailable, unauthorized, credit, timeout and malformed-response outcomes remain visible in enabled diagnostics without blocking the teacher.

## Source evidence and memory

Every accepted quote must reconstruct an exact UTF-16 slice of the original source. Its session, message identity, full-message revision fingerprint and offsets travel together. Missing, ambiguous, edited and deleted sources fail closed. Model guesses never become exact citations. This does not verify the truth of a quoted lesson claim or the correctness of a learner answer.

Derived evidence is stored locally in a bounded cache for that conversation and account session. The next teacher turn rechecks the live and saved source before adding evidence to its context. No new portable learner-data schema or cross-device upload is introduced. Turning the feature off clears the active conversation's derived cache. Extracted memory candidates pass through the existing independently enabled, calibrated memory admission path; extraction cannot directly change the learner profile or durable memory bank.

## Forecast semantics

Clairic proposals complement the existing validated TabPFN predictions. They do not replace accepted online-learning receipts or the shared SM-2 scheduler.

- Next-answer series contain saved graded question scores, excluding pending, malformed and future records.
- Recall series contain one card's original self-reported 0–3 ratings, actual elapsed review gaps, separately labeled planned intervals, and the current scheduled due date. Ratings are not objective mastery observations.
- A numeric next-step forecast requires at least eight distinct outcomes over time. Sparse histories stay unknown. Only complete, finite, ordered `p10 ≤ median ≤ p90` intervals within the requested scale are accepted.
- Important questions must be exact questions present in learner or lesson text. Recorded topic difficulty is associated only through an exact saved-question match. This is not a prediction of exam content.
- Forecasts are labeled unvalidated proposals, carry the historical median baseline, and never write grades, mastery or review schedules. History, account, source or preference changes invalidate late results. Context reuse rechecks history and expires after fifteen minutes.

## Diagnostics and source navigation

Turn on diagnostic capture to inspect extraction, forecast and memory-review operations. Enable details to retain exact passage links for subsequent operations. Quote previews redact recognized credentials and email addresses; opening a source intentionally displays the learner's own original passage. Capture and detail revocation erase the ephemeral quote buffer and open source disclosure.

**Open original passage** verifies the source before and after a conversation switch, closes Settings, and focuses the exact highlighted text in a bounded original-source disclosure inside its message. A source in the active conversation does not reload it. A cross-conversation jump waits for the current reply to finish rather than cancelling it. Missing, stale or ambiguous sources do not navigate. The disclosure handles raw Markdown/OpenUI source explicitly instead of pretending rendered offsets equal source offsets.

Focused verification uses deterministic injected extraction outcomes and local histories. It does not establish live paid provider fulfillment, calibrated learning predictions, long-term learning effectiveness, or native-client UI support. Shared grounding and forecast contracts remain portable to other clients.

## Judgements by turn and reviewer corrections

With diagnostic capture on, the chat inspector lists recent turns, newest first. Each turn shows its judgements in the order they ran: planning, every draft and its checks, which draft was released, the completed-reply review, extracted passages from the learner message and the tutor reply, and memory admission decisions. Checks have plain-language names (from the policy catalog in `web/src/keating/judgement/check-descriptions.ts`). Flagged checks come first, each with its P(violation) against the 0.20 pass line. The raw call list is still available under **All judgement calls (raw)**.

**Save judgements for review** (Settings → Diagnostics) keeps each turn's record (`turn-judgements` store), including exact extracted passages and memory candidates, so the review view can show it beside the transcript. Draft check results are already kept in the draft receipts and are not duplicated. Records stay on this device and are deleted with their conversation. **Delete saved judgement records** removes all of them, together with reviewer labels.

In the review view a reviewer can correct two kinds of judgement:

- **Draft checks:** mark a check *Violation present* or *No violation*, with an optional note. This is a label only. The released reply and recorded grades never change.
- **Memory admission:** *Remove from memory* or *Admit to memory* with a category. This changes the memory bank that later turns read. A removal also stops the model from re-admitting that passage. A reviewer admission appears in the tutor's memory context as `source: "reviewer"`, and only while its original learner message is unchanged. Corrections apply only to the account the memory belongs to. If a different account is signed in, the label is saved, marked as waiting for its account, and applied the next time the review opens with that account. *Undo my decision* hands the decision back to the model; a proxy memory that was removed is not restored.

The review export adds `data/judgement/turn-judgements.jsonl` and `data/judgement/human-labels.jsonl`. Each label row puts the reviewer's verdict beside the model's output, the check question and the judge model. For the released draft it also includes the learner message and reply text, so the labels can serve as calibration or evaluation data. Rejected drafts are never stored, so their labels carry no reply text.
