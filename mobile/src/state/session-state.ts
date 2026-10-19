/**
 * Pure transitions over the persisted app state: sessions, artifacts and
 * learner feedback. Ids and clocks are injectable so every decision the
 * provider used to inline is unit-testable without React.
 */
import {
  type ArtifactKind,
  type ChatAttachment,
  type ChatMessage,
  type ChatSession,
  createId,
  createSession,
  type GeneratedArtifactKind,
  type MessageFeedback,
  type PersistedAppState,
} from "@/lib/types";
import { DEFAULT_PROVIDER_SETTINGS } from "@/lib/provider-config";
import type { AgentStreamEvent } from "@keating/learner-contracts";

export interface LiveQuizQuestion {
  question: string;
  correctAnswer: string;
  explanation: string;
  options?: readonly string[];
}

export interface LiveConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export function initialState(): PersistedAppState {
  const session = createSession();
  return {
    schemaVersion: 4,
    sessions: [session],
    activeSessionId: session.id,
    artifacts: [],
    providerSettings: DEFAULT_PROVIDER_SETTINGS,
    learnerFeedback: { helpful: 0, missed: 0 },
  };
}

export function normalizeState(candidate: PersistedAppState | null): PersistedAppState {
  if (!candidate) return initialState();
  if (candidate.sessions.length === 0) {
    const session = createSession();
    return { ...candidate, sessions: [session], activeSessionId: session.id };
  }
  const activeExists = candidate.sessions.some((session) => session.id === candidate.activeSessionId);
  return {
    ...candidate,
    activeSessionId: activeExists ? candidate.activeSessionId : candidate.sessions[0].id,
    artifacts: Array.isArray(candidate.artifacts) ? candidate.artifacts : [],
    learnerFeedback: candidate.learnerFeedback ?? { helpful: 0, missed: 0 },
    providerSettings: candidate.providerSettings ?? DEFAULT_PROVIDER_SETTINGS,
  };
}

export function titleFromFirstMessage(content: string): string {
  const title = content.replace(/\s+/g, " ").trim();
  return title.length > 48 ? `${title.slice(0, 47)}…` : title || "New lesson";
}

export function artifactTitle(message: ChatMessage, kind: ArtifactKind): string {
  const firstLine = message.content
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  if (firstLine) return firstLine.length > 64 ? `${firstLine.slice(0, 63)}…` : firstLine;
  return kind === "study-plan" ? "Study plan" : kind === "quiz" ? "Practice quiz" : "Saved note";
}

/** The active session, falling back to the first one when the id is stale. */
export function activeSessionOf(state: PersistedAppState): ChatSession {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? state.sessions[0];
}

export function replaceSession(
  state: PersistedAppState,
  sessionId: string,
  update: (session: ChatSession) => ChatSession,
): PersistedAppState {
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id === sessionId ? update(session) : session),
  };
}

export function buildUserMessage(
  trimmed: string,
  attachments: ChatAttachment[] = [],
  createdAt = Date.now(),
  id = createId("message"),
): ChatMessage {
  return {
    id,
    role: "user",
    content: trimmed,
    createdAt,
    ...(attachments.length ? { attachments } : {}),
  };
}

/** The first message names the lesson; later messages keep the existing title. */
export function titleAfterUserMessage(
  session: ChatSession,
  trimmed: string,
  attachments: readonly ChatAttachment[],
): string {
  return session.messages.length === 0
    ? titleFromFirstMessage(trimmed || attachments[0]?.name || "Attached lesson")
    : session.title;
}

/** Messages to replay for Retry: everything through the latest learner turn, plus the last committed tool trace. */
export function retryPlan(
  session: ChatSession,
): { messages: ChatMessage[]; replayEvents: readonly AgentStreamEvent[] | undefined } | null {
  let userIndex = -1;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;
  const replayEvents = [...session.messages.slice(userIndex + 1)]
    .reverse()
    .find((message) => message.role === "assistant" && message.agentEvents?.some((event) => event.type === "tool-result"))
    ?.agentEvents;
  return { messages: session.messages.slice(0, userIndex + 1), replayEvents };
}

/** Puts a session first and makes it active (new lesson, fork, quick-start). */
export function withSessionFirst(state: PersistedAppState, session: ChatSession): PersistedAppState {
  return { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id };
}

export function withActiveSession(state: PersistedAppState, sessionId: string): PersistedAppState {
  return { ...state, activeSessionId: sessionId };
}

/** Deleting the last session leaves a fresh one so the app always has an active lesson. */
export function withoutSession(
  state: PersistedAppState,
  sessionId: string,
  makeSession: () => ChatSession = createSession,
): PersistedAppState {
  const remaining = state.sessions.filter((session) => session.id !== sessionId);
  if (remaining.length === 0) remaining.push(makeSession());
  return {
    ...state,
    sessions: remaining,
    activeSessionId: state.activeSessionId === sessionId ? remaining[0].id : state.activeSessionId,
    artifacts: state.artifacts.filter((artifact) => artifact.sessionId !== sessionId),
  };
}

