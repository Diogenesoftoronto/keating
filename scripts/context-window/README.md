# Keating judgement benchmark

The default benchmark tests the judgement batches Keating actually constructs for teaching plans, draft review and learner grading, using authored episode fixtures. It measures agreement with a narrow labelled subset of those batches, not human learning effectiveness. The earlier context-window and general-reasoning experiments remain available as legacy profiles.

## Default: Keating judgement batches

`--profile keating` is the default. Version `keating-production-judgements/v1` contains **50 synthetic episodes in 25 contrastive families**:

[Review all 50 episodes, production question text, and answer rationales](../../docs/benchmarks/keating-judgement-episodes.md).

- **20 planning episodes:** learner intent, attempts, assistance, preferences, activity affordances and active-plan progression.
- **20 draft-adherence episodes:** proposed tutor replies judged against the actual teaching-policy questions.
- **10 grading episodes:** submitted learner work and the production grading questions.

The suite captures the exact question batches and state layouts produced by Keating's request builders. It sends **1,522 production questions per provider** across the 50 episode requests, while scoring only **162 narrowly justified authored gold labels**. The remaining outputs have no accuracy claim. The labels and their rationales stay outside model inputs; they are authored benchmark judgments, not independently validated or human-labelled ground truth.

The episodes are synthetic and shaped like production interactions. They are **not actual production traffic** and do not estimate production prevalence or human learning. Each pair changes a consequential detail, shares a family split, and includes at least one labelled decision that changes. Context stays at the episode's native length: no unrelated conversation padding is added. Request shape is preserved even when only a subset of its questions has a defensible label.

This is the default evaluation of suitability for Keating's judgement tasks. **Live scores are available:** Jev 146/162, Astra 161/162, CLM 12/162 with 117 abstentions and two failed requests. [Read the scores and protocol-repair record](../../docs/benchmarks/keating-judgement-scores.md). The older scores below belong to separate general-reasoning and saved-gate experiments.

[The expanded comparison](../../docs/benchmarks/keating-judgement-model-comparison.md) adds seven Kev and three Laya checkpoints, separates abstention policy from fixed-cutoff decision accuracy, and reports batch latency and serial throughput. `performance.ts` computes these runtime metrics offline from saved receipts.

## Legacy profiles: context stress and saved replies

The `pilot` and `full` profiles retain the earlier context experiment. They are separate from the default Keating episode suite:

- **Easy controls:** 12 claims in 6 families.
- **General-reasoning probes:** 50 questions in 32 families, including arithmetic, conflicting revisions, exact joins, exceptions, incomplete observations and logical traps. These are generic evidence-reasoning tasks, not Keating's production question batches. The labels are 17 supported, 17 contradicted and 16 insufficient-context.
- **Context grid:** 25%, 50%, 65%, 75%, 80%, 90% and 100% of the 32,000-token host estimate, with head, recent or pinned evidence; full and production-window requests. The production window triggers at 80% and targets 65%, evicting complete old conversation turns without summarizing. Recorded learner evidence, active lesson state and pending submissions remain pinned.
- **Selection controls:** 6 authored sets of 4 candidate replies plus `none_acceptable`, with random, first-candidate and oracle baselines.
- **Saved replies:** completed execute-mode Keating generation receipts, excluding smoke, failed, truncated, malformed or unobserved generations. Narrow executable gates are recomputed from the replies; actor identities and previous judge verdicts do not enter model requests. These are separate from the new synthetic episode suite.

The saved source corpus has 363 candidate/gate questions and only 5 violations. Always answering “no violation” gets 98.62%. Report violation recall, clean-case recall, balanced accuracy and prevalence alongside raw accuracy. The historical 31-request pilot deliberately selected every mixed-class gate group; its enriched prevalence is not production prevalence.

## Benchmark principles

Freeze tasks, labels, splits, provider revisions, call limits and exact request hashes before inference. Hold sibling claims and all context variants in the same split. Never tune a prompt against the reserved families and then call those families an untouched test. Once inspected, the pilot's reserved families are consumed for future optimization decisions; independently author fresh families for final confirmation.

Perfect scores on easy controls indicate a possible ceiling. Keep those controls and add genuinely harder tasks in a new version. Do not force errors with arbitrary grading, change gold labels after seeing model outputs, omit unfavorable runs, or select a suite for a desired ranking. Larger models may do better, but that is an empirical hypothesis. Different training objectives, architectures, context budgets and inference effort confound a size-only comparison. Jev vs CLM vs Astra is not a controlled scaling-law experiment.

