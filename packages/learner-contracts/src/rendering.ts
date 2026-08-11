import type { UiDocument } from "./ui.js";

/**
 * Increment when a fixture's semantics change so downstream renderers can
 * deliberately refresh their recovery and visual-regression snapshots.
 */
export const RENDERING_FIXTURE_PACK_VERSION = 2 as const;

export const RENDERING_FIXTURE_MARKDOWN_LIMIT = 65_536 as const;
export const RENDERING_FIXTURE_DOCUMENT_NODE_LIMIT = 64 as const;

export type RenderingFixtureExpectation = "accepted" | "partial" | "rejected" | "unsupported";
export type RenderingFixtureFamily = "document" | "openui-source" | "wire";
export type RenderingFixtureTheme = "light" | "dark";

/** A serializable fixture descriptor; consumers choose the parser or renderer. */
export interface RenderingRecoveryFixture {
  id: string;
  family: RenderingFixtureFamily;
  expectation: RenderingFixtureExpectation;
  description: string;
  payload: unknown;
  theme?: RenderingFixtureTheme;
}

export interface RenderingThemeScenario {
  id: string;
  theme: RenderingFixtureTheme;
  documentId: string;
  description: string;
}

export const WEB_MARKDOWN_FEATURES = [
  "heading", "paragraph", "line-break", "strong", "emphasis", "strikethrough",
  "ordered-list", "unordered-list", "task-list", "nested-list", "blockquote",
  "thematic-break", "table", "link", "image", "inline-code", "fenced-code",
  "spoiler", "inline-math", "display-math", "streaming-fence",
] as const;

export const WEB_MERMAID_GRAMMARS = [
  "flowchart", "sequence", "class", "state", "er", "gantt", "pie", "mindmap",
  "timeline", "journey", "gitGraph", "quadrantChart",
] as const;

export type WebMermaidGrammar = typeof WEB_MERMAID_GRAMMARS[number];

/**
 * Recognize only the portable Mermaid grammar subset that Keating promises
 * across its renderers.  Consumers must reject a `null` result rather than
 * passing an unknown Mermaid dialect through to a platform renderer.
 */
export function detectSupportedMermaidGrammar(source: string): WebMermaidGrammar | null {
  const lines = source.split(/\r?\n/);
  let header = "";
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate) continue;
    // Initialization directives can alter renderer configuration and are not
    // portable. Ordinary Mermaid comments may safely precede the grammar.
    if (/^%%\s*\{/u.test(candidate)) return null;
    if (/^%%/u.test(candidate)) continue;
    header = candidate.split(";", 1)[0]?.trim() ?? "";
    break;
  }
  if (/^(?:graph|flowchart)\s+(?:TD|TB|BT|LR|RL)$/u.test(header)) return "flowchart";
  if (header === "sequenceDiagram") return "sequence";
  if (header === "classDiagram") return "class";
  if (header === "stateDiagram" || header === "stateDiagram-v2") return "state";
  if (header === "erDiagram") return "er";
  if (header === "gantt") return "gantt";
  if (/^pie(?:\s+title(?:\s+.+)?)?$/u.test(header)) return "pie";
  if (header === "mindmap") return "mindmap";
  if (header === "timeline") return "timeline";
  if (header === "journey") return "journey";
  if (header === "gitGraph") return "gitGraph";
  if (header === "quadrantChart") return "quadrantChart";
  return null;
}

export const WEB_OPENUI_COMPONENTS = [
  "LearningSurface", "Explanation", "Callout", "Question", "Quiz", "Flashcards",
  "StudyPlan", "ConceptMap", "LearningImage", "LearningAnimation", "SharedNotes",
] as const;

export interface MermaidParityFixture {
  id: string;
  grammar: WebMermaidGrammar;
  source: string;
}

export const MARKDOWN_PARITY_FIXTURE = `# Rendering parity

Paragraph with **strong**, *emphasis*, ~~removed text~~, \`inline code\`,
[a source](https://example.com/source), and ![a diagram](https://example.com/diagram.png).
Two spaces create a line break.  
This is the next line, with ||a hidden retrieval cue|| and inline math $p(x|y)$.

> A blockquote can contain **formatted evidence**.

1. Ordered item
   - Nested item
   - [x] Completed task
   - [ ] Open task

| Construct | Expected behavior |
| --- | --- |
| Markdown | semantic native rendering |
| Mermaid | safe diagram rendering |

---

$$
p(\\theta \\mid x) = \\frac{p(x \\mid \\theta)p(\\theta)}{p(x)}
$$

\`\`\`typescript
export function posterior(prior: number, likelihood: number): number {
  return prior * likelihood;
}
\`\`\`

\`\`\`mermaid
flowchart LR
  Prior --> Evidence --> Posterior
\`\`\`
`;

