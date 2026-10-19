/**
 * Construction of one browser teacher conversation.
 *
 * The Flue conversation's stream is wrapped, outermost first, by desktop
 * needle recall, the web memory bank, teaching adjustment and the teaching
 * draft gate. Every wrapper is told the conversation is current only while it
 * is still `agentRef.current` for the same session, so work started for a
 * replaced conversation never publishes into the next one.
 */
import flueRuntimeUrl from "virtual:keating-flue-runtime";
import type { AgentState, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { FlueConversation } from "../../keating/flue/conversation";
import { toModelMessagesWithTime } from "../../keating/flue/model-messages";
import { withTeachingDraftGate } from "../../keating/judgement/draft-gate";
import { clearTeachingDraftStatus, projectTeachingDraftSnapshot, publishTeachingDraftContent, publishTeachingDraftStatus } from "../../keating/judgement/draft-status";
import { teachingDraftEvidence } from "../../keating/judgement/draft-evidence";
import { loadActiveWork } from "../../keating/judgement/active-work-host";
import { createWebActivityLearning } from "../../keating/judgement/activity-learning";
import { createTeachingAdjustmentController, withTeachingAdjustment, type TeachingAdjustmentController } from "../../keating/judgement/teaching-adjustment";
import { createDesktopNeedleRecall, withDesktopNeedleRecall } from "../../keating/needle-retrieval";
import { createWebMemoryAdmission, withWebMemoryBank } from "../../keating/judgement/memory-admission";
import { notOrganicPublicClient } from "../../notorganic-provider";
import { createKeatingTools, type KeatingToolsOptions } from "../../keating/browser-tools";
import { loadAgentRuntimeConfig } from "../../keating/agent-runtime";
import { keatingLifecycle } from "../../keating/lifecycle";
import { loadLearnerContext } from "../../keating/learner-context";
import { appendKeatingPortableCatalog, authorKeatingBrowserAgent, type DelegationRequest } from "../../keating/portable-agent";
import { loadCompleteLearnerStartupContext, runSessionStartHooks } from "../../keating/session-start-hooks";
import type { WebSpeechSettings } from "../../keating/speech";
import { registerKeatingWebMcp } from "../../keating/webmcp";
import { loadKeatingUiSettings } from "../../keating/ui-settings";
import { getProviderApiKey } from "../../lib/provider-models";
import { recordSessionHook } from "../../lib/session-debug";
import { hybridStreamFn } from "../keating-stream";
import { keatingStorage, sessions } from "../keating-storage";
import { availableToolsFor, type ToolOptionsFactory } from "./agent-tools";
import type { AgentHostRefs, SessionStartRecord } from "./host-refs";
import { runPortableBrowserDelegate } from "./portable-delegate";
import { sessionHasSettledReply } from "./session-records";
import { buildAgentSystemPrompt } from "./system-prompt";

export type PortableHosts = Parameters<typeof authorKeatingBrowserAgent>[0]["hosts"];

export function portableHostsFor(model: Model<Api>, thinkingLevel: ThinkingLevel): PortableHosts {
  return {
    delegate: (request: DelegationRequest, signal?: AbortSignal) =>
      runPortableBrowserDelegate(
        request,
        model,
        thinkingLevel,
        signal,
      ),
    resolveMcpConnection: async () => [],
  };
}

export interface TeachingConversation {
  agent: FlueConversation;
  adjustment: TeachingAdjustmentController;
  memory: ReturnType<typeof createWebMemoryAdmission>;
  recall: ReturnType<typeof createDesktopNeedleRecall>;
}

export function createTeachingConversation({
  refs,
  sessionId,
  nextState,
  tools,
}: {
  refs: AgentHostRefs;
  sessionId: string;
  nextState: Partial<AgentState>;
  tools: readonly unknown[];
}): TeachingConversation {
  const isLive = () => refs.agentRef.current === agent && refs.sessionIdRef.current === sessionId;
  const latestLearnerMessage = () =>
    [...agent.context.messages].reverse().find(message => message.role === "user" || message.role === "user-with-attachments");
  const adjustment = createTeachingAdjustmentController({
    sessionId,
    source: () => ({ messages: agent.context.messages,
      current: isLive(),
      streaming: agent.context.isStreaming,
      model: `${agent.context.model.provider}/${agent.context.model.id}` }),
  });
  const memory = createWebMemoryAdmission({
    sessions,
    current: isLive,
    requestIdentity: () => JSON.stringify({ model: [agent.context.model.provider, agent.context.model.id],
      profile: agent.context.systemPrompt,
      learner: latestLearnerMessage() }),
  });
  const recall = createDesktopNeedleRecall({
    store: sessions,
    onRetrieved: (result, current) => {
      // The desktop judge and tutor share a native inference lease. Start
      // optional admission only after the reply releases that lease.
      void agent.whenIdle().then(() => { if (current()) memory.review(result, current); }).catch(() => {});
    },
    current: isLive,
    // Only compared in this volatile closure; no token enters the recall
    // corpus, model payload, persisted index, logs or provider prompt.
    identity: () => { try { const current = notOrganicPublicClient()?.getSession(); return current ? current.id ?? current.accessToken : "local"; } catch { return "unavailable"; } },
    requestIdentity: () => JSON.stringify({
      model: [agent.context.model.provider, agent.context.model.id],
      learner: latestLearnerMessage(),
    }),
  });
  clearTeachingDraftStatus(sessionId);
  const activityLearning = createWebActivityLearning({
    sessionId,
    source: keatingStorage,
    current: isLive,
  });
  const draftGate = withTeachingDraftGate(hybridStreamFn, {
    sessionId,
    basePrompt: () => refs.systemPromptBaseRef.current,
    isCurrent: isLive,
    activityLearning: activityLearning.select,
    activityLearningState: activityLearning.turnSettings,
    onPublished: activityLearning.published,
    evidence: async () => {
      const [profile, activeWork] = await Promise.all([
        loadCompleteLearnerStartupContext(keatingStorage),
        loadActiveWork(keatingStorage, sessionId),
      ]);
      return { ...teachingDraftEvidence(profile), activeWork };
    },
    onProgress: snapshot => publishTeachingDraftStatus(sessionId, snapshot),
    captureDraftContent: () => loadKeatingUiSettings().showDeveloperDetails,
    onDraftContent: candidate => publishTeachingDraftContent(sessionId, candidate),
    onReceipt: receipt => {
      void keatingStorage.recordTeachingDraftReceipt({
        id: `${sessionId}:${receipt.messageTimestamp}`,
        sessionId,
        messageTimestamp: receipt.messageTimestamp,
        createdAt: Date.now(),
        snapshot: projectTeachingDraftSnapshot(receipt.snapshot),
        ...(receipt.activeWork ? { activeWork: receipt.activeWork } : {}),
      }).catch(() => { /* Review receipts are diagnostic; publication does not depend on them. */ });
    },
  });
  const agent: FlueConversation = new FlueConversation({
    initialState: nextState,
    convertToLlm: (messages) => toModelMessagesWithTime(messages),
    streamFn: withDesktopNeedleRecall(withWebMemoryBank(withTeachingAdjustment(draftGate, adjustment), memory), recall),
    sessionId,
  }, flueRuntimeUrl);
  agent.getApiKey = (provider: string) => getProviderApiKey(provider);
  agent.context.tools = [...tools] as typeof agent.context.tools;
  return { agent, adjustment, memory, recall };
}

/**
 * Returns the step every send awaits before reaching the model: wait for the
 * previous session's bookkeeping, run session-start hooks once for a session
 * that has not yet been answered, and fold their context into the prompt.
 */
export function createSessionStartContextLoader({
  refs,
  agent,
  sessionId,
  record,
  learnerBookkeeping,
  courseContext,
}: {
  refs: AgentHostRefs;
  agent: FlueConversation;
  sessionId: string;
  record: SessionStartRecord;
  learnerBookkeeping: () => Promise<void>;
  courseContext: KeatingToolsOptions["course"];
}): () => Promise<void> {
  const sessionAlreadyAnswered = sessionHasSettledReply(agent.context.messages);
  return async () => {
    // Navigation stays immediate; a new teaching turn still sees feedback
    // and session-end records from the conversation we left.
    await learnerBookkeeping().catch(() => {});
    if (!record.context && sessionAlreadyAnswered) return;
    record.promise ??= (async () => {
      const hookStartedAt = performance.now();
      recordSessionHook("session-start-hooks", "started", { sessionId });
      try {
        await keatingLifecycle.emit({
          type: "session_start",
          sessionId,
        });
        const context = await runSessionStartHooks(keatingStorage);
        recordSessionHook(
          "session-start-hooks",
          "completed",
          { sessionId, contextCharacters: context.length },
          Math.round(performance.now() - hookStartedAt),
        );
        return context;
      } catch (error) {
        recordSessionHook(
          "session-start-hooks",
          "failed",
          { sessionId, error: error instanceof Error ? error.message : String(error) },
          Math.round(performance.now() - hookStartedAt),
        );
        throw error;
      }
    })();
    record.context = await record.promise;
    agent.context.systemPrompt = appendKeatingPortableCatalog(buildAgentSystemPrompt(
      refs.speechEnabledRef.current,
      refs.systemPromptBaseRef.current,
      loadLearnerContext(),
      record.context,
      refs.agentRuntimeRef.current,
      courseContext,
    ));
  };
}

/**
 * NodePod is the browser-only local sandbox. Once it boots, re-author the
 * conversation's tools for the sandbox runtime, unless the conversation has
 * been replaced in the meantime.
 */
export function refreshToolsForNodePod({
  refs,
  agent,
  sessionId,
  resolvedModel,
  portableHosts,
  speechSettings,
  courseContext,
  toolOptions,
  bootNodePod,
}: {
  refs: AgentHostRefs;
  agent: FlueConversation;
  sessionId: string;
  resolvedModel: Model<Api>;
  portableHosts: PortableHosts;
  speechSettings: WebSpeechSettings;
  courseContext: KeatingToolsOptions["course"];
  toolOptions: ToolOptionsFactory;
  bootNodePod: () => Promise<unknown>;
}): void {
  bootNodePod()
    .then((pod) => {
      if (!pod || !refs.agentRef.current) return;
      return loadAgentRuntimeConfig(true)
        .then(async (runtime) => ({
          runtime,
          tools: await createKeatingTools(
            keatingStorage,
            toolOptions(speechSettings, runtime),
          ),
        }))
        .then(async ({ runtime, tools: refreshedTools }) => {
          if (refs.agentRef.current !== agent) return;
          refs.agentRuntimeRef.current = runtime;
          const availableTools = await availableToolsFor(
            refreshedTools,
            runtime,
            speechSettings.enabled,
            agent.context.model as Model<Api>,
          );
          const refreshedPrompt = buildAgentSystemPrompt(
            speechSettings.enabled,
            refs.systemPromptBaseRef.current,
            loadLearnerContext(),
            refs.sessionStartContextRef.current.context,
            runtime,
            courseContext,
          );
          const refreshed = await authorKeatingBrowserAgent({
            instanceId: `browser-teacher-${sessionId}-nodepod`,
            modelKey: `${resolvedModel.provider}/${resolvedModel.id}`,
            systemPrompt: refreshedPrompt,
            tools: availableTools,
            hosts: portableHosts,
          });
          if (refs.agentRef.current !== agent) return;
          agent.context.tools = [...refreshed.tools];
          agent.context.systemPrompt = refreshed.systemPrompt;
          registerKeatingWebMcp(keatingStorage, availableTools).catch(
            console.warn,
          );
        });
    })
    .catch(console.warn);
}
