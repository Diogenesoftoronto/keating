# Core / CLI Self-Modification Gap Analysis

> Analysis date: 2026-05-27  
> Scope: `src/core/`, `src/cli/`, `src/pi/`  
> Cross-reference: `docs/web-self-modification-gaps.md` for the browser port

---

## Summary

The CLI/core layer implements more of the self-improvement loop than the web port, but most of the advanced tooling is **dead or misfired code**. Bayesian optimization stubs exist but silently degrade to random search. Grid persistence code exists but is never invoked. Real learner feedback is captured but never biases the benchmark. And the meta-improvement system (`self-improve.ts`) writes beautiful proposals but has no execution mechanism — it is a todo-list generator, not an automated patch applier.

This document lists 16 gaps. 9 are unique to the CLI/core. 7 are shared with the web layer.

---

## CLI-Only Gaps

### Gap C1 — `applyFeedbackBias` is dead code: real feedback never affects benchmark weights

**Location:** `src/core/benchmark.ts` (line ~371), `src/core/learner-state.ts`

`applyFeedbackBias()` accepts a `FeedbackSummary` {confusionRate, satisfactionRate, sampleSize} and shifts `SimulationWeights` to penalize confusion and reward engagement. It is **never called anywhere in the codebase**.

```typescript
// This function exists but has zero call sites:
export function applyFeedbackBias(feedback: FeedbackSummary): SimulationWeights { ... }
```

The learner state file (`learner-state.ts`) stores feedback signals, but the benchmark always uses `DEFAULT_WEIGHTS`. A learner who gives 20 "confused" ratings in a row gets the same synthetic benchmark as a learner who gives 20 "thumbs-up".

**Consequence:** Evolution optimizes for a generic learner profile while actively ignoring the real one in front of it.

**Fix:** Wire `applyFeedbackBias` into `runBenchmarkSuite` by passing aggregated feedback from `loadLearnerState(learnerStatePath(cwd))`.

---

### Gap C2 — `loadMapElitesGrid` / `saveMapElitesGrid` are dead code

**Location:** `src/core/map-elites.ts` (lines ~214–236)

Serializers exist:

```typescript
export async function loadMapElitesGrid(filePath: string, ...): Promise<MapElitesGrid> { ... }
export async function saveMapElitesGrid(filePath: string, grid: MapElitesGrid): Promise<void> { ... }
```

They are **never called** by `project.ts`, `evolution.ts`, or `autoImproveArtifact`. The grid is always created fresh with `createGrid()`.

**Consequence:** MAP-Elites re-explores the same policy neighborhood on every `auto_improve` invocation. The CLI has the infrastructure for grid persistence but leaves it unconnected.

**Fix:** Call `saveMapElitesGrid` at the end of `mapElitesEvolve` and `loadMapElitesGrid` at the start. Wire it through `autoImproveArtifact`.

---

### Gap C3 — GEPA optimizer silently degrades to MAP-Elites

**Location:** `src/core/ax-optimizer.ts`

```typescript
try {
  const study = await optimize(objective, { nTrials, direction: "maximize", seed });
  // ...build EvolutionRun...
} catch (error) {
  console.warn("GEPA Optimization failed, falling back to MAP-Elites.", error);
  const meRun = await mapElitesEvolve(cwd, basePolicy, { ... });
  return mapElitesToEvolutionRun(meRun);
}
```

Any failure — missing `@ax-llm/ax` module, missing API key, network timeout, JSON parse error — causes a silent downgrade to random-mutation MAP-Elites. The user sees the "Optimization Complete" message either way.

**Consequence:** Users may run `mise run evolve` thinking they're getting Bayesian optimization when they're actually getting random hill climbing. No telemetry or persistent flag records which path was taken.

**Fix:** Make the fallback explicit in the artifact, not just `console.warn`. Write `"optimizer_used": "mapElites_fallback"` into the evolution report.

---

### Gap C4 — ACE prompt learner evaluates teaching responses, not prompt quality

**Location:** `src/core/ax-prompt-learner.ts`

```typescript
const metric = async ({ prediction, example }: any) => {
  // prediction.teachingResponse is "Functions are machines..."
  const evalResult = await evaluatePromptContent(cwd, promptPath, prediction.teachingResponse);
  return evalResult.score / 100.0;
};
```

`AxACE` compiles a prompt optimizer, but its metric function feeds **a single teaching response** (e.g., "Functions are machines...") into `evaluatePromptContent`, which scores it as a *prompt template*. The heuristic evaluator checks for keywords like `diagnosis`, `retrieval`, `transfer` — which don't exist in a teaching sentence about functions.

