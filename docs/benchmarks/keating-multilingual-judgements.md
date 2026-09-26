# Keating judgements across six languages

This experiment asks whether the same judge decisions survive a change in the language of the learner's work, conversation and evidence. It retains the original Keating benchmark's questions and answers exactly. Results describe these authored episodes, not human learning effectiveness or production traffic.

The frozen plan is `ce0a1d8cc531291d45b23e07f8e2f4aa273e04dba6c69fe3e59b795780f4ef90`. The 12-model comparison is complete. The user cancelled Astra at 21:35:43 UTC on September 24: 69 responses were saved, three dispatched requests have unknown outcomes, and 228 requests were never dispatched. Its local process exited, and it will not resume. The derived comparison plan excludes Astra; its partial receipts and cancellation record remain separate.

## Tasks and language condition

All 50 source episodes run in English, Spanish, French, Arabic, Hindi and Simplified Chinese. Each language contains 20 planning episodes, 20 tutor-reply reviews and 10 open-response grading episodes. Their 1,522 question outputs include 162 authored labels: 62 planning assertions, 80 reply-review assertions, 10 grading levels and 10 evidence selections. The remaining 1,360 outputs have no accuracy claim. Across six languages this is 300 requests and 972 labelled decisions per model.

The episodes belong to **25 shared contrastive families**. Translating a family does not create another independent task. Family membership and development/holdout assignments stay the same in every language; previously inspected families do not become fresh holdouts through translation.

Only natural-language text inside `request.state` is localized: learner messages, conversation, learner evidence, source excerpts, tool-result descriptions, tutor replies and assessment content. The entire `request.questions` object remains unchanged, including instructions, static rubrics, question IDs, Choice keys and criterion values. Every original `expected` and `fullExpected` value also remains unchanged. No language-dependent output mapping is performed.

This distinction matters for grading evidence. Its Choice IDs are literal English sentences in the original production contract, with null descriptions. Those IDs and descriptions remain English and unchanged. A model must match the translated learner sentence to its English evidence option. The experiment therefore tests multilingual content under an English judgement contract, including cross-language evidence matching. It does not test a fully localized interface or entirely monolingual prompts.

Code artifacts, mathematical expressions, URLs, protocol values and identifiers are preserved. The OpenUI flashcard code block also retains its embedded English text. Each English control request is byte-equivalent under JSON serialization to the original English request, with the same request hash; it receives a fresh execution rather than borrowing earlier results.

## Translation and review

A gold-free catalogue deduplicates the state content into 106 strings. Translators receive those strings and translation context, without the benchmark's expected labels or rationales. Shared sentence units reconstruct grading answers so that repeated learner sentences stay consistent across their occurrences.

Astra high translated the catalogue into the five target languages. All 106 entries per language then received model-assisted bilingual semantic review, covering negation, speaker attribution, assistance, uncertainty, numerical facts and intentionally wrong learner answers. This was **not native-speaker validation**. Initial translations and explicit correction records are retained. Review corrected four forced English articles in French and five artificial article/word fragments each in Arabic, Hindi and Chinese; Spanish required no correction. The catalogue's literal extractor was corrected so an English article “A” was not treated as a compartment name and “const” was not protected merely because it occurred inside “constant.”

Astra was also scheduled as a reference evaluator before cancellation. Its partial outputs are excluded from full-language rankings. Using the same model family for translation and evaluation can favor its interpretations or phrasing. Translation fidelity and native-language naturalness remain limitations, even after the structural and semantic checks. Reference agreement is not an independent gold standard.

## Frozen model and execution setup

The plan schedules 13 provider configurations, 300 requests each: Jev 1.13.0; Astra high; CLM; Kev 0.5B, 0.6B, 0.8B, 4B/Qwen3, 4B/Qwen3.5, 8B and 9B; and Laya English, typed-decisions and multilingual. The two Kev 4B checkpoints are distinct rows. The provider manifest freezes expected returned model identities for hosted services and source/checkpoint/base-model revisions for self-hosted models. These heterogeneous families are not a controlled scaling-law experiment.

