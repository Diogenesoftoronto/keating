# Web App Self-Modification Gap Analysis

> Analysis date: 2026-05-27  
> Scope: `web/` — browser port of Keating's self-modification layer  
> Key files: `web/src/keating/browser-tools.ts`, `web/src/keating/core.ts`, `web/src/hooks/useKeatingAgent.tsx`

---

## Executive Summary

The web app has the **full machinery** for self-modification: MAP-Elites policy evolution, PROSPER-style prompt evolution, synthetic learner benchmarking, and IndexedDB artifact archival. What it lacks is the **feedback wiring** that would make these components form a closed loop. The system evolves policies but never teaches from them, refines prompts but never sends them to the agent, and archives elites but never seeds the next run from them.

This document lists 15 gaps, ordered by severity.

---

## Gap 1 — Evolved policy parameters are never fed back into the next run

**Severity: CRITICAL**

All policy-aware tools reconstruct a `TeacherPolicy` with hardcoded literal values instead of parsing the stored active policy from storage. Every evolution run starts from a fixed default regardless of prior evolution results.

**Evidence (×10 occurrences in `browser-tools.ts`):**

```typescript
const teacherPolicy: TeacherPolicy = policy
  ? {
      name: policy.id,
      analogyDensity: 0.6,     // ← hardcoded. Always 0.6.
      socraticRatio: 0.55,     // ← hardcoded. Always 0.55.
      formalism: 0.5,          // ← hardcoded. Always 0.5.
      exerciseCount: 4,        // ← hardcoded. Always 4.
      challengeRate: 0.35,     // ← hardcoded. Always 0.35.
      // ...all hardcoded
    }
  : DEFAULT_POLICY;
```

- `plan` tool (line ~126)
- `bench` tool (line ~284)
- `evolve` tool (line ~315)
- `quiz` tool (line ~472)
- `auto_improve` tool (line ~554)
- `improve` tool (line ~803)

The policy is saved as **markdown text** with evolved parameter values noted in prose, then stored as `active: true` in IndexedDB. On the next invocation, the code reads the markdown string but does **not parse the scalar values** back into a `TeacherPolicy` object. It simply falls through to the hardcoded defaults.

**Consequence:** Every evolution run reinvents the wheel. No cumulative learning across sessions.

**Fix options:**
1. Store `TeacherPolicy` as JSON rather than markdown, so `getActivePolicy()` returns a typed object.
2. Parse the markdown on load frontmatter-style with a small regex parser.
3. Keep a dedicated `last-evolved-policy` key in `KeatingStorage`.

---

## Gap 2 — Evolved prompts are never applied back to the running agent

**Severity: CRITICAL**

`prompt_evolve` and `auto_improve` call `storage.savePromptEvolution()` which writes `bestPrompt` to IndexedDB. However, nowhere in the codebase does the agent actually adopt the evolved prompt:

```typescript
// This never happens:
agent.state.systemPrompt = evolvedPrompt;
```

**Additional issue in `useKeatingAgent.tsx`:**

Toggling speech calls `buildKeatingSystemPrompt(speechSettings.enabled)` which **reconstructs from the hardcoded `KEATING_SYSTEM_PROMPT`**, unconditionally overwriting whatever was previously in `agent.state.systemPrompt`:

```typescript
agent.state.systemPrompt = buildKeatingSystemPrompt(speechSettings.enabled);
```

Even if someone manually applied an evolved prompt, switching speech on/off would wipe it.

**Consequence:** Prompt evolution is a recording exercise. The system maintains a museum of better prompts but never uses any of them.

**Fix:** On agent start, check for the most recently evolved prompt and use it as the base. On `prompt_evolve` completion, hot-swap the running `agent.state.systemPrompt`. Make speech toggle additive (prepend speech instructions) rather than regenerating from scratch.

---

## Gap 3 — Prompt evolution has no memory across runs

**Severity: CRITICAL**

Every `prompt_evolve` call starts from the original `KEATING_SYSTEM_PROMPT` constant:

```typescript
const basePrompt = KEATING_SYSTEM_PROMPT; // always the original
const run = evolvePromptTemplate(basePrompt, promptName, 4);
```

It never queries `storage.getPromptEvolutions()` to retrieve the best prompt from the previous run and use it as the seed.

**Consequence:** 4-iteration prompt evolution restarts from scratch every time. There's no compounding refinement, no population-based accumulation.

**Fix:** Seed `evolvePromptTemplate` with `lastEvolvedPrompt ?? KEATING_SYSTEM_PROMPT`. Maintain an archive that persists across sessions, not just within a single invocation.

---

## Gap 4 — The "reversion on regression" message is a lie

**Severity: HIGH**

`auto_improve` prints:

```
REGRESSED by X.XX (evolved policy reverted)
```

But there is **no reversion logic**. The evolved policy is already saved as `active: true` in IndexedDB by `storage.savePolicy(...)`. The message is constructed from a string template with no corresponding code path to undo the save.