export const MERMAID_PARITY_FIXTURES: readonly MermaidParityFixture[] = [
  { id: "mermaid-flowchart", grammar: "flowchart", source: "flowchart LR\n  A[Prior] --> B{Evidence}\n  B -->|update| C((Posterior))" },
  { id: "mermaid-sequence", grammar: "sequence", source: "sequenceDiagram\n  participant L as Learner\n  participant K as Keating\n  L->>K: Explain the model\n  K-->>L: Ask a retrieval question" },
  { id: "mermaid-class", grammar: "class", source: "classDiagram\n  class Evidence\n  class Belief\n  Evidence --> Belief : updates" },
  { id: "mermaid-state", grammar: "state", source: "stateDiagram-v2\n  [*] --> Learning\n  Learning --> Reviewing\n  Reviewing --> Learning" },
  { id: "mermaid-er", grammar: "er", source: "erDiagram\n  SESSION ||--o{ MESSAGE : contains\n  SESSION ||--o{ ARTIFACT : creates" },
  { id: "mermaid-gantt", grammar: "gantt", source: "gantt\n  title Study plan\n  dateFormat YYYY-MM-DD\n  section Learn\n  Foundations :a1, 2026-08-10, 2d\n  Practice :after a1, 2d" },
  { id: "mermaid-pie", grammar: "pie", source: "pie title Study evidence\n  \"Recall\" : 40\n  \"Transfer\" : 60" },
  { id: "mermaid-mindmap", grammar: "mindmap", source: "mindmap\n  root((Bayes))\n    Prior\n    Evidence\n    Posterior" },
  { id: "mermaid-timeline", grammar: "timeline", source: "timeline\n  title Learning sequence\n  Observe : evidence\n  Explain : model\n  Retrieve : test" },
  { id: "mermaid-journey", grammar: "journey", source: "journey\n  title Learning journey\n  section Model\n    Explain: 4: Learner\n    Retrieve: 5: Learner, Keating" },
  { id: "mermaid-gitgraph", grammar: "gitGraph", source: "gitGraph\n  commit id: \"lesson\"\n  branch alternative\n  commit id: \"fork\"" },
  { id: "mermaid-quadrant", grammar: "quadrantChart", source: "quadrantChart\n  title Confidence and evidence\n  x-axis Low evidence --> High evidence\n  y-axis Low confidence --> High confidence\n  Bayes: [0.7, 0.6]" },
] as const;

