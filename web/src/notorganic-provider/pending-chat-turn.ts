import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { prepareMessagesForRetry } from "../hooks/session-recovery";

const KEY = "keating:notorganic-pending-chat-turn";
type PendingTurn = { sessionId: string; timestamp: number; ready: boolean };

export function pendingChatTurn(): PendingTurn | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return value && typeof value.sessionId === "string" && typeof value.timestamp === "number"
      && typeof value.ready === "boolean" ? value : null;
  } catch { return null; }
}

/** The message itself is saved in the session store before this marker is written. */
export function rememberChatTurn(sessionId: string, messages: AgentMessage[]): void {
  const message = [...messages].reverse().find(message => message.role === "user");
  if (!message || !("timestamp" in message) || typeof message.timestamp !== "number") return;
  // Do not navigate away if this write fails: the caller surfaces the error.
  sessionStorage.setItem(KEY, JSON.stringify({ sessionId, timestamp: message.timestamp, ready: false }));
}

export function clearPendingChatTurn(sessionId?: string): void {
  if (!sessionId || pendingChatTurn()?.sessionId === sessionId) sessionStorage.removeItem(KEY);
}

/** Called only after the OAuth code has been successfully exchanged. */
export function authorizePendingChatTurn(): void {
  const pending = pendingChatTurn();
  if (pending) sessionStorage.setItem(KEY, JSON.stringify({ ...pending, ready: true }));
}

/** Claim once, and only for the same unanswered learner turn. */
export function claimPendingChatTurn(sessionId: string, messages: AgentMessage[]): AgentMessage[] | null {
  const pending = pendingChatTurn();
  if (!pending?.ready || pending.sessionId !== sessionId) return null;
  const retry = prepareMessagesForRetry(messages) ?? messages;
  const last = retry.at(-1);
  if (!last || last.role !== "user" || !("timestamp" in last) || last.timestamp !== pending.timestamp) {
    clearPendingChatTurn(sessionId);
    return null;
  }
  clearPendingChatTurn(sessionId);
  return retry;
}
