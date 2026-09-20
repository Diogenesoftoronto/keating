# Native sequential curriculum

`scripts/training/native_curriculum.py` coordinates one account's actor weights
through ordered topic stages. It measures every declared evaluation slice at the
root checkpoint, collects the first topic, validates and dispatches one update,
measures **every** slice again, then collects the next topic using the updated
actor. A stage cannot skip a missing evaluation receipt. Future-topic slices are
measured too, so the resulting matrix can retain pre-training observations.

The coordinator reuses `native_continual.checkpoint_lineage`, `select_replay`, and
`retention_report`, plus `native_tinker_update.prepare_update`. It does not issue
admission approvals, independent reviews, spend authority, or promotion decisions.
Only `native-tinker-update/v1` is supported. The combined custom updater is **not
implemented** here; its acknowledgment semantics cannot be substituted.

## Frozen input

A curriculum is a JSON object sealed with
`native_training.seal(value, "curriculum_hash")`. This example shows the complete
shape in Python; replace the input variables with actual independently prepared
records before using it. No model or family inventory is invented by the CLI.

```python
import native_training as nt

spec = nt.seal({
    "schema_version": 1,
    "kind": "native-curriculum/v1",
    "update_consumer": "native-tinker-update/v1",
    "owner": {
        "account_id": account_id,
        "project_selection": "explicit",
        "project_id": tinker_project_id,
    },
    "root": {
        "id": "initial",
        "model": actor_model_id,
        "training_checkpoint": initial_training_uri,
        "sampler_checkpoint": initial_sampler_uri,
    },
    "measurement": {
        "observer_model": observer_model_id,
        "observer_manifest_hash": frozen_observer_manifest_hash,
        "probe_card_hashes": {"profile": frozen_profile_probe_card_hash},
        "simulator_revision": simulator_revision,
        "metric_revision": metric_revision,
    },
    "registry_revision": registry_revision,
    "families": complete_family_entries,
    "protected_evaluation_families": ["fractions-eval", "geometry-eval"],
    "benchmark_v4_families": ["fractions-eval", "geometry-eval"],
    "replay_policy": {"max_updates": 2, "seed": 42, "revoked_aliases": []},
    "stages": [
        {"id": "fractions", "topic": "Fractions",
         "train": [{"scenario_id": "fractions-native", "family_id": "fractions-train"}],
         "evaluate": [{"scenario_id": "fractions-heldout", "family_id": "fractions-eval"}],
         "quotas": {"recent": 1, "reservoir": 0, "hard": 0}},
        {"id": "geometry", "topic": "Geometry",
         "train": [{"scenario_id": "geometry-native", "family_id": "geometry-train"}],
         "evaluate": [{"scenario_id": "geometry-heldout", "family_id": "geometry-eval"}],
         "quotas": {"recent": 1, "reservoir": 1, "hard": 0}},
    ],
}, "curriculum_hash")
```

`complete_family_entries` is the full, ordered `families` array used by the
existing updater split manifests. Entries contain `family`, `aliases`, `split`,
`protected`, and pinned `sources` records. Every collection's externally approved
split manifest must match this array and `registry_revision` exactly, while
binding its own export and episodes. Existing validation checks source identity,
source hashes, aliases, original splits, and admission provenance.

Populate `benchmark_v4_families` from the parent-maintained v4 inventory, including
public development challenge families. Every listed family must be protected,
non-training, and evaluated in the curriculum. Exclusion applies to the **entire
family**, including sibling scenarios and known aliases. The coordinator cannot
discover omitted families or unknown reformulations. Source-document adaptation
and the actual v4 inventory remain with the scenario/export producer.

Scenario IDs must be globally unique within the curriculum; each training stage
must contribute a selected fresh capture for every declared training scenario.
Every evaluation slice contains its explicit scenario/family pairs. The callback
must evaluate all of them under the pinned metric. Scenario contents are supplied
by the external scenario registry and original native evidence, not resolved by
this module.

