# Instruction actor and learner backend

`scripts/training/native_instruction_backend.ts` makes the two-process instruction baseline from the private v6 canary reusable. It consumes **existing, completed parent allocations** and dedicated actor/learner child ledgers. It never creates reservations, looks up Skate credentials or opens a quality gate.

The parent launches it only after the relevant admission, source/format reviews and quality gates. The actor remains an evaluation-only catalog model: its tokenizer, renderer, SDK and local prompt are pinned, but Tinker does not attest an immutable hosted weight revision. These traces are not eligible for actor training merely because original tokens were captured.

## Interface

| Export | Purpose |
| --- | --- |
| `inspectInstructionBinding(binding, options)` | Read-only config, funding, source and local SDK/tokenizer audit; default `audit: true` |
| `instructionModelPins(proof)` | Stable actor configuration/revision and actual `JsonChatLearner` provenance for planning |
| `claimInstructionBinding(binding, options)` | Revalidate fresh child ledgers and create a global once-only logical claim; no budget transition |
| `instructionActionAdapter(bindings, options)` | Returns the `funding` and `backend` dependencies accepted by `executeActionSearch` |
| `runInstructionPilot(binding, input, options)` | Implements the injected `PilotDependencies.run` role with fresh local bridges and worker |

Production options are `python` (the installed, pinned bridge interpreter), `credential_env` (default `TINKER_API_KEY`), `startup_ms` (at most 45,000), and `run_ms` (at most 900,000). The parent supplies the credential through that environment variable at actual execution time. `runtime` and `inspect` are explicit trusted test seams, not provider plugins or public configuration fields.

## Stable scientific identity and per-branch funding

An `InstructionBinding` contains:

```ts
{
  kind: 'native-instruction-backend/v1',
  target: {
    lane: 'action' | 'pilot',
    plan_sha256, branch_id, source_family, scenario_sha256,
  },
  grant_path, actor_config_path, learner_config_path, state_dir,
  source_hashes, // repository-relative file paths -> raw SHA-256
}
```

The scenario hash is the admitted source hash already used by its executor. Do not recalculate it using W5's JS hash. Funding/config files use the existing Python `native_training.seal` convention. The new binding's own hash uses W5 `actionHash` and is kept separate.

One grant per logical branch/slot must already be sealed, reserved and fully allocated by the parent:

```text
kind: native-instruction-backend-allocation/v1
target: <exact InstructionBinding.target>
source_hashes: <exact InstructionBinding.source_hashes>
config_core_sha256: {actor: ..., learner: ...}
subcaps_usd: {actor: "0.60", learner: "0.40"}  # example, not an authorization
cost: {reserved_usd: "1"}
phases: [allocate_actor, allocate_learner]
plan_hash: <native_training.seal(..., "plan_hash")>
```

The parent ledger must show that exact grant as `complete` with both phases dispatched. Each separately sealed actor/learner config points to the same parent grant, but a different private child ledger with the matching subcap. Both child ledgers must be unused at claim/start. A restarted bridge cannot hide an earlier completed or unresolved operation.

The inspector sums **both subcaps with Decimal** and requires the sum to be no larger than the single parent reservation. This closes the gap where each child individually fits the parent amount but their sum does not. It checks both accounts match, all parent/child identities and seals, and child reservation totals. Existing bridge request handlers continue to reserve and consume their own per-request operations during a future authorized run. This adapter makes no `reserve`, `before` or `mark` calls.

The inherited bridge accounting uses its pinned conservative token-price estimate, including configured setup allowance. It is a local reservation cap, not a provider-side account limit. The inherited SDK retry/backpressure and remote-cancellation qualifications still apply; failed or interrupted operations retain their reservation for reconciliation.

To avoid circular hashes, compute the scientific pins **before** inserting allocation fields:

```python
from native_scenarios import digest
core = digest({k: v for k, v in config.items()
               if k not in ("allocation", "config_hash")})
revision = digest({k: config[k] for k in
    ("model", "tokenizer", "renderer", "versions", "sampling")
    + (("condition",) if role == "actor" else ())})
```

The actor's W5 `configuration_sha256` is this semantic core hash, and its `revision` is the revision above. The learner revision uses the same projection as the existing pilot's instruction-learner support. Actual allocation-specific `config_hash` values are checked against bridge startup metadata and retained beside the stable pins. The full config is not incorrectly required to match across different monetary allocations.

