# When a learner wants to try it themselves

November 18, 2026. On a released Keating 4.2.0 harness, two tutors each drafted an interface on seven of eight opportunities. The Gemini tutor released seven and MiniMax released three. On the four MiniMax turns that lost a compiled control, counting successful generation alone would have hidden the problem. Across 40 natural requests to act in earlier scripted episodes, six got a matching interface on the next reply and one on the reply after that. The remaining 33 reached the end of observation without a match. Production telemetry could not establish how often this happens to real learners. [Original investigation](../REPORT.md) · [Turn-level inspector](../diagnostics.html) · [Fable’s field guide](../index.html)

## Does a decision model help?

Across the original 16 opportunities, the selected controls were seven Questions, two Simulations and one CodingChallenge. Nine of the 16 replies matched the learner’s activity and requested language. Where Jev had offered a specific family, the learner-facing reply used it on three of nine opportunities. On the four separate requests for a short text answer, both tutors gave the requested text on every turn. [Original outcomes](../REPORT.md)

On eight paired, observable first drafts, the November component suggestion produced the same rate of valid interfaces with or without the suggestion (4/8). The offered family appeared in three drafts with the suggestion and four without. A historical September comparison of the full instruction found a valid surface on 6/14 matched cases with Jev and 9/14 with the compact baseline. Two of the losses were reasonable prose responses. These comparisons give little reason to make every offer compulsory. The application keeps the general decision as advice, lets specific grounded intent guide the family, and uses independent checks for a bad release. The evidence does not establish a better default decision provider. [Paired studies](../diagnostics-followup.md) · [Both decision providers on the same tutors](../gemini-decision/REPORT.md)

## What changed on the same saved answers?

| Observation | Before | After |
|---|---|---|
| Six learner intents, identical planning requests for both decision models | Jev met 6/6 and Gemini Decision met 5/6. Gemini lost the printer simulation after the learner declined a quiz. | Both met 6/6. Grounded variable exploration can survive the broad learning classifier. Plain replies and ordinary account help still suppress teaching controls. |
| Correct direct answer `16.` | Jev released it. Gemini withheld it as a leaked answer with probability 0.73747. | Both release it. The gate retains the probability and checks whether there was a checkpoint to leak. Eighteen separate saved reviews kept their original dispositions and blockers. |
| Python repair requested | A Gemini tutor draft substituted a JavaScript CodingChallenge for an exercise in Python. | A deterministic replay caught the substitution. A supplied Python repair rendered an editable block and one Question. Live notebook execution was outside this study. |
| Two bus simulations | The opening axes were extra riders and average load factor. | Both open on buses per hour. A valid saved learner selection survives reopening. Reset restores the authored starting view. |

The two graph repairs use the tutor’s original programs. One author chose unoccupied seats as its main readout. That choice is visible in the showcase. A cloud code block also now refreshes a queued run by its existing ID. In two local transport tests, a timeout and a polling error each produced one submission, followed only by requests for its status. [Try the cases](preview/index.html)

## Independent comparison on policy v2.2

Six new learner prompts were fixed in advance. Jev and Gemini Decision each planned all six using the same web context. Four cells included actual MiniMax M2.7 Highspeed generation, six ended at planning, and two reviewed a deliberately fixed answer. None involved a learner account. [Case definitions and scoring rules](cohort.json) · [Twelve results](summary.json) · [Four generated turns](turns.json)

| Learner’s request | Jev decision | Gemini Decision |
|---|---|---|
| Just the octagon’s perimeter | Released “24 centimetres.” on draft one. | Released “24 cm” after two drafts, with an unverified badge. Its assessed-work score remained uncertain at 0.5704. |
| Vary conveyor speed, skip test questions | Offered a Simulation. MiniMax requested a native page and separately requested a learner goal. Nine words accompanied the requests. | Offered a Simulation. MiniMax selected a fenced simulation on draft two. It included 143 surrounding words and asked for a prediction before touching the slider. |
| Change the number of seats on an account | No teaching interface offered. | No teaching interface offered. |
| Explore rectangle area on the first turn | Offered a Simulation. | Offered a Simulation. |
| Explain a relationship in plain text | No interface offered. | No interface offered. |
| Give a hint on an active multiplication exercise | Withheld the planted answer `63.` | Withheld the same planted answer. |

