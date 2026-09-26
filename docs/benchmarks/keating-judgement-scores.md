# Keating judgement scores — 24 September 2026

Live results for the frozen `keating-production-judgements/v1` suite: 50 authored lesson episodes in 25 paired families, using full production question batches. Each provider answers 1,522 questions; 162 explicitly labelled assertions determine these scores. Unlabelled outputs have no accuracy claim.

The [expanded comparison and performance report](keating-judgement-model-comparison.md) adds seven Kev checkpoints from 0.5B through 9B and three Laya variants, with fixed-cutoff diagnostics, task breakdowns, latency and throughput. [CLM's threshold analysis](clm-threshold-analysis.md) explains its abstentions. The original scores and execution history below remain unchanged.

| Model | Planning | Reply review | Grading + evidence | Overall label match | Entire labelled episode |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13.0 | 60/62 (96.8%) | 68/80 (85.0%) | 18/20 (90.0%) | **146/162 (90.1%)** | **37/50 (74.0%)** |
| GPT-6 Astra, high reasoning | 62/62 (100%) | 80/80 (100%) | 19/20 (95.0%) | **161/162 (99.4%)** | **49/50 (98.0%)** |
| CLM v0.1, Qwen3-8B encoder | 0/62 (0%) | 11/80 (13.8%) | 1/20 (5.0%) | **12/162 (7.4%)** | **0/50 (0%)** |

An episode counts as entirely correct only when all of its labelled assertions match. These are not scores for every question in each batch. All three datasets contain all 50 planned episodes and replay exactly without further inference. Jev and Astra completed all 50; CLM completed 48 and returned HTTP 502 on the two Python grading episodes. Those four missing labels remain in its denominator.

Jev made ten threshold abstentions, which remain in the 162-label denominator. It matched all 17 positive violation labels in reply review, while abstentions and extra violation flags reduced its clean-case performance. The always-no-violation baseline on that section is 63/80 (78.75%); Jev matches 68/80. Its balanced boolean accuracy there is 90.5%.

Grading combines ten ordinal scores and ten evidence selections. Jev matched 8/10 exact score levels and 10/10 evidence selections. Astra matched 9/10 score levels and 10/10 evidence selections. Their score disagreements occur at adjacent rubric levels. In particular, Jev's two 0-versus-1 disagreements still reject the wrong learner answers; they do not show acceptance of reversed reasoning or invented observations. The frozen labels have not been changed after seeing outputs.

Astra is effectively at the ceiling on this version. The suite distinguishes Jev from the reference but does not yet provide much difficulty range for the reference. One observation per episode cannot establish response variance, production prevalence, human learning effectiveness, or a scaling law.

## Execution and repair record

The first Jev pass accepted 23 batches and rejected 27 because the benchmark decoder required near-exact probability normalization and expected-score arithmetic. One diagnostic request established that the service independently rounds those values to hundredths. The repaired decoder tests mathematical compatibility with rounding while preserving raw values, exact keys, valid ranges and modal Choice selection. All 27 rejected batches were rerun once, uniformly; the 23 accepted originals were retained regardless of correctness. Original failures remain in a separate immutable tape. The displayed corrected results use new observations for those 27 batches, not recovered original predictions. No question, answer key, model revision or threshold changed.

The first CLM container failed before inference and was deleted. A second container initialized with bounded download retries and the original shared shutdown deadline, then attempted all 50 requests. It retained the pinned source, head and encoder revisions, a 32,768-token context and disabled truncation. Both GPU instances were deleted with authoritative listing confirmation. Their combined elapsed rental time was about 1,209 seconds, approximately $0.165 in GPU compute at the returned $0.49/hour rate; this is an estimate, not an invoice.

CLM abstained on 117 of the 142 labelled boolean judgements under the fixed production thresholds (false at or below 0.2; true at or above 0.8). In particular, all 62 planning labels were abstentions. It matched 1/10 exact grading levels and 0/10 evidence selections, with two grading requests failing outright. Its 7.4% result is the performance of this integration under those thresholds, not a standalone estimate of reasoning ability. Threshold changes require separate calibration and fresh evaluation; this run did not tune them.

There were 178 model requests in total: 150 first-pass scheduled requests, 27 uniform Jev decoder-repair requests and one Jev diagnostic. The final comparison contains 150 episode receipts: 148 completed and two CLM failures. All 150 replay exactly. The benchmark tests pass: 75 tests, 2,953 assertions. Provider TypeScript checks and the startup helper checks also passed.

The source plan is `.keating/benchmarks/context-window/keating-episodes-v1/plan.json`, SHA-256 `45b6e2c486db3b7b286f3822ff3b11cc7e1541b3da85e2b65e5da617aa3e580e`. Execution plans, raw receipts, repair evidence and replay reports remain local under its `execution/` directory. These raw artifacts are private; this summary contains aggregates and authored scenario identifiers only.
