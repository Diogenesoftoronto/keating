import { hasOnlyKeys, isContractId, isContractTimestamp } from "./validation.js";

/** Explicit learner reaction to one transcript message; this is not an assessment or mastery record. */
export interface LearnerFeedbackEvent {
  id: string;
  sessionId: string;
  messageId: string;
  rating: "helpful" | "missed";
  createdAt: string;
}

const FEEDBACK_EVENT_KEYS = new Set(["id", "sessionId", "messageId", "rating", "createdAt"]);

export function validateLearnerFeedbackEvent(value: unknown): value is LearnerFeedbackEvent {
  if (!hasOnlyKeys(value, FEEDBACK_EVENT_KEYS)) return false;
  const event = value as Partial<LearnerFeedbackEvent>;
  return isContractId(event.id)
    && isContractId(event.sessionId)
    && isContractId(event.messageId)
    && (event.rating === "helpful" || event.rating === "missed")
    && isContractTimestamp(event.createdAt);
}