Observer and actor are separate **roles**. Both may start from
`Qwen/Qwen3.5-9B-Base`; unequal model names are not required. A Qwen 27B observer
with an InklingSmall actor is also representable if compatible frozen manifests,
probe cards, captures, and Tinker checkpoints exist. No model is downloaded or
selected automatically. The observer manifest, probe cards, simulator and metric
remain frozen even as actor checkpoints advance. The updater's SDPO teacher is a
separate actor snapshot and must not replace this measurement observer.

The owner is bound into the curriculum and every work request. Every prepared
update must use its exact project selection and project ID. For an intentionally
selected account-default project, set `project_selection: "account_default"` and
`project_id: null` in both curriculum and updater config. The account ID is a
declaration; the driver must verify that its credentials belong to that account.

## Inspect without spending

From the repository root:

```sh
rtk proxy python -B scripts/training/native_curriculum.py /path/curriculum.json \
  --journal /path/curriculum.jsonl
```

The default and only CLI operation validates the manifest and existing journal,
then prints `status`, concrete `next_work`, checkpoint lineage, evaluations, the
all-slice matrix, and retention for completed training topics. It creates neither
a journal nor a provider client and has no execute flag. Invalid input exits 2.
`dispatches: false` describes this inspection operation, not historical activity.

## Injected execution API

Import from `scripts/training`, create the journal's parent directory, then use:

```python
from native_curriculum import Curriculum

run = Curriculum(journal_path, spec)       # read-only construction
next_work = run.inspect()["next_work"]   # read-only; full sealed request
state = run.step(collect=collect, update=update, evaluate=evaluate)
```

Each `step` makes at most one synchronous callback. Only the callback for the
current operation is required. Each callback receives a copied request containing
`work_hash`, `curriculum_hash`, owner, complete frozen measurement, and the exact
current parent node, including both training and sampler checkpoint URIs.
Return this envelope, preserving the request's measurement:

```python
{"work_hash": work["work_hash"], "measurement": work["measurement"], "value": value}
```

The three callback values are:

| Driver | Request additions | Returned `value` |
| --- | --- | --- |
| `collect(work)` | Stage/topic, training scenarios, quotas, replay policy, prior export hashes | `{"bundle": exports, "splits": approved_splits, "config": sealed_update_config, "signals": signals_or_none, "assignment": replay_assignments}` |
| `update(work)` | Stage/topic, original `inputs`, exact prepared `plan`, replay `selection` | Actual sealed `native-tinker-update/v1` result |
| `evaluate(work)` | Slice/topic and its evaluation scenarios | `{"score": score_or_none, "assessment_count": count, "assessment_hash": hash}` |

The collection driver can invoke the existing TypeScript `runNativeEpisode` with
the parent's sampler, adaptive learner, and pinned simulator, then use the
parent's validated native exports. Existing `source_document` / `source_observation`
runtime evidence remains in that path; do not reconstruct original actor tokens
or replace original evidence with a transcript. The driver performs artifact hash
verification for the frozen observer/probes and stores its receipts before
returning. This module supplies no inference adapter or automatic reviewer.

Collect a batch containing current captures and any replay captures from your
persisted export store; `replay_exports` identifies the preceding export hashes.
Refresh independent admission/revocation checks externally before dispatch. A
new revocation incompatible with the frozen policy must stop this run; do not
rewrite the journal to bypass it.

`assignment` uses the existing selector's exact format:

```python
{capture_hash: {"bucket": "recent", "rationale": reason, "evidence_hash": evidence_hash}}
```

Quotas are capture counts: nonnegative integers totaling at most eight per stage,
with at least one recent capture. Recent captures must belong to the current
stage and current sampler. Reservoir captures must reproduce a previously
selected original record exactly. Hard captures can be current or previously
selected, with explicit rationale/evidence. Every selection still passes the
existing ancestor-distance, protected-family and revocation checks. Quota
shortfalls stop; counts are never redistributed. `config.capture_hashes` must
match the selection exactly. Replayed rows preserve original capture, behavior
probabilities, runtime-event, family, and review bindings. Full bundles, signals,
split manifests, and prepared plans remain in the journal.

