import type { Effect } from "./programs";

export type Tint = readonly [number, number, number];
type Four = [number, number, number, number];
export type Point = [number, number];
export interface Frame {
  scale: number;
  textured: boolean;
  now: number;
}
export interface Uniforms {
  a: Four;
  b: Four;
  pointer?: Point;
}
export interface SurfaceProps {
  effect: "ink" | "field";
  strength?: number;
  tint?: Tint;
  variant?: "surface" | "progress";
  className?: string;
}

export const caps: Record<Effect, number> = { paper: 2200, crt: 1300, power: 1300, ink: 900, field: 1200 };
export function renderSize(width: number, height: number, dpr: number, cap: number) {
  const scale = Math.min(dpr || 1, 2, cap / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

export function frameDelay(visible: boolean, dirty: boolean, fps: number, still: boolean, elapsed: number) {
  if (!visible) return Infinity;
  if (dirty) return 0;
  if (!fps || still) return Infinity;
  return Math.max(0, 1000 / fps - elapsed);
}

export function paperUniforms({ scale, textured }: Frame): Uniforms {
  return { a: [260 * scale, .05, .022, .02], b: [Number(textured), 0, 0, 0] };
}

export function surfaceUniforms(props: SurfaceProps, frame: Frame, dark: boolean, heat: number, pointer: Point): Uniforms {
  const loaded = Number(frame.textured);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  if (props.effect === "field") {
    const color = props.tint ?? (dark ? [.29, .89, .53] : [.08, .45, .24]);
    return { pointer, a: [3 * Math.max(1, Math.round(frame.scale)), heat, 300 * frame.scale, loaded],
      b: [color[0], color[1], color[2], clamp(props.strength ?? (dark ? .5 : .62))] };
  }
  const bar = props.variant === "progress";
  const strength = clamp(props.strength ?? (bar ? 1 : dark ? .3 : .26));
  return { a: bar ? [.11, .35, .09, strength] : [.34, .4, .06, strength], b: [loaded, ...(props.tint ?? [1, 1, 1] as const)] };
}
