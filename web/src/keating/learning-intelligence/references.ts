import { learningSourceHash, LEARNING_EXTRACTION_KINDS, type LearningEvidenceAnchor, type LearningExtractionKind } from "@keating/learner-contracts";

/**
 * Passages Clairic grounded in this conversation, offered to the tutor under a
 * short id it can cite as `[label](#ref-…)`. The index outlives the evidence
 * cache so an old reply's citation still resolves after newer turns evict it.
 */
export interface LearningReference { readonly id: string; readonly kind: LearningExtractionKind; readonly anchor: LearningEvidenceAnchor }
type ReferenceStorage = Pick<Storage, "getItem" | "setItem">;

const MAX_REFERENCES = 200;
const REFERENCE_ID = /^ref-[0-9a-f]{10}$/;
export const LEARNING_REFERENCES_CHANGED_EVENT = "keating:learning-references-changed";
const storageKey = (sessionId: string) => `keating:learning-references:v1:${sessionId}`;

export function learningReferenceId(anchor: LearningEvidenceAnchor): string {
  const digest = learningSourceHash(`${anchor.messageId}\n${anchor.start}\n${anchor.end}\n${anchor.sourceHash}`);
  return `ref-${digest.slice(-10)}`;
}

/** `#ref-…` fragments survive Markdown URL sanitising, unlike a custom scheme. */
export function learningReferenceFromHref(href: string | undefined): string | null {
  const id = href?.startsWith("#") ? href.slice(1) : "";
  return REFERENCE_ID.test(id) ? id : null;
}

function validReference(value: unknown, sessionId: string): value is LearningReference {
  if (!value || typeof value !== "object") return false;
  const { id, kind, anchor } = value as Record<string, unknown>;
  if (typeof id !== "string" || !REFERENCE_ID.test(id) || !(LEARNING_EXTRACTION_KINDS as readonly string[]).includes(String(kind))) return false;
  if (!anchor || typeof anchor !== "object") return false;
  const a = anchor as Record<string, unknown>;
  return a.sessionId === sessionId && typeof a.messageId === "string" && typeof a.quote === "string" && a.quote.length <= 4000
    && typeof a.sourceHash === "string" && Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end);
}

function read(sessionId: string, storage: ReferenceStorage | undefined): LearningReference[] {
  try {
    const text = storage?.getItem(storageKey(sessionId));
    const value: unknown = text && text.length <= 1_000_000 ? JSON.parse(text) : null;
    return Array.isArray(value) ? value.filter((item): item is LearningReference => validReference(item, sessionId)) : [];
  } catch {
    return [];
  }
}

function browserStorage(): ReferenceStorage | undefined {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
}

export function rememberLearningReferences(sessionId: string, references: readonly LearningReference[], storage: ReferenceStorage | undefined = browserStorage()): void {
  if (!references.length) return;
  const known = read(sessionId, storage);
  const ids = new Set(known.map(reference => reference.id));
  const added = references.filter(reference => !ids.has(reference.id) && Boolean(ids.add(reference.id)));
  if (!added.length) return;
  try {
    storage?.setItem(storageKey(sessionId), JSON.stringify([...known, ...added].slice(-MAX_REFERENCES)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(LEARNING_REFERENCES_CHANGED_EVENT));
  } catch { /* The reply still reads as plain text when its citation cannot resolve. */ }
}

/** Opting out erases derived data; cited replies then read as plain text. */
export function forgetLearningReferences(sessionId: string, storage: Pick<Storage, "removeItem"> | undefined = browserStorage() as Storage | undefined): void {
  storage?.removeItem(storageKey(sessionId));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LEARNING_REFERENCES_CHANGED_EVENT));
}

export function findLearningReference(sessionId: string | undefined, id: string, storage: ReferenceStorage | undefined = browserStorage()): LearningReference | null {
  if (!sessionId) return null;
  return read(sessionId, storage).find(reference => reference.id === id) ?? null;
}
