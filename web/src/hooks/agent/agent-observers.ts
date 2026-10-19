/**
 * Execution observers attached to each live conversation: product analytics
 * and trace export, and the persistence observer that debounces snapshots
 * while a reply streams, saves at each message end, feeds the reply judge and
 * teaching adjustment, records artifacts, and runs idle work after each turn.
 */
import type { PostHog } from "posthog-js";
import type { FlueConversation } from "../../keating/flue/conversation";
import { createReplyJudgementObserver } from "../../keating/judgement/reply-review";
import { keatingLifecycle } from "../../keating/lifecycle";
import { recordAgentEvent, type ConversationRuntime } from "../../keating/integration";
import { toolExecutionSucceeded } from "../../keating/tool-result";
import { subscribeAgentAnalytics } from "../../lib/agent-analytics";
import { readAnalyticsPreferences } from "../../lib/analytics-preferences";
import { currentTurnEvaluationContent } from "../../lib/arize-evaluation-content";
import { recordSessionDebugAgentEvent } from "../../lib/session-debug";
import type { SessionSnapshotTracker } from "../session-switch";
import type { AgentHostRefs } from "./host-refs";
import type { TeachingConversation } from "./teaching-conversation";

// Lesson plans, concept maps, and verification checklists are no longer
// agent tools — they are streamed as OpenUI components (StudyPlan,
// ConceptMap, SharedNotes, Explanation) inside LearningSurface. Keep the
// durable-saved artifact tools here so the chat can still surface historical
// plans/maps alongside media and self-improvement work.
export const ARTIFACT_TOOL_NAMES = new Set([
  "animate",
  "quiz",
  "deck",
  "generate_image",
  "bench",
  "evolve",
  "auto_improve",
  "prompt_evolve",
  "evaluate_teaching",
  "request_teaching_improvement",
]);

/** Delay before a streaming update is saved; a message end saves at once. */
export const STREAMING_SNAPSHOT_DELAY_MS = 400;

export function subscribeConversationAnalytics(
  refs: AgentHostRefs,
  agent: FlueConversation,
  sessionId: string,
  posthog: Pick<PostHog, "capture">,
): () => void {
  return subscribeAgentAnalytics(agent.execution, {
    capture: (event, properties) => posthog.capture(event, properties),
    sessionId,
    getModel: () => ({
      id: agent.context.model.id,
      provider: agent.context.model.provider,
    }),
    getSource: () =>
      agent.context.model.provider === "browser" ? "local" : "provider",
    getTurnIndex: () => refs.analyticsTurnIndexRef.current,
    appVersion: String(import.meta.env.APP_VERSION ?? "dev"),
    isArtifactTool: (toolName) => ARTIFACT_TOOL_NAMES.has(toolName),
    getEvaluationContent: () => {
      const preference = readAnalyticsPreferences(false);
      if (
        !preference.arizeEvaluationEnabled ||
        !refs.arizeConfigRef.current.evaluationContentEnabled
      )
        return undefined;
      return currentTurnEvaluationContent(agent.context.messages);
    },
    onCompletedRun: (envelope) => {
      const preference = readAnalyticsPreferences(false);
      void refs.arizeTraceClientRef.current?.submit(
        envelope,
        refs.arizeConfigRef.current,
        preference.arizeEvaluationEnabled,
      );
    },
  });
}

/**
 * Serialised saves of one conversation, plus a debounced variant for streaming
 * updates. Saves never overlap and a failed save does not block the next one.
 */
export function createSnapshotScheduler(
  save: () => Promise<void>,
  timers: Pick<Window, "setTimeout" | "clearTimeout"> = window,
) {
  let snapshotTimer: number | null = null;
  let snapshotQueue = Promise.resolve();
  const persistSnapshot = () => {
    snapshotQueue = snapshotQueue
      .catch(() => {})
      .then(save);
    return snapshotQueue;
  };
  const scheduleSnapshot = () => {
    if (snapshotTimer !== null) return;
    snapshotTimer = timers.setTimeout(() => {
      snapshotTimer = null;
      void persistSnapshot();
    }, STREAMING_SNAPSHOT_DELAY_MS);
  };
  /** Cancels a pending debounced save and saves now. */
  const persistNow = () => {
    if (snapshotTimer !== null) timers.clearTimeout(snapshotTimer);
    snapshotTimer = null;
    void persistSnapshot();
  };
  const cancel = () => {
    if (snapshotTimer !== null) timers.clearTimeout(snapshotTimer);
  };
  return { persistSnapshot, scheduleSnapshot, persistNow, cancel };
}

