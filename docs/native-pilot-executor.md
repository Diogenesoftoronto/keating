# Native pilot executor

`scripts/training/native_pilot_run.ts` executes explicitly selected slots from the existing Python Stage 1 plan. It calls `runNativeEpisode`, which runs the production Pi harness and responsive learner controller. It does not generate source reviews, approve a golden episode, allocate parent funds, or produce pedagogical ratings.

The development design remains **30 situations × 2 surfaces × 3 replicates = 180 slots**, even if only one funded slot is selected. The original `native_pilot.py` admission, protected-family, review and reporting contracts remain authoritative.

## Before a real run

These are dependencies, not claims that the project has passed them:

1. Obtain a reviewed Stage 0 golden episode and plumbing evidence. A learner that keeps speaking as the tutor does not establish a valid simulator condition. One independently accepted actor segment or acknowledged SFT update does not establish this gate or learning efficacy.
2. Freeze the exact actor, learner, runtime, source files, condition tool schemas and limits. Create the Python plan from the admitted source bundle. Approve all **30 source-context reviews and 60 format reviews**, then obtain `prepare_dispatch`'s dispatch artifact.
3. Prepare only the selected slots' local sampler configurations and execution metadata. Have the coordinator reserve each monetary grant in the existing parent budget. The executor consumes those reservations; it never reserves new parent money.
4. Start the separately managed sampler bridge with the attested configuration. Run the offline checks, then explicitly invoke `run`.

The real adapter supports the existing `native_tinker_sampler.py` actor bridge. The learner can share that slot's checkpoint/cap, or use the delivered `native_tinker_learner.py` instruct bridge with its own parent-funded allocation. Other providers need an enforced allocation and pin mapping before they qualify. There is no fallback to an unpinned learner.

## Files and CLI

No Devenv task or shared runtime file is changed by this implementation. Paths and output data belong under the existing ignored native research directories. CLI writes use `nativeOutputPath` containment checks. Prefer absolute paths in every input file.

```sh
rtk bun scripts/training/native_pilot_run.ts pins
rtk bun scripts/training/native_pilot_run.ts check PATHS_JSON OUTPUT_DIR SLOT_ID [SLOT_ID ...]
rtk bun scripts/training/native_pilot_run.ts run PATHS_JSON OUTPUT_DIR SLOT_ID [SLOT_ID ...]
rtk bun scripts/training/native_pilot_run.ts status PATHS_JSON OUTPUT_DIR
```

`pins` inventories current sources without inference. `check` replays admission, reviews, metadata and funding without claiming a grant. `run` is the only command that invokes models. Selection is explicit; there is no implicit “run all.” `status` rebuilds the `attempts.json` projection from durable slot records without dispatching anything.

`PATHS_JSON` is an ordinary local JSON file:

```json
{
  "scenarios": "/absolute/path/to/admitted/scenarios.json",
  "plan": "/absolute/path/to/plan.json",
  "dispatch": "/absolute/path/to/dispatch.json",
  "execution": "/absolute/path/to/execution.json"
}
```

Optional `cache` and `registry` override the Python admission inputs. Optional `python` selects an already installed interpreter. The executor clears leaked `PYTHONHOME` and `PYTHONPATH`, disables bytecode writes, and uses argument arrays rather than shell interpolation. No package installation or dataset download occurs. Admission requires all pinned cached source inputs; a missing cache fails closed.

## Execution metadata and pin meanings

The exported `PilotExecution` and `SlotExecution` types are the complete transport contract. The top-level metadata contains:

| Field | Meaning |
| --- | --- |
| `kind` | `native-pilot-execution/v1` |
| `plan_sha256`, `dispatch_sha256` | Opaque Python seals from the original artifacts |
| `runtime_revision`, `source_hashes`, `controller_source_hashes` | Output of `pins`; exact current files supplement the Git revision in a dirty tree |
| `paired_seed_policy` | Currently `record_only_backend_uncontrolled` |
| `stage_zero` | `approved: true`, `independent: true`, independent `reviewer`, and `evidence: {uri, sha256}` pointing to a local reviewed evidence artifact |
| `parent_budget` | Existing ledger's absolute `path`, `project`, `model`, and decimal-string `cap_usd` |
| `slots` | Map from selected/funded slot IDs to `SlotExecution`; it may cover a subset of the 180 slots |

Each configured slot contains the actual `actor_transport`, `learner` (`JsonLearnerConfig`), `allowed_tools`, `tools`, absolute `grant_path`, and absolute `sampler_config_path`. Optional absolute `learner_config_path` selects the separate instruct bridge.

