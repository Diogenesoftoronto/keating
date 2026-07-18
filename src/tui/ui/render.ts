import type { JsonValue, UiDocument } from "./types.js";

function text(value: JsonValue | undefined): string { return typeof value === "string" ? value : ""; }
function list(value: JsonValue | undefined): Array<Record<string, JsonValue>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, JsonValue> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

export interface UiDocumentPresentation { heading: string; body: string[] }

export function uiDocumentPresentation(document: UiDocument): UiDocumentPresentation {
  const p = document.payload;
  switch (document.kind) {
    case "quiz":
      return { heading: document.title ?? `Quiz: ${text(p.topic) || "Quiz"}`, body: list(p.questions).map((q, i) => `${i + 1}. ${text(q.prompt) || text(q.question) || "Question"}`) };
    case "question":
      return { heading: document.title ?? "Question", body: list(p.fields).map((q, i) => `${i + 1}. ${text(q.prompt) || text(q.question) || "Question"}`) };
    case "goal": {
      const steps = list(p.steps).map((step) => `${text(step.status) === "done" ? "[x]" : "[ ]"} ${text(step.title)}`);
      return { heading: document.title ?? `Goal: ${text(p.title) || "Learning goal"}`, body: [text(p.description), ...steps].filter(Boolean) };
    }
    case "deck":
      return { heading: document.title ?? (text(p.title) || "Flashcards"), body: list(p.cards).flatMap((card, i) => [`${i + 1}. ${text(card.front)}`, `   ${text(card.back)}`]) };
    case "image":
      return { heading: document.title ?? (text(p.title) || "Image"), body: [text(p.alt), text(p.url) || text(p.dataUrl) || "(image data unavailable in terminal)"].filter(Boolean) };
    case "scene":
      return { heading: document.title ?? `Scene${text(p.topic) ? `: ${text(p.topic)}` : ""}`, body: [text(p.summary), text(p.storyboard), text(p.body), text(p.markdown)].filter(Boolean) };
    case "artifact":
      return { heading: document.title ?? (text(p.label) || "Artifact"), body: [text(p.summary), text(p.uri) || text(p.filePath), text(p.content)].filter(Boolean) };
    default: {
      const content = text(p.content) || JSON.stringify(p.data ?? p, null, 2);
      return { heading: document.title ?? "Tool result", body: content.split("\n") };
    }
  }
}
