import { describe, expect, test } from "bun:test";
import { MARKDOWN_PARITY_FIXTURE } from "@keating/learner-contracts";
import { isMermaidCode, markdownTokenTypes, markdownTokensContainMath, parseMarkdownDocument, safeMarkdownUri } from "../src/lib/markdown-document";
import { codePresentationLabel, normalizeCodeLanguage, segmentMarkdownMath } from "../src/lib/local-rich-renderer";

describe("native markdown document boundary", () => {
  test("parses GFM tables, tasks, strike, links, images, and fenced diagrams", () => {
    const tokens = parseMarkdownDocument(`# Lesson\n\n- [x] Read\n- [ ] Test\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n~~old~~ [source](https://example.com/paper) ![plot](https://example.com/plot.png)\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\``);
    const types = markdownTokenTypes(tokens);
    expect(types).toContain("table");
    expect(types).toContain("del");
    expect(types).toContain("link");
    expect(types).toContain("image");
    expect(tokens.some(isMermaidCode)).toBe(true);
    const list = tokens.find((token) => token.type === "list");
    expect(list?.items.map((item) => [item.task, item.checked])).toEqual([[true, true], [true, false]]);
  });

  test("allows safe external resources and rejects active or credential-bearing URLs", () => {
    expect(safeMarkdownUri("https://example.com/paper?q=1", "link")?.hostname).toBe("example.com");
    expect(safeMarkdownUri("https://example.com/plot.png", "image")?.pathname).toBe("/plot.png");
    expect(safeMarkdownUri("javascript:alert(1)", "link")).toBeNull();
    expect(safeMarkdownUri("https://user:secret@example.com/file", "image")).toBeNull();
    expect(safeMarkdownUri("http://example.com/file", "image")).toBeNull();
  });

  test("parses the versioned cross-surface Markdown fixture", () => {
    const tokens = parseMarkdownDocument(MARKDOWN_PARITY_FIXTURE);
    const types = markdownTokenTypes(tokens);
    expect(types).toContain("heading");
    expect(types).toContain("table");
    expect(types).toContain("blockquote");
    expect(types).toContain("code");
    expect(tokens.some(isMermaidCode)).toBe(true);
    expect(markdownTokensContainMath(tokens)).toBe(true);
  });

  test("finds math nested beside formatted text and media", () => {
    const paragraph = parseMarkdownDocument("**Evidence** from [source](https://example.com) ![plot](https://example.com/a.png) updates $p(x|y)$")[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(markdownTokensContainMath(paragraph && "tokens" in paragraph && Array.isArray(paragraph.tokens) ? paragraph.tokens : [])).toBe(true);
  });

  test("segments inline, display, and malformed math without losing surrounding source", () => {
    expect(segmentMarkdownMath("Before $p(x|y)$ after")).toEqual([
      { kind: "text", value: "Before " },
      { kind: "inline-math", value: "p(x|y)", source: "$p(x|y)$" },
      { kind: "text", value: " after" },
    ]);
    expect(segmentMarkdownMath("$$\np(\\theta|x)\n$$")).toEqual([
      { kind: "display-math", value: "\np(\\theta|x)\n", source: "$$\np(\\theta|x)\n$$" },
    ]);
    expect(segmentMarkdownMath("Keep malformed $x + 1")).toEqual([
      { kind: "text", value: "Keep malformed " },
      { kind: "malformed-math", value: "x + 1", source: "$x + 1" },
    ]);
    expect(segmentMarkdownMath(String.raw`Price \$5 remains text`)).toEqual([{ kind: "text", value: String.raw`Price \$5 remains text` }]);
  });

  test("presents fenced code truthfully with a bounded language label", () => {
    expect(normalizeCodeLanguage(" typescript extra ")).toBe("typescript");
    expect(codePresentationLabel("typescript")).toBe("typescript code");
    expect(codePresentationLabel(undefined)).toBe("Code");
    expect(normalizeCodeLanguage("<script>alert(1)</script>")).toBe("scriptalert1script");
  });
});
