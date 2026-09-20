# Jev + Model Cascade in Keating

> Execution priority updated 2026-09-19: implement and verify working end-to-end
> application flows and deep judgement integration first. The Sol comparison
> and performance testing are deferred until those flows work; agreement is no
> longer a prerequisite for integration. Unknown calibration remains explicit,
> and model estimates do not become observed learner evidence.
> Priority revised again 2026-09-19 at the user's direction: phase 8 (the Sol
> benchmark comparison and performance work) is withdrawn for now, and phase 7
> (boosting) is the active work. §5 records the chosen mechanism and its limits.
> ADB, emulator and physical-device checks are deferred. Current implementation
> evidence and remaining work are tracked in [the progress ledger](jev-model-cascade-progress.md).

## Context

Keating decides a lot of qualitative things. Today each one is made either by a
hand-tuned heuristic or by an LLM asked to act as a judge, and both are weak in
the same place: neither produces a *calibrated* number, so nothing downstream can
honestly say how much to trust it.

The heuristics are frank about it. `scoreAnswer` in `src/core/mastery.ts` says
*"In practice an LLM should do this, but this provides deterministic defaults"*
and then scores by word overlap and answer length. `recordQuizResult` in
`src/core/learner-state.ts` is the entire CLI ability model:
`mastery = mastery * 0.6 + score * 0.4`. `LEARNER_PROGRESS_THRESHOLDS` in
`mobile/src/lib/learner-progress.ts` is a linear model's coefficients, typed by
hand and never fitted.

The judges are expensive and unreproducible. There are six of them:
`scripts/training/benchmark_judge.py` (11 rubric dimensions),
`createEpisodeJudge` in `shared/evolution/model-adapters.ts`, `export-judge.ts`,
the rubric pass in `web/src/keating/trajectory-passes.ts`,
`src/core/policy-judgement.ts`, and `buildProfileFromFeedback`. They cost
seconds and cents per call, drift with every model version, and their
"calibration" file is 8 synthetic pairs marked
*"agent-authored synthetic calibration controls; not human ratings"*.

