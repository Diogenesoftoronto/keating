import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionBrowserDesktop } from "../components/SessionBrowserDesktop";
import { SessionBrowserSheet } from "../components/SessionBrowserSheet";
import { countSessionSubjects, sessionsInSubject } from "../components/SessionLibraryTools";
import { buildSessionTree } from "../components/session-tree";
import type { SessionMetadata } from "../types/session";

const noop = () => {};
const done = async () => {};
function session(id: string, title: string, parentSessionId?: string): SessionMetadata {
  return {
    id, title, parentSessionId, messageCount: 1, preview: "Saved lesson", thinkingLevel: "off",
    createdAt: "2026-09-03", lastModified: "2026-09-03",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}
const items = [session("a", "Python"), session("b", "Algebra", "a"), session("c", "Math")];
const store = { items, roots: buildSessionTree(items), flatResults: null, heroes: new Map(),
  loading: false, error: null, query: "", setQuery: noop, reload: done, rename: done, remove: done };

test("subject counts include forks and search and subject filters intersect", () => {
  expect(countSessionSubjects(items).map(entry => [entry.subject.key, entry.count])).toEqual([["cs", 1], ["math", 2]]);
  expect(sessionsInSubject(store, "math")).toEqual(items.slice(1));
  expect(sessionsInSubject({ ...store, flatResults: items.slice(0, 2) }, "math")).toEqual([items[1]!]);
  expect(sessionsInSubject({ ...store, flatResults: [] }, "math")).toEqual([]);
});

for (const Surface of [SessionBrowserDesktop, SessionBrowserSheet]) {
  test(`${Surface.name} renders shared search, counted subject controls and empty state`, () => {
    const props = { onFork: done, onLoad: done, store };
    const html = renderToStaticMarkup(<Surface {...props} />);
    expect(html).toContain('aria-label="Filter sessions by subject"');
    expect(html).toContain('placeholder="Find a session"');
    expect(html).toMatch(/aria-pressed="true">All<b>3<\/b>/);
    expect(html).toMatch(/CS<b>1<\/b>/);
    expect(html).toMatch(/Math<b>2<\/b>/);
    if (Surface === SessionBrowserDesktop) expect(html).toContain('aria-keyshortcuts="/"');
    const empty = renderToStaticMarkup(<Surface {...props} store={{ ...store, query: "nowhere", flatResults: [] }} />);
    expect(empty).toContain("No sessions found");
    expect(empty).toContain("Clear filters");
  });
}
