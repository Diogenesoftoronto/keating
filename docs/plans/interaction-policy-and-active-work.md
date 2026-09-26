# Interaction policy and active work

> Drafted 2026-09-23. Direction agreed with the user: judge observable
> *features of the turn and material*, map features to OpenUI component
> families in code, let an interactive draft compete with a prose draft, and
> give the tutor and judge a persistent, record-derived view of the active
> lesson plan that the sliding window never evicts. Every new judgment is
> uncalibrated; fixtures are authored proxies, not human-learning evidence.

## Context

The draft gate (`web/src/keating/judgement/draft-gate.ts`,
`packages/learner-contracts/src/judgement/teaching-drafts.ts`) plans a turn with
17 policy decisions plus reasoning/depth questions, drafts privately, checks,
and selects. Three gaps make OpenUI underused and unmeasurable:

1. **One narrow trigger.** The only interaction directive is
   `teaching-policy.ts:55`: a focused Question, only when the turn is a learning
   task that is not an explanation, direct answer, or practice request. No path
   ever suggests a Simulation, ConceptMap, LanguagePractice, Fieldwork, etc.
   Omission of a useful component is never a failure and never recorded.
2. **No linkage between plans and evidence.** `UiStudyPlanItem.outcomes` is
   `string[]` without ids (`packages/learner-contracts/src/ui.ts:123`).
   `QuizResultRecord` / `QuestionCheckRecord` are keyed by free-text `topic`
   (`web/src/keating/storage.ts:275`, `:369`). "Have we tested this plan item?"
   cannot be answered from records.
3. **Evidence is persistent but unbounded; the plan is absent.**
   `slideConversationWindow` (`teaching-drafts.ts:175`) drops only conversation,
   but `draft-evidence.ts` serializes *every* quiz result and question check,
   so evidence growth crowds out conversation. No active plan reaches the judge
   or the tutor.

Rejected alternative: one "would component X help?" question per component
family. Judges answer benefit questions affirmatively (overuse), and the
question count scales with the library. Features of the material are
falsifiable, shared across families, and keep the mapping testable in code.

## Principles

- **The judge answers propositions about the turn, never "would X help".**
  Same `decision()` shape and boundary text as `TEACHING_POLICY_DECISIONS`.
- **Code owns the feature → component mapping.** Tunable and unit-testable
  without a judge.
- **Facts come from records; judgment only where needed.** Presented /
  attempted / graded / pending are deterministic joins. Jev answers only
  semantic questions (is the item demonstrated, is there a prerequisite gap).
- **AI proposes, the learner accepts.** Plan-progress judgments produce
  directives that *offer* to advance, expand, or replan. Nothing marks a plan
  item done or rewrites a plan on the learner's behalf (same invariant as the
  `/review` trajectory surface).
- **No UiDocument contract change in v1.** Validators use strict key sets
  (`hasOnlyKeys`, `PLAN_ITEM_KEYS`, `QUESTION_KEYS`), and `UiStudyPlanItem` is
  consumed by web, mobile, TUI and CLI. A new document field would make older
  clients reject web-authored documents. Linkage lives in web storage records
  instead.
- **Unknown stays unknown.** No assisted/unaided inference in v1; legacy
  records without a source link are excluded from item evidence, never matched
  by topic string.

## Phase 1 — Active-work ledger (pure projection + storage links)

### 1a. Link assessment records to their document node

Add an optional storage-level field (not a UI contract field):

```ts
// web/src/keating/storage.ts
export interface OpenUiSourceRef { documentId: string; revision: number; nodeId: string }
// on QuizResultRecord and QuestionCheckRecord:
source?: OpenUiSourceRef;
```

Populate it wherever an OpenUI quiz/question submission is materialized into
these records (start from `web/src/keating/integration/ui-actions.ts`,
`web/src/components/QuizRenderer.tsx`, and the path exercised by
`web/src/test/openui-learner-record-materialization.test.ts`). Records created
outside OpenUI keep `source` undefined.

### 1b. Presentation log

New IndexedDB store in `web/src/keating/storage.ts`, `openuiPresentations`:

```ts
export interface OpenUiPresentationRecord {
  id: string;               // `${documentId}@${revision}:${nodeId}`, idempotent
  documentId: string;
  revision: number;
  nodeId: string;
  component: UiDocumentNode["type"];
  sessionId?: string;
  presentedAt: number;
  /** Focus captured from the same ActiveWork projection that fed the turn. */
  planRef: { planDocumentId: string; itemId: string } | null;
}
```

Write one record per interactive node when an *approved* reply's OpenUI
document is materialized (the canonical materialization in
`web/src/hooks/useKeatingAgent.tsx` near the existing document storage path).
`planRef` is the focus item at release time — the tutor does not author the
link, so no contract or prompt change is needed for linkage.

### 1c. `projectActiveWork` (pure, dependency-free)

New file `packages/learner-contracts/src/judgement/active-work.ts`, exported
from `judgement/index.ts`. No DOM, storage, or model imports.

```ts
export interface ActiveWorkItemEvidence {
  readonly presented: number;
  readonly attempted: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly pendingGrade: number;
  readonly lastAttemptAt: number | null;
  /** v1 has no assistance signal. Never inferred. */
  readonly independence: "unknown";
}
export interface ActiveWork {
  readonly plan: {
    readonly documentId: string; readonly revision: number; readonly title: string;
    readonly outline: readonly { readonly id: string; readonly title: string; readonly status: "not_started" | "in_progress" | "done"; readonly depth: number }[];
  } | null;
  readonly focus: {
    readonly itemId: string; readonly title: string; readonly detail?: string;
    readonly outcomes: readonly string[];
    readonly dependsOn: readonly { readonly id: string; readonly title: string; readonly status: string; readonly evidence: ActiveWorkItemEvidence }[];
    readonly evidence: ActiveWorkItemEvidence;
  } | null;
  readonly openInteractions: readonly {
    readonly documentId: string; readonly nodeId: string; readonly component: string;
    readonly presentedAt: number; readonly itemId: string | null;
    readonly state: "awaiting" | "submitted" | "pending-grade" | "graded";
  }[];
  readonly truncated: boolean;
}
export interface ActiveWorkInput {
  readonly plans: readonly { readonly document: UiDocument; readonly journal: UiActionJournal; readonly lastTouchedAt: number; readonly sessionId?: string }[];
  readonly presentations: readonly OpenUiPresentationLike[];
  readonly attempts: readonly ActiveWorkAttempt[]; // normalized from quiz/question records that have `source`
  readonly sessionId?: string;
  readonly now: number;
}
export function projectActiveWork(input: ActiveWorkInput): ActiveWork;
```

Rules (all deterministic, all unit-tested):

- **Active plan:** the study-plan document most recently presented or acted on
  in the current session, lifecycle `ready | submitted | completed`, validated
  with `validateUiDocument` / `validateUiActionJournal`. None in this session →
  `plan: null`. No cross-session guessing in v1.
- **Item status:** from the journal's completed `complete-plan-item` receipts
  over the authored `status`, mirroring `coming-up-readiness.ts`. Reuse or
  extract its plan-loading/validation helpers rather than duplicating them.
- **Focus:** first `in_progress` item in document order; else first
  `not_started` item whose `dependsOn` are all done; else `null`.
- **Evidence join:** attempts join to presentations on
  `documentId + revision + nodeId`, then to `planRef.itemId`. Unlinked attempts
  contribute nothing to item evidence.
- **Hard caps (deterministic truncation, no summarization):** outline ≤ 40
  entries, titles ≤ 120 chars; focus detail ≤ 2000 chars; ≤ 8 outcomes;
  ≤ 8 dependencies; ≤ 5 open interactions (most recent). Set `truncated`.

Tests: `packages/learner-contracts/test/active-work.test.ts` — focus
selection, dependency gating, nested items, journal-over-authored status,
unlinked attempts excluded, caps, invalid documents ignored, empty inputs.

## Phase 2 — Active work in the turn (tutor and judge share it)