/** One parser-valid browser program containing every registered Keating OpenUI component. */
export const OPENUI_SOURCE_PARITY_FIXTURE = [
  'root = LearningSurface([explanation, callout, question, quiz, flashcards, plan, map, image, animation, notes], "Rendering parity", "Every registered component in one semantic fixture.", "workspace")',
  'explanation = Explanation("## A compact explanation\\nThe posterior combines prior belief and evidence.", "Explanation")',
  'callout = Callout("Do not confuse confidence with observed evidence.", "warning", "Check the claim")',
  'question = Question([{ header: "Choice", question: "What changes a posterior?", type: "choice", choices: ["Observed evidence", "New notation"] }, { header: "Explain", question: "Why does evidence matter?", type: "text" }, { header: "Recall", question: "A belief before evidence is the ___.", type: "blanks", blanks: [{ placeholder: "term" }] }, { header: "Classify", question: "Classify each item.", type: "classification", items: ["prior", "likelihood"], choices: ["belief", "evidence model"], requireReasons: true }, { header: "Match", question: "Match each term.", type: "matching", items: ["prior", "posterior"], choices: ["before evidence", "after evidence"], correctMatches: ["before evidence", "after evidence"] }], "resumable", "Bayes", "Use every conversational question format.")',
  'quiz = Quiz("rendering-quiz", "Bayes", [{ id: "mc", type: "multiple_choice", level: "recall", question: "Which is the prior?", options: ["Before evidence", "After evidence"], correctAnswer: "Before evidence", explanation: "The prior precedes the observation." }, { id: "multi", type: "multi_select", level: "comprehension", question: "Select update inputs.", options: ["Prior", "Likelihood", "Font"], correctAnswer: "Prior", correctAnswers: ["Prior", "Likelihood"], explanation: "Both determine the update." }, { id: "tf", type: "true_false", level: "recall", question: "Evidence can update belief.", correctAnswer: "true", explanation: "That is the update." }, { id: "fill", type: "fill_in", level: "recall", question: "The belief after evidence is the ___.", blanks: [{ placeholder: "term" }], correctAnswer: "posterior", explanation: "Posterior means after evidence." }, { id: "short", type: "short_answer", level: "analysis", question: "Explain the denominator.", correctAnswer: "normalization", explanation: "It normalizes the distribution." }, { id: "transfer", type: "transfer", level: "transfer", question: "Apply the update to diagnosis.", correctAnswer: "revise probabilities using test evidence", explanation: "The same structure transfers." }, { id: "slider", type: "slider", level: "application", question: "Set confidence.", min: 0, max: 100, step: 10, correctAnswer: "70", explanation: "The fixture exercises a bounded slider." }, { id: "dropdown", type: "dropdown", level: "comprehension", question: "Choose the evidence source.", options: ["Observation", "Typography"], correctAnswer: "Observation", explanation: "Observations supply evidence." }], "resumable")',
  'flashcards = Flashcards("rendering-deck", "Bayes", "Retrieval cards", [{ id: "card-prior", front: "Prior?", back: "Belief before evidence", tags: ["bayes"] }], "resumable", "A durable deck fixture.")',
  'plan = StudyPlan("rendering-plan", "Bayes study plan", [{ id: "foundation", title: "Build the model", detail: "Connect prior, likelihood, and posterior.", estimatedMinutes: 20, outcomes: ["Explain the update"], children: [{ id: "retrieve", title: "Retrieve the terms", detail: "Answer without notes." }] }], "workspace", "A nested plan fixture.")',
  'map = ConceptMap("flowchart LR\\n  Prior --> Evidence --> Posterior", "workspace", "Concept map")',
  'image = LearningImage("https://example.com/bayes.png", "A probability update diagram", "workspace", "Learning image", "Consent-gated remote media.")',
  'animation = LearningAnimation("Bayes", "<html><body><main>Safe fixture source</main></body></html>", "workspace", "A sandboxed animation fixture.")',
  'notes = SharedNotes("rendering-notes", "Learner notes", "workspace", "My current model", "Write what remains unclear.")',
].join("\n");

