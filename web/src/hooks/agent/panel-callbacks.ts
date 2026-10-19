/**
 * Callbacks the chat panel receives with a conversation: credential prompts,
 * auth recovery, turn start, retries, model selection and forking.
 *
 * There are two sets. `sessionPanelCallbacks` is built when a conversation is
 * created and is bound to that conversation's session. `reattachedPanelCallbacks`
 * is built when a remounted panel (for example under StrictMode) picks up the
 * existing conversation; it reads the session id live instead.
 */
import type { PostHog } from "posthog-js";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { FlueConversation } from "../../keating/flue/conversation";
import type { PendingLearnerResponse } from "../../keating/event-store";
import type { ConversationRuntime } from "../../keating/integration";
import { keatingLifecycle } from "../../keating/lifecycle";
import { promptKeatingApiKey } from "../../components/KeatingApiKeyPromptDialog";
import { getProviderApiKey } from "../../lib/provider-models";
import { isNotOrganicProvider, notOrganicModelNeedsConsent } from "../../notorganic-provider";
import { clearPendingChatTurn, rememberChatTurn } from "../../notorganic-provider/pending-chat-turn";
import type { ChatPanelSetupCallbacks } from "../../types/chat-panel";
import { prepareMessagesForRetry } from "../session-recovery";
import type { AgentHostRefs } from "./host-refs";

type Capture = Pick<PostHog, "capture">;

/** Index of the learner turn a retry regenerates. */
export function retryTurnIndex(messages: readonly { role: string }[]): number {
  return Math.max(
    0,
    messages.filter((message) => message.role === "user").length - 1,
  );
}

/** Drops a failed reply and resumes from the last learner message; no-op while streaming. */
export async function retryLastTurn(
  refs: AgentHostRefs,
  agent: FlueConversation,
  beforeResume: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (agent.context.isStreaming) return;
  const retryMessages = prepareMessagesForRetry(agent.context.messages);
  if (!retryMessages) return;
  refs.untrustedSearchProvenanceRef.current = false;
  agent.context.messages = retryMessages;
  refs.analyticsTurnIndexRef.current = retryTurnIndex(retryMessages);
  await agent.resume(beforeResume);
}

/** Runs before each learner send: session-start context, lifecycle hook, analytics. */
async function beginTurn(
  refs: AgentHostRefs,
  agent: FlueConversation,
  sessionId: () => string,
  ensureSessionStartContext: () => Promise<void>,
  posthog: Capture,
): Promise<void> {
  refs.untrustedSearchProvenanceRef.current = false;
  await ensureSessionStartContext();
  await keatingLifecycle.emit({
    type: "before_turn",
    sessionId: sessionId(),
  });
  if (import.meta.env.DEV) {
    console.log(
      `[keating:send] model=${agent.context.model.provider}/${agent.context.model.id} messages=${agent.context.messages.length}`,
    );
  }
  const turnIndex = agent.context.messages.filter(
    (m) => m.role === "user",
  ).length;
  refs.analyticsTurnIndexRef.current = turnIndex;
  const model = `${agent.context.model.provider}/${agent.context.model.id}`;
  posthog.capture("message_sent", {
    session_id: sessionId(),
    turn_index: turnIndex,
    turn_number: turnIndex + 1,
    model,
    provider: agent.context.model.provider,
  });
  window.dispatchEvent(
    new CustomEvent("keating:message-sent", {
      detail: { sessionId: sessionId(), turnIndex },
    }),
  );
  if (turnIndex === 0) {
    posthog.capture("first_message_sent", {
      session_id: sessionId(),
      model,
      provider: agent.context.model.provider,
    });
  }
}

/**
 * Not Organic sign-in leaves the page, so the turn is saved and remembered
 * first and resumed after the redirect (see resumeClaimedChatTurn).
 */
function credentialCallbacks({
  agent,
  sessionId,
  persistTurn,
  posthog,
  onRecovered,
}: {
  agent: FlueConversation;
  sessionId: () => string;
  persistTurn: (sessionId: string) => Promise<void>;
  posthog: Capture;
  /** Called after credentials were re-entered; retries the failed turn. */
  onRecovered: (provider: string) => void;
}): Pick<ChatPanelSetupCallbacks, "onApiKeyRequired" | "onAuthError"> {
  return {
    onApiKeyRequired: async (provider: string) => {
      if (provider === "browser") return true;
      const needsModelConsent = notOrganicModelNeedsConsent(agent.context.model);
      if (await getProviderApiKey(provider) && !needsModelConsent) return true;
      const sourceSessionId = sessionId();
      if (isNotOrganicProvider(provider)) {
        await persistTurn(sourceSessionId);
        rememberChatTurn(sourceSessionId, agent.context.messages);
      }
      const allowed = await promptKeatingApiKey(provider, { force: needsModelConsent });
      if (isNotOrganicProvider(provider)) clearPendingChatTurn(sourceSessionId);
      return allowed;
    },
    onAuthError: async (provider: string) => {
      if (provider === "browser") return false;
      posthog.capture("api_error", {
        error_type: "auth",
        provider,
        session_id: sessionId(),
      });
      posthog.capture("auth_recovery_prompted", {
        provider,
        session_id: sessionId(),
      });
      const sourceSessionId = sessionId();
      if (isNotOrganicProvider(provider)) {
        await persistTurn(sourceSessionId);
        rememberChatTurn(sourceSessionId, agent.context.messages);
      }
      const ok = await promptKeatingApiKey(provider, { force: true });
      if (isNotOrganicProvider(provider)) clearPendingChatTurn(sourceSessionId);
      posthog.capture("auth_recovery_action", {
        provider,
        session_id: sessionId(),
        outcome: ok ? "credentials_submitted" : "dismissed",
      });
      if (!ok) return false;
      onRecovered(provider);
      return true;
    },
  };
}

