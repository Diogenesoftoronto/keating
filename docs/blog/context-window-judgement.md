# When a perfect score stops being useful

The subject-routing result in *A Measure of Machine Judgement* was a real 18-out-of-18 result on a small authored set. It was not evidence that Jev can judge every teaching response correctly. A later 17-out-of-18 run used different abstention instructions. Those runs should remain separate, with their prompts and receipts, rather than selecting the better number as a general capability claim.

The next benchmark asks a different question: can a verifier apply several rules to recorded evidence, recognize when that evidence is incomplete, and spot concrete failures in a tutor's proposed response? It also tests a practical failure mode in Keating: what happens when the evidence falls out of the conversation window?

## The evidence has to survive

The September 24 OpenCode proposal called for a context-size experiment and a visible state inspector. The implementation now records the size of each judgement-state section, its estimated context fill, the window evictions, and the lesson state that remains pinned. The inspector shows these counts during review and after release without exposing draft contents.

Keating's current window starts removing old complete conversation turns at 80% of its estimated 32,000-token budget and aims for 65%. It does not summarize them. Active lesson state, pending submissions, recorded tool results, and learner evidence sit outside that conversation eviction.

The audit found a defect in preflight: it kept testing the original request after removing each turn, so an oversized request could empty the whole conversation. Preflight now rebuilds the request after every removal. A regression test verifies that a useful recent suffix survives.

A context benchmark must distinguish loss from reasoning. If the only test result was evicted, “insufficient context” can be the correct answer to the visible request. We therefore report both correctness against the remaining evidence and agreement with the original full-context answer. A fluent guess should not get credit for retrieving evidence it never received.

## Harder, without engineering a winner

The suite retains 12 easy control claims and adds 36 harder claims across 18 families. These require revision precedence, exact entity matching, exceptions, arithmetic, unit conversion, deduplication, directed reachability and ambiguity handling. Labels are computed from the records. Both family splits balance supported, contradicted and insufficient-context answers.

Each context case can run at seven fill levels, in three evidence positions, with and without the actual production window. This expands coverage; it does not multiply the number of independent reasoning tasks. Repetitions measure response variability, while new independently authored families measure breadth.

A good evaluation should have room above and below the models it compares. If easy controls reach100%, keep them as controls and add harder tasks under a new version. Do not alter labels or select examples to make a preferred ranking appear. Larger models doing better is a testable expectation. Comparing systems with different training objectives, encoders, context limits and inference effort does not by itself test a scaling law.

## Real replies, narrow labels

The importer also reads saved completed Keating generations and recomputes executable gates. It excludes 147 smoke receipts and 90 failed or incomplete generations. The usable corpus contains 363 candidate/gate questions but only 5 violations:3 malformed UI outputs and 2 replies that continued after a checkpoint.

That imbalance matters. A verifier that always says “no violation” scores 98.62%. The report therefore shows violation recall, clean-case recall, balanced accuracy and raw prevalence. These gates establish narrow contract failures; they do not establish factual teaching quality or learning outcomes. Old Jev opinions are not reused as independent labels.

The live pilot intentionally selects the four saved groups containing both clean and faulty replies. It is enriched for failures so recognition can be observed. Its accuracy is not an estimate of natural production prevalence.

## Adding CLM

