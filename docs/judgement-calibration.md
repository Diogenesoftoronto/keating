# Measured judgement calibration

Generate an artifact offline from authentic independently observed labels:

```sh
rtk bun scripts/training/fit-judgement-calibration.ts observations.json NEW-output-directory
```

The command creates a new private directory (0700), with `calibration.json`, `report.md`, and a standalone `reliability.svg` (0600). It never overwrites an existing directory. Standard output includes the exact artifact file `sha256`, the newly fitted `calibrationSha256`, and counts. The loader requires the file SHA256 separately; it also recomputes the fitted identity, all thresholds and metrics from the embedded observations. Merely changing a threshold or fitted identity and repinning the file does not bypass validation.

The input has this shape; placeholders below deliberately do not constitute valid evidence:

```json
{
  "schemaVersion": 1,
  "policy": {
    "maxFalsePositiveRate": 0.1,
    "maxActionErrorRate": 0.1,
    "minSamples": 80,
    "minActions": 40,
    "minNegatives": 40
  },
  "observations": [{
    "observationId": "unique measured observation ID",
    "sourceId": "unique independently observed source ID",
    "groupId": "independent learner or cohort ID",
    "split": "fit",
    "evidence": "observed",
    "backend": {
      "backend": "system-one",
      "model": "concrete version returned by inference",
      "calibrationSha256": null
    },
    "question": { "type": "noul", "instructions": "Exact original question" },
    "metricKind": "noul-probability",
    "value": 0.9,
    "label": 1
  }]
}
```

`noul-probability` pairs P(yes) with the independently observed yes/no outcome (`label: 1` or `0`). `choice-confidence` and `score-confidence` pair distribution confidence with the independently observed correctness of the selected option/level. Confidence is not interpreted as a probability of correctness. These groups receive action error bounds, but no Brier score or probability reliability chart. Choice/Score questions must include their exact original criteria.

The artifact file hash and fitted `calibrationSha256` are different identities. The first pins the exact bytes loaded from disk. The fitter derives the second by SHA256 hashing the method/version and canonical validated input, including observed labels, independent split identities and the fit policy. Changing the dataset, policy, or fitting method/version produces a new fitted identity. Source rows retain the exact backend provenance originally returned by inference: `null` is expected before the first calibration, and an existing 64-character lowercase hexadecimal calibration hash is accepted for a refit. Never relabel those source rows with the newly fitted hash.

Each result records both the original `sourceBackend` and an effective `backend` containing the newly derived calibration identity; only the latter keys the runtime threshold table. Mixed original calibration identities for one backend/model/question are rejected, preventing ambiguous merges or table collisions. Configure the runtime transport with the emitted fitted calibration identity after accepting the measured artifact. Until then, a runtime response with a null or different calibration identity still abstains. Runtime lookup additionally matches backend type, exact model and the full canonical question JSON, including criteria. Model aliases such as `latest` are rejected.

For explicit CLI/Pi readiness review, set `KEATING_READINESS_CALIBRATION_FILE` to the produced `calibration.json` and `KEATING_READINESS_CALIBRATION_FILE_SHA256` to the separately recorded file hash. The existing `KEATING_READINESS_JUDGE=notorganic` opt-in still applies. Calibration permits only matching readiness review decisions; it does not change due dates, mastery, schedules, or the learner's saved work. Missing or invalid calibration leaves recommendations unavailable.

Pin `KEATING_JUDGEMENT_MODEL` to the concrete measured model and `KEATING_JUDGEMENT_CALIBRATION_SHA256` to its measured backend calibration identity. The model must match the observed source model, and the calibration identity must match the artifact's newly fitted `calibrationSha256`; original source rows keep their earlier identity. The CLI loader does not infer or replace these settings. A provider model change cannot inherit those thresholds. The readiness receipt records the file hash and rejects a file changed while inference is running.

