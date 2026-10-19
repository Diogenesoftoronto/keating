/**
 * Durable session history for the browser teacher.
 *
 * Owns the per-session save queue (writes to one session stay ordered), the
 * snapshot stamps that skip unchanged saves, the ordered learner bookkeeping
 * chain (feedback, topic shift, auto title, session end) that runs after a
 * save without delaying navigation, and the "persist now" hook used when the
 * page is hidden. `persistCurrentSnapshotRef` is installed by the live agent's
 * observer (see agent-observers.ts) and cleared on its disposal.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { FlueConversation } from "../../keating/flue/conversation";
import { keatingLifecycle } from "../../keating/lifecycle";
import { detectTopicCategoryShift } from "../../keating/topic-shift-hook";
import { getProviderApiKey } from "../../lib/provider-models";
import type { SessionData } from "../../types/session";
import { keatingStorage, sessions, updateSessionTitle } from "../keating-storage";
import { SessionSaveQueue, SessionSnapshotTracker } from "../session-switch";
import { messagesForSessionSnapshot } from "../session-recovery";
import { loadBrowserModel } from "./browser-model";
import type { AgentHostRefs } from "./host-refs";
import {
  buildSessionSnapshotRecord,
  shouldRequestAutoTitle,
  type SessionAncestry,
} from "./session-snapshot";
import { requestSessionTitle } from "./session-title";

export type SaveSessionSnapshot = (
  agent?: FlueConversation | null,
  sessionId?: string,
  createdAt?: string,
) => Promise<void>;

export interface SessionPersistence {
  saveSessionSnapshot: SaveSessionSnapshot;
  /** Records the end of a session after any pending bookkeeping. */
  endLearnerSession: (sessionId: string) => void;
  sessionSnapshots: SessionSnapshotTracker;
  /** Settles once earlier feedback and session-end records are written. */
  learnerBookkeepingRef: MutableRefObject<Promise<void>>;
  /** Saves the live agent now; a no-op until an agent is observed. */
  persistCurrentSnapshotRef: MutableRefObject<() => Promise<void>>;
}

/** Ancestry is only authoritative for the session that is live in this hook. */
export function liveSessionAncestry(
  refs: Pick<AgentHostRefs, "sessionIdRef" | "sessionParentIdRef" | "sessionForkedAtRef">,
  sessionId: string,
): SessionAncestry | undefined {
  return sessionId === refs.sessionIdRef.current
    ? { parentSessionId: refs.sessionParentIdRef.current, forkedAt: refs.sessionForkedAtRef.current }
    : undefined;
}

export function useSessionPersistence(refs: AgentHostRefs): SessionPersistence {
  const sessionSaveQueueRef = useRef(new SessionSaveQueue());
  const sessionSnapshotsRef = useRef(new SessionSnapshotTracker());
  const learnerBookkeepingRef = useRef(Promise.resolve());
  const persistCurrentSnapshotRef = useRef<() => Promise<void>>(async () => {});
  const autoTitleRequestedRef = useRef<Set<string>>(new Set());

  const saveSessionSnapshot = useCallback<SaveSessionSnapshot>(
    async (
      agent = refs.agentRef.current,
      sessionId = refs.sessionIdRef.current,
      createdAt = refs.sessionCreatedAtRef.current,
    ) => {
      if (!agent || agent.context.messages.length === 0) return;
      const ancestry = liveSessionAncestry(refs, sessionId);
      return sessionSaveQueueRef.current.run(sessionId, async () => {
        const stamp = sessionSnapshotsRef.current.capture(agent, agent.context);
        if (sessionSnapshotsRef.current.isSaved(agent, stamp)) return;
        const model = agent.context.model;
        const thinkingLevel = agent.context.thinkingLevel;
        const now = new Date().toISOString();
        const snapshot = messagesForSessionSnapshot(
          agent.context.messages,
          agent.context.streamingMessage,
        );
        const messages = snapshot.messages;
        const existing = (await sessions.loadSession(
          sessionId,
        )) as SessionData | null;
        const record = buildSessionSnapshotRecord({
          sessionId,
          createdAt,
          now,
          model,
          thinkingLevel,
          messages,
          existing,
          ancestry,
        });

        await sessions.save(record.data, record.metadata);
        sessionSnapshotsRef.current.remember(agent, stamp);
        window.dispatchEvent(new CustomEvent("keating:sessions-changed"));

        // Live snapshots exist only so a suspended or killed tab can recover the
        // visible response. Derive learner signals and titles from settled turns.
        if (snapshot.interrupted) return;

        const bookkeeping = async () => {
          await keatingStorage.recordLearnerTurnFeedback(
            messages as Array<{ role?: unknown; content?: unknown }>,
          );

          void detectTopicCategoryShift(
            model as Model<Api>,
            sessionId,
            messages as Array<{ role?: unknown; content?: unknown }>,
          ).catch((error) => {
            console.warn("Topic-shift detection failed:", error);
          });

          if (shouldRequestAutoTitle({
            hasManualTitle: record.hasManualTitle,
            aiGeneratedTitle: record.aiGeneratedTitle,
            messages,
            alreadyRequested: autoTitleRequestedRef.current.has(sessionId),
          })) {
            autoTitleRequestedRef.current.add(sessionId);
            void (async () => {
              try {
                if (model.provider === "browser") {
                  await loadBrowserModel(model.id);
                } else if (!(await getProviderApiKey(model.provider))) {
                  return;
                }
                const apiKey =
                  model.provider === "browser"
                    ? undefined
                    : await getProviderApiKey(model.provider);
                const nextTitle = await requestSessionTitle(model, apiKey, messages, record.title);
                if (nextTitle) await updateSessionTitle(sessionId, nextTitle, true);
              } catch (error) {
                console.warn("Failed to auto-generate session title:", error);
              }
            })();
          }
        };
        // History is durable now. Derived learner signals and title work must not
        // delay navigation, and remain ordered to avoid duplicate feedback writes.
        learnerBookkeepingRef.current = learnerBookkeepingRef.current.catch(() => {}).then(bookkeeping);
        void learnerBookkeepingRef.current.catch((error) => console.warn("Session learner bookkeeping failed:", error));
      });
    },
    [],
  );

  const endLearnerSession = useCallback((sessionId: string) => {
    learnerBookkeepingRef.current = learnerBookkeepingRef.current.catch(() => {}).then(async () => {
      try {
        await keatingStorage.recordSessionEnd([], sessionId);
      } catch (error) {
        console.warn("Failed to record session end:", error);
      }
      await keatingLifecycle.emit({ type: "session_end", sessionId });
    });
    void learnerBookkeepingRef.current.catch((error) => console.warn("Session end hook failed:", error));
  }, []);

  useEffect(() => {
    const persistIfBackgrounded = () => {
      if (document.visibilityState === "hidden") {
        void persistCurrentSnapshotRef.current();
      }
    };
    const persistBeforePageHide = () => {
      void persistCurrentSnapshotRef.current();
    };
    document.addEventListener("visibilitychange", persistIfBackgrounded);
    window.addEventListener("pagehide", persistBeforePageHide);
    return () => {
      document.removeEventListener("visibilitychange", persistIfBackgrounded);
      window.removeEventListener("pagehide", persistBeforePageHide);
    };
  }, []);

  return {
    saveSessionSnapshot,
    endLearnerSession,
    sessionSnapshots: sessionSnapshotsRef.current,
    learnerBookkeepingRef,
    persistCurrentSnapshotRef,
  };
}
