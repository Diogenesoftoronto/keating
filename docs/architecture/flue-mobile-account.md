# Flue, Mobile Self-Modification, and Not Organic Accounts

Status: proposed target architecture  
Scope: browser, Expo mobile, hosted/self-hosted agent execution, and account-wide evolution  
Flue baseline inspected: `@flue/runtime`, `@flue/sdk`, and `@flue/vite` 2.0.3

## Decision

Use Flue as Keating's canonical **agent authoring and hosted harness model**, but do not replace the working browser agent with Flue's published runtime.

Flue gives Keating the right high-level vocabulary: agent functions, dynamic hooks, tools, skills, subagents, MCP connections, lifecycle hooks, persistent conversation state, durable submissions, and a provider-neutral sandbox contract. It does not currently provide a browser or React Native agent runtime. Its published runtime requires Node.js 22.19 or newer, imports Node APIs, and officially builds only for Node and Cloudflare. `@flue/sdk` is browser-safe, but it is a transport client for a deployed Flue conversation; it does not execute the agent locally. Flue also continues to use Pi's model/provider protocol internally. Adopting Flue therefore reduces the amount of harness architecture Keating owns, but it does not eliminate Pi underneath or satisfy client-side execution by itself.

The durable design is:

1. Define Keating agents once through a small `@keating/agent-runtime` facade whose semantics deliberately match the useful Flue hooks.
2. Back that facade with the real Flue runtime on Node-hosted and remote sandbox surfaces.
3. Back the same facade with a narrow browser renderer on top of the existing `pi-agent-core`, NodePod, IndexedDB, and Keating tool authorization. This is a compatibility adapter, not a second product-level agent API.
4. Treat mobile as both a native client of account-hosted Flue conversations and a controller for remote self-modification. Mobile locally activates only the bounded, declarative parts of an evolved revision that React Native can safely execute.
5. Put identity, durable device sessions, account-wide evolution state, artifact synchronization, job scheduling, and active-revision compare-and-swap behind the Not Organic account.
6. Put all code execution behind a provider-neutral runner interface. Cloudflare Sandbox may be one adapter, but no artifact, API, job record, or Keating agent imports a Cloudflare type.

This preserves the strongest current property: a learner can open Keating in a browser, remain signed out and offline, and still run the browser agent and its local evolution loop entirely on the client.

## Non-negotiable invariants

- **Browser-local remains real.** Signed-out and offline browser sessions must not silently dispatch agent turns or self-modification to a server.
- **Not Organic owns account identity.** Clients never select an `accountId` in a sync, job, artifact, or activation payload. The authenticated product session supplies the account namespace.
- **A login is not a five-minute token.** Mobile login requires a durable, revocable, DPoP-bound device session that rotates short-lived access capabilities.
- **No runner receives account credentials.** A sandbox receives only a job-scoped lease and named broker capabilities.
- **Evolution is content-addressed and immutable.** Prompts, policies, weights, optimizer state, source, skills, MCP declarations, and evaluation reports are immutable artifacts assembled into a revision.
- **Activation is atomic.** A revision becomes active only through compare-and-swap against the account's current generation.
- **Learner performance is evidence, not a label.** Every promoted revision carries an evaluation report that identifies which learner evidence was used and distinguishes observed, delayed-observed, explicit, synthetic, and heuristic evidence.
- **Executable revisions are pinned.** A conversation records the exact pedagogy revision and runtime digest it started with. A later account activation does not mutate an in-flight conversation underneath the learner.
- **Cloudflare is optional.** Provider-specific provisioning, bindings, lifecycle, and attestation stay in adapter packages.
- **Mobile does not download arbitrary JavaScript into the app process.** Full source evolution runs in a remote runner. Mobile locally applies prompts, policy, weights, optimizer variables, skills as text/resources, and bounded workspace overlays after compatibility validation.

## System shape

