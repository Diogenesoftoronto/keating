import { useCallback, useEffect, useState } from "react";
import {
  readSessionPlacement,
  reduceSessionPlacement,
  SESSION_PLACEMENT_STORAGE_KEY,
  writeSessionPlacement,
  type SessionPlacementAction,
  type SessionPlacementState,
} from "../components/session-placement";

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Device-local Pinned / Earlier state for the session library. */
export function useSessionPlacement(): [SessionPlacementState, (action: SessionPlacementAction) => void] {
  const [state, setState] = useState(() => readSessionPlacement(browserStorage()));
  const dispatch = useCallback((action: SessionPlacementAction) => {
    setState((current) => {
      const next = reduceSessionPlacement(current, action, Date.now());
      if (next !== current) writeSessionPlacement(browserStorage(), next);
      return next;
    });
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_PLACEMENT_STORAGE_KEY) setState(readSessionPlacement(browserStorage()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [state, dispatch];
}
