# Premature answer delivery: offline reward v2

`native_feature_rewards_v2.py` adds a separate single-head producer. V1, the
observer fitter, and the custom F+S updater are unchanged. Import and preparation
do not load observer weights, fit probes, read credentials, fund ledgers, or call
providers. The parent supplies actual measured features and independent review.

The concept is **premature answer delivery**, not `move.probing`, inferred need,
or learning. The intended concept corpus crosses hint-only/worked requests with
the same answer/hint across whole task families. The planned 120 authored examples
(30 families; 18/6/6 train/calibration/test) are not measured evidence merely
because the API accepts their eventual report. The later
[measured experiment](premature-answer-reward.md) and
[actual three-arm updates](native-combined-results.md) provide separate execution evidence.

For independently correct, in-scope actions,
`reward = -penalty * explicit_hint_only_gate * probability`.
The single calibrated SAE probability must describe the delivered response in its
actual prefix context. A known worked-answer request sets this narrow penalty's
gate to zero; the matched classifier evaluation must still distinguish the
contexts. Neither the zero gate nor a low penalty says the response is useful. Low penalty says
only that excessive assistance was not detected. It does not establish useful
teaching, independent learner success, or mastery.

## Exact handoff

```python
from native_feature_rewards_v2 import prepare_measurement_v2, prepare_feature_reward_v2

# Original native envelopes and unchanged base consumer config (ppo or sdpo).
args = (episodes, captures, reviews, split_manifest, base_config)
evidence = dict(probe_report=report, card=card,
                approved_card_hash=externally_frozen_hash, contexts=contexts)
measurement_plan = prepare_measurement_v2(
    *args, **evidence, prepared_at=plan_time)

# Parent measures exactly measurement_plan['projection']['records'], retaining
# the existing observer extraction artifact and calibrated predictions.
audit = prepare_feature_reward_v2(
    *args, **evidence, measurement_plan=measurement_plan,
    measurement=measurement, artifact=artifact, prepared_at=reward_time)
assert audit['feature_signals'] is not None  # otherwise inspect abstentions
plan = native_custom_update.prepare_custom_update(
    *args, custom_config, audit['feature_signals'])
```

The card is sealed with `card_hash`; its `kind` is `native-feature-rewards/v2`,
`concept` is `premature_answer_delivery`, `status` is
`approved_for_offline_reward`, and `independent` is true. It contains:

- `approved_at`, `approver`, `rubric_revision`, and `correctness_check` (e.g.
  `math_correctness`). Approvers can be humans or pinned independent models;
  the producer never issues approval or requires a new human-only permission.
- `probe`: `mode: sae`, `report_sha256`, `model_sha256`,
  `feature_card_sha256`, and `observer_manifest_sha256`, from the existing
  `observer_probes.fit_probes` report. Target must be
  `premature_answer` (Meitner's operational target), boundary `delivered`, and observer layer 12.
- `acceptance`: explicit `max_brier`, `max_ece`, `min_auc`, and
  `min_test_families` (at least two). Metrics are recalculated from held-out
  predictions, not accepted from a pass flag. Thresholds are research choices
  frozen by the caller; no defaults declare a head good enough.
- `scope`: nonempty `datasets`, `surfaces`, `request_modes` (`hint_only` and/or
  `worked_requested`), `heldout_family_aliases`; boolean `require_learner_work`;
  `actor_model_id`, `learner_model_id`, original actor `tokenizer`, and
  `runtime_source_hashes_sha256`. Restrict surface/domain scope to the evidence
  actually evaluated; an authored text corpus does not prove UI transfer.
- `rule`: `penalty` in (0,1], `gamma` in [0,1], `horizon` 1–12,
  `baseline: 0`, positive bounded `advantage_cap`, and
  `normalization: mean_of_action_completion_means`. Start with horizon 1.

Each sealed `context_hash` record binds `capture_hash`,
`pre_action_feature_hash`, `independent`, `current_request_attested: true`, `reviewer`, `request_mode` (or
`unknown`), `learner_work` (`present`, `absent`, `unknown`),
`request_citations`, and `work_citations`. Citations carry exact `event_id`,
`event_hash`, `start`, `end` (Unicode character offsets), and exact `quote` from a real learner message before the action.
Semantic request/work labels remain the independent reviewer's judgment; hashes
check their evidence binding, not their truth. Missing context abstains; never
insert a hint request into the historical 196-token capture to make it eligible.

`measurement`, sealed with `measurement_hash`, contains `plan_hash`,
`started_at`, `completed_at`, `artifact_sha256` (observer-core canonical digest),
`scorer_source_sha256` from the measurement plan, and `predictions`. Each prediction
has `record_id`, `row_sha256`, `probability`, and `abstention_reason`.
Unknown probabilities are null with a reason. Known probabilities must match
replay of the existing `observer_probes.predict_probe` on the hash-bound measured
SAE row. No caller-provided desired probability is trusted. Rows, spans, pooling,
native prefix, delivery, and observer manifest are checked using existing validators.

Persist observer artifacts using `observer_core.canonical(artifact)` or ordinary
Python JSON that preserves floating values, then reload and compare the digest
before consuming them. `native_tinker_update.write_private` uses the native
ledger's JavaScript-compatible JSON, which encodes `1.0` as `1`. That is appropriate
for native seals but changes the observer's distinct canonical digest. Do not
change the global hash rules or bypass the artifact gate to accommodate a writer.
The native experiment caught this boundary issue and retains both the original
faulty serialization and a separately verified, float-preserving recovery.

## Timing and consumer boundary

Historical episodes may precede reward approval. Required order is approval →
measurement-plan freeze → target measurement start/end → reward preparation →
update. Contrast collection/fitting/calibration provide the evidence for approval;
they are distinct from measuring the target historical action for reward. Persist
the approved card and measurement plan before that measurement. Seals and supplied
timestamps are reproducibility checks, not cryptographic proof of independent
approval or physical extraction. The parent retains the actual extraction receipts.

Correctness must cite the delivered action; later learner agreement is insufficient.
Explicit incorrectness denies feature export, and unknown correctness abstains.
No synthetic low-learning label is created. Missing/unknown rewards propagate
through the declared horizon. If any selected capture abstains, the whole selected
`feature_signals` envelope is null; the capture allowlist is never silently reduced.

The output uses existing `native-action-feature-advantages/v1`, sealed with
`features_hash`, with one scalar per action and `per_action_completion_mean`
provenance. The consumer retains its `mean_action_of_completion_means` normalization
(same mathematical action weighting). Original completion IDs and masks are
unchanged. F+S must also independently pass the current hindsight admission on the
same captures/reviews. The generic consumer does not itself replay this producer:
pass the returned, frozen envelope and retain the v2 audit with the update plan.

The tests use explicitly authored fixture metadata, vectors, reviews and token IDs.
They demonstrate contract behavior and offline consumer integration, not a fitted
reward head, actual 196-token measurement, policy update, or learning result.

## Exporter provenance

The readout worker now retains the actual signed TopK coordinates and character
offsets for every selected token. Reward validation recomputes their mean and
checks it against the pooled SAE vector. These are measured values, not values
reconstructed from a probability or invented to satisfy the artifact schema.

An approved card may pin `measurement_layer_selection_sha256` when the exporter
changes after probe fitting. Only that instrumentation hash may differ between
the measured and fitted manifests. Model and tokenizer file hashes, SAE weights,
layer, core extraction implementation, software, precision, and pooling must
remain identical. Both full manifests are retained; an unapproved exporter or
any changed measurement-basis field is rejected.
