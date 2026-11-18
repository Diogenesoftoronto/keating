import React from "react";

/** The two fixed replies contain paragraphs and simple emphasis. React escapes all receipt text. */
export function MarkdownBlock({ content }: { content: string }) {
  return <>{content.trim().split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}>
    {paragraph.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/).map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={j}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("*") && part.endsWith("*")) return <em key={j}>{part.slice(1, -1)}</em>;
      return part;
    })}
  </p>)}</>;
}
