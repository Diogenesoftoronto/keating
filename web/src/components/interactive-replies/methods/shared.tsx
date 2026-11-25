import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ShareSummary } from "./config";

/** Container width, read after mount only (SSR-safe: the first render uses `initial`). */
export function useWidth(initial = 680) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const read = () => { const w = Math.round(el.getBoundingClientRect().width); if (w > 0) setWidth(p => (Math.abs(p - w) >= 1 ? w : p)); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: Math.max(260, width) };
}

export type DragSession<P> = { payload: P; x: number; y: number; x0: number; y0: number; moved: boolean };

/** Pointer-driven drags on one SVG. Preview state lives only in `drag`; nothing is committed until
    pointerup. pointercancel / lost capture discard the gesture and keep the last committed state. */
export function useSvgDrag<P>(onDrop: (s: DragSession<P>) => void) {
  const svgRef = useRef<SVGSVGElement>(null);
  const live = useRef<DragSession<P> | null>(null);
  const [drag, setDrag] = useState<DragSession<P> | null>(null);
  const dropRef = useRef(onDrop); dropRef.current = onDrop;
  const local = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const sx = vb && vb.width ? vb.width / r.width : 1, sy = vb && vb.height ? vb.height / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };
  const begin = useCallback((e: React.PointerEvent, payload: P) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault(); e.stopPropagation();
    const p = local(e);
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
    live.current = { payload, x: p.x, y: p.y, x0: p.x, y0: p.y, moved: false };
    setDrag(live.current);
  }, []);
  const cancel = useCallback(() => { if (live.current) { live.current = null; setDrag(null); } }, []);
  const handlers = {
    onPointerMove: (e: React.PointerEvent) => {
      const s = live.current; if (!s) return;
      const p = local(e);
      const moved = s.moved || Math.hypot(p.x - s.x0, p.y - s.y0) > 4;
      live.current = { ...s, x: p.x, y: p.y, moved }; setDrag(live.current);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = live.current; if (!s) return;
      const p = local(e);
      live.current = null; setDrag(null);
      try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      dropRef.current({ ...s, x: p.x, y: p.y, moved: s.moved || Math.hypot(p.x - s.x0, p.y - s.y0) > 4 });
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);
  return { svgRef, drag, begin, handlers, cancel };
}

/** Committed-state history with undo. */
export function useHistory<S>(initial: () => S) {
  const [state, setState] = useState<S>(initial);
  const [past, setPast] = useState<S[]>([]);
  const commit = (next: S) => { setPast(p => [...p, state]); setState(next); };
  const undo = () => { if (!past.length) return; setState(past[past.length - 1]); setPast(p => p.slice(0, -1)); };
  const reset = () => { setState(initial()); setPast([]); };
  return { state, commit, undo, reset, canUndo: past.length > 0, moves: past.length, prev: past.length ? past[past.length - 1] : undefined };
}

export type Tone = "neutral" | "good" | "warn";

/** One card: header, one canvas well, a feedback line, extra rows, the button panel, actions. */
export function Shell(props: {
  mode: string; title: string; count?: string; canvasRef: React.Ref<HTMLDivElement>; dragging: boolean; dragLine?: string;
  canvas: ReactNode; below?: ReactNode; instruction: ReactNode; tone: Tone; controls: ReactNode; status: string;
  share?: ShareSummary; onShare?: (s: ShareSummary) => void; canUndo: boolean; onUndo: () => void; acted: boolean; onReset: () => void;
  extraActions?: ReactNode; caption?: ReactNode;
}) {
  const [shared, setShared] = useState<string | null>(null);
  const shareKey = props.share ? props.share.data : null;
  return <section className={`activity methods-lab is-${props.mode}`} data-simulation="methods-lab" data-mode={props.mode} aria-label={props.title}>
    <div className="ml-header">
      <h3>{props.title}</h3>
      {props.count && <span className="ml-count">{props.count}</span>}
    </div>
    <div className={`ml-canvas${props.dragging ? " is-dragging" : ""}`} ref={props.canvasRef}>
      {props.canvas}
      <p className="ml-dragline" aria-hidden="true">{props.dragLine}</p>
    </div>
    {props.caption && <div className="ml-caption">{props.caption}</div>}
    {props.below}
    <p className={`ml-instruction is-${props.tone}`} aria-live="polite">{props.instruction}</p>
    <details className="receipt ml-controls">
      <summary>Use buttons instead</summary>
      <div className="ml-control-rows">{props.controls}</div>
    </details>
    <span className="ml-sr-only" role="status">{props.status}</span>
    <div className="actions ml-actions">
      {props.extraActions}
      {props.share && <button type="button" className="primary" disabled={shared === shareKey}
        onClick={() => { setShared(shareKey); props.onShare?.(props.share!); }}>{shared === shareKey ? "Shared" : "Share with Keating"}</button>}
      {props.canUndo && <button type="button" className="quiet" onClick={props.onUndo}>Undo</button>}
      {props.acted && <button type="button" className="quiet" onClick={props.onReset}>Start over</button>}
    </div>
  </section>;
}

export const pct = (x: number, dp = 0) => `${(x * 100).toFixed(dp)}%`;
export const pctSmart = (x: number) => ((x < 0.1 && x > 0) || (x > 0.99 && x < 1) ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
export const listWords = (xs: string[], and = "and") => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`;
export const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const fmt = (x: number, dp = 2) => (Number.isFinite(x) ? x.toFixed(dp) : "∞");
/** Rough text width for layout (system UI fonts), used before anything is measured. */
export const textWidth = (s: string, size = 12.5) => s.length * size * 0.56;
