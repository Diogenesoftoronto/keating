import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunnableCodeBlock } from "../components/RunnableCodeBlock";
import { SuggestedPrompts } from "../components/AssistantChatPanel";

describe("empty conversation", () => {
  test("offers six starter cards and one way to replace the set", () => {
    const html = renderToStaticMarkup(<SuggestedPrompts onSelect={() => {}} />);
    expect(html.match(/<small>/g)).toHaveLength(6);
    expect(html.match(/Other suggestions/g)).toHaveLength(1);
    expect(html).toContain("What do you want to understand?");
    expect(html).not.toContain("Scroll right");
  });

  test("the seated companion replaces the greeting sprite", () => {
    const render = (seated: boolean) => renderToStaticMarkup(<SuggestedPrompts seated={seated} onSelect={() => {}} />);
    expect(render(false)).toContain('data-state="greeting"');
    expect(render(true)).not.toContain('data-state="greeting"');
    expect(render(true)).toContain("Keating will begin from what you already know.");
  });

  test("code actions name their glyphs and retain the execution detail", () => {
    const html = renderToStaticMarkup(<RunnableCodeBlock language="python" code="print(1)"><pre>print(1)</pre></RunnableCodeBlock>);
    expect(html).toContain('aria-label="Edit code"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('role="status"');
    expect(html).toContain('k-outline');
    expect(html).toContain('>Run<');
  });

  test("a course supplies its own heading and starting points", () => {
    const html = renderToStaticMarkup(<SuggestedPrompts heading="Design a course" description="Choose a course goal."
      initialPrompts={[{ label: "Plan", domain: "history", text: "Plan a history lesson" }]} onSelect={() => {}} />);
    expect(html).toContain("Design a course");
    expect(html).toContain("Choose a course goal.");
    expect(html).toContain("Plan a history lesson");
    expect(html.match(/<small>/g)).toHaveLength(1);
  });
});
