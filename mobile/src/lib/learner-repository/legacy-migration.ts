import {
  isContractId,
  validatePortableLearnerData,
  type LearnerArtifact,
  type LearnerMessage,
  type LearnerFeedbackEvent,
  type LearnerSession,
  type LearnerUsageEvent,
  type PortableLearnerData,
  type TopicEvidence,
} from "@keating/learner-contracts";
import type { PersistedAppState, StudyArtifact } from "../types";
import type { LearnerRepository } from "./index";
import type { LocalAttachmentLocation } from "./records";
import { durableAgentEvents } from "../durable-agent-events";

export const LEGACY_ASYNC_STORAGE_MIGRATION_ID = "async-storage-v1-to-sqlite-v2";

export interface LegacyMigrationConversion {
  data: PortableLearnerData;
  localAttachments: LocalAttachmentLocation[];
  legacyFeedback: { helpful: number; missed: number };
  warnings: string[];
}

function isoTimestamp(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`Legacy ${label} timestamp is invalid.`);
  const timestamp = new Date(value).toISOString();
  if (timestamp === "+275760-09-13T00:00:00.000Z" || timestamp.startsWith("-")) {
    throw new Error(`Legacy ${label} timestamp is outside the portable range.`);
  }
  return timestamp;
}

function requireContractId(value: string, label: string): string {
  if (!isContractId(value)) throw new Error(`Legacy ${label} id cannot be migrated without changing learner data.`);
  return value;
}

function stableRelatedId(prefix: string, ...parts: string[]): string {
  const raw = `${prefix}.${parts.join(".")}`;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) return raw;
  let hash = 0x811c9dc5;
  for (const character of raw) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(16).padStart(8, "0");
  const shortened = raw.slice(0, 118 - suffix.length).replace(/[^A-Za-z0-9._-]/g, "-");
  return `${shortened}.${suffix}`;
}

function artifactKind(artifact: StudyArtifact): LearnerArtifact["kind"] {
  if (artifact.kind === "concept-map") return "lesson-map";
  return artifact.kind;
}

function artifactFormat(artifact: StudyArtifact): LearnerArtifact["format"] {
  if (artifact.kind === "concept-map") return "mermaid";
  if (artifact.kind === "quiz") return "quiz";
  return "markdown";
}

function maxGeneratedAt(state: PersistedAppState): string {
  const timestamps = [
    ...state.sessions.flatMap((session) => [session.createdAt, session.updatedAt, ...session.messages.map((message) => message.createdAt)]),
    ...state.artifacts.map((artifact) => artifact.createdAt),
  ];
  return isoTimestamp(timestamps.length ? Math.max(...timestamps) : 0, "generated-at");
}

