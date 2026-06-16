# Quint Specification for Keating

Formal specification of the deterministic pedagogy engine, intended to
complement (not replace) the `fast-check` property tests in `test/`.

## Files

- `keating.qnt` — single combined spec (Quint 0.32.0 typechecks one
  file at a time; sibling files don't resolve via `import`). The file
  is logically split into 9 modules:

  | Module | Mirrors | Purpose |
  |--------|---------|---------|
  | `helpers` | — | List versions of Set ops, listMap, etc. |
  | `Policy` | `src/core/policy.ts` | `TeacherPolicy` + `SimulationWeights`, clamping, normalization, signature |
  | `Invariants` | `test/helpers.ts` | System laws (policy/weights/scores bounded, normalized) |
  | `Topics` | `src/core/topics.ts` | Domain enum, keyword heuristic, fallback resolution |
  | `LessonPlan` | `src/core/lesson-plan.ts` | Phase construction + 7 domain-specific injections |
  | `Benchmark` | `test/helpers.ts` `stubBenchmarkResult` | Deterministic score function, score bounds |
  | `Evolution` | `src/core/evolution.ts` | MAP-Elites archive, novelty, 3-gate acceptance |
  | `PromptEvolution` | `src/core/prompt-evolution.ts` | 6-objective PROSPER selection, Pareto dominance |
  | `Learner` | `src/core/learner-state.ts` | Profile, feedback append-only, spaced-repetition |
  | `StateMachine` | CLI command set | Top-level transitions: `init → plan/bench/feedback/mutate` |

## Numeric rescaling

Quint has only `int`. The TS types use `[0, 1]` floats, so the spec
rescales: `1.0 == 1000 millis`. Weights sum to 1 → 1000. Benchmark
scores are in `[0, 100]` → `[0, 10000]`. Metric means in `[0, 1]` →
`[0, 1000]`. All arithmetic commutes with this rescaling.

## Running

```bash
# Typecheck
quint typecheck keating.qnt

# Simulate + check individual invariants
quint run --main=StateMachine --invariant=policyBounded   keating.qnt
quint run --main=StateMachine --invariant=weightsNormalized keating.qnt
quint run --main=StateMachine --invariant=scoresBounded   keating.qnt
quint run --main=StateMachine --invariant=planIsValid     keating.qnt
quint run --main=StateMachine --invariant=systemIsSane    keating.qnt

# Stress: many traces, many steps
quint run --main=StateMachine --invariant=systemIsSane \
  --max-steps=50 --max-samples=1000 --seed=42 keating.qnt

# Bounded model check via Apalache (state-space exploration)
quint verify --main=StateMachine --invariant=systemIsSane keating.qnt
```

## Invariants checked

| Invariant | Source | Status |
|-----------|--------|--------|
| `policyBounded` | `test/helpers.ts:policyIsBounded` | simulator ✅ |
| `weightsNormalized` | `test/helpers.ts:weightsAreNormalized` | simulator ✅ |
| `scoresBounded` | `test/helpers.ts:benchmarkScoresAreBounded` | simulator ✅ |
| `planIsValid` | new (phase-injection consistency) | simulator ✅ |
| `systemIsSane` | composite | simulator ✅ |

## Coverage

The `step` action in `StateMachine` enumerates 9 possible CLI
commands: `plan("derivative")`, `plan("entropy")`, `plan("recursion")`,
`bench("derivative")`, `bench("entropy")`, and 3 feedback events
(thumbs-up/down/confused) plus `mutatePolicyStep()` (with a finite
set of `bump` deltas). This covers the core CLI surface used in
`keating plan`, `keating bench`, `keating feedback`, and `keating evolve`.

## Out of scope

- File I/O (no `fs`, no paths in the spec)
- LLM calls (`piComplete()` in `animation.ts`, `pi-agent.ts`) — these
  are nondeterministic and have stubs in the test suite
- MAP-Elites grid descriptors (modeled only at the policy-archive
  level; descriptors are a refinement)
- Engagement timeline exponential decay (modeled as bounded property
  only, not the exact half-life formula)

## Bugs found while writing the spec

The simulator caught one real correctness issue: the first version
of `mutatePolicyStep` did not rebuild the `plan` field, leaving the
plan's `socraticOpening` / `usesDiagram` flags stale relative to the
mutated policy. The spec was tightened to make `mutatePolicyStep`
rebuild the plan from `plan.topicSlug + newPolicy`, which matches
the contract of a self-consistent CLI session.
