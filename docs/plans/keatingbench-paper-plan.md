# Paper Plan — KeatingBench: A Cross-Model Benchmark for Agency-Preserving Teaching

> Status: draft plan (not the manuscript). Companion to `docs/study.typ`
> ("Keating: A Metaharness for Agency-Preserving AI Instruction"). This file
> scopes the *second* paper and maps it onto the existing Typst section layout
> so it can be dropped into `docs/study/sections/` when drafting begins.

## 1. One-sentence thesis

Teaching quality is a property you can measure *across models* by replaying the
same real learner decision points through each model and judging the resulting
teaching move on a multi-objective rubric (PROSPER) — and when you do, models
that merely explain fluently rank below models that preserve the learner's own
reconstruction.

## 2. The gap this paper fills

Paper 1 established two things and deferred a third:

- **Established:** a formal account of a teaching *metaharness*, plus a
  reproducible two-layer evidence stack (16 archival trace pairs at overall
  0.61; a synthetic harness where the evolved policy beats default by 6.703
  across 200/200 seeds).
- **Established:** that *policy* matters inside one model's harness.
- **Deferred:** whether the *model* matters, and how to compare models without
  re-running a fresh human cohort per model. Paper 1 explicitly names a human
  RCT as the next step for causal claims.

KeatingBench attacks the model-comparison gap with a method that is cheaper and
more reproducible than a per-model RCT: **replay**. Existing tutoring/LLM
benchmarks score *answer correctness* or *explanation quality*, not whether the
teaching move preserved learner agency. KeatingBench is, to our knowledge, the
first benchmark that (a) sources its items from real learner sessions, (b)
replays a fixed decision point across providers, and (c) scores agency-preserving
teaching behavior rather than answer fluency.

## 3. Contributions (claim list)

1. **The replay-case formulation.** A precise definition of a "replay case":
   the extracted, model-agnostic learner state at a teaching decision point,
   plus the realized outcome on the original session. (Grounds: existing
   replay-case extraction in the browser benchmark; `test/traces/*.json`.)
2. **PROSPER, a multi-objective teaching score.** Performance, Robustness,
   Outcome-lift, Sparse-data caution, Personalization, Evidence quality,
   Retention/transfer — defined formally, with the weighting and the
   sparsity/readiness gates that prevent low-evidence models from topping the
   board.
3. **A cross-model replay protocol.** Same case → N providers → same PROSPER
   judge → leaderboard, with readiness bands so sparse cells are reported as
   sparse rather than silently ranked.
4. **Empirical findings.** A leaderboard over a fixed model set, the
   correctness-vs-agency dissociation (models that score high on answer quality
   but low on outcome-lift/retention), and topic heterogeneity carried over from
   Paper 1.
5. **A reproducible artifact.** The benchmark page, the case bank, and the
   analysis scripts, runnable from the same tree as the release build.

## 4. Method (the core of the paper)

### 4.1 Replay case extraction
- Define the decision point: the turn where the learner exposes a gap and the
  model must choose a teaching move (probe vs. explain vs. verify).
- Normalize to a provider-agnostic `ReplayCase`: prior context, learner text,
  the gap/feedback signal, the original outcome score, and the original PROSPER
  vector.
- Selection rule must be deterministic and pre-registered (mirror the Paper 1
  rule in `scripts/study-analysis.mjs`: group by `topic x learner`, keep latest,
  document exclusions). Reuse the curated 16-pair archival set as the seed bank
  and grow it.

### 4.2 PROSPER judgement
- Formal definition of each of the seven dimensions, the aggregation (weighted,
  not raw outcome), and the rationale that a model ranks well *only* when it
  balances outcome with evidence quality and teaching behavior.
- Judge design: rubric prompt, the LLM-judge model, calibration against the
  archival human-rated outcomes, and inter-judge / self-consistency checks.
- Sparsity gate and readiness bands: how few-signal cells are quarantined.

### 4.3 Cross-model replay protocol
- Fix the case set, fix the judge, vary the teaching model.
- Stage classification (the replay mix: e.g. probe / reconstruct / retention)
  reported per model so a model isn't rewarded for cherry-picking easy stages.
- Provider abstraction: the same `ReplayCase` is sent to each provider behind a
  uniform interface; record cost/latency for an efficiency axis.

### 4.4 Evidence layers (carry the Paper 1 discipline)
- **Archival/human-anchored layer:** replay over the curated real sessions,
  judged against realized outcomes.
