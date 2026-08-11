import type { AgentStreamEvent } from "@keating/learner-contracts";

export type ProviderId = "openai" | "anthropic" | "google" | "openrouter" | "custom";

export type MessageRole = "user" | "assistant";
export type MessageFeedback = "helpful" | "missed";

export type ChatAttachmentKind = "image" | "document";
export type ChatAttachmentEncoding = "base64" | "text";

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  /**
   * App-owned file URI retained for retry and session resume. Portable imports
   * intentionally omit it because device paths and bytes never cross surfaces.
   */
  uri?: string;
  /** Present only when portable metadata has no corresponding file on this device. */
  localState?: "missing";
  /** Populated only on a transient provider-request copy, never persisted. */
  data?: string;
  encoding?: ChatAttachmentEncoding;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Present only when the provider reports a request cost. */
  costUsd?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  provider?: ProviderId;
  model?: string;
  usage?: ProviderUsage;
  /** Ordered provider-neutral reasoning/tool/UI trace for this assistant turn. */
  agentEvents?: AgentStreamEvent[];
  feedback?: MessageFeedback;
  /** When the learner explicitly applied the current feedback value. */
  feedbackAt?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Direct parent in the local session tree, when this lesson is a fork. */
  parentSessionId?: string;
  /** Last source message copied into this fork. Omitted for a whole-session fork. */
  forkedFromMessageId?: string;
  forkedAt?: number;
}

export type GeneratedArtifactKind = "study-plan" | "concept-map" | "quiz";
export type ArtifactKind = "note" | "explanation" | GeneratedArtifactKind;
export type ArtifactSource = "assistant" | "keating-core";

export interface StudyArtifact {
  id: string;
  sessionId?: string;
  messageId?: string;
  kind: ArtifactKind;
  source?: ArtifactSource;
  topic?: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  temperature: number;
}

export interface LearnerFeedbackSummary {
  helpful: number;
  missed: number;
}

export interface PersistedAppState {
  schemaVersion: 4;
  sessions: ChatSession[];
  activeSessionId: string;
  artifacts: StudyArtifact[];
  providerSettings: ProviderSettings;
  learnerFeedback: LearnerFeedbackSummary;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createSession(now = Date.now()): ChatSession {
  return {
    id: createId("session"),
    title: "New lesson",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