**Jev** (TypeSafe's System One model) answers exactly this class of question:
closed-vocabulary, typed, with a probability distribution attached. It cannot
generate arbitrary response text: evidence selection can copy an exact supplied
span. A selection can still be wrong or misinterpret that span, so source
validation, caller context and independent checks remain necessary. Performance
claims require measurements on the actual application path.

The intended outcome: every qualitative decision in Keating is answered by the
cheapest tier that can answer it honestly, carries a calibrated probability, and
abstains instead of guessing.

**Less of this is new than it appears.** `export-judge.ts` is already a
checkpointed two-tier cascade whose cache key hashes scorer identity (§2.3);
`computeSessionRewardedTurns` already joins every outcome channel into labelled
training rows (§7); `benchmark_response_grading.py` already specifies a pluggable
scorer manifest with a confidence threshold, explicitly anticipating *"a
separately trained activation readout"* (§1.4); and `reward.ts` already blends a
judge behind a one-line structural type. The work is mostly generalizing seams
that exist, not cutting new ones.

---

## Part 0 — Two constraint sets that govern everything

### 0.1 Keating's evidence taxonomy (do not corrupt it)

This is the most valuable thing in the codebase and a predictive model is exactly
what would quietly destroy it:

- `BenchmarkMeasurement` — `source: "observed" | "proxy" | "unavailable"`, with
  *"Null means unmeasured, rather than a measured failure"*
  (`shared/pedagogy/types.ts`).
- `BenchmarkHistoryRecord` — *"Immutable evidence that a benchmark was actually
  run, **not a projected learner score**"*
  (`packages/learner-contracts/src/evaluation.ts`).
- `RetrospectiveBenchmarkEvidence.eligibleForPromotion: false`.
- *"Synthetic episodes never establish human learning"*
  (`shared/evolution/contracts.ts`); promotion needs a predeclared one-sided
  paired sign test clustered by case family.
- `MathVerification.status: 'verified' | 'rejected' | 'unsupported'` — an exact
  verifier that abstains rather than guessing.
- `src/core/learner-memory.ts` — a remembered fact's `evidence` must be an **exact
  substring of a real learner message** (`learner_memory_evidence_not_in_learner_message`),
  SHA-256'd into `provenance.quoteSha256`; never an assistant reply or tool result.
  `observed` confidence is capped at **0.65**, `explicit` is 1.0. Cap 128 facts.

**Rules this plan adopts:**

1. A judgement output is **never** `source: "observed"`. `"proxy"` at best, with
   its own provenance tag (`backend`, `model`, `questionDigest`).
2. A judgement **never** makes an evolution candidate `eligibleForPromotion`. It
   may reorder what gets run; only a real run promotes.
3. Abstention is first-class and reuses the existing idioms — `'unsupported'`
   (`MathVerification`) and `grading: "pending"` (`LearnerQuestionCheck`). An
   abstention escalates or defers; it never becomes a low score.
4. **Jev never writes learner-facing prose.** It selects; the teacher model
   authors. This keeps the no-templates rule intact.

### 0.2 jev-1.13's documented jagged edges (do not ask it these things)

From `https://docs.typesafe.ai/model-jaggedness/jev-1.13.md`. These are not
cautions, they are hard design constraints, and three of the user's five surfaces
sit directly on top of them:

| Jagged edge | Consequence for this design |
| --- | --- |
| *"Jev is not a calculator"*; counting is unreliable | Never ask it to count items, tally correct answers, or compute a score. Code aggregates. |
| *"Don't interpolate between levels to reconstruct a magnitude; score levels are weak in numerical calibration"* | **Performance prediction must not be a Score scalar.** Use per-item Nouls, or threshold checks. Use `modalLevel()`, not the mean, for any decision. |
| *"Cannot reliably judge whether two values are near each other"* | Answer-vs-expected numeric comparison stays in `math-verification.ts`. |
| Dates read *"as text, not as ordered quantities"* | **Never ask for a due date or a duration in seconds.** Ask for a named bucket; code does the arithmetic. |
| Noul ≠ Choice: a Noul of 0.22 coexisted with Choice `no`=0.99; question and negation summed to 1.19 | One Noul per absolute condition, one direction. Never two Nouls for a claim and its negation. Never port a threshold between primitives — **or between backends**. |
| *"A Choice is relative (which option), a Noul absolute (and can be low for all of them)"* | Readiness is a Noul per candidate. Selecting *which* assessment is a Choice over the survivors. |
| Accuracy declines with large irrelevant state; *"Jev suffers from context rot"* | Needle shortlists first. Judgement state is assembled, never dumped. |
| *"State is data"* — injected instructions can shift answers, and **Jev has no system-prompt channel** to carry a "this is untrusted" instruction | Learner free text goes in a *named* state field whose criteria describe judging the field's content. No single judgement gates an irreversible action. |

---

## Part 1 — Architecture: the cascade

### 1.1 Tiers

```
Tier 0  Deterministic code        free, offline, exact     abstains → escalate
        math-verification, exact match, SM-2 arithmetic, prerequisite graph,
        date/duration arithmetic, dedupe

Tier 1  Needle (on-device)        free, offline            shortlists, never decides
        embeddings, extraction, candidate generation, local search

Tier 2  Judgement                 calibrated, typed        abstains → escalate
        ├── Jev (online, opted in)
        └── Local judgement model (offline): Needle as classifier +
            MiniCPM5 2B / user-selected model
            ── these are ALTERNATE BACKENDS on one rung, not a 2→3 escalation

Tier 3  Frontier LLM              expensive, generative    explicit user action
        the ONLY tier permitted to author prose
```

Two things make this different from a naive ladder:

- **Tier 2 has two interchangeable backends behind one question contract.** The
  *questions* are backend-independent; only the *thresholds and calibration* are
  per-backend. Given jev-1.13's own warning about porting thresholds across
  primitives, porting them across backends is the same error — so thresholds are
  stored keyed by `(backend, model, questionDigest)`.
- **A judgement only ever improves an answer that already exists.** Tier 0 or a
  default always produces something; Tier 2 refines it. Nothing waits on the
  network to render.

### 1.2 Where the code lives

The duplication matrix is brutal — grading exists in 4 places, mastery derivation
in 3, quiz types in 5. Placement decides blast radius:

- `packages/learner-contracts/src/judgement/` — **new, pure, dependency-free.**
  Question/answer types, the `JudgementCaller` structural interface, `isBimodal`,
  `modalLevel`, `scoreOutOf`, `confidenceOf`, threshold tables, and every
  projection function. Reaches web **and** mobile from one file, the way SM-2
  does. No network code.
- `src/judgement/` (CLI) and `web/src/keating/judgement/` — transports only.
  Each surface supplies a `JudgementCaller`; nothing else differs.
- `src/judgement/router.ts` — **the only module that knows the thresholds.**
  Every caller asks the router for a decision, never for a tier.

Three existing choke points mean the transport lands in three places, not thirty:

- **Web**: `hybridStreamFn` (`web/src/hooks/keating-stream.ts`) already branches
  `DESKTOP_OFFLINE_PROVIDER → browser → NotOrganic → proxy → direct`, wraps
  `streamWithApiRetry`, and records which transport served the call. Judgement is
  a sibling of that function, not a change to it.
- **Evolution**: every model call funnels through `createPiCompletionRunner(cwd)`
  in `src/core/teaching-episode-runner.ts` — one injection point for the whole
  loop (`maxProviderCalls: 1`, throwaway subprocess cwd, never surfaces provider
  stderr).
- **Background-call gating** already has a precedent: `isUsableForBackgroundCalls`
  in `web/src/keating/topic-categorization.ts` is a miniature router. The new
  router generalizes it rather than competing with it.

Pattern to copy from twyne: `viewRubricGrade` is *pure and synchronous by
design*, so moving a weight slider can never fire a network request. Cache the
raw score + confidence + full distribution + legend; apply weights and thresholds
in pure functions. This is TypeSafe's own composite-scoring pattern, and
`SimulationWeights` is already the weight vector.

### 1.3 Transport and secrets

`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer`, body
`{state, model, questions}` where `questions` is a map you key. Choice criteria
is a **map** option→rubric; Score criteria is an **ordered array**; Noul criteria
is optional `{true, false}`. Responses: Noul has **no confidence field**; Choice
and Score carry `probabilities` and `confidence`; Score also carries `legend`.

- TypeSafe keys stay server-side. Application hosted judgement uses the deployed
  Not Organic `/v1/judgement` route with scoped, DPoP-bound account authority.
  Browser and CLI live calls are verified; the optional same-origin server
  adapter is a separate integration and is not the production browser path.
- Our own guardrails (not API limits — the API documents none): ≤64 questions,
  ≤96,000 state chars, batch independent questions into one request.
- Errors are returned, never thrown, and never surfaced verbatim to a learner —
  upstream bodies can echo the learner's own text.
- `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1` on every Needle spawn path.

### 1.4 The offline backend

MiniCPM5 is **already shipping**: `DEFAULT_BROWSER_MODEL_ID =
"RASMUS/MiniCPM5-2B-ONNX"` in `web/src/stores/local-model.ts`, plus a bundled
desktop build behind `desktop-offline.ts` and `OfflineTutorSettings.tsx`.

Per the requirement, the **judgement model is configured separately from the
tutor model**. Add a `judgementModel` setting via `createLocalSetting`
(`web/src/keating/local-setting.ts`), surfaced in
`web/src/components/settings/ModelsProvidersTab.tsx`, defaulting to the installed
local model but independently selectable — because the model you want teaching
you is not necessarily the model you want grading you.

The offline backend implements the same `JudgementCaller` by constrained decoding
over the same closed vocabularies: Needle classifies where a label set is small
and fixed; the local model handles the rest. It returns the same shape, with its
own calibration table, and is permitted to abstain far more often.

**The backend-identity contract already exists — don't invent one.**
`validate_classifier` in `scripts/training/benchmark_response_grading.py` already
specifies a pluggable semantic scorer as a manifest, with the header comment
*"The classifier can be a model judge **or a separately trained activation
readout**"*:

```python
v4.fields(manifest, ('kind','id','revision','protocol','artifact_sha256',
                     'calibration_sha256','minimum_confidence'),
                    ('observer_manifest_sha256',))
v4.require(manifest['kind'] in ('model_api','activation_probe','fixture') ...)
```

That is exactly the `(backend, model, questionDigest)` key §1.1 needs, already
designed and already carrying `minimum_confidence` as the escalation threshold.
The TypeScript `JudgementCaller` should mirror these field names so the Python
benchmark and the TS runtime describe a backend identically; Jev is a new `kind`
alongside `model_api`, and the local model is another. `calibration_sha256`
is what makes "thresholds are never shared across backends" mechanically
checkable rather than a convention.

Its vocabularies are also the ready-made question set for §3.5 — `MOVES` (9
values), `NEEDS` (5), `FIT` (`appropriate | overhelp | underhelp | misdirected |
unknown`) are three Choices with `unknown` already serving as the abstain
sentinel.

---

## Part 2 — Full replacement of LLM-as-judge

All six sites move to Tier 2, including the benchmark.

### 2.1 The technique that makes this possible: evidence by selection

The judges need quote-grounded evidence and Jev cannot generate text. Resolve it
by inverting the flow — this is TypeSafe's documented value-extraction pattern:

1. **Code** enumerates candidates: transcript items, then sentences within the
   selected item. Recall-tuned, deduped, in document order.
2. **A Choice** selects the index, with an explicit no-match option.
3. **Code** extracts the span verbatim.

Three consequences worth stating plainly:

- **`anchored: false` stops existing.** In `trajectory-passes.ts` today a model
  invents a quote and `anchorQuote` fails to find it. A selected index always
  resolves. That whole failure class disappears.
- When candidates exceed the option budget, disclose progressively: Choice over
  items, then Choice over that item's sentences.
- `reason` text comes from **authored constants selected by classification**, and
  `support` is a Choice over the existing four values.

Budget: 11 dimensions × (1 Score + 1 abstain Noul + 1 evidence Choice + 1 support
Choice) = 44 questions, inside the 64 guardrail, in one request.

### 2.2 Site-by-site

| Site | Today | Becomes |
| --- | --- | --- |
| `scripts/training/benchmark_judge.py` | `gpt-5.6-sol`, 11 dims, JSON schema, quote evidence | 11 Scores + abstain Nouls + evidence Choices, one request |
| `createEpisodeJudge` (`shared/evolution/model-adapters.ts`; type in `contracts.ts`) | `ExperimentCompletion` → JSON `{judgments:[{criterionId, passed, rationale}]}` via `parseObject<T>` | **one Noul per criterion** — `CriterionJudgment.passed` is already boolean, so Noul is the exact primitive; rationale = authored constant + selected quote. Swap behind `createPiCompletionRunner(cwd)`; `parseObject`'s fence-stripping and 60,000-char guard become dead code |
| `web/src/keating/export-judge.ts` | `RUBRIC_PROMPT`, 5 metrics 0..1 as JSON | 5 Scores, composite-weighted in code by `SimulationWeights`; `parseJudgeScore` and its fenced-JSON cleanup deleted |
| `web/src/keating/trajectory-passes.ts` rubric pass | `PEDAGOGY_RUBRIC_KEYS` (6: diagnosis, accuracy, scaffolding, adaptation, learner-agency, verification), `ReviewRating = 1..5`, quotes, `extractPassJson` hunting balanced JSON | 6 Scores over 5 authored levels + evidence Choice; `ReviewSeverity 1..4` is a Choice; **critique/annotation passes stay on Tier 3** — they author prose, which is proposal-only per the review boundary |
| `src/core/policy-judgement.ts` | model prefers a policy | Choice over candidates (relative → Choice is correct) |
| `buildProfileFromFeedback`, `scoreAnswer` | `piCompleteJson`; word-overlap heuristic | Scores over the 8 `LearnerProfile` traits / the authored rubric |

The `extractPassJson` / `parseJudgeScore` / normalize-invalid-enum machinery all
exists to survive free-form model output. Typed answers make it dead code.

### 2.3 `export-judge.ts` is not a target, it is the exemplar

It is **already a two-tier cascade**, which changes step 3 from "design a
cascade" to "generalize one that works":

```ts
for (const [config, isFallback] of [[primary, false], ...(fallback ? [[fallback, true]] : [])])
export interface JudgeScorerConfig { model; thinkingLevel; maxTokens; temperature; timeoutMs; retries; }
export interface JudgeCheckpoint  { score; provider; model; thinkingLevel; fallback: boolean; scoredAt; }
```

Three properties to preserve verbatim and extend:

- **`checkpointKey` already hashes scorer identity** — sha256 over
  `{version:"keating-judge-v1", rubric, prompt, primary:{provider, model, thinkingLevel, maxTokens, temperature}}`.
  So adding a judgement tier **cannot poison existing cached scores**: a
  different scorer is a different key. Add the backend and `calibration_sha256`
  (§1.4) to that hash and the property extends for free.
- `TrainingExportJob` (`web/src/keating/training-export-jobs.ts`, IndexedDB
  `keating-training-export` v1) **already persists `primary` and `fallback`
  configs** per job, and `TrainingManifestSchema.judgeScoring.model {provider,
  id}` already records which judge scored a set. Provenance for a mixed-tier
  export is a field addition, not a new system.
- The tuple list generalizes from 2 to N. The retry cap (3) and per-config
  timeouts stay.

### 2.4 Two hazards that will bite

**The evolution loop will silently invalidate its own experiments.**
`compareEpisodeBenchmarks` (`shared/evolution/benchmark.ts`) rejects a promotion
with **`runtime_or_model_changed`** when baseline and candidate weren't produced
under the same runtime/model — and *"Fixed gate: candidates cannot tune
thresholds, metrics, weights, or missingness."* A cascade that routes to Jev on
one run and the local backend on the next is precisely a changed model, so a
non-deterministic tier makes paired comparison meaningless. **Mitigation: the
resolved backend is pinned for the duration of an experiment and recorded in
`EpisodeExecution.model` / `runtime`**, so the existing gate detects a mismatch
instead of being fooled by one. A judgement error must map to
`status: "judge-error"` with a stable `errorCode`; `meanScore` is already `null`
whenever `errorCount > 0`, so abstention degrades safely — but only if it is
reported as an error rather than a zero.

**The browser local tier cannot do what the hosted tier does.**
`createBrowserStreamFn()` flattens `Context` to a system prompt plus concatenated
user messages and **supports no tool calls**. That rules out an offline
*teaching* tier for now — but a *scorer* needs neither tools nor multi-turn
context, which is an independent argument for making scoring the first local
workload rather than the last.

---

## Part 3 — The five learner decision surfaces

Decomposed atomically, each honouring §0.2.

### 3.1 Is this learner ready, and for what?

- **Tier 0 gates** (hard, deterministic): prerequisite graph
  (`TopicDefinition.prerequisites`, `UiStudyPlanItem.dependsOn`), SRS due state,
  coverage. A failed gate ends it — no judgement is asked.
- **Tier 2, per surviving candidate**: one Noul — *"the learner's demonstrated
  work shows they can attempt this without being blocked by an unmet
  prerequisite"*. One per candidate, because readiness is **absolute** and every
  candidate may legitimately be low.
- **Then which**: a Choice over the candidates that cleared the floor, because
  choosing among them **is** relative.
- **Abstain**: nothing clears → keep teaching. Silence is a valid answer.
- Lands in `buildComingUp` / `compareUrgency` (`mobile/src/lib/learner-study.ts`)
  and `dueTopics` (`src/core/engagement.ts`).

### 3.2 How will they perform?

**Not a Score scalar** — the jaggedness doc forbids reconstructing a magnitude
from levels. Instead:

- One Noul per item: *"will answer correctly without a hint"*. State = the item,
  the learner's topic profile, and their recent work on that topic.
- **Code aggregates** into an expected score and interval. Jev never counts.
- The per-item `p̂` is the single most valuable number this project produces: it
  is the difficulty signal (§3.3), the readiness signal (§3.1), and the primary
  feature for boosting (§5).
- Calibration target: a reliability diagram against actual outcomes. Items
  binned by `p̂`; the fraction actually answered correctly should track the bin.
  This is the headline metric of the whole integration.
- Recorded as `source: "proxy"`, never `"observed"`.

### 3.3 How hard, and how long?

- **Difficulty**: a Score over ordered, concretely-described levels. Decisions use
  `modalLevel()` and threshold checks, never the interpolated mean, and never
  when `isBimodal()`. Fills the gap where only Bloom `level` exists today; gives
  `FlashCard.difficulty` a fitted value instead of a provenance guess.
- **Duration**: **never ask for seconds.** A Choice over named effort buckets —
  *single recall* / *two-step* / *multi-step with derivation* / *open
  construction* — and a code-owned table maps bucket → seconds, fitted on
  observed `perQuestionMs`. Feeds `UiQuestion.timeLimit` and `examTimeLimit`.
- **Due dates** follow the same rule: a Choice over *today / next session / this
  week / after the prerequisite*, then `srs.ts` arithmetic. Dates are text to
  Jev; they are ordered quantities to us.

### 3.4 Scoring answers and questions

- **Tier 0 first, always**: exact match for objective items,
  `math-verification.ts` for math. Unchanged, and it already abstains.
- **Tier 2 for open-ended**: a Score against the item's authored `rubric` (the
  field already exists on `UiQuestion` and `DiagnosticQuestion`). Verdict
  `correct/partial/incorrect` mapped in code from `modalLevel()`.
