# Keating

> "O me! O life! of the questions of these recurring,
> Of the endless trains of the faithless, of cities fill’d with the foolish,
> Of myself for ever reproaching myself, (for who more foolish than I, and who more faithless?)
> Of eyes that vainly crave the light, of the objects mean, of the struggle ever renew’d,
> Of the poor results of all, of the plodding and sordid crowds I see around me,
> Of the empty and useless years of the rest, with the rest me intertwined,
> The question, O me! so sad, recurring—What good amid these, O me, O life?
>
> Answer.
> That you are here—that life exists and identity,
> That the powerful play goes on, and you may contribute a verse."
> -- Walt Whitman, *Leaves of Grass*

Keating exists because as AI grows more capable, the risk is not just that it replaces our tasks, but that it replaces our *voice*. We must not let technology become a surrogate for thought. 

**The goal of Keating is cognitive empowerment.** It is a Pi-powered hyperteacher scaffold designed to ensure that humans remain the authors of their own understanding. It uses the most advanced models not to provide answers, but to force the rigorous reconstruction of ideas within the learner's own identity.

We use technology to ensure the "powerful play" goes on, and that every learner is equipped to contribute their own verse.

It is designed around five influences:

- `feynman` for the shell ergonomics, slash workflows, and artifact-oriented research UX.
- `pi-mono` for the runtime model: prompts, skills, and extensions instead of a forked monolith.
- `chrysalis-forge` for self-evolution, archival evaluation, and safety-gated improvement.
- `HyperAgent` for role separation between planning, execution, and verification.
- `Meta-Harness` for harness-level improvement rather than prompt-only tweaking.

## What Exists

- A Pi launcher that prefers a fresh standalone `pi` install by default and only uses the bundled Feynman runtime when you explicitly allow it.
- A Pi extension with operational commands: `/plan`, `/map`, `/animate`, `/verify`, `/bench`, `/evolve`, `/prompt-evolve`, `/feedback`, `/policy`, `/outputs`, `/trace`.
- Teaching workflows as prompt templates: `/learn`, `/diagnose`, `/quiz`, `/bridge`.
- An optional speech module that exposes a `keating_voice` tool for short voice-tagged learner-facing utterances while the normal model keeps doing reasoning, questioning, verification, and tool-backed correction.
- A prompt-evolution loop that scores prompt templates with natural-language feedback and picks revisions with a PROSPER-style multi-objective selector.
- 12 domains: math, science, philosophy, code, law, politics, psychology, medicine, arts, history, and general.
- Deterministic artifacts under `.keating/`:
  - lesson plans with domain-specific guidance (code gets live-code phases, law gets case citations, etc.)
  - richer Mermaid meaning maps rendered through `oxdraw`
  - self-contained `manim-web` animation bundles: function-graphs, distribution-bars, belief-updates, code-traces, timelines, case-diagrams, mind-maps, and concept-cards
  - fact-checking verification checklists that must be completed before teaching
  - benchmark reports
  - evolution reports
  - prompt-evolution reports and evolved prompt snapshots
  - the current policy and policy archive
  - persistent learner state and feedback signals
- Persisted traces that explain why benchmark runs and evolution candidates succeeded or failed.
- A test suite with property checks, fuzz-style inputs, and an end-to-end acceptance pipeline.
- A browser-first agent serving model with three explicit modes:
  - `keating web --browser-only-agent` for the free/local default where supported agent work stays on the learner's device.
  - `keating web --remote` for a self-hosted server that can proxy remote-only work to a configured microVM or sandbox endpoint.
  - `keating web --cloud` for the canonical Keating Cloud backend at `https://keating.help`.
- A shared browser agent runtime package under `packages/browser-agent-runtime/` with local memory sandboxes, capability routing, transactional snapshots, Daytona-shaped compatibility, a NodePod adapter seam, and an RPC relay protocol.

## Quick Start

### From the Web