```text
                       Not Organic account authority
             +---------------------------------------------+
             | native/browser device sessions + DPoP       |
             | account-relative artifact and evidence store |
             | durable evolution jobs and runner leases     |
             | active pedagogy pointer (CAS generation)      |
             +----------------------+------------------------+
                                    |
                      authenticated, DPoP-bound APIs
                                    |
       +----------------------------+----------------------------+
       |                            |                            |
+------v----------------+  +--------v---------------+  +---------v--------------+
| Browser               |  | Expo mobile            |  | Hosted/self-hosted      |
|                       |  |                        |  | Flue runtime             |
| Keating hook facade   |  | @flue/sdk for remote  |  |                        |
| browser renderer      |  | conversations          |  | real Flue hooks         |
| pi-agent-core         |  |                        |  | durable submissions     |
| NodePod sandbox       |  | native DPoP signer    |  | skills/subagents/MCP    |
| IndexedDB revisions   |  | SecureStore session   |  | neutral sandbox adapter |
| local/offline first   |  | bounded local overlays|  | Not Organic model broker|
+-----------+-----------+  +-----------+------------+  +-----------+------------+
            |                          |                           |
            +--------------------------+---------------------------+
                                       |
                         provider-neutral runner contract
                                       |
                 +-----------+---------+---------+-----------+
                 |           |                   |           |
              NodePod     microsandbox       Daytona/E2B   Cloudflare
              (client)    /Firecracker/etc.  /Modal/etc.   adapter
```

There are three different kinds of state in this diagram and they must not be conflated:

1. **Conversation state** is Flue's message stream and `usePersistentState`. It is scoped to one agent instance.
2. **Workspace state** is the sandbox filesystem and its snapshots. Flue explicitly treats this as independent from conversation persistence.
3. **Account pedagogy state** is the Not Organic artifact graph, evidence graph, evolution jobs, and active revision. It is shared across browser, mobile, CLI, and hosted instances.

Flue persistence does not replace account sync, and a durable sandbox does not replace either Flue persistence or the account artifact store.

## Canonical agent composition

The stable shell is a small agent module. The things that evolve are loaded as a pinned revision, not compiled into the shell's identity.

```ts
'use agent';

export function KeatingTeacher({ id }: AgentProps) {
  const revision = useKeatingRevision(id);
  const policy = useKeatingPolicy(revision);

  useKeatingModel(policy.model);
  useKeatingSandbox(revision.runner);
  useKeatingTeachingTools(revision);
  useKeatingSkills(revision.skills);
  useKeatingMcpConnections(revision.mcpConnections);
  useKeatingDelegates(revision.delegates);
  useKeatingLearnerEvidence(revision);
  useKeatingOpenUiWriter();

  return composeTeacherInstructions({ revision, policy });
}
```

On the hosted target, each `useKeating*` custom hook delegates to Flue. On the browser target, the same custom hook registers its resource with Keating's browser renderer. Keating should not pretend that every Flue primitive is portable. Only the following portable subset belongs in the facade:

- model selection;
- instruction contributions;
- typed tools;
- skill catalogs and resources;
- subagent definitions with isolated context;
- one sandbox binding;
- named JSON state;
- initial data and delivered-message context;
- structured data writers;
- agent/response lifecycle seams.

Flue-specific routing, Durable Object classes, Node persistence adapters, and generated build identities remain server implementation details.

### Why a facade instead of a long-lived Flue fork

A direct browser import of `@flue/runtime` is not currently safe: the package has a Node engine requirement and published root code imports `node:async_hooks`. The facade lets Keating use upstream Flue unmodified on supported targets while implementing only the client-side subset it actually needs. If Flue later publishes an environment-neutral harness core or browser target, the browser implementation can be replaced without changing Keating's agent definitions or artifacts.

A Flue fork is justified only if the facade cannot preserve one of these observable semantics:

- resources may appear or disappear between model turns;
- skills disclose progressively rather than being injected eagerly;
- a subagent receives a fresh context and returns only its final result;
- persistent-state updates become visible on the next render;
- data-writer output is represented as structured client data, not assistant prose;
- lifecycle callbacks are at-least-once and can be made idempotent.

Until such a failed contract test exists, prefer adapters and upstream proposals over a fork.

## Flue primitive mapping