For CLI evolution spending, independently opt in with `KEATING_EVOLUTION_SPEND_JUDGE=notorganic`, and use `KEATING_EVOLUTION_SPEND_CALIBRATION_FILE` and `KEATING_EVOLUTION_SPEND_CALIBRATION_FILE_SHA256` with the same explicit backend identity settings. Three exact questions review supported failure, addressability and whether skipping is supported. A separately measured positive skip threshold can prevent generation; the positive failure threshold is never mirrored into an invented negative band. The receipt retains applied thresholds and artifact hash. Missing, invalid or changed calibration leaves this optional spending review advisory; the requested experiment still uses its existing promotion gates. Neither a spending judgement nor its calibration can authorize promotion.

To install an artifact on web or mobile, open judgement settings, supply the separately recorded artifact file `sha256`, and import `calibration.json`. The file hash is not the fitted `calibrationSha256`. Import does not enable hosted judgement or sign in. Review mode and account authorization remain separate choices.

Installed artifacts stay in app-local storage, outside synced learner records. Each reload verifies the original text and supplied file hash and rebuilds its thresholds. An invalid installed artifact cannot silently acquire an uncalibrated fallback under the same operation. Removing or replacing calibration invalidates in-flight reviews, and provider model drift cannot reuse its thresholds. The web runtime selects local thresholds only for the configured local model; mobile currently supports hosted calibration only. Both reject ambiguous hosted model installations. Use separate artifacts for different hosted models.

The Settings status lists the concrete model and validated question count. Importing an artifact does not make unrelated questions calibrated: lookup still requires the exact question instructions and criteria. No measured production artifact ships by default. Artifacts generated from synthetic test fixtures are for automated tests only.

Web and mobile use the same portable artifact verifier as the CLI fitter. Platform hashing supplies SHA-256; the shared verifier bounds UTF-8 input, checks the separately supplied file hash, rebuilds the artifact from its embedded observations, and compares every derived field before exposing thresholds. It has no network, storage or Node dependencies. The CLI retains its bounded regular-file loader and symlink rejection.

Fit and validation groups must be independent. Observation IDs and source IDs are unique across the entire input. A group ID cannot cross splits and may appear only once per backend/question, so many dependent records from one learner cannot inflate a Wilson sample size. Define independence before collecting evidence: use cohort IDs instead of learner IDs if a shared intervention makes learners dependent. Distinct questions may use the same independent group within the same split, with distinct observed source records.

The fitter chooses the lowest passing observed fit value using fixed Wilson 95% upper error bounds. It then tests the frozen threshold once against validation. It never searches validation for a better threshold. Noul requires positive and negative observations in both splits; action count and negative count minima apply separately. Confidence requires enough independently labelled selected answers and accepted actions. Empty or insufficient data, one-class Noul data, or a failed validation split produces no applicable threshold. A failed group retains its fit candidate in the report for diagnosis, but does not enter the runtime table. There is no fitted review/defer band: both table cutoffs equal the measured action cutoff.

Input and artifact reads are bounded to 5 MiB; the input allows at most 10,000 rows. The production schema accepts only `evidence: "observed"` and real backend types, not proxy/synthetic evidence or fixture backends. Schema validation cannot establish that an operator truthfully labelled data. Never relabel synthetic fixtures, model assessments, or inferred signals as measured outcomes. Unit tests use clearly documented synthetic fixtures solely to exercise this schema and statistical behavior; they are not fitted production artifacts.

Noul Brier/ECE metrics and ten-bin reliability plots use only validation rows, including rows below the action threshold. Bounds apply per question group; they do not provide simultaneous guarantees over a family of questions. Repeatedly inspecting and refitting against the same validation groups invalidates the holdout. Use fresh heldout groups after changing a policy. Calibration of a judgement does not establish human learning effectiveness.

## Collecting quiz predictions on web and mobile

Canonical practice quizzes offer **Quiz estimate → Estimate before answering**.
The action uses the independent judgement setting and recent saved assessed work.
Mobile also includes recent saved quiz results, labelled as historical context whose grading authority was not recorded. A hosted setting sends the quiz and that bounded history to the configured
judgement service. Answer controls stay usable while the estimate runs; starting
an answer, navigating, or opening a hint cancels an unfinished estimate.

