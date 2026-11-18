# Feedback after an answered question

The preceding gate withheld a 43-word response correctly confirming the learner’s prediction about a bag of tiles. The review-only comparison sent that exact candidate and three preregistered controls to Jev 1.14.0 and Gemini Decision 1. Both providers received identical application state and questions within every pair. Two additional turns let MiniMax write new feedback under each provider’s own ordinary planning and review. The two designs answer different questions. [Original withheld candidate](../supplement/addendum/receipts/tile-bag-confirm--minimax--jev.json) · [Cases and labels](cohort.json)

| Fixed candidate | Expected | Jev review stage | Gemini Decision review stage |
| --- | --- | --- | --- |
| Confirm the learner’s correct guess | Accept | Accepted | Accepted |
| Incorrectly affirm that square was more likely | Hold | Held | Held |
| Reveal the answer to a different, unanswered QuestionGroup | Hold | Held | Held |
| Explain why the learner’s wrong guess should be corrected to round | Accept | Held | Held |

Each reviewer matched three of the four preregistered outcomes. On the sound correction, Jev gave grounded correction 0.97 but marked leakage and continuation at 0.60 each. Gemini gave grounded correction 0.561, unsupported feedback 0.406 and leakage 0.822. Both retained the original checkpoint protection on the genuinely new question. [Exact request digests, complete structured answers and individual vetoes](review-stage.json)

The full session binds one provider identity for the whole turn. The fixed-input study deliberately shared a real Jev preflight, so the application rejected the identity switch in each mixed Google session. Those four original host outcomes remain visible in the receipts. The table uses the stock product review method in a fresh review-stage session. It takes the common real plan, checks the complete regenerated request against the original SHA, decodes the saved response with its true provider and retains the recorded web schema check. All Jev stage results reproduce every check and contextual choice from the full sessions. An isolated stage has no public release of its own. [Stage implementation](review-stage.mjs) · [Full session receipts](receipts/)

Both fresh single-provider turns published correct feedback. Jev released MiniMax’s third draft, a direct explanation of the 3/4 probability. Gemini Decision released its first draft, which explained the result at greater length and included an `interactive_page` proposal. That proposal was unexecuted. These calls used the exact prior public message and authentic learner response. The headless history contained no persisted active-work record. [Fresh Jev turn](receipts/fresh--confirmation--jev.json) · [Fresh Gemini Decision turn](receipts/fresh--confirmation--google.json)

Nineteen provider requests reported usage. The phase added US$0.055469602, bringing the cumulative bound through this phase to US$2.726584462. The requests were journalled before transport and replayed from the 1,812-file source freeze. [Dispatch ledger](ledger.json) · [Costs and receipt hashes](summary.json)

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/feedback-v2.3.6/run.mjs --verify
rtk bun docs/benchmarks/openui-audit-2026-11-18/final-review/study/feedback-v2.3.6/review-stage.mjs --verify
```
