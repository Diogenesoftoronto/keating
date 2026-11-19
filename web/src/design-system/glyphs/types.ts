export interface GlyphNode {
  tag: "path" | "rect" | "g";
  attributes: { d?: string; x?: string; y?: string; width?: string; height?: string; transform?: string };
  part?: string;
  role: "stroke" | "accent" | "accentFill" | "fill";
  origin?: string;
  children?: GlyphNode[];
}

export type GlyphProperty = "x" | "y" | "rotate" | "scale" | "scaleX" | "scaleY" | "opacity" | "pathLength";
export type GlyphFrames = Partial<Record<GlyphProperty, number | number[]>>;
export interface GlyphOptions {
  duration?: number;
  delay?: number;
  ease?: "easeIn" | [number, number, number, number];
  at?: number;
  stagger?: number;
  start?: number;
}

export type GlyphStep = [parts: string, keyframes: GlyphFrames, options?: GlyphOptions];
export interface GlyphDefinition {
  nodes: GlyphNode[];
  note: string;
  play?: GlyphStep[];
  hold?: GlyphStep[];
  loop?: GlyphStep[];
  press?: GlyphStep[];
}
