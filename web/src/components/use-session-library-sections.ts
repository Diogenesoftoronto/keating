import { useCallback, useMemo, useRef, useState } from "react";
import type { UseSessionsResult } from "../hooks/use-sessions";
import { useSessionPlacement } from "../hooks/use-session-placement";
import { filterSessionLibrary } from "./session-library";
import {
  buildSessionSections,
  EARLIER_INITIAL_COUNT,
  EARLIER_PAGE_COUNT,
  pageEarlierSessions,
  type SessionSection,
} from "./session-placement";

/**
 * Shared Pinned / Recent / Earlier model for the desktop panel and the
 * mobile sheet. Search ignores sections and covers every session.
 */
export function useSessionLibrarySections(
  store: Pick<UseSessionsResult, "roots" | "flatResults" | "query" | "items" | "remove">,
  activeSessionId?: string,
) {
  const [placement, dispatch] = useSessionPlacement();
  const [earlierLimit, setEarlierLimit] = useState(EARLIER_INITIAL_COUNT);
  const searching = Boolean(store.query.trim());
  // "Now" only needs to move when the library or placement changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [store.items, placement]);
  const sections = useMemo(
    () => buildSessionSections(store.roots, placement, now, activeSessionId),
    [store.roots, placement, now, activeSessionId],
  );
  const earlierPage = useMemo(
    () =>
      pageEarlierSessions(sections.earlier, {
        open: placement.earlierOpen,
        limit: earlierLimit,
        activeSessionId,
      }),
    [sections.earlier, placement.earlierOpen, earlierLimit, activeSessionId],
  );
  const filtered = useMemo(
    () => filterSessionLibrary({ roots: store.roots, queryResults: store.flatResults }),
    [store.roots, store.flatResults],
  );
  const sectionOf = useMemo(() => {
    const map = new Map<string, SessionSection>();
    for (const key of ["pinned", "recent", "earlier"] as const) {
      for (const root of sections[key]) map.set(root.session.id, key);
    }
    return map;
  }, [sections]);

  // Row callbacks stay stable so memoised rows skip unrelated updates.
  const sectionOfRef = useRef(sectionOf);
  sectionOfRef.current = sectionOf;
  const removeRef = useRef(store.remove);
  removeRef.current = store.remove;
  const togglePin = useCallback(
    (id: string) => dispatch({ type: sectionOfRef.current.get(id) === "pinned" ? "unpin" : "pin", id }),
    [dispatch],
  );
  const moveSection = useCallback(
    (id: string) =>
      dispatch({ type: sectionOfRef.current.get(id) === "earlier" ? "moveToRecent" : "moveToEarlier", id }),
    [dispatch],
  );
  const remove = useCallback(
    async (id: string) => {
      await removeRef.current(id);
      dispatch({ type: "forget", id });
    },
    [dispatch],
  );
  const setEarlierOpen = useCallback(
    (open: boolean) => {
      if (!open) setEarlierLimit(EARLIER_INITIAL_COUNT);
      dispatch({ type: "setEarlierOpen", open });
    },
    [dispatch],
  );
  const showMoreEarlier = useCallback(() => setEarlierLimit((limit) => limit + EARLIER_PAGE_COUNT), []);

  return {
    searching,
    filtered,
    sections,
    earlierPage,
    earlierOpen: placement.earlierOpen,
    sectionOf,
    togglePin,
    moveSection,
    remove,
    setEarlierOpen,
    showMoreEarlier,
  };
}