Build the plan with those semantic pins; then the parent creates the branch grant, child ledgers and final configs. Fresh runtime directories and ephemeral endpoints are deployment details, not changes to the scientific condition.

## Local preflight and process lifecycle

Preflight calls the existing `actor_config`, `learner_config` and `funded_ledger` validators. It audits the installed SDK versions/source bytes, locally cached tokenizer files, chat template, renderer and stop token through `PinnedActorSampler`. Hugging Face and Transformers run in offline mode; missing files fail instead of downloading. No credential or `ServiceClient` is used during this audit. `audit: false` is exposed for funding-only inspection and tests; production adapter preflight always audits unless the caller explicitly replaces the trusted test seam.

The source manifest must include all files named in the inspector's required controller list. For W5, include its entire runtime and controller pin maps as well. The actual supported identity is the existing `Qwen/Qwen3.5-9B` instruction configuration. Provider identity is checked again by the existing funded sampler when it creates its client; preflight does not pretend to query hosted weights without a provider call.

The inspector streams binding JSON through stdin. A complete harness inventory can exceed Linux's per-argument size limit; passing it as a single command-line argument would fail before validation. The regression test exercises a source map above that limit through the real Python validator.

Claims live beside the parent ledger under `.native-instruction-claims/<grant_hash>`. Exclusive directories and a separate exclusive started marker prevent reuse through a changed output path. A crash leaves a consumed logical claim; automatic retry is deliberately unavailable. Monetary ledger bytes are unchanged by claiming.

Each execution then:

1. Starts fresh `native_instruction_actor.py serve` and `native_tinker_learner.py serve` processes, both on port zero and in new private state directories.
2. Verifies actual metadata: local HTTPS address, model/config identity, condition, output limits, private token/certificate locations and evaluation-only flags.
3. Builds a private CA bundle and launches a fresh Bun worker from this module. Only that worker gets the two local bearer tokens and `NODE_EXTRA_CA_CERTS`; only the bridge processes get the parent Tinker credential. The coordinator environment is not mutated.
4. Rechecks funding/config identity in the worker, constructs a fresh `JsonChatLearner`, and calls the existing actual native backend or pilot runner. Source tasks, learner evidence and experiment instructions retain their existing boundaries.
5. Retains bridge journals, actual metadata, worker progress and episode evidence; requests cleanup for worker, learner and actor, attempting every child even if one cleanup fails. Cleanup completion does not establish cancellation of a remote provider operation.

The worker uses a separate process because TLS trust and credentials cannot safely be switched between concurrent branches inside a shared Bun process. Its progress files are incremental, private and fsynced; they survive an interrupted parent. Runtime progress is under the binding's state directory, while the existing executor still owns its attempt/receipt directory and denominator.

## W5 parent wiring

```ts
const adapter = instructionActionAdapter(bindingByBranchId, {
  python: pinnedPython,
  credential_env: 'TINKER_API_KEY', // provided by the parent only for the actual run
});
await executeActionSearch(plan, output, {
  replayAdmission: () => admitActionScenario(sourcePaths),
  funding: adapter.funding,
  backend: adapter.backend,
});
```

Use the new adapter's funding object for these completed two-model allocations. W5's generic `parentActionFunding` expects a different, not-yet-dispatched `action_branch` grant and is not interchangeable. Mapping must cover every planned branch. Reusing a grant, child ledger or process state directory within the comparison is rejected. The adapter compares actual semantic model/provenance pins, source maps and actor call/output bounds before dispatch.

For an interactive comparison with `allowed_tools: []`, keep the empty list in the plan. Canonical `keating-ui` documents are assistant output; `learnerView` exposes their supported controls on the interactive surface independently of tool availability. This adapter neither adds tools nor suppresses those documents. The original public prefix and profile are copied unchanged, and `retrieve_practice` enters only through the existing experiment-instruction seam. A real trace must still demonstrate a valid delivered activity, learner intent and accepted submission; the adapter does not script any of them.

## Pilot parent wiring and remaining shared boundary

