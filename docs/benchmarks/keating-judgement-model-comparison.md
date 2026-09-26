# Keating judgement comparison and performance — 24 September 2026

The seven Kev checkpoints and three Laya checkpoints all completed the same frozen 50 episodes: **500 new requests, 15,220 typed outputs, no request failures and no truncated inputs**. The suite scores 162 authored assertions per model; the other outputs have no accuracy claim. This report adds them to the original Jev, Astra and CLM runs. It does not replace the original results or change production thresholds.

Current Kev 4B is a useful candidate for further calibration: it matches 138/162 labels at a fixed 0.5 cutoff, versus 139/162 for Kev 9B, with a lower median batch time. However, 9B crosses Keating’s strict confidence thresholds much more often and grades the learner examples better. Jev remains ahead of all the tested local candidates on this suite. Laya’s boolean balanced accuracy stays near chance after removing abstention.

## Decision quality

“Keating policy” means false at or below 0.2, true at or above 0.8, otherwise abstain. Abstentions and failed requests remain incorrect in the all-label denominator. “Fixed 0.5” is a separate diagnostic: false at or below 0.5 and true above 0.5. Choice selections and modal Score levels are unchanged. Astra already returns hard labels. The fixed cutoff was declared before these Kev/Laya runs; it was not fitted to their test labels. CLM’s earlier threshold exploration remains retrospective.

Balanced accuracy averages true-label and false-label recall on the **142 boolean labels only**. Complete episodes require every labelled assertion in the episode to match, not every unlabelled output.

| Model | Keating policy /162 | Boolean abstentions /142 | Fixed 0.5 /162 | Boolean balanced accuracy at 0.5 | Complete labelled episodes at 0.5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev 1.13.0 | 146/162 (90.1%) | 10 | 154/162 (95.1%) | 96.7% | 42/50 |
| Astra high reasoning | 161/162 (99.4%) | 0 | 161/162 (99.4%) | 100.0% | 49/50 |
| CLM 8B | 12/162 (7.4%) | 117 | 79/162 (48.8%) | 56.6% | 5/50 |
| Kev 0.5B · Qwen2.5 | 32/162 (19.8%) | 101 | 93/162 (57.4%) | 45.9% | 8/50 |
| Kev 0.6B · Qwen3 | 57/162 (35.2%) | 67 | 97/162 (59.9%) | 59.2% | 15/50 |
| Kev 0.8B · Qwen3.5 | 18/162 (11.1%) | 127 | 102/162 (63.0%) | 66.5% | 19/50 |
| Kev 4B · Qwen3 | 90/162 (55.6%) | 53 | 123/162 (75.9%) | 76.0% | 27/50 |
| Kev 4B · Qwen3.5 | 48/162 (29.6%) | 107 | 138/162 (85.2%) | 88.0% | 30/50 |
| Kev 8B · Qwen3 | 102/162 (63.0%) | 40 | 123/162 (75.9%) | 76.0% | 25/50 |
| Kev 9B · Qwen3.5 | 107/162 (66.0%) | 48 | 139/162 (85.8%) | 86.4% | 31/50 |
| Laya English | 10/162 (6.2%) | 138 | 76/162 (46.9%) | 51.5% | 7/50 |
| Laya typed decisions | 8/162 (4.9%) | 142 | 88/162 (54.3%) | 53.0% | 9/50 |
| Laya multilingual | 39/162 (24.1%) | 56 | 67/162 (41.4%) | 52.6% | 6/50 |

CLM retains its two failed grading requests; every other model completed 50/50. The boolean always-false baseline is 91/142 (64.1%) raw accuracy, but 50% balanced accuracy. Do not compare that boolean baseline directly to the mixed 162-label score. There are no 0.5 ties on the scored boolean labels.

### Task breakdown at the fixed 0.5 cutoff