**Consequence:** ACE optimizes toward teaching responses that happen to contain words like "diagnosis" or "prerequisite", not toward prompts that produce better teachers. It's optimizing the wrong level of abstraction.

**Fix:** The metric should test the *compiled prompt template* by recompiling the analyzer at each epoch and running the full `evaluatePromptContent` on the template, not on one output.

---

### Gap C5 — LLM benchmark mode is gated behind an env var and never used

**Location:** `src/core/benchmark.ts` (~line 111)

```typescript
if (process.env.KEATING_LLM_BENCHMARK !== "1") {
  return deterministicBaseline();
}
```

`deterministicBaseline()` is a closed-form polynomial. The LLM-based simulation path (which calls `piCompleteJson` to evaluate teaching outcomes) is skipped unless an undocumented environment variable is set. There is no config flag, no CLI option, no mention in the README.

**Consequence:** The benchmark is always synthetic. It claims to optionally use "real LLM judge mode" but the gate is buried and disabled. An improvement that genuinely helps human learners but doesn't score well on the polynomial will be rejected by evolution.

**Fix:** Add a `keating.config.json` field `benchmark.useLLMJudge` and expose `--llm-benchmark` on the CLI.

---

### Gap C6 — GEPA explored candidates contain `benchmark: baseline` placeholder data

**Location:** `src/core/ax-optimizer.ts` (~line 79)

```typescript
exploredCandidates: study.paretoFront.map((p, i) => ({
  policy: trialToPolicy(new PolicyTrial(p.params), `gepa-pareto-${i}`),
  benchmark: baseline, // Placeholder
  // ...
}))
```

Every candidate in the Pareto front claims the same `BenchmarkResult` as the baseline policy. This makes the `EvolutionRun` structurally incorrect — you cannot inspect a candidate and see its actual score, topic breakdowns, or weakest topic.

**Consequence:** Post-hoc analysis of GEPA runs is impossible. The trace files contain misleading data.

**Fix:** Re-run `runBenchmarkSuite` for each Pareto point, or cache per-trial results during optimization.

---

### Gap C7 — No programmatic `applyProposal` for meta-improvement

**Location:** `src/core/self-improve.ts`

`generateImprovementArtifact` writes a markdown file with instructions like:

> **Suggested approach**: Read the file, understand the region, and make a targeted change

But there is **no function** that actually applies the changes. The system generates a detailed instruction manual for a human (or agent) to execute manually, but has no autonomous file-editing capability.

`acceptImprovement` and `rejectImprovement` exist — they update archive state — but the actual code modification between "generate proposal" and "accept/reject" is a manual gap.

**Consequence:** The self-improvement system is a proposal engine, not an autonomous agent. It cannot edit its own source code without external manual intervention.

**Fix:** Implement `applyProposal(cwd, proposal)` that reads the target files, applies the suggested changes (e.g., using a patch/diff mechanism or LLM-guided edit), runs tests, and returns a pass/fail result.

---

### Gap C8 — `acceptImprovement` / `rejectImprovement` are not wired to CLI or Pi commands

**Location:** `src/core/project.ts`, `src/cli/main.ts`, `src/pi/hyperteacher-extension.ts`

These functions are exported from `project.ts`:

```typescript
export async function improveAccept(cwd, proposalId): Promise<...>
export async function improveReject(cwd, proposalId, snapshots): Promise<void>
```

But `main.ts` only imports:

```typescript
import { ..., improveArtifact, improveHistory, ... } from "../core/project.js";
```

There is no `keating improve accept <id>` or `keating improve reject <id>` CLI command. The Pi extension `/improve` handler only supports `history` and default (generate proposal). Neither has accept or reject branches.

**Consequence:** The self-improvement lifecycle is incomplete. You can generate a proposal but the system provides no native way to record whether it worked.

**Fix:** Add `keating improve accept <id>` and `keating improve reject <id>` to the CLI, and `/improve accept <id>` / `/improve reject <id>` to the Pi extension.

---

### Gap C9 — `MUTABLE_SOURCES` excludes the evolution infrastructure itself

**Location:** `src/core/self-improve.ts` (~line 38)

```typescript
const MUTABLE_SOURCES: Record<string, string> = {
  "lesson-plan": "src/core/lesson-plan.ts",
  "benchmark-weights": "src/core/benchmark.ts",
  "animation": "src/core/animation.ts",
  "topics": "src/core/topics.ts",
  "map": "src/core/map.ts",
  "policy-defaults": "src/core/policy.ts"
};
```

Missing:
- `mutation.ts` — amplitude values, mutation rules
- `map-elites.ts` — grid resolution, descriptors, initRandom ratio
- `prompt-evolution.ts` — heuristic scoring, candidate generation
- `self-improve.ts` itself — the meta-loop parameters

