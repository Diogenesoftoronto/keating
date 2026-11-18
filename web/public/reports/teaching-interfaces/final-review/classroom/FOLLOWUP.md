# When the learner asks “Did I get that right?”

The learner typed “My guess is four layers, because the second fold doubles the two layers. Did I get that right?” after a real, released answer to the paper-fold problem. **One of four guided cells released feedback; three withheld it.** Each had the original learner message and public tutor reply in its model history. Each had zero saved quiz or comprehension submissions. All four plans recognized a learner attempt and simultaneously marked another learner response as due. Three plans offered a new Question and Simulation. [Preregistered follow-up](../study/cohort.json) · [Per-attempt evidence](followup.json)

| Tutor | Decision model | Original reply | What happened on confirmation |
| --- | --- | --- | --- |
| Gemini 3.1 Flash-Lite | Gemini Decision 1 | Prose | The first draft confirmed four, explained doubling and asked about a third fold. It passed and was released. [Receipt](../study/receipts/paper-followup--flash--google.json) |
| Gemini 3.1 Flash-Lite | Jev 1.14.0 | Question group | All three drafts opened with the correct confirmation. The first two incurred critical mastery-overclaim findings. The third appended a fresh question about a third fold and received answer-leak and noninteractive-checkpoint findings. No draft called a grader. [Receipt](../study/receipts/paper-followup--flash--jev.json) |
| MiniMax M2.7 Highspeed | Gemini Decision 1 | Question group | Both first drafts called the grading tool with no matching submission. The recovery draft gave the correct confirmation in prose. Its answer-leak finding was uncertain and its scope score failed. The gate withheld it. [Receipt](../study/receipts/paper-followup--minimax--google.json) |
| MiniMax M2.7 Highspeed | Jev 1.14.0 | Prose | Draft 1 proposed grading an unsaved submission. Draft 2 introduced another question group and had unresolved assessment and transport findings. Draft 3 plainly confirmed four layers but received a failing answer-leak finding. The gate withheld all three. [Receipt](../study/receipts/paper-followup--minimax--jev.json) |

### An advertised tool could never succeed

Seven of the ten actual tutor requests advertised both grading tools in their wire payloads. The other three were already text-only recovery attempts. MiniMax used `grade_question_checks` in three drafts. Replaying the original ten candidate tool lists against the original turns reproduced all ten deterministic `grading_requires_submission` statuses, including the three failures. Both rejected MiniMax tool paths originated from ordinary typed confirmations. One preceding tutor reply had a rendered-capable question group. The other had asked a prose question. [Wire-level comparison](followup.json)

The web harness now shares its record check between the planning projection, the schema list sent to each private tutor draft and the schema validation applied before release. On these ten saved requests the filter permits **zero grading schemas**, while preserving the original grading decisions and all other tool permissions. This is a counterfactual schema comparison on recorded inputs. Different generations and changes to release frequency require another study. The two Flash cells had no attempted grading calls; their difference concerns review and follow-up behavior. [Browser gate](../../quality-checks/draft-gate.ts.txt) · [Shared policy](../../quality-checks/teaching-policy.ts.txt)

### A submitted control has a different record

In an independent offline classroom run, Playwright selected “4” in the authentic Jev-guided paper-fold question and clicked **Finish check**. The app materialized a comprehension record. Its normal startup-evidence projection found one pending submission with the exact topic and question. A verifier supplied the predefined verdict “correct” to the real local `grade_question_checks` tool. The stored score became 1 and the pending count fell to zero. The storage layer labels a result produced through this tool `model`; here the verdict came from the verifier with zero model calls. The separate original classroom trace captured submission and cancelled further generation. [Deterministic grading record](recorded-question/deterministic-grading.json) · [Original classroom trace](recorded-question/settings-export.json)

To recompute the wire comparison locally, run the first command below. To repeat the independent browser grading check, use the restored checkout described in the classroom method. [Classroom method](README.md)

```sh
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/followup.mjs
rtk proxy bun docs/benchmarks/openui-audit-2026-11-18/final-review/classroom/run.mjs --product /path/to/restored-checkout --id paper-fold--flash--jev --out /tmp/keating-graded-fold-replay --demonstrate-grade
```