- **Evidence**: a Choice over the learner's own sentences, so the feedback quotes
  what they actually wrote.
- **Abstain → `grading: "pending"`.** That union member already exists on
  `LearnerQuestionCheck`; the UI already renders it. No new state.
- Replaces open-ended grading in `src/pi/hyper-teacher/tools/teaching.ts`,
  `web/src/keating/browser-tools/assessment.ts`, and
  `mobile/src/lib/quiz-grading.ts` (Levenshtein + keyword overlap) — behind the
  shared contract, so it lands once.

### 3.5 How well is the teacher teaching, and telling the learner

- Composite scoring over the 5 `SimulationWeights` dimensions, weights applied in
  code, distributions cached (§1.2).
- **Per-turn move analysis reuses the vocabulary that already exists.**
  `benchmark_response_grading.py`'s `PROTOCOL = 'contextual-tutor-response/v1'`
  defines the three judgements this surface needs, already named and already
  closed: what the tutor did (`MOVES`, 9 values), what the learner needed
  (`NEEDS`, 5), and whether they matched (`FIT`: `appropriate | overhelp |
  underhelp | misdirected | unknown`). Three Choices per turn, with `unknown`
  as the abstain sentinel and `minimum_confidence` as the escalation threshold.
  `overhelp` / `underhelp` are also directly actionable — they say which way to
  move, not merely that something was wrong.
