import type {
  UiAction as CanonicalUiAction,
  UiActionDispatcher,
  UiActionJournal,
  UiActionReceipt,
  UiActionResult,
  UiDocument as CanonicalUiDocument,
  UiDocumentNode,
} from "../learner-contracts.js";

/** Legacy protocol accepted only at the TUI import boundary. */
export const KEATING_UI_PROTOCOL = "keating.ui" as const;
export const KEATING_UI_VERSION = 1 as const;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type LegacyUiDocumentKind = "quiz" | "question" | "goal" | "deck" | "image" | "scene" | "artifact" | "generic";

export interface LegacyUiDocument {
  protocol: typeof KEATING_UI_PROTOCOL;
  version: typeof KEATING_UI_VERSION;
  id: string;
  revision: number;
  kind: LegacyUiDocumentKind;
  title?: string;
  status?: "active" | "submitted" | "completed" | "disabled" | "error";
  payload: Record<string, JsonValue>;
}

export type UiDocument = CanonicalUiDocument;
export type { CanonicalUiAction as UiAction, UiActionDispatcher, UiActionJournal, UiActionReceipt, UiActionResult, UiDocumentNode };

export interface UiRecovery {
  code: "invalid_json" | "invalid_document" | "unsupported_browser_program" | "unsupported_legacy_document" | "invalid_action" | "stale_document" | "idempotency_conflict" | "dispatch_failed";
  message: string;
  retryable: boolean;
  preserveEnteredWork: boolean;
  suggestedAction: "retry" | "correct-input" | "open-capable-surface" | "none";
}

export type UiDocumentAdaptation =
  | { ok: true; document: UiDocument; source: "canonical" | "legacy" }
  | { ok: false; recovery: UiRecovery };

export type UiActionDispatchOutcome =
  | { ok: true; result: UiActionResult; replayed: boolean; recovery?: UiRecovery }
  | { ok: false; recovery: UiRecovery };