Visit **[keating.help](https://keating.help)** to use Keating directly in your browser with:
- Your own API keys (stored locally)
- Local model inference via WebGPU (Gemma 4 E4B)
- Optional Gemini 3.1 Flash Live speech from the speaker button in the chat header
- Browser-only agent execution by default for the free surface
- Clear fallback errors when a task needs native binaries, server-side secrets, durable compute, public inbound networking, or microVM isolation

### From the Command Line

Install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash
```

Or with npm/pnpm/bun:

```bash
npm install -g keating
pnpm add -g keating
bun add -g keating
```

Then launch the shell:

```bash
keating shell
```

For a guided local setup:

```bash
keating setup
keating doctor
keating shell
```

The setup screen uses an Ink-powered terminal UI with arrow-key choices for provider, model, thinking effort, and runtime preference. Choose the recommended default path for `openai` + `gpt-5.5`, or select custom provider/model values when your Pi runtime supports them.

Non-interactive environments can write the default config with `keating setup --yes`.

Keating checks credentials before launching the shell. It tries the configured provider first, then falls back to configured OpenAI or Anthropic credentials when the default Google key is missing. Supported environment variables are:

```bash
export GEMINI_API_KEY=...
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

Export Keating artifacts and sessions for fine-tuning with:

```bash
keating export --finetune --source=all --format=both
```

The web app exposes the same dataset export from the Usage page.

From a local checkout, build first and run the repo binary directly:

```bash
bun run build
node ./bin/keating.js shell
```

The executable form works too:

```bash
./bin/keating.js shell
```

### Serving the Web Agent

`keating web` serves the production Nitro build and now makes the agent runtime mode explicit.

```bash
# Free/local mode: browser-compatible work runs on the learner's device.
keating web --browser-only-agent 3000

# Self-hosted remote mode: local-first browser agent with remote-only work
# proxied to your configured sandbox service.
keating web --remote 3000 \
  --remote-provider=microsandbox \
  --remote-endpoint=http://127.0.0.1:8787 \
  --remote-region=local \
  --remote-snapshot=keating-base

# Cloud mode: local-first browser agent with remote-only work routed
# through the canonical Keating backend.
keating web --cloud 3000
keating web --cloud 3000 --cloud-endpoint=https://keating.help
```

The browser reads `/api/agent-runtime/config` on startup. In browser-only mode, `/api/agent-runtime/remote/**` is disabled and remote-only work returns a clear fallback. In remote and cloud modes, the browser agent gets an `agent_runtime` tool for capability discovery and a `remote_execute` tool that posts to the server-side proxy for work that cannot safely or practically happen in the browser.

Browser-only mode is intentionally the free-tier default. It is lower-risk than running arbitrary code on a shared server because code runs on the user's own device, but it still cannot provide native binaries, Docker or microVM isolation, unrestricted host filesystem access, durable background jobs, public inbound networking, or server-brokered secrets. Those belong behind `--remote` or `--cloud`.

### Development

All development dependencies (bun, node, oxdraw, typst, similarity, just, etc.) are managed by **Flox**. Run `flox activate` to enter the dev environment, then use **just** as the task runner.

<video src="docs/assets/doctor.mp4" autoplay loop muted width="100%"></video>

```bash
just build
just doctor
just docs-diagrams
just bench
just evolve
just prompt-evolve learn
just map derivative
just animate derivative
just trace
just shell
```

Keating reads runtime/model defaults from `keating.config.json`.

```json
{
  "pi": {
    "runtimePreference": "standalone-only",
    "defaultProvider": "openai",
    "defaultModel": "gpt-5.5",
    "defaultThinking": "medium",
    "packages": []
  },
  "speech": {
    "enabled": false,
    "defaultVoice": "conversational",
    "fastModel": "gemini-3.1-flash-tts-preview",
    "steeringModel": "default"
  },
  "debug": {
    "persistTraces": true,
    "traceTopLearners": 3,
    "consoleSummary": false
  }
}
```

`runtimePreference` supports:

- `standalone-only`
- `prefer-standalone`
- `embedded-only`

`keating --list-models` is passed through to the underlying Pi shell runtime. The legacy typo `keating --list-model` is accepted as an alias for the same runtime flag.

`pi.packages` is optional. When present, Keating syncs those Pi package sources into its isolated Pi settings directory before launching the shell. This lets Keating use extra Pi packages without hardcoding a stale model/package list in Keating itself. Package sources use Pi's normal syntax:

```bash
keating package recommended
keating package add npm:pi-subagents
keating package add npm:pi-web-access
keating shell
```

Inside the shell, use the equivalent TUI command:

```text
/packages recommended
/packages add npm:pi-subagents
/packages list
```

Pi packages execute extension/skill code with local system access, so review third-party packages before adding them.

The speech module is disabled by default. When `speech.enabled` is `true`, Keating registers a Pi tool named `keating_voice`. The tool returns transcript-safe voice tags such as:

```text
[voice voice=conversational tags=question,verify pace=normal affect=curious] What would you expect to happen next?
```

In the Pi shell, this first layer is provider-neutral: `fastModel` names the intended fast conversational voice path, and `steeringModel` names the supervising model path, but the tool emits structured voice-tagged utterances rather than audio. That keeps the speech loop optional while preserving the normal tool-using teacher as the source of questions, verification, and corrections.

In the web app, the speech toggle registers the same `keating_voice` tool and routes it through Gemini 3.1 Flash Live (`gemini-3.1-flash-live-preview`) with audio output. Speech stays off by default, uses the Google API key from Settings, and should be used for short conversational delivery while the primary model continues to plan, verify, and steer the lesson.

Inside the Pi shell:

```text
/plan derivative
/map derivative
/animate derivative
/verify derivative
/learn derivative
/quiz derivative
/bench derivative
/evolve derivative
/prompt-evolve learn
/feedback up derivative
/setup
/packages recommended
/speech
/trace derivative
/outputs
```

## Prompt Evolution

`prompt-evolve` does not silently rewrite the checked-in prompt template. It reads a source prompt such as `pi/prompts/learn.md`, scores it on teaching objectives like learner voice, diagnosis, verification, retrieval, transfer, and structure, then writes:

- `.keating/outputs/prompt-evolution/learn.md`
- `.keating/outputs/prompt-evolution/learn.evolved.md`

Example:

Before:

```md
Teach the learner the following topic: $@

Workflow:
1. Start with a short diagnostic question.
2. Explain the concept.
3. End with a summary.
```

After `keating prompt-evolve learn`:

```md
Teach the learner the following topic: $@

Workflow:
1. Start with a short diagnostic question.
1a. Separate missing prerequisite, partial intuition, and formal gap before choosing the next move.
2. Explain the concept.
5a. Make the learner reconstruct the core idea from memory rather than merely agreeing with your explanation.
6a. Ask the learner to carry the idea into a new setting so they prove they can transfer it.
0c. Keep Keating's standard in view: "Boys, you must strive to find your own voice..."
```

The point is not cosmetic prompt churn or benchmark gaming. The loop tries to produce prompts that improve human learning outcomes: sharper diagnosis, stronger reconstruction from memory, better transfer, and clearer learner articulation.

## Benchmarking Cognitive Friction

To ensure that Keating serves as a bridge to independent understanding rather than a shortcut to agreement, we maintain a **Synthetic Learner Suite**. 

Recent results using small models (1–2B parameters) show that the system successfully identifies and redirects "Surface Agreement." Key findings include:
- **Redirection Effectiveness:** Identifying meta-responses ("That's a great question!") and insisting on personal application before advancing.
- **Intuition-First Efficacy:** Measurable self-correction in technical domains (e.g., correcting conflations between function values and derivatives).
- **Voice Persistence:** Penalizing rote echoing of the teacher and rewarding novel analogies or domain transfers.

Detailed results are available in our latest study: `docs/study.typ`.

## Project Layout

- `src/core/`: lesson planning, benchmarks, policy mutation, artifact helpers.
- `src/core/animation.ts`: `manim-web` bundle generation for visual teaching artifacts.
- `src/runtime/`: Pi/Feynman runtime detection and shell launcher.
- `src/pi/`: the compiled Pi extension entrypoint.
- `pi/prompts/`: teaching prompt templates.
- `pi/skills/`: teaching skills for the runtime.
- `packages/browser-agent-runtime/`: shared browser/remote sandbox abstractions for local-first agents.
- `docs/`: architecture, testing strategy, and diagrams.

Key docs:

- `docs/ARCHITECTURE.md`
- `docs/OXDRAW-TUTORIAL.md`
- `docs/VISUAL-ARCHITECTURE.md`
- `docs/self-modifying-agent-architecture.md`
- `docs/plans/storage-atproto-educator-tools.md`

## Design Notes

The system deliberately separates:

- live teaching behavior, which stays in Pi prompts and skills,
- deterministic pedagogy artifacts, which are generated by local code and kept inspectable,
- self-improvement, which runs against a synthetic learner suite before policy changes are accepted.

That split keeps the interactive shell flexible while making the improvement loop testable without an LLM in the loop.

## Testing

<video src="docs/assets/tests.mp4" autoplay loop muted width="100%"></video>

```bash
just test
```

The test suite covers:
- property checks for lesson plans and maps
- fuzzed teaching policies and topics
- visual grammar invariants for animations
- end-to-end artifact generation and trace persistence

## Visual Teaching Layer

Keating now treats diagrams and animations as first-class teaching artifacts instead of optional garnish.

- `keating map <topic>` writes a meaning map with teaching loop, concept structure, misconceptions, practice, and transfer hooks, then renders it with `oxdraw` when available.
- `keating animate <topic>` writes a browser-runnable `manim-web` bundle under `.keating/outputs/animations/<topic>/`.
- Each animation bundle includes:
  - `player.html`
  - `scene.mjs`
  - `storyboard.md`
  - `manifest.json`
- The animation manifest explains why a particular scene grammar was selected, so the visual layer is inspectable alongside benchmark and evolution traces.

## Debugging Self-Evolution

Keating persists detailed trace artifacts under `.keating/outputs/traces/`.

- Benchmark traces show:
  - per-topic metric means
  - the strongest and weakest synthetic learners
  - natural-language reasons for strong or weak outcomes
- Evolution traces show:
  - every explored candidate
  - score and weakest-topic deltas
  - novelty scores
  - gate outcomes
  - acceptance or rejection reasons
  - parameter deltas from the parent policy
- Prompt-evolution artifacts show:
  - baseline feedback on the source prompt
  - candidate objective vectors
  - the PROSPER-style preference score
  - the recommended evolved prompt snapshot

Useful commands:

```bash
keating doctor
keating bench derivative
keating evolve derivative
keating prompt-evolve learn
keating trace derivative
```

## Documentation

- Architecture overview: `docs/ARCHITECTURE.md`
- Visual system architecture: `docs/VISUAL-ARCHITECTURE.md`
- `oxdraw` authoring and rendering tutorial: `docs/OXDRAW-TUTORIAL.md`
- Browser/remote self-modifying agent plan: `docs/self-modifying-agent-architecture.md`
- Storage, AT Protocol, and educator-tools roadmap: `docs/plans/storage-atproto-educator-tools.md`

Regenerate the checked-in docs SVGs with:

```bash
just docs-diagrams
```
