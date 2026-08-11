import {
  tryCompileOpenUISourceToSharedDocument,
  validateUiDocument,
  type UiDocument,
  type UiDocumentRetention,
} from "@keating/learner-contracts";

export interface ExtractedUiDocuments {
  content: string;
  documents: UiDocument[];
  errors: string[];
}

const OPENING_FENCE = /^```(keating-ui|ui-document|openui-json|openui)(?:[ \t]+([^\n]*))?\n/gm;
const MAX_DOCUMENTS = 8;
const MAX_VISIBLE_RECOVERY_SOURCE = 16_384;

interface WireMetadata {
  id: string;
  revision: number;
  retention?: UiDocumentRetention;
}

function scopeHash(value: string, seed: number): string {
  let result = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/** Namespace a model-authored ID to the persisted session/message event. */
export function scopeUiDocument(document: UiDocument, scope: string): UiDocument {
  if (!scope.trim()) throw new Error("OpenUI document scope is required.");
  const suffix = `${scopeHash(scope, 2166136261)}${scopeHash([...scope].reverse().join(""), 2246822519)}`;
  return { ...structuredClone(document), id: `${document.id.slice(0, 96)}--${suffix}` };
}

function parseWireMetadata(header: string | undefined, body: string, fenceIndex: number): WireMetadata {
  const entries = new Map<string, string>();
  for (const token of header?.trim().split(/\s+/) ?? []) {
    const separator = token.indexOf("=");
    if (separator > 0) entries.set(token.slice(0, separator), token.slice(separator + 1));
  }
  const candidateId = entries.get("id");
  const id = candidateId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidateId)
    ? candidateId
    : `openui-${scopeHash(`${fenceIndex}:${body}`, 2166136261)}`;
  const rawRevision = entries.get("revision");
  const revision = rawRevision && /^\d+$/.test(rawRevision) && Number.isSafeInteger(Number(rawRevision))
    ? Number(rawRevision)
    : 0;
  const lifecycle = entries.get("lifecycle");
  const retention = lifecycle === "ephemeral" || lifecycle === "resumable" || lifecycle === "workspace"
    ? lifecycle
    : undefined;
  return { id, revision, ...(retention ? { retention } : {}) };
}

function recoveryMarkdown(message: string, source: string): string {
  const truncated = source.length > MAX_VISIBLE_RECOVERY_SOURCE;
  const visible = source.slice(0, MAX_VISIBLE_RECOVERY_SOURCE);
  const indented = visible.split("\n").map((line) => `    ${line}`).join("\n");
  return [
    "> **Interactive document recovery**",
    `> ${message}`,
    "",
    "The source is preserved below as inert text and was not executed.",
    "",
    indented,
    ...(truncated ? ["", "_Source truncated at the mobile recovery display limit._"] : []),
  ].join("\n");
}

function failureMessage(kind: "partial" | "invalid" | "unsafe" | "unsupported", detail: string): string {
  const label = kind === "partial" ? "incomplete" : kind;
  return `Interactive document is ${label}: ${detail}`;
}

/**
 * Compiles canonical JSON and the bounded OpenUI data language into validated
 * shared documents. Model-authored JavaScript and HTML are never evaluated.
 */
export function extractUiDocuments(source: string): ExtractedUiDocuments {
  const documents: UiDocument[] = [];
  const errors: string[] = [];
  const text: string[] = [];
  let cursor = 0;
  let fenceCount = 0;
  OPENING_FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPENING_FENCE.exec(source)) !== null) {
    const bodyStart = OPENING_FENCE.lastIndex;
    const closingMatch = /^```[ \t]*$/m.exec(source.slice(bodyStart));
    text.push(source.slice(cursor, match.index));
    const bodyEnd = closingMatch ? bodyStart + closingMatch.index : source.length;
    const fenceEnd = closingMatch ? bodyEnd + closingMatch[0].length : source.length;
    const body = source.slice(bodyStart, bodyEnd).trim();
    fenceCount += 1;
    if (!closingMatch) {
      const message = failureMessage("partial", "the response ended before its closing fence.");
      errors.push(message);
      text.push(recoveryMarkdown(message, body));
      cursor = source.length;
      break;
    }
    if (fenceCount > MAX_DOCUMENTS) {
      const message = "This response contains more interactive documents than mobile can safely render.";
      errors.push(message);
      text.push(recoveryMarkdown(message, body));
    } else {
      const metadata = parseWireMetadata(match[2], body, match.index);
      const format = match[1];
      const sourceForm = format === "openui" && !body.trimStart().startsWith("{");
      if (sourceForm) {
        const compiled = tryCompileOpenUISourceToSharedDocument(body, {
          documentId: metadata.id,
          revision: metadata.revision,
          ...(metadata.retention ? { retention: metadata.retention } : {}),
        });
        if (compiled.ok) {
          documents.push(compiled.document);
        } else {
          const message = failureMessage(compiled.kind, compiled.message);
          errors.push(message);
          text.push(recoveryMarkdown(message, compiled.source));
        }
      } else {
        try {
          const candidate = JSON.parse(body) as unknown;
          if (!validateUiDocument(candidate)) throw new Error("document schema is invalid or belongs to a future contract version");
          if (!candidate.supportedSurfaces.includes("mobile")) {
            const message = `Interactive document ${candidate.id} does not declare mobile support.`;
            errors.push(message);
            text.push(recoveryMarkdown(message, body));
          } else {
            documents.push(candidate);
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : "document data is invalid";
          const message = failureMessage("invalid", detail);
          errors.push(message);
          text.push(recoveryMarkdown(message, body));
        }
      }
    }
    cursor = fenceEnd;
    if (source[cursor] === "\n") cursor += 1;
    OPENING_FENCE.lastIndex = cursor;
  }
  if (cursor < source.length) text.push(source.slice(cursor));
  return { content: text.join("").trim(), documents, errors };
}