/** Null when the message does not exist, so the caller can skip the write. */
export function withMessageFeedback(
  state: PersistedAppState,
  messageId: string,
  feedback: MessageFeedback,
  now = Date.now(),
): PersistedAppState | null {
  let previous: MessageFeedback | undefined;
  const sessions = state.sessions.map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message;
      previous = message.feedback;
      return { ...message, feedback, feedbackAt: now };
    }),
  }));
  if (!previous && sessions.every((session) => session.messages.every((message) => message.id !== messageId))) return null;
  const learnerFeedback = { ...state.learnerFeedback };
  if (previous) learnerFeedback[previous] = Math.max(0, learnerFeedback[previous] - 1);
  learnerFeedback[feedback] += 1;
  return { ...state, sessions, learnerFeedback };
}

/** Saves an assistant reply as an artifact; null when it is already saved or not savable. */
export function withSavedAssistantArtifact(
  state: PersistedAppState,
  messageId: string,
  kind: ArtifactKind,
  id = createId("artifact"),
  createdAt = Date.now(),
): PersistedAppState | null {
  if (state.artifacts.some((artifact) => artifact.messageId === messageId)) return null;
  const session = state.sessions.find((entry) => entry.messages.some((message) => message.id === messageId));
  const message = session?.messages.find((entry) => entry.id === messageId);
  if (!session || !message || message.role !== "assistant") return null;
  return {
    ...state,
    artifacts: [{
      id,
      sessionId: session.id,
      messageId,
      kind,
      source: "assistant",
      title: artifactTitle(message, kind),
      content: message.content,
      createdAt,
    }, ...state.artifacts],
  };
}

export function withGeneratedArtifact(
  state: PersistedAppState,
  generated: { kind: GeneratedArtifactKind; topic: string; title: string; content: string },
  id = createId("artifact"),
  createdAt = Date.now(),
): PersistedAppState {
  return {
    ...state,
    artifacts: [{
      id,
      kind: generated.kind,
      source: "keating-core",
      topic: generated.topic,
      title: generated.title,
      content: generated.content,
      createdAt,
    }, ...state.artifacts],
  };
}

export function liveQuizMarkdown(questions: readonly LiveQuizQuestion[]): string {
  return questions.map((question, index) => [
    `## ${index + 1}. ${question.question.trim()}`,
    question.options?.length ? question.options.map((option) => `- ${option.trim()}`).join("\n") : "",
    `**Answer:** ${question.correctAnswer.trim()}`,
    `**Why:** ${question.explanation.trim()}`,
  ].filter(Boolean).join("\n\n")).join("\n\n");
}

/** Throws unless the quiz has a topic and at least two complete questions. */
export function withLiveQuiz(
  state: PersistedAppState,
  topicName: string,
  questions: readonly LiveQuizQuestion[],
  id = createId("artifact"),
  createdAt = Date.now(),
): PersistedAppState {
  const topic = topicName.trim();
  if (!topic || questions.length < 2) throw new Error("A Live quiz needs a topic and at least two complete questions.");
  return {
    ...state,
    artifacts: [{
      id,
      sessionId: state.activeSessionId,
      kind: "quiz",
      source: "assistant",
      topic,
      title: `${topic} retrieval quiz`,
      content: liveQuizMarkdown(questions),
      createdAt,
    }, ...state.artifacts],
  };
}

/** Appends final Live turns to a session; null when there is nothing to keep. */
export function withLiveConversation(
  state: PersistedAppState,
  turns: readonly LiveConversationTurn[],
  sessionId: string | undefined,
  now = Date.now(),
  makeId: () => string = () => createId("message"),
): PersistedAppState | null {
  const accepted = turns
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
    .filter((turn) => turn.text.length > 0);
  if (!accepted.length) return null;
  const messages: ChatMessage[] = accepted.map((turn, index) => ({
    id: makeId(),
    role: turn.role,
    content: turn.text,
    createdAt: now + index,
  }));
  const targetSessionId = sessionId && state.sessions.some((session) => session.id === sessionId)
    ? sessionId
    : state.activeSessionId;
  const sessions = state.sessions.map((session) => session.id === targetSessionId
    ? { ...session, messages: [...session.messages, ...messages], updatedAt: now + messages.length }
    : session);
  return { ...state, sessions };
}

export function withoutArtifact(state: PersistedAppState, artifactId: string): PersistedAppState {
  return { ...state, artifacts: state.artifacts.filter((artifact) => artifact.id !== artifactId) };
}
