import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecessLessonMarkdown } from "../components/recess/RecessLessonMarkdown";

test("Recess renders formatted chat while leaving visible prose available to the flight engine", () => {
  const text = [
    "## Recursion", "", "**Call stack** with *frames* and `countdown(n)`.", "",
    "1. Enter a frame", "2. Return", "", "> The last frame returns first.", "",
    "```python", "    print(n)", "```", "", "\\(x^2\\)", "",
    "| Term | Meaning |", "| --- | --- |", "| Base case | Stops recursion |",
  ].join("\n");
  const html = renderToStaticMarkup(<RecessLessonMarkdown text={text} />);

  expect(html).toContain('<h2><span class="w">Recursion</span></h2>');
  expect(html).toContain('<strong><span class="w">Call</span> <span class="w">stack</span></strong>');
  expect(html).toContain('<em><span class="w">frames</span></em>');
  expect(html).toContain('<code>countdown(n)</code>');
  expect(html).toContain('<pre class="recess-code"><code class="language-python">    print(n)');
  expect(html).toContain('<span class="katex">');
  for (const tag of ["<ol>", "<blockquote>", "<table>"]) expect(html).toContain(tag);
});

test("links and image descriptions stay passive in the Recess flight scene", () => {
  const html = renderToStaticMarkup(<RecessLessonMarkdown text={[
    "[Reading](https://example.com/article) ![Diagram](https://example.com/image.png)",
    "", '<iframe src="https://example.com/embedded"></iframe>',
  ].join("\n")} />);

  expect(html).toContain('<span class="recess-lesson-link"><span class="w">Reading</span></span>');
  expect(html).toContain('<span class="recess-lesson-image">Diagram</span>');
  expect(html).not.toMatch(/<(?:a|img|iframe)\b|https?:\/\//);
});