Keep failures and undispatched planned requests in the denominator. Show response coverage and conditional accuracy separately. Missing observations can correctly require insufficient_context. Score visible evidence against visible gold; report original full-context agreement separately so eviction is not confused with a reasoning error. Brier uses actual probability vectors even when the hard-label threshold abstains. Reference opinions are labelled agreement, never promoted to truth. Repetitions and context variants are correlated; do not use their raw count as the number of independent tasks. A one-repeat pilot cannot establish response variance or a general model ranking.

## Run

All commands below follow this repository's `rtk` wrapper convention. Provider config is a JSON array; credentials use an explicit environment-variable name or0600regular file, never literal secrets:

```json
[
  {"id":"jev","kind":"system-one","endpoint":"https://api.typesafe.ai/v1/systemone","model":"jev-latest","expectedModel":"jev-1.13.0","keyEnv":"JEV_BENCHMARK_KEY"},
  {"id":"astra-reference","kind":"reference","endpoint":"https://api.openai.com/v1/responses","model":"gpt-6-astra","expectedModel":"gpt-6-astra","keyEnv":"ASTRA_BENCHMARK_KEY","maxOutputTokens":4096},
  {"id":"clm","kind":"system-one","endpoint":"http://127.0.0.1:8700/v1/systemone","model":"clm-latest","expectedModel":"clm-latest","headRevision":"87655cb835bd76fd66c2da78e1e3709f7fa11a94","encoderRevision":"b968826d9c46dd6066d109eabc6255188de91218"}
]
```

Use a fresh output directory per plan/run. The plan is integrity checked and will not be overwritten. The default `keating` profile schedules 50 episode requests per provider; with three providers and one repetition this is 150 calls. Inspect the printed question counts and reservation before launching: a deliberately lower cap records undispatched rows rather than overspending. Tokens are host estimates; they are not a monetary guarantee. Reference output is bounded including reasoning tokens.

```sh
rtk bun scripts/context-window/run.ts --mode plan --profile keating --config /path/providers.json --out .keating/benchmarks/context-window/example --max-calls 200 --max-input-tokens 2000000
rtk bun scripts/context-window/run.ts --mode live --execute --plan .keating/benchmarks/context-window/example/plan.json --out .keating/benchmarks/context-window/example/live
rtk bun scripts/context-window/run.ts --mode replay --plan .keating/benchmarks/context-window/example/plan.json --tape .keating/benchmarks/context-window/example/live/receipts.jsonl --out .keating/benchmarks/context-window/example/replay
rtk bun scripts/context-window/run.ts --mode report --plan .keating/benchmarks/context-window/example/plan.json --out .keating/benchmarks/context-window/example/live
rtk bun test test/context-window-*.test.ts packages/learner-contracts/test/state-metrics.test.ts packages/learner-contracts/test/teaching-drafts.test.ts
```

CLI options require a space between the option name and its value, e.g. `--max-calls 200` and `--max-input-tokens 2000000`. Repetitions are set in the frozen plan with `--repetitions 3` and multiply its reservation. Interrupted tapes can be reported; missing scheduled receipts remain visible. Replay binds trial identity, request hash and repetition, so identical requests in separate cells cannot swap outcomes. No automatic retries or fallback model substitutions.

`report.html` is a standalone interactive report; `report.md` is the Markdown counterpart and `summary.json` is machine readable. Reports expose counts, hashes, errors and disagreement IDs, not raw learner text. Raw plan/receipts remain local private files. Review metadata before public sharing; this task does not publish them.

## CLM