function learnerResponseCallbacks(
  sessionId: () => string,
  conversationRuntime: (sessionId: string) => ConversationRuntime | null,
): Pick<ChatPanelSetupCallbacks, "getPendingLearnerResponses" | "onLearnerResponseDelivered"> {
  return {
    getPendingLearnerResponses: () => conversationRuntime(sessionId())?.pendingLearnerResponses() ?? [],
    onLearnerResponseDelivered: (response: PendingLearnerResponse) => {
      const runtime = conversationRuntime(sessionId());
      runtime?.resolveLearnerResponse(response.receiptId);
      runtime?.resolveAction(response.uiActionId);
    },
  };
}

export interface PanelCallbackDeps {
  refs: AgentHostRefs;
  agent: FlueConversation;
  posthog: Capture;
  conversationRuntime: (sessionId: string) => ConversationRuntime | null;
  applyThinkingLevel: (level: ThinkingLevel) => void;
  openModelSelector: () => void;
  openImageModelSelector: () => void;
  forkSession: (sessionId: string, forkPoint?: number) => Promise<void>;
}

/** Callbacks for a freshly created conversation, bound to its session. */
export function sessionPanelCallbacks({
  refs,
  agent,
  posthog,
  conversationRuntime,
  applyThinkingLevel,
  openModelSelector,
  openImageModelSelector,
  forkSession,
  sessionId,
  ensureSessionStartContext,
  persistSnapshot,
  saveLocalMessages,
}: PanelCallbackDeps & {
  sessionId: string;
  ensureSessionStartContext: () => Promise<void>;
  persistSnapshot: () => Promise<void>;
  saveLocalMessages: () => Promise<void>;
}): ChatPanelSetupCallbacks {
  const currentSession = () => sessionId;
  const retryLastResponse = () => retryLastTurn(refs, agent, async signal => {
    await ensureSessionStartContext();
    signal.throwIfAborted();
    await persistSnapshot();
  });
  return {
    sessionId,
    ...learnerResponseCallbacks(currentSession, conversationRuntime),
    ...credentialCallbacks({
      agent,
      sessionId: currentSession,
      persistTurn: () => persistSnapshot(),
      posthog,
      // Key re-entered — actually recover by retrying the failed turn:
      // drop the trailing errored assistant message and resume generation
      // from the last user message.
      onRecovered: (provider) => {
        retryLastResponse().catch((error) => {
          console.error(
            "Keating retry after API key re-entry failed:",
            error,
          );
          posthog.capture("api_error", {
            error_type: "retry_failed",
            provider,
            session_id: sessionId,
          });
        });
      },
    }),
    onBeforeSend: () => beginTurn(refs, agent, currentSession, ensureSessionStartContext, posthog),
    onLocalMessagesChanged: saveLocalMessages,
    onModelSelect: () => {
      posthog.capture("model_selector_opened", {
        session_id: sessionId,
      });
      openModelSelector();
    },
    onImageGenerationModelSelect: () => {
      refs.imageModelRetryRef.current = retryLastResponse;
      openImageModelSelector();
    },
    onFork: (forkPoint?: number) => forkSession(sessionId, forkPoint),
    onRetry: retryLastResponse,
    thinkingLevel: agent.context.thinkingLevel,
    onThinkingLevelChange: (level: ThinkingLevel) => {
      applyThinkingLevel(level);
      posthog.capture("thinking_level_changed", {
        level,
        session_id: sessionId,
      });
    },
  };
}

/** Callbacks for a remounted panel showing the existing conversation. */
export function reattachedPanelCallbacks({
  refs,
  agent,
  posthog,
  conversationRuntime,
  applyThinkingLevel,
  openModelSelector,
  openImageModelSelector,
  forkSession,
  persistCurrentSnapshot,
  persistTurn,
  saveLocalMessages,
}: PanelCallbackDeps & {
  persistCurrentSnapshot: () => Promise<void>;
  /** Saves this conversation under the given session id before a sign-in redirect. */
  persistTurn: (sessionId: string) => Promise<void>;
  saveLocalMessages: () => Promise<void>;
}): ChatPanelSetupCallbacks {
  const currentSession = () => refs.sessionIdRef.current;
  const retryExistingResponse = () => retryLastTurn(refs, agent, async signal => {
    await refs.ensureSessionStartContextRef.current();
    signal.throwIfAborted();
    await persistCurrentSnapshot();
  });
  return {
    sessionId: refs.sessionIdRef.current,
    ...learnerResponseCallbacks(currentSession, conversationRuntime),
    ...credentialCallbacks({
      agent,
      sessionId: currentSession,
      persistTurn,
      posthog,
      onRecovered: () => { void retryExistingResponse(); },
    }),
    onBeforeSend: () => beginTurn(refs, agent, currentSession, () => refs.ensureSessionStartContextRef.current(), posthog),
    onLocalMessagesChanged: saveLocalMessages,
    onModelSelect: () => {
      posthog.capture("model_selector_opened", {
        session_id: refs.sessionIdRef.current,
      });
      openModelSelector();
    },
    onImageGenerationModelSelect: () => {
      refs.imageModelRetryRef.current = retryExistingResponse;
      openImageModelSelector();
    },
    onFork: (forkPoint?: number) =>
      forkSession(refs.sessionIdRef.current, forkPoint),
    onRetry: retryExistingResponse,
    thinkingLevel: agent.context.thinkingLevel,
    onThinkingLevelChange: (level: ThinkingLevel) => {
      applyThinkingLevel(level);
    },
  };
}