The generic `executePilot` already accepts `PilotDependencies`, so its durable attempt and review machinery can stay unchanged. Parent `claimFunding` can call `claimInstructionBinding`; parent `run` can call `runInstructionPilot`. Keep `replayPilotAdmission`, all 30 source and 60 format reviews, the golden gate, metadata checks, result checks and held-out family protections in the surrounding parent dependencies.

The existing pilot CLI's funding inspector is specifically for `native_tinker_sampler` checkpoint configurations. **Do not call that inspector with instruction-actor configs or claim the current CLI already supports this adapter.** The parent must wire a distinct funding/deployment path. Its execution metadata must explicitly describe deferred local bridge endpoints, whose actual addresses and allocation-specific identities are checked and recorded after startup. The plan pins stable semantic revisions and the actor condition; ephemeral port numbers are not hosted checkpoint identities. `runInstructionPilot` replaces only the local transport endpoints in its isolated worker, retaining the original scenario, slot, model condition, tools, surface and horizon.

This module does not alter the shared pilot schema, introduce placeholder endpoints into its files, supply a golden approval, or relax the review gate. The parent still owns the pilot metadata/CLI integration and its quality decision.

## Verification

```sh
rtk bun test scripts/training/test_native_instruction_backend.test.ts
```

The tests construct clearly authored sealed ledger files directly; no reservation method runs. Config, identity, source, completed-allocation and combined-cap checks use the real Python validators. Process lifecycle unit tests use explicit fake launchers and check startup failures, deadlines, cleanup, credential scope, metadata mismatch and no redispatch. The positive W5 mapping test admits three distinct authored branch allocations, then reaches the worker boundary for interactive `retrieve_practice` with empty tools and unchanged evidence; it deliberately stops there without manufacturing a successful episode. The optional `NATIVE_TEST_PYTHON` selects an installed interpreter with typer/certifi; otherwise the tests use an **offline** uv wrapper for those cached packages. No hosted execution or efficacy is claimed by these tests.

The existing instruction actor's cached SDK/tokenizer `audit` command also passed offline during adapter development: Tinker 0.27.1, tinker-cookbook 0.5.7, Transformers 5.3.0 and tokenizer revision `c202236235762e1c871ad0ccb60c8ee5ba337b9a`. That verifies local dependencies and source files, not hosted weight identity or end-to-end provider execution.


## Cancellation and descendant supervision

Production `launchInstructionProcess` launches `native_process_supervisor.py` as a Linux guardian for each actor, learner and worker. The owner retains a single stdin pipe; child services inherit no copy. Owner death, including SIGKILL or an outer process-group kill, closes that pipe and starts cleanup. The guardian is a subreaper, so detached descendants and double-forked children are adopted, signalled with identity-checked pidfds, and reaped. It remains alive until its descendant tree is empty. The managed Python build omits Python pidfd methods, so the helper uses the host libc’s typed pidfd wrappers when needed. Linux pidfd, subreaper and `/proc` support are checked in the isolated preflight interpreter before dispatch.

Each role writes `<role>-stderr.log.supervision.json`. `stop()` requires the matching guardian/owner identity, `cleanup_verified: true` and an empty remaining-process list after guardian exit. Root exit alone is insufficient. Cleanup failures or timeouts leave `lifecycle.json.processes_stopped: false` and abort the hosted action comparison. The guardian continues cleanup after a caller's deadline; callers never kill it to manufacture a successful shutdown. The private W5 parent also uses an outer guardian, which records a comparison abort if its owner or Bun root fails.

The comparison signal is checked before claims and each launch, propagated into the production launcher, and excluded from serialized worker input. Unexpected actor/learner death, worker failure, startup timeout, cancellation or unverified cleanup becomes `AbortError` at the hosted action adapter boundary. This closes W5's durable comparison gate before any sibling dispatch. Generic offline backends may still report ordinary per-branch failures independently.

`test_native_process_supervisor.test.ts` exercises the production launcher using actual Linux processes: TERM-resistant roots, detached grandchildren, root SIGKILL, owner SIGKILL, an outer parent group kill across three nested backend groups, pre-launch cancellation and refusal of an unverified cleanup receipt. Tests assert descendants are absent from `/proc`, including zombie reaping. These tests establish local process cleanup; they do not attest cancellation of an already submitted remote provider operation. A whole-machine failure or simultaneous SIGKILL of all guardians cannot run cleanup code and must retain unresolved claims.
