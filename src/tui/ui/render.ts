import type { UiArtifactResource, UiDocument, UiDocumentNode, UiQuestion, UiStudyPlanItem } from "../learner-contracts.js";

export interface UiDocumentPresentation {
  heading: string;
  body: string[];
}

function nonEmpty(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => !!value && value.trim().length > 0);
}

function questionLines(question: UiQuestion, prefix = ""): string[] {
  const lines = [`${prefix}${question.prompt}`];
  if (question.hint) lines.push(`${prefix}Hint: ${question.hint}`);
  if (question.choices?.length) lines.push(...question.choices.map((choice) => `${prefix}  (${choice.id}) ${choice.label}`));
  if (question.items?.length) lines.push(...question.items.map((item) => `${prefix}  • ${item}`));
  if (question.blanks?.length) lines.push(`${prefix}  Fill ${question.blanks.length} blank${question.blanks.length === 1 ? "" : "s"}.`);
  if (question.explanation) lines.push(`${prefix}Explanation: ${question.explanation}`);
  return lines;
}

function resourceLines(resource: UiArtifactResource, label = "Resource"): string[] {
  const provenance = resource.uri ? `URI: ${resource.uri}` : "inline content";
  const lines = [`${label}: ${resource.title}`, `Provenance: ${provenance}${resource.mimeType ? ` (${resource.mimeType})` : ""}`];
  if (resource.content) lines.push(...resource.content.split("\n"));
  if (resource.uri) lines.push(`Open link: ${resource.uri}`);
  return lines;
}

function studyPlanLines(items: readonly UiStudyPlanItem[], indent = ""): string[] {
  return items.flatMap((item) => [
    `${indent}${item.status === "done" ? "[x]" : "[ ]"} ${item.title}${item.estimatedMinutes ? ` (${item.estimatedMinutes} min)` : ""}`,
    ...nonEmpty(item.detail && `${indent}  ${item.detail}`),
    ...(item.outcomes?.flatMap((outcome) => [`${indent}  Outcome: ${outcome}`]) ?? []),
    ...(item.children ? studyPlanLines(item.children, `${indent}  `) : []),
  ]);
}

function nodePresentation(node: UiDocumentNode): UiDocumentPresentation {
  switch (node.type) {
    case "markdown": return { heading: "Explanation", body: node.markdown.split("\n") };
    case "callout": return { heading: `${node.tone.toUpperCase()}: ${node.title || "Callout"}`, body: node.markdown.split("\n") };
    case "question": return { heading: node.header || "Question", body: questionLines(node) };
    case "question-group": return { heading: node.title || "Question group", body: [...nonEmpty(node.intro, node.topic && `Topic: ${node.topic}`), ...node.questions.flatMap((question, index) => questionLines(question, `${index + 1}. `))] };
    case "quiz": return { heading: `Quiz: ${node.title}`, body: node.questions.flatMap((question, index) => questionLines(question, `${index + 1}. `)) };
    case "goal": return { heading: `Goal: ${node.title}`, body: [...nonEmpty(node.description, `Status: ${node.status}`), ...node.steps.flatMap((step) => [`${step.status === "done" ? "[x]" : "[ ]"} ${step.title}`, ...(step.successCriteria?.map((criterion) => `  Success: ${criterion}`) ?? [])])] };
    case "deck": return { heading: `Deck: ${node.title}`, body: [...nonEmpty(`Topic: ${node.topic}`, node.description), ...node.cards.flatMap((card, index) => [`${index + 1}. ${card.front}`, `   ${card.back}`, ...(card.tags?.length ? [`   Tags: ${card.tags.join(", ")}`] : [])])] };
    case "study-plan": return {
      heading: node.title || "Study plan",
      body: [...nonEmpty(node.overview), ...(node.items ? studyPlanLines(node.items) : []), ...(node.relatedPlans?.flatMap((plan) => [`Related ${plan.relation || "plan"}: ${plan.title}`, ...nonEmpty(plan.detail && `  ${plan.detail}`)]) ?? []), ...(node.resource ? resourceLines(node.resource, "Plan resource") : [])],
    };
    case "artifact": return { heading: "Artifact", body: resourceLines(node.resource) };
    case "concept-map": return { heading: node.title || "Concept map", body: ["Mermaid source (not executed in terminal):", ...node.source.split("\n"), "Open this map on web or desktop for a rendered diagram."] };
    case "notes": return { heading: `Notes: ${node.title}`, body: [...node.value.split("\n"), ...nonEmpty(node.placeholder && `Prompt: ${node.placeholder}`)] };
    case "image": return { heading: `Image: ${node.resource.title}`, body: [`Alt text: ${node.alt}`, ...resourceLines(node.resource, "Image provenance"), "Open on web or desktop to view the image."] };
    case "media": return { heading: `${node.kind[0]!.toUpperCase()}${node.kind.slice(1)}: ${node.resource.title}`, body: [...resourceLines(node.resource, "Media provenance"), `Terminal playback is unavailable; open on web or desktop for this ${node.kind}.`] };
    case "handoff": return { heading: `Continue on ${node.target}`, body: [node.reason, `Context: ${node.context}`, `Handoff target: ${node.target}`] };
  }
}

/** Terminal-safe representation of the full canonical document surface. */
export function uiDocumentPresentation(document: UiDocument): UiDocumentPresentation {
  const heading = document.title || "Learning document";
  const body = [
    ...nonEmpty(document.description),
    `Lifecycle: ${document.lifecycle} · revision ${document.revision}`,
    `Supported surfaces: ${document.supportedSurfaces.join(", ")}`,
    ...document.nodes.flatMap((node) => {
      const presentation = nodePresentation(node);
      return ["", `— ${presentation.heading} —`, ...presentation.body];
    }),
  ];
  return { heading, body };
}

/** Exposed for terminals that choose to present an individual interactive node. */
export function uiNodePresentation(node: UiDocumentNode): UiDocumentPresentation {
  return nodePresentation(node);
}
