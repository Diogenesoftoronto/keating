# Sealed observer generation job

`observer_generation_job.py` wraps an unchanged, valid `readout` job from
`observer_experiment_job`. This is exploratory greedy decoding of the pinned
**Base observer checkpoint**, not the Initial/F-only/S-only/F+S instruction-actor
comparison and not a trained actor update. No human learning or behavioral
improvement is established by generation receipts.

## Controller API

```python
import observer_generation_job as generation
job, join = generation.prepare_job(base_job, base_join, generation_spec)
generation.validate_job(job, check_code=True)
flight = generation.preflight(job, generation.cached_tokenizer(job, None, cache_dir))
generation.validate_preflight(job, flight)
# After independently authorized worker execution:
imported = generation.import_outputs(job, join, archive_bytes)
```

`prepare_job` is offline and does not load Torch, tokenizers, models, credentials
or providers. It returns a new sealed wrapper and a copy of the unchanged local
join. It requires the base job's pinned dependency overlay. `check_seal` is
exported with the base signature `(value, hash_field)`.

Top-level keys are exactly `schema_version`, `kind`, `mode`, `base_job`,
`generation_spec`, `experiment`, `join_sha256`, `source_plan_sha256`, `inventory`,
`limits`, `forward_passes`, `dependency_profile`, `software`,
`source_files_sha256`, and `job_sha256`. Kind is `observer_generation_job`; mode
is `generation`. The experiment and other base-compatible mirrors retain their
original values and seals; the embedded experiment's mode remains `readout`.
Its readout trials are not executed. The generation spec determines the work.

`SOURCE_NAMES` is exactly the base four plus `observer_generation.py` and
`observer_generation_job.py`. Every local source hash must match at prepare,
bootstrap, materialize and execute. `IMAGE_PROOF`, `OVERLAY_LOCK`, and `ARTIFACTS`
are the base exports; there are no new artifact names.

## Exact generation spec

```json
{
  "schema_version": 1,
  "layer": 12,
  "selected_feature": 31497,
  "unrelated_feature": 4962,
  "selected_review": {
    "status": "reviewed",
    "review_id": "selected-candidate-review",
    "reviewer": "parent source reviewer",
    "evidence_sha256": "REPLACE_WITH_64_HEX_SHA256"
  },
  "unrelated_review": {
    "status": "reviewed",
    "review_id": "low-association-comparator-review",
    "reviewer": "parent source reviewer",
    "evidence_sha256": "REPLACE_WITH_64_HEX_SHA256"
  },
  "control_semantic_status": "unverified_low_association_comparator",
  "selected_semantic_status": "candidate_from_probe",
  "epsilon": 0.02,
  "seed": 17,
  "max_new_tokens": 96,
  "calibration_record_ids": ["record-REPLACE_WITH_UPLOADED_CALIBRATION_ALIAS"],
  "generation_record_ids": ["record-REPLACE_WITH_UPLOADED_TEST_ALIAS"]
}
```

Replace the illustrative hash/ID strings with real pins and uploaded aliases.
No additional spec fields are accepted. Review status may be `reviewed` or
`approved`: both refer only to permission to use the candidate in this
exploratory comparison. Distinct review IDs are required; references can share
a document hash. Review documents and their labels never enter the model.
The parent owns checking the referenced review bytes before sealing.

The selected column is fixed at 31497; the comparator is a different valid SAE
column. `unrelated` is exclusively the helper's condition identifier. Neither
that name nor an approved experiment reference attests semantic unrelatedness.
Only the two explicit semantic-status values above are accepted and propagated
to results. Low training-label association is not causal independence.

Calibration IDs must have split `calibration`, generation IDs split `test`.
Both lists are nonempty, unique, and at most 32 records each; the union contains
at most 32 families. Families and group IDs cannot cross roles. These are
uploaded aliases from `base_job.experiment.records`, not original source IDs.
The selected base job must contain exactly `language_model.layers.12`.

## Prompt, model and calibration boundary

Generation uses only contiguous public `learner_message` events in the
`pre_action` prefix, rendered with the existing `[learner_message]` markers and
a final `[actor_message]\n` opening. Mixed-role prefixes fail. No previous
actor completions, reference answers, later events, private labels or review
metadata reach generation. Calibration separately uses the original admitted
boundary and selected spans, including admitted calibration responses.

The worker rehashes all cached assets before loading the model. It delegates
loading to the base worker's exact `AutoModel` path and verifies its manifest
against every full model shard, tokenizer asset and config pin. It then opens
the verified same-checkpoint safetensors shards, requires exactly one actual
`lm_head.weight`, rejects a bias, missing or invalid tensors and inconsistent
shard-index entries, and verifies shape against the loaded text config.
It never initializes an output head or replaces Base parameters.

Each decoding step executes the full backbone, including final normalization,
and returns `F.linear(last_hidden_state[:, -1, :], lm_head.weight)`. The layer-12
hook is an intervention point, not a substitute for downstream blocks. Only
last-token vocabulary logits are materialized. Greedy decoding uses no cache;
history is recomputed without retained patches. There is no model-native
instruction template or sampling temperature.