| Flue surface | Keating use | Browser implementation | Mobile implementation | Gap or constraint |
|---|---|---|---|---|
| `useModel` | Select local, BYOK, or `notorganic/*` model | Existing browser model registry and `hybridStreamFn` | Remote Flue conversation; current native provider loop remains offline fallback | Flue's provider layer is Pi unwrapped; Not Organic needs a Pi provider adapter and job-scoped auth bridge |
| `useSandbox` | Attach the active source workspace | Adapt `AgentSandbox`/NodePod to the Flue `Sandbox` shape | No arbitrary local shell; remote runner selected by job requirements | Flue has one sandbox and no snapshot verb; snapshots remain in the Keating runner transaction layer |
| `useTool` | Deterministic pedagogy, learner, artifact, mutation, and account actions | Existing browser tools wrapped by `AuthorizedToolExecutor` | Native bounded tools locally; full tools remotely | Flue has no Keating permission policy; every tool still passes through the Keating authorization wrapper |
| `useSkill` | Teaching methods, evaluation rubrics, evolution procedures | Read active skill files from NodePod/IndexedDB | Download signed text/resources; remote agent loads full skill | Active revision must be loaded before synchronous render; arbitrary skill scripts are remote-only |
| `useSubagent` | Researcher, diagnostician, evolver, evaluator, reviewer | Fresh `pi-agent-core` child context sharing the selected sandbox | Remote Flue subagents | A Flue subagent shares the parent's sandbox and has no persistent identity; use registered agents/jobs for isolated parallel candidates |
| `useMcpConnection` | Optional external tools | Browser-safe WebMCP or fetch transport when CORS/auth permits | Remote broker initially | Credentials are references to Not Organic broker capabilities, never revision bytes; published Flue MCP runs with the hosted runtime |
| `usePersistentState` | Per-conversation phase, idempotency guards, cached revision pointer | IndexedDB conversation stream | Remote conversation stream | Never use it as the MAP-Elites archive or account-global active pointer |
| `useAgentStart` | Resolve and pin active revision before first model work | Async account/local lookup then rerender | Remote runtime | Offline lookup must fall back to latest locally verified revision |
| `useAgentFinish` | Persist turn receipts and enqueue safe evidence extraction | Browser event store | Remote runtime | Side effects require an idempotency key because callbacks are at-least-once |
| `useResponseStart` / `useResponseFinish` | Stamp revision, runtime, latency, and usage metadata | Browser trace metadata | `@flue/sdk` response metadata | Completed canonical response is authoritative; partial deltas are not learner evidence |
| `useDataWriter` | Stream OpenUI documents and evaluation status | Map directly to existing OpenUI document stream | Render supported mobile document nodes | This should replace parsing special UI tags from assistant prose over time |
| `observe` / `instrument` | Operational tracing, runner cost, model/tool telemetry | Local diagnostics and optional privacy-safe export | Hosted telemetry | Runtime events are diagnostics; only validated learner interactions become learner evidence |
| `PersistenceAdapter` | Hosted durable conversations | Not used by local renderer | Reached through hosted runtime | Needs a Not Organic/Convex or Postgres adapter; it does not provide IndexedDB or account sync |
| `@flue/sdk` / `@flue/react` | Consume a hosted conversation | Optional hosted mode | Primary mobile remote-agent transport | SDK transports to a server; it is not the client-side harness |

## Sandboxes and runner neutrality

The existing Keating `AgentSandbox` is capability-rich: it describes browser locality, isolation, processes, sessions, previews, snapshots, networking, secrets, and persistence. Flue's `SandboxFactory` is intentionally narrower. It receives an agent instance `id`, creates a filesystem/shell object once per harness, and leaves provisioning and teardown to the application.

Keep the richer Keating contract as the selection boundary and adapt a chosen instance into Flue:

```ts
interface EvolutionRunnerAdapter {
  readonly id: string;
  readonly version: string;
  capabilities(): EvolutionRunnerCapabilities;
  createJobWorkspace(input: {
    jobId: string;
    lease: JobScopedLease;
    requirements: EvolutionRunnerRequirements;
    baseRevision: PedagogyRevisionRef;
  }): Promise<EvolutionWorkspace>;
  attest(workspace: EvolutionWorkspace): Promise<EvolutionExecutorAttestation>;
  cancel(workspace: EvolutionWorkspace): Promise<void>;
  dispose(workspace: EvolutionWorkspace): Promise<void>;
}

interface EvolutionWorkspace {
  flueSandbox: Sandbox;
  checkpoint(label: string): Promise<CheckpointRef>;
  restore(checkpoint: CheckpointRef): Promise<void>;
  exportArtifacts(): Promise<PedagogyArtifactRef[]>;
}
```

