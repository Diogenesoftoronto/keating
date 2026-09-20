# Bounded Runpod observer job

`scripts/training/observer_runpod.py` prepares and supervises one GPU extraction
using the [independent observer](observer-pipeline.md). It uses Runpod **REST v2**
at `https://api.runpod.io/v2`. Preparation runs locally, without credentials,
provisioning, model downloads or inference. There is no notebook launch toggle.

Explicit `--job-mode readout|intervention` support is now available through the
[bounded experiment helper](observer-experiment-job.md). It adds metadata-pinned
assets, exact pre-launch token preflight, one resident model across selected
layers, per-trial checkpoints and separate incomplete exports. Omitting the
flag preserves this document's extraction path. Experiment preparation requires
`--local-join` and `--preflight`, and caps must match the helper job exactly.
The first actual four-layer experiment failed before trial zero during uv's
dependency download. Original outputs were preserved; this is no readout result.
Pre-materialization failures now import as `diagnostic.local.json` with
`diagnostic_valid: true`, while `experiment_valid`, `partial_valid`, and
`fit_eligible` remain false. The state records `worker_failure_stage` separately
from `experiment_error`, which is reserved for invalid imports. No retry is
automatic. See the helper documentation for the exact diagnostic contract.

New readout/intervention jobs can now declare the **image Python 3.12 overlay**
through helper `prepare --overlay-metadata`. See
[the preparation commands and runtime contract](observer-experiment-job.md#image-python-312-overlay-current-experiment-path).
The manager binds the 27-wheel lock, raw image proof, installer hash and token
preflight into its plan/archive. The later worker reuses actual image Torch
2.8.0+cu128/CUDA12.8 after a BF16 check, fetches at most 64 MiB including retries,
then installs offline inside a system-site-packages venv. Bootstrap is capped
at 300 seconds within the existing work deadline. There is no uv/Torch/NVIDIA
download fallback in this mode. `environment.json` records actual runtime and
overlay verification; imports require it for measurements. Extract default and
historical reports remain unchanged.

New plans pin `execution_root` to `/tmp/observer-<job-id>` for the code bundle,
dependency venv and small output files. Large Hugging Face assets remain cached
on `/workspace`, using the declared 80 GB volume. A native two-action measurement
timed out during offline package installation on that mounted volume; the local
execution directory avoids putting package-file writes there. The package hashes,
300-second bootstrap bound, model pins and extraction code are unchanged. Plans
without this field retain their original `/workspace/observer-<job-id>` location
when the controller source matches their sealed plan; the path fallback does not
waive source-hash checks. An arbitrary or another job's directory is rejected.
The replacement two-action job completed both forwards and recorded deletion;
see the [native result](native-combined-results.md).

The overlay's **18 helper / 42 manager tests passed** locally. Both modes
exercise the generated bundle bootstrap and diagnostic runner with authored
local processes. The original failed v2 archive imports with its cuFFT error
and zero measurements, without altering its plan/state/archive. No wheel,
image, model download or paid execution was performed for this fix. The next
120-record layer-12 source pack is prepared separately by the coordinator;
the previous 40-record four-layer plan is preserved without a new run.

Use `report --job-dir JOB` to inspect historical stored evidence after source
changes. This command is offline and does not instantiate the operational job
or bypass its source-hash guard. Historical archives/plans remain untouched.

## First verified extraction — 13 September 2026

The user approved one shared **$100 research budget** across Runpod and Tinker.
The successful job is preserved in `.keating/native-learning/observer-job-ready-v5/`:

- Plan SHA256: `c25682d2adf23dd69a8eaa18b9ca44278a74c74f1a533deb8cd7ff67009bfb92`.
- Output archive SHA256: `63d80db0bbbc7a6f4553d9c865c71978fdb28f315ebfb8c087d31f283eb47b0d`.
- Six actual Bridge trace projections; 4,096 residual coordinates and a
  65,536-coordinate SAE, signed Top-K 50 per selected token.
- `exit_code: 0`, `extraction_valid: true`; original model, input, source,
  layer, software and event-boundary checks passed.
- Outputs persisted before deletion; the provider subsequently returned 404
  for the owned pod, confirming termination.

`features.local.json` retains local provenance joins; `outputs.tar` preserves
the unchanged remote evidence. These are real Qwen features of plumbing traces
with authored tutor/learner behavior. They are not trained-probe results or
evidence of human learning.

Two earlier attempts also preserved their failure logs and terminated. The first
hit Ubuntu's PEP-668 package protection; the corrected runner installs `uv` in a
private `bootstrap/` target. The second exposed Transformers returning a set of
unused checkpoint keys; the extractor now writes a sorted list. Three $5 grants
remain reserved conservatively. Their combined estimated running cost is about
$0.09; invoice reconciliation is separate.

## Preserved preparation history

The preserved v1 launch candidate is in `.keating/native-learning/observer-job-ready/`
(ignored local output). The parent prepared it with a live authenticated REST
v2 quote and a dedicated local SSH key. It contains `plan.json`, `request.json`,
`payload.tar`, `input.review.json`, `join.local.json`, and `state.json`.
Its immutable plan SHA256 is
`b985f76a97cebbe823f947410e21aba29e83f86b05fa3357e9bc85fb06437b6a`;
the payload SHA256 is
`fa7526132330026d34861a21a29d7c216b657ec02ce6314735615a79cd313203`.
`launch_ready: true` means the required preparation fields are present, not
that spending is approved or the quote is still fresh. No pod was created from
this original candidate.

This preserved v1 candidate retains the official image **tag** it originally
recorded and predates the supervisor-source pin. The final manager rejects
plans without that pin. Later attempts used new directories, fresh L40S quotes
and new confirmation hashes, preserving each earlier plan. The earlier
`observer-job-review/` remains
an explicitly unlaunchable planning draft for provenance.

The parent's latest authenticated REST v2 query with `minCudaVersion=12.8`
reports no A6000/A40/Ada availability and MEDIUM availability for secure L40S
at $1.09/hour. The fixed observer GPU is therefore now NVIDIA L40S, still 48GB.
Each attempt used a $5 grant and two-hour duration, with a $1.20/hour cap
including the storage allowance. Old plans cannot load under the changed
supervisor source hash.
The parent may launch this same job under the existing approval after preparing
its fresh hash; the re-preparation does not require another budget question.

| Item | Prepared setting |
| --- | --- |
| Input | `observer-first-job-input.json`: six Bridge ledger projections |
| Parent's tokenizer preflight | 53, 76, 101, 101, 170, 212 tokens; 713 total, max 212 |
| GPU | One NVIDIA L40S, 48GB, secure cloud |
| Host | At least 64GB RAM, eight vCPUs, CUDA 12.8 driver compatibility |
| Storage | 80GB host-local persistent `/workspace`, 10GB container disk |
| Execution | BF16, batch one, layer 12, at most 1,024 tokens per projection |
| Duration | Two hours from creation attempt, including provisioning/downloads |
| Cleanup allowance | Extraction ends three minutes before the duration limit |
| Hourly cap | $1.20 including conservatively estimated running storage |
| Authorized total grant | $5; normal run ceiling $2.40 plus $0.10 preservation reserve |
| Parent's live GPU quote | $1.09/hour, secure L40S, MEDIUM availability, authenticated REST v2 |
| Two-hour estimate | About $2.21 including running storage; availability unreserved |

These settings describe the prepared job. The successful extraction below
independently verified all six inputs and returned actual model features and
token counts. Peak GPU/RAM use and final invoiced billing were not measured;
the runtime cost is an elapsed-time estimate. The six inputs do not establish
tutoring effectiveness, a trained probe, or held-out probe quality.

Initial prepared input SHA256:
`6d899b4ff1b02ff5ee5958bf2d060b0dc10227c9eb53bb6b95bd312ae8d424e4`.
The sanitized upload SHA256 is
`0ab4eb8c33d7f812b28997915bc5e6ce84ebc6e833c53eaf41f86130dd203c96`.
Use the actual `plan.json` and `state.json` hashes for review; re-preparing
creates a new job identity and requires a new confirmation hash.

## Limits that the provider can and cannot enforce

The current REST v2 `CreatePodRequest` has no dollar ceiling, maximum hourly
price, TTL or scheduled-termination field. This implementation rejects
insufficient/nonfinite limits, refreshes the GPU rate immediately before
creation, checks the actual `Pod.cost`, and bounds every control-plane and
SSH operation. Its clock starts **before** the one creation request and
survives process restarts. Provisioning and downloads consume that allowance.
The remote runner independently times out and kills its child process group.

**Keep the local supervisor running on a reliable host for the entire job.**
The remote process timeout stops extraction; it does not stop Runpod billing.
The supervisor stops the owned pod after failures, SIGINT/SIGTERM, excessive
rate or the deadline. A machine crash, killed supervisor, unreachable API or
provider failure can prevent that stop. The proposed two-hour/$5 limits are
operational controls, not a provider-backed guarantee under those failures.
An operator must monitor `stop_unconfirmed` or `creation_uncertain` states.

Outputs and caches live on the host-local `/workspace` volume. This matters:
container disk is lost on stop; the volume survives stop but is lost on
termination and is not protected against host failure. When collection fails,
the manager **stops and retains** the pod rather than destroying its outputs.
That retained volume continues billing at approximately $0.024/hour under our
conservative assumption. The $0.10 reserve covers about 4.2 hours of retained
storage; it is not permission to leave a pod indefinitely. The manager never
automatically restarts a stopped pod or buys another resource for recovery.
[Runpod storage documentation](https://docs.runpod.io/pods/storage/types)
describes these lifecycle and billing boundaries.

Storage arithmetic uses $0.10/GB/month running and $0.20/GB/month stopped,
divided by 672 hours (a conservative 28-day month). It adds running storage
to `Pod.cost` even if the provider quote already includes it. These estimates
are deliberately conservative; actual invoices remain separate evidence.

## Reviewable import and export boundary

The deterministic TAR contains exactly five regular files:

1. `scripts/training/observer_core.py`
2. `scripts/training/observer_extract.py`
3. `input.json`
4. `run.py`, the generated bounded subprocess runner
5. `bundle.json`, the individual file hashes

`plan.json` pins the supervisor's exact `manager_sha256`, the TAR hash, every executable/input hash, original input
hash, local provenance join hash, model/SAE revisions, GPU settings, command,
public SSH key and budget. Source files are copied from their explicit
allowlist; there is no `git archive`, repository walk, `.env` upload, SSH key
upload, workspace sync or implicit adjacent import. Symlinks, duplicate TAR
members and unapproved paths are rejected. Each phase has bounded input/output
sizes. The bundle is rechecked locally and remotely before execution.
Loading a job rejects changes to the supervisor source and to its locally
imported observer validation helper. A guard change requires a new reviewed
plan; it cannot silently change the semantics of an already approved job.

Preparation validates every original projection through `boundary_view`.
It copies only public events through the declared time boundary, necessary
spans and delivery-receipt references. Record/family/event/receipt identifiers
become deterministic aliases. Private events, future events, arbitrary
metadata, source prose, original identifiers, groups, labels and label
provenance remain local. The observer text is checked to be unchanged.
This is field minimization, **not a personal-information scrubber**: public
text must already be approved for cloud processing by the parent.

The parent can inspect `input.json` inside the TAR before budget confirmation.
The original projection file remains untouched. Unknown labels stay unknown.

The remote export contains only `receipt.json`, `extract.log`, and (if produced)
`features.json`. The manager downloads it, verifies every receipt/file hash,
flushes it to local disk as `outputs.tar`, and then records its hash in the
durable state journal. Complete extraction additionally requires matching
input/source/model/SAE/software manifests, exactly the requested records,
valid dimensions, sparse feature shapes and time-boundary views. A successful
SSH transfer alone is not successful extraction.

`features.local.json` joins local labels/groups/provenance onto verified
feature rows. It retains uploaded aliases and adds the original record hash.
`join.local.json` maps those aliases to original IDs. `outputs.tar` remains
the unchanged remote evidence. Failed or invalid results are preserved too,
with `extraction_valid: false`. They are never promoted into a measured probe
result. Once the local archive is verified, the owned pod may be deleted.

## Prepare without account access

Use managed Python; the manager needs only certifi, not Torch:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/observer_runpod.py quote \
  --planning-rate 1.09 --output .keating/native-learning/draft-rate.json

rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/observer_runpod.py prepare \
  --input .keating/native-learning/observer-first-job-input.json \
  --quote .keating/native-learning/draft-rate.json \
  --job-dir .keating/native-learning/new-observer-draft \
  --cost-cap 5 --hour-cap 2 --hourly-cap 1.20
```

All output paths must be new. `--shortest` is available for a single-projection
smoke job; it selects the shortest validated text with a stable record-ID
tie-break. The prepared first job uses all six supplied records.

## Parent preparation before budget confirmation

The parent maps the account's credential to `RUNPOD_API_KEY` in the process
environment. Do not put its value in command arguments, source, an uploaded
archive, the notebook or a recorded shell command. This tool never reads Skate.
It does not send the API key to the GPU pod. A certifi TLS context is explicit;
an existing `SSL_CERT_FILE` is honored. No TLS verification bypass is used.

The parent supplies a dedicated unencrypted ed25519 key pair for automation.
Only the public file is read during preparation; comments are stripped. The
private path is later supplied via `OBSERVER_SSH_PRIVATE_KEY`, never uploaded.
Use disposable keys rather than changing account-wide authorized keys.

The following quote call is **read-only** and does not reserve stock:

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/observer_runpod.py quote \
  --output .keating/native-learning/observer-live-quote.json

rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/observer_runpod.py prepare \
  --input .keating/native-learning/observer-first-job-input.json \
  --quote .keating/native-learning/observer-live-quote.json \
  --public-key /absolute/path/to/dedicated-observer.pub \
  --job-dir .keating/native-learning/observer-approved-plan \
  --cost-cap 5 --hour-cap 2 --hourly-cap 1.20
```

Present that `plan.json`, `request.json`, exact public input, archive hash and plan SHA256 to
the user. This is the reviewable result on which spending confirmation acts.
The live quote must be at most 15 minutes old at launch, and another live
quote must still fit the hourly cap. An expired quote requires a new plan.

## Explicit launch after confirmation only

The parent may execute this **only after** the user confirms the concrete
budget/job plan. Nothing in the draft preparation is that approval.

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --script scripts/training/observer_runpod.py run \
  --job-dir .keating/native-learning/observer-approved-plan \
  --confirm-plan-sha256 FULL_REVIEWED_PLAN_SHA256
```

Before provisioning, the manager checks the local private key against the
public key in the plan. Creation uses the documented secure-GPU request,
80GB persistent mount, `22/tcp`, `startSsh: true`, `startJupyter: false`, and
only the public key and job hash in the pod environment. New plans pin:

`runpod/pytorch@sha256:0a360022e8de4375af99430f84e8b38951acc397252163a37ceac7204d01be35`

This is the public OCI index resolved from the official example tag
`runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` on 13 September 2026.
The index bytes matched the registry's digest; its Linux/amd64 image manifest
is `sha256:4d1721e62b56d345c83b4fd6090664be6daf9312caab5b2e76f23d8231941851`.
Only public registry metadata was read, following the
[Docker registry authentication protocol](https://docs.docker.com/reference/api/registry/auth/).
No account credentials or image layers were fetched. Actual boot, `python3`,
pip, direct SSH and GPU runtime behavior remain to be verified on the pod.

Direct SSH is required because Runpod's SSH proxy does not support file
transfer. The manager validates the returned IP/port and ignores provider
shell-command strings. It disables user SSH configuration and key forwarding,
uses a dedicated per-job `known_hosts` file, and pins subsequent connections
after first-use host-key acceptance. That is trust on first use, not an
independently verified host fingerprint.

The remote runner installs `uv==0.12.5`, uses managed Python 3.13, and executes:

```sh
uv run --no-project --python 3.13 \
  --with 'torch==2.8.0+cu128' --with 'transformers==5.3.0' --with 'numpy==2.2.6' \
  --index https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match \
  python scripts/training/observer_extract.py input.json outputs/features.json \
  --model-revision 68c46c4b3498877f3ef123c856ecfde50c39f404 \
  --tokenizer-revision 68c46c4b3498877f3ef123c856ecfde50c39f404 \
  --sae-revision 7bb2370d360e566b2d8acb8b3d15a0b2b88f52a8 \
  --sae-sha256 2cea61ef74a4d33d59329f7e3d1ddfb4a8cdf3c24acdbc05fc26209679a262d8 \
  --layer 12 --module language_model.layers.12 --device cuda --dtype bfloat16 \
  --max-tokens 1024 --allow-download
```

The external command intentionally uses `python FILE`, not `uv --script`:
the extraction script's inline CPU dependencies would otherwise override the
GPU environment. No old shared training venv is used. Downloaded model shards
are approximately 19.31GB and the one FP32 SAE file approximately 2.15GB;
package caches and runtime buffers need further space. This job is extraction
only: no Tinker request, policy update, simulator call or account budget-ledger
mutation occurs.

## Lifecycle, interruption and recovery

The journal is flushed before `POST /pods`. Creation is never retried by the
transport or the job state machine. A timeout can mean that Runpod accepted
the request: do not create a second job to work around that uncertainty.

`reconcile --job-dir JOB` reads inventory and adopts exactly one pod with the
matching recorded name, GPU shape and unguessable plan-hash marker. Zero or
multiple matches leave creation unresolved. It sends no creation request.
`run` can then resume with the same confirmation hash and the **original**
deadline. All manager commands take an exclusive per-job process lock.

Every lifecycle action re-fetches the recorded pod and checks its ownership.
There is no arbitrary `--pod-id`, account-wide cleanup, template deletion or
volume-wide deletion. Remote `started.json` is created exclusively, preventing
a repeated launch acknowledgement from running the extraction twice.

Commands below all use `uv run --script scripts/training/observer_runpod.py`:

| Command | Behavior |
| --- | --- |
| `status --job-dir JOB` | Read only the owned pod; store sanitized status |
| `reconcile --job-dir JOB` | Resolve a lost creation response without recreating |
| `collect --job-dir JOB` | Download completed outputs from the owned running pod |
| `stop --job-dir JOB` | Stop only the owned pod, preserve `/workspace` |
| `terminate --job-dir JOB` | Delete only after rechecking verified local output bytes |

Normal `run` collects and terminates automatically after completion. On failed
collection, it retains the volume and reports preservation required. Recovery
from an already stopped pod needs a separately approved restart/budget or
provider-supported data recovery; this script intentionally cannot restart
it. Stop and delete are followed by at most three five-second GETs with two
two-second intervals (at most 19 seconds of polling), bounded by the remaining
job allowance. An emergency stop after an expired/resumed deadline retains
one five-second verification opportunity. Transient states such as STOPPING
do not become an immediate success or failure claim.

Deletion is complete only after observed `TERMINATED` or a 404 for the exact
previously verified owned pod, after its deletion was journaled. A lost delete
acknowledgement can therefore be confirmed by a later GET. If no terminal
state is observed, `termination_unconfirmed` and `intervention_required`
remain durable alongside local outputs. The supervisor attempts a bounded
owned-pod stop as a fallback without erasing that unresolved deletion state.
Re-invoking `terminate` after a later 404 confirms completion without another
delete. `stop_unconfirmed` likewise requires intervention. No passing status
is inferred from an unavailable response.

## Verification and primary references

CPU protocol checks (no Torch needed):

```sh
rtk proxy env -u PYTHONHOME -u PYTHONPATH UV_MANAGED_PYTHON=1 \
  uv run --no-project --python 3.13 \
  python -m unittest discover -s scripts/training -p test_observer_runpod.py -v
```

Tests exercise the real generated TAR bootstrap and bounded subprocess runner
with authored local processes. REST/SSH lifecycle tests use injected protocol
fixtures, including timeout-after-create, ownership mismatches, missing
outputs and price violations. They establish management mechanics, not a
real Runpod boot, GPU kernel, model extraction, trained probe, or invoice.

The implementation was matched to the public
[REST v2 OpenAPI contract](https://api.runpod.io/v2/openapi.json), retrieved
13 September 2026, SHA256
`a7d7eb5239506ae49091be1f2435af8757b392d3c346fd6c5b118b7c49fc6f4c`.
It uses `/catalog/gpus/{id}`, `/pods`, `/pods/{id}`, and
`/pods/{id}/action`; all are relative to the `/v2` base. `GET /pods` returns
`{"pods": [...]}`; individual reads/creation return a Pod; deletion returns
204. v1 authentication failures are unrelated to this client.
See the [official REST v2 announcement](https://www.runpod.io/blog/runpods-rest-api-v2-is-here-one-api-for-your-entire-gpu-stack)
for its beta status and the
[storage contract](https://docs.runpod.io/pods/storage/types) for retention and
charges. The exact observer conventions and model-card references remain in
[observer-pipeline.md](observer-pipeline.md).
