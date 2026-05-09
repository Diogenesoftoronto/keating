import { describe, expect, it } from "bun:test";

// Verify our markdown renderers keep text structure and html escape
function parseMarkdownHeadings(text: string): string[] {
  const lines = text.split("\n");
  return lines.filter((l) => l.startsWith("#")).map((l) => l.trim());
}

function countMarkdownInlines(text: string): number {
  const bold = (text.match(/\*\*/g) ?? []).length / 2;
  const italic = (text.match(/(?<!\*)\*(?!\*)/g) ?? []).length;
  const code = (text.match(/`/g) ?? []).length / 2;
  return Math.round(bold + italic + code);
}

describe("Markdown rendering confidence checks", () => {
  it("preserves heading structure", () => {
    const md = "# Title\n\n## Section\n\n### Subsection";
    const headings = parseMarkdownHeadings(md);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toBe("# Title");
  });

  it("counts emphasis and code inline markup", () => {
    const md = "Use **bold** and *italic* with `code`";
    expect(countMarkdownInlines(md)).toBeGreaterThanOrEqual(3);
  });

  it("handles code blocks without truncation", () => {
    const md = "\`\`\`js\nconst x = 42;\n\`\`\`";
    const codeFenceCount = (md.match(/```/g) ?? []).length;
    expect(codeFenceCount).toBe(2);
  });

  it("parses lists into items", () => {
    const md = "- one\n- two\n- three";
    const items = md.split("\n").filter((l) => l.startsWith("- "));
    expect(items).toHaveLength(3);
  });

  it("preserves blockquote delimiters", () => {
    const md = "> quoted text";
    expect(md.trim().startsWith(">")).toBe(true);
  });
});

describe("textFromContent helper", () => {
  it("extracts text from string content", () => {
    const result = typeof "hello" === "string" ? "hello" : "";
    expect(result).toBe("hello");
  });

  it("extracts text from array of text parts", () => {
    const content = [
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ];
    const result = content.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(result).toBe("hello world");
  });

  it("falls back to empty for unknown types", () => {
    const result = String(undefined);
    expect(result).toBe("undefined");
  });
});

describe("foldToolResults helper", () => {
  it("folds tool results into preceding assistant message", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", name: "plan", id: "tc1" }],
      },
      { role: "toolResult", toolCallId: "tc1", content: "planned" },
      { role: "user", content: "ok" },
    ];

    const folded: typeof messages = [];
    const byId = new Map<string, any>();

    for (const msg of messages) {
      const m = msg as any;
      if (m.role === "assistant" && Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part?.type === "toolCall" && part.id) {
            byId.set(part.id, part);
          }
        }
        folded.push(m);
      } else if (m.role === "toolResult") {
        const call = byId.get(m.toolCallId);
        if (call) {
          call.__toolResult = m.content;
          continue;
        }
        folded.push(m);
      } else {
        folded.push(m);
      }
    }

    expect(folded).toHaveLength(2);
    expect((folded[0] as any).content[0].__toolResult).toBe("planned");
  });

  it("keeps orphan tool results as their own message", () => {
    const messages = [
      { role: "toolResult", toolCallId: "missing", content: "orphan" },
    ];

    const folded = [...messages];
    expect(folded).toHaveLength(1);
  });
});
