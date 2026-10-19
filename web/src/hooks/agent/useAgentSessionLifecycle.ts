/**
 * Lifecycle of the browser teacher's live conversation.
 *
 * `useAgentSessionLifecycle` creates conversations: it prepares the runtime,
 * disposes the previous conversation, wires its observers and hands it to the
 * chat panel. A conversation is created only while `isCurrent()` holds, so a
 * superseded navigation never replaces a newer one.
 *
 * `useChatPanelAttachment` returns the panel's callback ref. A remounted panel
 * re-attaches the existing conversation; a first mount restores the latest (or
 * requested) saved session, or starts a new one, guarded by an attachment
 * generation so a detached panel's delayed bootstrap does nothing.
 *
 * Subscriptions (panel events, analytics, persistence) are replaced whenever a
 * conversation is created and released on unmount.
 */
import { useCallback, useEffect, useRef } from "react";
import type { PostHog } from "posthog-js";
import type { AgentState, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { FlueConversation } from "../../keating/flue/conversation";
import type { TeachingAdjustmentController } from "../../keating/judgement/teaching-adjustment";
import type { ConversationRuntime } from "../../keating/integration";
import type { KeatingToolsOptions } from "../../keating/browser-tools";
import { shouldAutoBootNodePod } from "../../keating/agent-runtime";
import { loadLearnerContext } from "../../keating/learner-context";
import { bootNodePod } from "../../keating/nodepod-runtime";
import { authorKeatingBrowserAgent } from "../../keating/portable-agent";
import type { WebSpeechSettings } from "../../keating/speech";
import { loadKeatingUiSettings } from "../../keating/ui-settings";
import { registerKeatingWebMcp } from "../../keating/webmcp";
import { getProviderApiKey } from "../../lib/provider-models";
import { isNotOrganicProvider } from "../../notorganic-provider";
import { claimPendingChatTurn, pendingChatTurn } from "../../notorganic-provider/pending-chat-turn";
import type { ChatPanelHandle } from "../../types/chat-panel";
import type { SessionData, SessionMetadata } from "../../types/session";
import { subscribeAgentEvents } from "../agent-subscriptions";
import { keatingStorage, sessions } from "../keating-storage";
import { observeConversationPersistence, subscribeConversationAnalytics } from "./agent-observers";
import { prepareAgentRuntime, type PreparedAgent, type ToolOptionsFactory } from "./agent-tools";
import type { AgentHostRefs } from "./host-refs";
import { reattachedPanelCallbacks, sessionPanelCallbacks } from "./panel-callbacks";
import {
  bootstrapMayProceed,
  latestRestorableSessionId,
  locationWithoutSessionParam,
  requestedSessionId,
  withSessionRestoreTimeout,
} from "./session-restore";
import {
  createSessionStartContextLoader,
  createTeachingConversation,
  portableHostsFor,
  refreshToolsForNodePod,
} from "./teaching-conversation";
import type { SessionPersistence } from "./useSessionPersistence";
import { buildAgentSystemPrompt } from "./system-prompt";

type Capture = Pick<PostHog, "capture">;

export interface CreateAgentOptions {
  preserveSelectedModel?: boolean;
  prepared?: PreparedAgent;
  isCurrent?: () => boolean;
  /** Runs once the switch is certain, before the new conversation is built. */
  onCommit?: () => void;
  /** The restored history is already stored; skip the first save. */
  alreadySaved?: boolean;
}

export type CreateAgent = (
  panel: ChatPanelHandle,
  initialState?: Partial<AgentState>,
  options?: CreateAgentOptions,
) => Promise<void>;

export type PrepareAgent = (
  initialState?: Partial<AgentState>,
  preserveSelectedModel?: boolean,
) => Promise<PreparedAgent>;

/** Replaced on every conversation; released on unmount. */
export interface AgentSubscriptions {
  panel: (() => void) | null;
  persistence: (() => void) | null;
  analytics: (() => void) | null;
}

/** Releases the previous subscription before subscribing again. */
function replaceSubscription(
  subscriptions: AgentSubscriptions,
  key: keyof AgentSubscriptions,
  subscribe: () => () => void,
) {
  subscriptions[key]?.();
  subscriptions[key] = subscribe();
}

/**
 * Starts a signed-in turn that was interrupted by an account redirect, now
 * that credentials exist. Claimed before starting so StrictMode/remounts
 * cannot submit twice.
 */
async function resumeClaimedChatTurn(
  refs: AgentHostRefs,
  agent: FlueConversation,
  sessionId: string,
  ensureSessionStartContext: () => Promise<void>,
  persistSnapshot: () => Promise<void>,
): Promise<void> {
  if (!(isNotOrganicProvider(agent.context.model.provider) && await getProviderApiKey(agent.context.model.provider)
    && refs.agentRef.current === agent && !agent.context.isStreaming)) return;
  const pending = claimPendingChatTurn(sessionId, agent.context.messages);
  if (!pending) return;
  agent.context.messages = pending.messages;
  const prepare = async (signal: AbortSignal) => {
    await ensureSessionStartContext();
    signal.throwIfAborted();
  };
  void (async () => {
    // A turn interrupted before admission must be delivered as the
    // learner's message, or the chat shows only the reply.
    await (pending.undelivered ? agent.sendRestored(prepare) : agent.resume(prepare));
    await persistSnapshot();
  })().catch(error => console.error("Keating could not resume the signed-in message:", error));
}

export function useAgentSessionLifecycle({
  refs,
  persistence,
  posthog,
  speechSettings,
  courseContext,
  toolOptions,
  applyThinkingLevel,
  selectModel,
  conversationRuntime,
  maybeGenerateAlternativeResponse,
  setTeachingAdjustment,
  openModelSelector,
  openImageModelSelector,
  forkSessionRef,
}: {
  refs: AgentHostRefs;
  persistence: SessionPersistence;
  posthog: Capture;
  speechSettings: WebSpeechSettings;
  courseContext: KeatingToolsOptions["course"];
  toolOptions: ToolOptionsFactory;
  applyThinkingLevel: (level: ThinkingLevel) => void;
  selectModel: (model: Model<Api>) => void;
  conversationRuntime: (sessionId?: string) => ConversationRuntime | null;
  maybeGenerateAlternativeResponse: (agent: FlueConversation, sourceSessionId: string) => Promise<void>;
  setTeachingAdjustment: (controller: TeachingAdjustmentController | null) => void;
  openModelSelector: () => void;
  openImageModelSelector: () => void;
  /** Navigation is created after this hook; forks go through the latest one. */
  forkSessionRef: { current: (sessionId: string, forkPoint?: number) => Promise<void> };
}): {
  prepareAgent: PrepareAgent;
  createAgent: CreateAgent;
  subscriptions: AgentSubscriptions;
} {
  const subscriptionsRef = useRef<AgentSubscriptions>({ panel: null, persistence: null, analytics: null });
  const { saveSessionSnapshot } = persistence;

  const prepareAgent = useCallback<PrepareAgent>(
    (initialState, preserveSelectedModel = false) => prepareAgentRuntime({
      refs, initialState, preserveSelectedModel, speechSettings, toolOptions,
    }),
    [speechSettings, toolOptions],
  );

  const createAgent = useCallback<CreateAgent>(
    async (panel, initialState, options) => {
      const sourceSessionId = refs.sessionIdRef.current;
      const request = refs.sessionSwitchRequestsRef.current.current;
      const isCurrent = options?.isCurrent ?? (() =>
        refs.sessionSwitchRequestsRef.current.isCurrent(request) && refs.sessionIdRef.current === sourceSessionId && refs.panelRef.current === panel);
      const { promptBase, agentRuntime, resolvedModel, tools } = options?.prepared ?? await prepareAgent(initialState, options?.preserveSelectedModel);
      if (!isCurrent()) return;
      options?.onCommit?.();
      const agentSessionId = refs.sessionIdRef.current;
      const agentCreatedAt = refs.sessionCreatedAtRef.current;
      refs.systemPromptBaseRef.current = promptBase;
      if (refs.sessionStartContextRef.current.sessionId !== agentSessionId) {
        refs.sessionStartContextRef.current = { sessionId: agentSessionId, context: "", promise: null };
      }
      const sessionStartRecord = refs.sessionStartContextRef.current;
      refs.agentRuntimeRef.current = agentRuntime;
      registerKeatingWebMcp(keatingStorage, tools).catch(console.warn);
      selectModel(resolvedModel);
      const thinkingLevel =
        initialState?.thinkingLevel ?? loadKeatingUiSettings().reasoningLevel;
      const systemPrompt = buildAgentSystemPrompt(
        speechSettings.enabled,
        promptBase,
        loadLearnerContext(),
        sessionStartRecord.context,
        agentRuntime,
        courseContext,
      );
      const portableHosts = portableHostsFor(resolvedModel, thinkingLevel);
      const authored = await authorKeatingBrowserAgent({
        instanceId: `browser-teacher-${agentSessionId}`,
        modelKey: `${resolvedModel.provider}/${resolvedModel.id}`,
        systemPrompt,
        tools,
        hosts: portableHosts,
      });
      const nextState: Partial<AgentState> = {
        ...initialState,
        model: resolvedModel,
        thinkingLevel,
        messages: [],
        tools: [...authored.tools],
        ...(initialState?.messages ? { messages: initialState.messages } : {}),
        systemPrompt: authored.systemPrompt,
      };

      if (refs.agentRef.current instanceof FlueConversation) await refs.agentRef.current.dispose();
      if (!isCurrent()) return;
      const conversation = createTeachingConversation({
        refs, sessionId: agentSessionId, nextState, tools: authored.tools,
      });
      const { agent, adjustment } = conversation;
      setTeachingAdjustment(adjustment);
      refs.agentRef.current = agent;
      if (options?.alreadySaved) persistence.sessionSnapshots.remember(agent, persistence.sessionSnapshots.capture(agent, agent.context));
      const ensureSessionStartContext = createSessionStartContextLoader({
        refs,
        agent,
        sessionId: agentSessionId,
        record: sessionStartRecord,
        learnerBookkeeping: () => persistence.learnerBookkeepingRef.current,
        courseContext,
      });
      refs.ensureSessionStartContextRef.current = ensureSessionStartContext;

      // NodePod is the browser-only local sandbox. Explicit remote/cloud modes
      // stay external and must never be silently captured by a local pod.
      if (shouldAutoBootNodePod(agentRuntime)) {
        refreshToolsForNodePod({
          refs, agent, sessionId: agentSessionId, resolvedModel, portableHosts,
          speechSettings, courseContext, toolOptions, bootNodePod,
        });
      }

      const subscriptions = subscriptionsRef.current;
      replaceSubscription(subscriptions, "panel", () => subscribeAgentEvents(agent.execution, panel as any));
      replaceSubscription(subscriptions, "analytics", () => subscribeConversationAnalytics(refs, agent, agentSessionId, posthog));
      subscriptions.persistence?.();
      const { persistSnapshot, dispose } = observeConversationPersistence({
        refs,
        conversation,
        sessionId: agentSessionId,
        sessionSnapshots: persistence.sessionSnapshots,
        persistCurrentSnapshotRef: persistence.persistCurrentSnapshotRef,
        save: () => saveSessionSnapshot(agent, agentSessionId, agentCreatedAt),
        conversationRuntime,
        posthog,
        onIdle: () => maybeGenerateAlternativeResponse(agent, agentSessionId),
      });
      subscriptions.persistence = dispose;

      await panel.setConversation(agent, sessionPanelCallbacks({
        refs,
        agent,
        posthog,
        conversationRuntime,
        applyThinkingLevel,
        openModelSelector,
        openImageModelSelector,
        forkSession: (sessionId, forkPoint) => forkSessionRef.current(sessionId, forkPoint),
        sessionId: agentSessionId,
        ensureSessionStartContext,
        persistSnapshot,
        saveLocalMessages: () => {
          persistence.sessionSnapshots.changed(agent);
          return saveSessionSnapshot(agent, agentSessionId, agentCreatedAt);
        },
      }));
      await resumeClaimedChatTurn(refs, agent, agentSessionId, ensureSessionStartContext, persistSnapshot);
    },
    [
      prepareAgent,
      applyThinkingLevel,
      maybeGenerateAlternativeResponse,
      posthog,
      saveSessionSnapshot,
      speechSettings,
      toolOptions,
    ],
  );

  useEffect(() => {
    return () => {
      const subscriptions = subscriptionsRef.current;
      if (subscriptions.panel) subscriptions.panel();
      if (subscriptions.persistence) subscriptions.persistence();
      if (subscriptions.analytics) subscriptions.analytics();
    };
  }, []);

  return { prepareAgent, createAgent, subscriptions: subscriptionsRef.current };
}

export function useChatPanelAttachment({
  refs,
  persistence,
  posthog,
  subscriptions,
  createAgent,
  loadSession,
  forkSession,
  applyThinkingLevel,
  conversationRuntime,
  requestPersistentStorageOnce,
  openModelSelector,
  openImageModelSelector,
}: {
  refs: AgentHostRefs;
  persistence: SessionPersistence;
  posthog: Capture;
  subscriptions: AgentSubscriptions;
  createAgent: CreateAgent;
  loadSession: (session: SessionData, request?: number) => Promise<void>;
  forkSession: (sessionId: string, forkPoint?: number) => Promise<void>;
  applyThinkingLevel: (level: ThinkingLevel) => void;
  conversationRuntime: (sessionId?: string) => ConversationRuntime | null;
  requestPersistentStorageOnce: () => void;
  openModelSelector: () => void;
  openImageModelSelector: () => void;
}): (node: ChatPanelHandle | null) => void {
  const bootstrapTimerRef = useRef<number | null>(null);
  const bootstrapGenerationRef = useRef(0);
  const { saveSessionSnapshot } = persistence;

  // Use a callback ref to safely initialize the agent when the DOM node resolves
  return useCallback(
    (node: ChatPanelHandle | null) => {
      if (bootstrapTimerRef.current !== null) {
        clearTimeout(bootstrapTimerRef.current);
        bootstrapTimerRef.current = null;
      }

      bootstrapGenerationRef.current += 1;
      refs.panelRef.current = node;

      if (!node) return;

      const existingAgent = refs.agentRef.current;
      if (existingAgent) {
        // Re-attach existing agent if component re-mounted (e.g. strict mode)
        if (subscriptions.panel) subscriptions.panel();
        subscriptions.panel = subscribeAgentEvents(existingAgent.execution, node as any);
        node.setConversation(existingAgent, reattachedPanelCallbacks({
          refs,
          agent: existingAgent,
          posthog,
          conversationRuntime,
          applyThinkingLevel,
          openModelSelector,
          openImageModelSelector,
          forkSession,
          persistCurrentSnapshot: () => persistence.persistCurrentSnapshotRef.current(),
          persistTurn: (sourceSessionId) =>
            saveSessionSnapshot(existingAgent, sourceSessionId, refs.sessionCreatedAtRef.current),
          saveLocalMessages: () => {
            persistence.sessionSnapshots.changed(existingAgent);
            return saveSessionSnapshot(existingAgent);
          },
        })).catch(console.error);
        return;
      }

      const generation = bootstrapGenerationRef.current;
      const request = refs.sessionSwitchRequestsRef.current.current;
      const mayProceed = () => bootstrapMayProceed({
        generationCurrent: bootstrapGenerationRef.current === generation,
        requestCurrent: refs.sessionSwitchRequestsRef.current.isCurrent(request),
        panelUnchanged: refs.panelRef.current === node,
        hasAgent: Boolean(refs.agentRef.current),
      });
      bootstrapTimerRef.current = window.setTimeout(() => {
        if (!mayProceed()) return;

        requestPersistentStorageOnce();

        void (async () => {
          try {
            const requestedId = requestedSessionId(window.location.search, pendingChatTurn);
            const latestSessionId = await withSessionRestoreTimeout(
              requestedId
                ? Promise.resolve(requestedId)
                : (
                    sessions.getAllMetadata() as Promise<SessionMetadata[]>
                  ).then(latestRestorableSessionId),
              "Restoring latest session",
            );
            if (!mayProceed()) return;

            if (latestSessionId) {
              const session = await withSessionRestoreTimeout(
                sessions.loadSession(latestSessionId),
                "Loading latest session",
              );
              if (!mayProceed()) return;
              if (session) {
                await loadSession(session, request);
                if (requestedId) {
                  window.history.replaceState(
                    {},
                    "",
                    locationWithoutSessionParam(window.location),
                  );
                }
                return;
              }
            }

            if (!mayProceed()) return;

            await createAgent(node);
            posthog.capture("session_started", {
              session_id: refs.sessionIdRef.current,
              source: "initial",
              is_initial: true,
            });
          } catch (error) {
            console.warn(
              "Could not restore the latest saved session; starting a new chat session.",
              error,
            );
            if (mayProceed()) {
              await createAgent(node).catch(console.error);
            }
          }
        })();
      }, 0);
    },
    [
      applyThinkingLevel,
      createAgent,
      loadSession,
      requestPersistentStorageOnce,
      saveSessionSnapshot,
    ],
  );
}
