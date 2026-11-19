import { useEffect } from "react";
import { getInitPromise, sessions } from "../../hooks/keating-storage";
import { latestRestorableSessionId, requestedSessionId, tabSessionId } from "../../hooks/agent/session-restore";

export const OPEN_MATERIALS_EVENT = "keating:open-materials";

/** Consume the URL once and keep listening for in-page navigation. */
export function listenForMaterials(target: Pick<Window, "location" | "history" | "addEventListener" | "removeEventListener">, open: () => void) {
  target.addEventListener(OPEN_MATERIALS_EVENT, open);
  const url = new URL(target.location.href);
  if (url.searchParams.get("materials") === "1") {
    open();
    url.searchParams.delete("materials");
    target.history.replaceState(target.history.state, "", url.href);
  }
  return () => target.removeEventListener(OPEN_MATERIALS_EVENT, open);
}

export function useOpenMaterials(sessionId: string | undefined, open: () => void) {
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const connect = async () => {
      // Chat briefly has a new id before it restores the requested, tab-local,
      // or most recent conversation. Consume the URL only in the destination.
      if (new URLSearchParams(location.search).get("materials") === "1") {
        const requested = requestedSessionId(location.search, tabSessionId);
        if (requested !== sessionId) {
          try {
            await getInitPromise();
            const rows = await sessions.getAllMetadata();
            const destination = requested
              ? rows.find(row => row.id === requested)?.id
              : latestRestorableSessionId(rows);
            if (destination && destination !== sessionId) return;
          } catch {
            // Chat starts a fresh session when its saved data cannot be read.
          }
        }
      }
      if (!cancelled) stop = listenForMaterials(window, open);
    };
    void connect();
    return () => { cancelled = true; stop?.(); };
  }, [sessionId, open]);
}