- **Synthetic robustness layer:** the in-repo harness as a stress test of judge
  and protocol stability, explicitly *not* a human-learning claim.
- Keep the two layers separate in every results table, as Paper 1 does.

## 5. Experiments / results to produce

- E1: Leaderboard over the fixed model set (PROSPER + per-dimension breakdown).
- E2: Correctness-vs-agency dissociation — correlate answer-quality proxies with
  outcome-lift/retention; show they diverge.
- E3: Judge validity — agreement with archival human ratings; ablate the judge
  model; sensitivity of ranks to PROSPER weights.
- E4: Robustness — rank stability across seeds/case subsamples; readiness-gate
  effect on the board.
- E5: Topic heterogeneity — does model ranking flip by topic (Special Relativity
  vs. Stoicism, per Paper 1's spread)?
- E6 (efficiency): PROSPER-per-dollar / per-token frontier.

## 6. Threats to validity (write this section honestly, like the review memo)

- **Judge monoculture:** one LLM judge may encode its own teaching priors →
  mitigate with multi-judge agreement and human-anchored calibration.
- **Replay realism:** a replayed decision point is counterfactual; the learner
  did not actually receive the new model's move → frame claims as *teaching-move
  quality*, not realized human learning.
- **Selection / leakage:** models may have trained on similar material →
  document, and lean on outcome-lift over recall.
- **Sparsity:** small per-cell N → readiness bands, bootstrap intervals (as in
  Paper 1's 0.515–0.705 style reporting).
- **Construct validity of PROSPER:** justify weights; report raw dimensions so
  readers can re-weight.

## 7. Relationship to the human RCT

KeatingBench is the *bridge* between Paper 1's synthetic evidence and the
eventual randomized human trial. The paper should state plainly: replay measures
teaching-move quality at scale and cheaply; the RCT remains the only path to
causal learning claims. Position the RCT as pre-registered future work and, if
possible, include a small human-anchored validation slice of the judge.

## 8. Manuscript structure (maps to `docs/study/sections/`)

| Typst section | KeatingBench content |
|---|---|
| `introduction.typ` | The explain-vs-reconstruct gap, restated for *model comparison*; the replay idea; contributions list. |
| `metaharness.typ` → `benchmark.typ` | Replay-case formalism, PROSPER definition, cross-model protocol, readiness/sparsity gates. |
| `results.typ` | E1–E6 tables/figures; two evidence layers kept separate. |
| `discussion.typ` | Correctness-vs-agency dissociation; what a leaderboard does and does not license. |
| `methods.typ` | Extraction rule, judge calibration, provider interface, analysis scripts. |
| `limitations.typ` | Section 6 threats, in full. |
| `availability.typ` | Benchmark page, case bank, scripts; exact repro commands. |

Reuse `study/preamble.typ`, `study/frontmatter.typ`, and `refs.bib`.

## 9. Reproducibility checklist

- Deterministic case-selection script (extend `scripts/study-analysis.mjs`).
- Frozen case-bank snapshot committed (or hash-pinned) for the camera-ready run.
- Judge prompt + model id + temperature recorded in the artifact.
- One command to regenerate every table/figure from the snapshot.
- Provider versions and dates pinned (model ids drift).

## 10. Open questions to resolve before drafting

1. **Model set:** which providers/versions are in the frozen leaderboard, and as
   of what date?
2. **PROSPER weights:** fixed by us, or learned/justified empirically? Report both?
3. **Judge:** single strong judge with human calibration, or a small judge
   ensemble? Budget?
4. **Case-bank size:** is the 16-pair archival seed enough for stable ranks, or
   do we need a fresh collection round first?
5. **Scope of human anchoring:** can we get even a small fresh human-rated slice
   to validate the judge, short of a full RCT?
6. **Authorship/venue:** workshop (faster, benchmark-friendly) vs. full
   conference; arXiv preprint timing relative to the v1.x release cadence.

## 11. Suggested milestones

1. Freeze the replay-case schema + deterministic extraction; commit a snapshot.
2. Wire provider replay behind the uniform interface (the blog's named "next step").
3. Calibrate the PROSPER judge against archival outcomes; lock weights.
4. Run E1–E6; draft results + limitations first (most likely to reshape claims).
5. Write introduction/discussion around the actual findings; internal review
   using the `peer-review-notes.md` format.
6. arXiv preprint; link from the Paper page alongside the metaharness PDF.
