// Render Keating's own drawings on the server, including when JavaScript is disabled.
import React from "react";
import { GLYPHS, type GlyphName } from "../../web/src/design-system/glyphs/data";
import type { GlyphNode } from "../../web/src/design-system/glyphs/types";

function part(node: GlyphNode, key: number): React.ReactNode {
  const Tag = node.tag;
  const filled = node.role === "fill" || node.role === "accentFill";
  return <Tag key={key} {...node.attributes} data-fill={filled || undefined}>
    {node.children?.map(part)}
  </Tag>;
}

export function BlogGlyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return <svg data-glyph={name} viewBox="0 0 24 24" width={size} height={size}
    stroke="currentColor" fill="none" strokeWidth="1.9" aria-hidden="true">
    {GLYPHS[name].nodes.map(part)}
  </svg>;
}
