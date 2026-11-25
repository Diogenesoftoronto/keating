import { useEffect, useMemo, useRef, useState } from "react";
import {
  atBoundThreshold, barrierResonance, barrierT, boundStateCount, boundThreshold, CrankNicolson, sameEnergy, eigenstates, forbiddenProbability, gaussianPacket, HB2M, HBAR_T, makeGrid, potentialFn, scatter,
  type Potential,
} from "./physics";
import {
  Actions, clamp, Disclosure, fmt, Found, handleCentres, keyStep, sci, Shell, snap, svgToClient, useDrag, useEditable,
  useReducedMotion, useTestApi, useWidth,
} from "./common";
import type { QuantumConfig, QuantumFinding, ShareSummary } from "./types";

type QState = { potential: Potential; selected: number; energy: number };

const FINDING_LABEL: Record<QuantumFinding, string> = {
  zeroPoint: "the lowest energy isn't the bottom", forbidden: "found where it 'can't' be", evenSpacing: "evenly spaced ladder",
  splitting: "two wells, split levels", tunnels: "gets through with E < V", exponential: "wider barrier, exponentially less",
  reflectsAbove: "bounces back with E > V", resonance: "a barrier it passes completely",
};
const GRID_N = 420;

export function boundModel(c: QuantumConfig, s: QState) {
  const g = makeGrid(s.potential, c.units, c.domain, GRID_N);
  const count = Math.min(12, c.states ?? 6);
  const eig = eigenstates(g, count);
  /* Keep only states that fit on the energy axis, and for potentials that flatten out, only bound ones. */
  const edge = s.potential.kind === "finiteSquare" ? 0 : s.potential.kind === "points" ? Math.min(s.potential.points[0][1], s.potential.points[s.potential.points.length - 1][1]) : Infinity;
  const keep = eig.energies.map((E, i) => i).filter(i => eig.energies[i] < c.energyRange[1] && eig.energies[i] < edge);
  return { g, energies: keep.map(i => eig.energies[i]), states: keep.map(i => eig.states[i]), edge };
}
export function tunnelModel(c: QuantumConfig, s: QState) {
  const p = s.potential, V = potentialFn(p, c.units);
  let x0: number, x1: number;
  if (p.kind === "barrier") { x0 = p.left; x1 = p.right; } else if (p.kind === "points") { x0 = p.points[0][0]; x1 = p.points[p.points.length - 1][0]; } else { x0 = c.domain[0]; x1 = c.domain[1]; }
  const sc = scatter(V, s.energy, x0, x1, p.kind === "barrier" ? 1 : 240, c.units);
  const T = p.kind === "barrier" ? barrierT(s.energy, p.height, p.right - p.left, c.units) : sc.T;
  return { V, sc, T, x0, x1 };
}
const potLabel = (p: Potential, eu: string, lu: string) => {
  switch (p.kind) {
    case "infinite": return `infinite well, L = ${fmt(p.right - p.left, 2)} ${lu}`;
    case "finiteSquare": return `finite well, width ${fmt(p.right - p.left, 2)} ${lu}, depth ${fmt(p.depth, 2)} ${eu}`;
    case "harmonic": return `harmonic well, ℏω = ${fmt(p.hw, 3)} ${eu}`;
    case "doubleWell": return `double well, barrier ${fmt(p.barrier, 2)} ${eu}, minima ±${fmt(p.separation, 2)} ${lu}`;
    case "barrier": return `barrier ${fmt(p.height, 2)} ${eu} high, ${fmt(p.right - p.left, 2)} ${lu} wide`;
    case "points": return `potential through ${p.points.length} points`;
  }
};

