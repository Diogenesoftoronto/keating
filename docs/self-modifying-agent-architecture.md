# Keating Self-Modifying Agent Architecture Plan

## Overview & Origin

This document captures the architectural thinking around making Keating's browser agent capable of maximum self-modification — editing its own prompts, policy, operational protocol, core logic, and tool definitions at runtime — with safe checkpoint/rollback semantics. The plan emerged from three converging ideas:

1. **agentOS / Rivet** provides hosted infrastructure (actors, workflows, cron, host tools) that could close the gap between CLI-quality and browser-quality self-evolution.
2. **NodePod** (open-source browser-native Node.js runtime) makes it possible to run the full agent loop — including code eval and self-editing — entirely client-side, for free, in the browser.
3. **microsandbox** (Apache 2.0 microVM sandbox) provides server-side hardware-isolated execution with snapshot/restore, making the VM-in-VM checkpoint model work for the paid Keating Cloud tier.

The result is now a staged architecture. Keating v1 establishes the serving and runtime boundary first: browser-only work stays local by default, remote-only work has an explicit proxy path, and future NodePod, Daytona, microsandbox, or agentOS integrations fit behind the same sandbox capability interface.

---

## Author's Notes (Verbatim)

### Message 1 — The Initial Question

> how would i use agentos the rivet package to get the browser agent to be more like the cli in terms of its hyperteach self editing self evolving nature?

### Message 2 — Monetization & Sandbox Options

> mmm this could be where this makes sense too monetize actually. so here's the idea, there is a keating cloud option, this is separate from just trying keating, this is hosted compute on the server you can go run on your own. for the normal keating users they will be using a really limited set of evolution that is totally local to the server and they have to install that to get it working. for others that want to try it in the browser with full capability this is where i offer keating cloud and that is where the agent fully can evolve with agent pi and the sandbox, another option i think might be [microsandbox](https://github.com/superradcompany/microsandbox) and webcontainers from stackblitz. however, while researchering this i learned about a few other things: https://github.com/ScelarOrg/NodePod nodepod is an alternative to webcontainers and is open source with an MIT licence this means i can actually get browserbased code changes working and modified!

### Message 3 — Self-Modification + Safe Rollback

> there are two things that i want to think about architecturally how do i get the agent to be able to maximally change and edit itself while it runs? I need to be able to do this in a safe way, which means allowing rollbacks to a safecheck point save state or snapshot. whatever you wish to call it. this is possible in the microvm already. so we may be able to start the service in the vm and check point and load new versions, this is sort of like a vm in vm solution. with the browser operating similarily with the nodepod. for now i think we can manage to keep this free. since nodepod should let us run all the code we want (essentially the entire core agent loop) in the browser on the client.

---

## Current State Analysis

### v1 Serving Contract

Keating now has three explicit web serving modes:

| Mode | Command | Runtime meaning |
|---|---|---|
| Browser-only | `keating web --browser-only-agent [port]` | Free/local default. Browser-compatible agent work runs on the learner's device. Remote-only work returns a clear fallback. |
| Remote | `keating web --remote [port] --remote-provider=... --remote-endpoint=...` | Self-hosted local-first mode. The browser runs what it can locally and routes remote-only operations through the configured sandbox endpoint. |
| Cloud | `keating web --cloud [port]` | Canonical hosted mode. Remote-only operations route through the Keating backend at `https://keating.help` unless `--cloud-endpoint` overrides it. |

The browser consumes this contract through `/api/agent-runtime/config`. The same server exposes `/api/agent-runtime/remote/**` as the controlled proxy path for remote/cloud modes. In browser-only mode that proxy returns `403`, which is intentional: the free surface should not silently move arbitrary execution to a server.

The web agent receives two tools from this boundary:

- `agent_runtime`: reports mode, capabilities, remote endpoint metadata, and fallback policy.
- `remote_execute`: posts remote-only operations to `/api/agent-runtime/remote/execute` when configured, or returns a browser-only fallback explaining what cannot run locally.

This is not yet the full NodePod or microVM runtime. It is the load-bearing interface that lets those runtimes arrive as adapters instead of requiring a rewrite of the browser tools.

### CLI vs Web Agent: The Self-Evolution Gap

| Capability | CLI (Node.js) | Web Agent (Browser) |
|---|---|---|
| LLM-in-loop benchmark/evaluation | ✅ `piCompleteJson` for sim & prompt eval | ❌ Heuristic-only (keyword scoring) |
| Cross-run evolution archive | ✅ JSON files on disk, accumulate across invocations | ❌ Ephemeral IndexedDB, no accumulation |
| Prompt `.md` file read/write | ✅ Filesystem, human-auditable | ❌ `setSystemPrompt` in-memory only |
| `edit_source` applying edits | ✅ CLI can apply directly with `--backup-dir` | ❌ Diff-only, user must manually apply |
| Separate `evolve`, `bench`, `prompt-evolve` | ✅ Discrete CLI commands | ❌ Single `auto_improve` call |
| `keating auto-improve --force` cooldown | ✅ 30-min cooldown with override | ❌ No cooldown enforcement |
| Real learner feedback blending | ❌ Not yet (future) | ✅ Already works (unique browser advantage) |
| Multiple optimizers | ✅ Hill-climb, MAP-Elites, GEPA, ACE | ❌ MAP-Elites + PROSPER only |

### The 5 Self-Surfaces (What the Agent Can Modify About Itself)

| Self-Surface | Currently Mutable? | Rollback? | Why Not |
|---|---|---|---|
| Teaching policy (9 params) | ✅ `evolve` / `auto_improve` | ⚠️ Only if delta < −0.5 in `auto_improve` | No full version history |
| System prompt (persona + evolved) | ✅ `prompt_evolve` / `setSystemPrompt` | ❌ No version history | No revert mechanism |
| Operational protocol (the HOW) | ❌ Compile-time constant | — | `KEATING_OPERATIONAL_PROTOCOL` is hardcoded |
| Core logic (`core.ts`) | ❌ `edit_source` is diff-only in browser | — | No filesystem, no eval |
| Tool definitions | ❌ Static at agent creation | — | Tools are registered once, never touched |

