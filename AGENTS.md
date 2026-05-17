# AGENTS.md — Keating

> What future agents need to know to work effectively in this repo.

## Overview

Keating is a Pi-powered "hyperteacher" — a CLI tool + web app that generates pedagogical artifacts (lesson plans, maps, animations, benchmarks, policy evolution) deterministically from a local Node.js core, while the actual interactive teaching experience lives in Pi prompt/skill/extension templates. The design deliberately separates: (1) the interactive Pi shell runtime layer, (2) the deterministic pedagogy engine, and (3) the self-improvement harness.

## Project Structure

- **`src/core/`** — Deterministic pedagogy engine. All local, testable, no LLM calls except `animation.ts` (scene generation) and `pi-agent.ts` (thin LLM wrapper).
- **`src/cli/`** — Terminal CLI entrypoint (`main.ts`) and interactive setup (`setup.ts`).
- **`src/runtime/`** — Pi/Feynman runtime detection and shell launcher.
- **`src/pi/`** — Pi extension entrypoint (`hyperteacher-extension.ts`). Registers `/plan`, `/map`, `/animate`, `/bench`, `/evolve`, `/prompt-evolve`, `/feedback`, `/policy`, `/outputs`, `/trace`, etc.
- **`pi/prompts/`** — Teaching prompt templates (`bridge.md`, `diagnose.md`, `improve.md`, `learn.md`, `quiz.md`).
- **`pi/skills/`** — Pi skills directory for the runtime.
- **`web/`** — Browser UI (React + TanStack Router + Vite + Nitro). Separate `package.json`, separate build.
- **`test/`** — Root-level test suite. **Not** in `web/test/`, which is for web-specific tests.
- **`scripts/`** — Build/utility scripts, plus `install/install.sh` used in release bundles.
- **`docs/`** — Architecture docs, Typst study paper, VHS tape scripts for recordings.
- **`video/`** — Remotion video project (`keating-intro/`).
- **`bin/keating.js`** — Executable entrypoint for the CLI.

## Build & Test Commands

This project uses **Bun** and **mise**. Do not assume npm/pnpm.

| Task | Command |
|------|---------|
| Install deps | `bun install` (root + run `cd web && bun install` for web) |
| Build root | `bun x tsc -p tsconfig.json` — compiles to `dist/`. Uses NodeNext resolution, outDir is `dist`. |
| Build everything | `bun run build` — compiles root, then builds web (vite + nitro). |
| Test root | `bun test ./test/*.test.ts` — uses `bun:test` runtime with `fast-check` for property-based testing. |
| Test web | `cd web && bun test` |
| Run CLI | `bun src/cli/main.ts <command>` or `node ./bin/keating.js <command>` |
| Dev server (web) | `cd web && bun run dev` (Vite dev on port 3000) |
| Web build | `cd web && bun run build` — `vite build && npx nitro build`, outputs to `web/dist/` and `web/.output/` |
| Typecheck (web) | `cd web && bun run typecheck` — `tsc --noEmit` |
| Web preview | `cd web && bun run preview` |
| Render docs diagrams | `bun scripts/render-docs-diagrams.mjs` |
| Render intro video | `bun scripts/render-keating-intro.mjs` |

**Mise tasks** (`mise.toml`) are the canonical dev workflow: `mise run build`, `mise run test`, `mise run shell`, `mise run doctor`, `mise run bench`, `mise run evolve`, `mise run prompt-evolve -- learn`, `mise run map -- <topic>`, `mise run animate -- <topic>`, `mise run trace`, etc.

## Code Organization & Architecture

### Three-Layer Split

1. **Pi Runtime Layer** — `pi/prompts/`, `pi/skills/`, `src/pi/hyperteacher-extension.ts`. Flexible, interactive teaching shell. The extension registers slash commands (`/plan`, `/map`, etc.) that delegate to `src/core/project.ts`.
2. **Deterministic Pedagogy Layer** — `src/core/lesson-plan.ts`, `src/core/map.ts`, `src/core/animation.ts`, `src/core/verification.ts`, `src/core/verification.ts`, etc. All pure/local logic. Produces inspectable artifacts under `.keating/outputs/`.
3. **Self-Improvement Layer** — `src/core/benchmark.ts`, `src/core/evolution.ts`, `src/core/prompt-evolution.ts`, `src/core/map-elites.ts`. Benchmarks policies against synthetic learners, evolves prompt templates with PROSPER-style multi-objective scoring, gates changes with safety checks.

### Deterministic vs Non-Deterministic Boundary

Everything in `src/core/` is deterministic **except**:
- `animation.ts` — calls `piComplete()` (LLM) to generate `manim-web` scene JavaScript. Falls back to a basic stub if the LLM call fails.
- `pi-agent.ts` — thin wrapper over the Pi AI runtime for completions.

All topic definitions, lesson plans, benchmarks, policy mutations, and prompt scoring are deterministic — this makes the test suite fast and LLM-independent.