The application captures `EvolutionWorkspace.flueSandbox` in a `SandboxFactory` closure. `createSandbox({ id })` returns that object; it must not derive account identity from `id`. Checkpoint, restore, attestation, cancellation, and deletion stay outside Flue because its sandbox contract intentionally has no teardown or snapshot verb.

Selection is requirement-based, never vendor-name based. The shared job contract describes:

- runtime kind, version, ABI, and entrypoint;
- minimum isolation class;
- no network or an explicit hostname allowlist;
- ephemeral or snapshot-capable filesystem;
- no secrets or named broker capabilities;
- CPU, memory, disk, wall-time, and output limits.

The Not Organic scheduler selects any registered adapter that satisfies those requirements. An executor attestation records adapter id/version, isolation class, image digest when applicable, runtime digest, and execution time. `cloudflare`, `microsandbox`, `daytona`, `e2b`, `modal`, `vercel`, a Firecracker service, or a self-hosted runner are configuration values in the adapter registry, not discriminants in client contracts.

### Cloudflare-specific caution

Flue's Cloudflare Sandbox integration is platform-native: it requires the Cloudflare build target, bindings, Durable Objects, and container configuration. It is useful, but adopting it as the default application architecture would couple the agent build, state, provisioning, and sandbox to one deployment target. The portable default should be Flue's Node target plus `SandboxFactory`, with Cloudflare implemented as a separate target adapter. The Not Organic APIs and artifact store remain identical when the adapter changes.

## Account-wide pedagogy artifacts

The shared account-evolution contract should be carried into this worktree as the canonical wire format. Its important types are:

- `PedagogyArtifactRef`;
- `LearnerEvidenceRef`;
- `PedagogyRevisionRef`;
- `EvolutionRunnerRequirements`;
- `AccountEvolutionJobRequest` and `AccountEvolutionJobRecord`;
- `EvolutionExecutorAttestation`;
- `ActivePedagogyPointer`;
- `PedagogyActivationRequest`.

The account namespace is intentionally absent from every client payload.

A revision may contain these immutable artifacts:

| Artifact | Evolves | Executable where |
|---|---|---|
| `prompt-set` | tutor persona, teaching prompts, operational instructions | browser, mobile, hosted |
| `teacher-policy` | pedagogy parameters and model/tool policy | browser, mobile bounded subset, hosted |
| `fitness-definition` | objective names, weights, constraints, noise floor | browser evaluator and remote runner |
| `optimizer-strategy` | MAP-Elites dimensions, mutation rates, selection pressure, prompt-learning variables | browser and remote runner; mobile displays/requests jobs |
| `map-elites-archive` | candidates, niches, objective vectors, parentage | IndexedDB or account artifact store; not Flue persistent state |
| `source-bundle` | evolution code, hook composition, tools, delegates, validators | NodePod browser or remote sandbox; never arbitrary React Native execution |
| `evaluation-report` | baseline/candidate evidence and promotion decision | all surfaces can inspect it |

The revision manifest also needs a compatibility block:

```ts
interface PedagogyCompatibility {
  agentApi: string;              // e.g. keating-agent-hooks-v1
  learnerContract: number;
  targets: Array<"browser-nodepod" | "mobile-declarative" | "flue-node">;
  minimumFlue?: string;
  mobileSdk?: string;
  requiredCapabilities: string[];
}
```

Clients download the manifest first, reject unknown schemas and missing capabilities, verify every digest and size, and only then materialize artifacts. A revision can be active account-wide while a particular old client continues using its last compatible revision and reports that it is behind; incompatibility must not result in partial activation.

## Documenting performance with the learner

Every candidate evaluation writes an `evaluation-report` artifact. The report is both machine-readable and human-readable and contains at least:

```ts
interface PedagogyEvaluationReport {
  schemaVersion: 1;
  baseRevisionId: string;
  candidateRevisionId: string;
  evaluatedAt: string;
  consumedEvidence: LearnerEvidenceRef[];
  objectives: Array<{
    id: "voice" | "diagnosis" | "verification" | "retrieval" | "transfer" | "structure" | string;
    baseline: number;
    candidate: number;
    weight: number;
    evidenceKinds: LearnerEvidenceKind[];
  }>;
  learnerOutcomes: {
    immediateChecks: { exposures: number; correct: number };
    delayedRetrieval: { exposures: number; successful: number };
    transferChecks: { exposures: number; successful: number };
    explicitFeedback: { positive: number; negative: number; confused: number };
  };
  syntheticResults?: { suiteDigest: string; score: number };
  regressions: Array<{ invariant: string; message: string }>;
  decision: "promote" | "hold" | "reject";
  decisionReason: string;
  runtimeDigest: string;
}
```