[Upstream CLM](https://github.com/contrastive-lm/clm) uses a contrastive projection head on a Qwen3-8B pooling encoder. Pin the source, encoder, head and container separately. It is not a75MB stand-alone language model. Upstream's default embedding truncation is2048 tokens; a context experiment must explicitly disable it (`--max-tokens 0`) and provision an encoder context large enough for the tested requests. Oversized requests should fail visibly, not silently truncate. CLM confidence and cache-miss token accounting are not interchangeable with Jev confidence or billable token counts.

`clm-pilot.py` supports an explicitly requested temporary GPU trial with one A40, price checks, private disposable auth, and a43-minute deletion watchdog. `create` spends money; ordinary benchmark commands never provision infrastructure. `status` and `stop` operate only on the exact saved pilot pod. No persistent volume is created. Inspect the final deletion receipt; a health check alone is not an inference result.

## Kev and Laya native inference

The [expanded comparison](../../docs/benchmarks/keating-judgement-model-comparison.md) uses the same frozen 50 episodes. Immutable source, checkpoint and base-model revisions live in `manifests/kev-2026-09-24.json` and `manifests/laya-2026-09-24.json`. Kev includes 0.5B, 0.6B, 0.8B, both 4B backbones, 8B and 9B; Laya includes English, typed decisions and multilingual.

`offline-inference.ts export` strips labels and rationales from the frozen plan. `kev-inference.py` loads one pinned checkpoint per process, validates complete context and saves the upstream System One response. `laya-inference.py` calls the pinned SDK with `max_len=1024` and compares every encoded sequence against an uncropped assembly. English Laya's default512 clips78 rows; the configured1024 preserves all1522. No question rewriting, selected-question-only batches, quantization or model fine-tuning is used.

Import passes saved raw responses through the same strict benchmark decoder and preserves native latency and checkpoint provenance. Decoder tolerances accommodate Jev's independently rounded hundredths and Kev's four decimal places, with feasible normalization and ordinal-mean checks; raw numbers are not rewritten. `score-diagnostics.ts` adds an explicitly separate fixed0.5 boolean decision diagnostic, keeps errors/missing requests in the denominator, and does not optimize a cutoff on test labels.

```sh
rtk bun scripts/context-window/offline-inference.ts export /path/frozen-plan.json /path/gold-free-input.json
rtk proxy python3 scripts/context-window/kev-inference.py --manifest scripts/context-window/manifests/kev-2026-09-24.json --requests /path/gold-free-input.json --source /path/pinned-kev-source --output /path/raw-results
rtk proxy python3 scripts/context-window/laya-inference.py --input /path/gold-free-input.json --output /path/laya-english.jsonl --source /path/pinned-laya-source --checkpoint english --device cuda --max-len 1024
rtk bun scripts/context-window/offline-inference.ts import /path/frozen-plan.json /path/raw-results/kev-9b.jsonl /path/scored-kev-9b kev-9b kev-latest
rtk bun scripts/context-window/score-diagnostics.ts /path/scored-kev-9b/plan.json /path/scored-kev-9b/receipts.jsonl /path/scored-kev-9b/fixed-cutoff-diagnostic.json
```

`judgement-pilot.py` is a separate explicitly invoked temporary RunPod controller, with one A40, an hourly price cap and a70-minute deletion watchdog. It accepts private sequential jobs and retrieves append-only result snapshots. It does not provision through ordinary benchmark or import commands. Runtime package versions, initialization failures and final deletion evidence belong beside the raw receipts. The measured container uses Torch2.9.0+cu129; this exceeds Kev upstream's declared `<2.9` constraint and is disclosed as a tested runtime exception, not an upstream-supported configuration claim.

## Multilingual workflow: unchanged questions and labels

[Method, run provenance and results](../../docs/benchmarks/keating-multilingual-judgements.md) describe `keating-multilingual-content/v1`: all 50 Keating episodes in English, Spanish, French, Arabic, Hindi and Simplified Chinese. The six versions share 25 source families. Each language has 162 labelled decisions among 1,522 question outputs.

This is **state-only localization**. The complete original `request.questions`, including English instructions, static rubrics, Choice IDs and criterion values, stays unchanged. So do `expected` and `fullExpected`. There is no output-label remapping. Grading evidence options therefore remain their original English sentence IDs; the model matches translated learner text to those English options. Code artifacts, URLs, identifiers and mathematical expressions also remain unchanged. Every fresh English control request must retain the original English request hash. Do not reuse old English results as the new control.

Use fresh private paths for preparation and execution. The `.keating/` plans, translation requests, raw responses and receipts are local artifacts, not publication-ready data. The commands below are CLI shapes, not instructions to rerun the completed historical experiment.

1. **Export a gold-free catalogue.** The catalogue separates translator entries (`id`, English text and context) from local path bindings; expected labels and rationales are not exported. Preserve its original bytes before translation; the builder expects the sibling `catalog.initial.json` to verify translation provenance.

   ```sh
   rtk bun scripts/context-window/multilingual-catalog.ts /path/source-plan.json /path/catalog.json
   rtk proxy cp --no-clobber /path/catalog.json /path/catalog.initial.json
   ```

2. **Translate and review.** Translation makes hosted calls and requires `--execute`. This script reads the configured local credential store; never put credentials into a catalogue or command argument. Review every translated entry for attribution, negation, uncertainty, deliberately wrong answers and literal preservation. Preserve initial translation files and record any corrections. Set `reviewStatus: "reviewed"` and the reviewed-entry count only after review; automatic translation output remains pending. Model-assisted review is not native-speaker validation.

   ```sh
   rtk proxy python3 scripts/context-window/multilingual-translate.py --catalog /path/catalog.json --out /path/translations --execute
   ```

3. **Build, check and freeze.** The positional arguments are source plan, reviewed catalogue, translations directory, provider configuration and output plan. `--validate-only` writes nothing and can inspect pending translations; it does not approve them. Creating a candidate requires reviewed translations. The builder verifies catalogue coverage, protected literals, unchanged protocol strings, exact original labels/questions, all 50 source episodes per language and source-identical English request hashes. It recomputes size estimates and rotates language order within each source episode. Run tokenizer preflight against the candidate before preserving its exact bytes as the frozen plan.

   ```sh
   rtk bun scripts/context-window/multilingual-plan.ts /path/source-plan.json /path/catalog.json /path/translations /path/providers.json --validate-only
   rtk bun scripts/context-window/multilingual-plan.ts /path/source-plan.json /path/catalog.json /path/translations /path/providers.json /path/candidate-plan.json
   rtk proxy cp --no-clobber /path/candidate-plan.json /path/plan.json
   rtk bun scripts/context-window/offline-inference.ts export /path/plan.json /path/gold-free-input.json
   ```

   The original multilingual plan scheduled 13 configurations and 3,900 calls. A later user cancellation is recorded in a separate comparison plan and cancellation record; never rewrite the original schedule or silently treat cancelled work as completed. See the linked method report for that scope change. Exported native inputs contain request hashes and wire requests, without expected labels or rationales.

4. **Execute the chosen frozen scope.** Hosted execution requires `--execute`; concurrency is 1–3. `--resume` resumes a matching journal without repeating dispatched requests with unknown outcomes. There are no automatic response retries or model substitutions. Use the frozen plan appropriate to the authorized provider scope.

   ```sh
   rtk bun scripts/context-window/multilingual-run-hosted.ts --plan /path/provider-plan.json --out /path/hosted-output --provider jev --concurrency 1 --execute
   ```

   Native runners are direct inference commands: they do **not** have an `--execute` flag. Kev and CLM offer `--validate-only`; Kev's `--prepare` downloads pinned snapshots without inference. Calling their ordinary commands, or the Laya command, starts model work. They do not provision a GPU themselves.

   The exporter sets `request.model` to `kev-latest`. For CLM, make a separate `clm-input.json` copy with only that wire model alias changed to `clm-latest` for each trial. Preserve the parent-plan hash, trial IDs, request hashes, state and questions exactly; the CLM runner rejects the Kev alias. Laya's SDK runner consumes the state and questions directly.

   ```sh
   rtk proxy python3 scripts/context-window/kev-inference.py --manifest /path/kev-manifest.json --requests /path/gold-free-input.json --source /path/pinned-kev-source --output /path/kev-output --validate-only
   rtk proxy python3 scripts/context-window/kev-inference.py --manifest /path/kev-manifest.json --requests /path/gold-free-input.json --source /path/pinned-kev-source --output /path/kev-output --deadline-seconds 2400
   rtk proxy python3 scripts/context-window/laya-inference.py --input /path/gold-free-input.json --output /path/laya-english.jsonl --source /path/pinned-laya-source --checkpoint english --device cuda --max-len 2048
   rtk proxy python3 scripts/context-window/clm-inference.py --requests /path/clm-input.json --output /path/clm.jsonl --workdir /path/new-clm-workdir --deadline-seconds 2400
   ```

   Laya uses 2,048 tokens uniformly across all languages and variants, with original instruction budgets and option caps unchanged. Its preflight rejects clipping. CLM's observed container package is `vllm 0.11.2+cu129`; retain that observed version rather than dropping the build suffix from provenance. Read actual source/checkpoint revisions, temperatures, context limits, package versions and runtime exceptions from the frozen manifests and receipts. The earlier English-only Laya example's 1,024-token setting does not describe this multilingual run.

5. **Import and report without inference.** Import verifies request identity and applies the same strict decoder; it preserves failures and rejects purportedly successful outputs with explicit failed context proofs. Use the matching derived provider plan for a single-provider report, or the declared comparison plan and combined receipts for a comparison. Missing scheduled receipts remain in the denominator. The report includes the original strict thresholds, a separately labelled fixed-0.5 boolean diagnostic, language comparisons and descriptive family bootstrap intervals; it fits no thresholds.

   ```sh
   rtk bun scripts/context-window/offline-inference.ts import /path/plan.json /path/laya-english.jsonl /path/scored-laya-english laya-english laya-rl-agent
   rtk bun scripts/context-window/multilingual-report.ts /path/scored-laya-english/plan.json /path/scored-laya-english/receipts.jsonl /path/scored-laya-english/multilingual-report.json
   ```

For Kev, use its manifest provider ID and expected response model `kev-latest`; CLM uses provider ID `clm-multilingual` and response model `clm-latest`. Retain raw files alongside imports: aliases alone do not identify a checkpoint, and per-request timings do not include downloads or model loading.

## Historical gate-protocol correction and trial artifacts

The September24 original pilot is immutable:31requests per model,93completed calls. Its28UI-grammar labels per model are underspecified host-agreement diagnostics because the full schema/compiler contract was not supplied. Preserve those rows and denominators, but do not use them as primary accuracy.

Future legacy `pilot` or `full` plans importing saved replies use `keating-saved-gates/v2` via `eligible-rollouts.ts`: schema-validity tasks remain separately enumerated diagnostics, and parse-dependent tasks receive the same host-verified validity fact for every candidate. A missing proof makes the case diagnostic-only. Tool-only rules are unchanged. On the current corpus this yields36eligible cases,309questions and2violations. The first revised legacy pilot had 28 requests per model; its expanded general-reasoning set produces 60 per model with this saved corpus. That expanded legacy selection was planned and tested locally, not run against providers. These counts do not describe the default 50-episode Keating suite.

The original scored run lives at `.keating/benchmarks/context-window/pilot-v2/live/`; its frozen plan predates the gate-protocol correction. The separately frozen post-hoc compact diagnostic lives at `.keating/benchmarks/context-window/compact-diagnostic/live/`. Both tapes replay exactly. The18hard claims scored Jev9/18,CLM6/18,Astra18/18 with padding, and Jev12/18,CLM6/18,Astra18/18 without it. CLM chose contradicted every time in both. Do not label the reused families fresh holdout evidence.

To reproduce the compact diagnostic from a compatible 18- or 50-question original plan:

```sh
rtk bun scripts/context-window/compact-plan.ts /path/original-plan.json /path/new-compact-directory
```

It clears conversation only, retains the exact questions, labels and pinned observations, and records its parent plan hash.

## Legacy general-reasoning set: 50 questions

[Review all 50 questions and answer keys](../../docs/benchmarks/judgement-questions-50.md).

`questionSetVersion: keating-reasoning-50/v2` identifies legacy `pilot` and `full` plans. It does not identify the default `keating-production-judgements/v1` episode suite. All 36 original authored claims retain their wording and keys. Fourteen new questions add independent task families and fair traps involving probability, misleading aggregates, source independence, causal uncertainty, false premises, time boundaries, transaction behavior and logical scope. A trick must have a defensible answer from the supplied evidence; missing information remains insufficient_context.

The legacy `pilot` profile sends every generic reasoning question, including both claims of the older paired families. It contains 50 reasoning questions across 32 families, not 50 independent families. The full context grid and compact diagnostic also include all 50. Previous 18-question results and frozen plans are historical; no new model scores are implied by expanding the catalogue. Default limits are 200 calls and 2 million estimated input tokens. The legacy full grid still requires an explicit larger budget. To request the legacy profiles, pass `--profile pilot` or `--profile full`, optionally with `--rollouts .keating/benchmarks/prompt-adherence`. Never combine their historic scores with the new episode-suite denominator.
