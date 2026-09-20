# Observer layer sweeps and controlled interventions

`scripts/training/observer_experiment.py` implements the local experiment seam
for research-plan sections 6, 7 and 20. Preparation builds a deterministic,
hashed matrix. Execution loads cached observer/SAE snapshots through the existing
`observer_extract.load_observer`, captures actual residual tensors, and applies
controlled post-block perturbations. It does not provision a pod, download
weights, generate conversations, fit probes, update a policy or judge behavior.

Importing or preparing the experiment does not import torch. The later
[bounded job helper](observer-experiment-job.md) adds checkpointing, model reuse
and Runpod transport without changing the observer core or extractor.

## Callable interfaces

```python
plan = prepare(config, records, concept_card, split_manifest)
validate_plan(plan)
result = execute(plan)  # Existing load_observer, allow_download=False.

# Local injection for authored mechanics tests, never a module/command string:
result = execute(plan, loader=local_loader, spec=SAESpec(hidden=4, width=8, top_k=2))
```

`local_loader(args)` returns `(model, tokenizer, block, state, manifest)`, the
same tuple as `load_observer`. Injected results are marked
`injected_local_runtime_not_published_model`, even if a supplied manifest uses
published model names. The CLI exposes no dynamic loader, arbitrary module,
shell command, remote execution, credential or download option.

The lower-level `forward_intervention(model, block, batch, direction,
epsilon=..., scale=..., token_mask=..., seed=...)` performs **one actual model
forward**. It returns before/after CPU residual copies and a fingerprint of the
actual downstream tensor, when available. Its mask is boolean `[batch, tokens]`
and must select non-padding tokens. It supports both tensor and tuple block
outputs while preserving all tuple extras and the batch dimension. Hooks,
mixed module training flags and RNG state are restored on completion or error.
Repeated block invocation is rejected; autoregressive generation needs its own
explicit mask/sampling executor.

## Declaration bundle

The prepare CLI reads a JSON object with `config`, `records`, `concept_card`
and `split_manifest`. These are project contracts, not fields supplied
automatically by a model vendor or by the existing probe feature card.

`config` has:

| Field | Contract |
| --- | --- |
| `schema_version` | Integer 1 |
| `mode` | `readout` or `intervention`; omitted means `intervention` |
| `observer.model` | `Qwen/Qwen3.5-9B-Base` |
| `observer.sae_model` | `Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50` |
| `observer.model_revision`, `tokenizer_revision`, `sae_revision` | Full immutable 40-character Hub commits |
| `observer.layers` | Nonempty unique list of exact layer declarations, described below |
| `observer.device`, `dtype` | `cpu`/`cuda`, `float32`/`bfloat16` |
| `observer.max_tokens` | Integer 1–32,768; overlong inputs reject without truncation |
| `poolings` | Nonempty unique selection from the three rules below |
| `epsilons` | Intervention: unique finite values in [-1, 1], containing zero and paired positive/negative values; 3–11 entries. Readout: `[0]` or omitted |
| `seeds` | 1–16 unique integers in [0, 2³¹); recorded per actual forward |
| `calibration_seed` | Intervention: explicit integer in the same range; unused in readout mode |
| `calibration_record_ids` | Intervention: nonempty unique calibration-partition records used only for residual-scale estimation. Readout: empty or omitted |
| `evaluation_record_ids` | Intervention: nonempty unique train/test records, disjoint from calibration and together covering the input. Readout: every input record, including train/calibration/test |

Each layer declaration contains `layer` (integer 0–31), `module` (exactly
`language_model.layers.N`) and `sae_sha256`. Intervention mode additionally
requires `feature` and `unrelated_feature`. Both feature IDs must be in the
loaded dictionary and must differ. Each layer
needs its own verified SAE byte hash; copying layer 12's hash to another layer
cannot load successfully.

The existing parent's layer-12 worker pins are:

- Model/tokenizer: `68c46c4b3498877f3ef123c856ecfde50c39f404`
- SAE revision: `7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8`
- `layer12.sae.pt`: `2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8`

