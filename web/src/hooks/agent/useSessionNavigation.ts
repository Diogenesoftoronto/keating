/**
 * Moving between sessions: new, open, fork, open the original, and choosing a
 * response in a comparison.
 *
 * Each action takes a `SessionSwitchRequests` request at the click. The old
 * session is saved while the next runtime prepares (`runSessionSwitch`), and
 * only the latest request may commit; a superseded switch still finishes its
 * save. Commit updates the session identity refs before the new conversation
 * is built, and records the end of the session left behind. Learner
 * submission delivery into the outgoing session is held for the whole switch.
 */
import { useCallback, type TransitionStartFunction } from "react";
import type { PostHog } from "posthog-js";
import type { AgentState } from "@earendil-works/pi-agent-core";
import type { FlueConversation } from "../../keating/flue/conversation";
import {
  buildPendingResponseComparison,
  type PendingResponseComparison,
  type ResponseComparisonDecision,
} from "../../keating/response-comparison";
import type { ForkInfo } from "../../stores/keating-agent-store";
import type { SessionData, SessionMetadata } from "../../types/session";
import { keatingStorage, sessions } from "../keating-storage";
import { buildForkSession, createSessionId } from "../session-metadata";
import { runSessionSwitch } from "../session-switch";
import type { AgentHostRefs } from "./host-refs";
import { initialForkInfo, recordResponsePreference } from "./session-records";
import type { CreateAgent, PrepareAgent } from "./useAgentSessionLifecycle";
import { pauseLearnerDelivery } from "../../components/chat/learner-delivery";
import type { SessionPersistence } from "./useSessionPersistence";

type Capture = Pick<PostHog, "capture">;

export interface SessionNavigation {
  newSession: () => void;
  loadSession: (session: SessionData, request?: number) => Promise<void>;
  loadSessionById: (sessionId: string, request?: number) => Promise<void>;
  forkSession: (sessionId: string, forkPoint?: number) => Promise<void>;
  openOriginalSession: () => void;
  chooseResponse: (preference: ResponseComparisonDecision) => Promise<void>;
}

/** Stops a streaming reply, then saves the session being left. */
async function persistOutgoing(
  saveSessionSnapshot: SessionPersistence["saveSessionSnapshot"],
  currentAgent: FlueConversation | null,
  previousId: string,
  previousCreatedAt: string,
): Promise<void> {
  if (currentAgent?.context.isStreaming) {
    currentAgent.cancel();
    await currentAgent.whenIdle();
  }
  await saveSessionSnapshot(currentAgent, previousId, previousCreatedAt);
}

/**
 * Holds learner-submission delivery into the outgoing session while it is
 * saved and replaced, so a queued turn cannot start a reply in the
 * conversation being left (the save would cancel it). Queued turns stay with
 * their session and are delivered when it is next active.
 */
async function whileHoldingOutgoingDelivery<T>(
  currentAgent: FlueConversation | null,
  previousId: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = currentAgent ? pauseLearnerDelivery(previousId) : () => {};
  try {
    return await run();
  } finally {
    release();
  }
}