Self-hosted execution uses the temporary A40 environment and recorded runtime manifests. The effective Torch runtime is 2.9.0+cu129. This is outside Kev's declared `torch>=2.6,<2.9` dependency range and is a disclosed compatibility exception; Laya declares `torch>=2.0`. Successful requests do not establish equivalence to a fully supported Kev environment. Model-specific versions and configuration must be read from the receipts, not inferred from one shared version label. Hosted latency and local GPU inference have different transport and preparation costs.

CLM's image reports vLLM `0.11.2+cu129`. Its initial startup check incorrectly required the unsuffixed version and was corrected before any benchmark request. A second startup attempt refused the already-created work directory; a fresh directory resolved that guard without deleting earlier evidence. Both startup logs and the execution amendment are retained. No completed model request was retried. Kev 0.5B's prototype checkpoint omits an immutable historical base revision, so it uses the explicitly recorded published Qwen2.5 base pin; the historical training-time pairing remains unverified.

Laya uses the unmodified pinned source `970dc8c5f63d7b886a68409493f37d569424f933` and its three pinned checkpoints. A token-only audit verified all 300 requests for each tokenizer. Every language and Laya variant uses the same **2,048-token limit**. Native instruction budgets and the 48-token option cap remain unchanged; the audit verifies they do not clip any supplied question or option. The runner also checks complete token sequences before inference. Increasing the state limit is a disclosed runtime configuration, not a weight or prompt patch.

Requests retain their original question batches. Language order rotates by source-episode index, with the same deterministic schedule for every model, so English does not always receive the first request and associated cache setup cost. Each model has one scheduled pass. Loading, downloads, caching and transport differences limit any interpretation of speed comparisons as intrinsic model efficiency.

The initial reservation was 3,900 calls and 23,774,010 host-estimated input tokens. After Astra's cancellation, the complete comparison schedules 3,600 requests across 12 models, with Astra's 72 dispatched requests recorded separately. The token estimate is an execution guard, not a claim about native tokenization or monetary cost. A preparation-only proposal to add translated evidence descriptions was abandoned before inference because it duplicated the English option text. Its audit remains available; it is not the executed condition.

## Scoring and uncertainty

The strict result uses the existing Keating rule: boolean probability at or below 0.2 becomes false, at or above 0.8 becomes true, and the middle interval abstains. A separately labelled fixed-cutoff diagnostic uses false at `p <= 0.5` and true at `p > 0.5`. It changes only boolean interpretation, leaves Choice/Score answers and hard-label references alone, and fits no thresholds to these results. The two columns answer different questions: operational coverage under the current policy versus forced boolean classification.

Failures, missing requests and abstentions remain in the appropriate planned denominator. Conditional accuracy must not replace accuracy over all 162 labels. Boolean balanced accuracy and class prevalence are reported separately; the 91/142 always-false boolean baseline cannot be compared directly with a mixed 162-label score. Exact grading levels remain the frozen scoring target, including the previously noted adjacent 0-versus-1 boundary disagreements.

Paired language differences reuse the same 25 source families. The report resamples whole families for 5,000 descriptive bootstrap draws and provides unadjusted 95% intervals. These intervals do not cover translation uncertainty, repeated-run variation or selection of these authored tasks, and they are not corrected for comparisons across many languages and models. One run per model/language cannot establish response variance or a general language ranking.

Timing summaries include each execution path's measured transport and preflight costs. Reported throughput uses summed request durations; it is not concurrent wall-clock throughput or server saturation capacity. Startup and model downloads are excluded from those per-request summaries.

## Completed comparison

All 12 retained models attempted all 300 requests: 3,599 valid responses and one Jev response-validation failure. Every native response passed the full-context checks. The tables retain all planned labels, including the failed request.

### Forced classification: correct labels out of 162