/** Canonical JSON interchange fixture containing every current shared node kind. */
export const OPENUI_JSON_PARITY_FIXTURE: UiDocument = {
  schemaVersion: 1,
  id: "rendering-parity-document",
  revision: 0,
  lifecycle: "ready",
  supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
  title: "Rendering parity",
  description: "Every canonical generative-UI semantic in one durable document.",
  nodes: [
    { type: "markdown", id: "markdown", markdown: MARKDOWN_PARITY_FIXTURE },
    { type: "callout", id: "callout", tone: "warning", title: "Check the claim", markdown: "Confidence is not the same thing as observed evidence." },
    { type: "question", id: "question-text", kind: "text", prompt: "Explain what evidence changes.", allowText: true },
    { type: "question", id: "question-choice", kind: "choice", prompt: "Choose the observed input.", choices: [{ id: "evidence", label: "Evidence" }, { id: "font", label: "Font" }] },
    { type: "question", id: "question-classify", kind: "classification", prompt: "Classify each term.", items: ["prior", "likelihood"], choices: [{ id: "belief", label: "Belief" }, { id: "evidence-model", label: "Evidence model" }], requireReasons: true },
    {
      type: "question-group",
      id: "question-group",
      title: "Grouped retrieval",
      intro: "Answer each form without losing its source interaction semantics.",
      topic: "Bayes",
      questions: [
        { id: "group-question-choice", kind: "choice", prompt: "Which input changes a posterior?", choices: [{ id: "group-choice-evidence", label: "Observed evidence" }, { id: "group-choice-font", label: "Font choice" }] },
        { id: "group-question-blanks", kind: "blanks", prompt: "A belief before evidence is the ___.", blanks: [{ placeholder: "term" }] },
        { id: "group-question-classification", kind: "classification", prompt: "Classify each term.", items: ["prior", "likelihood"], choices: [{ id: "group-class-belief", label: "Belief" }, { id: "group-class-model", label: "Evidence model" }], requireReasons: true },
        { id: "group-question-matching", kind: "matching", prompt: "Match each state to its timing.", items: ["prior", "posterior"], choices: [{ id: "group-match-before", label: "Before evidence" }, { id: "group-match-after", label: "After evidence" }], correctMatches: ["group-match-before", "group-match-after"] },
      ],
    },
    { type: "quiz", id: "quiz", title: "Retrieval check", questions: [{ id: "quiz-question", kind: "multiple_choice", level: "recall", prompt: "What precedes evidence?", choices: [{ id: "prior", label: "Prior" }, { id: "posterior", label: "Posterior" }], correctAnswer: "prior", explanation: "The prior is the belief before new evidence." }] },
    { type: "goal", id: "goal", title: "Explain Bayesian updating", status: "active", steps: [{ id: "goal-step", title: "Connect the terms", status: "not_started", successCriteria: ["Name prior, likelihood, and posterior"] }] },
    { type: "deck", id: "deck", title: "Bayes cards", topic: "Bayes", cards: [{ id: "card", front: "Prior?", back: "Belief before evidence", tags: ["bayes"] }] },
    { type: "study-plan", id: "study-plan", title: "Bayes plan", overview: "Build, retrieve, and transfer the model.", items: [{ id: "plan-foundation", title: "Build the model", detail: "Connect prior, likelihood, and posterior.", estimatedMinutes: 20, outcomes: ["Explain the update"], status: "not_started", children: [{ id: "plan-retrieve", title: "Retrieve the terms", status: "not_started" }] }] },
    { type: "artifact", id: "artifact", resource: { id: "artifact-resource", title: "Bayes note", format: "markdown", content: "# Bayes\nPosterior is proportional to likelihood times prior." } },
    { type: "concept-map", id: "concept-map", title: "Bayes map", source: "flowchart LR\n  Prior --> Evidence --> Posterior" },
    { type: "notes", id: "notes", title: "Learner notes", value: "My current model", placeholder: "Write what remains unclear." },
    { type: "image", id: "image", alt: "A probability update diagram", resource: { id: "image-resource", title: "Update diagram", format: "uri", uri: "https://example.com/bayes.png", mimeType: "image/png" } },
    { type: "media", id: "audio", kind: "audio", resource: { id: "audio-resource", title: "Bayes narration", format: "uri", uri: "https://example.com/bayes.mp3", mimeType: "audio/mpeg" } },
    { type: "media", id: "video", kind: "video", resource: { id: "video-resource", title: "Bayes video", format: "uri", uri: "https://example.com/bayes.mp4", mimeType: "video/mp4" } },
    { type: "media", id: "animation", kind: "animation", resource: { id: "animation-resource", title: "Bayes animation", format: "uri", uri: "https://example.com/bayes-animation.html", mimeType: "text/html" } },
    { type: "handoff", id: "handoff", target: "web", reason: "Continue in the full workspace", context: "Preserve the rendering parity fixture and learner state." },
  ],
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

/** Keep this explicit so a new node discriminant updates the fixture pack. */
export const UI_DOCUMENT_NODE_TYPES = [
  "markdown", "callout", "question", "question-group", "quiz", "goal", "deck", "study-plan",
  "artifact", "concept-map", "notes", "image", "media", "handoff",
] as const;

const FIXTURE_TIMESTAMP = "2026-08-10T00:00:00.000Z";

function renderingDocument(
  id: string,
  lifecycle: UiDocument["lifecycle"],
  nodes: UiDocument["nodes"],
): UiDocument {
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    lifecycle,
    supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
    nodes,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
  };
}

/** A second, compact document that exercises independent nested combinations. */
export const NESTED_RENDERING_DOCUMENT_FIXTURE: UiDocument = renderingDocument(
  "nested-rendering-document",
  "streaming",
  [
    {
      type: "question-group",
      id: "nested-question-group",
      title: "Nested interactions",
      questions: [
        { id: "nested-question-choice", kind: "choice", prompt: "Choose the safe resource.", choices: [{ id: "nested-choice-artifact", label: "Artifact" }, { id: "nested-choice-file", label: "Local file" }] },
        { id: "nested-question-match", kind: "matching", prompt: "Match each phase.", items: ["draft", "ready"], choices: [{ id: "nested-match-first", label: "First" }, { id: "nested-match-later", label: "Later" }], correctMatches: ["nested-match-first", "nested-match-later"] },
      ],
    },
    {
      type: "study-plan",
      id: "nested-study-plan",
      title: "Nested plan",
      items: [{
        id: "nested-plan-root",
        title: "Build a model",
        status: "not_started",
        children: [{
          id: "nested-plan-child",
          title: "Retrieve the model",
          status: "in_progress",
          children: [{ id: "nested-plan-leaf", title: "Transfer the model", status: "done" }],
        }],
      }],
    },
    { type: "artifact", id: "nested-artifact", resource: { id: "nested-artifact-resource", title: "Nested note", format: "markdown", content: "# A nested recovery fixture" } },
  ],
);