Observed and delayed-observed outcomes must never be inferred from synthetic or heuristic scores. A candidate with strong synthetic results but insufficient real exposure is held as a candidate, not described as better for the learner. Reports list exposure counts so one lucky answer cannot masquerade as learned improvement. Evidence contains references and minimized measurements, not raw private conversation text by default.

`useResponseFinish` records revision/runtime metadata for a completed response. Learner checks, later review events, transfer exercises, and explicit feedback refer back to that exposure. The evidence builder can therefore answer: **which exact prompt/policy/source revision produced the teaching, what happened immediately, and what the learner retained later?** That is the feedback signal for MAP-Elites and prompt learning.

## Browser execution

Browser operation has two modes, neither of which requires a Not Organic account:

### Local lightweight mode

- browser hook renderer over the existing `pi-agent-core` loop;
- deterministic Keating tools;
- browser storage for sessions, learner evidence, revisions, and optimizer state;
- no arbitrary shell or source execution;
- local/BYOK/hosted inference according to the learner's explicit model choice.

### Local NodePod mode

- the same hook renderer;
- NodePod adapted through `AgentSandbox` and the Flue-compatible `Sandbox` facade;
- source bundle materialized under `/agent`;
- skills discovered from the revision workspace;
- source, prompt, policy, weights, optimizer, and tool mutations inside a checkpoint transaction;
- validation before promotion;
- snapshots and active revisions persisted to IndexedDB.

The browser shim must implement contract tests against the hosted Flue behavior for resource changes, subagent isolation, state visibility, lifecycle idempotency, and structured writers. It does not need to reproduce Flue routing, server durability, or every internal event.

Browser account connection is additive. When the learner signs in, the client creates its own non-extractable P-256 DPoP key, obtains a Not Organic device session, uploads immutable local artifacts/evidence, downloads account artifacts it lacks, and reconciles the active pointer. Signing out stops sync and remote jobs but leaves verified local data usable.

## Mobile login

Mobile login is an Authorization Code + PKCE flow owned by Not Organic:

1. The app generates `state`, a PKCE verifier/challenge, and a native non-exportable P-256 DPoP key.
2. It opens the Not Organic authorization page in `ASWebAuthenticationSession`/Chrome Custom Tabs.
3. The provider redirects to an approved HTTPS Universal/App Link. A development bridge may forward a bounded `code`, `state`, or `error` to `keating://notorganic/callback`, but the custom scheme is not registered as the provider redirect.
4. The app verifies `state` and exchanges the code, verifier, client id, exact redirect URI, and public DPoP JWK.
5. Not Organic returns a five-minute DPoP access capability and a rotating, revocable refresh credential bound to the same JWK thumbprint.
6. The access capability stays in memory. The rotating refresh credential is stored with Expo SecureStore using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The private P-256 key remains in Android Keystore/Secure Enclave and is never represented as JavaScript key bytes.
7. Refresh requests carry a DPoP proof for the token endpoint; the server rotates the refresh credential and rejects replay.
8. Logout revokes the server-side device session, deletes the refresh credential, and removes the device key.

This requires extending the current public token exchange to support registered native clients and `authorization_code` plus rotating `refresh_token` grants. Reauthorizing every five minutes is not acceptable login behavior. Each browser, mobile device, CLI, and desktop installation has its own revocable key/session; connecting them means that Not Organic resolves those sessions to the same account, not that devices copy a key or bearer token between themselves.

## Mobile modification and execution

React Native is not a general Node sandbox and should not execute an evolved source bundle. Mobile modification has two paths:

### Declarative local path

The existing mobile workspace engine remains the on-device activation gate. A compatible revision may update:

- prompt markdown and persona;
- teacher policy values;
- fitness weights and optimizer parameters;
- skill instructions/resources;
- bounded `screens/home.json`-style workspace overlays;
- declared tool/MCP availability shown by the UI.

