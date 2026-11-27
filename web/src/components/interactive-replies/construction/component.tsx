import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DraggableRenderer, Vec2, inOrder, param, translate, type Draggable, type DragSpec } from "dragology";
import { Check, RotateCcw, Undo2 } from "lucide-react";
import {
  LEG, MAX_R, MIN_R, addLine, nameVisible, allPoints, arcId, circleCircle, context, covers, deg, dist, layoutFor, mergeArc, normalize, read, resolve, same, startModel, sub, v,
  type CompassConstructionConfig, type Layout, type Mark, type Model, type Pt, type Reading, type Resolved, type V,
} from "./engine";
import "./component.css";
import { useCancelGesture } from "../hooks";

export type { CompassConstructionConfig } from "./engine";
export type ShareSummary = { learner: string; data: string; reply: string };
/** @deprecated use ShareSummary */
export type CompassSummary = ShareSummary;

/* ---------- Catalogue ---------- */
export const presets: Record<string, CompassConstructionConfig> = {
  equilateralTriangle: { construction: "equilateralTriangle" },
  perpendicularBisector: { construction: "perpendicularBisector", length: 8 },
  angleBisector: { construction: "angleBisector", angle: 64 },
  copySegment: { construction: "copySegment", length: 5 },
  copyAngle: { construction: "copyAngle", angle: 50, hints: "light" },
  hexagon: { construction: "hexagon", points: ["O", "A"], length: 4 },
};
export const scenario = {
  tab: "Construction",
  prompt: "Help me practice building an equilateral triangle with a compass.",
  intro: "Let’s build one. The trick is that a compass carries a length for you: set it to AB once, and every arc you draw is that far from its centre.",
  receiptLabel: "Construction exercise",
  receiptText: "The learner asked to practise a construction. The canvas checks each step from the geometry actually drawn, so a wrong opening still draws and its effect is explained.",
  preset: "equilateralTriangle",
};
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  equilateralTriangle: { label: "Equilateral", prompt: scenario.prompt, intro: scenario.intro },
  perpendicularBisector: { label: "Bisect a segment", prompt: "How do I find the exact middle of a line with just a compass?",
    intro: "Open the compass past halfway and draw arcs from both ends, above and below. The two crossings are each equally far from both ends, so the line through them cuts AB in half, at a right angle too.",
    receiptText: "The learner asked how to bisect a segment without measuring. The canvas finds the midpoint from the arcs drawn; unequal openings or arcs that don’t meet still draw and are explained." },
  angleBisector: { label: "Bisect an angle", prompt: "How do you split an angle exactly in half without a protractor?",
    intro: "One arc from the vertex marks two points the same distance along each arm. Equal arcs from those two points cross on the line that splits the angle.",
    receiptText: "The learner asked how to bisect an angle. The canvas measures the two angles the learner’s ray makes." },
  copySegment: { label: "Copy a length", prompt: "In geometry, how do I copy a segment to somewhere else without a ruler?",
    intro: "Set the compass on AB, then carry it to C without changing the opening. The arc marks every point that far from C; where it cuts the line is your copy.",
    receiptText: "The learner asked how to transfer a length. The canvas compares the copy with AB." },
  copyAngle: { label: "Copy an angle", prompt: "How do I copy an angle with a compass and straightedge?",
    intro: "You copy two lengths: the arc’s radius, then the chord between the arms. If both match, the angle has to match. The steps are listed; the hints are lighter this time.",
    receiptText: "The learner asked how to copy an angle. Hints are light; the canvas compares the copied angle with the original." },
  hexagon: { label: "Hexagon", prompt: "Why does a compass step around a circle exactly six times?",
    intro: "Try it. Set the compass to the radius, start at A and step round, drawing an arc at each new point. Then join the points and look at the sides.",
    receiptText: "The learner asked why the radius steps round a circle six times. The canvas counts the points and measures the sides; a wrong opening shows how far the sixth step misses." },
};

export function validateCompassConstruction(config: unknown): string[] {
  const r = resolve(config);
  return r.ok ? [] : r.errors;
}

/* ---------- Canvas geometry ---------- */
type Geo = { W: number; H: number; s: number; ox: number; oy: number; compact: boolean; world: [number, number, number, number] };
function geometry(width: number, L: Layout, compact: boolean): Geo {
  const W = Math.max(240, Math.round(width));
  const m = 0.2, [x0, y0, x1, y1] = L.bounds;
  const bw = x1 - x0 + 2 * m, bh = y1 - y0 + 2 * m;
  const s = Math.min(W / bw, (compact ? 290 : 330) / bh);
  const cw = bw * s, ch = bh * s;
  const H = Math.round(Math.max(ch, compact ? Math.min(300, W * 0.95) : 0));
  const ox = (W - cw) * 0.3 - (x0 - m) * s;
  const oy = (H - ch) - (y0 - m) * s;
  return { W, H, s, ox, oy, compact, world: [-ox / s, -oy / s, (W - ox) / s, (H - oy) / s] };
}
const px = (g: Geo, p: V) => Vec2(g.ox + p.x * g.s, g.oy + p.y * g.s);
const toWorld = (g: Geo, p: Vec2): V => v((p.x - g.ox) / g.s, (p.y - g.oy) / g.s);
const handFor = (d: number): 1 | -1 => (Math.cos(d * Math.PI / 180) >= 0 ? 1 : -1);
const vdir = (d: number) => Vec2(Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180));

