import type { PortableLearnerData } from "@keating/learner-contracts";
import type { PersistedAppState, ProviderId } from "./types";

export interface TopicActivity {
  key: string;
  label: string;
  source: string;
  lastStudiedAt: number;
  turns: number;
  /** Count of persisted session/artifact evidence records, never a mastery score. */
  occurrences: number;
}

export interface SessionStartActivity {
  id: string;
  title: string;
  startedAt: number;
  messages: number;
}

export interface ModelActivity {
  key: string;
  provider: string;
  model: string;
  replies: number;
  tokens: number;
}

export interface MobileUsageSummary {
  lessons: number;
  messages: number;
  assistantReplies: number;
  attachments: number;
  artifacts: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reportedCostUsd: number;
  helpful: number;
  missed: number;
  topics: TopicActivity[];
  models: ModelActivity[];
  sessionStarts: SessionStartActivity[];
  recentLessons: Array<{ id: string; title: string; updatedAt: number; messages: number }>;
}

function topicKey(label: string): string {
  return label.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function buildMobileUsageSummary(state: PersistedAppState): MobileUsageSummary {
  const meaningfulSessions = state.sessions.filter((session) => session.messages.length > 0);
  const allMessages = meaningfulSessions.flatMap((session) => session.messages);
  const assistantMessages = allMessages.filter((message) => message.role === "assistant");
  const topicMap = new Map<string, TopicActivity>();

  for (const session of meaningfulSessions) {
    if (session.title === "New lesson" || !session.title.trim()) continue;
    const key = topicKey(session.title);
    const prior = topicMap.get(key);
    topicMap.set(key, {
      key,
      label: session.title,
      source: prior?.source ?? "lesson title",
      lastStudiedAt: Math.max(prior?.lastStudiedAt ?? 0, session.updatedAt),
      turns: (prior?.turns ?? 0) + session.messages.length,
      occurrences: (prior?.occurrences ?? 0) + 1,
    });
  }
  for (const artifact of state.artifacts) {
    if (!artifact.topic?.trim()) continue;
    const key = topicKey(artifact.topic);
    const prior = topicMap.get(key);
    topicMap.set(key, {
      key,
      label: artifact.topic,
      source: "generated artifact",
      lastStudiedAt: Math.max(prior?.lastStudiedAt ?? 0, artifact.createdAt),
      turns: prior?.turns ?? 0,
      occurrences: (prior?.occurrences ?? 0) + 1,
    });
  }

  const modelMap = new Map<string, ModelActivity>();
  for (const message of assistantMessages) {
    if (!message.provider || !message.model) continue;
    const key = `${message.provider}:${message.model}`;
    const prior = modelMap.get(key);
    modelMap.set(key, {
      key,
      provider: message.provider,
      model: message.model,
      replies: (prior?.replies ?? 0) + 1,
      tokens: (prior?.tokens ?? 0) + (message.usage?.totalTokens ?? 0),
    });
  }

  return {
    lessons: meaningfulSessions.length,
    messages: allMessages.length,
    assistantReplies: assistantMessages.length,
    attachments: allMessages.reduce((total, message) => total + (message.attachments?.length ?? 0), 0),
    artifacts: state.artifacts.length,
    inputTokens: assistantMessages.reduce((total, message) => total + (message.usage?.inputTokens ?? 0), 0),
    outputTokens: assistantMessages.reduce((total, message) => total + (message.usage?.outputTokens ?? 0), 0),
    totalTokens: assistantMessages.reduce((total, message) => total + (message.usage?.totalTokens ?? 0), 0),
    reportedCostUsd: assistantMessages.reduce((total, message) => total + (message.usage?.costUsd ?? 0), 0),
    helpful: state.learnerFeedback.helpful,
    missed: state.learnerFeedback.missed,
    topics: [...topicMap.values()].sort((a, b) => b.lastStudiedAt - a.lastStudiedAt),
    models: [...modelMap.values()].sort((a, b) => b.replies - a.replies || b.tokens - a.tokens),
    sessionStarts: meaningfulSessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        startedAt: session.createdAt,
        messages: session.messages.length,
      }))
      .sort((left, right) => left.startedAt - right.startedAt),
    recentLessons: meaningfulSessions
      .map((session) => ({ id: session.id, title: session.title, updatedAt: session.updatedAt, messages: session.messages.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8),
  };
}

/** Builds the same view from the cross-surface SQLite/portable record boundary. */
export function buildRepositoryUsageSummary(data: PortableLearnerData): MobileUsageSummary {
  const meaningfulSessions = data.sessions.filter((session) => session.messages.length > 0);
  const topicMap = new Map<string, TopicActivity>();
  const sessionsById = new Map(data.sessions.map((session) => [session.id, session]));
  for (const evidence of data.topicEvidence) {
    const key = topicKey(evidence.topic);
    const prior = topicMap.get(key);
    const session = evidence.reference?.kind === "session" ? sessionsById.get(evidence.reference.id) : undefined;
    topicMap.set(key, {
      key,
      label: evidence.topic,
      source: evidence.provenance,
      lastStudiedAt: Math.max(prior?.lastStudiedAt ?? 0, Date.parse(evidence.createdAt)),
      turns: (prior?.turns ?? 0) + (session?.messages.length ?? 0),
      occurrences: (prior?.occurrences ?? 0) + 1,
    });
  }

  const modelMap = new Map<string, ModelActivity>();
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let reportedCostUsd = 0;
  for (const event of data.usageEvents) {
    const provider = event.provider;
    const key = `${provider}:${event.model}`;
    const eventInput = event.providerReported.inputTokens ?? 0;
    const eventOutput = event.providerReported.outputTokens ?? 0;
    const eventTotal = event.providerReported.totalTokens ?? eventInput + eventOutput;
    const prior = modelMap.get(key);
    modelMap.set(key, {
      key,
      provider,
      model: event.model,
      replies: (prior?.replies ?? 0) + 1,
      tokens: (prior?.tokens ?? 0) + eventTotal,
    });
    inputTokens += eventInput;
    outputTokens += eventOutput;
    totalTokens += eventTotal;
    reportedCostUsd += event.providerReported.costUsd ?? 0;
  }

  return {
    lessons: meaningfulSessions.length,
    messages: meaningfulSessions.reduce((total, session) => total + session.messages.length, 0),
    assistantReplies: meaningfulSessions.reduce((total, session) =>
      total + session.messages.filter((message) => message.role === "assistant").length, 0),
    attachments: meaningfulSessions.reduce((total, session) =>
      total + session.messages.reduce((sessionTotal, message) => sessionTotal + (message.attachments?.length ?? 0), 0), 0),
    artifacts: data.artifacts.length,
    inputTokens,
    outputTokens,
    totalTokens,
    reportedCostUsd,
    helpful: data.feedbackEvents.filter((event) => event.rating === "helpful").length,
    missed: data.feedbackEvents.filter((event) => event.rating === "missed").length,
    topics: [...topicMap.values()].sort((left, right) => right.lastStudiedAt - left.lastStudiedAt),
    models: [...modelMap.values()].sort((left, right) => right.replies - left.replies || right.tokens - left.tokens),
    sessionStarts: meaningfulSessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        startedAt: Date.parse(session.createdAt),
        messages: session.messages.length,
      }))
      .sort((left, right) => left.startedAt - right.startedAt),
    recentLessons: meaningfulSessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: Date.parse(session.updatedAt),
        messages: session.messages.length,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8),
  };
}
