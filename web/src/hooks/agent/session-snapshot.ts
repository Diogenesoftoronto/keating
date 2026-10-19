/**
 * What a session snapshot persists. Pure: given the live conversation state and
 * the stored copy, decides the title, ancestry and stored fields. The save
 * queue and storage writes live in useSessionPersistence.
 */
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionData, SessionMetadata } from "../../types/session";
import { hasAutoTitleContext } from "../session-auto-title";
import {
  sessionModelMetadata,
  sessionPreview,
  sessionSearchText,
  sessionTitle,
  sessionUsage,
} from "../session-metadata";

/**
 * Parent/fork identity of the active session. Only known for the session that
 * is live in this hook; saves of other sessions keep the stored ancestry.
 */
export interface SessionAncestry {
  parentSessionId: string | null;
  forkedAt: string | undefined;
}

export interface SnapshotTitle {
  title: string;
  /** The learner renamed the session; never overwrite it. */
  hasManualTitle: boolean;
  aiGeneratedTitle: boolean;
}

/** A stored title wins when the learner set it or an earlier AI title was accepted. */
export function resolveSnapshotTitle(
  existing: SessionData | null,
  messages: AgentMessage[],
): SnapshotTitle {
  const fallbackTitle = sessionTitle(messages);
  const existingFallbackTitle = existing
    ? sessionTitle(existing.messages)
    : "";
  const hasManualTitle = Boolean(
    existing &&
    existing.aiGeneratedTitle !== true &&
    existing.title.trim() &&
    existing.title.trim() !== existingFallbackTitle.trim(),
  );
  const title =
    existing && (hasManualTitle || existing.aiGeneratedTitle)
      ? existing.title
      : fallbackTitle;
  return { title, hasManualTitle, aiGeneratedTitle: existing?.aiGeneratedTitle ?? false };
}

export function buildSessionSnapshotRecord({
  sessionId,
  createdAt,
  now,
  model,
  thinkingLevel,
  messages,
  existing,
  ancestry,
}: {
  sessionId: string;
  createdAt: string;
  now: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  messages: AgentMessage[];
  existing: SessionData | null;
  ancestry: SessionAncestry | undefined;
}): { data: SessionData; metadata: SessionMetadata } & SnapshotTitle {
  const { title, hasManualTitle, aiGeneratedTitle } = resolveSnapshotTitle(existing, messages);
  const metadata: SessionMetadata = {
    id: sessionId,
    title,
    parentSessionId: ancestry ? ancestry.parentSessionId : existing?.parentSessionId ?? null,
    forkedAt: ancestry ? ancestry.forkedAt : existing?.forkedAt,
    forkedFromMessageTimestamp: existing?.forkedFromMessageTimestamp,
    createdAt,
    lastModified: now,
    messageCount: messages.length,
    usage: sessionUsage(messages),
    thinkingLevel,
    ...sessionModelMetadata(model),
    preview: sessionPreview(messages),
    searchText: sessionSearchText(messages),
    aiGeneratedTitle,
    generatedAlternative: existing?.generatedAlternative,
    hiddenAlternative: existing?.hiddenAlternative,
    alternativeForMessageTimestamp:
      existing?.alternativeForMessageTimestamp,
    responsePreference: existing?.responsePreference,
  };
  const data: SessionData = {
    id: sessionId,
    title,
    parentSessionId: ancestry ? ancestry.parentSessionId : existing?.parentSessionId ?? null,
    forkedAt: ancestry ? ancestry.forkedAt : existing?.forkedAt,
    forkedFromMessageTimestamp: existing?.forkedFromMessageTimestamp,
    model,
    thinkingLevel,
    messages,
    createdAt,
    lastModified: now,
    aiGeneratedTitle,
    generatedAlternative: existing?.generatedAlternative,
    hiddenAlternative: existing?.hiddenAlternative,
    alternativeForMessageTimestamp:
      existing?.alternativeForMessageTimestamp,
    responsePreference: existing?.responsePreference,
  };
  return { data, metadata, title, hasManualTitle, aiGeneratedTitle };
}

/** Ask the model for a title once per session, only while no title has been chosen. */
export function shouldRequestAutoTitle({
  hasManualTitle,
  aiGeneratedTitle,
  messages,
  alreadyRequested,
}: {
  hasManualTitle: boolean;
  aiGeneratedTitle: boolean;
  messages: AgentMessage[];
  alreadyRequested: boolean;
}): boolean {
  return (
    !hasManualTitle &&
    !aiGeneratedTitle &&
    hasAutoTitleContext(messages) &&
    !alreadyRequested
  );
}