`prepare_update` runs before the update callback and is rerun by the actual
updater before spending. For example, an **already authorized** adapter can use:

```python
import native_tinker_update as nu

def update(work):
    data = work["inputs"]
    result = nu.execute_update(
        data["bundle"], data["splits"], data["config"], data["signals"],
        budget_path=authorized_budget_path,
        cap_usd=authorized_cap,
        output_dir=new_output_dir_for(work["work_hash"]),
    )
    return {"work_hash": work["work_hash"],
            "measurement": work["measurement"], "value": result}
```

Use the existing updater's independent approvals, budget ledger, capture/token
validation, freshness checks, and single-attempt execution. No new approval is
manufactured here. The next stage inherits the acknowledged **training weights**;
the corresponding sampler is used for collection and evaluation. Both saved
checkpoints must match the acknowledged client and plan. Sibling resets, repeated
plans, incomplete saves, and unacknowledged updates fail existing lineage checks.
The current updater resets optimizer moments from pinned weights at each stage;
this is sequential weight adaptation, not continuous optimizer-state restoration.

## Evaluation and resumption

Each root/post-update checkpoint requires one receipt for every slice, in declared
order, before collection may advance. An omitted driver or receipt blocks. An
explicit receipt with `score: null` records an attempted but unscored evaluation;
it satisfies receipt coverage and allows sequencing, while scores, plasticity,
and forgetting remain unknown. This is an execution coordinator, not a quality
or promotion gate. A numeric score must be finite in `[0, 1]` with a positive
assessment count. `assessment_hash` must identify the driver's actual persisted
assessment artifact, including coverage of the slice's scenarios. Hashes bind
producer declarations; this module does not independently score those artifacts.

The JSONL journal uses hash-linked events, an advisory process lock, and fsynced
dispatch intent **before** calling any driver. Receipt writes are also fsynced.
Reopening validates and replays the entire history through the same admission,
lineage, replay, and measurement checks. A changed curriculum, account, observer,
probe, metric, simulator, scenario sequence, family inventory, or quota fails.

If a callback fails, returns invalid evidence, or completes remotely before its
receipt can be persisted, inspection reports `needs_reconcile`. Further `step`
calls cannot dispatch anything, including the optimizer. Recover the original
driver receipt and use:

```python
state = run.reconcile(recovered_receipt)   # validates evidence; never dispatches
state = run.reconcile(recovered_receipt)   # identical receipt is a no-op
```

There is no retry/reset escape hatch and no assumption that a timeout means the
optimizer did nothing. A partial updater result without both saved checkpoints
cannot be reconciled as completion. Interrupted collection and evaluation are
also stopped to avoid repeating potentially paid work. A truncated or corrupt
journal fails closed and requires external evidence-based recovery; automatic
tail repair and provider reconciliation are not implemented. Do not delete,
truncate, replace, or fork an active journal to retry uncertain work. Guarantees
assume a local filesystem honoring `flock`/`fsync`, stable journal storage, and
drivers that neither retry nor dispatch unrelated work internally.

## Local verification and limits

```sh
rtk proxy python -B -m unittest discover -s scripts/training -p test_native_curriculum.py
```

Tests exercise a two-topic callback sequence, all-slice evaluation, preceding
parent binding, same-model observer/actor roles, account and measurement freeze,
v4 exclusion, replay quotas/original evidence, missing/null evaluation, durable
intent, partial failure, concurrent access, idempotent reconciliation, and the
read-only CLI. One test calls the real `execute_update` function with an injected
fake SDK/service and consumes its resulting acknowledgment; no test performs
inference or uses credentials.

This establishes local coordinator behavior. It does **not** establish a live
multi-topic training run, checkpoint availability/restoration, real observer or
probe compatibility, account credential ownership, artifact truthfulness,
provider billing, retention gains, human learning, promotion, or deployment.
Source-document production, complete v4 family classification, and live driver
integration remain external. Existing source and benchmark files are unchanged.