### Existing Snapshot/Rollback Mechanisms

| Mechanism | Scope | Trigger |
|---|---|---|
| Policy rollback | Teaching policy only | Score delta < −0.5 in `auto_improve` |
| Session snapshot | Messages, model, thinkingLevel | Every `agent_end` event |
| Session fork | Full session copy | User action |
| Persona reset | Persona string | User action |
| CLI `--backup-dir` | Source files before `edit_source` | CLI context only |

**What does NOT exist:** No full-state checkpoint (policy + prompt + weights + persona). No policy version history. No prompt evolution rollback. No undo for accepted `auto_improve`. No `edit_source` approval workflow in browser. No snapshot of simulation weights across runs.

---

## Technology Survey

### agentOS (Rivet) — Agent Infrastructure

- **By**: rivet-dev (Ironclad)
- **License**: Apache 2.0
- **npm**: `rivetkit`, `@rivet-dev/agent-os-core`
- **What it provides**: In-process OS kernel for AI agents — isolated V8 isolates + WASM POSIX utils + optional E2B/Daytona sandbox extensions. Actors with persistent state, durable workflows, cron scheduling, host tools (expose JS functions as agent CLI commands), session/transcript persistence via ACP, agent-to-agent delegation.

| Self-Evolution Primitive | agentOS Feature |
|---|---|
| Modify own code | Full read/write persistent filesystem + shell execution |
| Learn from history | Automatic transcript persistence + session replay (ACP) |
| Structured memory | SQLite for long-term knowledge storage |
| Act autonomously on schedule | Cron jobs for recurring self-auditing/maintenance |
| Improve through peer review | Agent-to-agent delegation and multi-session VMs |
| Extend own capabilities dynamically | Host tools (discover and call new backend functions as CLI commands) |
| Persist improvements across restarts | Actor storage survives sleep/wake, up to 10 GB |
| Modify external systems | S3, Google Drive, host directory, and sandbox mounts |
| Complete complex self-modification reliably | Durable workflows with retries and branching |

**Fit for Keating**: Best suited as the orchestration layer for the paid cloud tier — durable workflows for `auto_improve` loops, cron for scheduled evolution, host tools for LLM evaluation. Not needed for the browser tier.

### NodePod — Browser-Native Node.js Runtime

