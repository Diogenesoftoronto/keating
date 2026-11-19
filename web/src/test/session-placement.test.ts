import { describe, expect, it } from "bun:test";
import type { SessionMetadata } from "../types/session";
import { buildSessionTree } from "../components/session-tree";
import {
  buildSessionSections,
  EARLIER_AFTER_MS,
  emptySessionPlacement,
  pageEarlierSessions,
  readSessionPlacement,
  reduceSessionPlacement,
  SESSION_PLACEMENT_STORAGE_KEY,
  writeSessionPlacement,
  type SessionPlacementAction,
  type SessionPlacementState,
} from "../components/session-placement";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function session(id: string, lastModified: string, parentSessionId?: string): SessionMetadata {
  return {
    id,
    title: id,
    parentSessionId,
    preview: "",
    messageCount: 2,
    createdAt: lastModified,
    lastModified,
    thinkingLevel: "off",
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SESSION_PLACEMENT_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const apply = (state: SessionPlacementState, ...actions: SessionPlacementAction[]) =>
  actions.reduce((current, action) => reduceSessionPlacement(current, action, NOW), state);

const ids = (roots: { session: { id: string } }[]) => roots.map((root) => root.session.id);

describe("session placement", () => {
  it("pins and unpins a family", () => {
    const roots = buildSessionTree([session("a", ago(DAY)), session("b", ago(2 * DAY))]);
    const pinned = apply(emptySessionPlacement(), { type: "pin", id: "b" });
    expect(ids(buildSessionSections(roots, pinned, NOW).pinned)).toEqual(["b"]);
    expect(ids(buildSessionSections(roots, pinned, NOW).recent)).toEqual(["a"]);
    const unpinned = apply(pinned, { type: "unpin", id: "b" });
    expect(buildSessionSections(roots, unpinned, NOW).pinned).toEqual([]);
  });

  it("keeps a pinned session out of Earlier however old it is", () => {
    const roots = buildSessionTree([session("old", ago(90 * DAY))]);
    const state = apply(emptySessionPlacement(), { type: "pin", id: "old" });
    expect(ids(buildSessionSections(roots, state, NOW).pinned)).toEqual(["old"]);
  });

  it("moves a session to Earlier by hand and back to Recent", () => {
    const roots = buildSessionTree([session("a", ago(DAY))]);
    const moved = apply(emptySessionPlacement(), { type: "moveToEarlier", id: "a" });
    expect(ids(buildSessionSections(roots, moved, NOW).earlier)).toEqual(["a"]);
    const back = apply(moved, { type: "moveToRecent", id: "a" });
    expect(ids(buildSessionSections(roots, back, NOW).recent)).toEqual(["a"]);
  });

  it("moves a family to Earlier after 14 days without activity", () => {
    const roots = buildSessionTree([
      session("fresh", ago(EARLIER_AFTER_MS - 60_000)),
      session("stale", ago(EARLIER_AFTER_MS)),
    ]);
    const sections = buildSessionSections(roots, emptySessionPlacement(), NOW);
    expect(ids(sections.recent)).toEqual(["fresh"]);
    expect(ids(sections.earlier)).toEqual(["stale"]);
  });

  it("lets a session kept in Recent ignore the 14-day rule", () => {
    const roots = buildSessionTree([session("stale", ago(30 * DAY))]);
    const state = apply(emptySessionPlacement(), { type: "moveToRecent", id: "stale" });
    expect(ids(buildSessionSections(roots, state, NOW).recent)).toEqual(["stale"]);
  });

  it("returns a session moved to Earlier when it is used again", () => {
    const moved = apply(emptySessionPlacement(), { type: "moveToEarlier", id: "a" });
    const before = buildSessionTree([session("a", ago(DAY))]);
    expect(ids(buildSessionSections(before, moved, NOW).earlier)).toEqual(["a"]);
    const used = buildSessionTree([session("a", new Date(NOW + 1000).toISOString())]);
    expect(ids(buildSessionSections(used, moved, NOW + 2000).recent)).toEqual(["a"]);
  });

  it("never moves the open session to Earlier on its own", () => {
    const roots = buildSessionTree([session("root", ago(40 * DAY)), session("fork", ago(40 * DAY), "root")]);
    const state = emptySessionPlacement();
    expect(ids(buildSessionSections(roots, state, NOW).earlier)).toEqual(["root"]);
    expect(ids(buildSessionSections(roots, state, NOW, "fork").recent)).toEqual(["root"]);
  });

  it("places a fork family by its root and its latest activity", () => {
    const roots = buildSessionTree([
      session("root", ago(60 * DAY)),
      session("fork", ago(DAY), "root"),
      session("deep", ago(50 * DAY), "fork"),
    ]);
    const auto = buildSessionSections(roots, emptySessionPlacement(), NOW);
    expect(ids(auto.recent)).toEqual(["root"]);
    expect(auto.earlier).toEqual([]);
    const pinned = buildSessionSections(roots, apply(emptySessionPlacement(), { type: "pin", id: "root" }), NOW);
    expect(ids(pinned.pinned)).toEqual(["root"]);
    expect(pinned.pinned[0]!.children[0]!.children[0]!.session.id).toBe("deep");
  });

  it("tolerates missing, corrupt and foreign storage", () => {
    expect(readSessionPlacement(undefined)).toEqual(emptySessionPlacement());
    expect(readSessionPlacement(memoryStorage())).toEqual(emptySessionPlacement());
    expect(readSessionPlacement(memoryStorage("{not json"))).toEqual(emptySessionPlacement());
    expect(readSessionPlacement(memoryStorage(JSON.stringify({ version: 9, pinned: { a: ago(0) } })))).toEqual(
      emptySessionPlacement(),
    );
    const partial = readSessionPlacement(
      memoryStorage(JSON.stringify({ version: 1, pinned: { a: ago(0), b: 4, c: "nope" }, earlier: [], earlierOpen: "yes" })),
    );
    expect(partial).toEqual({ ...emptySessionPlacement(), pinned: { a: ago(0) } });
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };
    expect(readSessionPlacement(throwing)).toEqual(emptySessionPlacement());
    expect(() => writeSessionPlacement(throwing, emptySessionPlacement())).not.toThrow();
  });

  it("round-trips through storage under one versioned key", () => {
    const storage = memoryStorage();
    const state = apply(
      emptySessionPlacement(),
      { type: "pin", id: "a" },
      { type: "moveToEarlier", id: "b" },
      { type: "setEarlierOpen", open: true },
    );
    writeSessionPlacement(storage, state);
    expect([...storage.values.keys()]).toEqual([SESSION_PLACEMENT_STORAGE_KEY]);
    expect(readSessionPlacement(storage)).toEqual(state);
  });

  it("drops every entry for a deleted session", () => {
    const state = apply(
      emptySessionPlacement(),
      { type: "pin", id: "a" },
      { type: "moveToEarlier", id: "b" },
      { type: "moveToRecent", id: "c" },
    );
    const cleaned = apply(state, { type: "forget", id: "a" }, { type: "forget", id: "b" }, { type: "forget", id: "c" });
    expect(cleaned).toEqual(emptySessionPlacement());
  });
});

describe("Earlier paging", () => {
  const earlier = buildSessionTree(
    Array.from({ length: 40 }, (_, index) => session(`s${String(index).padStart(2, "0")}`, ago((20 + index) * DAY))),
  );

  it("shows nothing when closed, except the open session", () => {
    expect(pageEarlierSessions(earlier, { open: false, limit: 10 }).roots).toEqual([]);
    expect(ids(pageEarlierSessions(earlier, { open: false, limit: 10, activeSessionId: "s33" }).roots)).toEqual(["s33"]);
  });

  it("shows 10, then pages by 25 up to the rest", () => {
    const first = pageEarlierSessions(earlier, { open: true, limit: 10 });
    expect(first.roots).toHaveLength(10);
    expect(first.nextCount).toBe(25);
    const second = pageEarlierSessions(earlier, { open: true, limit: 35 });
    expect(second.nextCount).toBe(5);
    expect(pageEarlierSessions(earlier, { open: true, limit: 60 }).nextCount).toBe(0);
  });

  it("keeps the open session visible beyond the first page", () => {
    const page = pageEarlierSessions(earlier, { open: true, limit: 10, activeSessionId: "s39" });
    expect(ids(page.roots).at(-1)).toBe("s39");
    expect(page.remaining).toBe(29);
  });
});
