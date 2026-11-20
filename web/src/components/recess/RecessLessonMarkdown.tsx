import { memo } from "react";
import type { Element, Root } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeLatexDelimiters } from "../MarkdownBlock";

function wrapWords() {
  return (root: Root) => {
    function wrap(container: Root | Element) {
      for (let index = 0; index < container.children.length; index++) {
        const child = container.children[index];
        if (child.type === "element" && child.tagName !== "pre" && child.tagName !== "code") {
          wrap(child);
        }
        if (child.type !== "text" || !/\S/.test(child.value)) continue;
        const parts = child.value.split(/(\s+)/).filter(Boolean).map((value): Element | typeof child => {
          const text = { type: "text" as const, value };
          return /\S/.test(value)
            ? { type: "element", tagName: "span", properties: { className: ["w"] }, children: [text] }
            : text;
        });
        container.children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
    }
    wrap(root);
  };
}

const components: Components = {
  a: ({ children }) => <span className="recess-lesson-link">{children}</span>,
  img: ({ alt }) => alt ? <span className="recess-lesson-image">{alt}</span> : null,
  pre: ({ children }) => <pre className="recess-code">{children}</pre>,
};

export const RecessLessonMarkdown = memo(function RecessLessonMarkdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[wrapWords, rehypeKatex]} components={components}>
    {normalizeLatexDelimiters(text)}
  </ReactMarkdown>;
});
