import {
  validatePortableLearnerData,
  type LearnerArtifact,
  type LearnerFeedbackEvent,
  type LearnerSession,
  type PortableLearnerData,
} from "@keating/learner-contracts";
import type {
  ArtifactKind,
  ChatAttachment,
  ChatMessage,
  ChatSession,
  MessageFeedback,
  PersistedAppState,
  ProviderId,
  ProviderSettings,
  StudyArtifact,
} from "../types";
import { durableAgentEvents } from "../durable-agent-events";
import { convertLegacyPersistedState } from "./legacy-migration";
import type { LocalAttachmentLocation } from "./records";

const NATIVE_PROVIDERS = new Set<ProviderId>(["openai", "anthropic", "google", "openrouter", "custom"]);
type PortableMessage = LearnerSession["messages"][number];
type NativeMessage = Omit<PortableMessage, "role"> & { role: "user" | "assistant" };

export interface UnprojectedNativeRecords {
  sessionIds: string[];
  artifactIds: string[];
  sessionCount: number;
  artifactCount: number;
  /** Sessions excluded because they contain tool/system data or data the native schema cannot retain. */
  incompatibleSessionIds: string[];
  /** Compatible descendants excluded because their ancestor cannot be represented. */
  ancestorBlockedSessionIds: string[];
  /** Artifacts excluded because native does not support their full kind, format, content, or source relation. */
  unsupportedArtifactIds: string[];
}

export interface PortableNativeProjection {
  state: PersistedAppState;
  localAttachments: LocalAttachmentLocation[];
  unprojected: UnprojectedNativeRecords;
}

export interface NativePortableReconciliation {
  data: PortableLearnerData;
  /** Portable messages retained outside the native projection, including their full transcript metadata. */
  preserveMessageIds: string[];
  /** Existing app-owned locations retained outside the native projection. */
  preserveLocalAttachments: LocalAttachmentLocation[];
  /** All locations that should be stored beside the reconciled portable snapshot. */
  localAttachments: LocalAttachmentLocation[];
  unprojected: UnprojectedNativeRecords;
}

