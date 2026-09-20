# Measured mastery, retention and urgency policies

Keating fits three separate decision policies from its existing source-grounded teaching harness. The original task, learner evidence, source revision and license travel with each example. Related variants stay in one source family, and entire families are assigned to training or validation before requesting judgements.

The targets answer different questions:

| Policy | Target | Existing rule compared |
| --- | --- | --- |
| Mastery | Correct independent response to a new objective question | Progress status thresholds |
| Retention | Correct recall of the selected card after the stated delay | Exponential retention estimate |
| Urgency | Lapse risk for a currently due deck | Due/overdue queue ordering |

The source scenarios already fit Keating's harness. Existing tutor-quality labels remain tutor-quality labels; the policy dataset adds a Jev judgement for each of the three targets. It retains each exact request, raw probability, concrete model version and response. Probabilities stay continuous during fitting.

## Reproduce the dataset

```sh
rtk bun scripts/training/prepare-synthetic-decision-policies.ts \
  .keating/native-learning/scenarios/development-v1/scenarios.json \
  .keating/datasets/decision-policies/harness-jev-v1

rtk bun scripts/training/prepare-synthetic-decision-policies.ts \
  .keating/native-learning/scenarios/development-v1/scenarios.json \
  .keating/datasets/decision-policies/harness-jev-v1 --execute
```

Preparation makes no provider calls. Execution uses `TYPESAFE_API_KEY` or the existing `typesafe_api_key@secrets` Skate entry, keeps the credential in memory, and resumes successful requests by their exact hash. A changed source, selection or request cannot overwrite an existing run.

The first run contains 36 families from MathDial, Bridge and TutorMoments: 22 training families and 14 validation families. Eight deterministic harness states per family produce 288 requests and 864 target judgements from `jev-1.13.0`. Selection and splitting use source identifiers, never model scores. The original files and private response receipts remain under `.keating/datasets/decision-policies/harness-jev-v1/`.

The source supplies the task and pre-action learner context. Subsequent practice counts, ratings and delays are declared simulated harness state with a reproducible seed. Evaluation-only future conversations never enter a judgement request. These states extend the original scenarios without pretending that simulated practice happened to the source learner.

## Build and compare

```sh
rtk mkdir -p .keating/outputs/decision-policies

rtk bun scripts/training/build-decision-policy-dataset.ts \
  .keating/datasets/decision-policies/harness-jev-v1/manifest.json \
  .keating/outputs/decision-policies/harness-jev-v1-dataset

rtk bun scripts/training/fit-decision-policy.ts \
  .keating/datasets/decision-policies/harness-jev-v1/manifest.json \
  mastery .keating/outputs/decision-policies/harness-jev-v1-mastery
```

Run the last command separately for `retention` and `urgency`, each with a new output directory. The verifier rebuilds features and incumbent predictions from the bound source state. A shallow tree must first improve the target's held-out comparison. The optional ensemble competes against that tree using the same target metric. Failed comparisons retain the incumbent.

The output includes the model, source records, comparison report and fit identity. Installation checks an independently supplied SHA-256 of the exact artifact bytes and recomputes the comparison. Model predictions remain separate from saved answers, review ratings and learner-declared profile fields.

The mobile installer stores large source-bound artifacts in private files, with a small commit manifest in AsyncStorage. Import and removal leave recorded grades and review schedules unchanged. The Learn surface shows the prediction's target, dataset and whether it was fitted to observed outcomes or harness judgements. Unknown input history leaves the existing rule in place.

## First completed comparison

All three targets use the fixed 22/14 source-family split. Lower loss is better.

| Target | Existing rule | Shallow tree | Boosted fit | Selection |
| --- | ---: | ---: | ---: | --- |
| Mastery: expected classification error | 0.424464 | 0.437679 | Not attempted | Keep existing rule |
| Retention: squared probability-agreement error | 0.102860 | 0.003142 | 0.002020 | Boosted fit |
| Urgency: weighted ranking error | Mobile 0.415942; web 0.420229 | 0.020195 | 0.010043 | Boosted fit |

Urgency compares 383 unequal-probability pairs across 14 held-out cohorts. Its candidate must beat both actual queue comparators: mobile uses the next future due date as its tie-break, while web uses the earliest due date including overdue cards. Priority lanes and fixed control positions remain intact during application reordering.

Mastery's failed comparison is retained. The ensemble is deliberately skipped when the shallow candidate fails, so this run does not justify replacing the mastery rule. No parameters were changed in response to that validation result.

Final artifacts are under `.keating/datasets/decision-policies/harness-jev-v1-final-{mastery,retention,urgency}/`, each with `decision-policy.json` and `report.md`. Import only a selected artifact:

| Artifact | Exact file SHA-256 |
| --- | --- |
| Retention | `a0b4a3347a819e3b3b04bfe8f431b3e53cdb3ac329461e7875942956b1e9cb98` |
| Urgency | `21a30593356694da8c91918d9c7d0f4e22b5b57f5afc7048b1bd4049a6e39796` |

The actual 12,779,656-byte retention artifact passed the mobile store's import, fresh reload, selected-model prediction and removal checks using injected storage. Focused mobile checks passed 17 tests / 140 assertions and mobile TypeScript. The preparation test passed 67 assertions, source tests passed 10 tests / 61 assertions, and fit tests passed 11 tests / 121 assertions. These checks execute in code; manual browser and device testing remains with the user.

## Evidence and limits

These comparisons measure decisions against target-specific judgements on source-grounded harness scenarios. They establish how the fitted policies behave within that harness. They do not measure an effect on human learning or convert a judge's confidence into observed retention. Original source provenance and simulated additions are recorded separately.

All variants from one source family stay together; eight variants are not eight independent learners. Validation is also used to select between the two fixed candidate model classes. Fresh future data is needed for an untouched estimate of the selected model's generalization. Original licenses remain attached to source material; generated private artifacts are not automatically public release assets.

Real portable learner exports remain supported through the separate observed-outcome source path. They can extend the evidence later without blocking use of the existing harness datasets now.
