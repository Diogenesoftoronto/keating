import type {
  ChatMessage,
  ChatSession,
  PersistedAppState,
  ProviderId,
  ProviderSettings,
  StudyArtifact,
} from "./types";
import { validateAgentStream } from "@keating/learner-contracts";

type PersistedAppStateV1 = Omit<PersistedAppState, "schemaVersion"> & { schemaVersion: 1 };
type PersistedAppStateV2 = Omit<PersistedAppState, "schemaVersion"> & { schemaVersion: 2 };
type PersistedAppStateV3 = Omit<PersistedAppState, "schemaVersion"> & { schemaVersion: 3 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isProviderId(value: unknown): value is ProviderId {
  return ["openai", "anthropic", "google", "openrouter", "custom"].includes(String(value));
}

function isChatAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasLocalFile = typeof value.uri === "string"
    && value.uri.startsWith("file://")
    && value.localState === undefined;
  const isMissingLocalFile = value.uri === undefined && value.localState === "missing";
  return typeof value.id === "string"
    && (value.kind === "image" || value.kind === "document")
    && typeof value.name === "string"
    && typeof value.mimeType === "string"
    && isFiniteNumber(value.size)
    && value.size > 0
    && (hasLocalFile || isMissingLocalFile)
    && value.data === undefined
    && value.encoding === undefined;
}

function isProviderUsage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.inputTokens) && value.inputTokens >= 0
    && isFiniteNumber(value.outputTokens) && value.outputTokens >= 0
    && isFiniteNumber(value.totalTokens) && value.totalTokens >= 0
    && (value.costUsd === undefined || (isFiniteNumber(value.costUsd) && value.costUsd >= 0));
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && (value.role === "user" || value.role === "assistant")
    && typeof value.content === "string"
    && isFiniteNumber(value.createdAt)
    && (value.attachments === undefined
      || (Array.isArray(value.attachments) && value.attachments.every(isChatAttachment)))
    && (value.role === "user" || value.attachments === undefined)
    && (value.provider === undefined || isProviderId(value.provider))
    && (value.model === undefined || typeof value.model === "string")
    && (value.usage === undefined || isProviderUsage(value.usage))
    && (value.agentEvents === undefined || (value.role === "assistant" && validateAgentStream(value.agentEvents)))
    && (value.feedback === undefined || value.feedback === "helpful" || value.feedback === "missed")
    && (value.feedbackAt === undefined || (isFiniteNumber(value.feedbackAt) && value.feedback !== undefined));
}

function isChatSession(value: unknown): value is ChatSession {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.title === "string"
    && isFiniteNumber(value.createdAt)
    && isFiniteNumber(value.updatedAt)
    && Array.isArray(value.messages)
    && value.messages.every(isChatMessage)
    && (value.parentSessionId === undefined || typeof value.parentSessionId === "string")
    && (value.forkedFromMessageId === undefined || typeof value.forkedFromMessageId === "string")
    && (value.forkedAt === undefined || isFiniteNumber(value.forkedAt));
}

function isArtifact(value: unknown): value is StudyArtifact {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.kind === "string"
    && typeof value.title === "string"
    && typeof value.content === "string"
    && isFiniteNumber(value.createdAt);
}

function isProviderSettings(value: unknown): value is ProviderSettings {
  if (!isRecord(value)) return false;
  return isProviderId(value.provider)
    && typeof value.model === "string"
    && typeof value.baseUrl === "string"
    && isFiniteNumber(value.temperature);
}

function isPersistedShape(value: Record<string, unknown>): boolean {
  const feedback = value.learnerFeedback;
  return Array.isArray(value.sessions)
    && value.sessions.every(isChatSession)
    && typeof value.activeSessionId === "string"
    && Array.isArray(value.artifacts)
    && value.artifacts.every(isArtifact)
    && isProviderSettings(value.providerSettings)
    && isRecord(feedback)
    && isFiniteNumber(feedback.helpful)
    && isFiniteNumber(feedback.missed);
}

/** Validate before migration so malformed local data is never overwritten. */
export function migratePersistedState(candidate: unknown): PersistedAppState | null {
  if (!isRecord(candidate) || !isPersistedShape(candidate)) return null;
  if (candidate.schemaVersion === 4) return candidate as unknown as PersistedAppState;
  if (candidate.schemaVersion === 3) {
    const previous = candidate as unknown as PersistedAppStateV3;
    return { ...previous, schemaVersion: 4 };
  }
  if (candidate.schemaVersion === 2) {
    const previous = candidate as unknown as PersistedAppStateV2;
    return { ...previous, schemaVersion: 4 };
  }
  if (candidate.schemaVersion === 1) {
    const legacy = candidate as unknown as PersistedAppStateV1;
    return { ...legacy, schemaVersion: 4 };
  }
  return null;
}