| Model | Planning /62 | Reply review /80 | Grading + evidence /20 |
| --- | ---: | ---: | ---: |
| Jev 1.13.0 | 61 | 75 | 18 |
| Astra high reasoning | 62 | 80 | 19 |
| CLM 8B | 39 | 39 | 1 |
| Kev 0.5B · Qwen2.5 | 30 | 52 | 11 |
| Kev 0.6B · Qwen3 | 44 | 41 | 12 |
| Kev 0.8B · Qwen3.5 | 50 | 42 | 10 |
| Kev 4B · Qwen3 | 55 | 55 | 13 |
| Kev 4B · Qwen3.5 | 56 | 68 | 14 |
| Kev 8B · Qwen3 | 53 | 57 | 13 |
| Kev 9B · Qwen3.5 | 53 | 69 | 17 |
| Laya English | 39 | 28 | 9 |
| Laya typed decisions | 39 | 41 | 8 |
| Laya multilingual | 37 | 21 | 9 |

The newer 4B beats the older 8B in overall fixed-cutoff accuracy. Within Qwen3, 0.6B improves to 4B, while 4B and 8B tie on total labels. Within Qwen3.5, 0.8B improves substantially to 4B, then 9B gains only one net label. These checkpoints differ in training and architecture; this is not a controlled scaling-law experiment.

The 9B–4B Qwen3.5 difference is 0.62 percentage points. A paired bootstrap over the 25 episode families gives a descriptive 95% interval of approximately −6.0 to +6.8 points (20,000 resamples, seed20260924). This small suite does not establish a reliable accuracy advantage for 9B. It also shows no run-to-run variance: each model has one successful sweep.

## Runtime performance

The ten new models ran sequentially on the same NVIDIA A40 48GB. Kev used unquantized BF16, upstream prefix reuse with cache size 1, and no optional fused kernels or CUDA graphs. Laya used its native CUDA SDK with fast/compile disabled. These are measured configurations, not maximum-throughput tuning.

Latency is per original episode batch (2–41 typed questions), not per question. The local harness includes context preflight, tokenization and inference, but excludes download, model load and idle time. The first inference is retained; no warm-up response was discarded. p95 is the nearest-rank percentile. “Judgements/s” is all completed typed questions divided by summed request time, including failed-request time where applicable; it does not mean correct or confidently resolved judgements per second.

### Same-GPU local measurements

| Model | Median batch | p95 batch | Serial judgements/s | Total request time, 50 batches |
| --- | ---: | ---: | ---: | ---: |
| Kev 0.5B · Qwen2.5 | 108 ms | 176 ms | 260.9 | 5.83 s |
| Kev 0.6B · Qwen3 | 171 ms | 280 ms | 170.7 | 8.92 s |
| Kev 0.8B · Qwen3.5 | 408 ms | 451 ms | 84.1 | 18.09 s |
| Kev 4B · Qwen3 | 482 ms | 795 ms | 59.7 | 25.50 s |
| Kev 4B · Qwen3.5 | 1125 ms | 1263 ms | 31.7 | 47.97 s |
| Kev 8B · Qwen3 | 690 ms | 1074 ms | 42.6 | 35.69 s |
| Kev 9B · Qwen3.5 | 1475 ms | 1606 ms | 24.5 | 62.18 s |
| Laya English | 237 ms | 452 ms | 141.6 | 10.75 s |
| Laya typed decisions | 240 ms | 466 ms | 141.1 | 10.79 s |
| Laya multilingual | 127 ms | 241 ms | 254.7 | 5.97 s |

### Hosted/API observations — different execution boundary

| Model | Median successful batch | p95 successful batch | Completed typed judgements/s including failed-attempt time | Completed requests |
| --- | ---: | ---: | ---: | ---: |
| Jev 1.13.0 | 139 ms | 200 ms | 207.7 | 50/50 |
| Astra high reasoning | 15211 ms | 43015 ms | 1.7 | 50/50 |
| CLM 8B | 1145 ms | 1796 ms | 12.6 | 48/50 |

Hosted values include network and service overhead. CLM used a separate earlier A40 run through HTTP; Astra is a generative high-reasoning reference. These observations describe the tested paths and cannot establish equal-hardware speed, FLOP efficiency or serving-cost rankings. Kev’s reported output-token count measures serialized answer JSON, not generated tokens. Tokenizers, batching and state reuse differ, so cross-model tokens/s would be misleading.

