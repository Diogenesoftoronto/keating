import { KEATING_UI_PROTOCOL, KEATING_UI_VERSION, type JsonValue, type UiDocument, type UiDocumentKind } from "./types.js";

const KINDS = new Set<UiDocumentKind>(["quiz", "question", "goal", "deck", "image", "scene", "artifact", "generic"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): JsonValue {
  try { return JSON.parse(JSON.stringify(value)) as JsonValue; }
  catch { return String(value); }
}

export function isUiDocument(value: unknown): value is UiDocument {
  const item = record(value);
  return item.protocol === KEATING_UI_PROTOCOL
    && item.version === KEATING_UI_VERSION
    && typeof item.id === "string"
    && Number.isSafeInteger(item.revision)
    && KINDS.has(item.kind as UiDocumentKind)
    && !!item.payload && typeof item.payload === "object" && !Array.isArray(item.payload);
}

function inferredKind(toolName: string, details: Record<string, unknown>): UiDocumentKind {
  if (toolName === "quiz" || toolName === "grade_quiz" || details.quiz) return "quiz";
  if (toolName === "ask_user_question" || details.question || details.questions) return "question";
  if (details.goal || details.goals) return "goal";
  if (toolName === "deck" || details.deck || details.cards) return "deck";
  if (toolName === "generate_image" || details.image || details.imageUrl || details.dataUrl) return "image";
  if (toolName === "scene" || toolName === "animate" || details.scene || details.storyboard) return "scene";
  if (details.uri || details.filePath || /^(plan|map|verify)$/.test(toolName)) return "artifact";
  return "generic";
}

/** Convert tool/RPC payloads into the same wire shape used by the browser UI protocol. */
export function toolResultToUiDocument(toolName: string, result: unknown): UiDocument {
  const outer = record(result);
  if (isUiDocument(outer.uiDocument)) return outer.uiDocument;
  if (isUiDocument(result)) return result;
  const details = record(outer.details ?? result);
  const kind = inferredKind(toolName, details);
  let payload: Record<string, JsonValue>;
  if (kind === "quiz") payload = json(record(details.quiz ?? details)) as Record<string, JsonValue>;
  else if (kind === "question") payload = json(record(details.question ?? details)) as Record<string, JsonValue>;
  else if (kind === "goal") payload = json(record(details.goal ?? details)) as Record<string, JsonValue>;
  else if (kind === "deck") payload = json(record(details.deck ?? details)) as Record<string, JsonValue>;
  else if (kind === "image") payload = json(record(details.image ?? details)) as Record<string, JsonValue>;
  else if (kind === "scene") payload = json(record(details.scene ?? details)) as Record<string, JsonValue>;
  else if (kind === "artifact") payload = json(details) as Record<string, JsonValue>;
  else payload = { format: "json", data: json(details), originalKind: toolName };
  return { protocol: KEATING_UI_PROTOCOL, version: KEATING_UI_VERSION, id: String(details.id ?? `${toolName}-result`), revision: 0, kind, payload };
}
