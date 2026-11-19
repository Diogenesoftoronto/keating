import { useEffect, useRef, useState } from "react";
import type { CourseComment, CourseViewerSnapshot } from "./contracts";

type ReadStorage = Pick<Storage, "getItem" | "setItem">;

// Seed each channel from the first snapshot. Later channels start empty.
// Separate keys keep a read in one browser tab from overwriting another channel.
export function discussionUnread(
  store: ReadStorage,
  courseId: string,
  viewerId: string,
  comments: readonly CourseComment[],
  viewedChannel?: string,
) {
  const prefix = "keating.discussion.read." + JSON.stringify([viewerId, courseId]) + ".";
  const latest = new Map<string, number>();
  for (const comment of comments) {
    const channel = comment.lessonId ?? "__course__";
    latest.set(channel, Math.max(latest.get(channel) ?? 0, Date.parse(comment.createdAt)));
  }
  if (store.getItem(prefix + "initialized") === null) {
    for (const [channel, time] of latest) {
      const key = prefix + JSON.stringify(channel);
      store.setItem(key, String(Math.max(time, Number(store.getItem(key)))));
    }
    store.setItem(prefix + "initialized", "1");
  }
  const cursors = new Map<string, number>();
  for (const [channel, time] of latest) {
    const key = prefix + JSON.stringify(channel);
    let cursor = Number(store.getItem(key)) || 0;
    if ((viewedChannel === channel || viewedChannel === "__all__") && time > cursor) {
      cursor = time;
      store.setItem(key, String(cursor));
    }
    cursors.set(channel, cursor);
  }
  const unread: Record<string, number> = {};
  for (const comment of comments) {
    const channel = comment.lessonId ?? "__course__";
    if (comment.accountId !== viewerId && Date.parse(comment.createdAt) > cursors.get(channel)!) {
      const bucket = comment.lessonId ?? "course";
      unread[bucket] = (unread[bucket] ?? 0) + 1;
    }
  }
  return unread;
}

export function useDiscussionUnread(snapshot: CourseViewerSnapshot | null, viewedChannel?: string) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const fallback = useRef(new Map<string, string>());
  useEffect(() => {
    if (!snapshot) return;
    const { course, viewer } = snapshot;
    function refresh() {
      const channel = document.visibilityState === "visible" ? viewedChannel : undefined;
      const args = [course.id, viewer.accountId, course.comments, channel] as const;
      try {
        setCounts(discussionUnread(window.localStorage, ...args));
      } catch {
        setCounts(discussionUnread({
          getItem: key => fallback.current.get(key) ?? null,
          setItem: (key, value) => { fallback.current.set(key, value); },
        }, ...args));
      }
    }
    refresh();
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [snapshot, viewedChannel]);
  return counts;
}
