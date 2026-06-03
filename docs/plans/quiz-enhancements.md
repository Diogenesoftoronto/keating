# Quiz Tool Enhancement Plan

> Status: **In Progress** — Low-effort items implemented  
> Last updated: 2026-05-31

## Current State

The `QuizRenderer` supports seven question types (`multiple_choice`, `short_answer`, `true_false`, `fill_in`, `transfer`, `slider`, `dropdown`, `multi_select`) with step-through navigation, per-question timing, confidence calibration, partial-credit scoring, bookmarking, audio read-aloud, and weighted scoring. The browser `quiz` tool generates deterministic questions from a `TopicDefinition` and embeds them via `<keating-quiz>` tags.

## Proposed Enhancements

### 1. Confidence Calibration

**What:** After answering (or alongside), ask the learner: "How sure? 50–100%."

**Why:** Builds metacognition. Overconfident-and-wrong is a high-signal learning moment.

**UI:** Companion slider under each question, hidden until an answer is selected.

**Data model:**

```ts
interface QuizQuestion {
  // ...existing fields
  confidence?: number; // 50-100
}
```

**Report:** Include `confidenceAccuracyCorrelation` in the `onSubmit` payload so the agent can comment on calibration (e.g. "You were 90% confident on 3 questions you got wrong — let's look at why").

**Implementation notes:**
- Add a second `<input type="range">` labeled "Confidence".
- Compute correlation with `scoreQuestion()` results.
- No backend change needed — payload is purely frontend.

---

### 2. Partial-Credit Scoring for Open-Ended Answers

**What:** Replace exact string matching with normalized Levenshtein distance for `short_answer`, `fill_in`, and `transfer` questions.

**Why:** "Photosyntheis" shouldn't be a zero. Transfer answers have infinite valid phrasings.

**Algorithm:**

```ts
function partialCredit(answer: string, correct: string): number {
  const a = answer.trim().toLowerCase();
  const c = correct.trim().toLowerCase();
  if (a === c) return 1;
  const dist = levenshtein(a, c);
  const len = Math.max(a.length, c.length);
  return Math.max(0, 1 - dist / len);
}

function keywordCredit(answer: string, correct: string): number {
  const aTokens = tokenize(answer);
  const cTokens = tokenize(correct);
  const overlap = aTokens.filter(t => cTokens.includes(t)).length;
  return Math.min(1, overlap / cTokens.length);
}
```

**Thresholds:**
- `> 0.9` → full credit
- `0.7–0.9` → partial (0.5)
- `< 0.7` → wrong

**UI:** On reveal, show the numeric score (e.g. "0.8 / 1") alongside the correct answer.

---

### 3. Multi-Select (Checkbox Groups)

**What:** Questions with more than one correct answer from a list.

**Why:** Some concepts genuinely require selecting multiple valid options (e.g. "Which are valid closure requirements?").

**Data model:**

```ts
type QuestionType = "multiple_choice" | "short_answer" | ... | "multi_select";

interface QuizQuestion {
  // ...existing fields
  correctAnswers?: string[]; // for multi_select
}
```

**Scoring:**
- `correctSelected / totalCorrect` minus `incorrectSelected / totalIncorrect`
- Floored at 0

**UI:** Checkboxes (not radio buttons). Selected items get the primary border style.

---

### 4. Post-Quiz Remediation Dashboard

**What:** After submission, show a mini bar chart of missed Bloom's taxonomy levels.

**Why:** Gives the learner (and agent) actionable next steps instead of just a score.

**UI:**

```
Recall         ████████░░  2/3 missed
Comprehension  ██████████  0/3 missed
Application    ██████░░░░  1/2 missed
Transfer       ███░░░░░░░  2/2 missed  ← Click to review
```

**Click behavior:** Dispatch `keating:quiz-remediation-requested` with `{ level, topic }`. The agent picks this up and generates targeted material.

**Persistence:** None needed. Purely event-driven.

---

### 5. Question Bookmarking

**What:** Flag questions during the quiz for later review.

**Why:** Lightweight spaced-repetition without building a full SRS.

**Data model:**

```ts
interface FlaggedQuestion {
  quizSlug: string;
  questionId: string;
  topic: string;
  flaggedAt: number;
}
```

**Storage:** `localStorage` under `keating:flagged-questions`.

**UI:** Small flag icon per question card. Toggle on/off. Flagged questions get a yellow border.

**Future integration:** A "Review flagged" button in the chat sidebar that generates a quiz from bookmarked questions only.

---

### 6. Confidence-Weighted Scoring

**What:** Weight errors by confidence. A 90%-confident wrong answer costs more than a 50%-confident guess.

**Why:** Surfaces *active misconceptions* vs. *mere uncertainty*.

**Formula:**

```ts
function weightedScore(q: QuizQuestion, correct: boolean): number {
  const base = correct ? 1 : 0;
  const confidence = (q.confidence ?? 50) / 100;
  return correct ? base * confidence : base - confidence;
}
```

**Report:** Report `weightedScore` alongside raw score. The agent can prioritize reviewing high-confidence errors.

---

### 7. Adaptive Branching

