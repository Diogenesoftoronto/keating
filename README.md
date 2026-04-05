# Keating

> *"O me! O life! of the questions of these recurring,
> Of the endless trains of the faithless, of cities fill’d with the foolish,
> Of myself for ever reproaching myself, (for who more foolish than I, and who more faithless?)
> Of eyes that vainly crave the light, of the objects mean, of the struggle ever renew’d,
> Of the poor results of all, of the plodding and sordid crowds I see around me,
> Of the empty and useless years of the rest, with the rest me intertwined,
> The question, O me! so sad, recurring—What good amid these, O me, O life?
>
> Answer.
> That you are here—that life exists and identity,
> That the powerful play goes on, and you may contribute a verse."*
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

## Quick Start

### From the Web

Visit **[keating.help](https://keating.help)** to use Keating directly in your browser with:
- Your own API keys (stored locally)
- Local model inference via WebGPU (Gemma 4 E4B)
- Full hyperteacher experience without installation

### From the Command Line

Install via curl:

```bash
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash
```

Or with npm/pnpm/bun:

```bash
npm install -g @interleavelove/keating
pnpm add -g @interleavelove/keating
bun add -g @interleavelove/keating
```

### Development

<video src="docs/assets/doctor.mp4" autoplay loop muted width="100%"></video>

```bash
mise run build
mise run doctor
mise run docs:diagrams
mise run bench
mise run evolve
mise run prompt-evolve -- learn
mise run map -- derivative
mise run animate -- derivative
mise run trace
mise run shell
```

Keating reads runtime/model defaults from `keating.config.json`.

```json
{
  "pi": {
    "runtimePreference": "standalone-only",
    "defaultProvider": "google",
    "defaultModel": "google/gemini-2.5-pro",
    "defaultThinking": "medium"
  },
  "debug": {
    "persistTraces": true,
    "traceTopLearners": 3,
    "consoleSummary": true
  }
}
```

`runtimePreference` supports:

- `standalone-only`
- `prefer-standalone`
- `embedded-only`

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

After `mise run prompt-evolve -- learn`:

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
- `docs/`: architecture, testing strategy, and diagrams.

Key docs:

- `docs/ARCHITECTURE.md`
- `docs/OXDRAW-TUTORIAL.md`
- `docs/VISUAL-ARCHITECTURE.md`

## Design Notes

The system deliberately separates:

- live teaching behavior, which stays in Pi prompts and skills,
- deterministic pedagogy artifacts, which are generated by local code and kept inspectable,
- self-improvement, which runs against a synthetic learner suite before policy changes are accepted.

That split keeps the interactive shell flexible while making the improvement loop testable without an LLM in the loop.

## Testing

<video src="docs/assets/tests.mp4" autoplay loop muted width="100%"></video>

```bash
mise run test
```

The test suite covers:
- property checks for lesson plans and maps
- fuzzed teaching policies and topics
- visual grammar invariants for animations
- end-to-end artifact generation and trace persistence

## Visual Teaching Layer

Keating now treats diagrams and animations as first-class teaching artifacts instead of optional garnish.

- `mise run map -- <topic>` writes a meaning map with teaching loop, concept structure, misconceptions, practice, and transfer hooks, then renders it with `oxdraw` when available.
- `mise run animate -- <topic>` writes a browser-runnable `manim-web` bundle under `.keating/outputs/animations/<topic>/`.
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
mise run doctor
mise run bench -- derivative
mise run evolve -- derivative
mise run prompt-evolve -- learn
mise run trace -- derivative
```

## Documentation

- Architecture overview: `docs/ARCHITECTURE.md`
- Visual system architecture: `docs/VISUAL-ARCHITECTURE.md`
- `oxdraw` authoring and rendering tutorial: `docs/OXDRAW-TUTORIAL.md`

Regenerate the checked-in docs SVGs with:

```bash
mise run docs:diagrams
```