```typescript
const delta = after.overallScore - baseline.overallScore;
const verdict = delta < -0.5
  ? `REGRESSED by ${delta.toFixed(2)} (evolved policy reverted)`
  : ...
```

The policy remains active. The learner is told it was reverted. It was not.

**Consequence:** Silent degradation of teaching quality with no telemetry that the user was misled.

**Fix:** Actually implement rollback — save the previous policy before applying the new one, and restore it on regression.

---

## Gap 5 — Benchmarks optimize for synthetic learners, not the real one

**Severity: HIGH**

`simulateTeaching` in `core.ts` scores policies using randomized abstract personas:

```typescript
{
  id: `learner-${seed}-${index}`,
  priorKnowledge: prng.next(),
  abstractionComfort: prng.next(),
  analogyNeed: prng.next(),
  // ...
}
```

It never looks at:

- Actual `feedback` entries (thumbs-up/down/confused) recorded via the `feedback` tool
- The real learner's topic mastery estimates from `buildEngagementTimeline`
- Whether the real learner historically struggles on high-formalism vs high-analogy topics

**Consequence:** The self-modification engine optimizes for a statistical average of 18 fake learners while ignoring the real learner's actual session history. An evolution might discover a policy that scores well on synthetic data but drives the real user to confusion.

**Fix:** Seed the synthetic learner population with traits derived from the real learner's feedback history. Use `storage.getLearnerState()` as a starting distribution, not `prng.next()`.

---

## Gap 6 — MAP-Elites grid is ephemeral

**Severity: MEDIUM**

`mapElitesEvolve` in `core.ts` creates a fresh 10×10 grid every time. It is never serialized.

The desktop CLI version (`src/core/evolution.ts`) persists archives to `.keating/outputs/evolution/` via `saveArchive(archivePath, archive)`. The browser port stores only a single markdown report and a JSON blob for `bestPolicy` — but **not the grid itself**.

**Consequence:** Each `auto_improve` re-explores the same territory. The Pareto front from the previous session is lost. The browser gets a weaker search trajectory than the CLI.

**Fix:** Add a MAP-Elites grid store to `KeatingStorage` (IndexedDB). Serialize `grid.cells` as an array and reload it on the next `mapElitesEvolve` call.

---

## Gap 7 — Fixed mutation amplitude with no adaptation

**Severity: MEDIUM**

Mutation step sizes are frozen constants:

```typescript
function mutateScalar(prng: Prng, value: number, amplitude = 0.18): number
function mutateWeights(parent: SimulationWeights, prng: Prng, amplitude = 0.12): SimulationWeights
```

There is no simulated annealing, no step-size adaptation (1/5 success rule, CMA-ES covariance, etc.), no matter whether the last 10 candidates were all accepted or all rejected.

**Consequence:** On a smooth fitness landscape, 0.18 overshoots the optimum. On a rugged one, it undershoots useful valleys. The algorithm cannot learn its own learning rate.

**Fix:** Track acceptance rate over a sliding window and scale `amplitude` proportionally (e.g., σ ← σ × exp(0.2 × (p − 0.2)) using the 1/5th rule).

---

## Gap 8 — The `improve` tool is orphaned

**Severity: MEDIUM**

`improve` diagnoses specific benchmark weaknesses and generates targeted improvement proposals:

```typescript
const proposal = generateImprovementProposal(benchmark);
// e.g., { area: "diagramFit", suggestion: "Increase diagramBias to 0.65" }
```

But `auto_improve` — the orchestration tool that actually runs — **never calls** `generateImprovementProposal` or `improve`. Instead it runs a generic `bench → evolve → prompt_evolve` pipeline that does not act on the specific weaknesses `improve` has diagnosed.

**Consequence:** A diagnostic tool produces prescriptions that no one fills. `improve` exists but is dead code in the autonomous loop.

**Fix:** Integrate `improve` into `auto_improve`: after the baseline benchmark, run `diagnoseBenchmark` and bias the initial mutation direction toward fixing the weakest metric.

---

## Gap 9 — No convergence detection or early stopping

**Severity: MEDIUM**

MAP-Elites always runs exactly 24 iterations. Prompt evolution always runs exactly 4.

```typescript
for (let i = 1; i <= iterations; i++) { // iterations is 24, always
```

There's no plateau detection:
- If the best score hasn't improved for 8 iterations, it keeps burning for 16 more.
- If a breakthrough is found in iteration 3, it doesn't do extra exploitation.

**Consequence:** Wasted compute on solved problems, premature truncation on hard ones.

**Fix:** Add early stopping on stagnation (no improvement for N iterations) and dynamic budget reassignment (if breakthrough found, extend the budget).

---

## Gap 10 — Policy names erase lineage

**Severity: LOW**

Candidates are named:

```typescript
name: `keating-candidate-${iteration}`   // → keating-candidate-7
name: `me-random-${i}`                   // → me-random-12
```

