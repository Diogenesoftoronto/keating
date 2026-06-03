# Architecture

## Goal

Keating is not just "an AI tutor." It is an attempt to make tutoring behavior inspectable and self-improvable without collapsing the system into opaque prompt churn.

![Hyperteacher Architecture](./hyperteacher-architecture.svg)

## Design Split

The project is intentionally divided into four layers:

1. Pi runtime layer
   - supplies the Feynman-like shell, prompt templates, skills, and extension commands
   - keeps the interactive teaching experience flexible

2. Deterministic pedagogy layer
   - builds lesson plans
   - generates richer concept and meaning maps through `oxdraw`
   - generates self-contained `manim-web` animation bundles
   - stores verification, benchmark, evolution, and prompt-evolution artifacts
   - gives the system a stable non-LLM substrate

3. Self-improvement layer
   - verifies factual claims before teaching
   - benchmarks a teaching policy against synthetic learners
   - mutates the policy with novelty and safety gates
   - evolves prompt templates from natural-language feedback
   - records learner feedback and persistent traces
   - persists an explicit decision ledger for every candidate

4. Agent runtime and serving layer
   - keeps browser-compatible work local by default
   - exposes the current runtime mode through `/api/agent-runtime/config`
   - routes remote-only work through `/api/agent-runtime/remote/**` when a server or cloud backend is configured
   - shares sandbox abstractions through `packages/browser-agent-runtime/`
   - lets the browser and CLI converge on one capability model instead of growing separate tool stacks

## Borrowed Ideas

### Feynman

- artifact-first workflows
- slash-command shell ergonomics
- a packageable prompt/skill/extension model

### Pi Mono

- minimal core, aggressive extensibility
- prompts, skills, and extensions rather than forking the runtime
- compatibility with embedded or standalone Pi

### Chrysalis Forge

- evaluation-gated evolution
- explicit archive of candidate strategies
- meta-level improvement rather than one-shot prompt tuning

### HyperAgent

- separate planning from execution and verification
- treat "teach", "benchmark", and "evolve" as distinct modes instead of one overloaded agent behavior

### Meta-Harness

- optimize the harness, not just the system prompt
- front-load environment and artifact context
- reward saved exploratory turns and sharper initial action selection

### Prompt Learning + PROSPER

- use natural-language evaluator feedback to revise prompt templates instead of relying on scalar reward alone
- score prompt candidates on multiple teaching objectives rather than a single blended metric
- pick prompt winners with a PROSPER-style pairwise preference rule so balanced candidates beat narrow overfit edits

## Current Control Surface

- `/plan <topic>` creates a deterministic lesson plan.
- `/map <topic>` creates Mermaid and SVG lesson maps.
- `/animate <topic>` creates a browser-runnable animation bundle with storyboard and manifest.
- `/verify <topic>` creates a fact-checking checklist before instruction.
- `/bench [topic]` evaluates the current policy on a benchmark suite.
- `/evolve [topic]` mutates and selects safer, stronger policies.
- `/prompt-evolve [prompt]` revises a prompt template and writes an evolved prompt artifact instead of silently overwriting the checked-in prompt.
- `/feedback <up|down|confused> [topic]` records learner-state signals for later teaching sessions.
- `/trace [substring]` browses persisted benchmark and evolution traces.
- `/improve` generates a code self-improvement proposal from benchmark weaknesses.
- `/policy` exposes the currently active policy.

The web surface also exposes an explicit agent runtime contract:

- `keating web --browser-only-agent [port]` starts the free/local browser agent mode. Browser-compatible work runs on the learner's device. Remote-only work returns a fallback error.
- `keating web --remote [port]` starts the same browser app with a configured remote sandbox endpoint for operations that need native binaries, durable compute, server-side secrets, public inbound networking, or isolation stronger than a browser worker.
- `keating web --cloud [port]` routes those remote-only operations through the canonical Keating backend, `https://keating.help` unless `--cloud-endpoint` overrides it.
- The browser agent calls `agent_runtime` to inspect capabilities before attempting sensitive work.
- The browser agent calls `remote_execute` only when browser-local tools cannot satisfy the request.

This keeps the free tier browser-only while making server-backed execution a deliberate serving choice instead of an implicit fallback.

## Runtime Boundary

`packages/browser-agent-runtime/` defines the shared vocabulary for local and remote execution:

- sandboxes advertise capabilities instead of leaking implementation details into tools
- local memory and future NodePod-backed sandboxes can snapshot and roll back self-modifying work
- remote sandboxes can be selected when the local browser cannot satisfy a capability requirement
- the Daytona-shaped facade lets a browser-hosted sandbox look like a remote workspace to agents that already understand Daytona-style filesystem and process calls
- the RPC relay protocol gives NodePod, postMessage, WebSocket, or fetch transports the same operation envelope

The boundary is intentionally small. Keating should add providers behind it, not spread provider-specific assumptions through the teaching tools.

## Visual Artifact Strategy

The visual layer has two distinct roles:

1. Meaning maps
   - static structure for prerequisites, misconceptions, practice, and transfer
   - cheap to diff, persist, and inspect

2. Animated scenes
   - dynamic explanation for graph motion, probability updates, and conceptual emphasis
   - generated as source bundles rather than opaque binaries so they can participate in testing and future evolution

## Visual Subsystem

The visual path has its own internal pipeline:

- `src/core/map.ts` generates semantic Mermaid graphs for teaching structure.
- `oxdraw` turns those Mermaid sources into SVG artifacts that are cheap to diff and inspect.
- `src/core/animation.ts` generates `manim-web` source bundles for animated explanation.
- `src/core/project.ts` makes both of those first-class outputs under `.keating/outputs/`.

See also:

- `docs/VISUAL-ARCHITECTURE.md`
- `docs/OXDRAW-TUTORIAL.md`

## Why Synthetic Learners

Real tutoring quality depends on human feedback, but synthetic learners are still useful for:

- regression detection
- fast offline comparisons
- gating clearly worse policies
- making properties and fuzz tests meaningful

Prompt evolution in Keating currently uses deterministic heuristics over prompt text, not live LLM judge calls. That is deliberate: the architecture keeps the local harness testable while still borrowing the control-loop shape from prompt-learning systems.

They are not a substitute for human evaluation. They are an engineering harness.