Booleans use the fixed 0.5 cutoff; grading and evidence use their returned modal answers. Each language has 142 boolean labels, 10 grading levels and 10 evidence selections.

| Model | English | Spanish | French | Arabic | Hindi | Chinese |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev | 154 | 150 | 154 | 151 | 153 | 152 |
| CLM | 80 | 78 | 75 | 76 | 81 | 82 |
| Kev 0.5B | 93 | 94 | 94 | 90 | 91 | 98 |
| Kev 0.6B | 97 | 101 | 95 | 102 | 104 | 95 |
| Kev 0.8B | 102 | 109 | 103 | 101 | 80 | 106 |
| Kev 4B / Qwen3 | 123 | 122 | 122 | 126 | 124 | 121 |
| Kev 4B / Qwen3.5 | 138 | 125 | 123 | 123 | 126 | 127 |
| Kev 8B | 123 | 124 | 122 | 124 | 122 | 126 |
| Kev 9B | 139 | 134 | 140 | 138 | 132 | 137 |
| Laya English | 76 | 64 | 74 | 54 | 50 | 52 |
| Laya typed-decisions | 88 | 80 | 72 | 66 | 66 | 71 |
| Laya multilingual | 67 | 59 | 59 | 59 | 55 | 54 |

### Existing strict policy: correct labels / abstentions

Both counts use the same 162 planned labels per language. Abstentions count as unmatched; they are not removed from the denominator.

| Model | English | Spanish | French | Arabic | Hindi | Chinese |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jev | 146 / 10 | 141 / 13 | 148 / 8 | 146 / 10 | 141 / 15 | 143 / 13 |
| CLM | 13 / 117 | 15 / 124 | 14 / 113 | 8 / 127 | 12 / 130 | 19 / 116 |
| Kev 0.5B | 32 / 101 | 42 / 95 | 40 / 95 | 42 / 89 | 39 / 74 | 40 / 94 |
| Kev 0.6B | 57 / 67 | 55 / 70 | 53 / 74 | 40 / 93 | 40 / 96 | 56 / 71 |
| Kev 0.8B | 18 / 127 | 15 / 134 | 17 / 131 | 15 / 136 | 9 / 137 | 14 / 132 |
| Kev 4B / Qwen3 | 90 / 53 | 87 / 59 | 87 / 57 | 89 / 54 | 89 / 52 | 88 / 55 |
| Kev 4B / Qwen3.5 | 48 / 107 | 46 / 108 | 45 / 107 | 50 / 105 | 41 / 113 | 43 / 111 |
| Kev 8B | 102 / 40 | 100 / 47 | 102 / 39 | 96 / 49 | 100 / 40 | 101 / 44 |
| Kev 9B | 107 / 48 | 100 / 53 | 106 / 48 | 108 / 43 | 98 / 50 | 99 / 56 |
| Laya English | 10 / 138 | 11 / 130 | 12 / 136 | 7 / 135 | 8 / 127 | 16 / 125 |
| Laya typed-decisions | 8 / 142 | 6 / 142 | 10 / 142 | 8 / 142 | 8 / 142 | 5 / 142 |
| Laya multilingual | 39 / 56 | 35 / 42 | 31 / 73 | 36 / 44 | 29 / 64 | 30 / 63 |

### Performance across all six languages

Successful-request median and 95th-percentile latency are in milliseconds. Question outputs/s divides all successfully returned question outputs, including unlabelled outputs, by summed attempt time. Failure time remains in that throughput denominator. Hosted Jev includes HTTP serving; native models use the shared A40 with their own preflight and inference paths. These are observed execution timings, not matched-hardware efficiency or saturation benchmarks.

