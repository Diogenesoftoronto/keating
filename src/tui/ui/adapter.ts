import { validateUiDocument, type UiArtifactResource, type UiDocumentNode } from "../learner-contracts.js";

import {
  KEATING_UI_PROTOCOL,
  KEATING_UI_VERSION,
  type JsonValue,
  type LegacyUiDocument,
  type LegacyUiDocumentKind,
  type UiDocument,
  type UiDocumentAdaptation,
  type UiRecovery,
} from "./types.js";

const LEGACY_KINDS = new Set<LegacyUiDocumentKind>(["quiz", "question", "goal", "deck", "image", "scene", "artifact", "generic"]);
const RECOVERY_TIME = "1970-01-01T00:00:00.000Z";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => asRecord(item) ? [item] : []) : [];
}

function safeId(value: unknown, fallback: string): string {
  const candidate = string(value).replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+/, "").slice(0, 128);
  return /^[A-Za-z0-9]/.test(candidate) ? candidate : fallback;
}

function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(json);
  const object = asRecord(value);
  if (object) return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, json(child)]));
  return String(value);
}

function recovery(code: UiRecovery["code"], message: string, retryable: boolean, suggestedAction: UiRecovery["suggestedAction"]): UiDocumentAdaptation {
  return { ok: false, recovery: { code, message, retryable, preserveEnteredWork: true, suggestedAction } };
}

function canonicalDocument(id: string, revision: number, title: string | undefined, nodes: UiDocumentNode[]): UiDocument {
  return {
    schemaVersion: 1,
    id: safeId(id, "legacy-document"),
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    lifecycle: "ready",
    supportedSurfaces: ["terminal"],
    title,
    nodes,
    createdAt: RECOVERY_TIME,
    updatedAt: RECOVERY_TIME,
  };
}

function markdownNode(id: string, markdown: string): UiDocumentNode {
  return { type: "markdown", id: safeId(id, "legacy-content"), markdown };
}