**Consequence:** The self-improvement module cannot improve its own search algorithm, mutation strategy, or heuristic evaluator. It can tweak lesson plans but not how it finds them.

**Fix:** Add the evolution infrastructure files to `MUTABLE_SOURCES`. Also consider adding a self-reference to `self-improve.ts` with appropriate safety guards.

---

## Shared Gaps (Both CLI and Web)

These gaps were identified in the web analysis but **also apply to the CLI layer**.

### Gap S1 — Fixed mutation amplitude with no adaptation

**Location:** `src/core/mutation.ts`

```typescript
export function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number
export function mutateWeights(parent: SimulationWeights, prng: Prng, amplitude = 0.12): SimulationWeights
```

Same hardcoded amplitude in both CLI and web. No step-size adaptation, no simulated annealing, no population variance learning.

**See also:** Web Gap 7.

---

### Gap S2 — No convergence detection or early stopping

**Location:** `src/core/map-elites.ts`, `web/src/keating/core.ts`

Both CLI and web use exactly 48 iterations (CLI default) / 24 iterations (web default) regardless of whether the best score improved in the last 15 iterations or plateaued after 3.

**See also:** Web Gap 9.

---

### Gap S3 — Policy names erase lineage

**Location:** `src/core/mutation.ts`

```typescript
name: `${namePrefix}-${iteration}` // → "me-candidate-7"
```

No run ID, timestamp, or session fingerprint. Multiple `auto_improve` invocations produce identically-named candidates across days.

**See also:** Web Gap 10.

---

### Gap S4 — Multi-objective trade-offs collapsed to scalar

**Location:** `src/core/map-elites.ts`

The grid uses 2 descriptors (`formalism` × `socraticRatio`) in a 10×10 grid, collapsing ~9 policy dimensions. No Pareto archive of niche-specialist policies.

**See also:** Web Gap 11.

---

### Gap S5 — Domain-specific teaching phases invisible to benchmark

**Location:** `src/core/lesson-plan.ts`, `src/core/benchmark.ts`

`buildLessonPlan` injects domain-specific phases ("Live Code" for code, citations for law, etc.) but `simulateTeaching` does not model this extra load. A code topic has more phases than a math topic but the benchmark treats their scoring identically.

**See also:** Web Gap 12.

---

### Gap S6 — No rate-limiting on `auto_improve`

**Location:** `src/cli/main.ts`, `src/pi/hyperteacher-extension.ts`, `web/src/keating/browser-tools.ts`

All three entry points (`keating auto-improve`, `/auto-improve`, `auto_improve` tool) run immediately with no throttling, cooldown, or session-tracking. The system prompt's instruction "Do not run more than once per conversation" is advisory only.

**See also:** Web Gap 13.

---

### Gap S7 — DEFAULT_POLICY differs between CLI and web

**Location:** `src/core/policy.ts` vs `web/src/keating/core.ts`

| Parameter | CLI Default | Web Default |
|-----------|------------|-------------|
| analogyDensity | 0.72 | 0.60 |
| socraticRatio | 0.66 | 0.55 |
| formalism | 0.64 | 0.50 |
| retrievalPractice | 0.74 | 0.70 |
| exerciseCount | 3 | 4 |
| diagramBias | 0.70 | 0.45 |
| reflectionBias | 0.68 | 0.50 |
| interdisciplinaryBias | 0.62 | 0.40 |
| challengeRate | 0.58 | 0.35 |

**Consequence:** Evolution results from the CLI are not directly comparable to web results. A "better" policy in one may be worse in the other, depending on which baseline it evolved from. Cross-platform policy sharing is unreliable.

**Fix:** Unify defaults in a shared constants file that both environments import.

---

## Quick-Fix Priority Matrix (CLI/Core)

| Fix | Gaps | Effort | Impact |
|-----|------|--------|--------|
| Wire `applyFeedbackBias` into benchmark | C1, S1 | Small | High |
| Wire grid serialization into `mapElitesEvolve` | C2 | Small | High |
| Fix ACE metric to evaluate prompts, not responses | C4 | Medium | High |
| Expose LLM benchmark via config/CLI flag | C5 | Small | Medium |
| Fix GEPA placeholder benchmark data | C6 | Small | Medium |
| Implement `applyProposal` with test gate | C7 | Large | High |
| Wire accept/reject to CLI + Pi commands | C8 | Small | Medium |
| Expand `MUTABLE_SOURCES` to evolution infra | C9 | Small | Medium |
| Unify `DEFAULT_POLICY` across CLI and web | S7 | Small | High |
| Make GEPA fallback explicit in reports | C3 | Small | Low |

---

*Document generated from a static analysis of the core self-modification layer.*