- Add `readonly activeWork?: ActiveWork` to `TeachingPolicyTurn`
  (`teaching-policy-types.ts`).
- Copy it **field by field** in `teachingPolicyState` (`teaching-policy.ts`)
  and in `projectedTurn` (`draft-gate.ts:97`). Both are explicit whitelists;
  keep them that way.
- `slideConversationWindow` must not touch `activeWork`. Add a test that
  compaction to the target budget preserves it byte-for-byte.
- **Evidence bounding** (`web/src/keating/judgement/draft-evidence.ts`): when a
  focus exists, serialize records linked to the focus item plus the 10 most
  recent others; otherwise the 10 most recent. Cap free-text answer fields at
  1000 chars. `pendingSubmissions` stays complete (grading needs every pending
  id). This is a behavior change; note it in the commit.
- The host builds `ActiveWork` inside the existing `evidence` callback
  (`useKeatingAgent.tsx:1499`) from storage, and returns it on the evidence
  object.
- **Tutor view:** append a compact "Active work" block to the private
  generation system prompt in `draft-gate.ts` `generate` (with the other
  layers), rendered from the same object so tutor and judge agree. Label it as
  records, not instructions.

## Phase 3 — Interaction-feature decisions and the affordance map

### 3a. Feature catalog

Add `TEACHING_INTERACTION_FEATURES` to `teaching-policy-catalog.ts` using the
existing `decision()` helper (noul, boundary text, protocol source). Each
proposition reads `turn.learnerMessage`, the relevant part of
`turn.conversation`, and `turn.activeWork.focus`:

| id | proposition (draft wording; refine with fixtures) |
|---|---|
| `variable_relationship` | Does the material involve a relationship where changing one quantity or condition changes an outcome the learner could observe (a formula, a physical system, a parameterized model)? |
| `ordered_procedure` | Does the material involve a sequence of steps whose order matters? |
| `discrete_recall` | Does the material include discrete facts, terms, or definitions the learner will need to retrieve from memory? |
| `structure_relations` | Is understanding the material mainly about how several concepts relate (part-of, causes, depends-on, contrasts-with)? |
| `category_distinction` | Does the material hinge on telling apart similar categories, cases, or examples? |
| `prediction_opportunity` | Is there an outcome the learner could predict before being told, where a wrong prediction would expose a specific misconception? |
| `executable_code` | Does the material involve code the learner could write or run to observe its behaviour? |
| `performed_skill` | Is the skill performed aloud or physically (speaking, pronunciation, music, a physical technique)? |
| `language_learning` | Is the learner producing or comprehending a natural language they are learning? |
| `visual_reference` | Would the material be hard to convey precisely without an image (anatomy, geography, a diagram, an artwork)? |
| `extended_production` | Does the learner's goal require producing an extended piece of work (essay, proof, project, report)? |
| `outside_observation` | Does the question require observing or collecting information outside the chat? |
| `untested_coverage` | Do `turn.conversation` or `turn.activeWork` show material taught in this session that the learner has not yet been asked to recall or apply? |

Append these to the planning request in `runTeachingDrafts` alongside
`reasoningQuestions` and `draft_standard`. Existing batching handles the
budget; record the added latency in the receipt (`judgementMs` already exists
per phase — add a planning duration if absent).

### 3b. Affordance map (pure code)

New file `packages/learner-contracts/src/judgement/interaction-affordances.ts`:

```ts
export type InteractionFamily = "question" | "retrieval" | "manipulable" | "workspace" | "away" | "perform";
export interface InteractionRecommendation {
  readonly action: "none" | "create" | "continue" | "grade-first";
  readonly families: readonly { readonly family: InteractionFamily; readonly components: readonly string[]; readonly features: readonly string[] }[];
  readonly continueInteraction?: { readonly documentId: string; readonly nodeId: string; readonly component: string };
}
export function recommendInteraction(
  features: Readonly<Record<string, boolean | null>>,
  decisions: Readonly<Record<string, boolean | null>>,
  activeWork: ActiveWork | undefined,
): InteractionRecommendation;
```

