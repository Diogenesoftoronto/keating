# Native candidate action comparison

`scripts/training/native_action_search.ts` compares **three distinct teaching moves**, each with an explicit number of learner replicates. Each branch calls `runNativeEpisode` with the same admitted starting situation, evidence, profile, model pins, surface and capabilities. The actor generates its own response through the disposable production Pi runtime.

The vocabulary is `diagnose`, `hint`, `counterexample`, `worked_example`, `retrieve_practice`, and `check_transfer`. A plan selects exactly three and sets `learner_replicates` to an integer from 1 through 10. It retains every branch, including funding rejection, interrupted execution, failed runtime outcomes and missing assessments. No review or utility value is inferred from a successful function return.

This is the W5 implementation. It neither changes the Stage 1 pilot executor nor requires completing the 180-episode pilot before offline planning or comparison implementation. Actual execution still requires admitted inputs, verified deployments, explicit funding and the shared instruction seam below.

## Shared experiment instruction seam

The existing fifth argument to `runNativeEpisode` accepts a harness runner. W5 wraps that runner, adds one field to its request, and calls the real `runHarnessEpisode`. It **does not** change the scenario, opening learner message, steps, source `SYSTEM.md`, learner profile, or historical actor completion. No change to `native_episode.ts` is necessary for this path.

The parent implemented this shared contract in `native_experiment.ts`, `benchmark_harness_v3.ts` and its extension:

```ts
// Exported by benchmark_harness_v3.ts.
export const HARNESS_EXPERIMENT_INSTRUCTION_VERSION = 1;

// Optional field on HarnessV3Request AND echoed in
// HarnessV3Result.configuration. Omission preserves existing behavior.
experiment_instruction?: {
  kind: 'native-action-search/v1';
  comparison_sha256: string;
  candidate_id: 'diagnose' | 'hint' | 'counterexample'
    | 'worked_example' | 'retrieve_practice' | 'check_transfer';
  instruction: string;
  instruction_sha256: string;
};
```

The shared validator checks the exact fields before launching Pi: kind, comparison hash, candidate enum, nonempty instruction, no NUL, and **raw UTF-8** instruction SHA-256. Its limit is **8,192 UTF-8 bytes**. W5's exported `ActionExperimentInstruction` is structurally compatible with the shared `HarnessExperimentInstruction`; all six fixed W5 instructions fit that limit.

At the actual `before_agent_start` prompt boundary, the extension preserves the surface projection and puts the condition immediately before the final surface instruction:

```text
<existing projected system prompt>

[Research condition <comparison_sha256>; move <candidate_id>]
<experiment_instruction.instruction>

<nativeSurfaceInstruction(surface)>
```

The effective prompt still ends with `nativeSurfaceInstruction(surface)`, with its surface instruction hash unchanged. The experiment object appears in actual runtime configuration and system-prompt receipts. The W5 verifier checks the configuration echo, effective request prompt, source hashes, tool schema, surface and initial learner text. The shared seam has separate parent-owned tests for descriptor rejection and actual Pi injection across reopen.

The instruction governs the **first** tutor move and asks the actor to respond normally afterward. It contains a bounded teaching direction, never a prewritten answer. The learner receives only actual delivered observations and its existing allowlisted context; candidate IDs, the experimental instruction and private gold labels are not added to its request.

The source-evidence restriction forbids inventing missing source material or
execution receipts. It still permits the actor to author fresh practice through
supported native activities, identified as newly created material. Creating an
activity does not establish that it was delivered or that a learner succeeded.

The default backend discovers the shared version 1 export. Missing or incompatible versions still reject in `preflight`, **before claiming money or preparing a provider**. W5's integration test also runs three candidate branches through the actual shared harness and Pi runtime using explicit offline response tapes. It checks real prompt/configuration receipts, isolated session IDs, unchanged learner evidence and durable branch outputs. Authored learner replies and offline tapes establish integration, not model quality.

## Callable production path

The module exports:

| Function | Responsibility |
| --- | --- |
| `admitActionScenario(paths)` | Offline Python source admission replay; selects one admitted development scenario |
| `createActionPlan(admission, settings)` | Frozen 3 × K branch plan with typed moves and explicit utility units |
| `validateActionPlan(plan)` | Reconstructs the entire W5 plan; rejects changes to family, evidence, pins or branches |
| `parentActionFunding(spec)` | Verifies existing parent reservations and durably consumes each branch grant once |
| `nativeActionBackend(options)` | Calls actual `runNativeEpisode` through the parent instruction seam |
| `executeActionSearch(plan, output, dependencies)` | Durable branch executor with fresh admission/pin checks |
| `readActionReceipts(output, plan)` | Verifies retained evidence and reconstructs interrupted/missing receipt states |
| `compareActionBranches(plan, receipts, reviews)` | Independent outcome and cost comparison; no model calls |

The parent integration is an ordinary Bun caller, with no provider API inferred by W5:

```ts
const admitted = await admitActionScenario(sourcePaths);
const plan = createActionPlan(admitted, settings);
// Freeze this plan, prepare backend deployments, and reserve all branch grants
// in the parent ledger before invoking executeActionSearch.
const backend = nativeActionBackend({
  verifyDeployment, // local source/config pin checks; no inference
  prepareBranch,   // validate the actual funded provider mapping, then return
                  // actor transport + fresh learner + verified pins + cap hash
});
const result = await executeActionSearch(plan, ignoredOutputDirectory, {
  replayAdmission: () => admitActionScenario(sourcePaths),
  funding: parentActionFunding(fundingSpec),
  backend,
});
```

`prepareBranch` receives the frozen plan, branch ID, already-claimed grant and checkpoint callback. It must validate actual deployed actor/learner configurations and their enforced budgets before returning:

```ts
{
  actor_transport,       // current HarnessV3Request provider transport
  learner,               // a NEW AdaptiveLearner for this branch
  pins,                  // validated deployment values, not a copy of requested pins
  enforcement_sha256,    // matches the parent's funded cap evidence
}
```

Model-specific validation belongs to those parent adapters. In particular, the new instruction-actor baseline has a distinct funding/configuration mapping; W5 does not assume its API or inherit support from `native_pilot_run.ts`. A model alias or a copied metadata hash alone does not attest hosted weights. Retain any provider revision limitations in the deployment evidence.

The default backend dynamically loads the real harness. `loadHarness` is an explicit offline test seam. Production uses the default and a real provider transport. Every call to the real harness creates its own disposable workspace; no runtime state is copied from a sibling branch. A reused learner object is rejected to avoid carrying hidden conversation state across replicates.

## Evidence, model and family pins

`ActionAdmissionPaths` contains `scenarios`, `scenario_id`, optional `cache`, optional `registry`, and optional installed `python` executable. Admission uses `native_pilot.load_admitted_bundle`, which reconstructs admission from the full pinned cache and current family registry/exposure ledger. Missing cached sources fail closed. No dataset download, provider call or secret lookup occurs.

The returned admission includes the original scenario and opaque Python hashes for the bundle, registry, scenario and public evidence. Execution replays and compares the full admission before each branch. Every receipt retains the original family and scenario hash; replicates do not create new source families or independent human evidence.

`ActionSettings.pins` fixes the actor model, revision and deployment configuration hash; complete learner provenance (including prompt/request contract hashes); and runtime/controller source hash maps. The parent must check those maps against the actual local deployment. W5 also checks returned runtime source hashes and the unchanged-at-end flag. `tools_sha256` uses W5's `actionHash` of the actual Pi `context.tools` array. Capability names, surface and limits remain identical across the three candidate moves.

W5 has its own canonical JSON seal. It does not recompute Python source hashes or use its seal for `BudgetLedger` plans. Shared funding records retain their existing `native_training.seal(..., "plan_hash")` convention. File evidence uses raw byte hashes.

There is no silent sampling-seed claim: the current shared APIs do not forward a paired seed. The plan records `uncontrolled_backend_sampling`. Replicate indices group corresponding candidate samples and preserve the design; they do not establish common random numbers.

The initial horizon is one learner decision, with the runtime's normal tutor follow-up retained. With the current controller, a learner message can therefore produce a second tutor response before the decision limit stops the branch. Provider/tool limits and dollar grants must cover that follow-up. The trace preserves both boundaries so a reviewer can distinguish the initial candidate action, learner consequence and subsequent tutor behavior. This module does not export actor training targets or collapse these events into a single completion.

The controller currently reports that planned horizon as `budget_exhausted`. Receipts retain that raw `runtime_outcome` and the actual `runtime_status`; `horizon_reached` is a separate evidence-derived field. It requires two completed runtime steps, one accepted learner decision, one session, and a matching final controller receipt without a runtime error. Expected horizons are counted separately from failures. Provider/tool caps, refused extra sessions, and incomplete follow-ups remain failures, even if their raw outcome is also `budget_exhausted`.

## Funding and durable execution

`parentActionFunding` takes an existing parent ledger's absolute path, project, model and decimal-string cap, plus an exact branch-ID → absolute grant-file map. The caller must have reserved **every branch's grant** already. W5 never calls `reserve`, retrieves credentials, creates hosted clients on import, or automatically refunds reservations.

Each parent-sealed grant uses:

```text
kind: native-action-search-grant/v1
comparison_sha256: <W5 comparison seal>
branch_id: <exact W5 branch ID>
source_family: <original admitted family>
settings_sha256: actionHash(plan.settings)
phases: [action_branch]
cost: {reserved_usd: <positive decimal string>}
enforcement:
  kind: parent-verified-backend-cap/v1
  path: <absolute local deployment/cap evidence artifact>
  sha256: <raw evidence file SHA-256>
  maximum_usd: <combined enforced upper bound for this branch>
```

The enforcement upper bound must be positive and no larger than the reserved amount. The parent evidence must identify the actual actor and learner budget enforcement, setup costs and any possible provider continuations. W5 verifies its bytes and binding; `prepareBranch` must validate the current backend against that evidence. This is an explicit adapter integration requirement, not a claim that a file hash enforces a remote service's cap.