Actor transport uses `kind: "provider"`, explicit provider/model/HTTPS endpoint/API-key environment name, `thinking: "off"`, and explicit `modelMetadata` token limits. The learner uses an attested `/chat/completions` endpoint, explicit model/revision, temperature, output limit and `json_mode: "prompt_only"`. Store environment variable **names**, never keys. Credential retrieval and bridge startup belong to the coordinator.

Pin conventions are explicit:

- Actor `prompt_sha256` is the raw UTF-8 hash of **`SYSTEM.md`**. It is not a claim that the fully composed Pi prompt equals that file. The complete runtime inventory pins other shipped prompt inputs; actual composed prompts remain in runtime request receipts.
- Learner `prompt_sha256` is the raw UTF-8 hash of the current `LEARNER_PROMPT`.
- Condition `tool_schema_sha256` is Python `native_scenarios.digest` of the Pi request's **`context.tools` array**. Capture it from the intended capability condition. `allowed_tools` must agree with its names. Empty tools are an explicit condition, not evidence of an interactive activity.
- `surface_instruction_sha256` is the raw UTF-8 hash of `nativeSurfaceInstruction(slot.condition)`. The executor checks actual configuration and request instruction suffixes. Chat observations must have empty document and action arrays.
- Model `revision` binds the immutable sampler checkpoint, while `model` binds its served public alias. The sampler config also validates the underlying model/tokenizer/renderer pins.

For the separate instruct learner, `model` is its model ID and `revision` is Python `native_scenarios.digest({k: config[k] for k in ("model", "tokenizer", "renderer", "versions", "sampling")})`. This semantic configuration hash is stable across slot allocations. It explicitly includes the adapter's `provider_weight_revision: "not_attested_by_tinker_base_model_api"`; it must not be described as proof of immutable hosted weights. `JsonLearnerConfig.revision` and the plan learner revision must both use this hash.

**Python seals are never recalculated with `nativeHash` or `JSON.stringify`.** The offline bridge calls `load_admitted_bundle`, `validate_pilot`, and `prepare_dispatch`, comparing the entire reconstructed artifacts. This preserves Python's sorted Unicode JSON and number spelling. The existing budget and sampler artifacts retain their separate `native_training.native_hash` seals. Execution metadata and local receipt references use hashes of actual file bytes.

Current Pi and `JsonChatLearner` APIs do not forward the Python paired seed. The executor records each slot's seed and the explicit uncontrolled-backend policy, and makes no seed-matched sampling claim. Replicates and situation pairing remain intact. Passing a seed requires a separately reviewed transport change, including the sampler's narrower accepted integer range; silently truncating the planned seed would change the experiment.

## Funded per-slot grants

Build the execution file before sealing grants, since a grant binds its raw file hash. Merely naming a dollar amount in metadata is insufficient. Each grant must already be present in the coordinator's existing `native-research-budget/v1` ledger with matching phases and reserved amount.

The coordinator creates a `native_training.seal(..., "plan_hash")` record with this content:

```text
kind: native-pilot-slot-grant/v1
slot_id: <exact Python slot ID>
plan_sha256: <Python plan seal>
dispatch_sha256: <Python dispatch seal>
execution_sha256: <raw execution.json SHA-256>
sampler_config_sha256: <raw per-slot sampler config SHA-256>
bridge_endpoint: <attested HTTPS API base, ending /v1>
phases: [native_pilot_episode]
cost: {reserved_usd: <positive decimal string>}
```

Reserve that sealed grant using the **existing** `BudgetLedger.reserve` under the parent project's approved aggregate cap. The executor never performs this step. The attestation means the coordinator has bound that endpoint to that exact config; file checks alone do not authenticate a running remote server's weights.

Each actor sampler configuration must pass `native_tinker_sampler.sampler_config`, use `allocation.id == slot_id`, and use a dedicated absolute local ledger path different from the parent ledger and other slots' ledgers. Its cap must be no larger than the parent slot reservation. With a shared checkpoint, both roles draw from that slot cap. Existing local ledger identities, caps and total reservations are checked. Output limits must fit each sampler's limits. No failure automatically refunds either reservation.