The engine verifies base and parent hashes, changed-file hashes, resulting tree hash, schema, SDK version, and declared capabilities before activation. It records an activation or rejection receipt and can roll back to the previous overlay.

### Full remote path

For source evolution, new hooks/tools/subagents, MAP-Elites search, native dependencies, or stronger evaluation:

1. Mobile submits an account-relative `AccountEvolutionJobRequest` through Not Organic.
2. The request identifies the base revision, learner evidence references, operation, and capability requirements; it contains no vendor and no account id.
3. Not Organic chooses a runner adapter, creates a job-scoped lease, and materializes the revision/evidence into an isolated workspace.
4. A Flue evolution agent delegates mutation, evaluation, and review. Independent candidates that require isolation run as separate registered agents/jobs, not subagents sharing one filesystem.
5. The runner checkpoints, mutates, rebuilds/restarts when executable Flue modules changed, validates, and emits artifacts plus an executor attestation.
6. The proposed revision is stored but not active.
7. Mobile displays the evaluation report. Automatic or user-approved promotion submits a compare-and-swap `PedagogyActivationRequest`.
8. All connected instances observe the new generation and apply the compatible subset at their next safe boundary.

The mobile app can therefore cause and govern full self-modification without pretending that arbitrary downloaded JavaScript can safely execute inside the native app.

## Cross-instance synchronization

The proposed Not Organic account API is content-addressed and account-relative:

- `GET /v1/pedagogy/active` returns the active pointer and generation;
- `GET /v1/pedagogy/revisions/:id` returns a manifest;
- `HEAD|GET|PUT /v1/pedagogy/artifacts/:sha256` transfers immutable blobs with digest and size checks;
- `POST /v1/pedagogy/evolution/jobs` idempotently creates a job;
- `GET /v1/pedagogy/evolution/jobs/:id` reads durable status/result;
- `POST /v1/pedagogy/activations` performs compare-and-swap activation;
- `POST /v1/pedagogy/evidence` accepts minimized immutable evidence envelopes.

The authenticated Not Organic product session supplies account scope on every route. Attempts to include an `accountId` are rejected as unknown input. Writes use an idempotency key. Activation conflicts return the current generation so the client can inspect both lineages rather than silently selecting a winner.

Synchronization is a set reconciliation, not last-write-wins over mutable files:

1. compare active generation and known revision ids;
2. exchange missing manifests;
3. exchange missing content-addressed blobs;
4. exchange immutable evidence/job/activation receipts;
5. validate complete revision graphs locally;
6. move the local active pointer only at a safe conversation boundary.

MAP-Elites archives are immutable artifacts with parentage. Concurrent devices may create sibling revisions. Neither overwrites the other; evaluation and a later CAS activation decide which lineage becomes active, and the losing candidate remains inspectable.

## Skills, delegates, hooks, and MCP evolution

### Skills

Skills are versioned artifacts containing a manifest, `SKILL.md`, and optional resources. Prompt learning may evolve the instructions and examples. Skill code/scripts are executable source and follow source-bundle rules. The active revision records each skill digest, so the performance report can attribute outcomes to the exact skill version.

### Delegates

The initial delegate catalog should be small and explicit:

- `learner-diagnostician` summarizes current evidence without inventing mastery;
- `pedagogy-evolver` proposes prompt/policy/optimizer/source candidates;
- `pedagogy-evaluator` runs objective suites and learner-evidence comparisons;
- `pedagogy-reviewer` looks for regressions, privacy violations, and overfitting;
- `artifact-verifier` verifies digests, schemas, and reproducibility.

Flue subagents inherit the parent model and sandbox but not its conversation, instructions, tools, skills, persistent state, or initial data. Each delegate must mount what it needs explicitly. Because they share one sandbox, use subagents for focused context isolation. Use separate registered agents and separately provisioned workspaces for parallel or adversarial candidate evaluation.

### Hooks

Hook source is part of `source-bundle`. Changes to hook composition are tested and rebuilt in NodePod or the remote runner. Flue agent modules are discovered at build time, so arbitrary new executable agent modules are not hot-mounted into a deployed server. The stable shell loads mutable data/resources; executable shell changes produce a new runtime image/digest and new conversations route to it. Existing conversations remain pinned.