Accepted per-item predictions are saved locally before they are shown. Each
retains its exact question, concrete backend identity, item hash and attempt
identity. The prediction remains `source: "proxy"`. After the canonical answer
transaction commits, the collector recomputes objective correctness from the
frozen authored question and exact submitted answer. It does not trust a model
grade or a client-reported partial-credit value. In-app hint use is recorded
separately; a correct answer after opening a hint is a negative outcome for this
specific question. Outside help is not observable, so the prediction wording and
export explicitly refer to **in-app hints**, not verified unaided performance.

Only the matching live attempt can be linked. Skips, empty answers, open-ended
model grading, late predictions, changed source content and ambiguous attempts
remain unmatched. An original durable action receipt must postdate preparation of the submission; replaying an older result cannot attach it to a newer prediction. Reloading does not guess which saved prediction belongs to a
new attempt. A collection failure never reverses a successfully saved answer.

After completion, **Prepare estimate records** makes a local JSON download
available on web. Mobile offers **Share estimate records**, using the native share sheet and removing its temporary file afterward. It contains source question text, prediction provenance and linked
outcomes, and is not automatically uploaded or synced. This first collection
path covers canonical web and mobile practice quizzes; terminal collection is described below. Exams and legacy quiz flows are not covered. Flashcard self-ratings do not become
objective correctness observations.

Evidence storage is bounded to 500 item receipts and 2 MB. It reports a storage failure instead of silently evicting records. Web localStorage collection does not guarantee atomic writes across simultaneous tabs. Mobile uses exclusive SQLite transactions, rechecks the durable action journal inside the evidence transaction, and fences writes against clear/import/account changes. Clearing mobile learning data clears these records; importing data invalidates pending collection without guessing new outcome links. Sharing is cancelled if its source, account or data generation changes during preparation.

The download is raw evidence, not a fitted calibration artifact. An operator must
assign independent learner or cohort groups and a fit/validation split before
converting eligible pairs with `toPerformanceCalibrationObservation`. Repeated
attempts by the same learner are not independent samples; the existing fitter
still enforces one group/backend/question observation. The opt-in collection
population and showing a prediction before answering are part of the collection
conditions. No measured production calibration ships from this implementation.

## Collecting quiz predictions in the terminal

On a fresh canonical practice quiz, choose **Estimate before answering** before
opening **Take quiz** or **Reveal hint**. This explicitly sends the authored quiz
and bounded prior work to the existing Not Organic judgement account. It does
not use direct TypeSafe environment overrides. Missing account access, no prior
work, an unsupported question type, or an unavailable model leaves the quiz usable.

The first terminal collection path supports choice questions with canonical
answer IDs. Math, ordering, matching, blank-entry and open-ended questions do not
receive predictions. History contains up to twelve prior objective answers on
the same topic from the last 90 days, drawn from completed terminal actions and
saved CLI quiz submissions. Actual saved learner-profile scalars are explicitly
labelled proxies; arbitrary profile text is excluded. Completed terminal quizzes
build local history even when no prediction was requested.

Practice hints are hidden until an explicit reveal, and their use is recorded
before display. Opening or cancelling an answer permanently closes prediction
eligibility for that source. Restored sources are conservatively ineligible.
Changing the source, selected learner, account, or model while an estimate runs
discards the result. Unfinished inference has a deadline even if the provider
ignores cancellation.

Predictions are private local receipts. An observation requires the exact
completed delivery journal entry, its original timestamps, the frozen question
and answer, and the hint state captured at submission. Replayed actions cannot
acquire new predictions. Optional evidence errors do not undo answer delivery.

**Export quiz prediction evidence** writes a new private JSON file under the
selected learner's `state/quiz-performance/` directory, including after a quiz
becomes a completion callout. Evidence is bounded to 500 predictions per document
and 2 MiB per file; exceeding the limit fails instead of silently deleting rows.
The export labels itself `unfitted`. It needs the same independent group and
fit/validation assignment described above before it can enter the fitter.
