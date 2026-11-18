# The Python editor offer

One learner asked for a short Python loop with a bug they could fix themselves. MiniMax M2.7 Highspeed released an editable Python code block on both original runs. Jev guided one run and Gemini Decision guided the other. Neither selected reply contained a canonical OpenUI component. [Jev-guided reply](https://github.com/Diogenesoftoronto/keating/blob/main/docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-completion/receipts/python-practice--jev.json "Repository source online") · [Gemini-guided reply](https://github.com/Diogenesoftoronto/keating/blob/main/docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-completion/receipts/python-practice--google.json "Repository source online")

The v2.3.1 check replays the identical planning request and the two providers’ original answers. It captures the revised tutor prompt before generation.

| Recorded planning decision | v2.3 tutor instructions | v2.3.1 tutor instructions |
| --- | --- | --- |
| Jev 1.14.0 | Generic OpenUI practice and goal capture. No supported component or Python editor guidance. | Editable Python code block. The learner can work independently. |
| Gemini Decision 1 | Editable Python code block, with an optional OpenUI Question. | Editable Python code block, with an optional OpenUI Question. |

Jev gave hands-on practice a probability of 0.93 and the broader executable-code feature 0.51, inside the policy’s uncertainty band. The application can now recommend the named editor when the learner explicitly wants to edit their own Python exercise and planning confirms learning, practice and hands-on intent. Graded work, pending submissions and plain-answer requests retain their own handling. The code block’s execution still requires the hosted runner. [Paired probabilities, offers and prompt hashes](replay.json)

Explicit editor guidance rose from one of the two prompts to both. Generic OpenUI practice and goal capture fell from one each to zero. The two historical tutor replies already delivered Python. This post-hoc check generated no new tutor reply, so it supplies no new delivery-rate or execution result.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.3.1-replay/run.mjs --verify
```

The runner checks both native provider payload hashes and each saved public reply. It then enters the current application’s real draft session and stops at the tutor prompt. Incremental cost was US$0. [Offline runner](https://github.com/Diogenesoftoronto/keating/blob/main/docs/benchmarks/openui-audit-2026-11-18/policy-v2.3.1-replay/run.mjs "Repository source online")