### Key Data Flows

- **CLI commands** (`src/cli/main.ts`) → `src/core/project.ts` artifact functions → write to `.keating/outputs/`
- **Pi extension** (`src/pi/hyperteacher-extension.ts`) → same `project.ts` functions but wired to `ctx.ui.setEditorText()`, `ctx.ui.notify()`
- **Web** (`web/src/hooks/useKeatingAgent.tsx`) → `@mariozechner/pi-agent-core` Agent → `web/src/keating/browser-tools.ts` (tool definitions) → tool execution
- **Synthetic learner simulation** (`helpers.ts` stub) → deterministic score based on policy/weights → no real LLM in tests

### Browser Port

`web/src/keating/core.ts` is a hand-port of `src/core/types.ts` for the browser (no Node.js fs imports). `web/src/keating/browser-tools.ts` re-implements CLI tools for the web agent. When updating core types, check if the browser port needs updating too.

### Artifact Directory Layout

Artifacts are written under `.keating/` in the current working directory (gitignored). Structure:
```
.keating/
  plans/<topic>.md
  maps/<topic>.mmd          (+ .svg if oxdraw available)
  outputs/animations/<topic>/player.html, scene.mjs, storyboard.md, manifest.json
  outputs/benchmarks/<topic>-
  outputs/evolution/
  outputs/prompt-evolution/
  outputs/traces/
  outputs/verifications/
  state/learner.json
  policy/
```

**Important**: `keating.config.json` and `.keating/` are per-project, gitignored. They are NOT checked into this repo. The checked-in `keating.config.json` in the repo root is only an example.

## TypeScript Conventions

- **Module resolution**: `NodeNext` at root, `Bundler` in web. All root imports use `.js` extensions (e.g., `import { foo } from "./bar.js"`).
- **Strict mode**: enabled. No implicit any.
- **Root tsconfig**: `src/**/*.ts`, `outDir: "dist"`, `rootDir: "."`. Compiles `src/` into `dist/src/`.
- **Web tsconfig**: separate in `web/`, uses `@/` alias → `web/src/`.
- **React**: version 19. Web uses Tailwind CSS v4 with `@tailwindcss/vite`.

## Key Patterns & Gotchas

### Import Extensions
Root `src/` files **must** use `.js` extensions in imports, even for `.ts` files. The web package does not.

### Topic Resolution & Fallbacks
`resolveTopic()` in `src/core/topics.ts` looks up a hardcoded `TOPICS` record. If a topic is not found, `buildFallbackTopic()` auto-generates one using domain keyword heuristics and domain-specific example/exercise templates. This means giving an unknown topic string still produces a valid lesson plan — but quality depends on the domain guess.

### Domain-Specific Phase Injections
`buildLessonPlan()` in `src/core/lesson-plan.ts` injects extra phases based on `topic.domain`:
- `code` → inserts "Live Code" phase after examples
- `law` → appends citation instructions to examples
- `medicine` → appends evidence-level references to formal core
- `history` → appends timeline/source instructions to examples
- `psychology` → appends replication status flags to misconceptions
- `politics` → appends competing frameworks to transfer
- `arts` → appends specific work analysis to examples

### Policy Clamping
All `TeacherPolicy` scalars must stay in `[0, 1]`. `clampPolicy()` in `src/core/policy.ts` enforces this. `exerciseCount` is clamped to integer `[1, 5]`. Weights are normalized to sum to 1. Tests assert these invariants.