| Model | Valid / 300 | Median ms | p95 ms | Question outputs/s | Boolean balanced accuracy, fixed 0.5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev | 299 | 135.9 | 196.1 | 211.2 | 95.6% |
| CLM | 300 | 913.1 | 1128.3 | 37.5 | 55.5% |
| Kev 0.5B | 300 | 133.5 | 207.5 | 224.0 | 46.0% |
| Kev 0.6B | 300 | 209.9 | 319.4 | 145.2 | 62.5% |
| Kev 0.8B | 300 | 467.9 | 524.5 | 74.4 | 64.7% |
| Kev 4B / Qwen3 | 300 | 517.8 | 860.2 | 55.3 | 75.2% |
| Kev 4B / Qwen3.5 | 300 | 1224.3 | 1332.0 | 29.3 | 80.2% |
| Kev 8B | 300 | 728.5 | 1165.5 | 40.3 | 74.6% |
| Kev 9B | 300 | 1567.8 | 1717.6 | 23.0 | 85.6% |
| Laya English | 300 | 294.6 | 589.9 | 105.7 | 48.5% |
| Laya typed-decisions | 300 | 292.6 | 590.6 | 105.4 | 47.7% |
| Laya multilingual | 300 | 141.3 | 204.4 | 236.1 | 46.7% |

### Grading and the unchanged English evidence IDs

English has 10 cases; the five translations together have 50 cases. This separates the evidence-selection boundary from the larger boolean classification score.

| Model | English grading / 10 | Translated grading / 50 | English evidence / 10 | Translated evidence / 50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Jev | 8 | 41 | 10 | 50 |
| CLM | 2 | 13 | 0 | 1 |
| Kev 0.5B | 2 | 15 | 9 | 39 |
| Kev 0.6B | 4 | 17 | 8 | 34 |
| Kev 0.8B | 4 | 20 | 6 | 32 |
| Kev 4B / Qwen3 | 6 | 31 | 7 | 36 |
| Kev 4B / Qwen3.5 | 7 | 34 | 7 | 32 |
| Kev 8B | 7 | 33 | 6 | 35 |
| Kev 9B | 7 | 33 | 10 | 44 |
| Laya English | 5 | 8 | 4 | 14 |
| Laya typed-decisions | 5 | 18 | 3 | 19 |
| Laya multilingual | 6 | 18 | 3 | 3 |

### Reading the differences

Jev leads these authored tasks at 92.6–95.1% fixed-cutoff accuracy. Kev 9B leads the local checkpoints at 81.5–86.4%, with each paired language difference's descriptive interval including zero. That does not prove language equivalence; the experiment contains only 25 families and one execution per condition.

The larger Kev models generally outperform the sub-billion checkpoints, but the ordering is not monotonic. Kev 4B/Qwen3.5 beats Kev 8B in English and loses much of that advantage under translation. Its five translated conditions fall 6.8–9.3 percentage points below English. Kev 0.8B has a larger Hindi drop: 13.6 points, with a descriptive family-bootstrap interval of −22.2 to −5.4 points. Backbone, training and runtime differences prevent attributing these comparisons to parameter count alone.

CLM remains weak with forced classification in English as well as the translations. Its evidence selection is 0/10 in English and 1/50 across translated cases, so changing the language does not explain that failure. Jev selects all 60 evidence answers correctly with the original English sentence IDs. The ID concern is a cross-language matching requirement worth measuring, not a reason to alter the output contract.

The strict policy exposes a different problem: Laya typed-decisions abstains on all 142 boolean labels in every language, and several Kev checkpoints also lose substantial coverage. Forced classification reveals decisions hidden by those abstentions, but does not make them reliable. For example, Kev 0.5B's combined boolean balanced accuracy is only 46.0%, and the three Laya variants are around 47–49%. A larger mixed-label match count alone can conceal weak recognition of the less frequent boolean class. No threshold was tuned here; calibration would require separate development data and an untouched evaluation set.

Jev's fresh English run reproduces the previous 146 strict and 154 fixed-cutoff matches. At the fixed cutoff, the invalid Spanish batch accounts for three of its four fewer matches than English; the remaining additional mismatch is `transfer_overclaimed`. French has the same failed labels as English. The Spanish error is recorded as `response-answer-malformed`; the rejected raw response was not retained, so its precise cause cannot be reconstructed. No reruns replace the recorded response-validation failure.