### MCP

MCP connection artifacts contain only server identity, transport, allowed tool names, and a reference to a broker capability. They never contain bearer tokens, cookies, or API keys.

- Hosted Flue uses `useMcpConnection` and Not Organic resolves broker credentials server-side.
- Browser-local uses existing WebMCP or a browser-safe fetch transport only where origin policy and authentication allow it.
- Mobile initially consumes MCP-backed tools through the hosted Flue conversation.
- Every mounted MCP tool passes through the same Keating authorization and receipt layer as a native tool.

An evolved revision may propose adding an MCP connection, but activation requires a user-visible permission diff and confirmation for any new external system or write capability.

## Not Organic trust boundaries

Not Organic is responsible for:

- portal login, PKCE validation, exact redirect validation, and DPoP binding;
- durable device-session rotation and revocation;
- deriving account namespace from the authenticated session;
- issuing narrow inference, sync, evolution, artifact, and activation scopes;
- storing account revision/job/pointer state;
- selecting runners and minting job-scoped leases;
- brokering model and MCP credentials without disclosing them to clients or revision artifacts;
- validating runner attestations and enforcing resource/network limits;
- metering and wallet decisions.

The sandbox is responsible only for the leased job. The Flue agent is responsible for reasoning and invoking bounded tools. Keating clients are responsible for local validation, safe-boundary activation, UI permission, and offline persistence. No layer should inherit authority merely because it has an account id-like string.

## Required adapters and possible upstream work

| Work item | Adapter, upstream change, or fork? | Reason |
|---|---|---|
| Flue on hosted Node | Direct dependency behind Keating custom hooks | Supported target |
| Browser-local Flue semantics | Keating browser adapter now; propose environment-neutral Flue core upstream | Published runtime is not browser-safe |
| React Native Flue runtime | Do not fork initially; use SDK plus bounded local engine | Arbitrary runtime adds security/App Store/JIT problems and duplicates remote capability |
| Existing `AgentSandbox` to Flue `Sandbox` | Adapter | Shapes map mechanically; preserve Keating capabilities/snapshots outside Flue |
| NodePod | Adapter | Browser provider, not a Flue target |
| Cloudflare Sandbox | Separate provider adapter/target | Prevent bindings and Durable Objects entering shared contracts |
| Other microVM/container services | `EvolutionRunnerAdapter` implementations | Selected by capabilities |
| Not Organic models | Pi provider adapter registered with Flue | Flue model protocol is Pi's protocol |
| Request/job-scoped model auth | Adapter plus isolated job context; upstream hook if context cannot reach provider auth | Module-global provider registration must not mix tenant credentials |
| Not Organic conversation durability | Flue `PersistenceAdapter` over the chosen durable store | Conversation state only |
| Account pedagogy sync | Keating/Not Organic service, not Flue persistence | Cross-instance, account-global immutable graph |
| Browser conversation persistence | Existing IndexedDB event store/browser renderer | Flue ships no IndexedDB persistence adapter |
| Dynamic prompt/policy/weights | Revision loader + Flue state/instruction hooks | Data is naturally dynamic |
| Dynamic executable hooks/tools/agents | Rebuild/restart a pinned runtime revision | Flue agent discovery is build-time |
| Tool authorization | Keating wrapper around every tool/MCP tool | Flue resource mounting is not the product permission policy |

## Delivery order

### Slice 1: prove the authoring boundary

- Pin Flue 2.0.3 in the isolated worktree.
- Add one hosted `KeatingTeacher` using `useModel`, `useTool`, `useSkill`, `useSubagent`, `useDataWriter`, and lifecycle metadata.
- Add `@keating/agent-runtime` custom hooks and contract tests.
- Adapt the in-memory `AgentSandbox` to Flue's `Sandbox` interface.
- Keep the current browser agent untouched as the behavioral oracle.

Exit: the same deterministic teaching tool and instruction revision produces equivalent complete output under the current browser loop and hosted Flue spike.

### Slice 2: browser renderer

- Implement the portable hook collector over the current browser loop.
- Map NodePod, IndexedDB state, skills, subagents, and OpenUI data writers.
- Add cross-runtime tests for conditional resources, child-context isolation, revision pinning, and lifecycle receipts.