**What:** Dynamically insert or skip questions based on performance.

**Why:** Don't waste time drilling recall if the learner already knows it.

**Rules:**
- If recall `Q1` is **correct** → skip `Q2` (second recall), jump to comprehension.
- If recall `Q1` is **wrong** → insert a second recall `Q2'` before moving up.
- Same logic applied at each Bloom's level.

**Data model:**

```ts
interface Quiz {
  // ...existing fields
  adaptiveRules?: AdaptiveRule[];
}

interface AdaptiveRule {
  level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
  threshold: number; // fraction correct to advance
  fallbackQuestion?: QuizQuestion; // extra question if below threshold
}
```

**UI:** No change. The stepper simply shows the adapted sequence.

---

### 8. Analogy / Translation Mode Toggle

**What:** Re-frame the current question into a different modality on demand.

**Why:** Helps unstuck learners on transfer questions.

**Modes:**
- "Explain like I'm 10"
- "Frame as a debugging scenario"
- "Use a cooking analogy"
- "Draw a diagram" (textual description)

**UI:** Small button group under the question: `[Default] [ELI5] [Debug] [Cooking]`.

**Implementation:** Dispatch `keating:question-reframe` with `{ questionId, mode }`. The agent rewrites the question text in the next message. Alternatively, pre-generate reframes in the quiz payload.

---

### 9. Audio Question Text

**What:** Speaker icon reads the question aloud via Web Speech API.

**Why:** Accessibility + language learners.

**UI:** `<Volume2 size={14}>` icon next to the question text. Click to speak.

**Code:**

```ts
function speak(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}
```

**Notes:**
- No backend change.
- Should respect the existing speech toggle in the chat header.
- Pause speech when the user submits or navigates.

---

### 10. Session-Average Benchmark Comparison

**What:** After submission, show how the learner's score compares to the session average for that topic.

**Why:** Social proof and goal-setting.

**Data source:** Aggregate from `keatingStorage` across all sessions on the same topic slug.

**UI:**

```
Your score: 7/10  ████████░░
Session avg: 6/10  ██████░░░░
Top quartile: 9/10 █████████░
```

**Privacy:** Only show if `n >= 5` sessions exist. Don't show other users' raw scores.

---

## Implementation Priority

| Priority | Enhancement | Effort | Pedagogical Impact | Status |
|----------|-------------|--------|-------------------|--------|
| P0 | Confidence calibration | Low | High | ✅ Implemented |
| P0 | Partial-credit scoring | Low | High | ✅ Implemented |
| P1 | Multi-select | Low | Medium | ✅ Implemented |
| P1 | Audio question text | Very low | High (accessibility) | ✅ Implemented |
| P1 | Question bookmarking | Low | Medium | ✅ Implemented |
| P1 | Confidence-weighted scoring | Low | Medium | ✅ Implemented |
| P2 | Remediation dashboard | Medium | High | ✅ Implemented |
| P2 | Adaptive branching | Medium | High | ✅ Implemented |
| P3 | Analogy/translation toggle | Medium | Medium | ✅ Implemented |
| P3 | Benchmark comparison | Medium | Low | ✅ Implemented |

## Data Model Changes

Minimal additions to `QuizQuestion`:

```ts
export interface QuizQuestion {
  id: string;
  type: QuestionType;
  level: "recall" | "comprehension" | "application" | "analysis" | "transfer";
  question: string;
  options?: string[];
  correctAnswer: string;
  correctAnswers?: string[];       // NEW: multi-select
  explanation: string;
  rubric?: string;
  timeLimit?: number;              // EXISTING
  min?: number;                    // EXISTING (slider)
  max?: number;                    // EXISTING (slider)
  step?: number;                   // EXISTING (slider)
  // NEW fields (optional, agent-populated)
  reframes?: Record<string, string>; // mode -> rephrased question
}
```

No breaking changes. All new fields are optional.

## Agent Integration

The `quiz` tool in `browser-tools.ts` generates the deterministic `Quiz` object. To support adaptive branching, the tool would need to accept:

```json
{
  "topic": "recursion",
  "adaptive": true,
  "reframes": ["eli5", "debug"]
}
```

The agent can also respond to quiz-submission events by reading the `confidenceAccuracyCorrelation` and `missedLevels` fields to decide what to teach next.

## Files to Touch

- `web/src/keating/core.ts` — Extend `QuizQuestion` interface, add `multi_select` type.
- `web/src/components/QuizRenderer.tsx` — Render multi-select, confidence slider, reframe toggle, bookmark, audio, remediation dashboard.
- `web/src/keating/storage.ts` — Add `loadFlaggedQuestions`, `saveFlaggedQuestion`, `getTopicBenchmark`.
- `web/src/keating/browser-tools.ts` — Extend `quiz` tool params to support `adaptive` and `reframes`.

## Open Questions

1. Should confidence calibration be *per question* or *per quiz*? Per question is more granular but adds UI noise.
2. For adaptive branching, should the extra questions be pre-generated in the payload or fetched on-demand from the agent? Pre-generated is faster but bloats the response.
3. Should benchmark comparison be opt-out for privacy-conscious users?
