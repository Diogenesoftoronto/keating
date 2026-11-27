import { useEffect, useMemo, useRef, useState } from "react";
import {
  contourSegments, fieldAt, fieldLines, fieldSI, imageSources, insideSphere, nullPoints, potentialAt, type Bounds, type PointQ, type Sphere,
} from "./physics";
import {
  Actions, clamp, Disclosure, fmt, Found, handleCentres, keyStep, readColour, sci, Shell, snap, svgToClient, useDrag, useEditable,
  useReducedMotion, useScheme, useTestApi, useElementWidth, type Pt,
} from "./common";
import type { FieldConfig, FieldFinding, ShareSummary } from "./types";

type Q = { id: string; x: number; y: number; q: number; locked?: boolean };
type FState = { charges: Q[]; probe: Pt | null };
type Probe = { e: Pt; mag: number; si: number; parts: { label: string; e: Pt }[]; inside: boolean };

const FINDING_LABEL: Record<FieldFinding, string> = {
  oneArrow: "one arrow at every point", nullPoint: "a point with no direction", superposition: "two pushes, one arrow",
  inverseSquare: "twice as far, a quarter the field", shielding: "no field inside the conductor",
};
const TEST_Q = 0.1;  // test charge, in the config's charge unit (small, so it barely disturbs the others)

const narrow0 = (w: number) => w < 460;
export function fieldModel(c: FieldConfig, s: FState) {
  const cond: Sphere | undefined = c.conductor;
  const src = imageSources(s.charges, cond);
  const b: Bounds = { x0: -c.view.width / 2, x1: c.view.width / 2, y0: -c.view.height / 2, y1: c.view.height / 2 };
  return { cond, src, b };
}
export function probeAt(c: FieldConfig, s: FState, p: Pt): Probe {
  const { cond, src } = fieldModel(c, s);
  const e = fieldAt(src, p.x, p.y, cond), mag = Math.hypot(e.x, e.y), inside = insideSphere(cond, p.x, p.y);
  const parts = inside ? [] : s.charges.map(q => ({ label: q.id, e: fieldAt([q], p.x, p.y) }));
  if (cond && !inside) {
    const images = src.slice(s.charges.length);
    parts.push({ label: "induced", e: fieldAt(images, p.x, p.y) });
  }
  return { e, mag, si: fieldSI(mag, c.units.length, c.units.charge), parts, inside };
}
const angleDeg = (v: Pt) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
function direction(v: Pt) {
  const a = angleDeg(v);
  const names = ["+x (right)", "up and right", "up (+y)", "up and left", "−x (left)", "down and left", "down (−y)", "down and right"];
  return `${names[((Math.round(a / 45) % 8) + 8) % 8]}, ${fmt(((a % 360) + 360) % 360, 0)}°`;
}

