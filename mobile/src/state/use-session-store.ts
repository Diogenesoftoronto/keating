/** Owner of the persisted app state (sessions, artifacts, settings) and its synchronous mirror. */
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useMemo, useRef, useState } from "react";
import type { ChatSession, PersistedAppState } from "@/lib/types";
import { activeSessionOf, initialState, replaceSession } from "@/state/session-state";

export interface SessionStore {
  state: PersistedAppState;
  setState: Dispatch<SetStateAction<PersistedAppState>>;
  /**
   * Always the newest committed state. React state catches up on the next
   * render, which is too late for a caller that opens a lesson and sends its
   * first message in the same tick.
   */
  stateRef: MutableRefObject<PersistedAppState>;
  /** Publishes `next` to the ref and to React in one step. */
  commitState(next: PersistedAppState): void;
  activeSession: ChatSession;
  updateSession(sessionId: string, update: (session: ChatSession) => ChatSession): PersistedAppState;
}

export function useSessionStore(): SessionStore {
  const [state, setState] = useState<PersistedAppState>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const commitState = useCallback((next: PersistedAppState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const activeSession = useMemo(
    () => activeSessionOf(state),
    [state.activeSessionId, state.sessions],
  );

  const updateSession = useCallback((sessionId: string, update: (session: ChatSession) => ChatSession) => {
    const next = replaceSession(stateRef.current, sessionId, update);
    commitState(next);
    return next;
  }, [commitState]);

  return { state, setState, stateRef, commitState, activeSession, updateSession };
}
