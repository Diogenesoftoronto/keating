import { Fragment, useLayoutEffect, useRef } from "react";
import { useMotionAllowed } from "../motion";
import { GLYPHS, type GlyphName } from "./data";
import { bindGlyph } from "./runtime";
import type { GlyphNode } from "./types";
import "./glyphs.css";

export interface KeatingGlyphProps {
  name: GlyphName;
  size?: number;
  label?: string;
  active?: boolean;
  strokeWidth?: number;
  className?: string;
}

function renderNode(node: GlyphNode, index: number) {
  const Tag = node.tag;
  return <Tag key={index} {...node.attributes} data-p={node.part} data-role={node.role}
    style={node.origin ? { transformOrigin: node.origin } : undefined}>
    {node.children?.map(renderNode)}
  </Tag>;
}

export function KeatingGlyph({ name, label, size = 15, strokeWidth, active = false, className }: KeatingGlyphProps) {
  const element = useRef<SVGSVGElement>(null);
  const binding = useRef<ReturnType<typeof bindGlyph> | null>(null);
  const allowed = useMotionAllowed();
  useLayoutEffect(() => {
    binding.current = bindGlyph(element.current!);
    return () => {
      binding.current?.dispose();
      binding.current = null;
    };
  }, []);
  useLayoutEffect(() => { binding.current?.update(name, allowed, active); }, [name, allowed, active]);
  return <svg ref={element} className={className} data-glyph={name} data-lit={active ? "" : undefined}
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeLinecap="butt" strokeLinejoin="miter" overflow="visible"
    strokeWidth={strokeWidth ?? (size <= 13 ? 2.1 : size <= 16 ? 1.9 : size < 32 ? 1.8 : 1.7)}
    role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <Fragment key={`${name}-${allowed}`}>{GLYPHS[name].nodes.map(renderNode)}</Fragment>
  </svg>;
}
