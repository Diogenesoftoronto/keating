import type { TranscriptEntry } from "../src/tui/view-model.js";

// Authored, offline component fixtures. No provider, account, or workspace access.
export const teachingConversation: readonly TranscriptEntry[] = [
  { id: "learner-question", kind: "user", title: "You", body: "Why does doubling speed make stopping distance four times longer?" },
  {
    id: "teacher-explanation", kind: "assistant", title: "Keating",
    body: "## Follow the energy\n\nKinetic energy is **½mv²**. With the same braking force, the brakes must do four times the work when speed doubles.\n\nTry predicting the stopping distance at 30 m/s before calculating it.",
  },
];

export const markdownExplanation: readonly TranscriptEntry[] = [
  { id: "worked-example", kind: "assistant", title: "Keating", body: [
    "## A worked comparison", "", "Keep mass and braking force fixed:", "",
    "| Speed | Relative energy | Stopping distance |", "| --- | --- | --- |",
    "| 10 m/s | 1× | 5 m |", "| 20 m/s | 4× | 20 m |", "",
    "```typescript", "const stoppingDistance = (speed: number) => speed ** 2 / 20;", "stoppingDistance(20); // 20 metres", "```", "",
    "> Check the relationship, then check the units.", "", "What changes if the braking force doubles?",
  ].join("\n") },
];

export const artifactAndNotice: readonly TranscriptEntry[] = [
  { id: "lesson-plan", kind: "artifact", title: "Lesson plan", body: "**Stopping distance**\n\n1. Predict how speed changes energy.\n2. Explain a worked example.\n3. Apply the relationship to a new speed." },
  { id: "saved", kind: "notice", title: "Saved locally", body: "Your lesson notes are saved on this device." },
];

// Shapes of generated components as the terminal shows them: the card's
// heading is the entry title, the body is plain Markdown.
export const generatedComponents: readonly TranscriptEntry[] = [
  { id: "learner-quiz", kind: "user", title: "You", body: "Quiz me on stopping distance." },
  { id: "quiz-call", kind: "tool", title: "grade_quiz", body: "topic=Stopping distance · 3 questions" },
  { id: "quiz-graded", kind: "artifact", title: "Quiz: Stopping distance", body: [
    "**2 of 3 correct**", "",
    "1. ✓ What is kinetic energy proportional to?  *recall*", "   → v squared",
    "2. ✓ Predict the stopping distance at 30 m/s.  *transfer*", "   → 45 m", "   *Good scaling argument.*",
    "3. ✗ What happens if the braking force doubles?  *apply*", "   → It doubles",
    "   *Distance halves: the same energy over twice the force.*",
  ].join("\n") },
  { id: "goal", kind: "artifact", title: "Goal: Explain braking with energy", body: [
    "*1 of 3 steps · next: Predict a new stopping distance*",
    "- [x] Relate speed to kinetic energy",
    "- [ ] Predict a new stopping distance  *in progress*",
    "- [ ] Transfer to braking force",
  ].join("\n") },
  { id: "model", kind: "artifact", title: "Model: Braking", body: [
    "Change one input at a time and predict before you look.", "",
    "| Parameter | Start | Range |", "| --- | --- | --- |",
    "| Speed | 20 m/s | 0–40 m/s |", "| Braking force | 8 kN | 2–16 kN |", "",
    "Watch: Stopping distance (m)",
    "*Interactive on web, desktop, or mobile; starting values shown.*",
  ].join("\n") },
];

export const toolFailure: readonly TranscriptEntry[] = [
  { id: "learner-read", kind: "user", title: "You", body: "Use my physics notes to explain braking." },
  { id: "read-failure", kind: "tool", title: "read · failed", body: "The requested notes could not be opened.", detail: "Fixture error: notes/physics.md is unavailable." },
  { id: "failure-guidance", kind: "error", title: "Notes unavailable", body: "Check the file path, or paste the passage here to continue." },
];

export interface FixtureSession { id: string; title: string }

export const sessions = [
  { display: "Stopping distance", value: { id: "fixture-physics", title: "Stopping distance" } },
  { display: "├ Energy worked example", asciiDisplay: "|-Energy worked example", value: { id: "fixture-energy", title: "Energy worked example" } },
  { display: "└ Braking force transfer", asciiDisplay: "`-Braking force transfer", value: { id: "fixture-transfer", title: "Braking force transfer" } },
  { display: "French · past tense", asciiDisplay: "French - past tense", value: { id: "fixture-french", title: "French · past tense" } },
] satisfies Array<{ display: string; asciiDisplay?: string; value: FixtureSession }>;