export const RENDERING_LIFECYCLE_STATES = [
  "draft", "streaming", "ready", "submitted", "completed", "failed", "cancelled",
] as const;

export const RENDERING_LIFECYCLE_FIXTURES: readonly RenderingRecoveryFixture[] = RENDERING_LIFECYCLE_STATES.map((lifecycle) => ({
  id: `lifecycle-${lifecycle}`,
  family: "document",
  expectation: "accepted",
  description: `A schema-valid document in the ${lifecycle} lifecycle state.`,
  payload: renderingDocument(`lifecycle-${lifecycle}-document`, lifecycle, [
    { type: "markdown", id: `lifecycle-${lifecycle}-markdown`, markdown: `Lifecycle: ${lifecycle}` },
  ]),
}));

export const RENDERING_THEME_SCENARIOS: readonly RenderingThemeScenario[] = [
  { id: "theme-light", theme: "light", documentId: OPENUI_JSON_PARITY_FIXTURE.id, description: "Render the canonical document with light-surface contrast and code treatment." },
  { id: "theme-dark", theme: "dark", documentId: OPENUI_JSON_PARITY_FIXTURE.id, description: "Render the same semantic document with dark-surface contrast and code treatment." },
];

const MAX_SIZED_MARKDOWN_DOCUMENT = renderingDocument("bounded-markdown-document", "ready", [
  { type: "markdown", id: "bounded-markdown-node", markdown: "x".repeat(RENDERING_FIXTURE_MARKDOWN_LIMIT) },
]);

const OVER_LIMIT_MARKDOWN_DOCUMENT = {
  ...MAX_SIZED_MARKDOWN_DOCUMENT,
  id: "over-limit-markdown-document",
  nodes: [{ type: "markdown", id: "over-limit-markdown-node", markdown: "x".repeat(RENDERING_FIXTURE_MARKDOWN_LIMIT + 1) }],
};

const MAX_SIZED_NODE_DOCUMENT = renderingDocument("bounded-node-document", "ready", Array.from(
  { length: RENDERING_FIXTURE_DOCUMENT_NODE_LIMIT },
  (_, index) => ({ type: "markdown" as const, id: `bounded-node-${index + 1}`, markdown: `Node ${index + 1}` }),
));

const OVER_LIMIT_NODE_DOCUMENT = {
  ...MAX_SIZED_NODE_DOCUMENT,
  id: "over-limit-node-document",
  nodes: Array.from(
    { length: RENDERING_FIXTURE_DOCUMENT_NODE_LIMIT + 1 },
    (_, index) => ({ type: "markdown" as const, id: `over-limit-node-${index + 1}`, markdown: `Node ${index + 1}` }),
  ),
};

/** Wire-only source samples; intentionally no parser dependency is required to consume these. */
export const RENDERING_SOURCE_RECOVERY_FIXTURES: readonly RenderingRecoveryFixture[] = [
  {
    id: "partial-openui-source",
    family: "openui-source",
    expectation: "partial",
    description: "A streamed OpenUI fence cut inside an unterminated root expression.",
    payload: '```openui lifecycle=resumable id=partial-rendering\nroot = LearningSurface([explanation], "Partial rendering',
  },
  {
    id: "malformed-openui-source",
    family: "openui-source",
    expectation: "rejected",
    description: "A completed fence with malformed component syntax.",
    payload: '```openui lifecycle=workspace id=malformed-rendering\nroot = LearningSurface([,], "Malformed")\n```',
  },
  {
    id: "unsafe-openui-directive",
    family: "openui-source",
    expectation: "rejected",
    description: "A source directive that attempts to import a local file and must never execute.",
    payload: '```openui lifecycle=workspace id=unsafe-directive\n@include file:///private/learner-state.json\nroot = Explanation("This directive is unsafe.")\n```',
  },
];

