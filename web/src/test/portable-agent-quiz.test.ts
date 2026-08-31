import { describe, expect, test } from "bun:test";
import {
  PortableAgentInstance,
  useModel,
  useTool,
  type JsonValue,
} from "@keating/agent-runtime";
import { BrowserPortableAgentAdapter } from "../keating/portable-agent";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  (globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

function textFromResult(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
    .map(({ text }) => text)
    .join("\n");
}

function quizPayload(text: string): Record<string, any> {
  const match = text.match(/<keating-quiz\s+json=([^>]+)\s*\/>/);
  expect(match).not.toBeNull();
  return JSON.parse(JSON.parse(match![1]!.trim()));
}

describe("portable authored quiz parity", () => {
  test("preserves the existing quiz tool and storage contract through the adapter", async () => {
    const { createAssessmentTools } = await import("../keating/browser-tools/assessment");
    let savedPlan: Record<string, unknown> | null = null;
    const existingTools = createAssessmentTools({
      saveLessonPlan: async (topic: string, content: string, metadata: Record<string, unknown>) => {
        savedPlan = { id: "quiz-plan-portable", topic, content, metadata };
        return savedPlan;
      },
    } as any, async () => []);
    const existingQuiz = existingTools.find(({ name }) => name === "quiz")!;
    const adapter = new BrowserPortableAgentAdapter({
      delegate: async () => null,
      resolveMcpConnection: async () => [],
    });
    const instance = new PortableAgentInstance({ id: "portable-quiz" });
    const portableQuizDefinition = {
      name: "quiz",
      description: existingQuiz.description,
      inputSchema: existingQuiz.parameters as Readonly<Record<string, JsonValue>>,
      async run({ data, signal }: { data: unknown; signal?: AbortSignal }) {
        const result = await existingQuiz.execute("portable-quiz-call", data as Record<string, unknown>, signal);
        return textFromResult(result);
      },
    };
    function Agent() {
      useModel("local/model");
      useTool(portableQuizDefinition);
      return "Author the quiz from the completed lesson.";
    }

    const resources = await adapter.reconcile(instance.render(Agent));
    const portableQuiz = resources.tools.find(({ name }) => name === "quiz")!;
    expect(portableQuiz.parameters).toEqual(existingQuiz.parameters);
    expect(portableQuiz.parameters).toMatchObject({
      required: ["topic", "questions"],
      additionalProperties: false,
      properties: {
        questions: {
          minItems: 2,
          items: {
            required: ["question", "correctAnswer", "explanation"],
            additionalProperties: false,
          },
        },
      },
    });
    const result = await portableQuiz.execute("pi-portable-call", {
      topic: "Guile REPL debugging and Scheme type dispatch",
      questions: [
        {
          question: "Fill the slot: `(type-of x)` reveals the runtime ___.",
          type: "fill_in",
          level: "recall",
          blanks: [{ placeholder: "slot", hint: "kind of value" }],
          correctAnswer: "type",
          correctAnswers: ["type"],
          explanation: "Runtime type inspection narrows the dispatch path.",
        },
        {
          question: "What should follow a procedure failure on an unexpected Guile value?",
          type: "multiple_choice",
          level: "application",
          options: ["Inspect the value and dispatch path", "Retry blindly", "Delete the REPL"],
          correctAnswer: "Inspect the value and dispatch path",
          explanation: "Inspect the concrete value before changing code.",
        },
      ],
    });

    const text = textFromResult(result);
    const quiz = quizPayload(text);
    expect(savedPlan).toMatchObject({
      id: "quiz-plan-portable",
      topic: "Guile REPL debugging and Scheme type dispatch",
      metadata: { type: "quiz", questionCount: 2 },
    });
    expect(text).toContain("[artifact://plan/quiz-plan-portable]");
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]).toMatchObject({
      type: "fill_in",
      blanks: [{ placeholder: "slot", hint: "kind of value" }],
      correctAnswers: ["type"],
    });
    expect(result.details).toEqual({ source: "portable-tool", tool: "quiz" });
  });
});