- **Feeding back to the learner**: Jev selects *which* adjustment is warranted;
  the teacher model **authors** the words. Jev never writes to a learner. This is
  the no-templates rule and the review-proposal boundary held simultaneously.

### 3.6 Audio

Transcription (`web/src/keating/live-transcript.ts`, `speech-providers/stt.ts`)
already produces text. Judgement runs on the transcript exactly as on any other
state — this surface needs no new primitives, only a debounce and a rule that a
live judgement never triggers an irreversible action.

---

## Part 4 — Needle: memory, search, reranking

- **Extraction for memory**: Needle proposes candidate facts from a session;
  a Noul scores *"worth remembering"*; code writes into `learner-context.ts`
  (4,000-char cap, so selection pressure is real and a ranked cut is required).

  **`src/core/learner-memory.ts` constrains this hard, and correctly.** A fact's
  `evidence` must be an **exact substring of a real learner message** — the store
  rejects anything else with `learner_memory_evidence_not_in_learner_message` and
  hashes the quote into `provenance.quoteSha256`. So **Needle must select spans,
  not paraphrase them**: the same evidence-by-selection discipline as §2.1, now
  enforced by a store that will reject the alternative. Three further gifts from
  that file: the Noul value drops straight into the existing `confidence` field,
  clamped to the **0.65 `observed` ceiling** (a judgement never claims the 1.0
  reserved for `explicit`); the **128-fact cap** makes ranked eviction mandatory,
  which is what a calibrated score is for; and the five
  `LEARNER_MEMORY_CATEGORIES` are a ready-made Choice vocabulary.
