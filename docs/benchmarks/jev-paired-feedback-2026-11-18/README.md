# Four private tutor replies on five classroom turns

Keating released useful replies on four of five synthetic learner turns. The correct answer to an open Question, previously withheld, received confirmation. An incorrect answer to the same Question received a correction. Two learners implicitly invited an interface. One got a working Simulation. The other saw “Couldn't produce a reply” even though MiniMax had written three Question cards. [Registered prompts and expectations](protocol.json) · [All results](summary.json)

| Learner turn | What reached the learner | Composer to reply | Four tutor calls overlapped | Two Jev pair calls overlapped |
| --- | --- | ---: | ---: | ---: |
| Correct tile answer | Confirmed round was more likely, 3/4 or 75%. The existing Question stayed on screen. | 13.81 s | 2,483 ms | 90 ms |
| Copper symbol only | **Cu**, with no additional text or activity. | 6.06 s | 1,304 ms | 52 ms |
| Incorrect tile answer | Explained that dropping the square in first does not change the odds, 1/4 square versus 3/4 round. | 11.45 s | 1,439 ms | 75 ms |
| Vary a toy train’s speed | A Simulation with a speed slider and two readouts. Changing 3 to 3.5 m/s changed distance from 24 to 28 m at a constant 8 seconds. | 15.87 s | 4,938 ms | 52 ms |
| Guess the paper layers before the explanation | The classroom displayed its withheld-reply notice. No Question mounted for the learner to answer. | 13.88 s | 4,392 ms | 49 ms |

The timing columns use the browser composer and the actual provider HTTP request intervals. The gate’s own two-review windows overlapped by 210, 148, 186, 133 and 151 ms respectively, including local orchestration. The observer recorded five distinct conversations and ten compared pairs. The sample was chosen to test particular behaviours. It does not estimate production prevalence or student learning. [Content-free Settings export](settings-export.json)

## When a learner answers an existing Question

The browser mounted an actual previously generated tile-bag Question before each typed answer and verified that no form answer was pending. On both turns Jev classified the new message as feedback on the open Question. Slots 1 and 3 received different instructions for giving direct feedback, with zero tools on their actual MiniMax requests. Slots 2 and 4 each retained ten tools. All four tutor requests had different request-body hashes in each of the five cases. [Correct-answer receipt](typed-tile-answer.json) · [Incorrect-answer receipt](wrong-tile-answer.json)

For the correct answer, only slots 1 and 3 passed. Jev preferred them in their pairs and the final choice selected slot 1. For the wrong answer, only slot 1 passed. In the earlier four-draft run both pairs rejected every option on the identical correct answer. Copper stayed at one word across the two runs. [Earlier comparison](../jev-parallel-pairs-2026-11-18/summary.json) · [Correct-answer screenshot](typed-tile-answer-classroom.png) · [Incorrect-answer screenshot](wrong-tile-answer-classroom.png) · [Copper screenshot](copper-symbol-classroom.png)

## The two implicit interface opportunities

The train learner asked to change speed and see distance immediately. The observer recorded Jev recommending a Simulation, the tutor compiling one and the renderer mounting it. The browser moved the slider by keyboard and read the two sets of numbers from the actual DOM. It found zero Question controls, consistent with the learner’s request to skip a quiz. [Before](toy-train-classroom.png) · [After moving the slider](toy-train-after-action.png) · [Control measurements](toy-train.json)

The paper learner wanted to guess before being told. Jev recommended a Question and Simulation. Three private replies contained OpenUI Questions and the other proposed a native page. In the first pair, draft 1’s Question passed compilation, checkpoint-count and final-node checks. Its uncertain scores for a missing direct answer (0.55), an answer leak (0.42) and a repeated checkpoint (0.50) left it ineligible. Draft 3 added a profile write after the Question and failed the stop check. Draft 4 received a 0.87 repetition finding. Both pairs preferred an authored Question and neither had an eligible finalist. The observer recorded a compiled Question group and zero selected or rendered components. The earlier identical prompt produced a prose question. [Withheld classroom](paper-fold-classroom.png) · [New receipt and checks](paper-fold.json) · [Earlier response](../openui-audit-2026-11-18/final-review/study/receipts/paper-fold--minimax--jev.json)

## Reproduce the inspection

This November 18, 2026 run used the release worktree’s web gate, actual Flue composer, Chromium renderer and Settings export with the configured MiniMax M2.7 Highspeed tutor and Jev 1.14.0. The host supplied a single paid learner turn per conversation. The ledger identifies the starting Git commit and the exact SHA-256 digest of 115 source files. The 57 successful, metered requests covered 20 tutor generations, 5 plans, 20 individual reviews, 10 pair choices and 2 final choices. Provider usage at the recorded rates accounted for **$0.209360628** against a **$1.25** phase ceiling. The cumulative study bound reached **$3.070723792** of **$10**. Invoice totals and production traffic were outside this measurement. [Request and cost ledger](ledger.json) · [MiniMax rates](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise) · [TypeSafe models](https://docs.typesafe.ai/models)

Open the JSON export in Settings, or run the CLI from the repository root to see the two pairs, eligible candidates, selected reply and timing. The verifier checks the archived wire digests, matches the individual review inputs to both pair offers, compares the published response to the selected candidate, and passes the real Settings export through the normal CLI. Both commands operate offline.

~~~sh
rtk bun src/cli/main.ts openui-diagnostics docs/benchmarks/jev-paired-feedback-2026-11-18/settings-export.json --view pair-reviews --limit 10
rtk bun scripts/openui-diagnostics/probe-jev-pairs.mjs --verify docs/benchmarks/jev-paired-feedback-2026-11-18
~~~