These identities come from the existing local `observer_runpod.py` contract.
This work fetched no model files or additional layer hashes. A four-layer sweep
requires the parent to supply verified hashes for every selected layer.

## Source, review and temporal binding

Records follow the existing `observer_core.boundary_view` projection contract,
with explicit `split` and `group_ids` (an empty list means no additional known
identity). Each has a record/family identity, boundary, latest event, public
events and nonempty character spans. See [observer pipeline](observer-pipeline.md).
Preparation strips private events, future events, labels and unrelated metadata
from retained projections. It preserves the original record hash separately.
Only the allowlisted serialized view text reaches the tokenizer or model.
Every span must lie in the requested phase and map exactly to unpadded tokens.

The split manifest is:

```text
schema_version: 1
source_manifest_sha256: exact admitted source/projection manifest hash
families:
  FAMILY_ID:
    split: train | calibration | test
    group_ids: [known person/template/derivative connection IDs]
```

Every selected record must match its family's assignment. All declared families,
including unselected ones, participate in cross-partition group checks. No split
is generated or repaired after inspecting labels or measurement results. The
parent must supply the complete admitted source closure; this interface does
not replace or weaken source-registry validation.

The concept card requires the following fields; `feature_reviews` is required
only for intervention mode:

```text
schema_version: 1
target: operational target identifier
definition: operational definition
boundary: pre_action | delivered | retrospective
source_review:
  status: approved
  reviewer: actual reviewer identity
  review_id: actual review identity
  evidence_sha256: hash of reviewed evidence
  source_manifest_sha256: same source manifest as the split
observer_binding:
  model, model_revision, tokenizer_revision, sae_model, sae_revision: exact pins
  layer_sha256: {LAYER_NUMBER_AS_STRING: exact SAE hash}
feature_reviews:
  LAYER_NUMBER_AS_STRING:
    feature: selected dictionary coordinate
    unrelated_feature: reviewed control coordinate
    evidence_sha256: actual feature-selection review hash
    selection_split: train
    unrelated_rationale: why the control is unrelated to this concept
```

Do not manufacture an approved review to fill these fields. The parent verifies
the review artifact and supplies its reference; preparation verifies the
declaration's consistency and hash binding, not the reviewer's identity. Existing
`observer_probes` feature cards need this source review binding before use here,
and feature review binding before interventions. A different coordinate alone
does not establish semantic unrelatedness.
The manifest records review provenance; it never feeds the concept definition,
labels or private judgments into observer text. No source label is inherited by
a changed native episode through this interface.

## Pooling and intervention matrix

| Pooling | Actual selected vectors |
| --- | --- |
| `mean_of_unique_selected_tokens` | Mean over the union of selected span tokens; overlaps count once |
| `last_selected_token` | Last token in that union, not the end of the full transcript |
| `per_span_mean` | Separate mean for each declared span; overlapping spans remain separately identified |

Each result includes both raw residual readouts and SAE readouts. SAE encoding
reuses the published affine-plus-signed-Top-K convention in `observer_core`.
It adds no centering or ReLU. These are measurements ready for a separately
validated probe; no probe accuracy is inferred from them.

Use `mode: readout` for the first source-feature batch, before selecting decoder
directions. It performs one unperturbed forward per layer × record × seed and
computes every requested pooling. It can extract all three source partitions
without fitting or selecting anything from their labels. Its calibration list
is empty; each trial's direction, scale and calibration hash are null. The
source-reviewed concept definition, exact source split and observer/SAE pins
are still required. Hash-order and bound the source sample before preparing it.

For intervention mode, the executor computes the median L2 norm over **all selected
calibration token vectors**, before any intervention. Scale records include the
exact input token IDs, selected indices, residual hashes, model manifest hash and
calibration seed. This is a residual-scale calibration, not evidence that a
behavioral classifier has been calibrated.

For every intervention layer × evaluation record × seed, the matrix contains one zero-epsilon
baseline and every nonzero signed epsilon crossed with these controls:

- `feature`: selected unit decoder column.
- `opposite`: negative of the same unit direction.
- `random`: seeded Gaussian direction normalized to unit L2 norm.
- `unrelated`: separately reviewed decoder column normalized to unit L2 norm.

