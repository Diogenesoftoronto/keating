/** Behavioral coverage for safe source recovery and learner-visible OpenUI lowering. */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  compileOpenUISourceToSharedDocument,
  tryCompileOpenUISourceToSharedDocument,
  type CompileSharedOpenUIOptions,
} from "../src/index.js";

const options = { documentId: "mutant-lesson", createdAt: "2026-08-10T00:00:00.000Z" };
const forbidden = ["eval", "Function", "globalThis", "window", "document", "process", "require", "import", "export", "fetch", "XMLHttpRequest", "WebSocket", "constructor", "prototype", "__proto__"] as const;
const lesson = (body: string) => `root = LearningSurface([node])\nnode = ${body}`;
const compile = (source: string, overrides: Partial<CompileSharedOpenUIOptions> = {}) => compileOpenUISourceToSharedDocument(source, { ...options, ...overrides });
const outcome = (source: string) => tryCompileOpenUISourceToSharedDocument(source, options);
const node = (component: string, props: unknown) => compile(lesson(`${component}(${JSON.stringify(props)})`)).nodes[0]!;

describe("OpenUI safety and source recovery", () => {
  test.each([...forbidden])("rejects reserved identifier %s in every authored identifier position", (name) => {
    for (const source of [
      `root = LearningSurface([${name}])\n${name} = Explanation("Safe")`,
      `root = ${name}([])`,
      lesson(`Explanation({markdown: "Safe", ${name}: "data"})`),
      lesson(`Explanation({markdown: "Safe", ${JSON.stringify(name)}: "data"})`),
      lesson(`Explanation({markdown: "Safe", nested: [{payload: ${name}}]})`),
    ]) {
      expect(outcome(source)).toMatchObject({ ok: false, kind: "unsafe", source });
    }
    // Identifier spellings in ordinary quoted lesson prose are inert data.
    expect(node("Explanation", { markdown: name })).toMatchObject({ markdown: name });
  });

  test("forbidden identifiers stay forbidden at generated nesting depths", () => {
    fc.assert(fc.property(fc.constantFrom(...forbidden), fc.integer({ min: 0, max: 10 }), (name, depth) => {
      let value: string = name;
      for (let i = 0; i < depth; i++) value = i % 2 ? `{value: ${value}}` : `[${value}]`;
      expect(outcome(lesson(`Explanation({markdown: "Safe", extra: ${value}})`))).toMatchObject({ ok: false, kind: "unsafe" });
    }), { numRuns: 60, seed: 802 });
  });

  test.each([
    "", " \t\n", "root", "root =", "root = LearningSurface", "root = LearningSurface(",
    "root = LearningSurface([", 'root = LearningSurface({content:', 'root = LearningSurface({content: [node]',
    'root = LearningSurface([node])\nnode = Explanation("unfinished',
    'root = LearningSurface([node])\nnode = Explanation("unfinished' + String.fromCharCode(92),
  ])("keeps incomplete streamed source recoverable: %j", (source) => {
    expect(outcome(source)).toMatchObject({ ok: false, kind: "partial", source });
    expect(() => compile(source)).toThrow();
  });

  test.each([
    'root = LearningSurface([])node = Explanation("x")',
    'root = LearningSurface([node,])\nnode = Explanation("x")',
    'root = LearningSurface({content: [],})',
    'root = LearningSurface([],)',
    'root : LearningSurface([])',
    'root = LearningSurface([]);',
    'root = LearningSurface({content: [], content: []})',
    'root = LearningSurface({content: [], "content": []})',
    'root = LearningSurface({content: [] description: "Missing comma"})',
    'root = LearningSurface([node node])\nnode = Explanation("x")',
    'root = LearningSurface([node])\nnode = Explanation("bad\\q")',
    'root = LearningSurface([node])\nnode = Explanation("raw\nline")',
    'root = LearningSurface([node])\nnode = Explanation("raw\tline")',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: 1e999})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: -})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: 01})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: 1.})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: 1e})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: +1})',
    'root = LearningSurface([node])\nnode = Explanation({markdown: "Safe", value: undefined})',
    'root = LearningSurface([node])\nnode = Explanation("one", "two", "extra")',
    'root = LearningSurface([missing])',
    'root = Explanation("Wrong root")',
    'other = LearningSurface([])',
    'root = LearningSurface([node])\nnode = Explanation("one")\nnode = Explanation("two")',
    'root = LearningSurface([node])\nnode = Explanation({markdown: node})',
    'root = LearningSurface([a])\na = Explanation({markdown: b})\nb = Explanation({markdown: a})',
    'root = LearningSurface({content: "text"})',
    'root = LearningSurface({content: [null]})',
  ])("rejects malformed or unresolved source: %j", (source) => {
    expect(outcome(source)).toMatchObject({ ok: false, kind: "invalid", source });
  });

  test("rejects directives and controls even inside unused definitions", () => {
    for (const value of ["@include", "\u0000", "\u001f"]) {
      expect(outcome(lesson(`Explanation({markdown: "Safe", extra: ${value}})`))).toMatchObject({ ok: false, kind: "unsafe" });
    }
  });

  test("bounds total source, definitions, collections, arguments, and nesting", () => {
    const withExtra = (value: string) => lesson(`Explanation({markdown: "Safe", extra: ${value}})`);
    const statements = (count: number) => [lesson('Explanation("Safe")'), ...Array.from({length: count - 2}, (_, i) => `unused${i} = Explanation("Unused")`)].join("\n");
    expect(compile(statements(64)).nodes).toEqual([{ type: "markdown", id: "node", markdown: "Safe" }]);
    expect(outcome(statements(65))).toMatchObject({ ok: false, kind: "invalid" });
    expect(compile(withExtra(JSON.stringify(Array(512).fill(null)))).nodes[0]).toMatchObject({ markdown: "Safe" });
    expect(outcome(withExtra(JSON.stringify(Array(513).fill(null))))).toMatchObject({ ok: false, kind: "invalid" });
    const fields = (count: number) => `{${Array.from({length: count}, (_, i) => `field${i}: null`).join(",")}}`;
    expect(compile(withExtra(fields(512))).nodes[0]).toMatchObject({ markdown: "Safe" });
    expect(outcome(withExtra(fields(513)))).toMatchObject({ ok: false, kind: "invalid" });
    expect(outcome(lesson(`Explanation(${Array(17).fill('"arg"').join(",")})`))).toMatchObject({ ok: false, kind: "invalid" });
    expect(compile(withExtra("[".repeat(23) + "null" + "]".repeat(23))).nodes[0]).toMatchObject({ markdown: "Safe" });
    expect(outcome(withExtra("[".repeat(24) + "null" + "]".repeat(24)))).toMatchObject({ ok: false, kind: "invalid" });
    const base = lesson('Explanation("Safe")');
    expect(compile(base.padEnd(131_072, " ")).nodes[0]).toMatchObject({ markdown: "Safe" });
    expect(outcome(base.padEnd(131_073, " "))).toMatchObject({ ok: false, kind: "invalid" });
  });

  test("preserves escaped strings, numeric literals, and flexible whitespace as data", () => {
    const source = ' \troot \r\n = LearningSurface ( [ node ] , "Lesson" ) \n node = Explanation ( { markdown : "Line\\n\\t\\\"quote\\\"\\\\slash\\u263a", data: [-1.25e+2, 0, 1E-2, true, false, null] } ) \t';
    expect(compile(source)).toMatchObject({ title: "Lesson", nodes: [{ type: "markdown", id: "node", markdown: 'Line\n\t"quote"\\slash☺' }] });
  });
});