export const RENDERING_NEGATIVE_DOCUMENT_FIXTURES: readonly RenderingRecoveryFixture[] = [
  {
    id: "malformed-document-id",
    family: "document",
    expectation: "rejected",
    description: "A canonical-shaped document with an invalid whitespace-bearing node id.",
    payload: renderingDocument("malformed-document", "ready", [{ type: "markdown", id: "bad node id", markdown: "Invalid id" }]),
  },
  {
    id: "duplicate-nested-interaction-id",
    family: "document",
    expectation: "rejected",
    description: "A question-group child reuses its parent node id.",
    payload: renderingDocument("duplicate-nested-document", "ready", [{
      type: "question-group",
      id: "duplicate-question-group",
      questions: [{ id: "duplicate-question-group", kind: "text", prompt: "This nested id collides with its parent." }],
    }]),
  },
  {
    id: "unsafe-resource-uri",
    family: "document",
    expectation: "rejected",
    description: "A file URI is never a portable rendering resource.",
    payload: renderingDocument("unsafe-resource-document", "ready", [{
      type: "image",
      id: "unsafe-resource-image",
      alt: "Unsafe local image",
      resource: { id: "unsafe-resource-image-resource", title: "Unsafe local image", format: "uri", uri: "file:///private/learner-state.png", mimeType: "image/png" },
    }]),
  },
  {
    id: "unsafe-resource-query",
    family: "document",
    expectation: "rejected",
    description: "An otherwise HTTPS resource with a query string must be rejected by the wire contract.",
    payload: renderingDocument("unsafe-resource-query-document", "ready", [{
      type: "artifact",
      id: "unsafe-resource-query-artifact",
      resource: { id: "unsafe-resource-query-resource", title: "Unsafe query", format: "uri", uri: "https://example.com/asset?credential=secret" },
    }]),
  },
  {
    id: "unknown-future-schema-version",
    family: "wire",
    expectation: "unsupported",
    description: "A future schema version must not be rendered as a v1 document.",
    payload: { ...OPENUI_JSON_PARITY_FIXTURE, id: "future-schema-document", schemaVersion: 2 },
  },
  {
    id: "unknown-future-node",
    family: "wire",
    expectation: "unsupported",
    description: "An unrecognized future node discriminant must fail closed.",
    payload: renderingDocument("future-node-document", "ready", [{ type: "future-widget", id: "future-widget", instructions: "Do not guess how to render this." }] as unknown as UiDocument["nodes"]),
  },
  {
    id: "over-limit-markdown",
    family: "document",
    expectation: "rejected",
    description: "Markdown beyond the shared document limit is rejected before rendering.",
    payload: OVER_LIMIT_MARKDOWN_DOCUMENT,
  },
  {
    id: "over-limit-node-count",
    family: "document",
    expectation: "rejected",
    description: "A document with more than the shared node limit is rejected before rendering.",
    payload: OVER_LIMIT_NODE_DOCUMENT,
  },
];

export const RENDERING_VALID_DOCUMENT_FIXTURES: readonly RenderingRecoveryFixture[] = [
  {
    id: "canonical-all-node-types",
    family: "document",
    expectation: "accepted",
    description: "The canonical complete document, suitable for every supported surface.",
    payload: OPENUI_JSON_PARITY_FIXTURE,
  },
  {
    id: "nested-interaction-and-plan",
    family: "document",
    expectation: "accepted",
    description: "A compact document with independently nested questions and plan items.",
    payload: NESTED_RENDERING_DOCUMENT_FIXTURE,
  },
  {
    id: "max-sized-markdown",
    family: "document",
    expectation: "accepted",
    description: "A maximum-sized, still-bounded Markdown payload.",
    payload: MAX_SIZED_MARKDOWN_DOCUMENT,
  },
  {
    id: "max-sized-node-count",
    family: "document",
    expectation: "accepted",
    description: "A document at the maximum supported node count.",
    payload: MAX_SIZED_NODE_DOCUMENT,
  },
  ...RENDERING_LIFECYCLE_FIXTURES,
];

/** One serializable lookup list for build-spec recovery tests across surfaces. */
export const RENDERING_RECOVERY_FIXTURE_MATRIX: readonly RenderingRecoveryFixture[] = [
  ...RENDERING_VALID_DOCUMENT_FIXTURES,
  ...RENDERING_SOURCE_RECOVERY_FIXTURES,
  ...RENDERING_NEGATIVE_DOCUMENT_FIXTURES,
];