export function QuantumLab({ config: c, onChange, onShare }: { config: QuantumConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const initial = useMemo<QState>(() => ({ potential: JSON.parse(JSON.stringify(c.potential)), selected: Math.max(0, (c.selected ?? 1) - 1), energy: c.energy?.value ?? 0 }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), root = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const reduced = useReducedMotion();
  const [msg, setMsg] = useState("");
  const [mix, setMix] = useState(false);
  const [phase, setPhase] = useState(0);
  const [packet, setPacket] = useState<{ x: Float64Array; p: Float64Array; done: boolean; trans: number; T: number; Tavg: number } | null>(null);
  const tunnel = c.view === "tunnel";
  const findings = c.findings ?? (tunnel ? ["tunnels", "exponential", "reflectsAbove"] : ["zeroPoint", "forbidden"]) as QuantumFinding[];
  const [found, setFound] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<{ a: number; T: number; kappa: number }[]>([]);
  const perf = useRef({ recomputes: 0, ms: 0, maxMs: 0 });

  const s = ed.view, base = ed.state;
  const narrow = W < 460;
  const eu = c.units === "electron" ? "eV" : "", lu = c.units === "electron" ? "nm" : "", tu = c.units === "electron" ? "fs" : "";
  const sp = (u: string) => (u ? " " + u : "");
  const [d0, d1] = c.domain, [e0, e1] = c.energyRange;
  const padL = narrow ? 34 : 44, padR = 10, padT = 10, PH = narrow ? 250 : 300;
  const X = (x: number) => padL + ((x - d0) / (d1 - d0)) * (W - padL - padR);
  const UX = (px: number) => d0 + ((px - padL) / (W - padL - padR)) * (d1 - d0);
  const Y = (E: number) => padT + (1 - (E - e0) / (e1 - e0)) * (PH - padT - 8);
  const UE = (py: number) => e0 + (1 - (py - padT) / (PH - padT - 8)) * (e1 - e0);
  const xs = (d1 - d0) / 200, es = (e1 - e0) / 200;
  const xq = (v: number) => +snap(v, xs).toFixed(4), eq = (v: number) => +snap(v, es).toFixed(4);

  const bound = useMemo(() => {
    if (tunnel) return null;
    const t0 = performance.now(); const m = boundModel(c, s);
    const ms = performance.now() - t0; perf.current.recomputes++; perf.current.ms += ms; perf.current.maxMs = Math.max(perf.current.maxMs, ms);
    return m;
  }, [c, s, tunnel]);
  const tun = useMemo(() => {
    if (!tunnel) return null;
    const t0 = performance.now(); const m = tunnelModel(c, s);
    const ms = performance.now() - t0; perf.current.recomputes++; perf.current.ms += ms; perf.current.maxMs = Math.max(perf.current.maxMs, ms);
    return m;
  }, [c, s, tunnel]);
  const V = useMemo(() => potentialFn(s.potential, c.units), [s.potential, c.units]);
  const sel = bound ? clamp(s.selected, 0, Math.max(0, bound.energies.length - 1)) : 0;

  /* ---- superposition animation ---- */
  const dE = bound && bound.energies.length > sel + 1 ? bound.energies[sel + 1] - bound.energies[sel] : NaN;
  const period = (2 * Math.PI * HBAR_T[c.units]) / dE;
  useEffect(() => {
    if (!mix || reduced || !Number.isFinite(period)) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { setPhase((((t - t0) / 1000) * 2 * Math.PI) / 2.4); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mix, reduced, period]);

  /* ---- wave packet (Crank–Nicolson) ---- */
  const runRef = useRef(0);
  const sendPacket = () => {
    const g = makeGrid(base.potential, c.units, c.domain, 900);
    const span = d1 - d0, sigma = span / 16, x0 = d0 + span * 0.25, k0 = Math.sqrt(Math.max(base.energy, 1e-6) / HB2M[c.units]);
    const pk = gaussianPacket(g, x0, sigma, k0);
    const v = (2 * HB2M[c.units] * k0) / HBAR_T[c.units];               // group velocity ℏk/m = 2(ℏ²/2m)k/ℏ
    const tEnd = (span * 0.55) / v, steps = 1200, dt = tEnd / steps;
    const cn = new CrankNicolson(g, dt, c.units, pk.re, pk.im);
    const { x1 } = tunnelModel(c, base), T = tunnelModel(c, base).T;
    /* The packet carries a spread of wavenumbers: |φ(k)|² ∝ exp(−(k − k0)²/(2σk²)), σk = 1/(2σ). Its expected
       transmission is T averaged over that spread (Griffiths QM §2.4 for packets; T from the exact barrier formula). */
    const sk = 1 / (2 * sigma);
    let wsum = 0, tsum = 0;
    for (let i = 0; i <= 400; i++) {
      /* Normalise over the whole packet: its k ≤ 0 part moves away and counts as not transmitted, so Tavg is the
         predicted probability beyond the barrier for the same normalised packet the simulation measures. */
      const k = k0 + (i / 200 - 1) * 5 * sk, w = Math.exp(-((k - k0) ** 2) / (2 * sk * sk));
      wsum += w; if (k <= 0) continue;
      tsum += w * tunnelModel(c, { ...base, energy: HB2M[c.units] * k * k }).T;
    }
    const Tavg = tsum / wsum;
    const id = ++runRef.current;
    const frame = () => {
      const p = new Float64Array(g.x.length); for (let i = 0; i < p.length; i++) p[i] = cn.re[i] ** 2 + cn.im[i] ** 2;
      return p;
    };
    if (reduced) { for (let i = 0; i < steps; i++) cn.step(); setPacket({ x: g.x, p: frame(), done: true, trans: cn.norm(x1), T, Tavg }); setMsg(`Packet sent: ${fmt(cn.norm(x1) * 100, 1)}% of its probability is beyond the barrier at the end of the simulation.`); return; }
    let n = 0;
    const tick = () => {
      if (id !== runRef.current) return;
      for (let i = 0; i < 16 && n < steps; i++, n++) cn.step();
      const done = n >= steps;
      setPacket({ x: g.x, p: frame(), done, trans: cn.norm(x1), T, Tavg });
      if (done) setMsg(`Packet run finished: ${fmt(cn.norm(x1) * 100, 1)}% of its probability is beyond the barrier; T averaged over its wavenumbers predicts ${fmt(Tavg * 100, 1)}%.`);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  useEffect(() => { runRef.current++; setPacket(null); }, [base]);
  useEffect(() => () => { runRef.current++; }, []);

  /* ---- findings ---- */
  const baseBound = useMemo(() => (tunnel ? null : boundModel(c, base)), [c, base, tunnel]);
  const baseTun = useMemo(() => (tunnel ? tunnelModel(c, base) : null), [c, base, tunnel]);
  const bands = (() => {
    const p = s.potential;
    if (p.kind !== "finiteSquare" || !c.depthAxis) return null;
    const w = p.right - p.left, cuts: number[] = [];
    for (let n = 1; n < 12; n++) { const t = boundThreshold(n, w, c.units); if (t >= c.depthAxis.max) break; cuts.push(t); }
    return { w, cuts, count: boundStateCount(w, p.depth, c.units) };
  })();
  const bandItems = bands ? Array.from({ length: bands.cuts.length + 1 }, (_, i) => ({ id: `b${i + 1}`, label: `${i + 1} bound state${i ? "s" : ""}` })) : [];
  useEffect(() => {
    const add: string[] = [];
    if (baseBound) {
      const si = clamp(base.selected, 0, baseBound.energies.length - 1), E = baseBound.energies[si];
      if (E !== undefined) {
        let vmin = Infinity; for (const v of baseBound.g.v) vmin = Math.min(vmin, v);
        if (si === 0 && E > vmin) add.push("zeroPoint");
        if (base.potential.kind !== "infinite" && forbiddenProbability(baseBound.g, baseBound.states[si], E) > 0.02) add.push("forbidden");
        if (base.potential.kind === "harmonic" && si >= 2) add.push("evenSpacing");
        const en = baseBound.energies;
        if (base.potential.kind === "doubleWell" && en.length >= 3 && si <= 1 && en[1] - en[0] < 0.25 * (en[2] - en[1])) add.push("splitting");
      }
      const p = base.potential;
      if (p.kind === "finiteSquare" && c.depthAxis) add.push(`b${boundStateCount(p.right - p.left, p.depth, c.units)}`);
    }
    if (baseTun && base.potential.kind === "barrier") {
      const p = base.potential, E = base.energy, a = p.right - p.left, T = baseTun.T;
      const eq = sameEnergy(E, p.height);
      if (!eq && E < p.height && T > 1e-5) add.push("tunnels");
      if (!eq && E > p.height && T < 0.97) add.push("reflectsAbove");
      /* Only a true over-barrier resonance, k′a ≈ nπ with n ≥ 1: a vanishingly thin barrier also gives T → 1. */
      if (!eq && T > 0.995 && barrierResonance(E, p.height, a, c.units)) add.push("resonance");
      if (!eq && E < p.height) {
        const kappa = Math.sqrt((p.height - E) / HB2M[c.units]);
        const next = [...widths.filter(w => Math.abs(w.kappa - kappa) < 1e-9 && w.a !== a), { a, T, kappa }].slice(-6);
        setWidths(next);
        const as = next.map(w => w.a);
        if (next.length >= 2 && Math.max(...as) - Math.min(...as) >= 0.5 / kappa) add.push("exponential");
      }
    }
    if (ed.moves === 0 && !add.some(a => a.startsWith("b"))) return;
    const allowed = (a: string) => findings.includes(a as QuantumFinding) || a.startsWith("b");
    setFound(f => { const n = new Set(f); add.filter(allowed).filter(a => ed.moves > 0 || a.startsWith("b")).forEach(a => n.add(a)); return n.size === f.size ? f : n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { if (ed.unchanged) setMsg("Dropped where it started: nothing changed."); }, [ed.unchanged, ed.moves]);

  /* ---- handles ---- */
  const setPot = (st: QState, p: Potential): QState => ({ ...st, potential: p });
  const minWidth = (d1 - d0) * 0.04;
  const handles: { id: string; x: number; y: number; axis: "x" | "y" | "xy"; label: string; move: (px: number, py: number) => QState; keys: (dir: number, vertical: boolean) => QState }[] = [];
  const bp = base.potential;
  if (bp.kind === "infinite" || bp.kind === "finiteSquare" || bp.kind === "barrier") {
    const yMid = bp.kind === "infinite" ? (e0 + e1) / 2 : bp.kind === "finiteSquare" ? -bp.depth / 2 : bp.height / 2;
    const vp = s.potential as typeof bp;
    const L = (st: QState, v: number): QState => { const p = st.potential as typeof bp; return setPot(st, { ...p, left: xq(clamp(v, d0, p.right - minWidth)) } as Potential); };
    const R = (st: QState, v: number): QState => { const p = st.potential as typeof bp; return setPot(st, { ...p, right: xq(clamp(v, p.left + minWidth, d1)) } as Potential); };
    handles.push({ id: "left wall", x: X(vp.left), y: Y(yMid), axis: "x", label: `Left edge at ${fmt(vp.left, 2)}${sp(lu)}`, move: px => L(base, UX(px)), keys: dir => L(base, bp.left + dir * xs * 5) });
    handles.push({ id: "right wall", x: X(vp.right), y: Y(yMid), axis: "x", label: `Right edge at ${fmt(vp.right, 2)}${sp(lu)}`, move: px => R(base, UX(px)), keys: dir => R(base, bp.right + dir * xs * 5) });
    if (bp.kind === "finiteSquare") {
      const maxD = c.depthAxis?.max ?? -e0;
      const D = (v: number) => setPot(base, { ...bp, depth: eq(clamp(v, es, maxD)) });
      const vd = (s.potential as typeof bp).depth;
      handles.push({ id: "floor", x: X(((s.potential as typeof bp).left + (s.potential as typeof bp).right) / 2), y: Y(-vd), axis: "y", label: `Well depth ${fmt(vd, 2)}${sp(eu)}`, move: (_, py) => D(-UE(py)), keys: dir => D(bp.depth + dir * es * 5) });
    }
    if (bp.kind === "barrier") {
      const H = (v: number) => setPot(base, { ...bp, height: eq(clamp(v, es, e1)) });
      const vh = (s.potential as typeof bp).height;
      handles.push({ id: "top", x: X(((s.potential as typeof bp).left + (s.potential as typeof bp).right) / 2), y: Y(vh), axis: "y", label: `Barrier height ${fmt(vh, 2)}${sp(eu)}`, move: (_, py) => H(UE(py)), keys: dir => H(bp.height + dir * es * 5) });
    }
  } else if (bp.kind === "harmonic") {
    const c0 = bp.center ?? 0, xh = c0 + (d1 - c0) * 0.55, vp = s.potential as typeof bp;
    const hwOf = (Vh: number) => Math.sqrt((4 * HB2M[c.units] * Math.max(Vh, es)) / ((xh - c0) ** 2));
    const Hh = (hw: number) => setPot(base, { ...bp, hw: +clamp(hw, 0.02 * (e1 - e0), (e1 - e0)).toPrecision(4) });
    const Vh = (vp.hw * vp.hw * (xh - c0) ** 2) / (4 * HB2M[c.units]);
    handles.push({ id: "curvature", x: X(xh), y: Y(Math.min(Vh, e1)), axis: "y", label: `Well stiffness: ℏω = ${fmt(vp.hw, 3)}${sp(eu)}`, move: (_, py) => Hh(hwOf(UE(py))), keys: dir => Hh(bp.hw * (1 + dir * 0.05)) });
  } else if (bp.kind === "doubleWell") {
    const c0 = bp.center ?? 0, vp = s.potential as typeof bp;
    const B = (v: number) => setPot(base, { ...bp, barrier: eq(clamp(v, es, e1)) });
    const S = (v: number) => setPot(base, { ...bp, separation: xq(clamp(v, (d1 - d0) * 0.03, (d1 - c0) * 0.8)) });
    handles.push({ id: "barrier top", x: X(c0), y: Y(Math.min(vp.barrier, e1)), axis: "y", label: `Barrier ${fmt(vp.barrier, 2)}${sp(eu)}`, move: (_, py) => B(UE(py)), keys: dir => B(bp.barrier + dir * es * 5) });
    handles.push({ id: "minimum", x: X(c0 + vp.separation), y: Y(0), axis: "x", label: `Minima at ±${fmt(vp.separation, 2)}${sp(lu)}`, move: px => S(UX(px) - c0), keys: dir => S(bp.separation + dir * xs * 4) });
  } else if (bp.kind === "points") {
    const vp = s.potential as typeof bp;
    vp.points.forEach(([px0, pv], i) => {
      const P = (x: number, v: number) => {
        const pts = bp.points.map(q => [...q] as [number, number]);
        const lo = i > 0 ? pts[i - 1][0] + xs : d0, hi = i < pts.length - 1 ? pts[i + 1][0] - xs : d1;
        pts[i] = [xq(clamp(x, lo, hi)), eq(clamp(v, e0, e1))];
        return setPot(base, { kind: "points", points: pts });
      };
      handles.push({ id: `point ${i + 1}`, x: X(px0), y: Y(clamp(pv, e0, e1)), axis: "xy", label: `Point ${i + 1} at x ${fmt(px0, 2)}, V ${fmt(pv, 2)}`, move: (px, py) => P(UX(px), UE(py)), keys: (dir, vert) => vert ? P(bp.points[i][0], bp.points[i][1] + dir * es * 5) : P(bp.points[i][0] + dir * xs * 4, bp.points[i][1]) });
    });
  }
  const energyHandle = tunnel ? { id: "energy", label: `Particle energy ${fmt(s.energy, 3)}${sp(eu)}` } : null;
  const setE = (v: number) => ({ ...base, energy: eq(clamp(v, c.energy?.min ?? es, c.energy?.max ?? e1)) });

  /* ---- readout ---- */
  const levels = bound?.energies ?? [];
  const psiScale = (() => {
    if (!bound || !levels.length) return 1;
    let gap = levels.length > 1 ? Infinity : (e1 - e0) * 0.3;
    for (let i = 1; i < levels.length; i++) gap = Math.min(gap, levels[i] - levels[i - 1]);
    if (levels.length > 1 && gap < (e1 - e0) * 0.04) gap = (e1 - e0) * 0.12;   // near-degenerate pairs: don't flatten everything
    let mx = 0; for (const st of bound.states) for (const v of st) mx = Math.max(mx, v * v);
    return (0.85 * gap) / (mx || 1);
  })();
  const vmin = bound ? Math.min(...Array.from(bound.g.v)) : 0;
  let main = "", why = "", tone = "info";
  if (bound) {
    const E = levels[sel];
    if (E === undefined) { main = "No bound state fits on this energy axis."; why = "Make the well deeper or wider."; }
    else {
      const pf = forbiddenProbability(bound.g, bound.states[sel], E);
      main = `Level ${sel + 1} of ${levels.length}: E${sub(sel + 1)} = ${fmt(E, 3)}${sp(eu)}${bp.kind === "infinite" ? ` (n²π²ℏ²/2mL² gives ${fmt((sel + 1) ** 2 * Math.PI ** 2 * HB2M[c.units] / ((bp.right - bp.left) ** 2), 3)})` : ""}${bp.kind === "harmonic" ? ` = ${fmt(E / bp.hw, 3)} ℏω` : ""}.${s.potential.kind !== "infinite" ? ` ${fmt(pf * 100, 1)}% of the probability lies where V > E.` : ""}`;
      if (bands) why = bandsText(bands, (s.potential as { depth: number }).depth, levels.length, c.units, eu, lu);
      else if (bp.kind === "harmonic") why = `Gaps between levels: ${levels.slice(1).map((e, i) => fmt(e - levels[i], 3)).join(", ")}${sp(eu)}. All equal to ℏω, and the lowest sits ½ℏω above the bottom.`;
      else if (bp.kind === "doubleWell" && levels.length >= 3) why = `The lowest two levels are ${fmt(levels[1] - levels[0], 3)}${sp(eu)} apart (the next gap is ${fmt(levels[2] - levels[1], 3)}): each is a mix of 'left well' and 'right well'. A higher barrier pushes them closer together.`;
      else if (sel === 0) why = `Even the lowest state sits ${fmt(E - vmin, 3)}${sp(eu)} above the bottom of the well: confining a wave costs kinetic energy.`;
      else why = `The state has ${sel} node${sel === 1 ? "" : "s"}. Each level up adds one, and the energy rises.`;
      if (pf > 0.02 && s.potential.kind !== "infinite") { tone = "ok"; }
      if (mix && Number.isFinite(period)) why = `Superposition of levels ${sel + 1} and ${sel + 2}: |Ψ|² sloshes back and forth with period 2πℏ/ΔE = ${sci(period, 3)}${sp(tu)}. Each level alone is stationary.`;
    }
  }
  if (tun) {
    const p = s.potential, E = s.energy, tx = tunnelText(p, E, tun.T, c.units, lu);
    main = tx.main; why = tx.why;
    if (tx.kappa !== undefined && p.kind === "barrier") {
      const kappa = tx.kappa;
      const ws = widths.length >= 2 ? [...widths].sort((a, b) => a.a - b.a) : null;
      if (ws && found.has("exponential")) { const a = ws[0], b = ws[ws.length - 1]; why += ` You tried ${fmt(a.a, 2)} and ${fmt(b.a, 2)}${sp(lu)}: T fell ${sci(a.T / b.T, 2)}×; e^(2κΔa) = ${sci(Math.exp(2 * kappa * (b.a - a.a)), 2)}.`; }
      tone = tun.T > 1e-5 ? "ok" : "info";
    }
    if (packet?.done) why = packetText(packet);
  }

  useTestApi(() => ({
    snapshot: () => ({
      mode: "quantum", view: c.view, title: c.title, potential: ed.state.potential, livePotential: ed.live?.potential ?? null, selected: ed.state.selected, liveSelected: ed.live?.selected ?? null,
      energies: bound?.energies ?? null, energy: s.energy, T: tun?.T ?? null, bands, found: [...found], moves: ed.moves, msg, perf: { ...perf.current }, dragging, W, mix,
      packet: packet ? { done: packet.done, trans: packet.trans, T: packet.T, Tavg: packet.Tavg } : null,
    }),
    point: (x, y) => svgToClient(svg.current, X(x), Y(y)),
    handles: () => handleCentres(root.current),
  }));

  const commit = (st: QState, say: string) => { ed.commit(st); setMsg(say); };
  const prevRef = useRef(base);
  useEffect(() => {
    const p = prevRef.current; prevRef.current = base;
    if (p === base || ed.moves === 0) return;
    if (p.selected !== base.selected) setMsg(`Selected level ${base.selected + 1}.`);
    else if (p.energy !== base.energy) setMsg(`Energy ${fmt(base.energy, 3)}${sp(eu)}.`);
    else setMsg(`Now a ${potLabel(base.potential, eu, lu)}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  /* ---- paths ---- */
  const Vpath = (() => {
    let d = ""; const n = 360;
    for (let i = 0; i <= n; i++) {
      const x = d0 + ((d1 - d0) * i) / n; let v = V(x);
      if (s.potential.kind === "infinite") v = x <= s.potential.left || x >= s.potential.right ? e1 : 0;
      d += (i ? "L" : "M") + X(x).toFixed(1) + " " + Y(clamp(v, e0, e1)).toFixed(1);
    }
    return d;
  })();
  const Vfill = Vpath + ` L${X(d1).toFixed(1)} ${Y(e0).toFixed(1)} L${X(d0).toFixed(1)} ${Y(e0).toFixed(1)} Z`;
  const statePath = (i: number, mode: "all" | "allowed" | "forbidden") => {
    if (!bound) return "";
    const g = bound.g, st = bound.states[i], E = levels[i];
    let d = "", pen = false;
    for (let k = 0; k < st.length; k += 2) {
      const forb = g.v[k] > E, use = mode === "all" || (mode === "forbidden" ? forb : !forb);
      if (!use) { pen = false; continue; }
      const y = Y(E + st[k] * st[k] * psiScale);
      d += (pen ? "L" : "M") + X(g.x[k]).toFixed(1) + " " + y.toFixed(1); pen = true;
    }
    return d;
  };
  const fillPath = (i: number, forbiddenOnly: boolean) => {
    if (!bound) return "";
    const g = bound.g, st = bound.states[i], E = levels[i];
    let d = "", run: string[] = [];
    const flush = (endX: number) => { if (run.length > 1) d += "M" + run[0].split(" ")[0] + " " + Y(E).toFixed(1) + " L" + run.join(" L") + ` L${endX.toFixed(1)} ${Y(E).toFixed(1)} Z`; run = []; };
    let lastX = 0;
    for (let k = 0; k < st.length; k += 2) {
      const forb = g.v[k] > E;
      if (forbiddenOnly && !forb) { flush(lastX); continue; }
      lastX = X(g.x[k]); run.push(lastX.toFixed(1) + " " + Y(E + st[k] * st[k] * psiScale).toFixed(1));
    }
    flush(lastX);
    return d;
  };
  const mixPath = (() => {
    if (!bound || !mix || !(sel + 1 < levels.length)) return "";
    const g = bound.g, a = bound.states[sel], b = bound.states[sel + 1], Em = (levels[sel] + levels[sel + 1]) / 2;
    let d = "";
    for (let k = 0; k < a.length; k += 2) { const p = 0.5 * (a[k] ** 2 + b[k] ** 2 + 2 * a[k] * b[k] * Math.cos(phase)); d += (k ? "L" : "M") + X(g.x[k]).toFixed(1) + " " + Y(Em + p * psiScale).toFixed(1); }
    return d;
  })();
  const tunPath = (() => {
    if (!tun) return "";
    const n = 500, vals: number[] = []; let mx = 0;
    for (let i = 0; i <= n; i++) { const v = tun.sc.psi2(d0 + ((d1 - d0) * i) / n); vals.push(v); mx = Math.max(mx, Math.min(v, 6)); }
    const A = (0.22 * (e1 - e0)) / Math.max(mx, 1);
    return vals.map((v, i) => (i ? "L" : "M") + X(d0 + ((d1 - d0) * i) / n).toFixed(1) + " " + Y(s.energy + Math.min(v, 6) * A).toFixed(1)).join("");
  })();
  const packetPath = (() => {
    if (!packet) return "";
    let mx = 0; for (const v of packet.p) mx = Math.max(mx, v);
    const A = (0.3 * (e1 - e0)) / (mx || 1);
    let d = ""; for (let i = 0; i < packet.p.length; i += 2) d += (i ? "L" : "M") + X(packet.x[i]).toFixed(1) + " " + Y(base.energy + packet.p[i] * A).toFixed(1);
    return d;
  })();

  /* ---- depth strip (finite well) ---- */
  const stripTop = PH + 8, stripH = bands ? 50 : 0;
  const DX = (v: number) => padL + (v / (c.depthAxis?.max ?? 1)) * (W - padL - padR);
  const UD = (px: number) => ((px - padL) / (W - padL - padR)) * (c.depthAxis?.max ?? 1);
  /* ---- T vs width plot (tunnel, barrier) ---- */
  const wplot = tunnel && bp.kind === "barrier" && c.widthAxis;
  const wTop = PH + 14, wH = wplot ? (narrow ? 104 : 118) : 0;
  const amax = c.widthAxis?.max ?? 1;
  const tFloor = -8;
  const WX = (a: number) => padL + (a / amax) * (W - padL - padR);
  const WY = (T: number) => wTop + 6 + (1 - (Math.max(Math.log10(Math.max(T, 1e-12)), tFloor) - tFloor) / -tFloor) * (wH - 26);
  const wCurve = (() => {
    if (!wplot || s.potential.kind !== "barrier") return { d: "", asym: "" };
    const p = s.potential; let d = "", asym = "";
    for (let i = 0; i <= 120; i++) {
      const a = (amax * i) / 120; d += (i ? "L" : "M") + WX(a).toFixed(1) + " " + WY(barrierT(s.energy, p.height, a, c.units)).toFixed(1);
      if (s.energy < p.height && a > 0) { const kap = Math.sqrt((p.height - s.energy) / HB2M[c.units]); asym += (asym ? "L" : "M") + WX(a).toFixed(1) + " " + WY(Math.min(1, (16 * s.energy * (p.height - s.energy)) / (p.height ** 2) * Math.exp(-2 * kap * a))).toFixed(1); }
    }
    return { d, asym };
  })();
  const svgH = PH + (bands ? stripH + 18 : 0) + (wplot ? wH + 14 : 0) + 4;

  const shareIt = () => {
    const fl = [...found].filter(f => !f.startsWith("b")).map(f => FINDING_LABEL[f as QuantumFinding]);
    const unchanged = ed.unchanged && ed.moves <= 1;
    let learner: string, reply: string;
    if (tunnel && baseTun) {
      const p = base.potential;
      learner = unchanged ? "I picked something up and put it back." : `With E = ${fmt(base.energy, 3)}${sp(eu)} and a ${potLabel(p, eu, lu)}, T = ${T_fmt(baseTun.T)}.`;
      reply = tunnelText(p, base.energy, baseTun.T, c.units, lu).share;
      if (packet?.done) { learner += ` I sent a packet: at the end of the run ${fmt(packet.trans * 100, 1)}% of its probability was beyond the barrier.`; reply += ` ${packetText(packet)}`; }
    } else if (baseBound) {
      const si = clamp(base.selected, 0, baseBound.energies.length - 1), E = baseBound.energies[si];
      const pf = E !== undefined ? forbiddenProbability(baseBound.g, baseBound.states[si], E) : 0;
      learner = unchanged ? "I picked something up and put it back." : `In a ${potLabel(base.potential, eu, lu)}, I looked at level ${si + 1}: E = ${E !== undefined ? fmt(E, 3) : "—"}${sp(eu)}${base.potential.kind !== "infinite" ? `, with ${fmt(pf * 100, 1)}% of the probability where V > E` : ""}.`;
      const p = base.potential;
      if (p.kind === "finiteSquare") { const n = boundStateCount(p.right - p.left, p.depth, c.units), at = atBoundThreshold(p.right - p.left, p.depth, c.units); learner += ` The well holds ${n} bound state${n === 1 ? "" : "s"}.`; reply = `A well of width ${fmt(p.right - p.left, 2)}${sp(lu)} and depth ${fmt(p.depth, 2)}${sp(eu)} holds ${n}: a new state appears each time z₀ = (w/2)√(2mV₀)/ℏ passes another π/2, so deeper or wider wells hold more, and in 1-D there's always at least one.${at ? ` This depth sits exactly on a threshold, so the next state becomes bound just above it.` : ""}${baseBound.energies.length !== n ? ` That count is for an infinite domain; the finite numerical box resolves ${baseBound.energies.length} negative-energy level${baseBound.energies.length === 1 ? "" : "s"}, because a weakly bound tail reaches past it.` : ""} ${pf > 0.02 ? `And ${fmt(pf * 100, 1)}% outside the walls is real: ψ leaks into the walls as a decaying exponential.` : ""}`; }
      else if (p.kind === "harmonic") reply = `The levels are (n + ½)ℏω: ${baseBound.energies.slice(0, 4).map(e => fmt(e, 3)).join(", ")}${sp(eu)}, all ℏω = ${fmt(p.hw, 3)} apart. A stiffer spring (larger ω) spreads the ladder, and the lowest level is still ½ℏω above the bottom.`;
      else if (p.kind === "infinite") reply = `In an infinite well Eₙ = n²π²ℏ²/2mL², so level ${si + 1} has ${(si + 1) ** 2}× the ground energy. Halve L and every level goes up 4×: squeezing a wave raises its kinetic energy.`;
      else reply = `Level ${si + 1} at ${E !== undefined ? fmt(E, 3) : "—"}${sp(eu)}. The levels come from solving −(ℏ²/2m)ψ'' + Vψ = Eψ, so they move when you reshape V.`;
    } else { learner = "I looked at the lab."; reply = "Drag the potential or a level and share again."; }
    if (fl.length) learner += ` I found: ${fl.join("; ")}.`;
    onShare?.({ learner, reply, data: `quantum · ${potLabel(base.potential, eu, lu)}${tunnel ? ` · E ${fmt(base.energy, 3)} · T ${T_fmt(baseTun?.T ?? NaN)}` : ` · level ${base.selected + 1}`} · found ${found.size}` });
  };

  const nearestLevel = (py: number) => { const E = UE(py); let best = 0; levels.forEach((l, i) => { if (Math.abs(l - E) < Math.abs(levels[best] - E)) best = i; }); return best; };
  const levelBind = bind("level", p => ({ ...base, selected: nearestLevel(p.y) }));

  const allFound = [...findings.map(f => ({ id: f, label: FINDING_LABEL[f] })), ...bandItems];
  const eStep = niceStep((e1 - e0) / 5), xStep = niceStep((d1 - d0) / 6);
  const eTicks = (() => { const out: number[] = []; for (let v = Math.ceil(e0 / eStep) * eStep; v <= e1 + 1e-9; v += eStep) out.push(+v.toFixed(6)); return out; })();
  const xTicks = (() => { const out: number[] = []; for (let v = Math.ceil(d0 / xStep) * xStep; v <= d1 + 1e-9; v += xStep) out.push(+v.toFixed(6)); return out.filter(v => X(v) < W - padR - 34); })();
  const dig = (st: number) => (st >= 1 ? 0 : st >= 0.1 ? 1 : 2);

  return <Shell title={c.title} goal={c.goal} dragging={dragging} mode="quantum" note={c.units === "electron" ? "An electron · 1-D Schrödinger equation" : "1-D Schrödinger equation · ℏ = m = 1"}>
    <div className="pl-canvas" ref={wrap}>
      <div className="pl-stage" ref={root} style={{ height: svgH }}>
        <svg ref={svg} width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="group" aria-label={`Potential: ${potLabel(s.potential, eu, lu)}`}>
          <rect x={padL} y={padT} width={W - padL - padR} height={PH - padT - 8} className="pl-frame" />
          {eTicks.map(v => <g key={v}><line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} className="pl-grid" /><text x={padL - 4} y={Y(v) + 3} textAnchor="end" className="pl-tick">{fmt(v, dig(eStep))}</text></g>)}
          {xTicks.map(v => <text key={v} x={X(v)} y={PH + 2} textAnchor="middle" className="pl-tick">{fmt(v, dig(xStep))}</text>)}
          <text x={4} y={padT + 8} className="pl-tick pl-unit">{eu ? "E (eV)" : "E"}</text>
          <text x={W - padR} y={PH + 2} textAnchor="end" className="pl-tick pl-unit">{lu ? "x (nm)" : "x"}</text>
          <path d={Vfill} className="pl-vfill" />
          <path d={Vpath} className="pl-vline" />
          {/* levels and |ψ|² */}
          {bound && levels.map((E, i) => <g key={i} className={i === sel ? "pl-level is-selected" : "pl-level"}>
            <line x1={padL} x2={W - padR} y1={Y(E)} y2={Y(E)} className="pl-level-line" />
            {i === sel && !mix && <><path d={fillPath(i, false)} className="pl-psi-fill" /><path d={fillPath(i, true)} className="pl-psi-forbidden" /></>}
            {!(mix && (i === sel || i === sel + 1)) && <path d={statePath(i, "all")} className={i === sel ? "pl-psi is-selected" : "pl-psi"} />}
            <text x={W - padR - 4} y={Y(E) - 3} textAnchor="end" className="pl-level-label">n = {i + 1}{i === sel ? ` · ${fmt(E, 3)}${sp(eu)}` : ""}</text>
          </g>)}
          {mixPath && <path d={mixPath} className="pl-psi is-selected pl-mix" />}
          {bound && levels.length > 0 && <g {...levelBind} className="pl-levels-hit" tabIndex={0} role="slider" aria-label="Energy level" aria-valuemin={1} aria-valuemax={levels.length} aria-valuenow={sel + 1} aria-valuetext={`Level ${sel + 1}, E = ${fmt(levels[sel], 3)}${sp(eu)}`}
            onKeyDown={e => keyStep(e, { up: () => commit({ ...base, selected: Math.min(levels.length - 1, sel + 1) }, `Selected level ${Math.min(levels.length, sel + 2)}.`), down: () => commit({ ...base, selected: Math.max(0, sel - 1) }, `Selected level ${Math.max(1, sel)}.`), home: () => commit({ ...base, selected: 0 }, "Selected level 1."), end: () => commit({ ...base, selected: levels.length - 1 }, `Selected level ${levels.length}.`) })}>
            {levels.map((E, i) => <rect key={i} x={padL + 30} y={Y(E) - 7} width={Math.max(20, W - padL - padR - 150)} height={14} className="pl-hit" data-level={i + 1} />)}
            <path d={`M${padL + 6} ${Y(levels[sel]) - 6} l9 6 l-9 6 z`} className="pl-level-grip" />
          </g>}
          {tun && <>
            <line x1={padL} x2={W - padR} y1={Y(s.energy)} y2={Y(s.energy)} className="pl-level-line is-energy" />
            {!packet && <path d={tunPath} className="pl-psi is-selected" />}
            {packet && <path d={packetPath} className="pl-psi is-selected pl-packet" />}
            <g {...bind("energy", p => setE(UE(p.y)))} className="pl-knob-g" tabIndex={0} role="slider" aria-label="Particle energy" aria-valuemin={c.energy?.min ?? 0} aria-valuemax={c.energy?.max ?? e1} aria-valuenow={s.energy} aria-valuetext={energyHandle!.label}
              onKeyDown={e => keyStep(e, { up: () => commit(setE(base.energy + es * 5), "Energy up."), down: () => commit(setE(base.energy - es * 5), "Energy down."), right: () => commit(setE(base.energy + es), "Energy up."), left: () => commit(setE(base.energy - es), "Energy down.") })}>
              <circle className="pl-hit" cx={padL + 14} cy={Y(s.energy)} r={14} />
              <circle className="pl-knob" cx={padL + 14} cy={Y(s.energy)} r={6} />
              <text x={padL + 24} y={Y(s.energy) - 7} className="pl-knob-label">E = {fmt(s.energy, 3)}{sp(eu)}</text>
            </g>
          </>}
          {handles.map(h => <g key={h.id} {...bind(h.id, p => h.move(p.x, p.y))} className={`pl-pot-handle pl-axis-${h.axis}`} tabIndex={0} role="slider" aria-label={h.label} aria-valuetext={h.label}
            onKeyDown={e => keyStep(e, {
              left: () => commit(h.keys(-1, false), h.label), right: () => commit(h.keys(1, false), h.label),
              up: () => commit(h.keys(h.axis === "x" ? 1 : 1, h.axis !== "x"), h.label), down: () => commit(h.keys(-1, h.axis !== "x"), h.label),
            })}>
            <circle className="pl-hit" cx={h.x} cy={h.y} r={15} />
            {h.axis === "x" ? <rect className="pl-grip" x={h.x - 4} y={h.y - 11} width={8} height={22} rx={3} /> : h.axis === "y" ? <rect className="pl-grip" x={h.x - 11} y={h.y - 4} width={22} height={8} rx={3} /> : <circle className="pl-grip" cx={h.x} cy={h.y} r={6} />}
          </g>)}
          {/* bound-state-count strip */}
          {bands && <g className="pl-strip">
            <text x={padL} y={stripTop + 12} className="pl-tick">well depth{eu ? " (eV)" : ""} → bound states</text>
            {[0, ...bands.cuts, c.depthAxis!.max].slice(0, -1).map((a, i, arr) => {
              const b = i + 1 < arr.length ? arr[i + 1] : c.depthAxis!.max, id = `b${i + 1}`;
              return <g key={i} className={found.has(id) ? "pl-band is-found" : "pl-band"}>
                <rect x={DX(a)} y={stripTop + 18} width={Math.max(0, DX(b) - DX(a))} height={16} />
                <text x={(DX(a) + DX(b)) / 2} y={stripTop + 30} textAnchor="middle">{DX(b) - DX(a) > 34 ? `${i + 1}` : ""}</text>
              </g>;
            })}
            {bands.cuts.map((t, i) => <g key={i}><line x1={DX(t)} x2={DX(t)} y1={stripTop + 16} y2={stripTop + 36} className="pl-cut" /><text x={DX(t)} y={stripTop + 46} textAnchor="middle" className="pl-tick">{fmt(t, 2)}</text></g>)}
            <g {...bind("depth", p => setPot(base, { ...(base.potential as Extract<Potential, { kind: "finiteSquare" }>), depth: eq(clamp(UD(p.x), es, c.depthAxis!.max)) }))} className="pl-knob-g" tabIndex={-1} aria-hidden="true">
              <circle className="pl-hit" cx={DX((s.potential as { depth: number }).depth)} cy={stripTop + 26} r={14} />
              <circle className="pl-knob" cx={DX((s.potential as { depth: number }).depth)} cy={stripTop + 26} r={6} />
            </g>
          </g>}
          {/* T against width */}
          {wplot && s.potential.kind === "barrier" && <g className="pl-wplot">
            <rect x={padL} y={wTop + 6} width={W - padL - padR} height={wH - 26} className="pl-frame" />
            {[0, -2, -4, -6, -8].map(l => <g key={l}><line x1={padL} x2={W - padR} y1={WY(10 ** l)} y2={WY(10 ** l)} className="pl-grid" /><text x={padL - 4} y={WY(10 ** l) + 3} textAnchor="end" className="pl-tick">{l === 0 ? "1" : `1e${l}`}</text></g>)}
            {wCurve.asym && <path d={wCurve.asym} className="pl-envelope" />}
            <path d={wCurve.d} className="pl-profile" />
            <text x={padL} y={wTop + wH - 6} className="pl-tick">{narrow ? "T (log)" : "T against barrier width (log scale)"}</text>
            <text x={W - padR} y={wTop + wH - 6} textAnchor="end" className="pl-tick">width{lu ? " (nm)" : ""} 0 → {fmt(amax, 1)}</text>
            <g {...bind("width", p => { const bp2 = base.potential as Extract<Potential, { kind: "barrier" }>; return setPot(base, { ...bp2, right: xq(clamp(bp2.left + ((p.x - padL) / (W - padL - padR)) * amax, bp2.left + minWidth, Math.min(d1, bp2.left + amax))) }); })} className="pl-knob-g" tabIndex={-1} aria-hidden="true">
              <circle className="pl-hit" cx={WX(s.potential.right - s.potential.left)} cy={WY(tun!.T)} r={14} />
              <circle className="pl-knob" cx={WX(s.potential.right - s.potential.left)} cy={WY(tun!.T)} r={5.5} />
            </g>
          </g>}
        </svg>
      </div>
    </div>
    <Found items={allFound} found={found} />
    <div className={`pl-readout pl-tone-${tone}`}>
      <p className="pl-line">{main}</p>
      <p className="pl-why">{why}</p>
      <p className="pl-sr" role="status">{msg}</p>
    </div>
    <div className="pl-toggles">
      {bound && levels.length > sel + 1 && <button type="button" className="pl-toggle" aria-pressed={mix} onClick={() => setMix(v => !v)}>{mix ? "Show one level" : `Mix levels ${sel + 1} and ${sel + 2}`}</button>}
      {mix && reduced && <button type="button" className="pl-toggle" onClick={() => setPhase(p => p + Math.PI / 2)}>Next quarter period</button>}
      {tun && <button type="button" className="pl-toggle" onClick={sendPacket}>{packet && !packet.done ? "Sending…" : "Send a wave packet"}</button>}
    </div>
    <Disclosure label="Use buttons instead">
      <div className="pl-rows">
        {handles.map(h => <div className="pl-row" key={h.id}><span>{h.label}</span><span className="pl-row-btns">
          {h.axis !== "y" && <><button type="button" onClick={() => commit(h.keys(-1, false), h.label)} aria-label={`${h.id} left`}>←</button><button type="button" onClick={() => commit(h.keys(1, false), h.label)} aria-label={`${h.id} right`}>→</button></>}
          {h.axis !== "x" && <><button type="button" onClick={() => commit(h.keys(-1, true), h.label)} aria-label={`${h.id} down`}>↓</button><button type="button" onClick={() => commit(h.keys(1, true), h.label)} aria-label={`${h.id} up`}>↑</button></>}
        </span></div>)}
        {bound && levels.length > 0 && <div className="pl-row"><span>Level {sel + 1} of {levels.length}</span><span className="pl-row-btns">
          <button type="button" onClick={() => commit({ ...base, selected: Math.max(0, sel - 1) }, `Selected level ${Math.max(1, sel)}.`)} disabled={sel === 0}>lower level</button>
          <button type="button" onClick={() => commit({ ...base, selected: Math.min(levels.length - 1, sel + 1) }, `Selected level ${Math.min(levels.length, sel + 2)}.`)} disabled={sel >= levels.length - 1}>higher level</button></span></div>}
        {tun && <div className="pl-row"><span>Energy {fmt(base.energy, 3)}{sp(eu)}</span><span className="pl-row-btns">
          <button type="button" onClick={() => commit(setE(base.energy - es * 5), "Energy down.")}>lower</button><button type="button" onClick={() => commit(setE(base.energy + es * 5), "Energy up.")}>higher</button></span></div>}
      </div>
    </Disclosure>
    <Disclosure label="How this is computed">
      <div className="pl-eq">
        {bound ? <p>−(ℏ²/2m)ψ″ + Vψ = Eψ on {GRID_N} grid points with hard walls at the ends of the plot, by second-order finite differences. The tridiagonal matrix is solved here: Sturm-sequence bisection for the energies, inverse iteration for ψ. Each |ψ|² is drawn on its own energy line; the shaded part{s.potential.kind !== "infinite" ? " in the second colour is where V > E" : ""}.</p>
          : <p>T comes from matching ψ and ψ′ across the barrier edges (exact for a rectangular barrier: Griffiths, QM, Prob. 2.33 in the 2nd ed.). The curve shows |ψ|² for a wave sent in from the left with unit amplitude. The dashed line under the T curve is the thick-barrier form 16(E/V)(1 − E/V)e^(−2κa). The wave packet is evolved with Crank–Nicolson on a 900-point grid.</p>}
        <p>{c.units === "electron" ? "An electron: ℏ²/2m = 0.0381 eV·nm². " : "Units with ℏ = m = 1. "}One dimension only. The potentials are idealised (sharp walls), so this is a teaching model.</p>
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={() => { ed.undo(); setMsg("Undid the last move."); }} reset={() => { ed.reset(); setFound(new Set()); setWidths([]); setMix(false); setPacket(null); setMsg("Started over."); }} share={onShare ? shareIt : undefined} />
  </Shell>;
}

function niceStep(raw: number) { const p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
const sub = (n: number) => String(n).replace(/\d/g, d => "₀₁₂₃₄₅₆₇₈₉"[+d]);
/* ---- tunnelling text: one source for the readout and the share, from the actual profile and energy ---- */
export function tunnelText(p: Potential, E: number, T: number, units: "electron" | "natural", lu: string) {
  const eu = units === "electron" ? " eV" : "", L = lu ? " " + lu : "";
  const Ts = T_fmt(T), R = T_fmt(1 - T);
  if (p.kind === "points") {
    const vmax = Math.max(...p.points.map(q => q[1]));
    const main = `E = ${fmt(E, 3)}${eu} against a profile peaking at ${fmt(vmax, 2)}${eu}: transmission T = ${Ts}, reflection R = ${R}.`;
    const why = sameEnergy(E, vmax) ? `E equals the highest point of the profile. Transmission for this shape is T = ${Ts}.`
      : E < vmax ? `E lies below the potential in part of the profile. Transmission for this shape is T = ${Ts}. Where V > E, ψ is a mix of growing and decaying parts whose rate changes with V, so there is no single κ or width rule for this shape.`
      : `E is above the whole profile. Classically it would always pass; as a wave it partly reflects wherever V changes. Transmission for this shape is T = ${Ts}.`;
    return { main, why, share: why, kappa: undefined as number | undefined };
  }
  if (p.kind !== "barrier") return { main: `T = ${Ts}.`, why: "", share: `T = ${Ts}.`, kappa: undefined as number | undefined };
  const V = p.height, a = p.right - p.left;
  const main = `E = ${fmt(E, 3)}${eu} against a barrier ${fmt(V, 2)}${eu} high: transmission T = ${Ts}, reflection R = ${R}.`;
  if (sameEnergy(E, V)) {
    const why = `E equals the barrier height. Inside, ψ is neither oscillating nor decaying: it varies linearly. The finite threshold limit is T = 1/(1 + V₀a²/(4ℏ²/2m)) = ${Ts}.`;
    return { main, why, share: why, kappa: undefined as number | undefined };
  }
  if (E < V) {
    const kappa = Math.sqrt((V - E) / HB2M[units]), ka = kappa * a;
    const rule = ka >= 2 ? ` Here κa = ${fmt(ka, 2)}, so T is close to 16(E/V)(1 − E/V)e^(−2κa) and each extra 1/κ = ${fmt(1 / kappa, 3)}${L} of width cuts T by about e² ≈ 7.4.` : ` Here κa = ${fmt(ka, 2)} is not ≫ 1, so the exponential estimate is only rough; the exact formula gives T = ${Ts}.`;
    const why = `Classically it would bounce back every time. Inside a finite uniform barrier ψ is a sum of decaying and growing exponentials (κ = ${fmt(kappa, 2)}${lu ? " per nm" : ""}), so a little gets through. For κa ≫ 1, T is approximately proportional to exp(−2κa).${rule}`;
    const share = `Right: with E below the barrier a classical particle never gets through, but inside the barrier ψ is a sum of decaying and growing exponentials rather than stopping dead, so T = ${Ts}. For κa ≫ 1, T ≈ 16(E/V)(1 − E/V)e^(−2κa), so the width matters exponentially (here κa = ${fmt(ka, 2)}${ka >= 2 ? "" : ", not yet in that regime"}). That's why a scanning tunnelling microscope is so sensitive to the tip height.`;
    return { main, why, share, kappa };
  }
  const n = barrierResonance(E, V, a, units), npi = n === 1 ? "π" : `${n}π`;
  const why = n && T > 0.995 ? `Above the barrier, transmission is complete here: k′a ≈ ${npi}, so ${n} half-wavelength${n === 1 ? "" : "s"} fit across the barrier and the reflections from its two edges cancel.`
    : T > 0.995 ? "Above the barrier, transmission is high here."
    : "Classically it would always pass. As a wave it partly reflects at each edge of the barrier, even with E > V.";
  const share = n && T > 0.995 ? `Above the barrier, T = ${Ts}: k′a ≈ ${npi}, a whole number of half-wavelengths fits across it, so the reflections from the two edges cancel.`
    : T > 0.995 ? `Above the barrier, T = ${Ts}: transmission is high here, though not at a resonance.`
    : `Above the barrier, T = ${Ts}: the wave partly reflects at each edge even though E > V, which no classical particle does.`;
  return { main, why, share, kappa: undefined as number | undefined };
}
export function packetText(pk: { trans: number; T: number; Tavg: number }) {
  return `The wave packet: at the end of the simulation ${fmt(pk.trans * 100, 1)}% of its probability is beyond the barrier. Averaging the exact T over the packet's spread of wavenumbers (its k ≤ 0 part counted as not transmitted) predicts ${fmt(pk.Tavg * 100, 1)}% for the whole packet. At the energy of its central wavenumber, T is ${T_fmt(pk.T)}. A short packet holds a wide spread of energies, and its faster parts tunnel much more easily.`;
}
export function bandsText(b: { w: number; count: number }, depth: number, resolved: number, units: "electron" | "natural", eu: string, lu: string) {
  const sp = (u: string) => (u ? " " + u : "");
  const at = atBoundThreshold(b.w, depth, units);
  let t = `Width ${fmt(b.w, 2)}${sp(lu)}, depth ${fmt(depth, 2)}${sp(eu)}: ${b.count} bound state${b.count === 1 ? "" : "s"}. A new one appears each time the depth passes (ℏ²/2m)(nπ/w)². A 1-D well always holds at least one.`;
  if (at) t += " This depth is exactly on a threshold: the next state becomes bound just above this depth.";
  if (resolved !== b.count) t += ` (The count is for an infinite domain; the finite numerical box resolves ${resolved} negative-energy level${resolved === 1 ? "" : "s"}.)`;
  return t;
}
function T_fmt(T: number) { if (!Number.isFinite(T)) return "—"; if (T >= 0.01) return `${fmt(T * 100, T > 0.995 && T < 1 ? 2 : 1)}%`; return sci(T, 2); }
