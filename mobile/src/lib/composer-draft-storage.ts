import AsyncStorage from "@react-native-async-storage/async-storage";
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

export async function loadComposerDraft(sessionId: string): Promise<ComposerDraft> {
  const raw = await AsyncStorage.getItem(draftKey(sessionId));
  if (!raw) return { text: "", attachments: [] };
  return normalizeComposerDraft(JSON.parse(raw));
}

export async function saveComposerDraft(sessionId: string, draft: ComposerDraft): Promise<void> {
  const normalized = normalizeComposerDraft(draft);
  if (!normalized.text && normalized.attachments.length === 0) {
    await AsyncStorage.removeItem(draftKey(sessionId));
    return;
  }
  await AsyncStorage.setItem(draftKey(sessionId), JSON.stringify(normalized));
}

export async function clearComposerDraft(sessionId: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(sessionId));
}

export async function clearAllComposerDrafts(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const draftKeys = keys.filter((key) => key.startsWith(`${COMPOSER_DRAFT_KEY}.`));
  if (draftKeys.length) await AsyncStorage.multiRemove(draftKeys);
}
