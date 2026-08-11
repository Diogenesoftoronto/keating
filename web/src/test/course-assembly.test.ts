import { describe, expect, it } from "bun:test";
import type { FlashcardDeck } from "../keating/flashcard-types";
import {
  assembleCourseInput,
  artifactSourcesFromSavedWork,
  courseArtifactsFromSession,
  studyPlanFromArtifact,
  studyPlansFromSession,
  type SavedStudyPlanSource,
} from "../courses/course-assembly";
import { courseCreateInputSchema } from "../courses/contracts";

const savedPlan: SavedStudyPlanSource = {
  id: "session-1:systems-plan",
  planId: "systems-plan",
  title: "Systems thinking",
  overview: "Choose useful boundaries, then test interventions.",
  sessionId: "session-1",
  sessionTitle: "Working on systems",
  lastModified: "2026-08-08T12:00:00.000Z",
  items: [
    {
      id: "boundaries",
      title: "System boundaries",
      children: [{ id: "draw", title: "Draw the boundary" }],
    },
    {
      id: "feedback",
      title: "Feedback loops",
      children: [{ id: "trace", title: "Trace a loop" }],
    },
  ],
};

const deck: FlashcardDeck = {
  id: "deck-1",
  topic: "systems",
  slug: "systems",
  title: "Systems cards",
  cards: [
    {
      id: "loop/card",
      front: "What is a reinforcing loop?",
      back: "A loop whose effects compound change in the same direction.",
      tags: ["systems", "feedback"],
      srs: {
        ease: 2.5,
        intervalDays: 0,
        reps: 0,
        lapses: 0,
        dueAt: 0,
        lastReviewedAt: 0,
        lastRating: null,
      },
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  createdAt: 0,
  updatedAt: 0,
};

describe("course assembly", () => {
  it("creates a valid genuinely blank course", () => {
    const course = assembleCourseInput({ title: "My course" });

    expect(courseCreateInputSchema.parse(course)).toEqual(course);
    expect(course.modules).toEqual([]);
    expect(course.cards).toEqual([]);
    expect(course.artifacts).toEqual([]);
  });

  it("assembles selected plan sections and imported decks", () => {
    const course = assembleCourseInput({
      plans: [{ source: savedPlan, moduleIds: ["feedback"] }],
      decks: [deck],
    });

    expect(courseCreateInputSchema.safeParse(course).success).toBe(true);
    expect(course.title).toBe("Systems thinking");
    expect(course.modules.map((module) => module.title)).toEqual([
      "Feedback loops",
    ]);
    expect(course.modules[0]?.lessons[0]?.title).toBe("Trace a loop");
    expect(course.cards[0]).toMatchObject({
      front: "What is a reinforcing loop?",
      back: "A loop whose effects compound change in the same direction.",
      tags: ["systems", "feedback"],
    });
  });

  it("discovers StudyPlans in complete saved assistant messages", async () => {
    const plans = await studyPlansFromSession({
      id: "session-1",
      title: "Planning chat",
      lastModified: "2026-08-08T12:00:00.000Z",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: [
                "```openui lifecycle=workspace id=systems-plan",
                'root = LearningSurface([plan], "Systems", "A plan", "workspace")',
                'plan = StudyPlan("systems-plan", "Systems thinking", [{ id: "feedback", title: "Feedback loops" }], "workspace", "Learn to see loops.")',
                "```",
              ].join("\n"),
            },
          ],
        } as never,
      ],
    });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      planId: "systems-plan",
      title: "Systems thinking",
      sessionTitle: "Planning chat",
    });
    expect(plans[0]?.items[0]?.title).toBe("Feedback loops");
  });

  it("makes saved deterministic lesson plans selectable by section", () => {
    const source = studyPlanFromArtifact({
      id: "plan-1",
      topic: "Bayes rule",
      createdAt: 1,
      updatedAt: 2,
      content:
        "# Lesson Plan\n\n## Intuition\n\nStart with changing beliefs.\n\n## Practice\n\nWork one diagnostic example.",
    });

    expect(source.sessionTitle).toBe("Saved lesson plans");
    expect(source.items.map((item) => item.title)).toEqual([
      "Intuition",
      "Practice",
    ]);
    expect(source.items[1]?.detail).toContain("diagnostic example");
  });

  it("discovers interactive quizzes, GenUI, and generated images from saved chats", () => {
    const quiz = {
      topic: "Systems",
      slug: "systems-check",
      generatedAt: "2026-08-08T12:00:00.000Z",
      questions: [
        {
          id: "q1",
          type: "short_answer",
          level: "application",
          question: "Where would you draw the boundary?",
          correctAnswer:
            "A defensible answer names what is included and excluded.",
          explanation: "Boundaries make the analysis tractable.",
        },
      ],
      totalPoints: 1,
      review: {
        status: "passed",
        issues: [],
        duplicatesRemoved: 0,
        maxQuestionChars: 35,
        maxAnswerChars: 60,
        maxExplanationChars: 40,
        maxRubricChars: 0,
        maxOptionChars: 0,
        limits: {
          questionChars: 320,
          answerChars: 500,
          explanationChars: 500,
          rubricChars: 220,
          optionChars: 220,
        },
      },
    };
    const quizTag = `<keating-quiz json=${JSON.stringify(JSON.stringify(quiz))} />`;
    const imageTag = `<keating-image json=${JSON.stringify(JSON.stringify({ title: "Feedback loop", alt: "A reinforcing loop", dataUrl: "data:image/png;base64,AAAA" }))} />`;
    const artifacts = courseArtifactsFromSession({
      id: "session-visual",
      title: "Systems studio",
      lastModified: "2026-08-08T12:00:00.000Z",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `${quizTag}\n${imageTag}\n\`\`\`openui lifecycle=workspace id=surface-1\nroot = Explanation(\"A model\", \"Generated surface\")\n\`\`\``,
            },
          ],
        } as never,
      ],
    });

    expect(artifacts.map((artifact) => artifact.format).sort()).toEqual([
      "image",
      "openui",
      "quiz",
    ]);
    expect(
      artifacts.find((artifact) => artifact.format === "quiz")?.title,
    ).toBe("Systems quiz");
    expect(
      artifacts.find((artifact) => artifact.format === "image")?.description,
    ).toBe("A reinforcing loop");
  });

  it("adapts every saved artifact store into attachable course sources", () => {
    const sources = artifactSourcesFromSavedWork({
      plans: [
        {
          id: "p1",
          topic: "Bayes",
          createdAt: 1,
          updatedAt: 2,
          content: "# Plan",
        },
      ],
      maps: [
        {
          id: "m1",
          topic: "Bayes",
          createdAt: 3,
          mmdContent: "graph LR; A-->B",
        },
      ],
      animations: [
        {
          id: "a1",
          topic: "Bayes",
          createdAt: 4,
          storyboard: "# Story",
          scene: "<html></html>",
          manifest: "{}",
          renderer: "hyperframes",
        },
      ],
      verifications: [
        {
          id: "v1",
          topic: "Bayes",
          createdAt: 5,
          checklist: "- [ ] Check",
          completed: false,
        },
      ],
      benchmarks: [
        {
          id: "b1",
          topic: "Bayes",
          createdAt: 6,
          score: 91,
          report: "# Benchmark",
        },
      ],
      evolutions: [
        {
          id: "e1",
          topic: "Bayes",
          createdAt: 7,
          bestScore: 92,
          policy: "{}",
          report: "# Evolution",
        },
      ],
      promptEvolutions: [
        {
          id: "pe1",
          promptName: "learn",
          createdAt: 8,
          bestScore: 93,
          bestPrompt: "Teach",
          report: "# Prompt",
        },
      ],
    });

    expect(sources.map((source) => source.kind)).toEqual([
      "prompt-evolution",
      "evolution",
      "benchmark",
      "verification",
      "animation",
      "lesson-map",
      "lesson-plan",
    ]);
    expect(
      assembleCourseInput({ title: "Artifacts", artifacts: sources }).artifacts,
    ).toHaveLength(7);
  });
});
