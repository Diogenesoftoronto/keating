import { describe, expect, test } from "bun:test";
import {
  OPENUI_SOURCE_PARITY_FIXTURE,
  SHARED_OPENUI_COMPONENT_MAPPERS,
  WEB_OPENUI_COMPONENTS,
  compileOpenUISourceToSharedDocument,
  tryCompileOpenUISourceToSharedDocument,
  validateUiDocument,
} from "../src/index.js";

const AT = "2026-08-10T00:00:00.000Z";

describe("trusted OpenUI source compiler", () => {
  test("compiles the current fixture pack through every registered component mapper", () => {
    const document = compileOpenUISourceToSharedDocument(OPENUI_SOURCE_PARITY_FIXTURE, {
      documentId: "session-1-message-1-openui-1",
      createdAt: AT,
      updatedAt: AT,
    });
    expect(SHARED_OPENUI_COMPONENT_MAPPERS).toEqual(WEB_OPENUI_COMPONENTS);
    expect(validateUiDocument(document)).toBe(true);
    expect(document.retention).toBe("workspace");
    expect(document.nodes.map((node) => node.type)).toEqual([
      "markdown", "callout", "question-group", "quiz", "quiz", "language-practice", "deck", "study-plan",
      "concept-map", "image", "notes", "task", "task", "task", "task", "task", "task", "simulation", "coding-challenge", "music-lab",
      "task", "task",
    ]);
    expect(document.nodes.filter((node) => node.type === "task").map((node) => node.kind))
      .toEqual(["assignment", "practice", "draft", "fieldwork", "practice", "practice", "practice", "practice"]);
    // The current generation fixture contains only advertised components. Persisted
    // LearningAnimation programs are covered separately as a compile-only legacy path.
    expect(document.nodes.some((node) => node.type === "handoff")).toBe(false);
  });

  test("accepts the browser object form without evaluating it", () => {
    const source = [
      'root = LearningSurface({ content: [explanation], title: "Object form", lifecycle: "resumable" })',
      'explanation = Explanation({ markdown: "A literal explanation." })',
    ].join("\n");
    const result = tryCompileOpenUISourceToSharedDocument(source, { documentId: "object-form", createdAt: AT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.title).toBe("Object form");
    expect(result.document.retention).toBe("resumable");
    expect(result.document.nodes).toEqual([{ type: "markdown", id: "explanation", markdown: "A literal explanation." }]);
  });

  test("test-owned examples preserve learner-visible payloads for every supported mapper", () => {
    const examples: readonly { component: string; props: Record<string, unknown>; visible: readonly string[] }[] = [
      { component: "Explanation", props: { markdown: "EXPLANATION_PAYLOAD", title: "EXPLANATION_TITLE" }, visible: ["EXPLANATION_PAYLOAD", "EXPLANATION_TITLE"] },
      { component: "Callout", props: { markdown: "CALLOUT_PAYLOAD", tone: "hint", title: "CALLOUT_TITLE" }, visible: ["CALLOUT_PAYLOAD", "hint", "CALLOUT_TITLE"] },
      { component: "Question", props: { intro: "QUESTION_INTRO", questions: [{ id: "question-target", type: "text", question: "QUESTION_PROMPT" }] }, visible: ["QUESTION_INTRO", "node-question-1", "QUESTION_PROMPT"] },
      { component: "Quiz", props: { topic: "QUIZ_TOPIC", questions: [{ id: "quiz-target", type: "short_answer", question: "QUIZ_PROMPT" }] }, visible: ["QUIZ_TOPIC", "node-quiz-target", "QUIZ_PROMPT"] },
      { component: "Exam", props: { topic: "EXAM_TOPIC", questions: Array.from({ length: 20 }, (_, index) => ({ question: `EXAM_QUESTION_${index + 1}` })) }, visible: ["EXAM_TOPIC", "node-question-1", "EXAM_QUESTION_1", "node-question-20", "EXAM_QUESTION_20"] },
      { component: "LanguagePractice", props: { title: "LANGUAGE_TITLE", language: "French", rounds: [{ id: "round-1", kind: "translation", prompt: "LANGUAGE_PROMPT", text: "bonjour", acceptedAnswers: ["hello"] }] }, visible: ["LANGUAGE_TITLE", "French", "round-1", "LANGUAGE_PROMPT", "bonjour", "hello"] },
      { component: "Flashcards", props: { title: "DECK_TITLE", topic: "Bayes", cards: [{ id: "card-1", front: "CARD_FRONT", back: "CARD_BACK" }] }, visible: ["DECK_TITLE", "Bayes", "card-1", "CARD_FRONT", "CARD_BACK"] },
      { component: "StudyPlan", props: { title: "PLAN_TITLE", overview: "PLAN_OVERVIEW", items: [{ id: "plan-item-1", title: "PLAN_ITEM", detail: "PLAN_DETAIL" }] }, visible: ["PLAN_TITLE", "PLAN_OVERVIEW", "plan-item-1", "PLAN_ITEM", "PLAN_DETAIL"] },
      { component: "ConceptMap", props: { code: "CONCEPT_MAP_SOURCE" }, visible: ["CONCEPT_MAP_SOURCE"] },
      { component: "LearningImage", props: { src: "https://keating.help/image.png", alt: "IMAGE_ALT" }, visible: ["https://keating.help/image.png", "IMAGE_ALT"] },
      { component: "SharedNotes", props: { initialValue: "NOTES_VALUE", placeholder: "NOTES_PLACEHOLDER" }, visible: ["NOTES_VALUE", "NOTES_PLACEHOLDER"] },
      { component: "Assignment", props: { title: "ASSIGNMENT_TITLE", brief: "ASSIGNMENT_BRIEF", criteria: ["ASSIGNMENT_CRITERION"], steps: [{ title: "ASSIGNMENT_STEP" }] }, visible: ["ASSIGNMENT_TITLE", "ASSIGNMENT_BRIEF", "ASSIGNMENT_CRITERION", "ASSIGNMENT_STEP"] },
      { component: "Practice", props: { title: "PRACTICE_TITLE", brief: "PRACTICE_BRIEF", exercises: [{ title: "PRACTICE_EXERCISE" }] }, visible: ["PRACTICE_TITLE", "PRACTICE_BRIEF", "PRACTICE_EXERCISE"] },
      { component: "Draft", props: { title: "DRAFT_TITLE", prompt: "DRAFT_PROMPT", rubric: ["DRAFT_RUBRIC"] }, visible: ["DRAFT_TITLE", "DRAFT_PROMPT", "DRAFT_RUBRIC"] },
      { component: "Fieldwork", props: { title: "FIELDWORK_TITLE", objective: "FIELDWORK_OBJECTIVE", protocol: [{ title: "FIELDWORK_PROTOCOL" }] }, visible: ["FIELDWORK_TITLE", "FIELDWORK_OBJECTIVE", "FIELDWORK_PROTOCOL"] },
      { component: "AudioResponse", props: { title: "AUDIO_TITLE", brief: "AUDIO_BRIEF", criteria: ["AUDIO_CRITERION"] }, visible: ["AUDIO_TITLE", "AUDIO_BRIEF", "AUDIO_CRITERION"] },
      { component: "VideoResponse", props: { title: "VIDEO_TITLE", brief: "VIDEO_BRIEF", criteria: ["VIDEO_CRITERION"] }, visible: ["VIDEO_TITLE", "VIDEO_BRIEF", "VIDEO_CRITERION"] },
      { component: "Simulation", props: { title: "SIMULATION_TITLE", brief: "SIMULATION_BRIEF", parameters: [{ id: "mass", label: "MASS_LABEL", min: 0, max: 2, value: 1 }], readouts: [{ id: "energy", label: "ENERGY_LABEL", expr: "mass + 1" }] }, visible: ["SIMULATION_TITLE", "SIMULATION_BRIEF", "mass", "MASS_LABEL", "ENERGY_LABEL", "mass + 1"] },
      { component: "Diagram", props: { title: "DIAGRAM_TITLE", brief: "DIAGRAM_BRIEF", components: [{ id: "diagram-node", label: "DIAGRAM_COMPONENT", kind: "service" }], connections: [], checks: [] }, visible: ["DIAGRAM_TITLE", "DIAGRAM_BRIEF", "diagram-node", "DIAGRAM_COMPONENT"] },
      { component: "SystemDesign", props: { title: "DESIGN_TITLE", brief: "DESIGN_BRIEF", components: [{ id: "design-node", label: "DESIGN_COMPONENT", kind: "service" }], connections: [], checks: [] }, visible: ["DESIGN_TITLE", "DESIGN_BRIEF", "design-node", "DESIGN_COMPONENT"] },
      { component: "CodingChallenge", props: { title: "CODE_TITLE", prompt: "CODE_PROMPT", language: "javascript", starterCode: "function answer() {}", entrypoint: "answer", tests: [{ id: "case-1", label: "CODE_TEST", args: [], expected: null }] }, visible: ["CODE_TITLE", "CODE_PROMPT", "javascript", "function answer() {}", "answer", "case-1", "CODE_TEST"] },
      { component: "MusicLab", props: { title: "MUSIC_TITLE", code: "MUSIC_CODE", brief: "MUSIC_BRIEF" }, visible: ["MUSIC_TITLE", "MUSIC_CODE", "MUSIC_BRIEF"] },
    ];
    for (const [index, example] of examples.entries()) {
      const source = [
        'root = LearningSurface({ content: [node], title: "Test-owned mapper example", lifecycle: "resumable" })',
        `node = ${example.component}(${JSON.stringify(example.props)})`,
      ].join("\n");
      const document = compileOpenUISourceToSharedDocument(source, { documentId: `mapper-${index}`, createdAt: AT });
      expect(validateUiDocument(document)).toBe(true);
      expect(document.retention).toBe("resumable");
      expect(document.nodes[0]?.id).toBe("node");
      const learnerPayload = JSON.stringify(document.nodes);
      for (const marker of example.visible) expect(learnerPayload).toContain(marker);
    }
  });

  test("matches the browser root lifecycle default", () => {
    const document = compileOpenUISourceToSharedDocument(
      'root = LearningSurface([x], "Default lifecycle")\nx = Explanation("Safe")',
      { documentId: "default-lifecycle", createdAt: AT },
    );
    expect(document.retention).toBe("ephemeral");
  });

  test("classifies partial, malformed, unsafe, and future source distinctly", () => {
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([explanation], "Partial',
      { documentId: "partial", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "partial" });
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([,], "Malformed")',
      { documentId: "malformed", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "invalid" });
    expect(tryCompileOpenUISourceToSharedDocument(
      '@include file:///private/state\nroot = LearningSurface([], "Unsafe")',
      { documentId: "unsafe", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "unsafe" });
    expect(tryCompileOpenUISourceToSharedDocument(
      'root = LearningSurface([future], "Future")\nfuture = FutureWidget({ value: "unknown" })',
      { documentId: "future", createdAt: AT },
    )).toMatchObject({ ok: false, kind: "unsupported" });
  });

  test("never evaluates model-authored expressions or HTML", () => {
    const scope = globalThis as typeof globalThis & { __openUiCompilerExecuted?: boolean };
    scope.__openUiCompilerExecuted = false;
    try {
      const active = tryCompileOpenUISourceToSharedDocument(
        'root = LearningSurface([x], "Unsafe")\nx = Explanation(globalThis.__openUiCompilerExecuted = true)',
        { documentId: "active", createdAt: AT },
      );
      expect(active).toMatchObject({ ok: false });
      expect(scope.__openUiCompilerExecuted).toBe(false);

      const html = compileOpenUISourceToSharedDocument([
        'root = LearningSurface([animation], "HTML data")',
        'animation = LearningAnimation("topic", "<script>globalThis.__openUiCompilerExecuted = true</script>")',
      ].join("\n"), { documentId: "html-data", createdAt: AT });
      expect(html.nodes[0]?.type).toBe("handoff");
      expect(JSON.stringify(html)).not.toContain("<script>");
      expect(scope.__openUiCompilerExecuted).toBe(false);
    } finally {
      delete scope.__openUiCompilerExecuted;
    }
  });

  test("uses caller-owned session scope without cross-session identity reuse", () => {
    const source = 'root = LearningSurface([x], "Scoped")\nx = Explanation("Safe")';
    const first = compileOpenUISourceToSharedDocument(source, { documentId: "session-a-message-1", createdAt: AT });
    const replay = compileOpenUISourceToSharedDocument(source, { documentId: "session-a-message-1", createdAt: AT });
    const fork = compileOpenUISourceToSharedDocument(source, { documentId: "session-b-message-1", createdAt: AT });
    expect(first.id).toBe(replay.id);
    expect(first.id).not.toBe(fork.id);
  });
});
