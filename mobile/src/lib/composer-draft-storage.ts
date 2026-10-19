import AsyncStorage from "@react-native-async-storage/async-storage";
import { createEpochDraftStore, type DraftStorage, type DraftWriter } from "./draft-store";
import type { ChatAttachment } from "./types";

const COMPOSER_DRAFT_KEY = "keating.mobile.composer-draft.v1";

export interface ComposerDraft {
  text: string;
  attachments: ChatAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAttachment(value: unknown): ChatAttachment | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || (value.kind !== "image" && value.kind !== "document")
    || typeof value.name !== "string"
    || typeof value.mimeType !== "string"
    || typeof value.size !== "number"
    || !Number.isFinite(value.size)
    || value.size <= 0
    || typeof value.uri !== "string"
    || !value.uri.startsWith("file://")) return null;
  return {
    id: value.id,
    kind: value.kind,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    uri: value.uri,
  };
}

export function normalizeComposerDraft(value: unknown): ComposerDraft {
  if (!isRecord(value)) return { text: "", attachments: [] };
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(normalizeAttachment).filter((entry): entry is ChatAttachment => entry !== null).slice(0, 4)
    : [];
  return {
    text: typeof value.text === "string" ? value.text.slice(0, 12_000) : "",
    attachments,
  };
}

function draftKey(sessionId: string): string {
  return `${COMPOSER_DRAFT_KEY}.${sessionId}`;
}

/** The subset of AsyncStorage used here, so tests can supply an in-memory store. */
export type ComposerDraftStorage = DraftStorage;

export async function loadComposerDraft(sessionId: string, storage: ComposerDraftStorage = AsyncStorage): Promise<ComposerDraft> {
  const raw = await storage.getItem(draftKey(sessionId));
  if (!raw) return { text: "", attachments: [] };
  return normalizeComposerDraft(JSON.parse(raw));
}

/** Empty drafts remove the key, so a cleared composer leaves nothing behind. */
function encodeComposerDraft(draft: ComposerDraft): string | null {
  const normalized = normalizeComposerDraft(draft);
  return !normalized.text && normalized.attachments.length === 0 ? null : JSON.stringify(normalized);
}

// A stale writer cannot re-persist attachment records that point at files a clear deleted.
const composerDrafts = createEpochDraftStore<ComposerDraft>(COMPOSER_DRAFT_KEY, encodeComposerDraft);

export function currentComposerDraftEpoch(): number {
  return composerDrafts.currentEpoch();
}

/** Resolves true when the write happened, false when dropped because the epoch is stale or a clear is running. */
export function saveComposerDraft(
  sessionId: string,
  draft: ComposerDraft,
  storage: ComposerDraftStorage = AsyncStorage,
  epoch?: number,
): Promise<boolean> {
  return composerDrafts.save(draftKey(sessionId), draft, storage, epoch);
}

export async function clearComposerDraft(sessionId: string, storage: ComposerDraftStorage = AsyncStorage): Promise<void> {
  await storage.removeItem(draftKey(sessionId));
}

/** Invalidates every live writer, lets writes already started land, then deletes all composer drafts. */
export function clearAllComposerDrafts(storage: ComposerDraftStorage = AsyncStorage): Promise<void> {
  return composerDrafts.clearAll(storage);
}

export type ComposerDraftWriter = DraftWriter<ComposerDraft>;

/** One writer per session; bound to the deletion epoch it was created under. */
export function createComposerDraftWriter(sessionId: string, storage: ComposerDraftStorage = AsyncStorage): ComposerDraftWriter {
  return composerDrafts.createWriter(draftKey(sessionId), storage);
}
