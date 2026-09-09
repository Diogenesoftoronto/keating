import { adaptToolResultToUiDocument, adaptUiDocument } from "./adapter.js";
import { validateUiDocument, type UiDocument } from "../learner-contracts.js";

const CANONICAL_OPENUI_FENCE = /```(?:keating-ui|ui-document|openui-json)(?:[^\n]*)\n([\s\S]*?)```/gi;
const INCOMPLETE_CANONICAL_OPENUI_FENCE = /```(?:keating-ui|ui-document|openui-json)(?:[^\n]*)\n[\s\S]*$/i;

/** Keep canonical OpenUI transport out of the transcript and hand it to the terminal renderer. */
export function splitAssistantOpenUiDocuments(source: string): { content: string; documents: string[] } {
  const documents: string[] = [];
  const withoutComplete = source.replace(CANONICAL_OPENUI_FENCE, (_match, body: string) => {
    const candidate = body.trim();
    if (candidate) documents.push(candidate);
    return "";
  });
  return {
    content: withoutComplete
      .replace(INCOMPLETE_CANONICAL_OPENUI_FENCE, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    documents,
  };
}


export const TUI_SUBMISSION_MESSAGE = "keating-ui-submission";

export function documentsFromMessage(message: unknown): UiDocument[] {
  if (!message || typeof message !== "object") return [];
  const value = message as { role?: string; content?: unknown; details?: unknown; toolName?: string; isError?: boolean; customType?: string };
  if (value.role === "custom" && value.customType === TUI_SUBMISSION_MESSAGE) {
    const document = (value.details as { document?: unknown } | undefined)?.document;
    return validateUiDocument(document) ? [document] : [];
  }
  if (value.role === "toolResult" && !value.isError && carriesUiDocument(value.toolName ?? "", value)) {
    const adapted = adaptToolResultToUiDocument(value.toolName ?? "", value);
    return adapted.ok ? [adapted.document] : [];
  }
  if (value.role !== "assistant") return [];
  const text = typeof value.content === "string" ? value.content : Array.isArray(value.content)
    ? value.content.map((part) => part?.type === "text" ? part.text : "").join("\n") : "";
  return splitAssistantOpenUiDocuments(text).documents.flatMap((source) => {
    const adapted = adaptUiDocument(source);
    return adapted.ok ? [adapted.document] : [];
  });
}

const PEDAGOGICAL_UI_TOOLS = new Set([
  "animate", "deck", "generate_image", "grade_quiz", "map", "plan", "quiz", "scene",
  "set_learner_goal", "verify",
]);

export function carriesUiDocument(toolName: string, result: unknown): boolean {
  if (PEDAGOGICAL_UI_TOOLS.has(toolName)) return true;
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const outer = result as Record<string, unknown>;
  if ("uiDocument" in outer || outer.protocol === "keating.ui" || (outer.schemaVersion === 1 && Array.isArray(outer.nodes))) return true;
  const details = outer.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  return ["uiDocument", "goal", "goals", "quiz", "question", "questions", "deck", "cards", "image", "scene", "storyboard"]
    .some((key) => key in (details as Record<string, unknown>));
}