- **Local search**: Needle embeddings (3072-dim) over sessions and artifacts.
  At the original planning baseline there was no vector store, embedding
  runtime or retrieval integration. Those paths are now implemented; see the
  current completion ledger for platform coverage. **Never threshold a raw cosine** — measured pairwise cosines sit
  in [0.9309, 0.9599] with sd 0.0071. Use corpus-mean-centered cosine or a
  z-score, and feed *margin to runner-up in sd units* into feature vectors.
- **Reranking**: Needle shortlists (Needle has no reranker), Jev reranks with
  comparable per-item Scores. This is also the context-rot mitigation from §0.2 —
  filter in code before judging. The first site is
  `web/src/courses/course-search.ts`, whose `scoreCandidate` is already a
  hand-weighted lexical ranker (`KIND_WEIGHT`, +8 prefix / +6 title / +4
  substring / +2 body): keep it as the recall stage and rerank its top-k, so the
  deterministic ordering stays the fallback when judgement is unavailable.

---

## Part 5 — Boosting

- **Features**: static item/learner features + per-item `p̂` (§3.2) + difficulty
  Scores + their confidences. Confidence is a *feature*, and an escalation
  trigger — never permission to act.
- **Labels are free**: correct/incorrect, lapse/no-lapse, returned/abandoned.
  Already persisted — and already *joined* (§7). `FeedbackEntry.referent`
  (`{sessionId, messageId, content, createdAt}`) pins a reaction to the exact
  assistant message it was about, which is a (prompt, completion, label) triple
  without any reconstruction. `CardReviewRecord` supplies `rating 0..3`,
  `isLapse`, `previousIntervalDays`, `easeAfter`.
