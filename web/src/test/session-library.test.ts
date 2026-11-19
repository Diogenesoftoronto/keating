import { describe, expect, it } from "bun:test";
import type { SessionMetadata } from "../types/session";
import { filterSessionLibrary } from "../components/session-library";
import {
  buildSessionTree,
  flattenSessionTree,
} from "../components/session-tree";

function session(
  id: string,
  title: string,
  parentSessionId?: string,
): SessionMetadata {
  return {
    id,
    title,
    parentSessionId,
    preview: "A saved conversation",
    messageCount: 4,
    createdAt: "2026-09-01T10:00:00.000Z",
    lastModified: "2026-09-01T10:00:00.000Z",
    thinkingLevel: "off",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

describe("session library navigation", () => {
  const items = [
    session("root", "Our study session"),
    session("math", "Linear algebra", "root"),
    session("proof", "A geometric proof", "math"),
    session("history", "The Roman empire", "root"),
    session("other", "French vocabulary"),
  ];
  const roots = buildSessionTree(items);

  it("keeps the unfiltered tree identities when no search is active", () => {
    const initial = filterSessionLibrary({ roots, queryResults: null });
    expect(initial.roots).toBe(roots);
    expect(initial.matches.size).toBe(items.length);
  });

  it("keeps the entire ancestry of a search match, without unrelated siblings", () => {
    const filtered = filterSessionLibrary({
      roots,
      queryResults: [items[2]!],
    });
    expect(
      flattenSessionTree(filtered.roots).map((node) => node.session.id),
    ).toEqual(["root", "math", "proof"]);
    expect([...filtered.matches]).toEqual(["proof"]);
    expect(flattenSessionTree(roots)).toHaveLength(5);
  });

  it("returns a real empty result without keeping unrelated ancestors", () => {
    expect(
      filterSessionLibrary({ roots, queryResults: [] }).roots,
    ).toEqual([]);
  });

});
