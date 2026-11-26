import { expect, test } from "bun:test";
import type { Context } from "@earendil-works/pi-ai";
import { MAX_SEARCH_SOURCE_CHARS, projectWebSearchEvidence } from "../keating/judgement/search-evidence";

type ToolMessage = Extract<Context["messages"][number], { role: "toolResult" }>;
const search = (id: string, sites: { url: string; title: string; snippet: string }[]): ToolMessage => ({
  role: "toolResult", toolCallId: id, toolName: "web_search", isError: false, timestamp: 1,
  content: [{ type: "text", text: JSON.stringify({ results: sites }) }],
});
const filler = (index: number) => ({ url: `https://example.org/result-${index}`, title: `Result ${index}`, snippet: `Unrelated detail ${index}. `.repeat(40) });
const reply = (text: string) => ({ text, toolCalls: [] });

// The shape of the rejected Riemann draft: 41 results across searches. The newest result for the
// cited page is background; the sentence the draft relies on came from an earlier search.
const claim = "The Lean and Mathlib communities verified the proof on November 25, 2026.";
const messages: ToolMessage[] = [
  search("a", [{ url: "https://leanprover-community.github.io/blog/posts/riemann-hypothesis", title: "Lean blog", snippet: claim }]),
  search("b", Array.from({ length: 30 }, (_, index) => filler(index))),
  search("c", [...Array.from({ length: 10 }, (_, index) => filler(30 + index)),
    { url: "https://leanprover-community.github.io/blog/posts/riemann-hypothesis", title: "Lean blog",
      snippet: "A proof of the Riemann hypothesis has been formalized. " + "Background on zeta functions. ".repeat(20) }]),
];
const draft = reply(`${claim} ([Lean/Mathlib statement](https://leanprover-community.github.io/blog/posts/riemann-hypothesis/))`);

test("a trailing slash, fragment or tracking parameter still selects the cited page", () => {
  const evidence = projectWebSearchEvidence(messages, []);
  expect(evidence.sources).toHaveLength(41);
  for (const cited of ["https://leanprover-community.github.io/blog/posts/riemann-hypothesis/",
    "https://www.leanprover-community.github.io/blog/posts/riemann-hypothesis#proof",
    "https://leanprover-community.github.io/blog/posts/riemann-hypothesis?utm_source=chatgpt"]) {
    const compact = evidence.compactSources([reply(`See ${cited}`)]);
    expect(compact[0]?.url).toBe("https://leanprover-community.github.io/blog/posts/riemann-hypothesis");
  }
});

test("the cited page keeps the passage that supports the draft's claim, from any of its results", () => {
  const compact = projectWebSearchEvidence(messages, []).compactSources([draft]);
  const cited = compact.find(source => source.url.includes("riemann-hypothesis"));
  expect(cited?.text).toContain("verified the proof on November 25, 2026");
});

test("a larger budget keeps more evidence, and the smallest set stays within its bound", () => {
  const evidence = projectWebSearchEvidence(messages, []);
  const size = (maxChars?: number) => JSON.stringify(evidence.compactSources([draft], maxChars)).length;
  expect(size()).toBeLessThanOrEqual(MAX_SEARCH_SOURCE_CHARS);
  expect(evidence.compactSources([draft], MAX_SEARCH_SOURCE_CHARS * 4).length).toBeGreaterThan(evidence.compactSources([draft]).length);
  expect(size(MAX_SEARCH_SOURCE_CHARS * 4)).toBeLessThanOrEqual(MAX_SEARCH_SOURCE_CHARS * 4);
  expect(size(MAX_SEARCH_SOURCE_CHARS * 4)).toBeGreaterThan(size());
});
