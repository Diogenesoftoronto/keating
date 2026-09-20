# Fit quiz estimates from committed answers

The terminal quiz records an optional estimate before an answer, then joins it
to the completed answer action. These commands rebuild fitting rows from those
original records and compare an inspectable depth-three tree with the raw Jev
estimate. A passing tree permits a fixed CatBoost ensemble to be tried.

## Select original records

Run from the learner workspace whose private quiz records are being selected.
Supply an explicit selection file; the commands do not collect additional
answers or call a judgement service:

```json
{
  "schemaVersion": 1,
  "documents": [{
    "documentId": "saved-quiz-document-id",
    "predictions": [{
      "predictionId": "saved-pre-answer-prediction-id",
      "groupId": "independent-learner-or-task-family",
      "split": "fit"
    }]
  }]
}
```

Assign dependent examples to the same group before examining validation
outcomes. Use `validation` for groups reserved from fitting. A group, original
attempt, identical item, or identical task with a regenerated question ID cannot
cross groups or splits. Group declarations still require judgement: the code
cannot identify the same person across aliases or recognize every paraphrase.

The dataset builder checks the stored source, concrete backend, exact question
definition, pre-answer timestamp, and original completed journal receipt. It
regrades the committed answer with the shared objective scorer. Missing,
pending, skipped, or inconsistent rows reject the export instead of silently
disappearing. Each selection uses one backend/model/calibration identity.

For a standalone dataset and its source binding:

```sh
rtk bun /path/to/keating/scripts/training/build-quiz-boosting-dataset.ts selection.json NEW-dataset-directory
```

The new directory is private (0700); `dataset.json` and `binding.json` are 0600.
The binding records the selection and source, prediction, task, outcome, and
receipt hashes. An existing directory is never overwritten.

## Fit the small tree first

```sh
rtk bun /path/to/keating/scripts/training/fit-quiz-performance.ts selection.json NEW-fit-directory
```

This command rebuilds the originals itself. It does not trust an edited dataset
export or accept a caller-supplied success label.

The target is **correct without an in-app hint**. The fixed input features are
raw Jev probability, choice count, prompt length in UTF-16 code units, and five
question-kind indicators. Current answers, hint use, timing and correctness are
excluded from the input features. The baseline is the recorded raw Jev
probability for that same item.

Fitting uses the existing Gini decision-tree implementation with maximum depth
three and at least eight training examples per leaf. The gate requires 40 fit
rows from eight groups, 20 validation rows from six groups, both outcomes in
each split, a lower held-out Brier error than the raw estimate, and expected
calibration error at most 0.15. These are explicit development policy settings,
not measured guarantees of generalization.

If the tree passes, the command invokes pinned CatBoost 1.2.10 through `uv` in
Python 3.13. The quiz wrapper fixes depth three and 300 iterations, resolving
the generic trainer's depth-four default. It trains on fit rows only. The
portable TypeScript contract reconstructs the ensemble's metrics from its
exported trees and the original dataset. The ensemble is selected only when it
passes validation and improves on the shallow tree's Brier error; otherwise the
passing shallow tree remains selected.

`quiz-fit.json` contains both candidates, tree comparisons and reliability
bins, the original dataset, its source binding, the selected candidate, and a
hash of the complete fit. Standard output includes a separate exact-file hash.
Source records are checked again after training. A changed source invalidates
the result. Insufficient or failing tree evidence produces a report with no
selected candidate, skips CatBoost, and makes the command exit nonzero.

## Limits and remaining integration

The hint flag comes from the app's saved observation. The completion journal
rechecks the answer but does not independently reconstruct hint events or
outside help. Hashes establish consistency with the current local originals;
they do not certify the honesty of a person who controls all those files.

The two candidates are evaluated on the same declared validation groups. That
supports this predeclared comparison, not an untouched final test estimate.
Changing features or repeatedly selecting models against those groups consumes
the holdout; use fresh independent groups for subsequent evaluation.

The terminal consumes a verified report when both `KEATING_QUIZ_FIT_FILE` and
`KEATING_QUIZ_FIT_SHA256` are set. Relative paths resolve inside the learner
workspace. The loader checks exact file bytes, rebuilds the original dataset,
recomputes the tree and ensemble comparison, and pins target, feature schema,
backend and source bindings. Changed configuration, sources or backend stop the
estimate. The display labels the selected tree or ensemble estimate and retains
the raw Jev estimate separately in the saved receipt. With no configured fit,
the existing raw estimate remains available. Web and mobile still show raw
estimates. No authentic production dataset or fitted quiz model is bundled.

This target does not measure long-term retention, mastery, or the usefulness of
ranking unlike activities. Replacing `LEARNER_PROGRESS_THRESHOLDS`,
`estimateRetention` or `compareUrgency` requires evidence for those targets.
