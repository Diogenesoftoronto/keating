import type { UiArtifactResource, UiDocument, UiDocumentNode, UiQuestion, UiStudyPlanItem, UiTaskNode } from "../learner-contracts.js";
import { systemDesignMermaid } from "../learner-contracts.js";

/**
 * Terminal presentation of canonical learning documents.
 *
 * The body is Markdown, written for a reader rather than a debugger: each node
 * is a `###` section, steps are task-list items, choices carry their letter in
 * bold, and anything the terminal cannot run becomes one italic pointer to the
 * surface that can. Bookkeeping (lifecycle, revision, surfaces) stays out of
 * the transcript unless it changes what the learner can do.
 */
export interface UiDocumentPresentation {
  heading: string;
  body: string[];
}

function nonEmpty(...values: Array<string | undefined | false>): string[] {
  return values.filter((value): value is string => !!value && value.trim().length > 0);
}

function aside(text: string): string {
  return `*${text}*`;
}

function check(done: boolean): string {
  return done ? "- [x]" : "- [ ]";
}

function questionLines(question: UiQuestion, number?: number): string[] {
  const lead = number === undefined ? "" : `${number}. `;
  const indent = number === undefined ? "" : " ".repeat(lead.length);
  return [
    `${lead}${question.prompt}`,
    // Short ids ("a", "b") are keys the answer picker repeats; slugs are not worth reading.
    ...(question.choices ?? []).map((choice) => `${indent}- ${choice.id.length <= 2 ? `**${choice.id}** ` : ""}${choice.label}`),
    ...(question.items ?? []).map((item) => `${indent}- ${item}`),
    ...nonEmpty(!!question.blanks?.length && `${indent}${aside(`${question.blanks.length} blank${question.blanks.length === 1 ? "" : "s"} to fill`)}`),
    ...nonEmpty(question.hint && `${indent}${aside(`Hint: ${question.hint}`)}`),
  ];
}

function resourceLines(resource: UiArtifactResource): string[] {
  return [
    ...(resource.content ? resource.content.split("\n") : []),
    ...nonEmpty(resource.uri && `<${resource.uri}>`),
  ];
}

function studyPlanLines(items: readonly UiStudyPlanItem[], indent = ""): string[] {
  return items.flatMap((item) => [
    `${indent}${check(item.status === "done")} ${item.title}${item.estimatedMinutes ? ` · ${item.estimatedMinutes} min` : ""}`,
    ...nonEmpty(item.detail && `${indent}  ${item.detail}`),
    ...(item.outcomes ?? []).map((outcome) => `${indent}  → ${outcome}`),
    ...(item.children ? studyPlanLines(item.children, `${indent}  `) : []),
  ]);
}

function taskKindLabel(kind: UiTaskNode["kind"]): string {
  if (kind === "practice") return "Practice";
  if (kind === "draft") return "Draft";
  if (kind === "fieldwork") return "Fieldwork";
  return "Assignment";
}