export function useSessionNavigation({
  refs,
  persistence,
  posthog,
  prepareAgent,
  createAgent,
  startTransition,
  forkInfo,
  responseComparison,
  setResponseComparison,
  setActiveSessionId,
  setForkInfo,
  setForkingSessionId,
  setForkedSessionId,
  clearForkedSessionId,
}: {
  refs: AgentHostRefs;
  persistence: SessionPersistence;
  posthog: Capture;
  prepareAgent: PrepareAgent;
  createAgent: CreateAgent;
  startTransition: TransitionStartFunction;
  forkInfo: ForkInfo | null;
  responseComparison: PendingResponseComparison | null;
  setResponseComparison: (comparison: PendingResponseComparison | null) => void;
  setActiveSessionId: (sessionId: string) => void;
  setForkInfo: (info: ForkInfo | null) => void;
  setForkingSessionId: (sessionId: string | null) => void;
  setForkedSessionId: (sessionId: string | null) => void;
  clearForkedSessionId: (sessionId: string) => void;
}): SessionNavigation {
  const { saveSessionSnapshot, endLearnerSession, sessionSnapshots } = persistence;

  const restorePendingResponseComparison = useCallback(
    async (source: SessionData, isCurrent: () => boolean) => {
      const metadata = (await sessions.getAllMetadata()) as SessionMetadata[];
      if (!isCurrent()) return;
      const pending = metadata
        .filter((entry) => entry.parentSessionId === source.id && entry.generatedAlternative && !entry.responsePreference)
        .sort((left, right) => right.lastModified.localeCompare(left.lastModified))[0];
      if (!pending) return;
      const alternative = await sessions.loadSession(pending.id) as SessionData | null;
      if (!isCurrent()) return;
      setResponseComparison(alternative ? buildPendingResponseComparison(source, alternative) : null);
    },
    [],
  );

  const newSession = useCallback(() => {
    const request = refs.sessionSwitchRequestsRef.current.begin();
    const panel = refs.panelRef.current;
    if (!panel) return;
    const currentAgent = refs.agentRef.current;
    const previousId = refs.sessionIdRef.current;
    const previousCreatedAt = refs.sessionCreatedAtRef.current;
    const id = createSessionId();
    const createdAt = new Date().toISOString();
    const initialState = { messages: [], model: refs.selectedModelRef.current } satisfies Partial<AgentState>;
    const isCurrent = () => refs.sessionSwitchRequestsRef.current.isCurrent(request) && refs.panelRef.current === panel;
    startTransition(async () => {
      await whileHoldingOutgoingDelivery(currentAgent, previousId, () => runSessionSwitch({
        isCurrent,
        prepare: () => prepareAgent(initialState),
        needsFinalSave: () => currentAgent ? sessionSnapshots.needsSave(currentAgent, currentAgent.context) : false,
        persist: () => persistOutgoing(saveSessionSnapshot, currentAgent, previousId, previousCreatedAt),
        commit: (prepared) => createAgent(panel, initialState, {
          prepared, isCurrent,
          onCommit: () => {
            if (currentAgent) endLearnerSession(previousId);
            refs.sessionIdRef.current = id;
            keatingStorage.setCurrentSessionId(id);
            refs.sessionCreatedAtRef.current = createdAt;
            refs.sessionParentIdRef.current = null;
            refs.sessionForkedAtRef.current = undefined;
            setActiveSessionId(id);
            setForkInfo(null);
            setResponseComparison(null);
            posthog.capture("session_started", { session_id: id, source: "new_button", is_initial: false });
          },
        }),
      }));
    });
  }, [createAgent, endLearnerSession, posthog, prepareAgent, saveSessionSnapshot]);

  const loadSession = useCallback(
    async (session: SessionData, request = refs.sessionSwitchRequestsRef.current.begin()) => {
      const panel = refs.panelRef.current;
      const isCurrent = () => refs.sessionSwitchRequestsRef.current.isCurrent(request) && refs.panelRef.current === panel;
      if (!panel || !isCurrent()) return;
      const currentAgent = refs.agentRef.current;
      const previousId = refs.sessionIdRef.current;
      const previousCreatedAt = refs.sessionCreatedAtRef.current;
      if (currentAgent && previousId === session.id) return;
      const initialState = { model: session.model, thinkingLevel: session.thinkingLevel, messages: session.messages };
      const committed = await whileHoldingOutgoingDelivery(currentAgent, previousId, () => runSessionSwitch({
        isCurrent,
        needsFinalSave: () => currentAgent ? sessionSnapshots.needsSave(currentAgent, currentAgent.context) : false,
        // Restoring history must not refresh credentials or replace its saved
        // model. The existing send callbacks still obtain/refresh provider keys.
        prepare: () => prepareAgent(initialState, true),
        persist: () => persistOutgoing(saveSessionSnapshot, currentAgent, previousId, previousCreatedAt),
        commit: (prepared) => createAgent(panel, initialState, {
          prepared, isCurrent, alreadySaved: true,
          onCommit: () => {
            if (currentAgent) endLearnerSession(previousId);
            refs.sessionIdRef.current = session.id;
            keatingStorage.setCurrentSessionId(session.id);
            refs.sessionCreatedAtRef.current = session.createdAt;
            refs.sessionParentIdRef.current = session.parentSessionId ?? null;
            refs.sessionForkedAtRef.current = session.forkedAt;
            setActiveSessionId(session.id);
            setResponseComparison(null);
            setForkInfo(initialForkInfo(session));
            posthog.capture("session_loaded", { session_id: session.id, is_restored: true, has_parent: !!session.parentSessionId });
          },
        }),
      }));
      if (!committed) return;
      // These details can arrive after the saved messages are already visible.
      if (session.parentSessionId && session.forkedAt) {
        const parentId = session.parentSessionId;
        const forkedAt = session.forkedAt;
        void sessions.getMetadata(parentId).then((parentMeta) => {
          if (isCurrent()) setForkInfo({ parentId, parentTitle: parentMeta?.title ?? "original session", forkedAt });
        }).catch((error) => console.warn("Could not load the parent session title:", error));
      }
      if (!session.generatedAlternative) {
        void restorePendingResponseComparison(session, isCurrent).catch((error) => console.warn("Could not restore the response comparison:", error));
      }
    },
    [createAgent, endLearnerSession, posthog, prepareAgent, restorePendingResponseComparison, saveSessionSnapshot],
  );

  const loadSessionById = useCallback(async (sessionId: string, request = refs.sessionSwitchRequestsRef.current.begin()) => {
    if (refs.agentRef.current && refs.sessionIdRef.current === sessionId) return;
    const session = await refs.sessionSwitchRequestsRef.current.read(request, () => sessions.loadSession(sessionId));
    if (session === undefined) return;
    if (!session) throw new Error("Session not found");
    await loadSession(session as SessionData, request);
  }, [loadSession]);

  const chooseResponse = useCallback(
    async (preference: ResponseComparisonDecision) => {
      const comparison = responseComparison;
      if (!comparison) return;
      const request = refs.sessionSwitchRequestsRef.current.begin();
      const alternative = (await sessions.loadSession(
        comparison.alternativeSessionId,
      )) as SessionData | null;
      if (!alternative) {
        setResponseComparison(null);
        return;
      }
      const now = new Date().toISOString();
      const existingMetadata = (await sessions.getMetadata(
        alternative.id,
      )) as SessionMetadata | null;
      const { data: nextAlternative, metadata: nextMetadata } = recordResponsePreference({
        alternative,
        existingMetadata,
        preference,
        originalMessageTimestamp: comparison.originalMessageTimestamp,
        now,
      });
      await sessions.save(nextAlternative, nextMetadata);
      setResponseComparison(null);
      window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
      posthog.capture("response_comparison_selected", {
        preference,
        session_id: comparison.sourceSessionId,
        alternative_session_id: comparison.alternativeSessionId,
      });
      if (preference === "alternative") await loadSession(nextAlternative, request);
    },
    [loadSession, posthog, responseComparison],
  );

  const openOriginalSession = useCallback(() => {
    const parentId = forkInfo?.parentId;
    if (!parentId) return;
    const request = refs.sessionSwitchRequestsRef.current.begin();
    startTransition(() => loadSessionById(parentId, request));
  }, [forkInfo, loadSessionById]);

  const forkSession = useCallback(
    async (sessionId: string, forkPoint?: number) => {
      const request = refs.sessionSwitchRequestsRef.current.begin();
      // Persist the live session first so forking the current session captures its
      // latest messages before we read the stored copy below.
      await saveSessionSnapshot();
      const source = (await sessions.loadSession(
        sessionId,
      )) as SessionData | null;
      if (!source) throw new Error("Session not found");

      const panel = refs.panelRef.current;
      const now = new Date().toISOString();
      const id = createSessionId();
      const allMetadata = (await sessions.getAllMetadata()) as SessionMetadata[];
      const { data, metadata } = buildForkSession(
        source,
        allMetadata,
        forkPoint,
        now,
        id,
      );

      setForkingSessionId(sessionId);
      setForkedSessionId(null);
      window.dispatchEvent(
        new CustomEvent("keating:session-fork-start", {
          detail: { sourceId: sessionId },
        }),
      );
      try {
        await sessions.save(data, metadata);
        window.dispatchEvent(
          new CustomEvent("keating:sessions-changed", {
            detail: { sessionId: id, parentSessionId: source.id },
          }),
        );
        posthog.capture("session_forked", {
          parent_session_id: source.id,
          new_session_id: id,
          forked_from_message_timestamp: forkPoint,
        });
        if (panel) await loadSession(data, request);
        setForkedSessionId(id);
        window.dispatchEvent(
          new CustomEvent("keating:session-fork-end", {
            detail: { sourceId: sessionId, sessionId: id },
          }),
        );
        window.setTimeout(() => clearForkedSessionId(id), 1800);
      } finally {
        setForkingSessionId(null);
      }
    },
    [loadSession, saveSessionSnapshot],
  );

  return { newSession, loadSession, loadSessionById, forkSession, openOriginalSession, chooseResponse };
}
