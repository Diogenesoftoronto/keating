/**
 * Session records read and written by navigation and response comparison:
 * fork banners, whether restored history was already answered, and the stored
 * outcome of a learner's choice between the original reply and an alternative.
 */
import type { ForkInfo } from "../../stores/keating-agent-store";
import type { ResponseComparisonDecision } from "../../keating/response-comparison";
import type { SessionData, SessionMetadata } from "../../types/session";
import { sessionPreview, sessionUsage } from "../session-metadata";

/** Banner state shown immediately on open; the parent title arrives later. */
export function initialForkInfo(session: Pick<SessionData, "parentSessionId" | "forkedAt">): ForkInfo | null {
  return session.parentSessionId && session.forkedAt
    ? { parentId: session.parentSessionId, parentTitle: "original session", forkedAt: session.forkedAt }
    : null;
}

/**
 * Records the learner's preference on the alternative session. Only a chosen
 * alternative stays visible in the session browser.
 */
export function recordResponsePreference({
  alternative,
  existingMetadata,
  preference,
  originalMessageTimestamp,
  now,
}: {
  alternative: SessionData;
  existingMetadata: SessionMetadata | null;
  preference: ResponseComparisonDecision;
  originalMessageTimestamp: number;
  now: string;
}): { data: SessionData; metadata: SessionMetadata } {
  const data: SessionData = {
    ...alternative,
    hiddenAlternative: preference !== "alternative",
    responsePreference: preference,
    lastModified: now,
  };
  const metadata: SessionMetadata = {
    ...(existingMetadata ?? {
      id: alternative.id,
      title: alternative.title,
      createdAt: alternative.createdAt,
      messageCount: alternative.messages.length,
      usage: sessionUsage(alternative.messages),
      thinkingLevel: alternative.thinkingLevel,
      preview: sessionPreview(alternative.messages),
    }),
    lastModified: now,
    generatedAlternative: true,
    hiddenAlternative: preference !== "alternative",
    alternativeForMessageTimestamp: originalMessageTimestamp,
    responsePreference: preference,
  };
  return { data, metadata };
}

/** Whether the restored history already holds a settled teacher reply. */
export function sessionHasSettledReply(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    const candidate = message as { role?: unknown; stopReason?: unknown };
    return (
      candidate.role === "assistant" &&
      candidate.stopReason !== "error" &&
      candidate.stopReason !== "aborted"
    );
  });
}
