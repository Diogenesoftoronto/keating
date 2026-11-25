import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { RotateCcw, Undo2 } from "lucide-react";

/* Shared hooks and chrome for the three PhysicsLab modes. */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const snap = (v: number, step: number) => Math.round(v / step) * step;
export const fmt = (v: number, d = 2) => (Object.is(Math.round(v * 10 ** d) / 10 ** d, -0) ? 0 : v).toFixed(d).replace("-", "−");
/** Scientific notation with a real superscript: 4.3×10⁴. */
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return fmt(v, Math.max(0, digits - 1 - Math.max(0, e)));
  const m = v / 10 ** e, sup = String(e).replace("-", "⁻").replace(/\d/g, d => "⁰¹²³⁴⁵⁶⁷⁸⁹"[+d]);
  return `${m.toFixed(digits - 1)}×10${sup}`.replace("-", "−");
}

export function useWidth(ref: React.RefObject<HTMLElement | null>, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { const nw = Math.round(el.getBoundingClientRect().width); if (nw > 0) setW(nw); });
    ro.observe(el);
    const nw = Math.round(el.getBoundingClientRect().width); if (nw > 0) setW(nw);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(q.matches);
    const on = () => setR(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return r;
}

/** Committed state + undo stack + a live preview while a gesture runs. Cancelled gestures discard the preview. */
export function useEditable<S>(initial: S, onChange?: () => void) {
  const [state, setState] = useState(initial);
  const [past, setPast] = useState<S[]>([]);
  const [live, setLive] = useState<S | null>(null);
  const [moves, setMoves] = useState(0);
  const [unchanged, setUnchanged] = useState(false);
  const commit = useCallback((next: S) => {
    setLive(null);
    setMoves(m => m + 1);
    if (JSON.stringify(next) === JSON.stringify(state)) { setUnchanged(true); return; }
    setUnchanged(false);
    setPast(p => [...p.slice(-40), state]); setState(next); onChange?.();
  }, [state, onChange]);
  const undo = useCallback(() => { setPast(p => { if (!p.length) return p; setState(p[p.length - 1]); return p.slice(0, -1); }); setLive(null); setUnchanged(false); onChange?.(); }, [onChange]);
  const reset = useCallback(() => { setPast([]); setState(initial); setLive(null); setMoves(0); setUnchanged(false); onChange?.(); }, [initial, onChange]);
  return { state, live, view: live ?? state, setLive, commit, undo, reset, canUndo: past.length > 0, moves, unchanged };
}
export type Editable<S> = ReturnType<typeof useEditable<S>>;

export type Pt = { x: number; y: number };
/** Pointer drag on an SVG element. Moves are coalesced to one preview per animation frame (the heavy physics
    recompute runs at most once per frame). Interrupted gestures (pointercancel, lost capture) keep the committed state. */
export function useDrag<S>(svg: React.RefObject<SVGSVGElement | null>, ed: { setLive: (s: S | null) => void; commit: (s: S) => void }, setDragging: (on: string | null) => void) {
  const g = useRef<{ id: number; move: (p: Pt, start: Pt) => S; last: S | null; start: Pt; name: string; pending: Pt | null; raf: number } | null>(null);
  const edRef = useRef(ed); edRef.current = ed;
  const toSvg = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current; if (!el) return { x: 0, y: 0 };
    const m = el.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const flush = () => {
    const cur = g.current; if (!cur || !cur.pending) return;
    cur.raf = 0;
    const next = cur.move(cur.pending, cur.start); cur.pending = null; cur.last = next; edRef.current.setLive(next);
  };
  const end = (commitIt: boolean) => {
    const cur = g.current;
    if (cur?.raf) cancelAnimationFrame(cur.raf);
    if (cur && commitIt) flush();
    g.current = null; setDragging(null);
    if (!cur) return;
    if (commitIt && cur.last) edRef.current.commit(cur.last); else edRef.current.setLive(null);
  };
  useEffect(() => () => { if (g.current?.raf) cancelAnimationFrame(g.current.raf); }, []);
  return (name: string, move: (p: Pt, start: Pt) => S) => ({
    "data-handle": name,
    onPointerDown: (e: RPointerEvent<SVGElement>) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      (e.currentTarget as SVGElement & { focus?: () => void }).focus?.();
      g.current = { id: e.pointerId, move, last: null, start: toSvg(e), name, pending: null, raf: 0 }; setDragging(name);
    },
    onPointerMove: (e: RPointerEvent<SVGElement>) => {
      const cur = g.current; if (!cur || cur.id !== e.pointerId) return;
      cur.pending = toSvg(e);
      if (!cur.raf) cur.raf = requestAnimationFrame(flush);
    },
    onPointerUp: (e: RPointerEvent<SVGElement>) => { if (g.current?.id === e.pointerId) end(true); },
    onPointerCancel: (e: RPointerEvent<SVGElement>) => { if (g.current?.id === e.pointerId) end(false); },
    onLostPointerCapture: (e: RPointerEvent<SVGElement>) => { if (g.current?.id === e.pointerId) end(false); },
  });
}