/* The compass rests in the top-right corner when it isn't on a point. */
function parkPose(m: Model, g: Geo) {
  const r = m.r * g.s, leg = LEG * g.s;
  const h = Math.sqrt(Math.max(16, leg * leg - r * r / 4));
  const upright = Vec2(g.W - 14 - r, 12 + h + 24);
  if (upright.x > g.W * 0.55 && upright.y < g.H - 12) return { N: upright, angle: 0, hand: 1 as const };
  return { N: Vec2(g.W - 16, Math.max(14, Math.min(g.H - r - 12, 14))), angle: 90, hand: -1 as const };
}
function needlePose(m: Model, g: Geo, pos: Map<string, V>) {
  if (m.needle === "park") return parkPose(m, g);
  const N = m.needle === "free" ? px(g, v(m.fx, m.fy)) : px(g, pos.get(m.needle) ?? v(0, 0));
  /* Keep the handle on the canvas: if it would leave, the hinge swings to the other side.
     Never while twisting, so the handle stays under the pointer. */
  let hand = m.hand;
  if (m.sweepFrom === null && m.needle !== "free") {
    const inside = (h: 1 | -1) => { const k = N.add(compassPose(m.r * g.s, m.angle, h, g).knob); return k.x > 10 && k.x < g.W - 10 && k.y > 10 && k.y < g.H - 10; };
    if (!inside(hand) && inside(hand === 1 ? -1 : 1)) hand = hand === 1 ? -1 : 1;
  }
  return { N, angle: m.angle, hand };
}
function compassPose(r: number, angle: number, hand: 1 | -1, g: Geo) {
  const u = vdir(angle);
  const pencil = u.mul(r);
  const leg = LEG * g.s;
  const h = Math.sqrt(Math.max(16, leg * leg - r * r / 4));
  const n = Vec2(u.y, -u.x).mul(hand);
  const hinge = pencil.mul(0.5).add(n.mul(h));
  return { pencil, hinge, knob: hinge.add(n.mul(g.compact ? 20 : 22)), n };
}
function arcPath(c: Vec2, r: number, lo: number, hi: number) {
  if (hi - lo >= 359.5) {
    const a = c.add(Vec2(r, 0)), b = c.add(Vec2(-r, 0));
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${b.x} ${b.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`;
  }
  const p = c.add(vdir(lo).mul(r)), q = c.add(vdir(hi).mul(r));
  return `M ${p.x} ${p.y} A ${r} ${r} 0 ${hi - lo > 180 ? 1 : 0} 1 ${q.x} ${q.y}`;
}

/* ---------- Model transitions (shared by drags and buttons) ---------- */
/* Moving the needle from one point to another keeps the pencil pointing at where its tip just was,
   so the next arc starts near the last one. From the rest position the pencil points right. */
function placeNeedle(m: Model, at: string, pos: Map<string, V>): Model {
  if (m.needle === at) return m;
  const prev = pos.get(m.needle);
  const here = pos.get(at)!;
  let angle = 0;
  if (prev) {
    const tip = v(prev.x + Math.cos(m.angle * Math.PI / 180) * m.r, prev.y + Math.sin(m.angle * Math.PI / 180) * m.r);
    if (dist(tip, here) > 0.05) angle = deg(sub(tip, here));
  }
  return { ...m, needle: at, angle, hand: handFor(angle) };
}
function commitSweep(m: Model): Model {
  if (m.sweepFrom === null || m.needle === "free" || m.needle === "park") return { ...m, sweepFrom: null };
  if (Math.abs(m.angle - m.sweepFrom) < 3) return { ...m, sweepFrom: null };
  const lo = Math.min(m.sweepFrom, m.angle), hi = Math.max(m.sweepFrom, m.angle);
  return { ...m, arcs: mergeArc(m.arcs, { id: arcId(m.needle, m.r), center: m.needle, r: m.r, lo, hi }), sweepFrom: null };
}
function liveArcs(m: Model) {
  if (m.sweepFrom === null || m.needle === "free" || m.needle === "park") return m.arcs;
  return mergeArc(m.arcs, { id: arcId(m.needle, m.r), center: m.needle, r: m.r, lo: Math.min(m.sweepFrom, m.angle), hi: Math.max(m.sweepFrom, m.angle) });
}
function commitDraft(m: Model): Model {
  if (!m.draftFrom || !m.draftTo) return { ...m, draftFrom: null, draftTo: null };
  return { ...addLine(m, m.draftFrom, m.draftTo), draftFrom: null, draftTo: null };
}

/* SSR-safe first-render canvas width; the real width is measured before the first paint. */
const FIRST_WIDTH = 440;

/** Dragology listens for pointerup only, so an interrupted gesture (pointercancel, window blur) would leave
    the drag live and the next pointerup would apply the hovered edit. Remount the renderer instead: the
    preview is discarded and the last committed state stays. */

/* ---------- Component ---------- */
export function CompassConstruction({ config = presets.equilateralTriangle, onChange, onShare }: {
  config?: CompassConstructionConfig; onChange?: () => void; onShare?: (summary: ShareSummary) => void;
}) {
  const checked = useMemo(() => resolve(config), [config]);
  if (!checked.ok) return <section className="activity compass" data-simulation="compass-construction">
    <p className="cx-fallback"><strong>This construction couldn’t start.</strong> {checked.errors[0]}</p>
  </section>;
  return <Construction c={checked.c} onChange={onChange} onShare={onShare} />;
}

function Construction({ c, onChange, onShare }: { c: Resolved; onChange?: () => void; onShare?: (summary: ShareSummary) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = { compass: `cx${uid}-compass`, pencil: `cx${uid}-pencil`, knob: `cx${uid}-knob`, nib: (p: string) => `cx${uid}-nib-${p}` };
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FIRST_WIDTH);
  /* The construction's layout (compact or wide) is chosen once, from the first real measurement, so the
     learner's arcs never jump to a different layout. No window reads during render or initial state. */
  const [compactLayout, setCompactLayout] = useState(false);
  const layoutChosen = useRef(false);
  const L = useMemo(() => layoutFor(c, compactLayout), [c, compactLayout]);
  const [model, setModel] = useState<Model>(startModel);
  const [history, setHistory] = useState<Model[]>([]);
  const [status, setStatus] = useState("");
  const [reduced, setReduced] = useState(false);
  const [shared, setShared] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useCancelGesture(dragging, () => { setEpoch(k => k + 1); setDragging(false); setStatus("Drag interrupted. Nothing changed."); });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const resize = () => {
      setWidth(el.clientWidth);
      if (!layoutChosen.current) { layoutChosen.current = true; setCompactLayout(el.clientWidth < 420); }
    };
    resize();
    const ob = new ResizeObserver(resize);
    ob.observe(el);
    return () => ob.disconnect();
  }, []);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  const g = geometry(width, L, width < 420);
  const pts = allPoints(model, L);
  const pos = new Map(pts.map(p => [p.id, p.at]));
  const reading = read(model, L, c);
  const cm = (d: number) => (d * c.length).toFixed(1);
  const nameOf = (id: string) => pts.find(p => p.id === id)?.name ?? "";

  function commit(next: Model, message: string) {
    let n = normalize(next, L, g.world);
    n = nameVisible(n, L, read(n, L, c).roles);
    const r = read(n, L, c);
    /* Once the figure is complete the compass steps aside so nothing covers it. */
    if (r.finished && !reading.finished) n = { ...n, needle: "park", r: Math.min(n.r, 0.42) };
    setHistory(h => [...h.slice(-40), model]);
    setModel(n);
    setShared(false);
    setStatus(message ? `${message}${r.issue ? ` ${r.issue}` : r.finished && r.success ? ` ${r.next}` : ""}` : "");
    onChange?.();
  }
  function describe(prev: Model, next: Model) {
    const before = new Set(prev.points.map(p => p.id));
    let n = normalize(next, L, g.world);
    n = nameVisible(n, L, read(n, L, c).roles);
    const fresh = n.points.filter(p => !before.has(p.id) && p.name).map(p => p.name);
    const found = fresh.length ? ` ${fresh.length === 1 ? "New point" : "New points"} ${fresh.join(", ")}.` : "";
    const nm = (id: string) => n.points.find(p => p.id === id)?.name || nameOf(id);
    if (next.lines.length > prev.lines.length) { const l = next.lines[next.lines.length - 1]; return `Drew ${nm(l.a)}${nm(l.b)}.${found}`; }
    if (next.arcs !== prev.arcs) return `Arc drawn from ${nm(next.needle)} at ${cm(next.r)} cm.${found}`;
    if (next.needle !== prev.needle) return next.needle === "free" || next.needle === "park" ? "Compass set down." : `Needle on ${nm(next.needle)}.`;
    if (next.r !== prev.r) return `Compass opened to ${cm(next.r)} cm.`;
    return "";
  }
  function onDrop(dropped: Model) {
    setDragging(false);
    const next = commitDraft(commitSweep(dropped));
    if (next === model || (next.needle === "park" && model.needle === "park" && next.r === model.r && next.lines === model.lines && next.arcs === model.arcs)) return;
    const msg = describe(model, next);
    if (!msg && next.needle === model.needle && next.r === model.r && next.fx === model.fx && next.fy === model.fy && next.angle === model.angle) return;
    commit(next, msg);
  }

  /* ---------- Button path ---------- */
  const actions = {
    needle: (at: string) => commit(placeNeedle(model, at, pos), `Needle on ${nameOf(at)}.`),
    opening: (value: string) => {
      if (model.needle === "free" || model.needle === "park" || !value) return;
      const N = pos.get(model.needle)!;
      if (value.startsWith("pt:")) {
        const q = pos.get(value.slice(3))!;
        const r = Math.min(MAX_R, Math.max(MIN_R, dist(N, q))), angle = deg(sub(q, N));
        commit({ ...model, r, angle, hand: handFor(angle) }, `Pencil on ${nameOf(value.slice(3))}: compass opened to ${cm(r)} cm.`);
      } else { const r = Number(value); if (!(r >= MIN_R && r <= MAX_R)) return; commit({ ...model, r }, `Compass opened to ${cm(r)} cm.`); }
    },
    sweep: () => {
      if (model.needle === "free" || model.needle === "park") { setStatus("Put the needle on a point first."); return; }
      const next = commitSweep({ ...model, sweepFrom: model.angle, angle: model.angle + 360 });
      commit({ ...next, angle: model.angle }, describe(model, next).replace("Arc drawn", "Full circle drawn"));
    },
    line: () => { if (from && to && from !== to) { const next = addLine(model, from, to); commit(next, describe(model, next) || "That line is already drawn."); } },
    undo: () => { const prev = history[history.length - 1]; if (!prev) return; setHistory(h => h.slice(0, -1)); setModel(prev); setShared(false); setStatus("Undid the last move."); onChange?.(); },
    reset: () => { setHistory(h => [...h, model]); setModel(startModel()); setShared(false); setStatus("Started over."); onChange?.(); },
  };

  /* Test and tooling hook (one construction per page). */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingCompass?: unknown };
    host.keatingCompass = Object.freeze({
      snapshot: () => ({
        construction: c.construction,
        points: pts.map(p => ({ name: p.name, given: p.given, x: +p.at.x.toFixed(4), y: +p.at.y.toFixed(4) })),
        lines: model.lines.map(l => `${nameOf(l.a)}${nameOf(l.b)}`),
        arcs: model.arcs.map(a => ({ center: nameOf(a.center), r: +cm(a.r), lo: +a.lo.toFixed(1), hi: +a.hi.toFixed(1) })),
        needle: model.needle === "free" || model.needle === "park" ? model.needle : nameOf(model.needle),
        radius: +cm(model.r), ratio: +model.r.toFixed(4),
        steps: reading.steps.map(s => s.status), finished: reading.finished, success: reading.success,
        next: reading.next, issue: reading.issue, measures: reading.measures,
        /* fields the first review's scripts read (equilateral) */
        crossing: reading.measures.crossing ?? null, closed: reading.finished, equilateral: reading.success,
        sides: { AB: reading.measures.AB ?? null, AC: reading.measures.AC ?? null, BC: reading.measures.BC ?? null },
      }),
      handles: () => {
        const svg = wrap.current?.querySelector("svg")?.getBoundingClientRect();
        if (!svg) return null;
        const pose = needlePose(model, g, pos);
        const p = compassPose(model.r * g.s, pose.angle, pose.hand, g);
        const at = (q: Vec2) => ({ x: svg.left + q.x, y: svg.top + q.y });
        const out: Record<string, unknown> = {};
        for (const q of pts) out[q.name] = at(px(g, q.at));
        return { ...out, needle: at(pose.N), pencil: at(pose.N.add(p.pencil)), knob: at(pose.N.add(p.knob)), legMid: at(pose.N.add(p.hinge.mul(0.55))), L: g.s, unit: g.s };
      },
    });
    return () => { delete host.keatingCompass; };
  });

  /* ---------- The draggable ----------
     Dragology renders many hypothetical models and blends between them. An element that appears in
     more than one candidate keeps its id, class list and path structure; anything that only exists in
     one candidate (target ring, ghost line, preview circle) has its own id. */
  const fin = (spec: DragSpec<Model>) => reduced ? spec.withDropTransition(false).withBranchTransition(false) : spec;
  const cueOn = c.hints === "full";

  const draggable: Draggable<Model> = ({ state, d, draggedId }) => {
    const sPts = allPoints(state, L);
    const sPos = new Map(sPts.map(p => [p.id, p.at]));
    const r = read(state, L, c);
    const x = context(state, L, c);
    const pose = needlePose(state, g, sPos);
    const N = pose.N;
    const p = compassPose(state.r * g.s, pose.angle, pose.hand, g);
    const P = N.add(p.pencil);
    const compassDrag = draggedId === ids.compass, pencilDrag = draggedId === ids.pencil, knobDrag = draggedId === ids.knob;
    const busy = !!draggedId;
    const needleAt = state.needle !== "free" && state.needle !== "park" ? state.needle : null;
    const cue = busy || !cueOn ? {} : r.cue;
    const arcs = liveArcs(state);

    /* Specs */
    const needleSpec = () => {
      const wn = toWorld(g, N);
      const free = d.vary({ ...state, needle: "free", fx: wn.x, fy: wn.y, angle: pose.angle, hand: pose.hand } as Model, [param("fx"), param("fy")], {
        constraint: s => [...inOrder([g.world[0] + 0.05, s.fx, g.world[2] - 0.05]), ...inOrder([g.world[1] + 0.05, s.fy, g.world[3] - 0.05])],
      });
      const base = { ...state, angle: pose.angle, hand: pose.hand, needle: needleAt ?? state.needle };
      return fin(d.closest(sPts.map(q => placeNeedle(base, q.id, sPos))).whenFar(free, { gap: 26 }).withBranchTransition(140));
    };
    const pencilSpec = () => {
      const free = d.vary(state, [param("r"), param("angle")], { constraint: s => inOrder([MIN_R, s.r, MAX_R]) });
      if (!needleAt) return fin(free);
      const Nw = sPos.get(needleAt)!;
      const snaps = sPts.filter(q => q.id !== needleAt && dist(q.at, Nw) >= MIN_R && dist(q.at, Nw) <= MAX_R)
        .map(q => { const a = deg(sub(q.at, Nw)); return { ...state, r: dist(q.at, Nw), angle: a, hand: state.hand }; });
      return fin(snaps.length ? d.closest(snaps).whenFar(free, { gap: 12 }).withBranchTransition(90) : free);
    };
    const knobSpec = () => fin(d.vary({ ...state, hand: pose.hand, sweepFrom: needleAt ? state.angle : null }, param("angle")));
    const nibSpec = (fromId: string) => () => {
      const o = sPos.get(fromId)!;
      const targets = sPts.filter(q => q.id !== fromId && !x.hasLine(fromId, q.id));
      const loose = d.vary({ ...state, draftFrom: fromId, draftTo: null, dx: o.x, dy: o.y }, [param("dx"), param("dy")]);
      const spec = targets.length ? d.closest(targets.map(q => ({ ...state, draftFrom: fromId, draftTo: q.id }))).whenFar(loose, { gap: 24 }).withBranchTransition(110) : loose;
      return fin(spec.withDropTransition(false));
    };

    /* Figure centroid, for pushing labels outwards. */
    const centroid = (() => { const all = sPts.map(q => q.at); return v(all.reduce((a, q) => a + q.x, 0) / all.length, all.reduce((a, q) => a + q.y, 0) / all.length); })();

    /* Given lines and circles */
    const given = <g id={`cx${uid}-given`} className="cx-given" pointerEvents="none">
      {L.segs.map(s => <line {...px(g, s.a).xy1()} {...px(g, s.b).xy2()} className={s.ray ? "cx-given-ray" : "cx-given-seg"} />)}
      {L.circles.map(ci => <circle transform={translate(px(g, ci.c))} r={ci.r * g.s} className="cx-given-circle" />)}
    </g>;

    /* Arcs */
    const arcLayer = arcs.map(a => {
      const cc = sPos.get(a.center);
      if (!cc) return null;
      return <g id={`cx${uid}-arc-${a.id}`} className="cx-arc">
        <path d={arcPath(px(g, cc), a.r * g.s, a.lo, a.hi)} className="cx-arc-line" />
      </g>;
    });

    /* Live previews while carrying or opening the compass */
    const showPreview = (compassDrag || pencilDrag) && needleAt;
    const previewCircle = showPreview ? <g id={`cx${uid}-preview-${needleAt}`} className="cx-preview" pointerEvents="none">
      <circle transform={translate(N)} r={state.r * g.s} />
    </g> : null;
    let ghosts: Vec2[] = [];
    if (showPreview) {
      const cw = sPos.get(needleAt!)!;
      for (const a of state.arcs) {
        const ac = sPos.get(a.center); if (!ac || a.center === needleAt) continue;
        for (const q of circleCircle(cw, state.r, ac, a.r)) if (covers(a, deg(sub(q, ac)))) ghosts.push(px(g, q));
      }
      for (const ci of L.circles) for (const q of circleCircle(cw, state.r, ci.c, ci.r)) ghosts.push(px(g, q));
      for (const sgm of L.segs.filter(s2 => s2.cutsArcs)) {
        const dd = sub(sgm.b, sgm.a), f = sub(sgm.a, cw), A = dd.x * dd.x + dd.y * dd.y, B = 2 * (f.x * dd.x + f.y * dd.y), C = f.x * f.x + f.y * f.y - state.r * state.r;
        const disc = B * B - 4 * A * C;
        if (disc >= 0) for (const t of [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)]) if (t >= 0 && t <= 1) ghosts.push(px(g, v(sgm.a.x + dd.x * t, sgm.a.y + dd.y * t)));
      }
      ghosts = ghosts.filter(q => !sPts.some(sp => px(g, sp.at).sub(q).len() < 4)).slice(0, 8);
    }
    const ghostLayer = ghosts.length ? <g id={`cx${uid}-ghosts`} className="cx-ghosts" pointerEvents="none">
      {ghosts.map((q, i) => <g id={`cx${uid}-ghost-${i}`} className="cx-ghost" transform={translate(q)}><circle r={6} /><path d="M -3 -3 L 3 3 M -3 3 L 3 -3" /></g>)}
    </g> : null;

    /* Straightedge lines */
    const lineLayer = state.lines.map(l => {
      const a = sPos.get(l.a), b = sPos.get(l.b);
      if (!a || !b) return null;
      const off = r.marks.some(mk => mk.kind === "length" && mk.tone === "off" && ((dist(mk.a, a) < 1e-6 && dist(mk.b, b) < 1e-6) || (dist(mk.a, b) < 1e-6 && dist(mk.b, a) < 1e-6)));
      return <g id={`cx${uid}-${l.id}${off ? "-off" : ""}`} className={off ? "cx-side cx-side-off" : "cx-side"}>
        <line {...px(g, a).xy1()} {...px(g, b).xy2()} />
      </g>;
    });
    const drafting = state.draftFrom;
    const dOrigin = drafting ? px(g, sPos.get(drafting)!) : undefined;
    const dTarget = drafting && state.draftTo ? px(g, sPos.get(state.draftTo)!) : undefined;
    const dEnd = dTarget ?? (drafting ? px(g, v(state.dx, state.dy)) : undefined);
    const draftLayer = dOrigin && dEnd ? <g id={`cx${uid}-draft-${drafting}-${state.draftTo ?? "loose"}`} className={state.draftTo ? "cx-draft cx-draft-snapped" : "cx-draft"} pointerEvents="none">
      {state.draftTo && (() => {
        const u = dEnd.sub(dOrigin), ln = u.len();
        return <g transform={translate(dOrigin) + ` rotate(${u.angleDeg()})`} className="cx-ruler">
          <rect x={-14} y={-(g.compact ? 15 : 17)} width={ln + 28} height={g.compact ? 13 : 15} rx={3} />
          <path className="cx-ruler-tick" d={Array.from({ length: Math.max(0, Math.floor((ln + 20) / 12)) }, (_, i) => `M ${-8 + i * 12} -3 V ${i % 2 ? -7 : -10}`).join(" ")} />
        </g>;
      })()}
      <line {...dOrigin.xy1()} {...dEnd.xy2()} className="cx-draft-line" />
    </g> : null;

    /* Fill and marks */
    const fill = r.fill ? <g id={`cx${uid}-fill-${r.fill.tone}`} className={`cx-fill cx-fill-${r.fill.tone}`} pointerEvents="none">
      <path d={`M ${r.fill.pts.map(q => { const z = px(g, q); return `${z.x} ${z.y}`; }).join(" L ")} Z`} />
    </g> : null;
    const markEl = (mk: Mark, i: number) => {
      if (mk.kind === "length") {
        const a = px(g, mk.a), b = px(g, mk.b), mid = a.lerp(b, 0.5), along = b.sub(a).norm();
        let n = b.sub(a).perp().norm();
        const outward = mk.side ? Vec2(mk.side.x, mk.side.y) : px(g, v((mk.a.x + mk.b.x) / 2, (mk.a.y + mk.b.y) / 2)).sub(px(g, centroid));
        if (n.dot(outward) < 0) n = n.mul(-1);
        const half = mk.text.length * 3.3;
        const at = mid.add(n.mul(12 + half * Math.abs(n.x) + 5 * Math.abs(n.y)));
        return <g id={`cx${uid}-mark-${i}-${mk.tone}-${mk.ticks}`} className={`cx-mark cx-mark-${mk.tone}`} pointerEvents="none">
          {mk.ticks > 0 && <path className="cx-tick" d={Array.from({ length: mk.ticks }, (_, k) => {
            const o = mid.add(along.mul((k - (mk.ticks - 1) / 2) * 4));
            const p1 = o.add(n.mul(-6)), p2 = o.add(n.mul(6));
            return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
          }).join(" ")} />}
          {mk.text && <g transform={translate(at)}><text textAnchor="middle" dominantBaseline="central">{mk.text}</text></g>}
        </g>;
      }
      if (mk.kind === "right") {
        const o = px(g, mk.at), u = Vec2(mk.u.x, mk.u.y).mul(10), w = Vec2(mk.w.x, mk.w.y).mul(10);
        const a = o.add(u), b = o.add(u).add(w), cc = o.add(w);
        return <g id={`cx${uid}-mark-${i}-right`} className="cx-mark cx-mark-ok" pointerEvents="none">
          <path className="cx-right" d={`M ${a.x} ${a.y} L ${b.x} ${b.y} L ${cc.x} ${cc.y}`} />
        </g>;
      }
      const o = px(g, mk.at);
      let lo = mk.from, hi = mk.to;
      let span = ((hi - lo) % 360 + 360) % 360;
      if (span > 180) { [lo, hi] = [hi, lo]; span = 360 - span; }
      const rr = Math.max(16, (mk.r ?? 0.16) * g.s * 0.62);
      const mid = lo + span / 2;
      const lab = o.add(vdir(mid).mul(rr + 13));
      return <g id={`cx${uid}-mark-${i}-${mk.tone}`} className={`cx-mark cx-mark-${mk.tone}`} pointerEvents="none">
        <path className="cx-angle" d={arcPath(o, rr, lo, lo + span)} />
        {mk.text && <g transform={translate(lab)}><text textAnchor="middle" dominantBaseline="central">{mk.text}</text></g>}
      </g>;
    };

    /* Points */
    const usedIds = new Set([...state.lines.flatMap(l => [l.a, l.b]), ...state.arcs.map(a => a.center), ...r.roles]);
    const pointEl = (q: Pt) => {
      const at = px(g, q.at);
      const target = (drafting && state.draftTo === q.id) || (compassDrag && needleAt === q.id)
        || (pencilDrag && needleAt !== q.id && P.sub(at).len() < 2.5);
      const out = q.given ? Vec2(q.label.x, q.label.y).norm() : (() => { const o = at.sub(px(g, centroid)); return o.len() < 1 ? Vec2(0, -1) : o.norm().add(Vec2(0, -0.6)).norm(); })();
      const showName = q.given || usedIds.has(q.id);
      return <g id={`cx${uid}-pt-${q.id}`} transform={translate(at)} className={q.given ? "cx-point" : "cx-point cx-point-found"} pointerEvents="none" data-point={q.name}>
        {target && <g id={`cx${uid}-target-${q.id}`} className="cx-target-ring"><circle r={13} /></g>}
        <circle r={q.given ? 3.6 : 3.2} className="cx-point-dot" />
        {showName && <g id={`cx${uid}-ptname-${q.id}`} className="cx-point-name" transform={translate(out.mul(14))}><text textAnchor="middle" dominantBaseline="central">{q.name}</text></g>}
      </g>;
    };
    const nib = (q: Pt) => {
      const active = drafting === q.id;
      const at = active && dEnd ? dEnd : px(g, q.at);
      return <g id={ids.nib(q.id)} transform={translate(at)} className="cx-nib" data-compass-nib={q.name}
        dragologyZIndex={active ? "/6" : false} dragologyOnDrag={nibSpec(q.id)}>
        <circle r={g.compact ? 15 : 14} className="cx-nib-hit" />
        <circle r={8} className="cx-nib-ring" />
        {cue.nib === q.id && <g id={`cx${uid}-cue-nib-${q.id}`} className="cx-cue"><circle r={9} /></g>}
        {cue.needle === q.id && <g id={`cx${uid}-cue-needle-${q.id}`} className="cx-cue cx-cue-dashed"><circle r={11} /></g>}
        {active && <g id={`cx${uid}-nibtip-${q.id}`} className="cx-nib-tip"><circle r={3} /></g>}
      </g>;
    };

    /* The compass */
    const legPoly = (a: Vec2, b: Vec2, w0: number, w1: number, until: number) => {
      const u = b.sub(a).norm(), w = u.perp(), end = a.lerp(b, until);
      const q = [a.add(w.mul(w0)), end.add(w.mul(w1)), end.sub(w.mul(w1)), a.sub(w.mul(w0))];
      return `M ${q.map(z => `${z.x} ${z.y}`).join(" L ")} Z`;
    };
    const O0 = Vec2(0, 0), Hh = p.hinge;
    const needleEnd = Hh.lerp(O0, 0.86), pencilBody = Hh.lerp(p.pencil, 0.74), leadStart = Hh.lerp(p.pencil, 0.9);
    const lu = p.pencil.sub(Hh).norm().perp();
    const knobDeg = p.n.angleDeg() + 90;
    const compass = <g id={ids.compass} transform={translate(N)} data-compass-part="body" className="cx-compass"
      dragologyZIndex={compassDrag ? "/2" : 1} dragologyOnDrag={needleSpec}>
      <path d={`M 0 0 L ${Hh.x} ${Hh.y} L ${p.pencil.x} ${p.pencil.y}`} className="cx-compass-hit" />
      {compassDrag && <g id={`cx${uid}-compass-shadow`} className="cx-compass-shadow"><path d={`M 0 0 L ${Hh.x} ${Hh.y} L ${p.pencil.x} ${p.pencil.y}`} /></g>}
      <path d={legPoly(Hh, O0, 3.6, 1.7, 0.86)} className="cx-leg" />
      <path d={`M ${needleEnd.x} ${needleEnd.y} L 0 0`} className="cx-needle" />
      <path d={legPoly(Hh, p.pencil, 3.6, 3, 0.74)} className="cx-leg" />
      <path d={legPoly(pencilBody, leadStart, 3.2, 3.2, 1)} className="cx-pencil-body" />
      <path d={`M ${leadStart.add(lu.mul(2.6)).x} ${leadStart.add(lu.mul(2.6)).y} L ${p.pencil.x} ${p.pencil.y} L ${leadStart.sub(lu.mul(2.6)).x} ${leadStart.sub(lu.mul(2.6)).y} Z`} className="cx-lead" />
      <g transform={translate(Hh)}><circle r={6.5} className="cx-hinge" /><circle r={2} className="cx-hinge-pin" /></g>
      <path d={`M ${Hh.x} ${Hh.y} L ${p.knob.x} ${p.knob.y}`} className="cx-stem" />
      <g id={ids.knob} transform={translate(p.knob) + ` rotate(${knobDeg})`} data-compass-part="knob" className="cx-knob"
        dragologyZIndex="/4" dragologyOnDrag={knobSpec}>
        <circle r={g.compact ? 17 : 16} className="cx-handle-hit" />
        <rect x={-5.5} y={-9} width={11} height={18} rx={5.5} className="cx-knob-grip" />
        <path d="M -3 -3.5 H 3 M -3 0 H 3 M -3 3.5 H 3" className="cx-knurl" />
        {cue.knob && <g id={`cx${uid}-cue-knob`} className="cx-cue"><circle r={13} /></g>}
      </g>
      <g id={ids.pencil} transform={translate(p.pencil)} data-compass-part="pencil" className="cx-pencil" dragologyZIndex="/4" dragologyOnDrag={pencilSpec}>
        <circle r={g.compact ? 17 : 16} className="cx-handle-hit" />
        {cue.pencil && <g id={`cx${uid}-cue-pencil`} className="cx-cue"><circle r={11} /></g>}
        <circle r={2.2} className="cx-pencil-tip" />
      </g>
    </g>;
    const readout = pencilDrag ? (() => {
      const beyond = P.add(vdir(pose.angle).mul(g.compact ? 26 : 30));
      const at = Vec2(Math.min(g.W - 30, Math.max(30, beyond.x)), Math.min(g.H - 12, Math.max(12, beyond.y)));
      const onPt = sPts.find(q => q.id !== needleAt && px(g, q.at).sub(P).len() < 2.5);
      return <g id={`cx${uid}-readout${onPt ? "-hit" : ""}`} className={onPt ? "cx-readout cx-readout-hit" : "cx-readout"} pointerEvents="none">
        <line {...N.xy1()} {...P.xy2()} className="cx-readout-line" />
        <g transform={translate(at)}><text textAnchor="middle" dominantBaseline="central">{onPt && needleAt ? `${cm(state.r)} = ${nameOf(needleAt)}${onPt.name}` : `${cm(state.r)} cm`}</text></g>
      </g>;
    })() : null;
    const sweeping = knobDrag && needleAt ? <g id={`cx${uid}-sweep-hint`} className="cx-sweep" pointerEvents="none">
      <text transform={translate(Math.min(g.W - 40, Math.max(40, N.x)), Math.max(14, N.y - state.r * g.s - 14))} textAnchor="middle">{`${cm(state.r)} cm`}</text>
    </g> : null;

    return <g>
      {fill}
      {given}
      {previewCircle}
      <g id={`cx${uid}-arcs`}>{arcLayer}</g>
      <g id={`cx${uid}-lines`}>{lineLayer}</g>
      {draftLayer}
      <g id={`cx${uid}-marks`}>{r.marks.map(markEl)}</g>
      {ghostLayer}
      <g id={`cx${uid}-points`}>{sPts.map(pointEl)}</g>
      {compass}
      {readout}
      {sweeping}
      <g id={`cx${uid}-nibs`} dragologyZIndex={r.cue.nib ? "/5" : 2}>{sPts.map(nib)}</g>
    </g>;
  };

  /* ---------- Copy around the canvas ---------- */
  const current = reading.steps.findIndex(s => s.status !== "done");
  const done = reading.finished;
  const tone = done ? (reading.success ? "ok" : "off") : reading.issue ? "off" : "plain";
  const instruction = reading.issue || (c.hints === "none" && !done ? "" : reading.next) || (done && !reading.success ? "Look at the measurements on the canvas." : "");
  const doneCount = reading.steps.filter(s => s.status === "done").length;
  const named = pts.filter(q => q.name);
  const placedNeedle = model.needle !== "free" && model.needle !== "park" ? model.needle : "";
  const openingOptions = placedNeedle ? [
    ...named.filter(q => q.id !== placedNeedle && dist(q.at, pos.get(placedNeedle)!) <= MAX_R).map(q => ({ value: `pt:${q.id}`, label: `Pencil on ${q.name} (${cm(dist(q.at, pos.get(placedNeedle)!))} cm)` })),
    ...[0.4, 0.75, 1.25].map(k => ({ value: String(k), label: `${cm(k)} cm` })),
  ] : [];
  const openingValue = openingOptions.find(o => o.value.startsWith("pt:") ? same(dist(pos.get(o.value.slice(3))!, pos.get(placedNeedle)!), model.r) : same(Number(o.value), model.r))?.value ?? "";

  return <section className={`activity compass cx-${tone}${dragging ? " is-dragging" : ""}`} data-simulation="compass-construction" data-construction={c.construction} aria-labelledby={`cx${uid}-title`}>
    <div className="cx-header">
      <h3 id={`cx${uid}-title`}>{c.title}</h3>
      <span className="cx-count">{done ? (reading.success ? "Constructed" : "Built, but off") : c.showSteps ? `${doneCount} of ${reading.steps.length} steps` : "Goal"}</span>
    </div>
    {(!c.showSteps || c.hints === "none") && <p className="cx-goal">{c.goal}</p>}
    <div className={`cx-body${c.showSteps ? "" : " cx-body-solo"}`}>
      <div className="cx-canvas" ref={wrap} aria-hidden="true">
        <DraggableRenderer key={epoch} draggable={draggable} state={model} width={g.W} height={g.H} onDropState={onDrop}
          onDragStatus={st => { const on = st.type === "dragging"; if (on !== dragging) setDragging(on); }} />
      </div>
      {c.showSteps && <ol className="cx-steps" aria-label="Construction steps">
        {reading.steps.map((step, i) => {
          const isCurrent = i === current;
          return <li key={i} className={`cx-step is-${step.status}${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "step" : undefined}>
            <span className="cx-step-mark" aria-hidden="true">{step.status === "done" ? <Check size={11} strokeWidth={3.2} /> : step.status === "off" ? "≠" : i + 1}</span>
            <span className="cx-step-text">
              <span className="cx-step-title">{step.title}{step.partial ? <span className="cx-step-partial"> · {step.partial}</span> : null}</span>
              {isCurrent && c.hints === "full" && step.status !== "off" ? <span className="cx-step-how">{step.how}</span> : null}
              <span className="learning-lab__sr-only">{step.status === "done" ? " (done)" : step.status === "off" ? " (needs a fix)" : isCurrent ? " (current)" : ""}</span>
            </span>
          </li>;
        })}
      </ol>}
    </div>
    <p className={`cx-instruction cx-instruction-${tone}`} aria-live="polite">{instruction}</p>
    <details className="receipt cx-controls">
      <summary>Use buttons instead</summary>
      <div className="cx-control-rows">
        <div className="cx-control-row">
          <span className="cx-control-label">Straightedge</span>
          <label className="cx-select">From<select value={from} onChange={e => setFrom(e.currentTarget.value)}>
            <option value="">–</option>{named.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select></label>
          <label className="cx-select">To<select value={to} onChange={e => setTo(e.currentTarget.value)}>
            <option value="">–</option>{named.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select></label>
          <button type="button" className="cx-chip" disabled={!from || !to || from === to} onClick={actions.line}>Draw line</button>
        </div>
        <div className="cx-control-row">
          <span className="cx-control-label">Compass</span>
          <label className="cx-select">Needle on<select value={placedNeedle} onChange={e => { if (e.currentTarget.value) actions.needle(e.currentTarget.value); }}>
            <option value="" disabled>Not placed</option>{named.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select></label>
          <label className="cx-select">Opening<select value={openingValue} disabled={!placedNeedle} onChange={e => actions.opening(e.currentTarget.value)}>
            <option value="" disabled>Now {cm(model.r)} cm</option>
            {openingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
          <button type="button" className="cx-chip" disabled={!placedNeedle} onClick={actions.sweep}>Sweep a full circle</button>
        </div>
      </div>
    </details>
    <span className="learning-lab__sr-only" role="status">{status}</span>
    <div className="actions cx-actions">
      {history.length > 0 && <button type="button" className="primary" disabled={shared} onClick={() => { setShared(true); onShare?.(reading.summary); }}>{shared ? "Shared" : "Share with Keating"}</button>}
      {history.length > 0 && <button type="button" className="quiet cx-icon-btn" onClick={actions.undo}><Undo2 size={13} aria-hidden="true" />Undo</button>}
      {(model.lines.length > 0 || model.arcs.length > 0 || model.needle !== "park") && <button type="button" className="quiet cx-icon-btn" onClick={actions.reset}><RotateCcw size={13} aria-hidden="true" />Start over</button>}
    </div>
  </section>;
}

export type { Reading };