describe("OpenUI learner-visible payloads", () => {
  test("caller metadata and root lifecycle have explicit precedence", () => {
    const source = 'root = LearningSurface([node], "Fractions", "A short lesson", "workspace")\nnode = Explanation("Safe")';
    expect(compile(source, { revision: 7, updatedAt: "2026-08-11T00:00:00.000Z", retention: "resumable" })).toMatchObject({
      id: "mutant-lesson", schemaVersion: 1, revision: 7, lifecycle: "ready", retention: "resumable",
      title: "Fractions", description: "A short lesson", supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
      createdAt: options.createdAt, updatedAt: "2026-08-11T00:00:00.000Z",
    });
    for (const retention of ["workspace", "resumable", "ephemeral"] as const) {
      expect(compile(`root = LearningSurface([node], "Lesson", "Description", "${retention}")\nnode = Explanation("Safe")`).retention).toBe(retention);
    }
    expect(compile('root = LearningSurface([node], "Lesson", "Description", "future")\nnode = Explanation("Safe")').retention).toBe("ephemeral");
    expect(compile(lesson('Explanation("Safe")'), { createdAt: undefined, updatedAt: "2026-08-12T00:00:00.000Z" })).toMatchObject({
      createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
    });
  });

  test.each([
    { source: 'Callout("Check your units", "warning", "Units")', expected: { type: "callout", id: "node", markdown: "Check your units", tone: "warning", title: "Units" } },
    { source: 'Question([{type: "text", question: "Why?"}], "resumable", "Reasoning", "Think first")', expected: { type: "question-group", id: "node", topic: "Reasoning", intro: "Think first", questions: [{ id: "node-question-1", kind: "text", prompt: "Why?" }] } },
    { source: 'Flashcards("facts", "Earth", "Planet facts", [{id: "one", front: "Satellite?", back: "Moon", tags: ["space"]}], "resumable", "Retrieve before turning")', expected: { type: "deck", id: "facts", title: "Planet facts", topic: "Earth", description: "Retrieve before turning", cards: [{ id: "one", front: "Satellite?", back: "Moon", tags: ["space"] }] } },
    { source: 'ConceptMap("graph LR; A-->B", "resumable", "Causal map")', expected: { type: "concept-map", id: "node", title: "Causal map", source: "graph LR; A-->B" } },
    { source: 'LearningImage("https://example.test/earth.png", "Earth from space", "resumable", "Earth", "Image caption")', expected: { type: "image", id: "node", alt: "Earth from space", resource: { id: "node-resource", title: "Earth", format: "uri", uri: "https://example.test/earth.png" } } },
    { source: 'LearningAnimation("orbits", "<script>throw 1</script>", "resumable", "Inspect the orbit in web")', expected: { type: "handoff", id: "node", target: "web", reason: "Inspect the orbit in web" } },
    { source: 'SharedNotes("journal", "Observations", "workspace", "First thought", "Add evidence")', expected: { type: "notes", id: "journal", title: "Observations", value: "First thought", placeholder: "Add evidence" } },
    { source: 'Assignment("report", "Field report", "Observe erosion", ["Use evidence"], "workspace", 35, [{id: "collect", title: "Collect samples", detail: "Use two sites"}], "2026-08-12", "2026-08-11")', expected: { type: "task", kind: "assignment", id: "report", title: "Field report", brief: "Observe erosion", criteria: ["Use evidence"], estimatedMinutes: 35, items: [{ id: "collect", title: "Collect samples", detail: "Use two sites" }], dueAt: "2026-08-12T00:00:00.000Z", availableFrom: "2026-08-11T00:00:00.000Z", submission: { format: "text", label: "Your submission", placeholder: "Paste or describe the work you produced." } } },
    { source: 'Practice("set", "Retrieval", "Recall the idea", [{title: "Explain", detail: "Without notes"}], "resumable", 5, "2026-08-12", "2026-08-11")', expected: { type: "task", kind: "practice", id: "set", title: "Retrieval", brief: "Recall the idea", estimatedMinutes: 5, items: [{ id: "set-item-1", title: "Explain", detail: "Without notes" }], dueAt: "2026-08-12T00:00:00.000Z", availableFrom: "2026-08-11T00:00:00.000Z" } },
    { source: 'Draft("essay", "Essay", "Defend a claim", ["Give a counterexample"], "resumable", 450, 2, "2026-08-12", "2026-08-11")', expected: { type: "task", kind: "draft", id: "essay", title: "Essay", brief: "Defend a claim", criteria: ["Give a counterexample"], round: 2, dueAt: "2026-08-12T00:00:00.000Z", availableFrom: "2026-08-11T00:00:00.000Z", submission: { format: "text", label: "Your draft", placeholder: "Write your draft here.", targetWords: 450 } } },
    { source: 'Fieldwork("river", "River study", "Find a pattern", [{title: "Measure", detail: "Repeat three times"}], "workspace", 30, "2026-08-12", "2026-08-11")', expected: { type: "task", kind: "fieldwork", id: "river", title: "River study", brief: "Find a pattern", estimatedMinutes: 30, items: [{ id: "river-item-1", title: "Measure", detail: "Repeat three times" }], dueAt: "2026-08-12T00:00:00.000Z", availableFrom: "2026-08-11T00:00:00.000Z" } },
    { source: 'AudioResponse("speech", "Speak", "Explain aloud", ["Be clear"], 45, "resumable")', expected: { type: "task", kind: "practice", id: "speech", title: "Speak", brief: "Explain aloud", criteria: ["Be clear"], submission: { format: "text", capture: { kind: "audio", timeLimitSeconds: 45 } } } },
    { source: 'VideoResponse("demo", "Demonstrate", "Show the process", ["Show each step"], 60, "resumable")', expected: { type: "task", kind: "practice", id: "demo", title: "Demonstrate", brief: "Show the process", criteria: ["Show each step"], submission: { format: "text", capture: { kind: "video", timeLimitSeconds: 60 } } } },
    { source: 'CodingChallenge("code", "Double", "Double n", "javascript", "function double(n) {}", "double", [{id: "one", label: "Two becomes four", args: [2], expected: 4}], "resumable", "Try addition")', expected: { type: "coding-challenge", id: "code", title: "Double", prompt: "Double n", language: "javascript", starterCode: "function double(n) {}", entrypoint: "double", tests: [{ id: "one", label: "Two becomes four", args: [2], expected: 4 }], hint: "Try addition" } },
    { source: 'MusicLab("song", "Pattern", "kick", "resumable", "Find the beat", [{id: "speed", label: "Tempo", min: 1, max: 4, value: 2}], "scope")', expected: { type: "music-lab", id: "song", title: "Pattern", code: "kick", brief: "Find the beat", controls: [{ id: "speed", label: "Tempo", min: 1, max: 4, value: 2 }], visualization: "scope" } },
    { source: 'Diagram("flow", "Flow", "Connect the steps", [{id: "api", label: "API", kind: "service"}], [], [], ["Explain choices"], "resumable", ["service"])', expected: { type: "task", kind: "practice", id: "flow", title: "Flow", brief: "Connect the steps", criteria: ["Explain choices"], diagram: { components: [{ id: "api", label: "API", kind: "service" }], connections: [], checks: [], kinds: ["service"] } } },
    { source: 'SystemDesign("system", "Service", "Design the service", [{id: "api", label: "API", kind: "service"}], [], [], ["Explain tradeoffs"], "resumable", ["service"])', expected: { type: "task", kind: "practice", id: "system", title: "Service", brief: "Design the service", criteria: ["Explain tradeoffs"], diagram: { components: [{ id: "api", label: "API", kind: "service" }], connections: [], checks: [], kinds: ["service"] } } },
  ])("positional component preserves its learner-facing fields: $source", ({ source, expected }) => {
    expect(compile(lesson(source)).nodes[0]).toMatchObject(expected);
  });

  test("study plans preserve dependency identity, nested steps, outcomes, and related plans", () => {
    const source = 'StudyPlan("roadmap", "Mechanics", [{id: "forces", title: "Forces", detail: "Draw a free-body diagram", estimatedMinutes: 20, outcomes: ["Identify forces"], children: [{id: "friction", title: "Friction"}]}, {id: "motion", title: "Motion", dependsOn: ["forces"]}], "workspace", "Build from forces to motion", [{planId: "algebra", title: "Algebra", relation: "prerequisite", detail: "Rearrange equations"}, {planId: "energy", title: "Energy", relation: "follow-up"}, {planId: "waves", title: "Waves", relation: "related"}])';
    expect(compile(lesson(source)).nodes[0]).toEqual({
      type: "study-plan", id: "roadmap", title: "Mechanics", overview: "Build from forces to motion",
      items: [
        { id: "forces", title: "Forces", detail: "Draw a free-body diagram", estimatedMinutes: 20, outcomes: ["Identify forces"], status: "not_started", children: [{ id: "friction", title: "Friction", status: "not_started" }] },
        { id: "motion", title: "Motion", dependsOn: ["forces"], status: "not_started" },
      ],
      relatedPlans: [{ planId: "algebra", title: "Algebra", relation: "prerequisite", detail: "Rearrange equations" }, { planId: "energy", title: "Energy", relation: "follow-up" }, { planId: "waves", title: "Waves", relation: "related" }],
    });
  });

  test("question controls preserve labels, false flags, blank hints, and slider bounds", () => {
    expect(node("Question", { topic: "Review", intro: "Try these", questions: [
      { type: "matching", question: "Match mammals", choices: ["Mammal", "Bird"], items: ["Whale", "Owl"], correctMatches: ["Mammal", "Bird"], header: "Animals", hint: "Warm blood is not enough", allowText: false, multiSelect: false, requireReasons: true, itemLabel: "Animal", choiceLabel: "Group", reasonLabel: "Evidence", uniqueMatches: true, level: "analysis", explanation: "Check anatomy", rubric: "Explain each link", timeLimit: 90 },
      { type: "blanks", question: "Water is ___", blanks: [{ placeholder: "state", hint: "At room temperature" }, {}], hint: "Think of a glass", allowText: true, requireReasons: false, uniqueMatches: false },
      { type: "slider", question: "Estimate", min: -2, max: 3.5, step: 0.5 },
    ] })).toEqual({
      type: "question-group", id: "node", topic: "Review", intro: "Try these", questions: [
        { id: "node-question-1", kind: "matching", prompt: "Match mammals", choices: [{ id: "node-question-1-choice-1", label: "Mammal" }, { id: "node-question-1-choice-2", label: "Bird" }], items: ["Whale", "Owl"], correctMatches: ["node-question-1-choice-1", "node-question-1-choice-2"], header: "Animals", hint: "Warm blood is not enough", allowText: false, multiSelect: false, requireReasons: true, itemLabel: "Animal", choiceLabel: "Group", reasonLabel: "Evidence", uniqueMatches: true, level: "analysis", explanation: "Check anatomy", rubric: "Explain each link", timeLimit: 90 },
        { id: "node-question-2", kind: "blanks", prompt: "Water is ___", blanks: [{ placeholder: "state", hint: "At room temperature" }, {}], hint: "Think of a glass", allowText: true, requireReasons: false, uniqueMatches: false },
        { id: "node-question-3", kind: "slider", prompt: "Estimate", min: -2, max: 3.5, step: 0.5 },
      ],
    });
  });

  test("choice grading accepts stable ids or unique labels and never guesses ambiguous answers", () => {
    for (const answer of ["node-q-choice-2", "Blue", "bLuE"]) {
      expect(node("Quiz", { id: "quiz", topic: "Colors", questions: [{ id: "q", type: "multiple_choice", question: "Sky?", options: ["Red", "Blue"], correctAnswer: answer }] })).toMatchObject({
        questions: [{ id: "node-q", correctAnswer: "node-q-choice-2" }],
      });
    }
    expect(node("Quiz", { questions: [{ id: "q", type: "multi_select", question: "Pick primes", options: ["2", "3", "4"], correctAnswers: ["2", "node-q-choice-2"] }] })).toMatchObject({
      questions: [{ multiSelect: true, correctAnswers: ["node-q-choice-1", "node-q-choice-2"] }],
    });
    expect(node("Quiz", { questions: [{ type: "true_false", question: "The moon is a star", correctAnswer: "False" }] })).toMatchObject({ questions: [{ choices: [{ id: "node-question-1-true", label: "True" }, { id: "node-question-1-false", label: "False" }], correctAnswer: "node-question-1-false" }] });
    for (const [choices, answer] of [[["Blue", "Blue"], "Blue"], [["Blue", "BLUE"], "blue"], [["Red", "Blue"], "Green"]] as const) {
      expect(outcome(lesson(`Quiz(${JSON.stringify({questions: [{ type: "multiple_choice", question: "Color?", options: choices, correctAnswer: answer }]})})`))).toMatchObject({ ok: false, kind: "invalid" });
    }
  });

  test("simulation normalizes bounds and values while retaining only safe readouts", () => {
    expect(compile(lesson('Simulation("lab", "Motion", [{id: "speed", label: "Speed", unit: "m/s", min: 1, max: 4, step: 0.5, value: 99}, {id: "time", label: "Time", min: 5, max: 2, value: -2}, {id: "offset"}], [{id: "distance", label: "Distance", unit: "m", expr: "speed * time", precision: 6, emphasis: true}, {expr: "offset + 1"}, {expr: "speed", precision: 1.5}, {expr: "speed", precision: 7}, {expr: "unknown + 1"}, {expr: "fetch(1)"}], "resumable", "Compare predictions")')).nodes[0]).toEqual({
      type: "simulation", id: "lab", title: "Motion", brief: "Compare predictions",
      parameters: [
        { id: "speed", label: "Speed", unit: "m/s", min: 1, max: 4, step: 0.5, value: 4 },
        { id: "time", label: "Time", min: 5, max: 6, value: 5 },
        { id: "offset", label: "Parameter 3", min: 0, max: 1, value: 0 },
      ],
      readouts: [
        { id: "distance", label: "Distance", unit: "m", expr: "speed * time", precision: 6, emphasis: true },
        { id: "lab-readout-2", label: "Readout 2", expr: "offset + 1" },
        { id: "lab-readout-3", label: "Readout 3", expr: "speed" },
        { id: "lab-readout-4", label: "Readout 4", expr: "speed" },
      ],
    });
  });

  test("invalid optional schedules and negative counts do not invent task obligations", () => {
    const result = node("Assignment", { brief: "Observe", steps: [{}, null], dueAt: "not-a-date", availableFrom: 4, estimatedMinutes: -3, round: -1 });
    expect(result).toMatchObject({ type: "task", title: "Assignment", items: [{ id: "node-item-1", title: "Step 1" }, { id: "node-item-2", title: "Step 2" }] });
    for (const key of ["dueAt", "availableFrom", "estimatedMinutes", "round"]) expect(Object.hasOwn(result, key)).toBe(false);
    expect(node("Practice", { brief: "Recall" })).toMatchObject({ title: "Practice set" });
    expect(node("Draft", { prompt: "Write" })).toMatchObject({ title: "Draft" });
    expect(node("Fieldwork", { objective: "Observe" })).toMatchObject({ title: "Fieldwork" });
  });

  test("normalizes authored identity for stable action targets", () => {
    expect(node("SharedNotes", { id: "  café / notes  " })).toMatchObject({ id: "cafe-notes" });
    expect(node("SharedNotes", { id: "---" })).toMatchObject({ id: "node" });
    expect(node("SharedNotes", { id: "a".repeat(129) })).toMatchObject({ id: "a".repeat(128) });
  });
});