[CLM](https://github.com/contrastive-lm/clm) supplies the same typed judgement interface through a contrastive head over a Qwen3-8B pooling encoder. The head, encoder, source and runtime are recorded separately. The released head alone is not the complete inference model.

One upstream default would invalidate a long-context comparison: the embedding client truncates to 2,048 tokens. The trial explicitly disables that truncation and configures the encoder for 32,768 tokens. Requests beyond the supported limit must produce visible errors rather than silently lose their evidence.

Jev and CLM receive the same state and typed criteria. Astra receives those same observations and questions through the direct OpenAI Responses API with high reasoning effort and a bounded output budget. Its answers are reference opinions. Only the authored or executable label sources define correctness.

## Reproducibility

The local plan fixes 31 requests per model: 18 balanced harder claims, six 90%-fill window probes, three authored selection controls and four mixed-class saved rollout groups. It records exact request hashes before inference. The ceiling is 120 calls and 1.1 million estimated input tokens, with one repetition and no retries or fallback substitutions. This is a feasibility pilot, not the full context grid or a stable model leaderboard.

Every scheduled request remains in the report, including provider failures and rows stopped by a budget. Interrupted runs retain missing rows. Replay matches trial identity, request hash and repetition. It cannot swap different outcomes between full and windowed cells that happen to send identical requests.

Review caught and repaired a benchmark-specific bug before the scored run: structured evidence containing quotes was falsely classified as absent by a serialized substring check. A semantic check and regression test now keep those answer keys intact. The superseded unexecuted plan remains local; the corrected plan is frozen separately.

Run instructions and measurement definitions are in [the benchmark README](../../scripts/context-window/README.md). The standalone HTML report filters by model, task, label source, split, evidence placement and window path. Raw learner text stays in private local receipts.

## What the live trial found

All 93 planned requests completed with the exact configured models: Jev 1.13.0, CLM's released head with its pinned Qwen3-8B encoder, and GPT-6 Astra at high reasoning effort. A separate 54-request compact diagnostic also completed. Neither run substituted a model or retried a failed answer. Both tapes replayed identically, receipt for receipt.

| Task | Jev 1.13 | CLM | Astra high |
| --- | ---: | ---: | ---: |
| 18 harder claims at 25% estimated fill |9/18 |6/18 |18/18 |
| Same 18 claims with conversation padding removed, post-hoc diagnostic |12/18 |6/18 |18/18 |
| Six 90%-fill context controls |6/6 |1/6 |6/6 |
|Three authored candidate selections |3/3 |0/3 |3/3 |
|Five saved checkpoint-continuation checks |4/5 |2/5 |5/5 |

The compact diagnostic removed only irrelevant conversation entries. The claims, evidence, criteria and labels stayed identical. Jev improved from 9 to 12 correct; one paired run is evidence of sensitivity, not a causal estimate with measured run-to-run variance. CLM selected “contradicted” on all 18 harder claims in both settings. Its 6 correct therefore match the constant-answer baseline on a balanced three-label task. Removing this padding alone did not resolve that collapse. The result is specific to the released checkpoint and typed task framing used here; it is not a general verdict on contrastive learning.

Astra remained perfect on these 18 authored reasoning tasks. That is still a ceiling warning for Astra, even though the tasks distinguish it from Jev and CLM. The next independently held-out set should require longer chains of evidence, denser plausible distractors, mixed sources and harder counterfactuals. A broader same-family model-size sweep, controlled inference effort, repeated runs, and family-level uncertainty estimates would be needed before making a scaling claim.

The checkpoint checks are small but interpretable: two actual replies violated the stopping rule and three did not. Jev recognized one violation and all three clean replies, abstaining on the other violation. CLM recognized both violations but abstained on all three clean replies. Astra recognized all five. Balanced accuracy with abstentions retained in the denominators is 75%, 50% and 100%, respectively. None of these counts establishes broader teaching quality.

A second issue surfaced in the grammar checks. The original pilot asked whether UI complied with Keating's contract without supplying the complete schema/compiler specification. Many abstentions were reasonable. Those 28 checks remain in the immutable pilot receipts and in explicitly marked host-agreement diagnostic rows. They are not primary accuracy results and are not used in the comparison table above. Future plans use a separately recorded eligibility protocol: omit that underspecified grammar task from scoring, and supply known parser-validity facts for checks whose purpose is to evaluate what happens after a valid checkpoint. This is a protocol correction, not a retrospective change to the original labels.

The original pilot plan hash is `beee6d5d3becdd20d277df57090063e8cf3618cdea924a1c4796cddea58a16c7`. Reports are stored locally under `.keating/benchmarks/context-window/pilot-v2/live/` and `.keating/benchmarks/context-window/compact-diagnostic/live/`. The compact plan records the parent hash and identifies itself as a post-hoc diagnostic. The full seven-fill grid has been implemented but was not run in this pilot.


The temporary A40 GPU was deleted after about 15.6 minutes. An independent API check returned 404 for its exact ID and no remaining pods. At the quoted $0.49/hour, GPU time was approximately $0.13, excluding possible storage or tax; this is not an invoice. The runtime used the released head SHA256 `b2b4a8c9c2d39263eff78a351eb909a342ce9b3bf21a3f07c1d1bf15f1c4eda5`. A deliberate 35,007-token preflight was rejected against the 32,768-token encoder limit, confirming that the trial did not silently truncate those requests.

The continuation source was Entire's imported OpenCode session `ses_f2ddce9e0ffeotl0m0nteaemvC`, titled “Benchmarking JEV sliding window state.” It contained the proposal and the panel/direct-Astra/Markdown-plus-HTML preferences; the implemented benchmark and run receipts are new work.


Verification: 65 focused benchmark/shared-contract tests and 12 web tests passed, together with targeted TypeScript checks. The diagnostics inspector was checked in browser fixtures at 375px and 1100px; the actual pilot HTML report was checked for filters, disclosures and narrow layout. The complete revised grid was successfully constructed as 2,058 trial requests per provider; it was not executed. No production deployment or new human-learning study was performed.


## Correction: evaluate Keating's actual judgement batches

The generic reasoning probes above are now a legacy diagnostic, not the default test of suitability for Keating. The new `keating` profile uses 50 synthetic episodes in 25 contrastive families: 20 planning, 20 draft-adherence and 10 grading episodes. It captures the actual production question batches and state layouts at native conversation length, without padding. Across those requests, providers receive 1,522 questions; only 162 narrowly justified authored labels support scoring, and unlabelled outputs have no accuracy claim.

These are authored fixtures shaped like production interactions, not actual production traffic or independently validated human labels. **The live run now scores Jev 146/162 (90.1%), Astra 161/162 (99.4%), and CLM 12/162 (7.4%).** CLM made 117 threshold abstentions and had two failed requests; Jev required a documented decoder-rounding repair. Complete labelled-episode agreement is 37/50, 49/50 and 0/50 respectively. [The score report](../benchmarks/keating-judgement-scores.md) preserves these qualifications and the original failure record. Astra remains effectively at the ceiling. The earlier results and frozen plans remain unchanged and do not establish performance on the replacement suite. [The benchmark README](../../scripts/context-window/README.md) describes the current protocol.