This suite distinguishes models and reveals language-specific weaknesses, but translation does not add independent workflow diversity. A stronger next evaluation would add independently authored multilingual episodes, native-language review, more difficult evidence-selection alternatives and adjudicated grading boundaries. Freeze these before running the models; perfect performance on one small component is a reason to expand that component, not to relabel correct answers or force a desired model ordering.

## Completion and verification

The temporary A40 pod was deleted at 22:13:32 UTC on September 24, 2026, after all raw outputs, logs and environment manifests were saved. A separate provider listing confirmed its absence. Its lifetime was 52 minutes 31 seconds; at $0.49/hour, estimated GPU compute was **$0.43**, excluding storage, network and hosted-model charges.

Targeted strict TypeScript checks, offline runner/import/scoring checks, label-mutation rejection and frozen-plan validation passed. The final results audit checked all 3,600 receipt identities and hashes and each native row's pinned identity and full-context proof. This is benchmark validation; no production deployment, full application regression suite or native-speaker validation was performed.

## Local audit artifacts

These paths refer to local, unpublished artifacts; raw requests and receipts should not be published wholesale without review.

- [Frozen multilingual plan](../../.keating/benchmarks/context-window/multilingual-v1/plan.json), including all request hashes, unchanged labels, translation file hashes and provider revisions.
- [Comparison plan after Astra cancellation](../../.keating/benchmarks/context-window/multilingual-v1/comparison-plan.json) and [cancellation record](../../.keating/benchmarks/context-window/multilingual-v1/execution/astra-reference/cancelled.json).
- [Source English plan](../../.keating/benchmarks/context-window/keating-episodes-v1/plan.json), SHA `45b6e2c486db3b7b286f3822ff3b11cc7e1541b3da85e2b65e5da617aa3e580e`.
- [Current provider configuration](../../.keating/benchmarks/context-window/multilingual-v1/providers.json); the frozen plan is authoritative for this run.
- [Final token preflight](../../.keating/benchmarks/context-window/multilingual-v1/preflight-state-only-final.json) and [comparison against the frozen candidate](../../.keating/benchmarks/context-window/multilingual-v1/preflight-state-only-candidate-comparison.json).
- [Preparation provenance](../../.keating/benchmarks/context-window/multilingual-v1/preflight-provenance.json), with runner/scorer hashes and the abandoned-description audit boundary.
- [Reviewed translations and initial copies](../../.keating/benchmarks/context-window/multilingual-v1/translations), plus [original catalogue](../../.keating/tmp/multilingual-catalog.initial.json) and [reviewed catalogue](../../.keating/tmp/multilingual-catalog.json).
- [Jev report](../../.keating/benchmarks/context-window/multilingual-v1/execution/jev/multilingual-report.json). Its `parentPlanSha256` identifies the derived Jev execution plan; the shared multilingual parent remains the frozen plan above.
- [Combined scores, language timings and paired intervals](../../.keating/benchmarks/context-window/multilingual-v1/execution/combined/multilingual-report.json) and [overall performance and grading breakdown](../../.keating/benchmarks/context-window/multilingual-v1/execution/combined/overall-performance.json).
- [Final integrity check](../../.keating/benchmarks/context-window/multilingual-v1/execution/final-integrity-check.json): all 3,600 receipt identities and request hashes, unchanged original questions and labels, and native revisions and complete-context proofs checked for every raw row. All 3,300 native responses are valid; the sole failure is the preserved Jev Spanish response.
- [GPU cleanup and cost estimate](../../.keating/benchmarks/context-window/multilingual-v1/execution/gpu-cleanup.json), [final runner hashes](../../.keating/benchmarks/context-window/multilingual-v1/execution/final-runner-hashes.json) and [native execution audit](../../.keating/benchmarks/context-window/multilingual-v1/execution/native-harvest-audit-final.json).

No production calibration or model-selection change follows automatically from this experiment.
