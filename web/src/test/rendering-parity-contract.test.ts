import { describe, expect, test } from "bun:test";
import mermaid from "mermaid";
import {
  MARKDOWN_PARITY_FIXTURE,
  MERMAID_PARITY_FIXTURES,
  WEB_MARKDOWN_FEATURES,
} from "../../../packages/learner-contracts/src/index";
import { readFileSync } from "node:fs";

describe("web rendering parity contract", () => {
  test("the complete shared Mermaid corpus is recognized by the reference renderer", () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    for (const fixture of MERMAID_PARITY_FIXTURES) {
      expect(mermaid.detectType(fixture.source), fixture.id).not.toBe("error");
    }
  });

  test("the Markdown fixture exercises the declared reference dialect", () => {
    expect(WEB_MARKDOWN_FEATURES.length).toBeGreaterThanOrEqual(20);
    for (const marker of ["# Rendering parity", "**strong**", "*emphasis*", "~~removed text~~", "[x]", "| Construct", "$$", "```typescript", "```mermaid"]) {
      expect(MARKDOWN_PARITY_FIXTURE).toContain(marker);
    }
  });

  test("actual chat uses the same complete Markdown renderer as the smoke route", () => {
    const chatSource = readFileSync(new URL("../components/AssistantChatPanel.tsx", import.meta.url), "utf8");
    const smokeSource = readFileSync(new URL("../pages/RenderingSmoke.tsx", import.meta.url), "utf8");
    expect(chatSource).toContain('import { MarkdownBlock } from "./MarkdownBlock"');
    expect(chatSource).toContain("<MarkdownBlock");
    expect(smokeSource).toContain("<MarkdownBlock");
  });
});