For a separate instruct learner, add `learner_config_sha256` (raw file hash) and `learner_endpoint` to the sealed slot grant. The executor calls the delivered adapter's `learner_config` and `funded_ledger` validators. That adapter requires an **already completed parent allocation grant**, a private funded child ledger with the parent reference, and no unreconciled child run. Its allocation ID is that parent grant hash, not the pilot slot ID. The executor binds it to one slot through the sealed slot grant, rejects reuse across configured slots, and requires the same parent ledger as the actor. The total parent reservation therefore includes the actor grant **plus** this separate learner grant; the executor neither mints nor double-reserves the learner allocation.

Immediately before running a slot, the executor rechecks local code pins, Python admission/reviews and funding, creates a global logical-slot claim beside the parent ledger, and calls `BudgetLedger.before(grant, "native_pilot_episode")`. A new output directory or newly issued grant cannot redispatch the same logical slot in that plan. A crash or rejection after claiming is conservative: the claim persists and requires review, not automatic retry.

The executor does not mark sampler spending reconciled or the parent grant financially complete. The parent retains that responsibility using the actual sampler captures and ledger. Token/call caps are enforced by the harness; dollar caps are enforced by the funded sampler bridge, not inferred from a count of messages.

## Durable records and resumption

```text
OUTPUT_DIR/
  binding.json                 # immutable plan, dispatch and execution file binding
  slots/<slot_id>/
    attempt.json               # exact native_pilot.report_pilot attempt schema
    progress-00000.json         # funded/inflight transition, then incremental evidence
    progress-00001.json
    ...
    episode.json               # returned native episode, including actual failed prefix
    receipt.json               # executor outcome, pins and evidence reference
  attempts.json                # rebuildable report projection
  execution-summary.json       # execution counts; assessment remains unknown
```

Slot creation is exclusive and directory entries are fsynced. `attempt.json` is saved as `started` before consuming funding and invoking the runner. JSON updates use private temporary files, fsync and atomic rename. Even a crash between directory creation and writing the start record is counted as an unresolved started slot. Existing slots are never rerun automatically.

Settled runtime steps are saved **before** the learner callback. Learner observations, responses and chosen next runtime steps are saved incrementally. These are checkpoints from the existing production controller, not invented delivery receipts. Provider/tool continuations inside an unsettled turn remain the harness/sampler capture responsibility; a process death there may leave only the valid earlier prefix. The executor records provider completion as unknown when the runner throws.

The final episode is durable before the final receipt; the final receipt is durable before the terminal attempt. A death between those writes leaves a started attempt rather than inferring completion. Terminal receipt hash mismatches block further execution. A runtime pin/surface mismatch records a failed attempt, preserves its episode, and halts remaining selected slots.

Per-slot records are authoritative. Concurrent disjoint selections may temporarily leave an outdated aggregate projection. `status` rebuilds it from the slot records. A partial or corrupt binding fails closed; there is no automated cleanup or retry switch. Preserve interrupted output and inspect the global claim and parent ledger before defining any replacement experiment.

## Reporting and integration

Use the generated `attempts.json` unchanged with `native_pilot.py report`, supplying the original plan, reviewed dispatch, admitted source bundle and a **separate independently authored outcomes array**. An empty outcomes array is valid and preserves missingness. The executor never converts runtime completion, an accepted submission, gratitude, or a model-generated score into an assessed learning result.

The context-calibration regression is explicit: a wrapper returning `complete` with a failed runtime and `harness_provider_call_limit` yields `budget_exhausted`. Four prepared provider requests and five assistant messages (including an error message) are different counts. `paid_samples`, assessments and learning effects remain null without their independent evidence.

Parent integration remains responsible for the golden review, full source/format reviews, frozen actual tool schemas, funded bridge deployment, credentials, sampler captures and independent outcome review. This implementation has not dispatched a provider call, executed a funded Stage 1 episode, established browser rendering parity, or validated learner behavior. Missing seed forwarding and unattested hosted instruct-model weights remain explicit measurement limits.

## Verification

```sh
rtk bun test scripts/training/test_native_pilot_run.test.ts
```

The tests exercise the real Python plan reconstruction/review code and Decimal budget transitions on authored temporary fixtures. Their cache reader and the instruct adapter's private-path containment resolver are injected only in isolated test processes, allowing temporary fixture ledgers outside the repository. The real CLI has neither bypass. A separate test verifies that the public admission entry point rejects an unavailable pinned source cache. Executor tests cover separate instruct-learner funding, an OS-killed child, interrupted calls, concurrent slot ownership, directory-only crash recovery, immutable bindings, terminal receipt tampering, closed golden/pin gates, chat control leakage, real-result surface/schema checks, the calibration failure denominator, and compatibility with Python's report reader. They do not establish empirical tutoring or provider behavior.