function isoToMillis(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Portable timestamp ${value} cannot be represented on native.`);
  return result;
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

function isNativeProvider(value: string): value is ProviderId {
  return NATIVE_PROVIDERS.has(value as ProviderId);
}

function nativeBranchCompatible(session: LearnerSession): boolean {
  if (session.branches.length !== 1 || session.activeBranchId !== stableRelatedId("branch", session.id)) return false;
  const branch = session.branches[0];
  return !!branch
    && branch.id === session.activeBranchId
    && branch.sessionId === session.id
    && branch.createdAt === session.createdAt
    && branch.updatedAt === session.updatedAt
    && branch.parentBranchId === undefined
    && branch.forkedFromMessageId === undefined
    && branch.title === undefined;
}

function sessionHasNativeOnlyData(session: LearnerSession): boolean {
  return !nativeBranchCompatible(session)
    || session.messages.some((message) => message.role !== "user" && message.role !== "assistant"
      || message.turnId !== undefined || message.toolCallId !== undefined)
    || (session.model !== undefined && !isNativeProvider(session.model.provider));
}

function supportedArtifactKind(artifact: LearnerArtifact): ArtifactKind | null {
  if (artifact.kind === "note" || artifact.kind === "explanation" || artifact.kind === "study-plan" || artifact.kind === "quiz") {
    return artifact.kind;
  }
  if (artifact.kind === "lesson-map") return "concept-map";
  return null;
}

function expectedArtifactFormat(kind: ArtifactKind): string {
  if (kind === "concept-map") return "mermaid";
  if (kind === "quiz") return "quiz";
  return "markdown";
}

function latestFeedback(events: readonly LearnerFeedbackEvent[]): LearnerFeedbackEvent | undefined {
  return [...events].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)).at(-1);
}

function attachmentLocationsByKey(locations: readonly LocalAttachmentLocation[]): Map<string, LocalAttachmentLocation> {
  const result = new Map<string, LocalAttachmentLocation>();
  for (const location of locations) result.set(`${location.messageId}:${location.attachmentId}`, location);
  return result;
}

function uniqueLocations(locations: readonly LocalAttachmentLocation[]): LocalAttachmentLocation[] {
  const byKey = attachmentLocationsByKey(locations);
  return [...byKey.values()].sort((left, right) => left.messageId.localeCompare(right.messageId)
    || left.attachmentId.localeCompare(right.attachmentId));
}

function classifyPortable(data: PortableLearnerData): UnprojectedNativeRecords & {
  projectableSessionIds: Set<string>;
  projectableArtifactIds: Set<string>;
} {
  const source = new Map(data.sessions.map((session) => [session.id, session]));
  const incompatible = new Set(data.sessions.filter(sessionHasNativeOnlyData).map((session) => session.id));
  const blocked = new Set<string>();
  const visiting = new Set<string>();
  const isProjectableSession = (session: LearnerSession): boolean => {
    if (incompatible.has(session.id)) return false;
    if (!session.parentSessionId) return true;
    if (visiting.has(session.id)) return false;
    visiting.add(session.id);
    const parent = source.get(session.parentSessionId);
    const result = !!parent && isProjectableSession(parent);
    visiting.delete(session.id);
    if (!result) blocked.add(session.id);
    return result;
  };
  const projectableSessionIds = new Set(data.sessions.filter(isProjectableSession).map((session) => session.id));
  const unsupportedArtifacts = new Set<string>();
  const projectableArtifactIds = new Set<string>();
  for (const artifact of data.artifacts) {
    const nativeKind = supportedArtifactKind(artifact);
    const sourceIsProjected = !artifact.sourceSessionId || projectableSessionIds.has(artifact.sourceSessionId);
    if (!nativeKind || artifact.format !== expectedArtifactFormat(nativeKind)
      || artifact.content === undefined || artifact.attachment !== undefined || !sourceIsProjected) {
      unsupportedArtifacts.add(artifact.id);
    } else {
      projectableArtifactIds.add(artifact.id);
    }
  }
  const sessionIds = data.sessions.filter((session) => !projectableSessionIds.has(session.id)).map((session) => session.id).sort();
  const artifactIds = data.artifacts.filter((artifact) => !projectableArtifactIds.has(artifact.id)).map((artifact) => artifact.id).sort();
  return {
    sessionIds,
    artifactIds,
    sessionCount: sessionIds.length,
    artifactCount: artifactIds.length,
    incompatibleSessionIds: [...incompatible].sort(),
    ancestorBlockedSessionIds: [...blocked].sort(),
    unsupportedArtifactIds: [...unsupportedArtifacts].sort(),
    projectableSessionIds,
    projectableArtifactIds,
  };
}

function projectAttachment(
  attachment: NonNullable<LearnerSession["messages"][number]["attachments"]>[number],
  messageId: string,
  locations: Map<string, LocalAttachmentLocation>,
): ChatAttachment {
  const location = locations.get(`${messageId}:${attachment.id}`);
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.sizeBytes,
    ...(location ? { uri: location.uri } : { localState: "missing" as const }),
  };
}

function projectMessage(
  message: NativeMessage,
  session: LearnerSession,
  locations: Map<string, LocalAttachmentLocation>,
  feedback: Map<string, LearnerFeedbackEvent[]>,
): ChatMessage {
  const currentFeedback = latestFeedback(feedback.get(`${session.id}:${message.id}`) ?? []);
  const model = message.role === "assistant" ? session.model : undefined;
  const agentEvents = durableAgentEvents(message.agentEvents);
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: isoToMillis(message.createdAt),
    ...(message.attachments?.length ? { attachments: message.attachments.map((attachment) => projectAttachment(attachment, message.id, locations)) } : {}),
    ...(model ? { provider: model.provider as ProviderId, model: model.id } : {}),
    ...(agentEvents ? { agentEvents } : {}),
    ...(currentFeedback ? {
      feedback: currentFeedback.rating as MessageFeedback,
      feedbackAt: isoToMillis(currentFeedback.createdAt),
    } : {}),
  };
}

function projectSession(
  session: LearnerSession,
  locations: Map<string, LocalAttachmentLocation>,
  feedback: Map<string, LearnerFeedbackEvent[]>,
): ChatSession {
  const messages = session.messages.filter((message): message is NativeMessage =>
    message.role === "user" || message.role === "assistant");
  if (messages.length !== session.messages.length) {
    throw new Error(`Session ${session.id} contains a role native cannot project.`);
  }
  return {
    id: session.id,
    title: session.title,
    createdAt: isoToMillis(session.createdAt),
    updatedAt: isoToMillis(session.updatedAt),
    messages: messages.map((message) => projectMessage(message, session, locations, feedback)),
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
    ...(session.forkedFromMessageId ? { forkedFromMessageId: session.forkedFromMessageId } : {}),
  };
}

function projectArtifact(artifact: LearnerArtifact): StudyArtifact {
  const kind = supportedArtifactKind(artifact);
  if (!kind || artifact.content === undefined) throw new Error(`Artifact ${artifact.id} is not native-projectable.`);
  return {
    id: artifact.id,
    kind,
    source: kind === "study-plan" || kind === "concept-map" || kind === "quiz" ? "keating-core" : "assistant",
    title: artifact.title,
    content: artifact.content,
    createdAt: isoToMillis(artifact.createdAt),
    ...(artifact.sourceSessionId ? { sessionId: artifact.sourceSessionId } : {}),
    ...(artifact.sourceMessageId ? { messageId: artifact.sourceMessageId } : {}),
  };
}

/**
 * Make a native state only from records that it can round-trip without losing
 * transcript, branch, attachment, or artifact information. Unsupported data
 * stays in the portable store and is reported to the caller instead of hidden.
 */
export function projectPortableToNativeState(
  data: PortableLearnerData,
  providerSettings: ProviderSettings,
  localAttachments: readonly LocalAttachmentLocation[] = [],
  activeSessionId?: string,
): PortableNativeProjection {
  if (!validatePortableLearnerData(data)) throw new Error("Cannot project invalid portable learner data to native state.");
  const classified = classifyPortable(data);
  const locations = attachmentLocationsByKey(localAttachments);
  const feedback = new Map<string, LearnerFeedbackEvent[]>();
  for (const event of data.feedbackEvents) {
    const key = `${event.sessionId}:${event.messageId}`;
    feedback.set(key, [...(feedback.get(key) ?? []), event]);
  }
  const sessions = data.sessions.filter((session) => classified.projectableSessionIds.has(session.id))
    .map((session) => projectSession(session, locations, feedback));
  const artifacts = data.artifacts.filter((artifact) => classified.projectableArtifactIds.has(artifact.id)).map(projectArtifact);
  const applicableFeedback = data.feedbackEvents.filter((event) => classified.projectableSessionIds.has(event.sessionId));
  const projectedAttachmentKeys = new Set(sessions.flatMap((session) => session.messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => `${message.id}:${attachment.id}`))));
  return {
    state: {
      schemaVersion: 4,
      sessions,
      activeSessionId: activeSessionId && classified.projectableSessionIds.has(activeSessionId)
        ? activeSessionId : (sessions[0]?.id ?? ""),
      artifacts,
      providerSettings: { ...providerSettings },
      learnerFeedback: {
        helpful: applicableFeedback.filter((event) => event.rating === "helpful").length,
        missed: applicableFeedback.filter((event) => event.rating === "missed").length,
      },
    },
    localAttachments: uniqueLocations(localAttachments.filter((location) => projectedAttachmentKeys.has(`${location.messageId}:${location.attachmentId}`))),
    unprojected: classified,
  };
}

function addSessionAndAncestors(
  sessionId: string,
  sessions: Map<string, LearnerSession>,
  retained: Set<string>,
): void {
  let cursor = sessions.get(sessionId);
  while (cursor) {
    retained.add(cursor.id);
    cursor = cursor.parentSessionId ? sessions.get(cursor.parentSessionId) : undefined;
  }
}

function recordIds<T extends { id: string }>(records: readonly T[]): Set<string> {
  return new Set(records.map((record) => record.id));
}

function preferFresh<T extends { id: string }>(
  retained: readonly T[],
  fresh: readonly T[],
  protectedIds: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map(fresh.map((record) => [record.id, record]));
  for (const record of retained) {
    if (protectedIds.has(record.id) || !byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()];
}

function mergeProfile(current: PortableLearnerData["learnerProfile"], fresh: PortableLearnerData["learnerProfile"]): PortableLearnerData["learnerProfile"] {
  const union = (left: readonly string[], right: readonly string[]) => [...new Set([...left, ...right])].sort();
  const sessionsCount = Math.max(current.sessionsCount, fresh.sessionsCount);
  const lastSessionAt = [current.lastSessionAt, fresh.lastSessionAt].filter((value): value is string => !!value).sort().at(-1);
  return {
    topicsExplored: union(current.topicsExplored, fresh.topicsExplored),
    strengths: union(current.strengths, fresh.strengths),
    weaknesses: union(current.weaknesses, fresh.weaknesses),
    sessionsCount,
    ...(lastSessionAt ? { lastSessionAt } : {}),
  };
}

/**
 * Apply a native write without using it as an excuse to delete records native
 * cannot display. Native-deleted projectable records are removed, while
 * imported-only data remains referentially complete in the portable source.
 */
export function reconcileNativeStateIntoPortable(
  current: PortableLearnerData,
  nativeState: PersistedAppState,
  currentLocalAttachments: readonly LocalAttachmentLocation[] = [],
): NativePortableReconciliation {
  if (!validatePortableLearnerData(current)) throw new Error("Cannot reconcile against invalid portable learner data.");
  const classified = classifyPortable(current);
  const currentSessions = new Map(current.sessions.map((session) => [session.id, session]));
  const retainedSessionIds = new Set(classified.sessionIds);
  for (const artifact of current.artifacts.filter((artifact) => classified.artifactIds.includes(artifact.id))) {
    if (artifact.sourceSessionId) addSessionAndAncestors(artifact.sourceSessionId, currentSessions, retainedSessionIds);
  }
  for (const event of current.feedbackEvents) {
    if (retainedSessionIds.has(event.sessionId)) addSessionAndAncestors(event.sessionId, currentSessions, retainedSessionIds);
  }
  for (const event of current.usageEvents) {
    if (event.sessionId && retainedSessionIds.has(event.sessionId)) addSessionAndAncestors(event.sessionId, currentSessions, retainedSessionIds);
  }
  for (const sessionId of [...retainedSessionIds]) addSessionAndAncestors(sessionId, currentSessions, retainedSessionIds);

  const fresh = convertLegacyPersistedState(nativeState).data;
  const retainedSessions = current.sessions.filter((session) => retainedSessionIds.has(session.id));
  const retainedArtifacts = current.artifacts.filter((artifact) => classified.artifactIds.includes(artifact.id));
  const retainedArtifactIds = recordIds(retainedArtifacts);
  // A native update may replace an ancestor's transcript, but it cannot
  // replace an imported unprojectable session that it was never able to show.
  const keptSessions = preferFresh(retainedSessions, fresh.sessions, new Set(classified.sessionIds));
  const keptSessionIds = recordIds(keptSessions);
  const keptArtifacts = preferFresh(retainedArtifacts, fresh.artifacts.filter((artifact) =>
    !artifact.sourceSessionId || keptSessionIds.has(artifact.sourceSessionId)), retainedArtifactIds);
  const keptArtifactIds = recordIds(keptArtifacts);
  const keptMessageIds = new Set(keptSessions.flatMap((session) => session.messages.map((message) => message.id)));

  // Historical imported events are portable records in their own right. Keep
  // them while their exact relation still exists; only a native deletion may
  // remove them. Fresh mobile-derived events then merge by stable id.
  const retainedFeedback = current.feedbackEvents.filter((event) =>
    keptSessionIds.has(event.sessionId) && keptMessageIds.has(event.messageId));
  const retainedUsage = current.usageEvents.filter((event) => !event.sessionId || keptSessionIds.has(event.sessionId));
  const retainedEvidence = current.topicEvidence.filter((evidence) => {
    if (!evidence.reference) return true;
    if (evidence.reference.kind === "session") return keptSessionIds.has(evidence.reference.id);
    if (evidence.reference.kind === "artifact") return keptArtifactIds.has(evidence.reference.id);
    return true;
  });

  const data: PortableLearnerData = {
    generatedAt: [current.generatedAt, fresh.generatedAt].sort().at(-1)!,
    sessions: keptSessions,
    artifacts: keptArtifacts,
    // Native currently does not edit these learning records. Keep them verbatim.
    goals: structuredClone(current.goals),
    questionChecks: structuredClone(current.questionChecks),
    quizResults: structuredClone(current.quizResults),
    decks: structuredClone(current.decks),
    cardReviews: structuredClone(current.cardReviews),
    studyPriorities: structuredClone(current.studyPriorities),
    feedbackEvents: preferFresh(retainedFeedback, fresh.feedbackEvents.filter((event) => keptSessionIds.has(event.sessionId))),
    usageEvents: preferFresh(retainedUsage, fresh.usageEvents.filter((event) => !event.sessionId || keptSessionIds.has(event.sessionId))),
    topicEvidence: preferFresh(retainedEvidence, fresh.topicEvidence.filter((evidence) => {
      if (!evidence.reference) return true;
      if (evidence.reference.kind === "session") return keptSessionIds.has(evidence.reference.id);
      if (evidence.reference.kind === "artifact") return keptArtifactIds.has(evidence.reference.id);
      return true;
    })),
    // Native does not author evaluation runs yet. Preserve actual imported runs verbatim.
    benchmarks: structuredClone(current.benchmarks),
    evolutions: structuredClone(current.evolutions),
    learnerProfile: mergeProfile(current.learnerProfile, fresh.learnerProfile),
  };
  if (!validatePortableLearnerData(data)) {
    throw new Error("Native reconciliation would create dangling or invalid portable learner data.");
  }
  const preserveMessageIds = retainedSessions.flatMap((session) => session.messages.map((message) => message.id)).sort();
  const preserveMessageSet = new Set(preserveMessageIds);
  const preserveLocalAttachments = uniqueLocations(currentLocalAttachments.filter((location) => preserveMessageSet.has(location.messageId)));
  const allLocalAttachments = uniqueLocations([
    ...preserveLocalAttachments,
    ...convertLegacyPersistedState(nativeState).localAttachments,
  ]);
  return {
    data,
    preserveMessageIds,
    preserveLocalAttachments,
    localAttachments: allLocalAttachments,
    unprojected: classified,
  };
}