Both planners offered a simulation on both exploration cases and avoided offering an interface on both plain or non-teaching planning controls. On the only exploration prompt with live generation, one of two replies selected fenced OpenUI, one of two requested a native page, and neither requested both. Provider collection stopped before tool execution. The standalone showcase exercises the original native payload and the fenced simulation separately in the browser. The probability of a learner seeing or using a control in production remains unknown. [Inspect the generated replies](../diagnostics.html?source=revised) · [Offline classroom replay](preview/index.html)

The full study through v2.2 accounts for at most US$1.733468526. This six-prompt extension used 25 provider requests and added US$0.089736270. The ledger charges cache tokens at the declared full input price and retains a reservation when usage is missing. A provider invoice may differ. The earlier study accounts for US$1.643732256. [Cumulative accounting](summary.json) · [Jev pricing](https://docs.typesafe.ai/models) · [Gemini Decision pricing](https://aistudio.google.com/docs/pricing#gemini-decision) · [MiniMax pricing](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise)

## Final policy and the learner’s first action

The conveyor exposed a difference between “a slider exists” and “the learner can explore on their terms.” Policy v2.3 removes a clearly imposed prediction from an optional simulation brief when the learner has declined assessment. The gate reviews the edited reply before release. Replaying the exact conveyor text removed 164 characters while preserving the two sliders, formulas and subsequent instructions. An unavailable review withheld the edited reply in the replay. Across six saved plans, the new policy removed six unsolicited goal instructions and two inapplicable pacing instructions, with every prior interface offer preserved. [Matched replay and proof boundary](../policy-v2.3-replay/README.md)

The classroom can put a completed, standalone simulation first when the learner wants to operate it and the reply leads with several paragraphs. **Read the explanation** retains that lead text. On the exact conveyor reply, the top of the control moved from 443 to 115 pixels below the start of the reply on desktop and from 544 to 147 on mobile. When the learner asked for an explanation or the prose contained cautionary instructions, the authored order was preserved. This is a change in what is initially visible. The original reply still contains 143 words outside the simulation.

Two more preregistered scenarios then ran through v2.3 with MiniMax as tutor and each decision provider. [Frozen cases](../policy-v2.3/cohort.json) · [Final dispatch and selection record](../policy-v2.3-completion/summary.json) · [Explore all four outcomes](preview/index.html#later)

| Final-policy scenario | Jev decision | Gemini Decision |
|---|---|---|
| Adjust a bottle-filling rate for eight minutes, with no predictions or check questions | Released a working slider on draft one. At 5 and 7.5 bottles per minute it displayed 40 and 60 bottles, with 57 words outside the control. No goal tool or compulsory question. | Offered a simulation. MiniMax timed out after 60 seconds, before the harness received a response or usage. Final output unknown. |
| Edit a buggy Python loop and find the fix | Released an editable Python fence on draft two. The loop prints the three items and then raises `IndexError`. | Released an editable Python fence on draft two. The sum prints 9 instead of 13. Its inline comment gives away the location of the bug. |

Three of four scheduled cells returned tutor content. All three gave the learner the requested action. One used fenced OpenUI, and two used the ordinary Markdown editor. Of two scheduled filling cases, one delivered a working control and the other had no observable tutor result. Of two Python cases, both delivered editable Python and neither substituted a JavaScript challenge. Both were edited and reset in Chromium. A separate local interpreter check reproduced each bug and its repair. No cloud notebook was started. These tiny counts describe the examples above. [Local browser evidence](preview/browser-results.json) · [Python check](../policy-v2.3-completion/check-python.py) · [Scoring notes](../policy-v2.3-completion/adjudication.json)

Counting everything outside an OpenUI fence would give the Python replies 24 and 26 words. The code itself accounts for much of that count. The separate editor measure counts ten words of surrounding instruction on the Jev-guided reply and zero on the Gemini-guided reply. [Portable final turns](../policy-v2.3-completion/turns.json)

Jev’s original Python plan said no supported family and simultaneously instructed the tutor to provide OpenUI practice and capture a goal. MiniMax still supplied the right editor. A post-hoc v2.3.1 replay of the two saved provider answers raised explicit Python-editor guidance from 1/2 tutor prompts to 2/2. Generic OpenUI practice and goal capture each fell from 1/2 to zero. This replay stopped at the tutor prompt and generated no new delivery-rate estimate. [Exact decision replay](../policy-v2.3.1-replay/README.md)

The synthetic native conveyor contains another instructive failure. It gives correct numerical totals, yet its twelve illustrated cartons occupy the same 32-pixel box at both tested speeds. The sandbox runs, the slider works, and the promised moving illustration does not communicate a change. The showcase retains that output. The authoring guide now asks for distinct object positions and an observable change at two settings, including under reduced motion. Its effect on a newly generated page remains unmeasured. [Browser checks and measured bounds](preview/browser-results.json)

Through the last tutor generation, the cost bound was US$1.912935216. The original filling timeout retained its entire US$0.12 reservation. The first run stopped before either Python tutor request left the harness. Only those two cells continued, reusing their original plans. The completion ledger includes the first seven entries exactly once. [Completion protocol](../policy-v2.3-completion/protocol.json) · [Tutor generation cost and status](../policy-v2.3-completion/summary.json)

## Could the learner use the editor to find a bug?

Fable identified a working editor whose starting input already produced the correct result, and another that pointed at the line the learner wanted to find. We asked Jev and Gemini Decision to review the four original MiniMax Python drafts, using the actual application review request from each turn. Each reviewer matched three of four reference judgments about observable bugs and three of four about hints or solutions. Both found the clue beside the faulty sum. Both missed that the original even-number loop produced the right output, and both overlooked the exact diagnosis in its native page description. Local Python reproduced all four outcomes. [Exercise review and evidence](../policy-v2.3.2-review/README.md)

The eight decision reviews added US$0.004183064. **The total upper bound across all studies was US$1.91711828 of the US$2 authorization**, including the earlier timeout reservation. [Final cost and decision scores](../policy-v2.3.2-review/summary.json)

The final local policy treats the requested degree of independence as part of the task. It can establish the output of a narrowly defined even- or odd-number collector by inspecting its literal input. On the original five-number starter it confirms the input masks the fault. Although other native-page inputs are unknown, the page’s loading description independently gives away the exact diagnosis and blocks that draft. The original gate had already withheld it for an empty OpenUI fence. The other three original programs are outside the static check. No new tutor delivery rate was measured under this last change. [Checks and release outcomes](../policy-v2.3.3-proof/README.md)

## Reproduce an incident

In Chat, open **Settings → Diagnostics → Interface use**. Select a recording or the current browser, then filter by tutor, decision model and cue. **Missed learner cue** identifies turns where the requested family failed to appear. Inspect an individual turn to read what the planner offered, what compiled privately, what survived selection and what the browser could confirm. The same observations are available through the CLI and `keating://openui-diagnostics`. The operator guide defines coverage, family match, elapsed time and how pending observations are treated. [Operator guide](../openui-diagnostics.md) · [Open Settings in the offline inspector](../diagnostics.html)

From the repository root these commands replay saved evidence without credentials or new requests.

```sh
rtk bun docs/benchmarks/openui-audit-2026-11-18/verify-historical.mjs
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.2/verify.mjs
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.3/verify.mjs
rtk bun docs/benchmarks/openui-audit-2026-11-18/policy-v2.3.2-review/review.mjs --verify
rtk python3 -I -S docs/benchmarks/openui-audit-2026-11-18/policy-v2.3-completion/check-python.py
rtk bun src/cli/main.ts openui-diagnostics docs/benchmarks/openui-audit-2026-11-18/policy-v2.2/turns.json --cue implicit-action --view unmet
```

The v2.2 verifier restores the studied policy and checks the original request digests, the provider decisions, all 12 receipts and the accumulated cost. The web app timestamped private repair messages. Replay recovers the original timestamp against the original hash. Results describe these synthetic prompts and recorded replies. Neither retention nor transfer was measured.

An older teaching release test also depended on source files that have changed since November 11. Its verifier now checks the 171 files recorded in the original v1.1 release. The archived checker successfully executed a Question action and rejected a prose-only response to the same contract. The live checker still detects source drift. Five release tests and twelve training benchmark tests passed. The original inventory lacks seven lazy speech imports, which limits reconstruction of its full dependency bundle.