The archive stores `parentName`, but there is no run-level identifier (timestamp, session ID, `auto_improve` invocation count). If you run `auto_improve` three times across three days, you get three sets of identically-named candidates.

**Consequence:** Debugging which evolution produced which policy, or tracing regressions back to their source, is nearly impossible from the stored data alone.

**Fix:** Prefix candidate names with a run ID: `auto-${sessionId.slice(0,6)}-candidate-${iteration}`.

---

## Gap 11 — Multi-objective trade-offs are collapsed to a scalar

**Severity: MEDIUM**

MAP-Elites grids on only 2 descriptors (`formalism` × `socraticRatio`) in a 10×10 grid. The actual optimization space has ~9 dimensions (analogyDensity, socraticRatio, formalism, retrievalPractice, exerciseCount, diagramBias, reflectionBias, interdisciplinaryBias, challengeRate).

There's no Pareto archive. A policy that is excellent at `transfer` but mediocre at `retention` gets discarded if its scalar `overallScore` is lower. That policy might have been ideal for a learner who specifically needs transfer practice.

**Consequence:** The search discards niche-specialist policies that could be superior for specific learner profiles.

**Fix:** Expand the descriptor set (or use random projections) and keep a Pareto front rather than a single best score per cell.

---

## Gap 12 — Domain-specific teaching phases are invisible to the benchmark

**Severity: MEDIUM**

`buildLessonPlan` injects extra phases based on `topic.domain`:

- `code` → inserts "Live Code" phase
- `law` → appends citation instructions
- `medicine` → appends evidence-level references
- `history` → appends timeline/source instructions

`simulateTeaching` does not model this. A "code" topic has more phases (heavier teaching load) than a "math" topic, but the benchmark treats them identically. A policy evolved on "derivative" (math, 7 phases) is applied to "recursion" (code, 8 phases) without the simulator knowing the difference.

**Consequence:** Policy evolution may overfit to topics with lighter phase counts and underperform on heavier domains.

**Fix:** Weight the simulation score by phase count or domain-specific complexity, or maintain separate MAP-Elites grids per domain.

---

## Gap 13 — No technical rate-limiting on `auto_improve`

**Severity: LOW**

The system prompt instructs:

> "Do not run `auto_improve` more than once per conversation unless the learner requests it."

But the `auto_improve` tool itself has **no guard**:

```typescript
// auto_improve tool — no throttle check
async (params) => {
  // ...immediately runs the full loop
}
```

An LLM agent following instructions loosely could easily invoke it multiple times in a single turn.

**Consequence:** Wasted compute, degraded UX, and potential feedback-loop thrashing.

**Fix:** Track `lastAutoImproveAt` in `KeatingStorage` and reject invocations within the same session or within a cooldown window.

---

## Gap 14 — The browser port lacks advanced optimizers

**Severity: LOW**

The desktop core has:

- `evolveWithGEPA` — Bayesian optimization via `ax-optimizer.ts`
- `evolveWithACE` — adaptive prompt learning via `ax-prompt-learner.ts`

The browser (`core.ts`) only exports the naive random-mutation `evolvePolicy` and `mapElitesEvolve`. Web users get strictly weaker search algorithms than CLI users.

**Consequence:** Browser self-modification is slower and less sample-efficient than the CLI equivalent.

**Fix:** Port the Ax optimizers (or light reimplementations with deterministic surrogate models) to the browser bundle.

---

## Gap 15 — All policy-aware tools are independently inconsistent

**Severity: MEDIUM**

Every tool that builds a `TeacherPolicy` from `storage.getActivePolicy()` does so with **copied-and-pasted hardcoded values** — the same literal block of `0.6, 0.55, 0.5, ...` replicated across `plan`, `bench`, `evolve`, `quiz`, `auto_improve`, and `improve`.

If you change the default in one place, the other five diverge silently. This is a maintenance bomb.

**Consequence:** The "default" policy is not a single source of truth — it is six independent copies that drift apart invisibly.

**Fix:** Extract a `parsePolicyFromStorage` helper (or fix Gap 1 so the storage itself returns a typed policy) and replace all inline constructions with a single call.

---

## Quick-Fix Priority

| Fix | Gaps addressed | Effort | Impact |
|-----|----------------|--------|--------|
| Parse active policy from storage | 1, 15 | Medium | High |
| Apply evolved prompt to agent live | 2 | Small | High |
| Seed prompt evolution from archive | 3 | Small | High |
| Implement actual policy rollback | 4 | Small | High |
| Weight synthetic learners from real feedback | 5 | Medium | High |
| Extract shared `buildPolicyFromStorage` helper | 1, 15 | Small | Medium |
| Serialize MAP-Elites grid | 6 | Medium | Medium |
| Adaptive mutation amplitude | 7 | Small | Medium |
| Integrate `improve` into `auto_improve` | 8 | Medium | Medium |
| Early stopping / plateau detection | 9 | Small | Medium |
| `auto_improve` rate limit | 13 | Small | Low |

---

*Document generated from a static analysis of the web self-modification layer.*