- **The reward math is already written and already blends a judge.**
  `web/src/keating/reward.ts` holds `SIGNAL_WEIGHTS {explicit: .6, inferred:
  .15, quiz: .25}`, `JUDGE_BLEND = 0.35` (`applyJudgeScores` computes
  `reward = 0.65*reward + 0.35*composite`), `KTO_GOOD_THRESHOLD = 0.7` /
  `KTO_BAD_THRESHOLD = 0.35`, `PREFERENCE_MIN_GAP = 0.3`. `ExportJudge` is a
  one-line structural type — `(examples: RewardedTurn[]) => Promise<Array<JudgeScore | null>>`
  — so a judgement backend substitutes with **zero coupling**, and the existing
  `null` element already means "no score for this turn," i.e. abstention is
  already representable end to end.
- **Fit a shallow decision tree first.** If a depth-3 tree doesn't beat the
  current constants, boosting won't either, and the tree is inspectable.
- **Targets**: `LEARNER_PROGRESS_THRESHOLDS` coefficients, `estimateRetention`'s
  `masteryFactor = 0.5 + mastery * 1.5`, `compareUrgency`'s lexicographic sort.
- **Feedback-loop guard**: hold out a fixed fraction of items from model-driven
  ranking. Without it the model only ever sees items it already chose, and its
  own confidence becomes self-confirming.

### 5.1 Mechanism: CatBoost trains offline, the portable contract evaluates

Decided 2026-09-19, implementing this section now.

- **Training is offline Python.** `scripts/training/boosting_model.py` trains a
  deterministic CatBoost model (`Logloss`, `Plain` boosting, one thread, fixed
  seed, `nan_mode=Min`) on fit rows only and exports CatBoost's JSON. The trainer
  is never shipped.
- **The CatBoost Rust package is not used.** It wraps `libcatboostmodel` through
  `catboost-sys` and `bindgen`, needs a CMake build of the full library per
  platform, and reaches neither the web bundle nor the mobile app. This repo has
  no Rust and a rule that one shared decision module serves web, mobile and CLI.
  Training in Python and evaluating the JSON export keeps the real ensemble and
  the portability requirement at once. A native C/C++ binding has the same
  objection: it would leave the browser without an offline decision and force a
  second implementation somewhere.
- **`packages/learner-contracts/src/judgement/boosting-artifact.ts` is the
  contract.** It validates the export, normalizes feature indices to names, walks
  the oblivious trees exactly (float32 binarization, `nan_mode` NaN routing, the
  `-FLT_MAX` NaN border, `scale`/`bias`, sigmoid for Logloss) and **recomputes
  every metric from the stored rows**, so a trainer cannot report its own score.
- **The artifact embeds its evidence** and carries one fitted identity over rows,
  policy, framework and model, mirroring the calibration artifact's pinning rules
  (§1.1). Status is derived: `insufficient` below the declared row and group
  minimums, `failed-validation` when it loses to the incumbent constants or
  exceeds the declared ECE ceiling, `validated` only otherwise. Only `validated`
  may reorder work.
- **Parity is tested against CatBoost itself.**
  `packages/learner-contracts/test/judgement-boosting-artifact.test.ts` replays a
  frozen export and requires the portable walker to reproduce `predict_proba`
  exactly, and `scripts/training/test_boosting_model.py` holds the trainer to
  fit-row independence, determinism and logloss-only parameters. See
  [the boosting artifact format](../boosting-model.md).