export function observeConversationPersistence({
  refs,
  conversation,
  sessionId,
  sessionSnapshots,
  persistCurrentSnapshotRef,
  save,
  conversationRuntime,
  posthog,
  onIdle,
}: {
  refs: AgentHostRefs;
  conversation: TeachingConversation;
  sessionId: string;
  sessionSnapshots: SessionSnapshotTracker;
  persistCurrentSnapshotRef: { current: () => Promise<void> };
  save: () => Promise<void>;
  conversationRuntime: (sessionId: string) => ConversationRuntime | null;
  posthog: Pick<PostHog, "capture">;
  /** Runs after the turn's final save, once the agent is idle. */
  onIdle: () => Promise<void>;
}): { persistSnapshot: () => Promise<void>; dispose: () => void } {
  const { agent, adjustment, recall, memory } = conversation;
  const scheduler = createSnapshotScheduler(save);
  const { persistSnapshot } = scheduler;
  persistCurrentSnapshotRef.current = persistSnapshot;
  const judgementObserver = createReplyJudgementObserver(sessionId, undefined, {
    captureSourceValidity: () => {
      const reviewedModel = `${agent.context.model.provider}/${agent.context.model.id}`;
      return () => refs.agentRef.current === agent && refs.sessionIdRef.current === sessionId
        && `${agent.context.model.provider}/${agent.context.model.id}` === reviewedModel;
    },
    onReview: (response, messages, replyId, calibration, current) => {
      // agent_end observers run before Flue clears its streaming flag. Even
      // an immediate local judgement must wait for idle before offering it.
      void agent.whenIdle().then(() => {
        if (current()) adjustment.offer(response, messages, replyId, calibration);
      });
    },
  });
  const unsubscribePersistence = agent.observeExecution((ev) => {
    if (ev.type === "agent_start") {
      adjustment.startRun(agent.context.messages);
      judgementObserver.start(agent.context.messages.length);
    }
    if (ev.type === "agent_end") {
      adjustment.finishRun();
      judgementObserver.finish(agent.context.messages);
    }
    if (ev.type === "message_update" || ev.type === "message_end" || ev.type === "message_start") sessionSnapshots.changed(agent);
    recordSessionDebugAgentEvent(agent, ev);
    const canonicalRuntime = conversationRuntime(sessionId);
    if (canonicalRuntime) recordAgentEvent(canonicalRuntime, ev);
    if (ev.type === "message_update") {
      scheduler.scheduleSnapshot();
    } else if (ev.type === "message_end") {
      scheduler.persistNow();
    }
    if (ev.type === "tool_execution_end") {
      const succeeded = toolExecutionSucceeded(ev);
      if (succeeded && ARTIFACT_TOOL_NAMES.has(ev.toolName)) {
        posthog.capture("artifact_created", {
          tool_name: ev.toolName,
          session_id: sessionId,
        });
        window.dispatchEvent(
          new CustomEvent("keating:artifact-created", {
            detail: { toolName: ev.toolName, result: ev.result },
          }),
        );
        void keatingLifecycle.emit({
          type: "artifact_finalized",
          sessionId,
          artifact: { kind: ev.toolName, payload: ev.result },
        });
      }
    }
    if (ev.type === "agent_end") {
      refs.untrustedSearchProvenanceRef.current = false;
      agent
        .whenIdle()
        .then(() => persistSnapshot())
        .then(async () => {
          await keatingLifecycle.emit({
            type: "session_idle",
            sessionId,
          });
          await onIdle();
        })
        .catch(console.error);
    }
  });
  const dispose = () => {
    judgementObserver.dispose();
    adjustment.dispose();
    recall.dispose();
    memory.dispose();
    unsubscribePersistence();
    scheduler.cancel();
    if (persistCurrentSnapshotRef.current === persistSnapshot) {
      persistCurrentSnapshotRef.current = async () => {};
    }
  };
  return { persistSnapshot, dispose };
}
