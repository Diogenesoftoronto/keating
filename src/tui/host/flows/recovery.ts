/**
 * Draft recovery: restore the exact prompt when a response fails or is stopped,
 * and the RPC event hook that tracks activity, debug events and terminal errors.
 */
import { captureTuiDebugEvent } from "../../debug.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";


/** Most recent RPC events kept for the debug service. */
export const RUNTIME_DEBUG_EVENT_LIMIT = 100;

export type RecoveryDeps = Pick<HostContext, "promptRecovery" | "view">;
export type RecoveryEventDeps = RecoveryDeps & Pick<HostContext, "client" | "sidebar" | "state">;

export function restorePendingDraft(deps: RecoveryDeps, reason: string, title = "Exact draft restored"): string | null {
  const { promptRecovery } = deps;
  const { appendEntry, status, composer: input } = deps.view;
  const restored = promptRecovery.failPending();
  if (restored === null) return null;
  input.value = restored;
  appendEntry({
    id: `prompt-recovery-${Date.now()}`,
    kind: "notice",
    title,
    body: `${sanitizeDiagnostic(reason)}\n\nEdit the restored composer text, press Ctrl+R to retry, or open /settings to repair provider access. /shell remains available only for the code-capable interface.`,
  });
  status.content = "Response did not complete. Exact draft restored · Ctrl+R retries · /settings repairs provider access.";
  return restored;
}

/** The slice of an RPC event this hook reads; every field is optional on the wire. */
interface RecoveryEvent {
  type?: string;
  message?: { role?: string; stopReason?: string; errorMessage?: string };
  toolName?: string;
}

/**
 * Subscribe to the Pi RPC event stream: keep the debug ring, track the
 * activity phase for the busy indicator, remember how the last assistant
 * message ended, and on `agent_end` either complete or restore the pending
 * prompt. Returns the unsubscribe function.
 */
export function attachRecoveryEvents(deps: RecoveryEventDeps): () => void {
  // Read deps.sidebar per event: the real sidebar is bound after this subscribes.
  const { client, state, promptRecovery } = deps;
  let terminalResponseError: string | null = null;
  return client.onEvent((event) => {
    const debugEvent = captureTuiDebugEvent(event);
    if (debugEvent) {
      state.runtimeDebugEvents.push(debugEvent);
      if (state.runtimeDebugEvents.length > RUNTIME_DEBUG_EVENT_LIMIT) state.runtimeDebugEvents.shift();
    }
    const candidate = event as RecoveryEvent | null;
    if (!candidate || typeof candidate !== "object") return;
    if (candidate.type === "agent_start") {
      terminalResponseError = null;
      state.activityPhase = "thinking";
      state.activityDetail = undefined;
      return;
    }
    if (candidate.type === "message_update" && candidate.message?.role === "assistant") {
      state.activityPhase = "responding";
      state.activityDetail = undefined;
      return;
    }
    if (candidate.type === "tool_execution_start") {
      state.activityPhase = "tool";
      state.activityDetail = candidate.toolName || "tool";
      return;
    }
    if (candidate.type === "tool_execution_end") {
      state.activityPhase = "thinking";
      state.activityDetail = undefined;
      return;
    }
    if (candidate.type === "message_end" && candidate.message?.role === "assistant") {
      terminalResponseError = candidate.message.stopReason === "error" || candidate.message.stopReason === "aborted"
        ? candidate.message.errorMessage || candidate.message.stopReason
        : null;
      return;
    }
    if (candidate.type !== "agent_end") return;
    void deps.sidebar.refreshSessions();
    if (!terminalResponseError) {
      promptRecovery.completePending();
      return;
    }
    restorePendingDraft(deps, terminalResponseError);
  });
}