The applied displacement is `epsilon * calibrated_scale * unit_direction` at
exactly the selected post-block token vectors. Random and unrelated controls
therefore have the same requested displacement norm. Opposite direction with
positive epsilon duplicates selected direction with negative epsilon; this is a
consistency control, not an independent observation to double-count.

Forward trials are shared across pooling variants. The executor stores actual
direction vectors/hashes, target token indices and offsets, original source
hashes, latest permitted event IDs, before/after residual hashes, downstream
tensor hashes, and observed selected/unselected displacement norms. BF16
rounding may make observed displacement differ from the requested norm; both
are retained. Seeds and the actual deterministic-algorithm setting are logged;
identical seeds do not promise bitwise equality across hardware or software.
The result's `measurement_contract` records the experiment mode, pooling rules
and residual hook. It is authoritative for these measurements: the unchanged
loader manifest also retains the extraction helper's default mean-pooling
metadata, which does not describe every measurement in a sweep.

Execution is serial with at most 256 input records and 4,096 forward trials.
One model/layer dictionary is loaded at a time. Reusing the same model across a
large layer sweep, distributed scheduling, generation-time interventions and
independent behavior review are later extensions. No measurement here is a
provider or pod receipt.

## Running locally

Preparation works in ordinary Python without torch:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_experiment.py prepare DECLARATION.json .keating/outputs/EXPERIMENT/plan.json
```

Execution loads only already-cached pinned snapshots. There is no download flag.
The existing loader uses `local_files_only=True`, `trust_remote_code=False`,
safe tensor loading, architecture checks and actual checkpoint file hashes.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --python 3.13 --script scripts/training/observer_experiment.py execute .keating/outputs/EXPERIMENT/plan.json .keating/outputs/EXPERIMENT/results.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --python 3.13 --script scripts/training/test_observer_experiment.py
```

UV can install declared Python dependencies; it does not authorize model
downloads. The PEP-723 environment uses CPU torch. A cached-model GPU run needs
the parent's existing compatible GPU environment and invokes `python FILE`, not
the CPU script environment. Outputs must be new files under ignored
`.keating/outputs/` or `.keating/native-learning/`, written with mode 0600.
Existing output paths reject before model loading. A failed run emits no
completed-results artifact; no incomplete measurement is silently counted.

## Runpod integration

The manager now preserves `extract` as its default and supports explicit
`readout` and `intervention` jobs through `observer_experiment_job.py`.
[The job contract](observer-experiment-job.md) documents preparation, exact
token preflight, pinned materialization, model reuse, progress/partial outputs
and validation. The integration covers these seams together:

1. Mode-specific source/archive allowlists keep the extract bundle unchanged.
2. Preparation validates the helper job, private join and preflight; it does not
   pass experiment plans through the extraction-only projection transform.
3. The frozen runner performs explicit pinned materialization, then offline
   execution, under the existing creation-time and cleanup limits.
4. Complete or incomplete exports retain strict per-file and 128 MiB TAR caps.
5. Experiment import checks exact matrices, asset/code hashes, token spans,
   calibration boundaries and unknown outcomes. Private joins remain local.

Keep remote lifecycle, costs, authenticated receipts and cleanup in the parent
controller. Local forward completion is not proof of pod execution, and a pod
receipt is not an independent pedagogical outcome.

## Evidence and next gate

The 15 CPU tests execute real toy-model forwards and verify signed displacement,
norm-matched controls, downstream changes, tensor/tuple batch preservation,
failure cleanup, RNG restoration, repeatability, source split/temporal checks,
all pooling rules, readout extraction across all three source partitions before
direction selection, and local-only loader arguments. Authored fixture reviews are
explicitly marked as such. No published Qwen weights, provider, remote pod,
independent behavior judge or human learning study was run for this work.

Every trial retains `independent_behavior_review.status: unknown`, a null
outcome, null `readout_quality`, and null `causal_behavior_effect`. The same
null distinctions appear in the declaration. Independent reviewed outcomes and
held-out probe comparisons are the next evidence gate; tensor displacement
alone cannot establish a useful causal teaching intervention.