- **By**: ScelarOrg (Scelar AI app builder)
- **License**: MIT + Commons Clause (source-available; can use in any product, just can't resell NodePod itself)
- **npm**: `nodepod` (or `@scelar/nodepod`)
- **Architecture**: Pure TypeScript polyfills running atop the browser's JS engine — no WebAssembly compilation of Node.js. ~600KB gzipped, ~100ms boot.

| Component | Implementation |
|---|---|
| Filesystem | `MemoryVolume` — in-memory POSIX-like tree with 30+ sync `fs` methods. Binary snapshots via `ArrayBuffer` for worker spawn and persistence. |
| Execution | `ScriptEngine` — reads files from VFS, strips TypeScript with regex, converts ESM→CJS via acorn-based AST parser, wraps in sandboxed function, runs with `eval()`. |
| Polyfills | 40+ Node.js built-in modules: `fs`, `http`, `child_process`, `stream`, `crypto`, `path`, `net`, `zlib`, etc. |
| Process model | Each process in its own Web Worker with own MemoryVolume and ScriptEngine. Up to 50 processes, 10 levels deep. VFS sync via binary snapshots. |
| Shell | ~3,500-line TypeScript shell with 35+ built-in commands, pipes, redirections, globs. |
| Package manager | Full npm client: semver resolution, parallel downloads, ESM→CJS via esbuild-wasm. Express installs in ~3-5s. |
| Networking | Service Worker intercepts `/__virtual__/{port}/...`, routes to owning Web Worker. WebSocket via BroadcastChannel. |

**Critical capabilities for Keating**:
- `pod.snapshot()` → binary `ArrayBuffer` capturing full VFS state — the checkpoint primitive
- `pod.restore(snapshot)` → ~10ms rollback to any prior state
- `pod.fs.writeFile()` / `pod.fs.readFile()` — agent reads and writes its own code
- `pod.spawn('node', [...])` with output capture — execute mutated code
- Snapshots can be persisted to IndexedDB for cross-session survival

**License caveat**: MIT + Commons Clause means you can use NodePod inside Keating Cloud, you just can't sell "NodePod hosting" as a standalone product. Since Keating's value is the hyperteacher, not the browser runtime, this is fine.

**Limitation**: Polyfilled `http` can't reach external APIs without a CORS proxy, so LLM calls for evaluation can't happen purely in-browser without the host app proxying them.

### microsandbox — Server-Side MicroVM Sandbox

- **By**: Super Rad Company (YC-backed)
- **License**: Apache 2.0 (fully open source)
- **Language**: ~85% Rust
- **Architecture**: Real microVMs with own Linux kernel via libkrun (KVM on Linux, Apple Virtualization Framework on macOS). Not containers — hardware-level isolation.

| Feature | Detail |
|---|---|
| Boot | Sub-100ms cold start |
| Sandboxing | Hardware virtualization — own kernel, own memory, own network stack |
| Secret handling | Placeholder substitution — real API keys never enter the VM |
| Network policy | Programmable: allowlist domains, DNS rebinding protection, TOCTOU pinning, SNI verification, domain-fronting prevention |
| TLS interception | Auto-generated CA for host-side inspection and secret injection |
| Snapshots | Stopped-sandbox disk-level snapshots; new VMs boot from them instantly |
| Rootfs | Native passthrough (fastest) or Overlayfs with OCI image layering + COW |
| SDK | Rust, Python, TypeScript, Go |
| Agent integration | First-class MCP server + Agent Skills package (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot) |
| Rootless | No root or daemon required — runs as child process of calling application |

**Critical capabilities for Keating**:
- `sandbox.snapshot()` — disk-level COW layer capture, survives reboot
- Boot new VM from snapshot in ~100ms — the rollback primitive
- Full networking — LLM calls for benchmark simulation and prompt evaluation work natively
- Placeholder secrets — user API keys can't leak even if agent goes rogue
- Any Linux language — not limited to TypeScript
- OCI image support — pre-build `keating-agent` image with pi-agent, keating CLI, all deps

---

## Target Tier Architecture

The target architecture below is the next implementation horizon. The v1 serving contract above already names the browser-only, remote, and cloud deployment modes; the remaining work is to attach stronger sandbox providers behind those modes.

```
┌─────────────────────────────────────────────────────────────┐
│  FREE / SELF-HOSTED                                         │
│  CLI plus `keating web --browser-only-agent`.               │
│  Local files, IndexedDB, and browser-compatible tools.       │
│  Remote-only work surfaces fallback errors.                 │
├─────────────────────────────────────────────────────────────┤
│  KEATING CLOUD — Browser Tier (Free)                        │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  NodePod (in-browser, no backend)                     │ │
│  │  - Full self-modification at all 3 mutation levels    │ │
│  │  - Heuristic-only validation (same as current core.ts)│ │
│  │  - Snapshots persisted to IndexedDB                   │ │
│  │  - Entire core agent loop runs client-side            │ │
│  │  - CORS proxy for LLM calls (optional, host-provided) │ │
│  └───────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  KEATING CLOUD — Server Tier (Paid)                         │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  microsandbox (server-side microVM)                  │ │
│  │  - Everything in browser tier PLUS:                   │ │
│  │  - LLM-in-loop evaluation (real pi-agent calls)       │ │
│  │  - Cross-session archive accumulation                  │ │
│  │  - Secret-safe API key handling (placeholder model)   │ │
│  │  - Any language (Python, Go, Rust, etc.)             │ │
│  │  - Multi-agent workflows (evolve + review)            │ │
│  └───────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  KEATING CLOUD — Enterprise (Self-hostable)                 │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  agentOS/Rivet actors + microsandbox fleet            │ │
│  │  - Durable workflows (survive crashes)                │ │
│  │  - Cron-scheduled auto-improve                        │ │
│  │  - Agent-to-agent delegation                          │ │
│  │  - Multi-tenant, SLAs                                 │ │
│  │  - Self-hostable on customer infra (Apache 2.0 all)   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### What stays free vs what's paid

**Free today (browser-only and CLI):**
- Browser-compatible agent work runs on the learner's device.
- CLI work uses the local filesystem and `.keating/` archive.
- Web self-improvement uses browser storage and deterministic/heuristic validation.
- Remote-only operations return an explicit fallback instead of silently executing on Keating infrastructure.

**Free target (NodePod in browser):**
- Full self-modification at all mutation levels (data, protocol, code)
- Heuristic-only validation (current `core.ts` benchmark quality)
- Snapshots persisted to IndexedDB
- Agent edits its own prompts, policy, protocol, and core logic
- Tool creation (agent writes and registers custom tools)
- All client-side, no backend, no API key needed for core loop

**Paid (Keating Cloud / microsandbox):**
- Everything above plus:
- LLM-in-the-loop evaluation (real pi-agent calls for benchmark sim and prompt eval)
- Real learner outcome blending (progressively replacing synthetic learners)
- Cross-session archive accumulation (`.keating/` directory persists across VM boots)
- Multi-agent workflows (one agent evolves, another reviews)
- Scheduled autonomous evolution (cron-based auto-improve)
- Secret-safe API key handling (placeholder model)
- Any language toolchain, not just TypeScript

---

## The Core Architecture: Transactional Self-Modification

### The Transaction Loop

Every mutation — whether it's a policy tweak, a prompt rewrite, or a core-logic edit — goes through the same loop:

```
CHECKPOINT  →  MUTATE  →  RELOAD  →  VALIDATE  →  COMMIT | ROLLBACK
```

Concretely, as the agent runs inside the sandbox:

1. **CHECKPOINT** — Before any self-modification, snapshot the VFS:
   - NodePod: `const cp = pod.snapshot()` — captures the full in-memory filesystem as a binary `ArrayBuffer`
   - microsandbox: `await sandbox.snapshot()` — captures the disk-level writable layer

2. **MUTATE** — The agent writes to its own files:
   - `pod.fs.writeFile("/agent/prompts/learn.md", improvedPrompt)`
   - `pod.fs.writeFile("/agent/core/evolution.ts", patchedSource)`
   - `pod.fs.writeFile("/agent/protocol.md", newProtocol)`

3. **RELOAD** — Hot-reload the mutated module without restarting the agent:
   - NodePod: the runtime re-evaluates the changed file via `eval()` (ScriptEngine already works this way — it reads from VFS on each `require()`)
   - microsandbox: signal the running process to reimport the module (Node.js `--watch` or a custom HMR hook)

4. **VALIDATE** — Run `bench` against the post-mutation state. Compare to the pre-mutation baseline.

5. **DECIDE**:
   - Score ≥ baseline → **COMMIT**: the mutation stands, the checkpoint is archived (not deleted — keeps history)
   - Score < baseline by > threshold → **ROLLBACK**: restore from checkpoint, mutation is discarded
   - Score within noise margin → **STASH**: mutation is saved as a candidate but not activated

This is structurally identical to how the CLI's `auto_improve` already works for policy, but generalized to all surfaces and backed by VM-level snapshots instead of ad-hoc re-save.

### The VM-in-VM Model

```
BROWSER:
┌──────────────────────────────────┐
│  Host page (React app) — VM 0    │  ← renders UI, manages chat sessions
│  ┌────────────────────────────┐   │
│  │  NodePod — VM 1           │   │  ← agent runtime, all /agent/ files
│  │  ┌──────────────────────┐ │   │
│  │  │  Agent process       │ │   │  ← eval'd core.ts, tools, prompts
│  │  │  can write to /agent/│ │   │
│  │  └──────────────────────┘ │   │
│  │  snapshot() → ArrayBuffer │   │  ← atomic, captures all VFS state
│  │  restore()  → from IDB    │   │  ← rollback in ~10ms
│  └────────────────────────────┘   │
└──────────────────────────────────┘

SERVER:
┌──────────────────────────────────┐
│  Host machine — VM 0             │  ← Nitro server, user auth, billing
│  ┌────────────────────────────┐   │
│  │  microsandbox — VM 1       │   │  ← real Linux microVM
│  │  ┌──────────────────────┐ │   │
│  │  │  keating agent proc  │ │   │  ← real pi-agent, real LLM calls
│  │  │  can write to /      │ │   │     full filesystem, any language
│  │  └──────────────────────┘ │   │
│  │  snapshot() → COW layer   │   │  ← disk-level, survives reboot
│  │  restore()  → boot from  │   │  ← rollback in ~100ms
│  └────────────────────────────┘   │
└──────────────────────────────────┘
```

The key insight: **VM 1 is the unit of checkpoint/rollback, not individual files.** This means the agent can make multiple related changes (edit core logic + update protocol + tweak policy) in a single transaction, and if the combined mutation regresses, the *entire* VFS rolls back atomically. There's no partial inconsistency.

---

## The Sandbox Filesystem Layout

```
/agent/
  prompts/                 ← Level 1: data mutation
    learn.md
    bridge.md
    diagnose.md
    quiz.md
    improve.md
  policy.json              ← Level 1: data mutation
  weights.json             ← Level 1: data mutation
  protocol.md              ← Level 2: protocol mutation
  core/                    ← Level 3: logic mutation
    lesson-plan.ts
    benchmark.ts
    evolution.ts
    map-elites.ts
    prompt-eval.ts
    verification.ts
    topics.ts
    policy.ts
  tools/                   ← Level 3: tool mutation
    teaching.ts
    self-evolve.ts
    custom-*.ts            ← agent-created tools
  registry.json            ← tracks active versions + checkpoint history
  checkpoints/             ← snapshot store
    cp-1748654321/
      (full VFS snapshot, or reference to IDB key)
    cp-1748654500/
      ...
  agent.ts                 ← the runtime loop itself
```

---

## The Mutation Levels

### Level 1 — Data Mutation (Prompts, Policy, Weights)

This is what already works today. The sandbox adds real checkpoint/rollback instead of the current partial solution. No code eval needed — the runtime reads the changed file on next access.

**What changes from today:**
- Agent writes to `/agent/prompts/learn.md` instead of calling `setSystemPrompt()`
- Agent writes to `/agent/policy.json` instead of calling `storage.savePolicy()`
- Both are preceded by `checkpoint()`, followed by `benchmark()`, and rolled back atomically on regression
- Version history is maintained in `registry.json`

### Level 2 — Protocol Mutation

The agent can rewrite `/agent/protocol.md`, which replaces the currently hardcoded `KEATING_OPERATIONAL_PROTOCOL`. The reload is a re-composition: `composeKeatingSystemPrompt(persona, newProtocol)`.

**Safety properties:**
- The protocol is just text injected into the system prompt — a bad protocol degrades behavior but doesn't crash the runtime
- Validation = benchmark score after recomposition
- Rollback = restore from VFS snapshot (the old protocol.md is in the checkpoint)

**What changes from today:**
- `KEATING_OPERATIONAL_PROTOCOL` becomes a file the agent can write to instead of a compile-time constant
- The agent can adjust its own behavior rules: "I should check timelines less aggressively", "I should trigger auto_improve after 2 sessions not 3", "I should add a new teaching pattern for X domain"

### Level 3 — Code Mutation (Core Logic + Tools)

The hardest and most powerful level. The agent can edit its own `core/` TypeScript, which gets re-eval'd inside the sandbox.

**Two safeguards:**

1. **Schema guard**: Before eval'ing a mutated module, validate it produces the expected type signature. A quick `typeof result` check after eval catches broken modules before they're activated.
2. **Isolation**: Mutated core modules run in a test harness first (benchmark with a fixed seed), then get promoted to the active runtime only if the harness passes.

```typescript
// Inside the sandbox: the mutation gate
async function tryMutate(modulePath: string, newSource: string): Promise<boolean> {
  // 1. Checkpoint
  const cp = await checkpoint();

  // 2. Write
  fs.writeFile(modulePath, newSource);

  // 3. Eval in test harness (not the live runtime)
  const candidate = evalModule(modulePath);
  if (!validateSignature(candidate)) {
    await rollback(cp);
    return false;
  }

  // 4. Benchmark candidate vs baseline
  const candidateScore = await benchmarkWith(candidate);
  if (candidateScore < baselineScore - NOISE_FLOOR) {
    await rollback(cp);
    return false;
  }

  // 5. Promote to live
  await promote(candidate);
  return true;
}
```

**Level 3b — Tool Mutation.** The agent can write new tools to `/agent/tools/custom-*.ts`. These get registered into the live agent session if they pass schema validation (have a `name`, `description`, `parameters` JSON schema, and `execute` function). This is how the agent "grows new capabilities" — it writes a tool, tests it, and if it works, it becomes part of its own toolset.

**What changes from today:**
- `edit_source` goes from "produce a diff the user must manually apply" to "write the file, eval it, benchmark it, commit or rollback"
- The agent can actually modify how `buildLessonPlan()` works, not just its input parameters
- New tools can emerge organically — the agent writes a `custom-quiz.ts` that generates domain-specific quiz formats, validates it, and self-registers it

---

## The Registry — Version Tracking

Every mutation updates the registry, which tracks which version of each module is active:

```jsonc
{
  "version": 17,
  "baselineScore": 74.2,
  "lastCheckpoint": "cp-1748654321",
  "modules": {
    "prompts/learn.md": { "hash": "a1b2c3", "version": 5, "score": 76.1 },
    "policy.json": { "hash": "d4e5f6", "version": 8, "score": 74.2 },
    "protocol.md": { "hash": "g7h8i9", "version": 2, "score": 73.8 },
    "core/lesson-plan.ts": { "hash": "j0k1l2", "version": 1, "score": 74.2 },
    "core/evolution.ts": { "hash": "m3n4o5", "version": 3, "score": 75.0 },
    "tools/custom-quiz.ts": { "hash": "p6q7r8", "version": 1, "score": 74.5 }
  },
  "checkpoints": [
    { "id": "cp-1748654321", "timestamp": "2026-05-31T12:00:00Z", "score": 74.2, "label": "baseline" },
    { "id": "cp-1748654500", "timestamp": "2026-05-31T12:05:00Z", "score": 76.1, "label": "prompt-evolve-v5" }
  ]
}
```

This enables:
- **Selective rollback**: revert just one module while keeping others
- **Audit trail**: see exactly what changed, when, and with what effect on the score
- **User visibility**: the user can browse the registry and cherry-pick changes
- **Agent self-awareness**: the agent can read the registry to understand its own mutation history

---

## Bootstrapping the Agent into the Sandbox

The agent doesn't start as an empty shell. At boot, the host populates the VFS with the current known-good state:

```typescript
// Browser boot
const pod = await Nodepod.boot({
  files: {
    "/agent/prompts/learn.md": await loadEvolvedPrompt(storage),
    "/agent/policy.json": JSON.stringify(await loadActivePolicy(storage)),
    "/agent/weights.json": JSON.stringify(DEFAULT_WEIGHTS),
    "/agent/protocol.md": await loadProtocol(storage),  // was hardcoded, now a file
    "/agent/core/lesson-plan.ts": lessonPlanModuleSource,
    "/agent/core/benchmark.ts": benchmarkModuleSource,
    "/agent/core/evolution.ts": evolutionModuleSource,
    "/agent/core/prompt-eval.ts": promptEvalModuleSource,
    "/agent/tools/teaching.ts": teachingToolsSource,
    "/agent/tools/self-evolve.ts": selfEvolveToolsSource,
    "/agent/registry.json": JSON.stringify(initialRegistry),
    "/agent/agent.ts": agentRuntimeSource,  // the main loop
  },
});

// Take baseline checkpoint immediately
const baselineSnapshot = pod.snapshot();
await saveToIndexedDB("baseline", baselineSnapshot);
```

Each session starts by restoring the latest checkpoint (if one exists) or from the fresh boot state.

---

## Browser vs Server Implementation Differences

| Aspect | NodePod (browser, free) | microsandbox (server, paid) |
|---|---|---|
| **Snapshot mechanism** | `pod.snapshot()` → binary ArrayBuffer in JS memory | `sandbox.snapshot()` → disk-level COW layer |
| **Restore** | `pod.restore(snapshot)` in ~10ms | Boot new VM from snapshot in ~100ms |
| **Persistence** | Save snapshots to IndexedDB (survives tab close) | Snapshots are disk artifacts (survive reboot) |
| **LLM evaluation** | No — polyfilled `http` can't reach external APIs without a CORS proxy | Yes — full networking, can call `api.openai.com` etc |
| **Code mutation scope** | TypeScript only (what NodePod's ScriptEngine can eval) | Any Linux language (Python, Go, Rust, etc) |
| **Secrets** | Browser-only, same-origin | microsandbox placeholder model — real keys never enter VM |
| **Validation quality** | Heuristic benchmarks (current `core.ts` evaluation) | Heuristic + real LLM judge (CLI-quality evaluation) |
| **Multi-agent** | Single process in one Web Worker | Can spawn multiple VMs for code review pipelines |
| **Cost** | Free (runs on user's device) | Paid (server compute) |
| **Cold start** | ~100ms | Sub-100ms with pre-built OCI images |

---

## AgentOS / Rivet Integration (Enterprise Tier)

For the enterprise tier, agentOS provides the orchestration layer on top of the microsandbox fleet:

### Host Tools for LLM Evaluation

```typescript
import { toolKit, hostTool } from "@rivet-dev/agent-os-core";
import { z } from "zod";

const keatingKit = toolKit({
  name: "keating",
  tools: {
    evaluate_prompt: hostTool({
      description: "LLM-evaluate a teaching prompt on 6 objectives",
      inputSchema: z.object({
        prompt: z.string(),
        objectives: z.array(z.string()),
      }),
      execute: async ({ prompt, objectives }) => {
        return await serverSideEval(prompt, objectives);
      },
    }),
    apply_edit: hostTool({
      description: "Apply a search/replace edit to a prompt file",
      inputSchema: z.object({
        path: z.string(),
        old: z.string(),
        new: z.string(),
      }),
      execute: async ({ path, old, new: newText }) => {
        return applySafely(path, old, newText);
      },
    }),
  },
});
```

### Durable Self-Improvement Workflow

```typescript
workflow("keating-auto-improve", async (c) => {
  await c.step("benchmark", () => sandbox.exec("keating bench"));
  await c.step("evolve", () => sandbox.exec("keating evolve"));
  await c.step("prompt-evolve", () => sandbox.exec("keating prompt-evolve"));
  const postScore = await c.step("post-bench", () => sandbox.exec("keating bench"));
  if (postScore < preScore) await c.step("rollback", restoreSnapshot);
});
```

### Scheduled Autonomous Evolution

```typescript
await scheduleCron({
  schedule: "0 */4 * * *",
  action: {
    type: "session",
    agent: "pi",
    prompt: "Run auto-improve on the weakest topic. Write the report to /agent/checkpoints/",
  },
});
```

---

## What This Unlocks That Doesn't Exist Today

1. **The agent rewrites its own teaching strategy** — not just policy params, but the lesson-plan algorithm itself. "What if I add a `reinforcement` phase after examples?" → write it, eval it, benchmark it, commit or rollback.

2. **The protocol evolves** — the currently-fixed operational protocol becomes a living document. The agent can decide "I should check timelines less aggressively" and amend the protocol.

3. **New tools emerge** — the agent writes a `custom-quiz.ts` tool that generates domain-specific quiz formats, validates it, and self-registers it. Next session, it's part of the toolset.

4. **Cross-session accumulation** — checkpoints persist in IndexedDB (browser) or on disk (server). The agent resumes from its last known-good state, not from the compile-time default.

5. **Full rollback at any point** — not just "policy reverted if delta < −0.5" but atomic VFS-level rollback for any mutation at any level.

6. **The user can inspect and cherry-pick** — because every mutation is a file write with a score delta, the user can browse `registry.json`, see what the agent changed, and selectively revert individual modules.

---

## Implementation Roadmap

### Phase 1: NodePod Integration (Browser Tier, Free)

**Goal**: Make the browser agent capable of maximal self-modification with checkpoint/rollback, running entirely client-side.

1. Add `nodepod` as a web dependency
2. Create the VFS boot sequence — populate `/agent/` from current known-good state
3. Implement `checkpoint()` and `rollback()` primitives using `pod.snapshot()` / `pod.restore()`
4. Persist snapshots to IndexedDB for cross-session survival
5. Replace `setSystemPrompt()` with VFS writes to `/agent/prompts/learn.md`
6. Replace `storage.savePolicy()` with VFS writes to `/agent/policy.json`
7. Move `KEATING_OPERATIONAL_PROTOCOL` from hardcoded constant to `/agent/protocol.md`
8. Implement the mutation gate (checkpoint → mutate → reload → benchmark → commit|rollback)
9. Wire `edit_source` to actually apply edits inside the VFS with automatic checkpoint/rollback
10. Implement tool self-registration from `/agent/tools/custom-*.ts`
11. Add `registry.json` version tracking and the user-facing audit UI

### Phase 2: microsandbox Integration (Server Tier, Paid)

**Goal**: Add LLM-in-loop evaluation, cross-session archives, and secret-safe execution.

1. Pre-build `keating-agent` OCI image with pi-agent + keating CLI
2. Implement per-user sandbox creation/teardown on the Nitro server
3. Wire `sandbox.snapshot()` / restore for server-side checkpoint/rollback
4. Add `VirtioFS` share for persistent `.keating/` directory across VM boots
5. Configure network policy: allowlist `api.openai.com`, `api.anthropic.com` etc
6. Inject placeholder secrets for user API keys
7. Wire LLM evaluation into the mutation gate — replace heuristic scoring with `piCompleteJson` calls
8. Implement cross-session archive accumulation (evolution JSON files that grow over time)
9. Add multi-agent workflow: one sandbox evolves, another reviews

### Phase 3: agentOS/Rivet Orchestration (Enterprise Tier, Self-Hostable)

**Goal**: Durable workflows, cron scheduling, multi-tenant isolation.

1. Wrap the microsandbox fleet in Rivet actors
2. Implement durable `auto-improve` workflow with crash recovery
3. Add cron-scheduled self-improvement
4. Multi-tenant isolation per customer
5. Self-hostable deployment package (Docker Compose or Kubernetes)
6. SLA monitoring and alerting

---

## Open Questions

- **NodePod `http` polyfill limits**: Can we make LLM calls work in-browser via a Service Worker proxy on the same origin? This would make the browser tier nearly equivalent to the server tier for evaluation quality.
- **Module reload granularity**: When the agent edits `/agent/core/evolution.ts`, how do we reload just that module without restarting the entire agent process? NodePod's `require()` cache needs a cache-bust mechanism.
- **Checkpoint storage budget**: Snapshots are binary ArrayBuffers. With active mutation, how many checkpoints can we keep in IndexedDB before hitting storage limits? Need a GC policy (keep last N, keep all with score improvement, etc).
- **TypeScript eval safety**: NodePod strips TypeScript with regex, then evals JS. What's the blast radius of a malformed or malicious eval? Can we limit it to pure functions that can't access the host page's DOM?
- **Cross-tier compatibility**: If a user evolves their agent on the free tier (heuristic eval) then upgrades to the paid tier (LLM eval), should the mutations be re-evaluated with the stronger evaluator? Likely yes, but need a migration path.
- **Registry conflicts**: If two sessions mutate the same module concurrently, how do we merge? Likely: last-writer-wins with checkpoint comparison, but this needs a design.

---

## Research Update — 2026-05-31

This section validates the core assumptions against current public sources and translates them into a repo-facing architecture. The major conclusion: the sandbox technologies are plausible, but Keating should first introduce a shared engine/runtime boundary. NodePod, microsandbox, and agentOS should become runtime adapters behind that boundary rather than the first architectural move.

### External Runtime Findings

| Technology | Current finding | Keating implication |
|---|---|---|
| **NodePod** | The package is `@scelar/nodepod`. It supports browser boot with initial files, `spawn`, `install`, virtual HTTP servers, `fs.readFile` / `fs.writeFile`, and explicit `snapshot()` / `restore(snapshot)`. It requires a same-origin service worker at `/__sw__.js` for previews and virtual servers. License is MIT plus Commons Clause, with an exception for use as a component of a larger application. Sources: [NodePod GitHub README](https://github.com/ScelarOrg/NodePod), [NodePod license](https://raw.githubusercontent.com/ScelarOrg/NodePod/main/LICENSE), [service worker setup](https://raw.githubusercontent.com/ScelarOrg/NodePod/main/docs/sw-setup.md). | Good fit for the browser free tier's transactional VFS. It should not be treated as a security isolation boundary for hostile code; treat it as a rollbackable, same-origin worker runtime. |
| **microsandbox** | Public materials now explicitly advertise local, embedded microVMs, OCI images, programmable network policy, secret placeholder substitution, extensible filesystems, and snapshot/fork/restore. GitHub README marks it beta, Apache-2.0, with Linux KVM or macOS Apple Silicon requirements. Sources: [microsandbox homepage](https://microsandbox.dev/), [microsandbox GitHub](https://github.com/superradcompany/microsandbox), [microsandbox docs](https://docs.microsandbox.dev/). | Strong fit for the paid/self-hosted cloud runtime where code mutation, full toolchains, real network calls, and secret handling matter. Keep it out of the browser baseline. |
| **Rivet agentOS** | Current docs label agentOS preview. It provides isolated agent VMs, host tools, persistent state, file/process APIs, networking/previews, cron, workflows, multiplayer sessions, agent-to-agent pipelines, and hybrid sandbox mounting. Sources: [agentOS docs](https://rivet.dev/docs/agent-os/), [agentOS product page](https://rivet.dev/agent-os/), [Rivet workflows](https://www.rivet.dev/docs/actors/workflows/). | Use as an enterprise orchestration layer after Keating has a stable runtime contract. Do not make Phase 1 depend on a preview API. |
| **StackBlitz WebContainers** | The public API supports `boot`, filesystem access, `spawn`, and `mount` from a `FileSystemTree` or binary snapshot generated by `@webcontainer/snapshot`. Source: [WebContainer API](https://webcontainers.io/api). | Useful comparison point, but less direct for live rollback because the public docs emphasize mount-time binary snapshots rather than NodePod-style `snapshot()` / `restore()` on the running VFS. |

### Corrections To The Earlier Assumptions

1. **CLI evaluation is mixed, not purely LLM-backed.** `src/core/benchmark.ts` uses deterministic algebraic simulation by default and only calls `piCompleteJson` when `KEATING_LLM_BENCHMARK=1`. Prompt evolution attempts Pi evaluation/generation, then falls back to heuristics. The parity target should be "shared evaluator interface with capability flags", not a hard CLI=LLM/web=heuristic split.

2. **The browser already has a unique data advantage.** Web storage records real learner feedback, goals, quiz results, and session-linked artifacts. CLI parity should ingest the same learner outcome schema instead of treating browser state as second-class.

3. **NodePod integration needs Vite/Nitro routing work.** The Vite dev server already sets COOP/COEP headers, which helps. Production Nitro still needs an explicit `/__sw__.js` handler or emitted static asset served before the SPA fallback, plus the right JavaScript content type. NodePod previews also need COOP/COEP headers on HTML responses.

4. **Self-editing live React code is the wrong first target.** Browser self-modification should initially mutate a sandboxed `/agent` VFS and promote serialized outputs: policy, prompt, protocol, command registry entries, or candidate source patches. Editing the host app's loaded bundle should remain out of scope.

5. **The existing self-improvement machinery is useful but file-system-shaped.** `src/core/self-improve.ts` already has mutable source allowlists, snapshots, benchmark comparison, and accept/reject records. The next step is to extract its transaction model so filesystem, IndexedDB, NodePod VFS, and microsandbox snapshots can all implement it.

---

## Recommended Convergence Architecture

The shared architecture should have one deterministic Keating engine with runtime adapters, not separate CLI and browser implementations.

### 1. Shared Engine

Move browser-safe, deterministic behavior into importable modules that contain no Node built-ins:

```
src/core/engine/
  topics.ts
  policy.ts
  lesson-plan.ts
  map.ts
  benchmark.ts
  evolution.ts
  map-elites.ts
  prompt-evolution.ts
  engagement.ts
  quiz.ts
  mastery.ts
  protocol.ts
  commands.ts
```

The current `web/src/keating/core.ts` should disappear over time. Vite can import browser-safe TypeScript from `src/core/engine/*`; Node-specific code stays in adapter modules.

### 2. Runtime Adapters

Introduce a small runtime interface and implement it for CLI, current browser IndexedDB, NodePod, and microsandbox:

```ts
export interface KeatingRuntime {
  readonly kind: "cli-fs" | "browser-idb" | "browser-nodepod" | "cloud-microsandbox";
  readonly capabilities: KeatingCapabilities;
  store: KeatingStore;
  evaluator: KeatingEvaluator;
  editor?: SourceWorkspace;
  checkpoint?: CheckpointManager;
  now(): Date;
}

export interface KeatingCapabilities {
  filesystem: boolean;
  sourceEditing: "none" | "proposal" | "vfs" | "host";
  checkpoint: "none" | "records" | "vfs-snapshot" | "vm-snapshot";
  llmEvaluation: "none" | "proxy" | "host";
  shell: boolean;
}
```

The command handlers should branch on capabilities, not on "web vs CLI" directly.

### 3. One Command Registry

Keating currently has at least four command/tool surfaces:

- CLI switch in `src/cli/main.ts`
- Pi extension commands/tools in `src/pi/hyperteacher-extension.ts`
- MCP tools in `src/mcp/server.ts`
- Browser tools in `web/src/keating/browser-tools.ts`

These should be generated from one registry:

```ts
export interface KeatingCommand<I, O> {
  name: string;
  aliases?: string[];
  description: string;
  inputSchema: z.ZodType<I>;
  destructive: boolean;
  requiredCapabilities?: Partial<KeatingCapabilities>;
  run(runtime: KeatingRuntime, input: I): Promise<O>;
  renderText(output: O): string;
}
```

Adapters then expose the same command set as CLI subcommands, Pi tools, MCP tools, and browser `AgentTool`s. This is the fastest route to maximal feature parity.

### 4. Transactional Self-Mutation Core

Extract a shared mutation gate:

```
baseline -> checkpoint -> mutate -> reload/resolve -> validate -> commit | rollback | stash
```

Mutation targets should be typed:

```ts
type MutationSurface =
  | "policy"
  | "weights"
  | "prompt"
  | "protocol"
  | "source"
  | "tool";
```

Every mutation produces:

- registry entry
- checkpoint id
- diff or artifact summary
- baseline score
- candidate score
- decision
- rollback pointer

This makes CLI policy rollback, browser prompt evolution, NodePod VFS restore, and microsandbox VM restore one conceptual system.

### 5. State Layout Parity

Use the `.keating/` layout as the canonical logical model, but let each adapter map it to its backing store:

| Logical path | CLI adapter | Browser IDB adapter | NodePod adapter | microsandbox adapter |
|---|---|---|---|---|
| `.keating/state/current-policy.json` | local file | `policies` store active record | `/agent/policy.json` | VM file |
| `.keating/prompts/learn.md` or `/agent/prompts/learn.md` | local file | `prompt-evolutions` latest record | VFS file | VM file |
| `.keating/state/registry.json` | local file | `registry` store | VFS file + IDB snapshot index | VM file |
| `.keating/state/checkpoints/*` | source snapshots | record snapshots | binary VFS snapshots in IDB | microVM snapshots |
| `.keating/outputs/*` | local files | artifact object stores | VFS files + exported records | VM files |

---

## Implementation Sequence

### Phase 0 — Parity Audit And Guardrails

- Add a generated command parity matrix in docs or tests.
- Add tests that assert CLI, Pi, MCP, and web registries expose the same core command names unless a command has an explicit capability exclusion.
- Add a `KeatingCapabilities` type and annotate current commands.

### Phase 1 — Shared Command Registry, No Sandbox Yet

- Create `src/core/runtime.ts` and `src/core/command-registry.ts`.
- Move pure command logic out of CLI/web wrappers.
- Adapt CLI, Pi extension, MCP server, and browser tools to the same command registry.
- Keep existing storage implementations for now.

### Phase 2 — Browser-Safe Engine Extraction

- Split Node-free code from `src/core/*` into browser-safe modules.
- Replace slices of `web/src/keating/core.ts` with imports from the shared engine.
- Keep Node-only modules (`project.ts`, `paths.ts`, `pi-agent.ts`, file writers, shell commands) as CLI/server adapters.
- Add parity tests for `buildLessonPlan`, `runBenchmarkSuite`, policy clamping, map generation, quiz generation, engagement timeline, and prompt heuristic scoring across root and web test suites.

### Phase 3 — Data/Protocol Transactions

- Move `KEATING_OPERATIONAL_PROTOCOL` into a shared protocol artifact with versioning.
- Add `registry.json` for policy, prompt, protocol, and weights.
- Implement checkpoint/rollback for data-level mutations in both CLI filesystem and browser IndexedDB.
- Update `auto_improve`, `evolve`, and `prompt_evolve` to write through the mutation gate.

### Phase 4 — NodePod Browser Runtime

- Add `@scelar/nodepod` to the web package.
- Add the Vite NodePod plugin and Nitro/static handling for `/__sw__.js`.
- Boot `/agent` from the shared engine bundle plus current policy, prompts, protocol, weights, and registry.
- Implement NodePod checkpoint/rollback with `snapshot()` / `restore()`.
- Wire browser `edit_source` to mutate `/agent` VFS first, validate, then produce a promotable patch. Promotion to the host app remains explicit.
- Register custom tools only after schema validation and a benchmark smoke run.

### Phase 5 — microsandbox Cloud Runtime

- Package Keating as an OCI image or Sandboxfile.
- Mount persistent `.keating/` state.
- Use microsandbox snapshots for full source/tool/prompt/policy transactions.
- Enable host-side LLM evaluation and secret placeholder injection.
- Re-evaluate browser-evolved mutations with stronger evaluators when users upgrade.

### Phase 6 — agentOS/Rivet Orchestration

- Wrap the cloud runtime in durable workflows for scheduled `auto_improve`.
- Add reviewer/evolver multi-agent workflows.
- Use cron for periodic audit/evolution jobs.
- Keep this behind the same runtime contract so Keating can still run without Rivet.

---

## First Practical PR

The first implementation slice should avoid NodePod and microsandbox. It should make future self-modification easier without introducing a new runtime dependency:

1. Add `src/core/runtime.ts` with `KeatingRuntime`, `KeatingStore`, `KeatingEvaluator`, `SourceWorkspace`, `CheckpointManager`, and `KeatingCapabilities`.
2. Add `src/core/command-registry.ts` and move `plan`, `map`, `bench`, `evolve`, `prompt_evolve`, `policy`, `timeline`, `due`, `quiz`, and `outputs` into shared command descriptors.
3. Update CLI and one secondary surface, preferably MCP, to consume that registry.
4. Add a parity test proving the registry command names and schemas are stable.
5. Only after that, adapt `web/src/keating/browser-tools.ts` to the registry.

That PR creates the load-bearing boundary. Once it exists, NodePod is a runtime adapter instead of a rewrite.