/** Converts the validated legacy blob without guessing mastery or estimated usage. */
export function convertLegacyPersistedState(state: PersistedAppState): LegacyMigrationConversion {
  const warnings: string[] = [];
  const localAttachments: LocalAttachmentLocation[] = [];
  const sourceSessions = new Map(state.sessions.map((session) => [session.id, session]));
  const sessions: LearnerSession[] = state.sessions.map((session) => {
    requireContractId(session.id, "session");
    const messages: LearnerMessage[] = session.messages.map((message) => {
      requireContractId(message.id, "message");
      const attachments = message.attachments?.map((attachment) => {
        requireContractId(attachment.id, "attachment");
        if (attachment.uri && attachment.localState !== "missing") {
          localAttachments.push({ messageId: message.id, attachmentId: attachment.id, uri: attachment.uri });
        }
        return {
          id: attachment.id,
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.size,
        };
      });
      const agentEvents = durableAgentEvents(message.agentEvents);
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: isoTimestamp(message.createdAt, `message ${message.id}`),
        ...(attachments?.length ? { attachments } : {}),
        ...(agentEvents ? { agentEvents } : {}),
      };
    });
    const parent = session.parentSessionId ? sourceSessions.get(session.parentSessionId) : undefined;
    const exactForkPoint = parent && session.forkedFromMessageId
      && parent.messages.some((message) => message.id === session.forkedFromMessageId)
      ? session.forkedFromMessageId
      : undefined;
    if (session.parentSessionId && !parent) {
      warnings.push(`Session ${session.id} referenced a deleted parent; its transcript was preserved as a root lesson.`);
    } else if (session.forkedFromMessageId && !exactForkPoint) {
      warnings.push(`Session ${session.id} had an invalid fork point; its whole-session parent link was preserved.`);
    }
    const latestModelMessage = [...session.messages].reverse().find((message) => message.provider && message.model);
    const branchId = stableRelatedId("branch", session.id);
    return {
      id: session.id,
      title: session.title,
      createdAt: isoTimestamp(session.createdAt, `session ${session.id}`),
      updatedAt: isoTimestamp(session.updatedAt, `session ${session.id}`),
      ...(parent ? { parentSessionId: parent.id } : {}),
      ...(exactForkPoint ? { forkedFromMessageId: exactForkPoint } : {}),
      activeBranchId: branchId,
      branches: [{
        id: branchId,
        sessionId: session.id,
        createdAt: isoTimestamp(session.createdAt, `session ${session.id}`),
        updatedAt: isoTimestamp(session.updatedAt, `session ${session.id}`),
      }],
      messages,
      ...(latestModelMessage?.provider && latestModelMessage.model ? {
        model: { provider: latestModelMessage.provider, id: latestModelMessage.model },
      } : {}),
    };
  });

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const artifacts: LearnerArtifact[] = state.artifacts.map((artifact) => {
    requireContractId(artifact.id, "artifact");
    const session = artifact.sessionId ? sessionsById.get(artifact.sessionId) : undefined;
    const messageExists = session && artifact.messageId
      ? session.messages.some((message) => message.id === artifact.messageId)
      : false;
    return {
      id: artifact.id,
      kind: artifactKind(artifact),
      format: artifactFormat(artifact),
      title: artifact.title,
      content: artifact.content,
      createdAt: isoTimestamp(artifact.createdAt, `artifact ${artifact.id}`),
      updatedAt: isoTimestamp(artifact.createdAt, `artifact ${artifact.id}`),
      ...(session ? { sourceSessionId: session.id } : {}),
      ...(messageExists ? { sourceMessageId: artifact.messageId } : {}),
    };
  });

  const usageEvents: LearnerUsageEvent[] = state.sessions.flatMap((session) =>
    session.messages.flatMap((message) => message.role === "assistant" && message.provider && message.model && message.usage ? [{
      id: stableRelatedId("usage", session.id, message.id),
      provider: message.provider,
      model: message.model,
      createdAt: isoTimestamp(message.createdAt, `usage for ${message.id}`),
      sessionId: session.id,
      providerReported: {
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        totalTokens: message.usage.totalTokens,
        ...(message.usage.costUsd !== undefined ? { costUsd: message.usage.costUsd } : {}),
      },
    }] : []));

  const feedbackEvents: LearnerFeedbackEvent[] = state.sessions.flatMap((session) =>
    session.messages.flatMap((message) => message.feedback ? [{
      id: stableRelatedId("feedback", session.id, message.id),
      sessionId: session.id,
      messageId: message.id,
      rating: message.feedback,
      createdAt: isoTimestamp(message.feedbackAt ?? message.createdAt, `feedback for ${message.id}`),
    }] : []));

  const topicEvidence: TopicEvidence[] = [];
  for (const session of sessions) {
    if (session.messages.length && session.title.trim() && session.title !== "New lesson") {
      topicEvidence.push({
        id: stableRelatedId("evidence-session", session.id),
        topic: session.title,
        createdAt: session.updatedAt,
        provenance: "session",
        reference: { kind: "session", id: session.id },
      });
    }
  }
  for (const artifact of state.artifacts) {
    if (!artifact.topic?.trim()) continue;
    topicEvidence.push({
      id: stableRelatedId("evidence-artifact", artifact.id),
      topic: artifact.topic,
      createdAt: isoTimestamp(artifact.createdAt, `artifact evidence ${artifact.id}`),
      provenance: "artifact",
      reference: { kind: "artifact", id: artifact.id },
    });
  }

  const topicsExplored = [...new Set(topicEvidence.map((evidence) => evidence.topic))].sort();
  const meaningfulSessions = sessions.filter((session) => session.messages.length > 0);
  const data: PortableLearnerData = {
    generatedAt: maxGeneratedAt(state),
    sessions,
    artifacts,
    goals: [],
    questionChecks: [],
    quizResults: [],
    decks: [],
    cardReviews: [],
    studyPriorities: [],
    feedbackEvents,
    usageEvents,
    topicEvidence,
    benchmarks: [],
    evolutions: [],
    learnerProfile: {
      topicsExplored,
      strengths: [],
      weaknesses: [],
      sessionsCount: meaningfulSessions.length,
      ...(meaningfulSessions.length ? {
        lastSessionAt: meaningfulSessions.map((session) => session.updatedAt).sort().at(-1),
      } : {}),
    },
  };
  if (!validatePortableLearnerData(data)) {
    throw new Error("Legacy learning data cannot be represented by the current portable learner contract. The source was preserved.");
  }
  return { data, localAttachments, legacyFeedback: { ...state.learnerFeedback }, warnings };
}

export interface LegacyMigrationSource {
  state: PersistedAppState;
  /** SHA-256 of the exact preserved AsyncStorage source, encoded as lowercase hex. */
  digest: string;
}

/** Resumable copy/verify migration. The caller retains AsyncStorage until completion. */
export async function migrateLegacyPersistedStateToRepository(
  repository: LearnerRepository,
  source: LegacyMigrationSource,
): Promise<LegacyMigrationConversion> {
  const conversion = convertLegacyPersistedState(source.state);
  let journal = await repository.migrations.start({
    id: LEGACY_ASYNC_STORAGE_MIGRATION_ID,
    sourceVersion: 1,
    targetVersion: 2,
    digest: source.digest,
  });
  if (journal.phase === "prepared") {
    await repository.records.replaceWithLocalAttachments(conversion.data, conversion.localAttachments);
    journal = await repository.migrations.advance(journal.id, "copied");
  }
  if (journal.phase === "copied") {
    const copied = await repository.records.snapshot();
    if (JSON.stringify(copied) !== JSON.stringify(conversion.data)) {
      throw new Error("Legacy learner migration verification failed; the AsyncStorage source was preserved.");
    }
    journal = await repository.migrations.advance(journal.id, "verified");
  }
  if (journal.phase === "verified") {
    await repository.migrations.advance(journal.id, "completed");
  }
  return conversion;
}
