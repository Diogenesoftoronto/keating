# Bounded observer experiment jobs

`scripts/training/observer_experiment_job.py` supplies public projection,
local provenance joins, pinned assets, exact token preflight, checkpointed
execution and strict import. `observer_runpod.py` now selects `extract`
(unchanged default), `readout` or `intervention`. The latter modes consume a
prepared helper job, its private join and its exact preflight. No human-only
approval step was added; the existing parent reservation and exact-plan launch
controls still apply. This implementation made no provider calls or model
downloads. New remote execution remains the parent's next verification step.

## Offline preparation and source boundaries

Start with the sealed plan described in [observer experiments](observer-experiment.md).
The helper's pure interfaces are:

```python
uploaded_plan, local_join = project_experiment_input(plan, source_records=None)
inventory = inventory_from_metadata(plan, documents_by_repo_and_revision)
job, local_join = prepare_job(plan, inventory, limits, source_records=None)
flight = preflight(job, tokenizer)
validate_experiment_result(job, result, flight, materialization)
verified = import_outputs(job, local_join, original_tar_bytes)
```

All source families, including unselected families, keep their existing group
connections and train/calibration/test assignment. Record, family, group,
event, receipt and review identifiers receive deterministic full-SHA256 aliases.
The full closure participates in validation. This does not perform or weaken
source-registry admission. Private/future events, labels and extra metadata do
not enter the upload. Operational concept definitions and control rationales
are retained as declared public scientific configuration; they never enter
observer text. Text minimization is not a personal-information scrubber.

Original plan/card/split/record hashes and the uploaded plan hash remain separate.
Provide `--source-records` to retain local labels/provenance: their bytes must
match the original record hashes. Missing labels remain missing, and null labels
remain null. `join.local.json` is never uploaded. Import produces a separate
local join keyed by trial/record; it does not mutate remote features and retain
a stale remote result hash. Source labels are not inherited by changed native
episodes.

The explicit `limits.json` fields are:

| Field | Bound |
| --- | --- |
| `max_tokens` | 1–4,096 per complete record; no truncation |
| `max_forward_passes` | At most 4,096, including calibration |
| `max_forward_tokens` | Explicit aggregate, at most 4,096 × 4,096 |
| `max_asset_bytes` | Explicit, at most 70 GiB inside the parent's 80 GB volume |
| `max_result_bytes` | Explicit, strictly below 64 MiB |
| `max_log_bytes` | Explicit, at most 8 MiB |
| `cost_cap_usd`, `hour_cap`, `hourly_cap_usd` | Must match supervisor preparation; 0.1–2 hours; total covers hours × hourly cap + $0.10 |

The cap is per job, not a replacement for the parent's shared budget ledger.
Storage is conservatively added at 9/672 USD/hour. The worker checks the supplied
rate observation and original creation timestamp; the supervisor continues
actual rate checks and owns cloud stop/delete. Materialization verifies initial
rate freshness; execution retains the same creation deadline after a long
download. Work ends before the supervisor's 180-second cleanup reserve; the
execution helper leaves another ten seconds for checkpoint finalization.
The parent process-group timeout remains necessary: a blocked native/GPU call
can delay Python signal handling, and a worker alarm does not stop cloud billing.

## Assets: metadata first, weights only in an explicit later stage

`metadata` reads only the official Hub metadata endpoint at exact commits. It
does not fetch model or tokenizer weights. `inventory_from_metadata` selects
the files used by the existing loader and rejects missing revisions/layers,
wrong SAE hashes, duplicate paths and missing byte sizes. LFS objects bind
SHA256; ordinary Git files bind their Git blob SHA1 (`blob SIZE\0` plus bytes).
Materialization also records each actual file's SHA256.

Primary metadata checked on 13 September 2026:

| Asset | Exact revision / size |
| --- | --- |
| Qwen model and tokenizer | `68c46c4b3498877f3ef123c856ecfde50c39f404`; 19,329,294,358 bytes in the selected file union |
| SAE release | `7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8` |
| `layer12.sae.pt` | 2,147,764,603 bytes; SHA256 `2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8` |