### Animation Scene Generation
`animationSceneSource()` calls `piComplete()` with a detailed prompt asking for raw JS (no markdown blocks). The response is stripped of ` ```js ` fences. If the call throws, it falls back to a minimal stub. The scene kind is selected by domain (math → function-graph, science → distribution-bars, code → code-trace, etc.).

### WeakSet for Speech Tool Deduplication
`registerSpeechTool()` in `src/pi/hyperteacher-extension.ts` uses a `WeakSet<object>` to prevent double-registering the `keating_voice` tool on the same Pi instance across multiple session starts.

### Web Proxy Plugin
`web/vite.config.ts` contains a `chatProxyPlugin()` that proxies `/api/chat-proxy/**` to the target API specified in the `x-target-url` header. This is for browser CORS workaround when calling external LLM APIs. In production (Nitro), this is handled by `server/api/chat-proxy/[...slug].ts`.

### Web PWA
The web app is a PWA via `vite-plugin-pwa`. It caches WASM/ONNX files and HuggingFace model downloads with long expiration. WebGPU models are loaded via `@huggingface/transformers` — excluded from `optimizeDeps`. COOP/COEP headers are set in Vite dev server for SharedArrayBuffer support.

### Nitro Routing Gotchas
`web/nitro.config.ts` sets `fallthrough: false` for all static asset extensions so missing files return 404 instead of falling back to `index.html` (SPA route). The catch-all `/**: { static: true }` serves the SPA for unmatched routes.

### Release Bundle
The release workflow bundles `node_modules` into the tarball for a truly standalone install. The install script (`scripts/install/install.sh`) is moved to the bundle root, and the `install/` directory is deleted during packaging.

### Node Version
`package.json` specifies `engines: { "node": ">=20.19.0" }`. Bun is the primary runtime used in CI.

## Testing Strategy

Follows an **Antithesis-style** mindset: semantic system laws over brittle snapshots.

- **Property tests** (`fast-check`): randomized policies and topics should always produce coherent lesson plans, bounded scores, valid policy fields.
- **Fuzz tests**: random topic strings, random policies, repeated map generation should not crash.
- **Acceptance tests**: full artifact pipeline in a temp directory — verify plans, maps, benchmark reports, evolution reports, prompt-evolution artifacts, traces, and policy state are all created.
- **Deterministic stubs**: `test/helpers.ts` provides `stubBenchmarkResult()` and `createDeterministicBenchmark()` so the benchmark/evolution code is testable without an LLM.
- **Invariant helpers**: `policyIsBounded()`, `weightsAreNormalized()`, `benchmarkScoresAreBounded()` are used in tests to assert system laws continuously.

Tests use `bun:test` (not vitest/jest). Run with `bun test ./test/*.test.ts`.

## Prompt Evolution

`prompt-evolve` scores prompt templates on 6 objectives: `voice`, `diagnosis`, `verification`, `retrieval`, `transfer`, `structure`. It does **not** silently overwrite the source prompt. It writes:
- `.keating/outputs/prompt-evolution/<name>.md` (report)
- `.keating/outputs/prompt-evolution/<name>.evolved.md` (evolved snapshot)

The selector is PROSPER-style: balanced multi-objective candidates beat narrow overfit edits.

## Speech Module

Disabled by default. When `speech.enabled: true` in `keating.config.json`, a `keating_voice` tool is registered. In the Pi shell, it emits structured voice-tagged utterances (not audio), keeping the speech loop optional. In the web app, the same tool routes through Gemini Flash Live with actual audio output. The web app speech toggle is independent of CLI config.

## Commands Summary

```bash
# Core CLI commands
keating shell              # Launch Pi shell
keating setup [--yes]      # Interactive config setup
keating doctor             # Runtime diagnostic report
keating web [port]         # Start local web server

# Artifact generation
keating plan <topic>
keating map <topic>
keating animate <topic>
keating verify <topic>

# Evaluation & improvement
keating bench [topic]           # Benchmark current policy
keating evolve [topic]          # Policy evolution with safety gates
keating prompt-evolve [prompt]  # Prompt evolution (default: "learn")
keating auto-improve [topic]    # Full loop: bench → evolve → prompt-evolve → bench
keating improve                 # Self-improvement proposal from benchmark weaknesses

# State inspection
keating policy             # Show active policy
keating trace [substring]  # Browse artifact traces
keating learner-state      # Learner profile
keating timeline           # Engagement timeline (spaced repetition)
keating due                # Topics due for review
keating feedback up|down|confused [topic] [--comment=...]
```

## Environment Variables

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Keating tries the configured provider first, then falls back to OpenAI/Anthropic if the default key is missing.

## Important Files & Their Roles

| File | Purpose |
|------|---------|
| `keating.config.json` | Per-project runtime/model config. Gitignored in projects. |
| `chrysalis.config.json` | Repo-local config for Chrysalis/Pi tooling. |
| `SYSTEM.md` | System prompt sent to LLMs when Keating acts as a tutor. |
| `src/core/topics.ts` | Hardcoded topic definitions + domain keyword heuristics for fallback generation. |
| `src/core/policy.ts` | Default policy, clamping, signature hashing. |
| `src/core/project.ts` | Central artifact coordinator. All CLI and Pi commands funnel through here. |
| `src/core/animation.ts` | Manim-web bundle generation. Only core file that calls LLM. |
| `src/core/benchmark.ts` | Synthetic learner suite. Deterministic unless using real LLM judge mode. |
| `src/core/prompt-evolution.ts` | Prompt scoring + PROSPER selection. |
| `web/src/hooks/useKeatingAgent.tsx` | Web app state machine (Agent, sessions, speech, storage). |
| `web/src/keating/browser-tools.ts` | Web-ported tool definitions matching CLI capabilities. |
| `test/helpers.ts` | Deterministic benchmark stubs + property arbitraries + invariant helpers. |

## What NOT to Do

- Do not add a new topic without checking if domain-specific phase injections are appropriate (see `lesson-plan.ts`).
- Do not make benchmark or evolution code depend on LLM calls in tests — the test suite expects deterministic stubs.
- Do not change `pi.registerCommand()` handler signatures without updating `src/core/commands.ts` which generates command help text.
- Do not assume the web build is just `vite build` — it is `vite build && npx nitro build`.
- Do not commit generated artifacts — `.keating/`, `dist/`, `web/dist/`, `web/.output/` are all gitignored.