Before each branch call, the executor exclusively creates and fsyncs its branch directory, writes a started receipt, claims the logical branch globally beside the parent ledger, then calls `BudgetLedger.before(grant, "action_branch")`. It saves the monetary grant receipt before invoking the backend. Global branch claims prevent redispatch through a new output directory or replacement grant. An exclusive comparison-started record prevents a concurrent or replacement executor from acquiring any remaining sibling branch.

Outputs are confined to the existing ignored native research directories:

```text
OUTPUT/
  plan.json
  branches/<branch_id>/
    receipt.json
    progress-00000.json
    ...
    episode.json
  comparison-started.json
  abort.json                 # present on cancellation; permanent
  comparison.json
```

JSON writes use private files, fsync and atomic rename. Progress captures actual settled runtime steps, learner observations/responses and selected next steps. Unsettled provider/tool activity remains the runtime/sampler capture responsibility. Complete source-derived episodes and private evaluator fields remain in local ignored storage, not in the learner request.

Ordinary funding failures and non-cancellation runner errors are retained, and other independently funded branches can continue in that invocation. SIGTERM, SIGINT, an external AbortSignal or a backend AbortError synchronously persists comparison-wide `abort.json` before notifying child cleanup. The executor checks this gate before every claim/launch and after each awaited boundary; cancellation stops the whole comparison. The hosted instruction adapter classifies service/worker death and unverified cleanup as comparison aborts. A started directory, including a crash before its receipt was written, is never automatically retried. A dead comparison owner blocks unattempted siblings too. Completed comparisons remain readable; incomplete invocations require an explicitly new reconciled attempt. Partial summaries retain every planned branch in their denominator. A returned episode whose instruction/source/surface checks fail is saved as `verification_failed` and blocks remaining branches. Runtime failures retain their actual outcome/error instead of becoming successful comparisons. A new scientific attempt requires an explicitly new plan; there is no retry switch that erases uncertain prior spend.

The per-branch files are authoritative. After interruption or concurrent work, call `readActionReceipts` and `compareActionBranches` again to reconstruct a fresh report. The aggregate snapshot can lag an interrupted run; no branch is dropped from the planned denominator.

## Independent review and utility

An `ActionReview` binds to the branch's exact receipt hash, names an independent reviewer, references evidence, and supplies a value or null for the plan's declared metric and unit. The reviewer cannot be a plan author or either generating model. Review inputs remain separate from actor/learner context. A review of a failed but returned runtime may assign an explicitly justified outcome; W5 never assigns that score itself. An interrupted or condition-invalid trace cannot receive a normal scored outcome through this interface.

Costs have explicit units: `USD`, `seconds`, `tokens`, or `provider_calls`. Seconds are the measured wall time around branch preparation/execution. Other units require separately supplied evidence; prepared provider requests are not automatically billed calls. Reserved dollars are not substituted for actual cost.

For branch `b`, the declared score is:

```text
utility(b) = reviewed_outcome(b)
             - sum(coefficient[unit] * measured_cost(b, unit))
```

Each coefficient is in **outcome units per cost unit**. For a `rubric_points` outcome, a coefficient of `0.5` on USD means `0.5 rubric_points/USD`. Seconds and tokens cannot be added directly to a probability or rubric score. Duplicate units, inconsistent metric units, fractional call/token counts and nonfinite quantities are rejected.

A positive-weight cost that is unknown makes the branch utility unknown. A zero coefficient does not require that cost measurement. Candidate utility is the equal mean over **all requested replicates**. No recommendation appears until all three candidates have complete independent outcome/cost coverage. Failed, interrupted and unattempted branches remain in the denominator; selecting only fortunate continuations cannot produce a complete recommendation. Exact ties retain all best candidates.

The report exposes per-branch measurement provenance (`offline_integration` versus `model_episode`) and descriptive replicate standard error when possible. Replicates share the same original situation/profile; their standard error is not a human-population confidence interval. A reviewed synthetic preference is not demonstrated human learning, and this module does not automatically produce an SFT or preference-training example.

## Verification and current boundary

```sh
rtk bun test scripts/training/test_native_action_search.test.ts
```

Most tests exercise the native controller through an injected harness for deterministic crash, pin and accounting checks. The real-Pi test uses `nativeActionBackend`, the unmodified shared `runHarnessEpisode`, the production Pi agent loop and actual filesystem sessions with offline tape responses. It checks all three candidate instructions in provider contexts and system-prompt receipts, unchanged learner text/private-label isolation, separate session IDs, source pins and unknown outcomes before review. It also exercises default shared-module discovery without a fake capability export. Python budget tests use temporary authored ledgers and real `BudgetLedger` transitions. No test executes paid calls or verifies a hosted model.

The shared instruction seam is now available and exercised through W5's actual native backend. Remaining parent integration is model-specific deployment/cap validation and funding mapping, followed by an independently reviewed model-generated comparison. W5 does not assume the new instruction-actor API or mark the broader research plan complete. These offline integration tests also do not validate an imported development dataset or open the research golden-episode gate.
