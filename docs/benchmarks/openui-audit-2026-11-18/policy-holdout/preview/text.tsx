import React from "react";

/** These two fixed replies use paragraphs and simple emphasis only. React escapes the source. */
export function MarkdownBlock({ content }: { content: string }) {
  return <>{content.trim().split(/\n\s*\n/).filter(Boolean).map((paragraph, index) =>
    <p key={index}>{paragraph.split(/(\*[^*\n]+\*)/).map((part, i) => part.startsWith("*") && part.endsWith("*")
      ? <em key={i}>{part.slice(1, -1)}</em> : part)}</p>)}</>;
}
