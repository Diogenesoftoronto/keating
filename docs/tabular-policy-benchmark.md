# TabPFN 3.5 versus the previous policy mechanism

On October 1, 2026, a live comparison against the same saved validation rows found lower TabPFN loss for retention and urgency, and higher loss for mastery. These are measurements of agreement with saved Jev probability estimates. They do not measure human learning or establish which features cause learning.

| Target and primary loss; lower is better | Previous selected mechanism | Previous loss | TabPFN 3.5 loss | Change |
| --- | --- | ---: | ---: | --- |
| Mastery: teacher-expected classification error | Existing deterministic rule | 0.424464286 | 0.435357143 | 2.57% higher loss |
| Retention: squared error against teacher probabilities | CatBoost | 0.002019576 | 0.001867705 | 7.52% lower loss |
| Urgency: teacher-weighted cohort ranking error | CatBoost | 0.010042609 | 0.008422746 | 16.13% lower loss |

The previous mastery fitting run rejected its shallow tree and never trained CatBoost. Therefore the mastery comparison is against the rule that actually remained selected. Calling it a direct TabPFN–CatBoost mastery comparison would be incorrect. The rejected shallow tree's loss was 0.437678571. Retention and urgency both have saved CatBoost models, whose predictions were recomputed locally from the exported trees.

## What was compared

Each target used its original 176 fit rows from 22 independent source groups and 112 validation rows from 14 separate groups. There was no overlap of fit and validation group IDs. The datasets came from these existing artifacts:

- `.keating/datasets/decision-policies/harness-jev-v1-final-mastery/decision-policy.json`
- `.keating/datasets/decision-policies/harness-jev-v1-final-retention/decision-policy.json`
- `.keating/datasets/decision-policies/harness-jev-v1-final-urgency/decision-policy.json`

The existing source verifier reconstructed the rows, model hashes, shallow trees, CatBoost predictions, original metrics and selection before any provider call. The benchmark then independently recomputed the group-averaged primary losses and required agreement with the saved metrics to within `1e-12`. It did not accept a report's score without recomputing it.

TabPFN received exactly the same numerical features and the original fit labels. Mastery has four feature columns; retention and urgency each have eight. No feature cells were missing in these artifacts, and no extra missingness flags were introduced. For other compatible datasets, missing numerical features are sent as null, preserving missingness instead of replacing it with zero. Group IDs, learner IDs, topic prose, questions, answers and source documents were excluded from all provider requests.

All three datasets contain continuous teacher probabilities, including mastery. Therefore TabPFN used **regression** for all three fits. The labels were never rounded into invented binary learner outcomes. Mastery evaluation still classifies predictions at `0.5`, then calculates expected error under each original probability. Retention averages squared probability error within each independent group, then averages groups. Urgency compares differently labelled rows within the same learner cohort, weights each disagreement by the teacher-probability difference, assigns half-error to ties, and averages cohorts within groups. Urgency had 383 comparable pairs across 14 cohorts.

The API request pinned `v3.5_default`, one estimator, and random seed zero. The service confirmed billing model version `v3.5` and package version `9.0.0`; the resolved checkpoint was `tabpfn-v3.5-20260909.safetensors`. No Thinking-mode search, model fallback, parameter sweep or result-driven rerun was performed. No returned probability needed clamping.

## Time, provider usage, and cleanup

| Target | One complete hosted operation | Provider token quote |
| --- | ---: | ---: |
| Mastery | 13.37 seconds | 10,000 |
| Retention | 7.38 seconds | 10,000 |
| Urgency | 7.39 seconds | 10,000 |

Each duration includes upload preparation, CSV upload, standard fit, validation upload, prediction and training-dataset deletion. The dataset deletion cascades to its test datasets. These are single observations, not a latency benchmark, and are not compared against historical CatBoost training time. The existing exported CatBoost inference runs locally and needs no API call.

The token figures came from the provider's dimension-only estimate endpoint with the same dimensions and estimator count. Total quoted usage was 30,000 provider tokens. Actual charged tokens and a currency cost were not returned by this experiment, so the report leaves them unknown. Provider tokens measure compute, and are separate from Not Organic retail credits. Prior Labs documents a 10,000-token minimum per TabPFN 3/3.5 billable operation, and states that timed-out or failed calls can still consume tokens after computation begins. [Provider metering](https://docs.priorlabs.ai/api-reference/metering)

Small synthetic regression and binary-classification smoke calls separately verified the TypeScript transport before the comparison. The key was read into process memory from Skate and was never written into an artifact or browser bundle. The API protocol has several HTTP requests even though the underlying foundation model adapts through inference without retraining its pretrained weights. [Current API client contract](https://github.com/PriorLabs/tabpfn-client/blob/main/src/tabpfn_client/api_models.py)

## How to interpret the result

The result favors TabPFN on two of these three saved harness metrics. It does not establish that TabPFN is uniformly better, that its feature preferences are causal, or that users will retain more information. Mastery got worse under the existing primary decision metric, so a model-wide switch alone does not justify activating new mastery estimates.

These same validation groups already selected the previous shallow-tree and CatBoost candidates. They are useful for this paired comparison, but they are not a fresh untouched test set for a final model-selection claim. The source scenarios include simulated practice states and Jev-authored probability targets. Their probabilities are not observed future learner outcomes. A new outcome-based evaluation should keep a later time window separate, hold out independent groups where possible, and keep model-selection data separate from the final assessment.

The previous artifacts were read without modification. This benchmark does not install a model or activate a teaching revision. Online adaptation separately supplies newly observed outcomes as context, evaluates predictions on withheld outcomes, and determines whether they are eligible for use.

## Reproduce

The development runner is [benchmark-tabular-policies.ts](../scripts/training/benchmark-tabular-policies.ts). The source SDK is supplied explicitly to the experiment; ordinary web and mobile code use the authenticated Not Organic gateway and contain no direct cross-repository SDK import.

```sh
rtk bun scripts/training/benchmark-tabular-policies.ts \
  --output .keating/outputs/tabular-benchmark/NEW-RUN \
  --sdk-path /home/diogenes/Projects/notorganic-provider/packages/tabpfn-client/src/index.ts
```

Use a new output directory each time. The runner uses `TABPFN_TOKEN` if provided; otherwise it reads Skate's `priorlabs_api_key` in subprocess memory. `--dry-run` verifies artifacts and recomputes previous losses without contacting a provider. The live runner writes numerical target reports and a combined summary, including original file hashes, model metadata, labels and predictions under numerical group indices. It excludes source prose and credentials.

The recorded run is `.keating/outputs/tabular-benchmark/2026-10-01-tabpfn-v35/summary.json`, with `mastery.json`, `retention.json` and `urgency.json` alongside it. These local experiment artifacts remain outside commits.