export function FieldLab({ config: c, onChange, onShare }: { config: FieldConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const initial = useMemo<FState>(() => ({ charges: c.charges.map(q => ({ ...q })), probe: c.probe ? { ...c.probe } : null }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), canvas = useRef<HTMLCanvasElement>(null), root = useRef<HTMLDivElement>(null);
  const W = useElementWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const reduced = useReducedMotion();
  const dark = useScheme();
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState({ lines: c.show?.lines ?? true, equi: c.show?.equipotentials ?? true, map: c.show?.potentialMap ?? true });
  const findings = c.findings ?? ["oneArrow", "nullPoint", "superposition"];
  const [found, setFound] = useState<Set<string>>(new Set());
  const [drops, setDrops] = useState<{ r: number; mag: number; id: string }[]>([]);
  const [last, setLast] = useState<string>("");
  const perf = useRef({ recomputes: 0, ms: 0, maxMs: 0 });

  const s = ed.view, base = ed.state;
  const narrow = W < 460;
  /* On a phone the plane is cropped at the sides (never past a charge or the metal) so it isn't a sliver. */
  const reach = Math.max(...c.charges.map(q => Math.abs(q.x)), c.conductor ? Math.abs(c.conductor.x) + c.conductor.r : 0, c.probe ? Math.abs(c.probe.x) : 0) + c.view.width * 0.08;
  const vw = narrow0(W) ? Math.min(c.view.width, Math.max(c.view.width * 0.7, 2 * reach)) : c.view.width, vh = c.view.height;
  const ppu = Math.min(W / vw, (narrow ? 300 : 400) / vh);
  const PW = vw * ppu, PH = vh * ppu, ox = (W - PW) / 2;
  const X = (x: number) => ox + (x + vw / 2) * ppu, Y = (y: number) => (vh / 2 - y) * ppu;
  const UX = (px: number) => (px - ox) / ppu - vw / 2, UY = (py: number) => vh / 2 - py / ppu;
  const step = Math.max(0.05, snap(vw / 80, 0.05));
  const qStep = c.qStep ?? 1, qMax = c.qMax ?? 4, maxCharges = Math.min(6, c.maxCharges ?? c.charges.length);
  const lu = c.units.length, cu = c.units.charge;
  const cond = c.conductor;
  const seedR = 11 / ppu;

  /* Null points of the committed arrangement (a grid search plus Newton: too slow to redo every drag frame). */
  const nulls = useMemo(() => nullPoints(base.charges, cond, fieldModel(c, base).b), [base, cond, c]);
  const colours = useRef<{ dark: boolean; pos: number[]; neg: number[]; ink: number[]; muted: number[] } | null>(null);

  /* ---- the heavy part: field lines, potential grid, contours, null points (once per frame at most) ---- */
  const field = useMemo(() => {
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const { src, b } = fieldModel(c, s);
    const lines = show.lines ? fieldLines(s.charges, cond, b, c.linesPerUnit ?? 6, seedR) : [];
    const cell = dragging ? 9 : 6, gx = Math.max(24, Math.round(PW / cell)), gy = Math.max(16, Math.round(PH / cell));
    const vals = new Float64Array(gx * gy);
    const qmax = Math.max(...s.charges.map(q => Math.abs(q.q)), 1e-9);
    const vref = qmax / (0.05 * vw);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const x = -vw / 2 + (vw * i) / (gx - 1), y = vh / 2 - (vh * j) / (gy - 1);   // the visible (possibly cropped) plane
      const v = insideSphere(cond, x, y) ? NaN : potentialAt(src, x, y, cond);
      vals[j * gx + i] = clamp(v, -vref * 8, vref * 8);
    }
    const contours: number[] = [];
    if (show.equi) {
      const dv = vref / 3, mixed = s.charges.some(q => q.q > 0) && s.charges.some(q => q.q < 0);
      for (let k = -9; k <= 9; k++) if (k !== 0 || mixed) contourSegments(vals, gx, gy, k * dv + (k === 0 ? 1e-12 : 0), contours);
    }
    const ms = typeof performance !== "undefined" ? performance.now() - t0 : 0;
    perf.current.recomputes++; perf.current.ms += ms; perf.current.maxMs = Math.max(perf.current.maxMs, ms);
    return { lines, vals, gx, gy, contours, vref, nulls, src };
  }, [c, s, show.lines, show.equi, PW, PH, vw, vh, cond, seedR, dragging, nulls]);

  /* ---- draw the canvas layer after render (SSR never touches it) ---- */
  useEffect(() => {
    const cv = canvas.current, el = root.current; if (!cv || !el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(PW), h = Math.round(PH);
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!colours.current || colours.current.dark !== dark) colours.current = { dark, pos: readColour(el, "--pl-pos", [236, 138, 111]), neg: readColour(el, "--pl-neg", [127, 176, 242]), ink: readColour(el, "--pl-ink", [233, 239, 233]), muted: readColour(el, "--pl-muted", [173, 189, 177]) };
    const { pos, neg, ink, muted } = colours.current;
    const rgba = (c3: number[], a: number) => `rgba(${c3[0] | 0},${c3[1] | 0},${c3[2] | 0},${a})`;
    if (show.map) {
      const { gx, gy, vals, vref } = field;
      const img = ctx.createImageData(gx, gy);
      for (let i = 0; i < gx * gy; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) { img.data[i * 4 + 3] = 0; continue; }
        const t = Math.tanh(Math.abs(v) / (vref * 2.2)), col = v > 0 ? pos : neg;
        img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = Math.round(t * (dark ? 70 : 60));
      }
      const off = document.createElement("canvas"); off.width = gx; off.height = gy;
      off.getContext("2d", { willReadFrequently: true })!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, w, h);
    }
    if (show.equi && field.contours.length) {
      const sx = w / (field.gx - 1), sy = h / (field.gy - 1);
      ctx.strokeStyle = rgba(muted, 0.7); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const cs = field.contours;
      for (let i = 0; i < cs.length; i += 4) { ctx.moveTo(cs[i] * sx, cs[i + 1] * sy); ctx.lineTo(cs[i + 2] * sx, cs[i + 3] * sy); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (show.lines) {
      const px = (x: number) => (x + vw / 2) * ppu, py = (y: number) => (vh / 2 - y) * ppu;
      ctx.strokeStyle = rgba(ink, 0.62); ctx.fillStyle = rgba(ink, 0.8); ctx.lineWidth = 1.3; ctx.lineJoin = "round";
      for (const l of field.lines) {
        const p = l.pts; if (p.length < 4) continue;
        ctx.beginPath(); ctx.moveTo(px(p[0]), py(p[1]));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(px(p[i]), py(p[i + 1]));
        ctx.stroke();
        /* Arrowhead one third along the visible part, pointing the way E points. */
        let visible = 0; for (let i = 2; i < p.length; i += 2) if (Math.abs(p[i]) < vw / 2 && Math.abs(p[i + 1]) < vh / 2) visible = i;
        const at = Math.max(2, Math.min(visible, Math.round(p.length / 6) * 2));
        if (at + 2 < p.length) {
          const dirSign = field.lines.length && s.charges.reduce((a, q) => a + Math.max(0, q.q), 0) >= s.charges.reduce((a, q) => a + Math.max(0, -q.q), 0) ? 1 : -1;
          const x1 = px(p[at]), y1 = py(p[at + 1]), x0 = px(p[at - 2]), y0 = py(p[at - 1]);
          let dx = (x1 - x0) * dirSign, dy = (y1 - y0) * dirSign; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
          ctx.beginPath(); ctx.moveTo(x1 + dx * 4, y1 + dy * 4); ctx.lineTo(x1 - dx * 3 - dy * 3, y1 - dy * 3 + dx * 3); ctx.lineTo(x1 - dx * 3 + dy * 3, y1 - dy * 3 - dx * 3); ctx.closePath(); ctx.fill();
        }
      }
    }
  }, [field, show, PW, PH, ppu, vw, vh, dark, s.charges]);

  /* ---- commits: findings and messages come from what was dropped ---- */
  const probe = s.probe ? probeAt(c, s, s.probe) : null;
  const probeBase = base.probe ? probeAt(c, base, base.probe) : null;
  const nullNear = (st: FState, p: Pt, pr: Probe) => {
    const sum = pr.parts.reduce((a, q) => a + Math.hypot(q.e.x, q.e.y), 0);
    return !pr.inside && ((sum > 0 && pr.mag < 0.04 * sum) || (st === base ? nulls : []).some(n => Math.hypot(n.x - p.x, n.y - p.y) < 0.03 * vw));
  };
  const superposed = (pr: Probe) => {
    const big = pr.parts.filter(q => Math.hypot(q.e.x, q.e.y) > 0.15 * Math.max(...pr.parts.map(z => Math.hypot(z.e.x, z.e.y))));
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      const a = big[i].e, b = big[j].e, cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      if (cos < Math.cos(Math.PI / 4)) return true;
    }
    return false;
  };
  const dominant = (st: FState, pr: Probe, p: Pt) => {
    if (pr.inside || cond) return null;
    const mags = pr.parts.map(q => Math.hypot(q.e.x, q.e.y)), top = Math.max(...mags), i = mags.indexOf(top);
    if (mags.some((m, j) => j !== i && m > 0.03 * top)) return null;
    const q = st.charges[i];
    return { id: q.id, r: Math.hypot(p.x - q.x, p.y - q.y) };
  };
  useEffect(() => {
    if (!base.probe || !probeBase) return;
    const add: string[] = [];
    if (probeBase.mag > 0 && !probeBase.inside) add.push("oneArrow");
    if (nullNear(base, base.probe, probeBase)) add.push("nullPoint");
    if (superposed(probeBase)) add.push("superposition");
    if (probeBase.inside) add.push("shielding");
    const dom = dominant(base, probeBase, base.probe);
    if (dom) {
      const next = [...drops.filter(d => d.id === dom.id && Math.abs(d.r - dom.r) > 1e-6), { ...dom, mag: probeBase.mag }].slice(-4);
      setDrops(next);
      const rs = next.map(d => d.r);
      if (Math.max(...rs) / Math.min(...rs) >= 1.5) add.push("inverseSquare");
    }
    if (ed.moves === 0) return;   // the preset's own probe only seeds the distance comparison
    setFound(f => { const n = new Set(f); add.filter(a => findings.includes(a as FieldFinding)).forEach(a => n.add(a)); return n.size === f.size ? f : n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const commit = (next: FState, say: string) => { ed.commit(next); setMsg(say); setLast(say); };
  const inPlot = (p: Pt) => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= PH && p.x >= ox && p.x <= ox + PW;
  const keepOut = (x: number, y: number): Pt => {
    let px = clamp(x, -vw / 2 + step, vw / 2 - step), py = clamp(y, -vh / 2 + step, vh / 2 - step);
    if (cond) {
      const dx = px - cond.x, dy = py - cond.y, d = Math.hypot(dx, dy), min = cond.r + 2.2 * seedR;
      if (d < min) { const ux = d ? dx / d : 1, uy = d ? dy / d : 0; px = cond.x + ux * min; py = cond.y + uy * min; }
    }
    return { x: +px.toFixed(3), y: +py.toFixed(3) };
  };
  /* Dock (top right inside the plane): drag a new + or − charge out, or drag a charge or the test charge back in. */
  const dockX = ox + PW - 18, dockY = 18;
  const overDock = (p: Pt) => Math.hypot(p.x - (dockX - 24), p.y - dockY) < 40;
  /* From the committed state, so the dock (and a charge being dragged onto it) stays mounted while the preview changes the count. */
  const canAdd = base.charges.length < maxCharges;
  const nextId = () => { for (const id of "ABCDEF") if (!s.charges.some(q => q.id === id)) return id; return "Q" + s.charges.length; };

  const describeQ = (q: Q) => `${q.id} ${q.q > 0 ? "+" : "−"}${fmt(Math.abs(q.q), qStep < 1 ? 1 : 0)} ${cu}`;
  const qMove = (q: Q) => bind(`charge ${q.id}`, (p, start) => {
    const x0 = X(q.x), y0 = Y(q.y);
    const nx = x0 + p.x - start.x, ny = y0 + p.y - start.y;
    if (overDock({ x: nx, y: ny }) && s.charges.length > 1) return { ...base, charges: base.charges.filter(z => z.id !== q.id) };
    const k = keepOut(snap(UX(nx), step), snap(UY(ny), step));
    return { ...base, charges: base.charges.map(z => z.id === q.id ? { ...z, ...k } : z) };
  });
  const HR = 15, HS = narrow ? 8 : 9;   // charge handle: radius offset and px per unit charge
  const hdir = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
  const qHandle = (q: Q) => bind(`magnitude ${q.id}`, p => {
    const t = (p.x - X(q.x)) * hdir.x + (p.y - Y(q.y)) * hdir.y;
    const mag = clamp(snap((Math.abs(t) - HR) / HS, qStep), qStep, qMax);
    return { ...base, charges: base.charges.map(z => z.id === q.id ? { ...z, q: +(Math.sign(t || 1) * mag).toFixed(3) } : z) };
  });
  const probeMove = bind("test charge", (p, start) => {
    const from = base.probe ? { x: X(base.probe.x), y: Y(base.probe.y) } : { x: dockX, y: dockY + 52 };
    const nx = from.x + p.x - start.x, ny = from.y + p.y - start.y;
    if (!inPlot({ x: nx, y: ny })) return { ...base, probe: null };
    return { ...base, probe: { x: +snap(UX(nx), step / 2).toFixed(3), y: +snap(UY(ny), step / 2).toFixed(3) } };
  });
  const addMove = (sign: 1 | -1) => bind(`add ${sign > 0 ? "+" : "−"}`, p => {
    if (!inPlot(p) || overDock(p)) return base;
    const k = keepOut(snap(UX(p.x), step), snap(UY(p.y), step));
    return { ...base, charges: [...base.charges, { id: nextId(), ...k, q: sign * qStep }] };
  });

  /* Drag messages describe the committed result. */
  const onCommitted = useRef<FState>(base);
  useEffect(() => {
    const prev = onCommitted.current; onCommitted.current = base;
    if (prev === base || ed.moves === 0) return;
    let say = "";
    if (base.charges.length > prev.charges.length) say = `Added charge ${describeQ(base.charges[base.charges.length - 1])}.`;
    else if (base.charges.length < prev.charges.length) say = `Removed charge ${prev.charges.find(q => !base.charges.some(z => z.id === q.id))?.id}.`;
    else {
      const moved = base.charges.find((q, i) => prev.charges[i] && (q.x !== prev.charges[i].x || q.y !== prev.charges[i].y));
      const changed = base.charges.find((q, i) => prev.charges[i] && q.q !== prev.charges[i].q);
      if (changed) say = `Charge ${changed.id} is now ${describeQ(changed).slice(2)}.`;
      else if (moved) say = `Moved ${moved.id} to (${fmt(moved.x, 1)}, ${fmt(moved.y, 1)}) ${lu}.`;
      else if (base.probe && (!prev.probe || base.probe.x !== prev.probe.x || base.probe.y !== prev.probe.y)) say = `Test charge at (${fmt(base.probe.x, 1)}, ${fmt(base.probe.y, 1)}) ${lu}.`;
      else if (!base.probe && prev.probe) say = "Test charge back in its dock.";
    }
    if (say) { setMsg(say); setLast(say); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { if (ed.unchanged) setMsg("Dropped where it started: nothing changed."); }, [ed.unchanged, ed.moves]);

  /* ---- keyboard and buttons ---- */
  const nudgeQ = (id: string, dx: number, dy: number) => {
    const q = base.charges.find(z => z.id === id)!; const k = keepOut(+(q.x + dx).toFixed(3), +(q.y + dy).toFixed(3));
    commit({ ...base, charges: base.charges.map(z => z.id === id ? { ...z, ...k } : z) }, `Moved ${id} to (${fmt(k.x, 1)}, ${fmt(k.y, 1)}) ${lu}.`);
  };
  const setQ = (id: string, q: number) => {
    const z = base.charges.find(t => t.id === id)!; const v = clamp(Math.abs(q), qStep, qMax) * Math.sign(q || z.q);
    commit({ ...base, charges: base.charges.map(t => t.id === id ? { ...t, q: +v.toFixed(3) } : t) }, `Charge ${id} is now ${v > 0 ? "+" : "−"}${fmt(Math.abs(v), qStep < 1 ? 1 : 0)} ${cu}.`);
  };
  const qKeys = (q: Q) => ({
    onKeyDown: (e: React.KeyboardEvent) => keyStep(e, {
      left: () => nudgeQ(q.id, -step * 2, 0), right: () => nudgeQ(q.id, step * 2, 0), up: () => nudgeQ(q.id, 0, step * 2), down: () => nudgeQ(q.id, 0, -step * 2),
      plus: () => setQ(q.id, Math.sign(q.q) * (Math.abs(q.q) + qStep)), minus: () => setQ(q.id, Math.sign(q.q) * (Math.abs(q.q) - qStep)), flip: () => setQ(q.id, -q.q),
    }),
  });
  const placeProbe = (p: Pt | null) => commit({ ...base, probe: p }, p ? `Test charge at (${fmt(p.x, 1)}, ${fmt(p.y, 1)}) ${lu}.` : "Test charge back in its dock.");
  const nudgeProbe = (dx: number, dy: number) => { const p = base.probe ?? { x: 0, y: 0 }; placeProbe({ x: +clamp(p.x + dx, -vw / 2, vw / 2).toFixed(3), y: +clamp(p.y + dy, -vh / 2, vh / 2).toFixed(3) }); };
  const probeKeys = { onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && !base.probe) { e.preventDefault(); placeProbe({ x: 0, y: snap(vh / 4, step) }); return; } keyStep(e, { left: () => nudgeProbe(-step, 0), right: () => nudgeProbe(step, 0), up: () => nudgeProbe(0, step), down: () => nudgeProbe(0, -step) }); } };
  const addCharge = (sign: 1 | -1) => { if (!canAdd) return; const k = keepOut(0, snap(-vh / 4, step)); const q = { id: nextId(), ...k, q: sign * qStep }; commit({ ...base, charges: [...base.charges, q] }, `Added charge ${describeQ(q)}.`); };
  const removeCharge = (id: string) => commit({ ...base, charges: base.charges.filter(q => q.id !== id) }, `Removed charge ${id}.`);

  /* ---- readout ---- */
  /* The acceptance window is tolerant (a few % of the view), so the text reports the computed null and the probe's own E. */
  const nearestNull = (p: Pt) => nulls.reduce<Pt | null>((b, n) => !b || Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? n : b, null);
  const nullMain = (p: Pt, pr: Probe, nn: Pt | null) => `You found the vicinity of the null. ${nn ? `At the computed null, (${fmt(nn.x, 2)}, ${fmt(nn.y, 2)}) ${lu}, E = 0.` : "The pushes nearly cancel here."} At your probe, (${fmt(p.x, 2)}, ${fmt(p.y, 2)}) ${lu}, E = ${sci(pr.si)} N/C, pointing ${direction(pr.e)}.`;
  const nullHere = probe && s.probe ? nullNear(s, s.probe, probe) : false;
  const lines = field.lines;
  const sumPos = s.charges.reduce((a, q) => a + Math.max(0, q.q), 0), sumNeg = s.charges.reduce((a, q) => a + Math.max(0, -q.q), 0);
  const dropsNow = drops.length >= 2 ? (() => {
    const sorted = [...drops].sort((a, b) => a.r - b.r), a = sorted[0], b = sorted[sorted.length - 1];
    return { ratioR: b.r / a.r, ratioE: a.mag / b.mag };
  })() : null;
  let main: string, why: string, tone = "info";
  if (probe && s.probe) {
    if (probe.inside) { main = `Inside the conductor: E = 0 at (${fmt(s.probe.x, 1)}, ${fmt(s.probe.y, 1)}) ${lu}.`; why = "Charges in the metal move until the field inside cancels. Induced charge on the surface (shown by the lines that end on it) does the cancelling, whatever the outside charges do."; tone = "ok"; }
    else if (nullHere) { main = nullMain(s.probe, probe, nearestNull(s.probe)); why = "Where E = 0 there is no direction to follow, so that is the only kind of place lines can meet away from the charges themselves (where the field is singular). At a regular point where E ≠ 0 the field has a unique direction, so two lines through it would need two directions at once."; tone = "ok"; }
    else {
      main = `At (${fmt(s.probe.x, 1)}, ${fmt(s.probe.y, 1)}) ${lu}: E = ${sci(probe.si)} N/C, pointing ${direction(probe.e)}. Force on +${TEST_Q} ${cu}: ${sci(probe.si * TEST_Q * (cu === "nC" ? 1e-9 : 1e-6))} N.`;
      why = probe.parts.length > 1
        ? "Each charge pushes on the test charge (dashed arrows, to scale with each other). They add as vectors into one arrow. A field line just follows that one arrow, so lines can't split or cross."
        : "One charge, one arrow. Move the test charge twice as far away and the field drops to a quarter.";
      if (dropsNow && found.has("inverseSquare")) why = `You compared two distances: ${fmt(dropsNow.ratioR, 2)}× farther gave a field ${fmt(dropsNow.ratioE, 2)}× weaker; (${fmt(dropsNow.ratioR, 2)})² = ${fmt(dropsNow.ratioR ** 2, 2)}. That is the inverse square law.`;
    }
  } else {
    const fromQ = lines.filter(l => l.from >= 0).length, fromMetal = lines.filter(l => l.from === -2).length, lpu = c.linesPerUnit ?? 6;
    main = `${s.charges.length} charge${s.charges.length === 1 ? "" : "s"}: ${fromQ} field line${fromQ === 1 ? "" : "s"} from the charge${s.charges.length === 1 ? "" : "s"} (${lpu} per ${cu})${cond ? `, plus ${fromMetal} leaving the far side of the metal` : ""}.`;
    const onMetal = lines.filter(l => l.from >= 0 && l.to === "conductor").length;
    why = cond && onMetal === 0 ? "None of the lines drawn from here reach the metal; drag the charge closer. The metal still carries induced charge, and inside it there is no field."
      : cond ? `${onMetal === fromQ ? "Lines" : `${onMetal} of the ${fromQ} lines`} from the charge${s.charges.length === 1 ? "" : "s"} end on the negative charge induced on the near side of the metal; an equal positive charge on the far side sends ${fromMetal === 1 ? "a line" : "lines"} on outward. Inside the metal there are none.`
      : sumPos && sumNeg ? "Lines start on + charges and end on − charges. Drop the test charge anywhere, even where two lines look about to cross."
      : s.charges.length === 1 ? "With one charge the lines run straight out to infinity in every direction."
      : "All the charges have one sign, so the lines run off to infinity. Look between the charges: is there a point where the lines turn away from each other?";
  }

  /* ---- test hook ---- */
  useTestApi(() => ({
    snapshot: () => ({
      mode: "field", title: c.title, charges: ed.state.charges, live: ed.live?.charges ?? null, probe: ed.state.probe, liveProbe: ed.live ? ed.live.probe : undefined,
      probeE: probe ? { si: probe.si, mag: probe.mag, inside: probe.inside, parts: probe.parts.length } : null, nulls: field.nulls, lines: lines.length,
      lineEnds: lines.map(l => l.to), found: [...found], moves: ed.moves, msg, perf: { ...perf.current }, dragging, W,
    }),
    point: (x, y) => svgToClient(svg.current, X(x), Y(y)),
    handles: () => handleCentres(root.current),
  }));

  const committedGhost = dragging?.startsWith("charge") ? base.charges.find(q => `charge ${q.id}` === dragging) : null;
  const shareIt = () => {
    const found2 = [...found].map(f => FINDING_LABEL[f as FieldFinding]);
    const chargeList = base.charges.map(q => `${describeQ(q)} at (${fmt(q.x, 1)}, ${fmt(q.y, 1)})`).join(", ");
    const pb = probeBase;
    let learner: string, reply: string;
    if (base.probe && pb) {
      learner = pb.inside
        ? `I put the test charge inside the conductor and the field there is zero.`
        : `I put the test charge at (${fmt(base.probe.x, 1)}, ${fmt(base.probe.y, 1)}) ${lu}. The field there is ${sci(pb.si)} N/C, pointing ${direction(pb.e)}.`;
      if (pb.inside) reply = "Right: inside a conductor in equilibrium E = 0. If it weren't, the free charges would keep moving. The induced surface charge arranges itself to cancel the outside field everywhere inside, which is why a metal box shields what's in it.";
      else if (nullNear(base, base.probe, pb)) { const nn = nearestNull(base.probe); reply = `You found the vicinity of the null. ${nn ? `At the computed null, (${fmt(nn.x, 2)}, ${fmt(nn.y, 2)}) ${lu}, E = 0.` : "The pushes nearly cancel here."} At your probe E = ${sci(pb.si)} N/C, pointing ${direction(pb.e)}. A null is the one place away from the charges where field lines can meet, because there's no direction to follow there. At a regular point where E ≠ 0 the field has a unique direction, so a line through it has only one way to go; two lines crossing would need two directions at one point.`; }
      else reply = `At your point the charges push in ${pb.parts.length > 1 ? "different directions, but the pushes add up to one arrow" : "one direction"}: ${sci(pb.si)} N/C, ${direction(pb.e)}. A field line is drawn so it always follows that arrow. Since every point has exactly one arrow, two lines can't pass through it in different directions. That's why they never cross${pb.parts.length > 1 ? ". Try making two charges the same sign and looking between them for a point with no arrow at all" : ""}.`;
    } else {
      learner = ed.unchanged && ed.moves <= 1 ? "I picked up a charge and put it back where it was." : `I arranged the charges: ${chargeList}. I haven't placed the test charge yet.`;
      reply = ed.unchanged && ed.moves <= 1 ? "Nothing changed, so the lines are as they started. Drag a charge or drop the test charge between two lines, then share again." : `With ${chargeList}, the lines rearranged but never crossed. Drop the test charge between two lines to see why: there's one arrow at every point.`;
    }
    if (found2.length) learner += ` I found: ${found2.join("; ")}.`;
    onShare?.({ learner, reply, data: `field · ${chargeList}${base.probe && pb ? ` · probe (${fmt(base.probe.x, 2)}, ${fmt(base.probe.y, 2)}) ${lu}, E = ${sci(pb.si)} N/C` : " · no probe"} · found ${found.size}/${findings.length}` });
  };

  const arrowScale = probe && probe.mag > 0 ? Math.min(78 / probe.mag, 104 / Math.max(...probe.parts.map(q => Math.hypot(q.e.x, q.e.y)), 1e-12)) : 0;
  const probeXY = s.probe ? { x: X(s.probe.x), y: Y(s.probe.y) } : null;
  const svgH = PH;
  const ticks = (() => { const out: number[] = []; const st = vw >= 12 ? 2 : 1; for (let v = Math.ceil(-vw / 2 / st) * st; v <= vw / 2; v += st) out.push(v); return out; })();

  return <Shell title={c.title} goal={c.goal} dragging={dragging} mode="field" note="Charges in a plane, Coulomb fields">
    <div className="pl-canvas" ref={wrap}>
      <div className="pl-stage" ref={root} style={{ height: svgH }}>
        <canvas ref={canvas} className="pl-layer" style={{ left: ox, width: PW, height: PH }} aria-hidden="true" />
        <svg ref={svg} width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="group" aria-label={`Electric field of ${s.charges.length} charges`}>
          <rect x={ox} y={0} width={PW} height={PH} className="pl-frame" />
          {ticks.filter(v => X(v) > ox + 30).map(v => <text key={v} x={X(v)} y={PH - 4} className="pl-tick" textAnchor="middle">{fmt(v, 0)}</text>)}
          <text x={ox + 6} y={PH - 4} className="pl-tick pl-unit">{lu}</text>
          {cond && <g className="pl-conductor"><circle cx={X(cond.x)} cy={Y(cond.y)} r={cond.r * ppu} /><text x={X(cond.x)} y={Y(cond.y) + 4} textAnchor="middle">{cond.grounded ? "grounded metal" : "metal"}</text></g>}
          {found.has("nullPoint") && field.nulls.map((n, i) => <g key={i} className="pl-null" transform={`translate(${X(n.x)} ${Y(n.y)})`}><path d="M-4 -4 L4 4 M-4 4 L4 -4" /><text y={18} textAnchor="middle">E = 0</text></g>)}
          {committedGhost && <circle className="pl-ghost" cx={X(committedGhost.x)} cy={Y(committedGhost.y)} r={11} />}
          {/* dock */}
          <circle data-zone="dock" cx={dockX - 24} cy={dockY} r={2} className="pl-hit" />
          {(canAdd || dragging) && <g className="pl-dock">
            <text x={dockX - 24} y={dockY + 30} textAnchor="middle">{dragging?.startsWith("charge") && s.charges.length > 1 ? "drop to remove" : canAdd ? "drag in" : ""}</text>
            {canAdd && ([1, -1] as const).map((sg, i) => <g key={sg} {...addMove(sg)} tabIndex={0} role="button" aria-label={`Add a ${sg > 0 ? "positive" : "negative"} charge`} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addCharge(sg); } }} transform={`translate(${dockX - 36 + i * 24} ${dockY})`}>
              <circle className="pl-hit" r={13} /><circle className={sg > 0 ? "pl-dock-q pl-pos" : "pl-dock-q pl-neg"} r={9} /><text y={4} textAnchor="middle">{sg > 0 ? "+" : "−"}</text>
            </g>)}
          </g>}
          {/* test charge contributions and net arrow */}
          {probe && probeXY && !probe.inside && probe.mag > 0 && <g className="pl-arrows">
            {probe.parts.length > 1 && probe.parts.map(p => <line key={p.label} className="pl-part" x1={probeXY.x} y1={probeXY.y} x2={probeXY.x + p.e.x * arrowScale} y2={probeXY.y - p.e.y * arrowScale} markerEnd="url(#pl-head-part)" />)}
            <line className="pl-net" x1={probeXY.x} y1={probeXY.y} x2={probeXY.x + probe.e.x * arrowScale} y2={probeXY.y - probe.e.y * arrowScale} markerEnd="url(#pl-head)" />
          </g>}
          <defs>
            <marker id="pl-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="pl-head" /></marker>
            <marker id="pl-head-part" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="pl-head-part" /></marker>
          </defs>
          {[...base.charges.map(q => s.charges.find(z => z.id === q.id) ?? q), ...s.charges.filter(z => !base.charges.some(b => b.id === z.id))].map(q => {
            const cx = X(q.x), cy = Y(q.y), sg = q.q > 0 ? 1 : -1, hl = HR + Math.abs(q.q) * HS;
            const hx = cx + hdir.x * hl * sg, hy = cy + hdir.y * hl * sg;
            const removing = dragging === `charge ${q.id}` && !ed.view.charges.some(z => z.id === q.id);
            return <g key={q.id} className={`pl-charge${removing ? " is-removing" : ""}`}>
              <line className="pl-stem" x1={cx} y1={cy} x2={hx} y2={hy} />
              {Array.from({ length: Math.round(Math.abs(q.q) / qStep) }, (_, i) => { const t = HR + (i + 1) * qStep * HS; return <circle key={i} className="pl-stem-tick" cx={cx + hdir.x * t * sg} cy={cy + hdir.y * t * sg} r={1.4} />; })}
              <g {...qMove(q)} {...qKeys(q)} tabIndex={0} role="button" aria-roledescription="draggable charge" aria-label={`Charge ${describeQ(q)} at (${fmt(q.x, 1)}, ${fmt(q.y, 1)}) ${lu}. Arrow keys move it, plus and minus change it, S flips its sign.`}>
                <circle className="pl-hit" cx={cx} cy={cy} r={18} />
                <circle className={sg > 0 ? "pl-q pl-pos" : "pl-q pl-neg"} cx={cx} cy={cy} r={11} />
                <text className="pl-q-sign" x={cx} y={cy + 4.5} textAnchor="middle">{sg > 0 ? "+" : "−"}</text>
              </g>
              <g {...qHandle(q)} className="pl-qhandle" tabIndex={-1} aria-hidden="true">
                <circle className="pl-hit" cx={hx} cy={hy} r={12} />
                <circle className="pl-qknob" cx={hx} cy={hy} r={5} />
              </g>
              <text className="pl-q-label" x={cx + (sg > 0 ? -14 : 14)} y={cy + (sg > 0 ? 22 : -16)} textAnchor="middle">{q.id} {sg > 0 ? "+" : "−"}{fmt(Math.abs(q.q), qStep < 1 ? 1 : 0)}</text>
            </g>;
          })}
          <g {...probeMove} {...probeKeys} className="pl-probe" tabIndex={0} role="button" aria-roledescription="draggable test charge" aria-label={s.probe ? `Test charge at (${fmt(s.probe.x, 1)}, ${fmt(s.probe.y, 1)}) ${lu}. Arrow keys move it.` : "Test charge in its dock. Press Enter to place it, or drag it onto the plane."}>
            {probeXY ? <><circle className="pl-hit" cx={probeXY.x} cy={probeXY.y} r={16} /><circle className="pl-probe-dot" cx={probeXY.x} cy={probeXY.y} r={6} /><text x={probeXY.x + 9} y={probeXY.y - 9}>test +{TEST_Q}</text></>
              : <><circle className="pl-hit" cx={dockX} cy={dockY + 52} r={16} /><circle className="pl-probe-dot pl-docked" cx={dockX} cy={dockY + 52} r={6} /><text x={dockX + 8} y={dockY + 72} textAnchor="end">test charge</text></>}
          </g>
        </svg>
      </div>
    </div>
    <Found items={findings.map(f => ({ id: f, label: FINDING_LABEL[f] }))} found={found} />
    <div className={`pl-readout pl-tone-${tone}`}>
      <p className="pl-line">{main}</p>
      <p className="pl-why">{why}</p>
      <p className="pl-sr" role="status">{msg || last}</p>
    </div>
    <div className="pl-toggles">
      <button type="button" className="pl-toggle" aria-pressed={show.lines} onClick={() => setShow(v => ({ ...v, lines: !v.lines }))}>{show.lines ? "Hide" : "Show"} field lines</button>
      <button type="button" className="pl-toggle" aria-pressed={show.equi} onClick={() => setShow(v => ({ ...v, equi: !v.equi }))}>{show.equi ? "Hide" : "Show"} equipotentials</button>
      <button type="button" className="pl-toggle" aria-pressed={show.map} onClick={() => setShow(v => ({ ...v, map: !v.map }))}>{show.map ? "Hide" : "Show"} potential shading</button>
    </div>
    <Disclosure label="Use buttons instead">
      <div className="pl-rows">
        {base.charges.map(q => <div className="pl-row" key={q.id}>
          <span>{describeQ(q)} at ({fmt(q.x, 1)}, {fmt(q.y, 1)}) {lu}</span>
          <span className="pl-row-btns">
            <button type="button" onClick={() => nudgeQ(q.id, -step * 2, 0)} aria-label={`Move ${q.id} left`}>←</button>
            <button type="button" onClick={() => nudgeQ(q.id, 0, step * 2)} aria-label={`Move ${q.id} up`}>↑</button>
            <button type="button" onClick={() => nudgeQ(q.id, 0, -step * 2)} aria-label={`Move ${q.id} down`}>↓</button>
            <button type="button" onClick={() => nudgeQ(q.id, step * 2, 0)} aria-label={`Move ${q.id} right`}>→</button>
            <button type="button" onClick={() => setQ(q.id, Math.sign(q.q) * (Math.abs(q.q) - qStep))} disabled={Math.abs(q.q) <= qStep} aria-label={`Less charge on ${q.id}`}>less</button>
            <button type="button" onClick={() => setQ(q.id, Math.sign(q.q) * (Math.abs(q.q) + qStep))} disabled={Math.abs(q.q) >= qMax} aria-label={`More charge on ${q.id}`}>more</button>
            <button type="button" onClick={() => setQ(q.id, -q.q)}>Flip sign</button>
            {base.charges.length > 1 && !q.locked && <button type="button" onClick={() => removeCharge(q.id)}>Remove</button>}
          </span>
        </div>)}
        <div className="pl-row">
          <span>{base.probe ? `Test charge at (${fmt(base.probe.x, 1)}, ${fmt(base.probe.y, 1)}) ${lu}` : "Test charge in its dock"}</span>
          <span className="pl-row-btns">
            {!base.probe && <button type="button" onClick={() => placeProbe({ x: 0, y: snap(vh / 4, step) })}>Place it</button>}
            {base.probe && <>
              <button type="button" onClick={() => nudgeProbe(-step, 0)} aria-label="Move the test charge left">←</button>
              <button type="button" onClick={() => nudgeProbe(0, step)} aria-label="Move the test charge up">↑</button>
              <button type="button" onClick={() => nudgeProbe(0, -step)} aria-label="Move the test charge down">↓</button>
              <button type="button" onClick={() => nudgeProbe(step, 0)} aria-label="Move the test charge right">→</button>
              {field.nulls.length > 0 && <button type="button" onClick={() => placeProbe({ x: +field.nulls[0].x.toFixed(3), y: +field.nulls[0].y.toFixed(3) })}>Jump to where E is smallest</button>}
              <button type="button" onClick={() => placeProbe(null)}>Back to dock</button>
            </>}
          </span>
        </div>
        {canAdd && <div className="pl-row"><span>Add a charge</span><span className="pl-row-btns"><button type="button" onClick={() => addCharge(1)}>Add +</button><button type="button" onClick={() => addCharge(-1)}>Add −</button></span></div>}
      </div>
    </Disclosure>
    <Disclosure label="How this is drawn">
      <div className="pl-eq">
        <p>E = k Σ qᵢ r̂ᵢ / rᵢ², k = 8.99×10⁹ N·m²/C². Field lines are integrated along E (RK4) from seeds round each charge, {c.linesPerUnit ?? 6} per {cu}; dashed curves are equipotentials at equal steps of V.</p>
        <p>These are 3-D point charges seen in one plane. The number of lines per charge is honest, but in a flat drawing their spacing thins like 1/r rather than 1/r², so read strength from the test charge, not the spacing.{cond ? " The metal is a sphere seen in cross-section, solved exactly by image charges (Griffiths, Electrodynamics §3.2)." : ""} The test charge is assumed too small to move the others.</p>
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={() => { ed.undo(); setMsg("Undid the last move."); }} reset={() => { ed.reset(); setFound(new Set()); setDrops([]); setMsg("Started over."); }} share={onShare ? shareIt : undefined} />
    {reduced && <span hidden data-reduced="true" />}
  </Shell>;
}