export function keyStep(e: KeyboardEvent, o: { left?: () => void; right?: () => void; up?: () => void; down?: () => void; plus?: () => void; minus?: () => void; flip?: () => void; home?: () => void; end?: () => void }) {
  const k = e.key;
  const run = (f?: () => void) => { if (!f) return false; f(); return true; };
  const done =
    k === "ArrowLeft" ? run(o.left) : k === "ArrowRight" ? run(o.right) : k === "ArrowUp" ? run(o.up) : k === "ArrowDown" ? run(o.down)
    : k === "+" || k === "=" ? run(o.plus) : k === "-" || k === "_" ? run(o.minus) : k === "s" || k === "S" ? run(o.flip)
    : k === "Home" ? run(o.home) : k === "End" ? run(o.end) : false;
  if (done) e.preventDefault();
}

export function Shell({ title, goal, children, dragging, mode, note }: { title: string; goal?: string; children: ReactNode; dragging?: string | null; mode: string; note?: string }) {
  const uid = useId();
  return <section className={`activity physics${dragging ? " is-dragging" : ""}`} data-simulation="physics-lab" data-mode={mode} aria-labelledby={`${uid}-t`}>
    <header className="pl-header">
      <h3 className="pl-title" id={`${uid}-t`}>{title}</h3>
      {note && <p className="pl-note">{note}</p>}
    </header>
    {goal && <p className="pl-goal">{goal}</p>}
    {children}
  </section>;
}

export function Actions({ moves, canUndo, undo, reset, share, children }: { moves: number; canUndo: boolean; undo: () => void; reset: () => void; share?: () => void; children?: ReactNode }) {
  return <div className="pl-actions">
    {children}
    <span className="pl-spacer" />
    <button type="button" className="pl-quiet" onClick={undo} disabled={!canUndo}><Undo2 size={14} aria-hidden="true" />Undo</button>
    <button type="button" className="pl-quiet" onClick={reset} disabled={moves === 0}><RotateCcw size={14} aria-hidden="true" />Start over</button>
    {moves > 0 && share && <button type="button" className="pl-share" onClick={share}>Share with Keating</button>}
  </div>;
}

export function Disclosure({ label, children, initial = false }: { label: string; children: ReactNode; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return <div className="pl-disclosure">
    <button type="button" className="pl-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}><span className="pl-chev" aria-hidden="true">›</span>{label}</button>
    {open && <div className="pl-disclosed">{children}</div>}
  </div>;
}

/** The discovery row: what the learner has found so far, as plain text marks (no pills, no boxes). */
export function Found({ items, found }: { items: { id: string; label: string }[]; found: Set<string> }) {
  if (!items.length) return null;
  return <p className="pl-found" aria-label="What you have found">
    <span className="pl-found-count">{found.size} of {items.length} found</span>
    {items.map(it => <span key={it.id} className={found.has(it.id) ? "pl-found-item is-found" : "pl-found-item"} data-finding={it.id}>
      <span aria-hidden="true">{found.has(it.id) ? "●" : "○"}</span> {it.label}
    </span>)}
  </p>;
}

/** Test hook for the Playwright judge (window.keatingPhysics). Registered after mount only, so SSR is untouched. */
export type LabApi = { snapshot: () => unknown; point: (x: number, y: number, view?: string) => Pt; handles: () => Record<string, Pt> };
export function useTestApi(make: () => LabApi) {
  const ref = useRef(make); ref.current = make;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { keatingPhysics?: LabApi };
    const api: LabApi = { snapshot: () => ref.current().snapshot(), point: (x, y, v) => ref.current().point(x, y, v), handles: () => ref.current().handles() };
    w.keatingPhysics = api;
    return () => { if (w.keatingPhysics === api) delete w.keatingPhysics; };
  }, []);
}
/** Centres of every [data-handle] element inside a root, in client coordinates. */
export function handleCentres(root: Element | null): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  root?.querySelectorAll("[data-handle]").forEach(el => {
    const r = (el.querySelector(".pl-hit") ?? el).getBoundingClientRect();
    out[el.getAttribute("data-handle")!] = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  return out;
}
export function svgToClient(svg: SVGSVGElement | null, x: number, y: number): Pt {
  const m = svg?.getScreenCTM(); if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}

/** Read a resolved theme colour (CSS variable on the lab) as [r, g, b] 0..255, after mount. */
export function readColour(el: Element, varName: string, fallback: [number, number, number]): [number, number, number] {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${varName})`; probe.style.display = "none";
    el.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove();
    const nums = c.match(/[\d.]+/g)?.map(Number);
    if (!nums || nums.length < 3) return fallback;
    return c.startsWith("color(") ? [nums[0] * 255, nums[1] * 255, nums[2] * 255] : [nums[0], nums[1], nums[2]];
  } catch { return fallback; }
}
export function useScheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    // Keating port: the app theme is the `dark` class on <html> (theme-sync), not the OS scheme.
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const on = () => setDark(root.classList.contains("dark"));
    on();
    const observer = new MutationObserver(on);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