The new GPU allocation lasted 1,109.1 seconds (18.49 minutes), including container initialization, downloads, installation, cache-loader failures and all inference. At the observed $0.49/hour quote, estimated GPU compute is **$0.151**. This is not an invoice and excludes any separate storage/network charges. The exact pod was deleted and its absence confirmed through the provider listing. Peak memory, model cold-start times, mobile/CPU performance, concurrent saturation and provider invoices were not measured.

## Configuration and integrity

- Questions, labels, family splits and state layouts are unchanged from the [50-episode catalogue](keating-judgement-episodes.md). All 50 complete production-shaped question batches were sent to each model; labels and rationales were excluded from inputs. These are synthetic fixtures and authored labels, not production prevalence or human-learning evidence.
- [Kev manifest](../../scripts/context-window/manifests/kev-2026-09-24.json) pins seven source/checkpoint/base combinations, including actual 0.5B, 0.6B, 0.8B, both 4B backbones, 8B and 9B. The 0.5B prototype lacks a historical base revision, so its explicit current Qwen2.5 base pin is disclosed. All checkpoints use their published temperatures; those probability scales are not calibrated on Keating.
- [Laya manifest](../../scripts/context-window/manifests/laya-2026-09-24.json) pins English, typed-decisions and multilingual. English’s default 512-token budget would clip 78 question rows; the predeclared 1024 budget preserves all 1,522. Existing instruction/option budgets remain unchanged. All three models passed token-for-token full-context checks. The checkpoint warning about a clamped 11+-option temperature affects zero rows: every Choice here has 3 options.
- The pinned container actually includes Torch 2.9.0+cu129. This is recorded in every receipt and exceeds Kev upstream’s declared `<2.9` dependency range. All tested inference and output checks passed, but this is a runtime exception rather than a claim of upstream-supported compatibility. The installed package inventory is saved.
- Initial Kev loading failed before inference because Hugging Face 1.32 treated an unfiltered offline snapshot request as incomplete after filtered downloads. Preparation and offline loading now request the identical file set. All seven were restarted uniformly after that loader repair; no model responses existed from the failed starts. Setup’s same-process import check also failed after editable installation; fresh inference processes imported the pinned package successfully. Both startup histories remain saved.
- The decoder permits independently rounded probabilities at Jev’s hundredth precision and Kev’s four-decimal precision only when a normalized distribution and reported ordinal mean are feasible. Raw values are retained. All 500 new responses passed; all 650 combined receipts replay exactly, including CLM’s two earlier failures. The earlier Jev repair is documented in the [original score report](keating-judgement-scores.md).
- Focused provider/benchmark checks pass (28 tests), new reporting scripts pass strict TypeScript checking, and independent receipt audits confirm model pins, request identity, full context and decoder equality. No production model routing or thresholds were changed.

## CLM and practical follow-up

[CLM’s threshold analysis](clm-threshold-analysis.md) shows that the host created its abstentions: all 62 scored planning probabilities fell between 0.2 and 0.8. A 0.5 cutoff raises the whole-suite match from 12/162 to 79/162, but boolean balanced accuracy remains 56.6%. Development-selected cutoffs do not establish a dependable production threshold; lowering temperature sharpens the same ranking.

The useful next comparison is calibrated Kev 4B versus 9B, fitted on separate development examples and tested on fresh episode families. Include realistic false-positive costs and fallback/escalation behavior. On this run 9B has fewer abstentions and stronger grading, while 4B has slightly stronger boolean balanced accuracy and lower latency. Laya and CLM need task-fit or criterion-wording work before threshold tuning alone can justify routing real teaching decisions to them. Astra still nearly saturates this suite (161/162), so a harder independently authored version remains warranted. Do not change the existing labels to force a preferred ranking.

## Local artifacts

Private raw outputs, provider plans, request hashes, package inventory, failed-start logs and cleanup evidence are under `.keating/benchmarks/context-window/keating-episodes-v1/execution/expanded/`. The `combined/` directory contains 650 receipts, strict and fixed-cutoff summaries, stage breakdowns, `performance.json`, and the paired-family bootstrap; `combined-replay/` reproduces the exact receipts. This report contains aggregate results only.