/** Prevent partially streamed JSON from flashing as a code block. */
export function hideUnclosedUiDocumentFence(source: string): string {
  OPENING_FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastUnclosed = -1;
  while ((match = OPENING_FENCE.exec(source)) !== null) {
    const closing = /^```[ \t]*$/m.exec(source.slice(OPENING_FENCE.lastIndex));
    if (!closing) {
      lastUnclosed = match.index;
      break;
    }
    OPENING_FENCE.lastIndex += closing.index + closing[0].length;
  }
  const withoutOpenFence = lastUnclosed < 0 ? source : source.slice(0, lastUnclosed).trimEnd();
  return hidePotentialOpeningFence(withoutOpenFence);
}

const UI_FENCE_PREFIXES = ["```keating-ui", "```ui-document", "```openui-json", "```openui"] as const;

function hidePotentialOpeningFence(source: string): string {
  const lineStart = source.lastIndexOf("\n") + 1;
  const candidate = source.slice(lineStart);
  // Three bare ticks may be a closing fence; wait for a label prefix before
  // treating the last line as a split UI opener.
  if (!candidate.startsWith("`") || candidate === "```") return source;
  const isPrefix = UI_FENCE_PREFIXES.some((prefix) => prefix.startsWith(candidate));
  const isHeader = UI_FENCE_PREFIXES.some((prefix) => candidate.startsWith(prefix)
    && /^[ \t]+[^\n]*$/.test(candidate.slice(prefix.length)));
  return isPrefix || isHeader ? source.slice(0, lineStart).trimEnd() : source;
}

/** Remove complete, incomplete, and split-prefix UI wire while a turn streams. */
export function hideUiDocumentWireWhileStreaming(source: string): string {
  const visible: string[] = [];
  let cursor = 0;
  OPENING_FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPENING_FENCE.exec(source)) !== null) {
    visible.push(source.slice(cursor, match.index));
    const closing = /^```[ \t]*$/m.exec(source.slice(OPENING_FENCE.lastIndex));
    if (!closing) {
      cursor = source.length;
      break;
    }
    cursor = OPENING_FENCE.lastIndex + closing.index + closing[0].length;
    if (source[cursor] === "\n") cursor += 1;
    OPENING_FENCE.lastIndex = cursor;
  }
  if (cursor < source.length) visible.push(source.slice(cursor));
  return hidePotentialOpeningFence(visible.join("")).trimEnd();
}
