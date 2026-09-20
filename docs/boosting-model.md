# Measured boosting model

Fit a CatBoost ensemble offline from labelled rows and use it only where the
incumbent constants are currently typed by hand:

```sh
rtk bun scripts/training/fit-boosting-model.ts dataset.json NEW-output-directory
```

The command creates a new private directory (0700) with
`boosting-artifact.json`, `report.md` and a standalone `reliability.svg` (0600).
It never overwrites an existing directory. Standard output carries the artifact
file `sha256`, the fitted `boostingSha256`, the derived status and the row and
group counts. Training runs through `uv run --no-project --python 3.13 --with
catboost==1.2.10 --with numpy python scripts/training/boosting_model.py`, so the
trainer version is pinned alongside the artifact it produced. A third argument
replaces the python executable and exists for tests.

## Why CatBoost trains in Python and evaluates in TypeScript

CatBoost is the strongest off-the-shelf option for the small, numeric,
independent-group datasets this project collects, and its Python API is the one
that trains. Its inference does not have to come from CatBoost, and here it does
not.

CatBoost's official Rust package binds `libcatboostmodel` through `catboost-sys`
and `bindgen`, needs a CMake build of the full library per platform, and reaches
neither the web bundle nor the mobile app. This repository has no Rust, one
optional native helper per platform, and a portability rule that the same
decision logic runs on web, mobile and CLI. The export path gives both: CatBoost
trains a real ensemble, its JSON export is normalized and evaluated by a portable
walker, and every surface evaluates the same pinned bytes with no native
dependency and no second implementation of the training algorithm.

The walker is checked against CatBoost itself. `scripts/training/boosting_fixture.py`
freezes a synthetic dataset, the raw export and `predict_proba` outputs, and
`packages/learner-contracts/test/judgement-boosting-artifact.test.ts` requires the
portable walker to reproduce those probabilities exactly. That fixture caught two
real semantics errors: CatBoost binarizes float32 values, so a float64 comparison
picks the wrong child on a border, and CatBoost emits `-FLT_MAX` as the border
that isolates NaNs.

## Input

The dataset is validated before any trainer sees it:

```json
{
  "schemaVersion": 1,
  "policy": {
    "minFitRows": 40,
    "minFitGroups": 8,
    "minValidationRows": 20,
    "minValidationGroups": 6,
    "maxValidationEce": 0.15,
    "maxTreeDepth": 6
  },
  "features": ["prediction", "difficulty", "perQuestionMs"],
  "observations": [{
    "rowId": "unique row ID",
    "groupId": "independent learner or cohort ID",
    "split": "fit",
    "label": 1,
    "features": { "prediction": 0.78, "difficulty": 0.4 },
    "baseline": 0.5
  }]
}
```

Features are numeric and declared once, in order; that order is the model's
feature order. A missing feature is absent, never zero, and reaches the model as
NaN under the declared `nan_mode`. Unknown feature names, non-finite values,
duplicate row IDs and a group ID that crosses splits are rejected. `baseline` is
the incumbent's number for the same row. It is never a model input; it exists so
a fitted ensemble can be scored against the constants it would replace on exactly
the same held-out rows.

## Artifact

The artifact embeds the validated rows, the policy, the framework version and
parameters, the normalized trees, and every derived number:

| Field | Meaning |
| --- | --- |
| `boostingSha256` | Fitted identity over the method, version, rows, policy, framework and model |
| `status` | `validated`, `insufficient` or `failed-validation` |
| `input.dataset` | Row, group, split and positive counts |
| `metrics` | Held-out Brier, log loss, ECE, AUC, incumbent Brier and `beatsBaseline` |
| `reliability` | Ten-bin held-out reliability rows |

`boostingSha256` and the artifact file `sha256` are different identities. The
file hash pins the exact bytes loaded from disk; the fitted identity changes when
the rows, policy, framework or model change, so two ensembles can never share a
cached score.

The fitter reports no metrics. `scripts/training/boosting_model.py` returns the
ensemble and nothing else, and the portable contract recomputes the dataset
summary, metrics, reliability and status from the stored rows. A trainer that
reported a friendlier score would be ignored, and a model that loses to the
incumbent or exceeds the declared ECE ceiling is written as `failed-validation`
rather than presented as an improvement.

`status` is derived, not asserted. Below the declared row and group minimums the
artifact is `insufficient` and the command exits nonzero without claiming a
model. Only `validated` may reorder work.

Loading is `loadBoostingArtifact(path, expectedFileSha256)`. It bounds and reads
the regular file, rejects symlinks, requires the caller's pin to match, rebuilds
the artifact from its own rows, and compares every derived field. Web and mobile
can use `verifyBoostingText` with platform SHA-256, which applies the same
rebuild-and-compare rule without Node or network dependencies.

Trainer output is never surfaced verbatim: it can echo dataset rows, so a failure
is reported generically and the trainer's stderr is withheld.

## Limits

The frozen fixture is synthetic and proves inference parity only. It is not
learner evidence, and no measured production dataset or fitted boosting artifact
ships by default.

A validated status is a measured association on held-out groups, not proof of
learning. A judgement or a model estimate never becomes `source: "observed"`, and
no boosting artifact can make an evolution candidate `eligibleForPromotion`; it
may only reorder what gets run.

Independence is defined before collection. Repeated attempts by one learner are
not independent samples, so groups must reflect dependence, such as a learner or
cohort, and a group may not cross splits. Repeatedly refitting against the same
validation groups invalidates the holdout; use fresh groups after changing the
policy.

Output is bounded to 5 MiB and 20,000 rows because the rows are embedded as the
evidence. Exceeding the budget fails with an explicit error rather than silently
truncating evidence.

## Feeding the fitter

The feature and label paths already exist: labelled outcomes are joined by
`computeSessionRewardedTurns` on web, by mobile `learner_records`, and by the CLI
Pi event log. Turning those joins into a dataset requires an explicit feature
selection and an independent group assignment, which is the next step. Until
that dataset exists, `LEARNER_PROGRESS_THRESHOLDS`, `estimateRetention`'s mastery
factor and `compareUrgency`'s ordering stay as they are, and a fitted model
remains a candidate that is compared on held-out groups with
`compareAgainstBaseline` before it replaces anything.