function legacyResource(payload: Record<string, unknown>, fallbackId: string): UiArtifactResource | undefined {
  const uri = string(payload.uri || payload.url);
  if (!uri) return undefined;
  try {
    const parsed = new URL(uri);
    const safe = parsed.protocol === "https:" || (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") ) || parsed.protocol === "artifact:";
    if (!safe || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  } catch { return undefined; }
  return {
    id: safeId(payload.artifactId || payload.id, fallbackId),
    title: string(payload.label || payload.title, "Imported resource"),
    format: "uri",
    uri,
    ...(typeof payload.mimeType === "string" ? { mimeType: payload.mimeType } : {}),
  };
}

function convertLegacyDocument(legacy: LegacyUiDocument): UiDocumentAdaptation {
  const payload = legacy.payload as Record<string, unknown>;
  const baseId = safeId(legacy.id, "legacy-document");
  const title = legacy.title;
  let nodes: UiDocumentNode[];

  switch (legacy.kind) {
    case "quiz": {
      const questions = list(payload.questions).map((question, index) => ({
        id: safeId(question.id, `${baseId}-quiz-${index + 1}`),
        prompt: string(question.prompt || question.question, "Question"),
      }));
      nodes = [{ type: "quiz", id: `${baseId}-quiz`, title: title || string(payload.topic, "Quiz"), questions }];
      break;
    }
    case "question": {
      const fields = list(payload.fields || payload.questions);
      nodes = (fields.length ? fields : [payload]).map((question, index) => ({
        type: "question",
        id: safeId(question.id, `${baseId}-question-${index + 1}`),
        prompt: string(question.prompt || question.question, "Question"),
      }));
      break;
    }
    case "goal": {
      const steps = list(payload.steps).map((step, index) => ({
        id: safeId(step.id, `${baseId}-step-${index + 1}`),
        title: string(step.title, `Step ${index + 1}`),
        status: step.status === "done" ? "done" as const : step.status === "in_progress" ? "in_progress" as const : "not_started" as const,
      }));
      nodes = [{ type: "goal", id: `${baseId}-goal`, title: title || string(payload.title, "Learning goal"), ...(typeof payload.description === "string" ? { description: payload.description } : {}), status: payload.status === "completed" ? "completed" : payload.status === "paused" ? "paused" : "active", steps }];
      break;
    }
    case "deck": {
      const cards = list(payload.cards).map((card, index) => ({ id: safeId(card.id, `${baseId}-card-${index + 1}`), front: string(card.front, "Prompt"), back: string(card.back, "Answer") }));
      nodes = [{ type: "deck", id: `${baseId}-deck`, title: title || string(payload.title, "Flashcards"), topic: string(payload.topic, "Imported"), cards }];
      break;
    }
    case "image": {
      const resource = legacyResource(payload, `${baseId}-image-resource`);
      nodes = resource
        ? [{ type: "image", id: `${baseId}-image`, alt: string(payload.alt, "Imported image"), resource }]
        : [markdownNode(`${baseId}-image-info`, `Image: ${string(payload.title, "Imported image")}\n${string(payload.alt, "No terminal-safe image URI was supplied.")}`)];
      break;
    }
    case "artifact": {
      const resource = legacyResource(payload, `${baseId}-artifact-resource`);
      nodes = resource
        ? [{ type: "artifact", id: `${baseId}-artifact`, resource }]
        : [markdownNode(`${baseId}-artifact-info`, `Artifact: ${string(payload.label || payload.title, "Imported artifact")}\n${string(payload.content || payload.filePath || payload.uri, "No portable resource was supplied.")}`)];
      break;
    }
    case "scene":
      nodes = [markdownNode(`${baseId}-scene`, [string(payload.summary), string(payload.storyboard), string(payload.body || payload.markdown)].filter(Boolean).join("\n\n") || "Scene details are unavailable.")];
      break;
    case "generic":
      nodes = [markdownNode(`${baseId}-content`, string(payload.content, JSON.stringify(json(payload.data ?? payload), null, 2)))];
      break;
  }

  const document = canonicalDocument(baseId, legacy.revision, title, nodes!);
  return validateUiDocument(document)
    ? { ok: true, document, source: "legacy" }
    : recovery("unsupported_legacy_document", "This legacy keating.ui result cannot be represented safely in the shared document contract.", true, "open-capable-surface");
}

function legacyDocument(value: unknown): LegacyUiDocument | undefined {
  const item = asRecord(value);
  if (!item || item.protocol !== KEATING_UI_PROTOCOL || item.version !== KEATING_UI_VERSION || typeof item.id !== "string" || !Number.isSafeInteger(item.revision)
    || !LEGACY_KINDS.has(item.kind as LegacyUiDocumentKind) || !asRecord(item.payload)) return undefined;
  return item as unknown as LegacyUiDocument;
}

/** Parse JSON only. Browser/OpenUI programs are intentionally never evaluated in terminal code. */
export function adaptUiDocument(value: unknown): UiDocumentAdaptation {
  let candidate = value;
  if (typeof candidate === "string") {
    const source = candidate;
    try { candidate = JSON.parse(source); }
    catch {
      return source.includes("=") || source.includes("(")
        ? recovery("unsupported_browser_program", "Terminal UI accepts canonical JSON documents, not executable browser UI programs. Open this on a capable surface.", false, "open-capable-surface")
        : recovery("invalid_json", "The UI document was not valid JSON. Keep your entered work and correct the document before retrying.", true, "correct-input");
    }
  }
  if (validateUiDocument(candidate)) return { ok: true, document: candidate, source: "canonical" };
  const legacy = legacyDocument(candidate);
  if (legacy) return convertLegacyDocument(legacy);
  return recovery("invalid_document", "The UI document does not satisfy the shared contract. Nothing was executed; correct it and retry.", true, "correct-input");
}

function inferredKind(toolName: string, details: Record<string, unknown>): LegacyUiDocumentKind {
  if (toolName === "quiz" || toolName === "grade_quiz" || details.quiz) return "quiz";
  if (toolName === "ask_user_question" || details.question || details.questions) return "question";
  if (details.goal || details.goals) return "goal";
  if (toolName === "deck" || details.deck || details.cards) return "deck";
  if (toolName === "generate_image" || details.image || details.imageUrl || details.dataUrl) return "image";
  if (toolName === "scene" || toolName === "animate" || details.scene || details.storyboard) return "scene";
  if (details.uri || details.filePath || /^(plan|map|verify)$/.test(toolName)) return "artifact";
  return "generic";
}

/**
 * Import existing tool/RPC results through the legacy boundary.  This keeps
 * old keating.ui payloads working while all presentation receives canonical
 * shared documents.
 */
export function adaptToolResultToUiDocument(toolName: string, result: unknown): UiDocumentAdaptation {
  const outer = asRecord(result) ?? {};
  const direct = adaptUiDocument(outer.uiDocument ?? result);
  if (direct.ok || legacyDocument(outer.uiDocument ?? result) || (typeof (outer.uiDocument ?? result) === "string")) return direct;
  const details = asRecord(outer.details) ?? asRecord(result) ?? {};
  const kind = inferredKind(toolName, details);
  const payloadSource = asRecord(details[kind]) ?? details;
  const legacy: LegacyUiDocument = {
    protocol: KEATING_UI_PROTOCOL,
    version: KEATING_UI_VERSION,
    id: safeId(details.id, `${safeId(toolName, "tool")}-result`),
    revision: 0,
    kind,
    payload: json(payloadSource) as Record<string, JsonValue>,
  };
  return convertLegacyDocument(legacy);
}

/** Backward-compatible convenience for call sites that always need a card. */
export function toolResultToUiDocument(toolName: string, result: unknown): UiDocument {
  const adapted = adaptToolResultToUiDocument(toolName, result);
  if (adapted.ok) return adapted.document;
  return canonicalDocument("ui-recovery", 0, "UI document needs attention", [
    { type: "callout", id: "ui-recovery-message", tone: "warning", title: "Recoverable UI input", markdown: adapted.recovery.message },
    { type: "handoff", id: "ui-recovery-handoff", target: "web", reason: "A capable surface can inspect or repair this UI document.", context: adapted.recovery.code },
  ]);
}