Initial table (families match `web/src/keating/openui/library.tsx:741`):

| features (true) | family | components |
|---|---|---|
| `prediction_opportunity` or `category_distinction` or `ordered_procedure` | question | Question (ordering kind for `ordered_procedure`) |
| `discrete_recall` and `untested_coverage` | retrieval | Quiz, Flashcards |
| `language_learning` | retrieval | LanguagePractice |
| `variable_relationship` | manipulable | Simulation |
| `executable_code` | manipulable | CodingChallenge |
| `performed_skill` | perform | AudioResponse, VideoResponse, MusicLab |
| `structure_relations` | workspace | ConceptMap |
| `visual_reference` | workspace | LearningImage |
| `extended_production` | away | Assignment, Draft |
| `outside_observation` | away | Fieldwork |

Modifiers, in precedence order:

1. `pendingSubmissions` non-empty or `focus.evidence.pendingGrade > 0` →
   `grade-first` (existing grade tools are already gated on this).
2. An `awaiting` open interaction on the focus item whose component is in a
   recommended family → `continue` with that interaction, not a new one.
3. `learner_stuck` → drop `away` and Exam-mode retrieval; keep low-burden
   families only.
4. `direct_answer_requested` or `explanation_requested` → keep the
   recommendation, but its directive says *answer/explain first, then offer*.
5. `practice_requested` → keep the existing directive; restrict to retrieval.
6. `null` features count as false. No true feature → `none`.