function capitalized(text: string): string {
  return `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

function nodePresentation(node: UiDocumentNode): UiDocumentPresentation {
  switch (node.type) {
    case "markdown": return { heading: "Explanation", body: node.markdown.split("\n") };
    case "callout": return {
      heading: `${node.tone.toUpperCase()}: ${node.title || "Callout"}`,
      body: node.markdown.split("\n").map((line) => (line ? `> ${line}` : ">")),
    };
    case "question": return { heading: node.header || "Question", body: questionLines(node) };
    case "question-group": return {
      heading: node.title || "Question group",
      body: [...nonEmpty(node.intro, node.topic && aside(node.topic)), ...node.questions.flatMap((question, index) => questionLines(question, index + 1))],
    };
    case "quiz": return node.mode === "exam"
      ? {
        heading: `Exam: ${node.title}`,
        body: [
          aside(`${node.questions.length} questions · ${Math.ceil((node.examTimeLimit ?? 1800) / 60)} min · timed attempts start on web`),
          "",
          ...node.questions.flatMap((question, index) => questionLines({ ...question, hint: undefined, explanation: undefined }, index + 1)),
        ],
      }
      : {
        heading: `Quiz: ${node.title}`,
        body: [
          ...node.questions.flatMap((question, index) => questionLines({ ...question, hint: undefined }, index + 1)),
          ...(node.questions.some((question) => question.hint) ? ["", aside("Hints stay hidden until you ask for one (^U).")] : []),
        ],
      };
    case "goal": return {
      heading: `Goal: ${node.title}`,
      body: [
        ...nonEmpty(node.description),
        ...nonEmpty(node.status !== "active" && aside(node.status)),
        ...node.steps.flatMap((step) => [
          `${check(step.status === "done")} ${step.title}`,
          ...(step.successCriteria ?? []).map((criterion) => `  → ${criterion}`),
        ]),
      ],
    };
    case "deck": return {
      heading: `Deck: ${node.title}`,
      body: [
        ...nonEmpty(node.description, aside(`${node.topic} · ${node.cards.length} card${node.cards.length === 1 ? "" : "s"} · answers hidden until reviewed (^U)`)),
        ...node.cards.map((card, index) => `${index + 1}. ${card.front}${card.tags?.length ? `  *${card.tags.join(", ")}*` : ""}`),
      ],
    };
    case "study-plan": return {
      heading: node.title || "Study plan",
      body: [
        ...nonEmpty(node.overview),
        ...(node.items ? studyPlanLines(node.items) : []),
        ...(node.relatedPlans ?? []).map((plan) => `- ${capitalized(plan.relation || "related")}: ${plan.title}${plan.detail ? ` — ${plan.detail}` : ""}`),
        ...(node.resource ? resourceLines(node.resource) : []),
      ],
    };
    case "artifact": return { heading: node.resource.title || "Artifact", body: resourceLines(node.resource) };
    case "concept-map": return {
      heading: node.title || "Concept map",
      body: ["```mermaid", ...node.source.split("\n"), "```"],
    };
    case "notes": return {
      heading: `Notes: ${node.title}`,
      body: node.value.trim() ? node.value.split("\n") : nonEmpty(node.placeholder && aside(node.placeholder)),
    };
    case "image": return {
      heading: `Image: ${node.resource.title}`,
      body: [aside(node.alt), ...resourceLines(node.resource)],
    };
    case "media": return {
      heading: `${capitalized(node.kind)}: ${node.resource.title}`,
      body: [...resourceLines(node.resource), aside(`Plays on web or desktop.`)],
    };
    case "simulation": return {
      heading: `Model: ${node.title}`,
      body: [
        ...nonEmpty(node.brief),
        "",
        "| Parameter | Start | Range |",
        "| --- | --- | --- |",
        ...node.parameters.map((parameter) => {
          const unit = parameter.unit ? ` ${parameter.unit}` : "";
          return `| ${parameter.label} | ${parameter.value}${unit} | ${parameter.min}–${parameter.max}${unit} |`;
        }),
        "",
        `Watch: ${node.readouts.map((readout) => `${readout.label}${readout.unit ? ` (${readout.unit})` : ""}`).join(", ")}`,
        aside("Interactive on web, desktop, or mobile; starting values shown."),
      ],
    };
    case "coding-challenge": return {
      heading: `Code challenge: ${node.title}`,
      body: [
        ...node.prompt.split("\n"),
        "",
        `\`\`\`${node.language}`,
        ...node.starterCode.split("\n"),
        "```",
        ...node.tests.map((sample) => `- ${sample.label}: \`${JSON.stringify(sample.args)}\` → \`${JSON.stringify(sample.expected)}\``),
        aside("Edit and run on web."),
      ],
    };
    case "music-lab": return {
      heading: `Music lab: ${node.title}`,
      body: [...nonEmpty(node.brief), "```js", ...node.code.split("\n"), "```", aside("Plays on web.")],
    };
    case "language-practice": return {
      heading: `Language practice: ${node.title}`,
      body: [
        aside(`${node.language} · ${node.rounds.length} round${node.rounds.length === 1 ? "" : "s"} · listening and speaking on web`),
        ...node.rounds.map((round, index) => `${index + 1}. ${round.prompt}`),
      ],
    };
    case "task": {
      const facts = nonEmpty(
        node.estimatedMinutes !== undefined && `${node.estimatedMinutes} min`,
        node.round !== undefined && `round ${node.round}`,
        node.submission && node.submission.format !== "none"
          && `hand back ${node.submission.format === "link" ? "a link" : "written work"}${node.submission.targetWords ? `, ~${node.submission.targetWords} words` : ""}`,
        node.submission?.capture && `record ${node.submission.capture.kind} on web${node.submission.capture.timeLimitSeconds ? ` (${node.submission.capture.timeLimitSeconds}s)` : ""}`,
      );
      return {
        heading: `${taskKindLabel(node.kind)}: ${node.title}`,
        body: [
          ...node.brief.split("\n"),
          ...(node.diagram ? ["", "```mermaid", ...systemDesignMermaid({ components: node.diagram.components, connections: node.diagram.connections }).split("\n"), "```", "", "**Structural checks**", ...node.diagram.checks.map((entry) => `- ${entry.label}`), aside("Open this activity on web or mobile to build your diagram and submit your explanation for review.")] : []),
          ...(facts.length ? ["", aside(facts.join(" · "))] : []),
          ...(node.items?.length
            ? ["", ...node.items.flatMap((item) => [
              `${check(item.status === "done")} ${item.title}`,
              ...nonEmpty(item.detail && `  ${item.detail}`),
              ...nonEmpty(item.note && `  ${aside(`noted: ${item.note}`)}`),
            ])]
            : []),
          ...(node.criteria?.length ? ["", node.diagram ? "**Review criteria**" : "**Judged on**", ...node.criteria.map((criterion) => `- ${criterion}`)] : []),
        ],
      };
    }
    case "handoff": return {
      heading: `Continue on ${node.target}`,
      body: [node.reason, ...nonEmpty(node.context && aside(node.context))],
    };
  }
}

/**
 * Terminal-safe representation of the full canonical document surface.
 * Lifecycle only surfaces when it is not the ordinary "ready" state.
 */
export function uiDocumentPresentation(document: UiDocument): UiDocumentPresentation {
  const single = document.nodes.length === 1 ? nodePresentation(document.nodes[0]!) : undefined;
  const heading = document.title || single?.heading || "Learning document";
  // A lone node whose heading would only repeat the entry title collapses into it;
  // a generic title ("Teaching activity") still needs the node's own name below.
  const sections = single && single.heading === heading
    ? single.body
    : document.nodes.flatMap((node, index) => {
      const presentation = nodePresentation(node);
      return [...(index > 0 || document.description ? [""] : []), `### ${presentation.heading}`, ...presentation.body];
    });
  return {
    heading,
    body: [...nonEmpty(document.description), ...nonEmpty(document.lifecycle !== "ready" && aside(document.lifecycle)), ...sections],
  };
}

/** Exposed for terminals that choose to present an individual interactive node. */
export function uiNodePresentation(node: UiDocumentNode): UiDocumentPresentation {
  return nodePresentation(node);
}
