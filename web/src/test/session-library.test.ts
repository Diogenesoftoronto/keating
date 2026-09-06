import { describe, expect, it } from "bun:test";
import type { SessionMetadata } from "../types/session";
import {
  filterSessionLibrary,
  sessionCategories,
} from "../components/session-library";
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

  it("keeps the unfiltered tree identities when secondary artifact metadata changes", () => {
    const initial = filterSessionLibrary({ roots, heroes: new Map(), queryResults: null });
    const enriched = filterSessionLibrary({ roots, heroes: new Map([["proof", { type: "map", topic: "Geometry" }]]), queryResults: null });
    expect(initial.roots).toBe(roots);
    expect(enriched.roots).toBe(initial.roots);
    expect(enriched.matches.size).toBe(items.length);
  });

  it("keeps the entire ancestry of a search match, without unrelated siblings", () => {
    const filtered = filterSessionLibrary({
      roots,
      heroes: new Map(),
      queryResults: [items[2]!],
    });
    expect(
      flattenSessionTree(filtered.roots).map((node) => node.session.id),
    ).toEqual(["root", "math", "proof"]);
    expect([...filtered.matches]).toEqual(["proof"]);
    expect(flattenSessionTree(roots)).toHaveLength(5);
  });

  it("combines category, full-text matches and actual artifact types", () => {
    const filtered = filterSessionLibrary({
      roots,
      heroes: new Map([["proof", { type: "map", topic: "Geometry" }]]),
      queryResults: [items[1]!, items[2]!],
      category: "math",
      activity: "map",
    });
    expect([...filtered.matches]).toEqual(["proof"]);
    expect(
      flattenSessionTree(filtered.roots).map((node) => node.session.id),
    ).toEqual(["root", "math", "proof"]);
  });

  it("retains parents as context when browsing forks", () => {
    const filtered = filterSessionLibrary({
      roots,
      heroes: new Map(),
      queryResults: null,
      activity: "forks",
    });
    expect(filtered.matches.has("root")).toBe(false);
    expect(filtered.roots.map((node) => node.session.id)).toEqual(["root"]);
    expect(filtered.matches.size).toBe(3);
  });

  it("finds every saved artifact type even when a different preview wins", () => {
    const filtered = filterSessionLibrary({
      roots,
      heroes: new Map([
        [
          "proof",
          { type: "map", types: ["map", "animation"], topic: "Geometry" },
        ],
      ]),
      queryResults: null,
      activity: "animation",
    });
    expect([...filtered.matches]).toEqual(["proof"]);
  });

  it("returns a real empty result without keeping unrelated ancestors", () => {
    expect(
      filterSessionLibrary({
        roots,
        heroes: new Map(),
        queryResults: [],
        category: "math",
      }).roots,
    ).toEqual([]);
  });

  it("counts sessions, including forks, in inferred category navigation", () => {
    const categories = sessionCategories(items);
    expect(categories.find((category) => category.key === "math")?.count).toBe(
      2,
    );
    expect(
      categories.reduce((total, category) => total + category.count, 0),
    ).toBe(items.length);
  });
});
