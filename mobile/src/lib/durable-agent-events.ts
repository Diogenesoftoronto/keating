import type { AgentStreamEvent } from "@keating/learner-contracts";
import type { PersistedAppState } from "./types";

/**
 * Reasoning summaries are deliberately ephemeral. Older app versions stored
 * provider-private thought under the same event type, so no persisted
 * reasoning-delta can be proven safe after an upgrade or import.
 */
export function durableAgentEvents(
  events: readonly AgentStreamEvent[] | undefined,
): AgentStreamEvent[] | undefined {
  const durable = events?.filter((event) => event.type !== "reasoning-delta");
  return durable?.length ? structuredClone(durable) : undefined;
}

/** A non-terminal durable trace means the process ended before it recorded completion/cancellation. */
export function interruptedAgentTurn(events: readonly AgentStreamEvent[] | undefined): boolean {
  return Boolean(events?.length
    && !events.some((event) => event.type === "completed" || event.type === "cancelled"));
}

export function stripEphemeralReasoning(state: PersistedAppState): PersistedAppState {
  return {
    ...state,
    sessions: state.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => {
        const { agentEvents: sourceEvents, ...rest } = message;
        const agentEvents = durableAgentEvents(sourceEvents);
        return agentEvents ? { ...rest, agentEvents } : rest;
      }),
    })),
  };
}