- **Still missing: the dataset.** The feature and label paths already exist (§7),
  but turning them into rows requires an explicit feature selection and an
  independent group assignment. Until that exists, `LEARNER_PROGRESS_THRESHOLDS`,
  `estimateRetention`'s mastery factor and `compareUrgency` keep their current
  constants, and a fitted model stays a candidate compared with
  `compareAgainstBaseline` on held-out rows, never a silent replacement.

---

## Part 6 — Evolution loop and memory gating

- `runTeachingEvolution` (`shared/evolution/loop.ts`) gets a Noul: *"the recent
  record shows a teaching failure this loop could plausibly address"*. It gates
  **whether to spend a run**, and reorders the MAP-Elites frontier
  (`shared/pedagogy/map-elites.ts`) as a cheap surrogate.
- **It never gates promotion.** `PromotionDecision` keeps its predeclared
  one-sided paired sign test clustered by case family. Judgements pick what to
  try; only a real run promotes. (Rule 2, §0.1.)
- **Pin the backend per experiment** (§2.4). The gate's `runtime_or_model_changed`
  rejection exists precisely to catch a judge that changed mid-comparison; a
  router that silently falls back would trip it at best and evade it at worst.
  Record the resolved backend in `EpisodeExecution.model` / `runtime` and let the
  existing gate do its job. The other nine rejection reasons —
  `insufficient_independent_cases` (<6 paired families), `improvement_too_small`
  (meanDelta < 0.05), `case_family_regression` (any loss), `improvement_uncertain`
  (p > 0.05), `critical_criterion_failed`, and the evidence-completeness codes —
  are untouched by this work and must stay untouched.

---

## Part 7 — Telemetry: less missing than it looked

The training set is largely already persisted:

- `UiAction` `complete-quiz` carries `answers`, `score`, `partialCredits`,
  `timing`, `flaggedQuestionIds`, `timedOutQuestionIds`, `examTimedOut`,
  `idempotencyKey` — every feature a scorer wants.
- Mobile SQLite `learner_records` already has kinds `quiz_result`,
  `card_review`, `question_check`, `topic_evidence`.
- `LearnerQuizTiming.perQuestionMs` is collected by `QuizTimingTracker` and
  currently passed to the model **as prose** — `"[quick answer: within 25% of
  question time budget; timing only]"`. Nothing consumes it numerically.

**And the join already exists on web.** `computeSessionRewardedTurns`
(`web/src/keating/reward.ts`) already merges all four outcome channels —
messages, feedback, quiz results, inferred signals — into `RewardedTurn[]`,
tagging each with how it was joined
(`joinedBy: "messageId" | "timestampWindow" | "nextTurn" | "sessionId" | "topicWindow"`)
inside a `FEEDBACK_WINDOW_MS` of 10 minutes. Provenance for every training row is
already there. The training-set builder for §5 is not new work on web.

The real gaps are narrower than they looked: **CLI has no equivalent event log**
(JSON state only), **mobile's SQLite `learner_records` is not joined to the same
shape**, and `perQuestionMs` is still consumed as prose rather than as a number.
All three are prerequisites for §5 only — not for §2 or §3.

**One small telemetry change unlocks the calibration work.**
`EvaluationEngine` in `src/observability/types.ts` is
`"deterministic" | "heuristic" | "llm" | "learner-feedback"`. A typed/learned
scorer is none of those, so every tier would report as `"llm"` and the tiers
would be inseparable in Arize exactly where §9 needs to compare them. Add a
fifth value (`"typed-judgement"`), bump `EVALUATION_OBSERVATION_VERSION`, and
emit the backend and `calibration_sha256` as span attributes on the existing
`"openinference.span.kind": "EVALUATOR"` spans.

---

## Part 8 — Phasing

Built end to end, but in an order where each step is independently verifiable.

1. **Contract + router + both backends.** `packages/learner-contracts/src/judgement/`,
   the `JudgementCaller` interface, `src/judgement/router.ts`, the Jev transport,
   the offline backend, the `judgementModel` setting. Unit-testable with a fake
   caller and no network.
2. **Working application paths and the five application judge sites**, in the
   table order of §2.2: real account authorization, independent settings,
   actual consumer calls, provenance, persistence, and visible failure states.
3. **Grading (§3.4)** — the shared contract, so CLI/web/mobile land together.
4. **Difficulty, duration, readiness, prediction (§3.1–3.3).**
5. **Needle: memory, search, rerank (§4).**
6. **CLI event log + mobile/CLI parity with `computeSessionRewardedTurns` (§7).**
7. **Shallow tree, then boosting (§5, §5.1).** In progress. The artifact
   contract, exact CatBoost evaluation, offline trainer, CLI fitter, pinned loader
   and parity fixtures exist (§5.1). Still required: the dataset built from the
   actual feature/outcome paths of step 6, an independent group assignment, and a
   held-out comparison against the incumbent constants before anything is
   replaced. Unfitted models and unmeasured calibration stay explicit.