Before generation, every calibration record receives one actual no-cache
forward. Only its declared selected-token residual norms enter the scale:
the lower median of all selected norms, matching Torch median semantics.
A fixed positive scale is shared across baseline, selected positive, selected
negative, seeded random and low-association comparator conditions. Decoder
columns are normalized. Calibration norms/indices and usage are durably
checkpointed in `context.json`; partial receipts preserve these measurements.

## Bounds and outputs

For `C` calibration records, `G` generation records and `N` new tokens, reserve
`C + 5*G*N` forwards. For each generation prefix of length `L`, reserve
`5*(N*L + N*(N-1)/2)` forward tokens, plus actual calibration input lengths.
There is no EOS discount in admission, batching discount, prompt truncation or
calibration omission. `L+N` must fit the inherited context cap; `N <= 512`.
The base limits cap forwards at 4096. Thus 24 calibration records and eight
generation records at 96 tokens reserve **3864** forwards; 128 tokens fail.
Exact token counts require the cached pinned tokenizer and must match again
on the worker before any forward. Preparation alone is not token preflight.

Inherited asset, result, log, time/rate and cleanup-reserve limits apply. A
conservative result-byte estimate is checked before execution; actual writes
and archive expansion are bounded too. Forward attempts are counted before
model invocation, including failures. Completed records are durable prefixes;
partial records are never fabricated or retried. A hard kill can leave only
partial disk evidence; the parent still owns process supervision and recovery.

Receipts retain `receipt.files` with exact artifact hashes. Complete results
have `complete=true` but always `fit_eligible=false`: these are generation
outputs awaiting independent grading, not readout fitting data. Controller
imports return `complete`, `fit_eligible`, `validated_completed_trials`,
`result`, `local_join`, and `archive_sha256`. A trial is one generation record
with all five conditions. The generation-specific local join binds each exact
remote row hash to its original source record; it does not synthesize readout
measurements. Pre-materialization failures also return `diagnostic_only=true`
and `diagnostic.failure_stage` mapped from `transport_failure_stage`.

Import rechecks source/result binding, exact condition schemas, prefix tokens,
calibration median, unit direction equivalence (1e-6 per coordinate, 1e-5 norm
squared tolerance), selected signs, fixed comparator/random vectors, frontier
masks/timing, EOS, full-prefix work and upper bounds. Hashes and code pins are
integrity and reproducibility evidence, not cryptographic proof of remote
computation or independent semantic validation. Generated IDs are primary;
text decoding and grading remain parent responsibilities.

## CLI and focused checks

The CLI supports `bootstrap-overlay`, `preflight`, `materialize`, and `execute`
with the base worker's positional paths and runtime flags. Bootstrap delegates
the embedded base job unchanged. Materialization and environment receipts stay
bound to the **base job hash**; generation preflight, results, progress and the
worker receipt bind to the **wrapper hash**. `execute` requires `--environment`
and `--expected-preflight`. Only explicit materialization with `--allow-download`
can fetch assets; execution is cached/offline. Controller export may use
`archive_outputs`, which preserves the exact existing artifact allowlist.

```sh
rtk proxy uv run --offline --script scripts/training/test_observer_generation_job.py
```

Tests use authored CPU models, actual tiny safetensors files and mocked asset
load seams. They establish local mechanics, corruption rejection and transport
validation, not a real GPU/model run. No provider request, credential access,
spending, Vet, commit or deployment is part of this implementation node.

## Blinded output review and public inspection

`observer_generation_review.py` imports the verified archive, checks the frozen
behavior protocol against each exact rendered prompt, and decodes original IDs
with the pinned cached tokenizer. It preserves special tokens and whitespace.
Its default accepts only all eight complete five-condition trials. Explicit
`--allow-partial` admits a verified durable prefix of complete paired trials and
retains planned, observed, missing and unknown counts separately.

```sh
rtk proxy python scripts/training/observer_generation_review.py prepare \
  prepared/generation-job.json prepared/join.local.json \
  behavior-review-protocol.json runpod-job/outputs.tar review \
  --cache-dir /path/to/pinned/huggingface/hub
rtk proxy python scripts/training/observer_generation_review.py summarize \
  review grades-a.json grades-b.json review-summary
```

Only `review/blind-packet.json` goes to reviewers. It contains an opaque ID,
learner request, frozen criteria and exact generated output. Condition identities,
source mapping and intervention hypotheses remain in the private review bundle.
Two complete reviews are required. Correctness, request matching and supported
claims retain both verdicts and reasons; disagreement becomes unknown. An absent
execution produces no invented review. Exact duplicate request/criteria/output
triples may be reviewed once per reviewer and expanded with a separately hashed
mapping; they remain repeated conditions of one task, not additional evidence.

`curate_generation_examples.py` verifies those review bundles and the terminated
job, then exports authored tasks, actual outputs, token identities, reviews and
hashes to the public report. `analysis/controlled_generation.py` explores the
saved export with pandas, NumPy and Matplotlib. Neither review preparation nor
the notebook loads a model or makes an inference request. The report inspector
shows baseline and selected conditions side by side, including cutoffs and the
first changed token. The publication audit records actual execution coverage.