Replace the single line-55 directive with directives generated from the
recommendation (component names, the purpose from the feature, "at most one
activity; prose is acceptable when it serves the learner better"). Keep the
"stop and wait, don't answer it yourself" wording for question/retrieval.

Tests: table-driven `interaction-affordances.test.ts` covering each row and
each modifier, including overuse traps (bounded factual question, all features
false → `none`).

## Phase 4 — Interactive vs prose drafts compete

In `runTeachingDrafts`, when `recommendation.action` is `create` or
`continue` **and** `standard !== "concise"`:

- Add `readonly variant: "interactive" | "prose" | "default"` to
  `TeachingDraftAttempt`.
- Track which variants still lack an approved candidate. The next generation
  targets a missing variant; a revision keeps the variant of the draft it
  repairs. Stop when both variants have an approved candidate or attempts run
  out (existing `maxAttempts`, `targetCandidates = 2`).
- The interactive variant's system prompt includes the recommendation
  directive as a requirement; the prose variant's includes "Answer without an
  OpenUI activity this turn."
- **Blind selection:** the selector question and state never mention
  variants. Randomize which variant is generated first via an injectable
  `random?: () => number` option (default `Math.random`), so `draft_1` is not
  always the interactive one.
- When `standard === "concise"` or `action === "none"`: no pairing; the
  recommendation (if any) is a soft directive, `variant: "default"`.
- Receipt additions (ids and booleans only, never text):
  `interactionFeatures`, `recommendation` (action, families, components),
  `variants` per attempt, `selectedVariant`.

Tests in `teaching-drafts.test.ts`: pairing happens only under the conditions
above; revision keeps its variant; selection text contains no variant label;
receipts carry the new fields; the concise path generates once.

## Phase 5 — Plan-progress judgments (event-triggered)

Triggers, computed by the host from `ActiveWork` and passed as
`turn.activeWork` plus a boolean `planReview` option to `runTeachingDrafts`:

- a submission linked to the focus item was graded since the last plan review;
- new decision `progression_requested` (add to `TEACHING_POLICY_DECISIONS`):
  "Does `turn.learnerMessage` ask to move on, skip ahead, go back, or go deeper
  on the current part of the plan?";
- ≥ 6 learner turns on the same focus item with no new graded attempt;
- `project_goal_requested` is true while a plan is active.

When triggered, append to the same planning request (no extra round in v1):

| id | proposition |
|---|---|
| `focus_demonstrated` | Do the graded attempts in `turn.activeWork.focus.evidence` and the conversation show correct answers on the focus item's outcomes, without the answer having been given first? |
| `prerequisite_gap` | Does the learner's latest attempt show a gap in an item listed in `turn.activeWork.focus.dependsOn`, or in material the plan does not cover? |
| `focus_underspecified` | Is the focus item too general to choose a concrete next activity (no specific outcome, example, or scope)? |
| `goal_diverged` | Does the learner's current request pursue a goal outside the active plan's items? |

Projection to `planAction`, first match wins: `goal_diverged` →
`propose-new-plan`; `prerequisite_gap` → `insert-prerequisite`;
`focus_underspecified` → `expand-item`; `focus_demonstrated` →
`suggest-advance`; otherwise `continue`.

Directives are proposals only:

- `suggest-advance`: summarize the evidence for the current item and offer to
  mark it done and move to the next item; do not mark it.
- `insert-prerequisite` / `expand-item` / `propose-new-plan`: describe the
  proposed change and ask; if the learner accepts on a later turn, author a new
  StudyPlan revision then. **Open question for implementation:** confirm
  whether an accept path for plan revisions already exists; if not, v1 stays
  at "describe and ask".

Record `planReview` trigger and `planAction` in the receipt.

## Phase 6 — Evaluation

- **Fixtures:** `packages/learner-contracts/test/fixtures/interaction-features/`
  as `TeachingPolicyCase` JSON with `expectedDecisions` per feature id, split
  development/holdout. At least 3 positive and 3 negative cases per feature,
  including overuse traps. Same for the phase-5 plan questions.
- **Benchmark:** extend `scripts/prompt-adherence/benchmark.ts` to report
  per-feature precision/recall and the recommendation `none` rate on
  fixtures that should need no interaction.
- **Online diagnostics** (ids and counts only, via the existing draft-status
  diagnostics in `web/src/keating/judgement/draft-status.ts` /
  `web/src/lib/diagnostics.ts`): recommendation rate by family,
  interactive-variant selection rate, valid-render rate, and participation
  rate (presentation → linked attempt join from the ledger).
- Label everything as proxy/uncalibrated. None of it measures learning.

## Non-goals (v1)

Mobile and TUI parity (mobile deliberately duplicates web logic; port after
web stabilizes). Outcome-level ids. Assisted vs unaided detection.
Cross-session plan selection. Model-written summaries or compaction of the
active work. Auto-marking plan items or auto-replacing plans.

## Blast radius

GitNexus `impact` returned `UNKNOWN` for `projectTeachingPolicyDecision`,
`teachingPolicyState`, `runTeachingDrafts` and `teachingDraftEvidence` (index
stale). Text search callers:

- `projectTeachingPolicyDecision`, `teachingPolicyState`, `runTeachingDrafts`:
  `scripts/prompt-adherence/{benchmark,providers}.ts`,
  `web/src/keating/judgement/draft-gate.ts`, learner-contracts tests.
- `teachingDraftEvidence`: `web/src/hooks/useKeatingAgent.tsx`.
- `QuizResultRecord` (optional field only): `src/core/types.ts`,
  `src/core/session-reward.ts`, `web/src/keating/{reward,export,session-start-hooks,storage}.ts`,
  `web/src/keating/judgement/study-estimates.ts`, `web/src/pages/KeatingBench.tsx`,
  `nodepod-boot-files.ts`.
- `UiStudyPlanItem` is **not** modified.

## Implementation constraints

- The working tree has substantial uncommitted work from other sessions. Do
  not revert, reformat, or overwrite unrelated changes; touch only what each
  phase needs.
- Run `node .gitnexus/run.cjs impact "<symbol>" --direction upstream --repo .`
  before editing each function; treat `UNKNOWN` as unresolved and confirm with
  text search.
- Verify each phase:
  - `cd packages/learner-contracts && bun run typecheck && bun test`
  - `cd web && bunx tsc --noEmit && bun test` (bun runner, not vitest)
  - root `bun test` when `scripts/` changes
- Run `node .gitnexus/run.cjs detect-changes --scope all --repo .` before any
  commit. Do not commit unless asked.
- Order: 1 → 2 → 3 → 4 → 5; phase-6 fixtures for features land with phase 3.