8. **Benchmark comparison and performance. Withdrawn 2026-09-19 at the user's
   direction.** `benchmark_judge.py` via evidence-by-selection, side by side with
   `gpt-5.6-sol` over `teaching-v1..v4`: the agreement, cost, latency, calibration
   and learner-evidence requirements are retained on paper but are not being
   executed. Nothing in the cascade depends on them; a future decision to resume
   must start from the retained requirements rather than from an assumption that
   agreement was ever established.

---

## Part 9 — Verification

**Per-step**
- Web: **`cd web && bun run panda` first** — it is the `pretypecheck`/`pretest`
  hook and both fail without it — then `bunx tsc --noEmit` and `bun test` (bun
  runner, not vitest). Root: `bun test`. Python:
  `scripts/training/test_benchmark_judge.py`,
  `test_benchmark_harness_v3.test.ts`.
- Boosting specifically: root `bun test test/judgement-boosting-artifact.test.ts`,
  package `bun test ./test/judgement-boosting-artifact.test.ts` in
  `packages/learner-contracts`, and the CatBoost trainer suites through the
  `keating:test-python` task (it pins `catboost==1.2.10`). Regenerating the frozen
  fixture is `uv run --no-project --python 3.13 --with catboost==1.2.10 --with
  numpy python scripts/training/boosting_fixture.py test/fixtures/boosting`;
  a real fit is `bun scripts/training/fit-boosting-model.ts dataset.json OUTPUT`.
  The fixture reproduces `predict_proba` exactly, which is what makes the
  portable walker's float32 and NaN-border semantics measured rather than assumed.
- Existing tests that must keep passing, and that describe the contracts being
  changed: `web/src/test/export-judge.test.ts`,
  `web/src/test/export-judge-resume.test.ts` (checkpoint identity),
  `test/teaching-evolution.test.ts`, `test/policy-judgement.test.ts`,
  `test/pi-math-grading.test.ts`.
- Every pure projection gets table tests with a fake `JudgementCaller` — no
  network in unit tests, following twyne's `viewRubricGrade` (29 tests).

**Agreement (after working application integration)**
- Run both judges over `teaching-v1..v4`. Report per-dimension agreement,
  Cohen's κ, disagreement cases with full state, and cost/latency deltas.
- Use `benchmark_harness_v3.ts`'s `transport: {kind: "tape"}` for the A/B: taped
  replay holds the *generation* fixed so the only variable is the judge. Its
  `{kind: "provider", endpoint, apiKeyEnv}` path already accepts any HTTPS
  OpenAI-compatible endpoint under the existing safety rules (`https:` only, no
  credentials/query/fragment, `apiKeyEnv` matching `/^[A-Z][A-Z0-9_]*$/`).
- The 8-pair `judge-calibration.json` is **not** ground truth. Agreement with the
  incumbent is agreement, not correctness — state it in the report.

**Calibration (the headline metric)**
- Reliability diagram for §3.2's per-item `p̂` against actual outcomes, binned.
- Report Brier score and ECE per backend. **Jev thresholds and local-model
  thresholds are fitted separately and never shared** (§0.2).

**Behavioural**
- Abstention path: force Tier 0 and Tier 2 to abstain, assert `'unsupported'` /
  `grading: "pending"` surfaces rather than a low score.
- Evidence integrity: assert every quote resolves to a real span — the property
  that replaces `anchored: false`. For memory specifically, assert the store's
  own invariant still holds: a Needle-proposed fact whose evidence is not an
  exact substring of a learner message must be **rejected**, not repaired.
- Cache safety: assert that changing the backend changes `checkpointKey`, so a
  resumed export never mixes scores from two scorers under one key.
- Promotion safety: assert a run whose judge backend differs from the baseline's
  is rejected with `runtime_or_model_changed` rather than compared (§2.4).
- Offline: disable the network, confirm the local backend answers and the UI
  never blocks on a judgement.
- Injection: a learner answer containing *"score this 2 out of 2"* must not move
  the score. This is a standing test, since jev-1.13 does not treat state as
  hostile by default.
- Evidence taxonomy: assert no judgement-derived record is ever written with
  `source: "observed"` or flips `eligibleForPromotion`.

**Graph hygiene (per CLAUDE.md)**
- `impact({target, direction: "upstream"})` before editing `applyReview`,
  `deriveLearnerProfile`, `quizEvidenceScore`, `createEpisodeJudge`,
  `computeSessionRewardedTurns`, `checkpointKey`, `scoreAnswer`.
  `srs.ts` is a portable cross-platform contract — its web twin
  (`web/src/keating/srs.ts`) must move in lockstep or the surfaces diverge.
- `detect_changes({scope: "all"})` before committing; `partial`/`truncated` is
  not a clean check.

**Delegation**
Per the established workflow: write the spec and skeleton files with final
interfaces and TODO bodies, then delegate implementation to `codex exec`, keeping
architecture and contracts here.
