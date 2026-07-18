export const KEATING_UI_PROTOCOL = "keating.ui" as const;
export const KEATING_UI_VERSION = 1 as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type UiDocumentKind = "quiz" | "question" | "goal" | "deck" | "image" | "scene" | "artifact" | "generic";

export interface UiActionDefinition {
  id: string;
  kind: string;
  label: string;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
  input?: Record<string, JsonValue>;
}

export interface UiDocument {
  protocol: typeof KEATING_UI_PROTOCOL;
  version: typeof KEATING_UI_VERSION;
  id: string;
  revision: number;
  kind: UiDocumentKind;
  title?: string;
  status?: "active" | "submitted" | "completed" | "disabled" | "error";
  actions?: UiActionDefinition[];
  payload: Record<string, JsonValue>;
}

export interface UiActionRequest {
  protocol: typeof KEATING_UI_PROTOCOL;
  version: typeof KEATING_UI_VERSION;
  id: string;
  documentId: string;
  documentRevision: number;
  actionId: string;
  createdAt: string;
  payload: Record<string, JsonValue>;
}