Exit: a signed-out, offline browser can teach, modify prompts/policy/weights, checkpoint, validate, roll back, and resume without contacting Not Organic.

### Slice 3: Not Organic native login

- Add registered native client metadata and HTTPS App/Universal Link callback.
- Implement native non-exportable P-256 signing.
- Implement rotating DPoP-bound device sessions and revocation.
- Add account UI, refresh, logout, and lost-device revocation.

Exit: mobile remains signed in across access-token rotation; stealing an access or refresh value without the device key is insufficient; logout/revocation stops refresh.

### Slice 4: account artifact sync

- Move the shared account-evolution contracts into the worktree.
- Implement artifact/revision/evidence/pointer APIs and device set reconciliation.
- Show revision and evaluation-report history on web and mobile.

Exit: two separately authenticated devices converge on the same immutable graph and active generation without transferring device credentials.

### Slice 5: provider-neutral remote evolution

- Implement one non-Cloudflare runner adapter first and a deterministic fake adapter for contract tests.
- Run mutation/evaluation/review as Flue agents.
- Enforce job leases, broker capabilities, network/resource policy, checkpoints, attestations, and CAS activation.
- Add a second materially different runner adapter before declaring the interface portable.

Exit: the same job fixture succeeds on both adapters with identical account result contracts and no provider name in any client payload.

### Slice 6: executable evolution

- Version hook/tool/delegate source in `source-bundle`.
- Build and test a new runtime digest inside the runner.
- Pin conversations to runtime and pedagogy revision.
- Roll new conversations forward after activation; retain rollback routing.

Exit: a source mutation can be reproduced from immutable inputs, evaluated, activated, observed from browser/mobile, and rolled back account-wide without changing or restarting an in-flight learner conversation.

## Acceptance laws

1. With networking disabled, browser NodePod can complete a deterministic teaching and prompt-evolution fixture.
2. The browser bundle contains no Node-only import from `@flue/runtime`.
3. A mobile artifact payload containing `accountId`, a private JWK field, refresh token, API key, or MCP credential is rejected.
4. A DPoP capability cannot be refreshed with a different device key, and a rotated refresh credential cannot be replayed.
5. A runner job cannot read the user's device session or any other account's artifacts.
6. A job requiring `microvm` is never scheduled on NodePod, a process sandbox, or a container-only adapter.
7. A failed validation restores the complete checkpoint and cannot leave a partially updated prompt/policy/source combination active.
8. Two concurrent activations from the same generation yield exactly one winner and one explicit conflict.
9. An unsupported mobile revision leaves the last compatible revision active and records the incompatibility.
10. Synthetic evidence cannot increment observed or delayed-observed learner outcomes.
11. Every learner outcome used by optimization refers to the exact pedagogy revision and exposure that produced it.
12. A subagent cannot see parent history, tools, skills, or state unless Keating explicitly mounts or passes them.
13. Parallel candidate evaluators receive different runner workspaces.
14. Adding an MCP server or external write capability requires a visible permission diff before activation.
15. Switching the configured runner from one vendor adapter to another changes no account, job, revision, or activation API shape.

## Source references

- [Flue Agents](https://flueframework.com/docs/guide/building-agents/)
- [Flue Agent Hooks](https://flueframework.com/docs/guide/agent-hooks/)
- [Flue Subagents](https://flueframework.com/docs/guide/subagents/)
- [Flue Sandboxes](https://flueframework.com/docs/guide/sandboxes/)
- [Flue Sandbox Adapter API](https://flueframework.com/docs/reference/sandbox-api/)
- [Flue Provider API](https://flueframework.com/docs/reference/provider-api/)
- [Flue Durability](https://flueframework.com/docs/guide/durability/)
- [Flue Data Persistence API](https://flueframework.com/docs/reference/data-persistence-api/)
- [Flue Routing and SDK](https://flueframework.com/docs/guide/routing/)
- [Flue SDK overview](https://flueframework.com/docs/sdk/overview/)
- [Flue React client](https://flueframework.com/docs/guide/react/)
- [Flue deployment targets](https://flueframework.com/docs/guide/deploy/)
- [Flue repository and package map](https://github.com/withastro/flue)
- [Flue runtime package metadata](https://github.com/withastro/flue/blob/main/packages/runtime/package.json)