Sources: [pinned model metadata](https://huggingface.co/api/models/Qwen/Qwen3.5-9B-Base/revision/68c46c4b3498877f3ef123c856ecfde50c39f404?blobs=true),
[pinned SAE metadata](https://huggingface.co/api/models/Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50/revision/7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8?blobs=true).
These are download sizes, not GPU memory measurements. Each additional layer
needs its own metadata-confirmed size/hash; layer 12's hash is never reused.

`materialize` first checks the exact cache. Missing assets require its explicit
`--allow-download` flag. Downloads use only the two known repositories, pinned
revisions and selected filenames, with implicit Hub credentials disabled. It
requires free space for twice the missing bytes plus 8 GiB of staging/package
headroom, and verifies every local size/object hash. Cache presence is not proof
of byte integrity. No `trust_remote_code` or arbitrary remote command is allowed.

The cached tokenizer preflight can run locally before a pod is created without
model weights. It verifies tokenizer assets against the inventory and records
exact input IDs, offsets, selected spans, forward counts and conservative output
size. The manager requires this preflight and compares the remote preflight hash
on import. Execution is fully cached/offline; materialization is a separate stage.

## Compute reuse and output size

Readout performs `layers × seeds × records` forwards. Each forward serves all
pooling rules. Intervention adds a baseline and four controls for every nonzero
epsilon; calibration records run once per layer, not once per trial. Exact
aggregate tokens include those calibration passes.

The helper loads one base model/tokenizer per job. Subsequent layers load only
their own pinned SAE and choose the exact decoder block on the resident model.
It releases each previous dictionary before loading the next. Model/tokenizer
hashes and settings remain fixed. Per-layer manifests record `model_reused`
and the helper implementation hash. It still performs a separate full forward
for each layer/trial: simultaneous multi-layer capture is not implemented.
The older standalone `observer_experiment.execute` remains unchanged.

For **200 records × 4 layers × 3 poolings**, one readout seed means **800
forwards**. With one span per record there are at least **2,400 pooled vectors**.
The conservative 32-byte-per-number allowance for raw vectors alone is
`2400 × 4096 × 32 = 300 MiB`. Each additional span adds another `per_span_mean`
vector. Sparse features, direction vectors and provenance add further bytes.
This is an admission estimate, not a measurement of a completed export.
Such a job is rejected during pure preparation, before materialization.

Use smaller predeclared record/layer/pooling jobs. Family splits must remain
identical across jobs; chunking transport does not authorize resplitting data.
Token preflight adds sparse-union allowances and actual token/offset sizes.
Actual serialization still enforces the declared file bound; TAR export and
import enforce **strictly <64 MiB per file** and **≤128 MiB total**. No automatic
retry, hidden sample reduction, cap increase or additional pod is introduced.

### Checked first-readout options (13 September 2026)

Offline feasibility evidence is in
`.keating/outputs/observer-readout-feasibility-v1.json` (SHA256
`c4ce9bd5e2726f7aad59db97637cf9acf11eb55bb6ec3aa23ae0d7bb7e928f14`).
This is a workload report, not a prepared or admitted experiment. It reads the
existing `mathdial-probe-v1-prepared` selection without changing its 200 records
or partitions. The local fast tokenizer reproduces **all 200 saved input-token
sequences and selected token positions**: 98,580 input tokens, 3,813 selected
tokens, maximum input length 1,371. The cached config hash matches the completed
extraction manifest and specifies 32 decoder blocks, so indices 8, 12, 20 and
28 are in range. Their individual SAE release hashes still need verification
before preparing that layer set.

The proposed subset/chunk ordering is
`sha256("mathdial-four-layer-readout-feasibility-v1" + NUL + family_id)`.
There is already one selected record per family. Labels are inspected only
after selection; no resampling to improve class balance occurred. The report
retains exact original record IDs and family-set hashes for each option.

| Explicit option, one seed | Full forwards | Forward tokens | Estimated result bound | Admission by size |
| --- | ---: | ---: | ---: | --- |
| 200 records, four layers, mean + last | 800 | 394,320 | 270.727 MiB | Reject |
| 200 records, one layer, mean + last | 200 | 98,580 | 73.682 MiB | Reject |
| 200 records, one layer, mean only | 200 | 98,580 | 47.441 MiB | Fits |
| First 60 records, four layers, mean + last | 240 | 124,400 | 86.833 MiB | Reject |
| First 40 records, four layers, mean + last | 160 | 86,868 | 60.354 MiB | Fits |
| First 30 / next 30, four layers, mean + last | 120 / 120 | 66,996 / 57,404 | 47.072 / 47.762 MiB | Both fit |
| First 100 / next 100, one layer, mean + last | 100 / 100 | 49,258 / 49,322 | 40.740 / 40.942 MiB | Both fit |

For a first single-job mechanics check, the explicitly declared **40-record,
four-layer, two-pooling** option fits with about 3.65 MiB below the file ceiling.
Its train/calibration/test class counts (negative, positive) are (16, 10),
(3, 1), and (8, 2). Both classes exist, but four calibration families do not
support a strong classification conclusion. The 60-record option requires
two 30-record jobs; neither shard alone has both classes in every partition.
Fit only after the complete intended family set has been joined and validated.

For the full **same-200-family, four-layer, two-pooling comparison**, use the
two 100-record chunks at each layer: **eight separately declared jobs**, 800
forwards total. Preserve each original train/calibration/test assignment and
the complete source-family closure in every plan; chunking is only transport.
Join both chunks by original record ID per layer before fitting. This restores
the existing class counts: train (96, 24), calibration (28, 12), test (30, 10).
Alternatively, explicitly declaring mean-only comparison permits four
200-record layer jobs. Neither option silently substitutes for a requested
two-pooling study. Leave the existing 200-record result and the 26 families
reserved outside that selection unchanged. Selecting layers against the
already inspected test set is exploratory, not a fresh release holdout.

The saved historical `features.json` is **23,090,525 bytes (22.02 MiB)**; raw
vectors account for 15,851,458 bytes. Its successful extraction took 25.50
minutes from create attempt through deletion and recorded $0.46743 estimated
running spend. These are historical observations, not a new quote or a
per-forward timing measurement. The new 40-record job has fewer aggregate
forward tokens than that run, but loads three additional dictionaries and adds
hash verification/checkpointing. **45–60 minutes is a planning allowance**, not
a completion guarantee. At the historical combined $1.10339/hour rate that
window costs about $0.83–$1.10 before the declared preservation reserve; the
parent must obtain a fresh quote and bind the $3 cap and chosen hour limit explicitly.
Eight independent jobs repeat cold initialization and require a separate total
reservation; they should not be represented as a one-hour, one-pod workload.

Feasibility used the three locally cached, hash-verified `config.json`,
`tokenizer.json` and `tokenizer_config.json` files. The stricter prepared-job
preflight still requires these **five missing pinned inventory files**:
`merges.txt`, `model.safetensors.index.json`, `preprocessor_config.json`,
`video_preprocessor_config.json`, and `vocab.json`. No missing files were
downloaded for this report. Finish inventory verification, bind the reviewed
concept/full split manifest, and run the normal sealed-job preflight before
launch. Size feasibility alone is not launch readiness.

## Progress, timeout and import

Each completed forward/pooling measurement is appended to `trials.jsonl` and
fsynced before `progress.json` advances. Progress identifies loading,
calibration, active trial, completed trial and finalization. `context.json`
persists model/SAE/calibration provenance after each layer is ready.

On normal completion, export contains `results.json`, preflight/materialization,
progress, bounded logs and a receipt. The checkpoint file remains on disk but
is excluded from a complete export to avoid doubling the result size.
On handled timeout/failure, export contains the completed journal prefix and
`partial.json` instead. Import validates that prefix against the original
matrix, pins, source groups, boundaries, tokens and pooling rules. It sets
`complete: false`, `fit_eligible: false`, and a separate validated completed
trial count. A partial is not silently merged into fitting data or resumed as
though it were a complete job.

A hard kill before helper finalization still exports available raw progress,
context and checkpoints through the parent runner. That diagnostic export is
preserved but is not marked validated/fit eligible when its finalized partial
contract is missing. Torn last records must never be counted as measurements.
Automatic continuation of partial matrices is not implemented.

Before `materialize()` starts, uv may fail while resolving/downloading its
Python environment. A wrapper export containing only `receipt.json` and the
bounded `experiment.log` is accepted as **diagnostic-only** when the job/join
hashes match, both exit codes agree and are nonzero, the declared stage is
`bootstrap` or `materialization`, and the trial count is exactly integer zero.
The importer returns `diagnostic_only: true`, `result: null`, `local_join: null`,
`validated_completed_trials: 0`, and `fit_eligible: false`. Its sealed diagnostic
binds the original archive and log hashes. Missing materialization in any other
shape remains an error; this path cannot admit feature rows or bypass the
64 MiB per-file / 128 MiB archive bounds.

The first actual four-layer attempt failed this way: uv timed out downloading
`nvidia-cufft-cu12==11.3.3.83` from `pypi.nvidia.com` after three retries in
125.5 seconds. The helper never reached model/SAE materialization or trial zero.
The original two-member archive is retained. Local generated-wrapper regressions
reproduce this stage failure in both modes without network access. Diagnostic
import fixes the masked `KeyError`; it does not establish download reliability
or authorize a retry. A future run must prepare fresh code-bound artifacts.

Independent behavior outcomes and causal quality claims remain unknown in
both complete and incomplete exports. `fit_eligible` means the declared feature
job completed and validated; source-label eligibility and probe split rules
still apply independently. A worker-process receipt is not a pod receipt or
a behavioral result. The parent preserves original TAR bytes before deletion.

## Commands and integration

All helper destinations must be new paths under `.keating/outputs/` or
`.keating/native-learning/`. Ordinary Python suffices for metadata/prepare/import.
New experiment jobs should select `--overlay-metadata` as below. Historical
jobs without that field retain the managed Python 3.13/uv 0.12.5 transport;
the extract default is unchanged. The CPU test script declares its own sandbox.
No provider SDK was added.

### Image Python 3.12 overlay (current experiment path)

The already verified public metadata is at
`.keating/outputs/observer-dependency-strategy-v1/`. Its lock pins 27 wheels,
40,871,731 bytes (38.978 MiB), content SHA256
`6cd5bacc3bc3004e70cb1de113798127881ff0d95f5919817a3ab8f2086f4d90`.
Preparation embeds the lock and byte-exact OCI index/manifest/config proof in
the worker job; the helper source hash pins the installer. The manager seals
those bindings, the image digest, commands, and exact local token preflight.
No new lock or image discovery occurs on the worker.

Before downloading any wheel, `/usr/bin/python3.12` must report Python 3.12,
Torch `2.8.0+cu128`, CUDA `12.8`, available CUDA/BF16, and complete an actual
2×2 BF16 GPU multiplication. A per-job `venv --system-site-packages` reuses
that exact image Torch path. The 27 wheels are fetched serially from their
exact `files.pythonhosted.org` URLs, rejecting redirects and size/hash errors.
There are at most two transport attempts per file, 30 seconds per request,
32 MiB per wheel and 64 MiB transferred including failed attempts. The whole
bootstrap (probes, venv, fetch, install, verification) has a 300-second cap
inside the existing job deadline and cleanup reserve.

Installation uses `pip --isolated --no-index --no-deps --ignore-installed
--require-hashes --only-binary=:all:` against only the verified local wheelhouse.
Torch, torchvision, torchaudio, Triton and NVIDIA package downloads are forbidden.
No portable interpreter or uv installation is attempted in this mode. Actual
versions and package paths are rechecked and exported in sealed `environment.json`;
full/partial measurement imports require it. A missing or mismatched image fails
closed with diagnostic output, never another environment or package resolver.

Local preflight may use Python 3.13 with Transformers 5.3.0, tokenizers 0.22.2
and NumPy 2.2.6. The remote Python 3.12 IDs, attention mask, offsets, selected
spans and counts must equal that exact prepared preflight before **any forward**.
This path does not change the source selection, family closure, labels or SAE.

For the parent's next 120-record, mean-only layer-12 declaration, substitute
its accepted plan/inventory/limits/source paths. Every output below must be new.
Preparation does not reserve funds or call a provider:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_experiment_job.py prepare PLAN.json INVENTORY.json LIMITS.json .keating/native-learning/answer-reward-v1/helper --source-records SOURCE.json --overlay-metadata .keating/outputs/observer-dependency-strategy-v1
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --offline --no-project --python 3.13 --with transformers==5.3.0 --with tokenizers==0.22.2 --with numpy==2.2.6 python scripts/training/observer_experiment_job.py preflight .keating/native-learning/answer-reward-v1/helper/job.json .keating/native-learning/answer-reward-v1/preflight.json --cache-dir .keating/cache/huggingface/hub
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --offline --script scripts/training/observer_runpod.py prepare --job-mode readout --input .keating/native-learning/answer-reward-v1/helper/job.json --local-join .keating/native-learning/answer-reward-v1/helper/join.local.json --preflight .keating/native-learning/answer-reward-v1/preflight.json --quote FRESH_QUOTE.json --public-key PUBLIC_KEY.pub --job-dir .keating/native-learning/answer-reward-v1/runpod-job --cost-cap COST --hour-cap HOURS --hourly-cap RATE
```

`COST`, `HOURS`, and `RATE` must exactly match `LIMITS.json`. After the parent
reviews the newly returned plan hash and handles its reservation, the existing
`run --job-dir ... --confirm-plan-sha256 ...` command launches it. There is no
new human-only gate. Do not reuse the failed four-layer job's plan or grant.
The 40-record plan and failed v2 archive remain untouched; no replacement
four-layer job was prepared.

Overlay checks: **18 helper tests and 42 manager tests pass** locally, including
both job modes' actual TAR bootstrap, injected image-version failure, pin and
byte bounds, source/installer binding, pre-forward token mismatch and diagnostic
imports. The original failed v2 archive was also imported read-only with its
cuFFT timeout intact: zero trials, incomplete, not fit-eligible. These are local
checks; this overlay has not yet downloaded wheels or run in the GPU image.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_experiment_job.py metadata PLAN.json .keating/outputs/exp-assets.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_experiment_job.py prepare PLAN.json .keating/outputs/exp-assets.json LIMITS.json .keating/outputs/exp-helper --source-records SOURCE.json
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_experiment_job.py preflight .keating/outputs/exp-helper/job.json .keating/outputs/exp-preflight.json --cache-dir /PATH/TO/HF/HUB/CACHE
```

The preflight command needs the existing Transformers environment and exact
cached tokenizer files. It does not download missing assets.

After the parent obtains its quote and reserves the job budget:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --script scripts/training/observer_runpod.py prepare --job-mode readout --input .keating/outputs/exp-helper/job.json --local-join .keating/outputs/exp-helper/join.local.json --preflight .keating/outputs/exp-preflight.json --quote QUOTE.json --public-key PUBLIC_KEY.pub --job-dir .keating/native-learning/NEW-JOB --cost-cap 1.50 --hour-cap .75 --hourly-cap 1.20
```

The example cost settings must equal the helper's limits; they are not a new
reservation. Use `--job-mode intervention` for an intervention declaration.
`run --confirm-plan-sha256 ...` and lifecycle commands retain their existing
behavior. Omit `--job-mode` to retain the original extraction command/archive.
Expanded worker archives do not pass the extraction bootstrap.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH python3 scripts/training/observer_runpod.py report --job-dir HISTORICAL-JOB
```

`report` reads historical stored evidence without credentials, provider calls
or executing an old plan under new code. Source hash mismatches still block
operational loading; no historical files are rewritten or removed.

## Verification

The standalone test metadata pins Python 3.12–3.13, **torch 2.8.0+cpu** from
the explicit PyTorch CPU wheel index, **Transformers 5.3.0**, and **NumPy 2.2.6**.
The parent can add this command alongside the existing experiment test task:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 uv run --python 3.13 --script scripts/training/test_observer_experiment_job.py
```

Before the overlay extension, **13 helper tests and 38 manager tests passed**, including
real CPU hook/intervention mechanics and the generated remote runner exercised
with injected local stages. No new GPU/model/provider execution was performed.

Run the dedicated helper tests in their pinned CPU sandbox and the manager's
offline test suite. Tests cover full closure/unknown labels, official-metadata
shapes, hash/size mismatch, aggregate work/rate/deadline limits, result tampering,
strict archive bounds, actual toy interventions/checkpoints, single model load
across layers, and complete/partial Runpod imports. Authored protocol fixtures
are not published-weight executions. No new cloud execution was performed.
