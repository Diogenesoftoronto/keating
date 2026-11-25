import { useEffect, useMemo, useRef, useState } from "react";
import { displacementAt, intensityAt, measuredFringeSpacing, pathDifference, screenProfile, wavelets, type Wavelet, type WaveScene } from "./physics";
import {
  Actions, clamp, Disclosure, fmt, Found, handleCentres, keyStep, readColour, Shell, snap, svgToClient, useDrag, useEditable,
  useReducedMotion, useScheme, useTestApi, useWidth, type Pt,
} from "./common";
import type { ShareSummary, WaveFinding, WavesConfig } from "./types";

type WState = { lambda: number; sources: { id: string; x: number; y: number }[]; slits: { id: string; y: number; width: number }[]; screenX: number; mark: number | null };

const FINDING_LABEL: Record<WaveFinding, string> = {
  bright: "bright: whole wavelengths apart", dark: "dark: half a wavelength out", spacing: "longer λ, wider fringes",
  width: "slit width sets the envelope", separation: "closer slits, wider fringes",
};
const findingLabel = (c: WavesConfig, f: WaveFinding) => f === "separation" && c.scene.kind === "sources" ? "closer sources, wider fringes" : FINDING_LABEL[f];
const MAXW = 64;

export function waveScene(c: WavesConfig, s: WState): WaveScene {
  return c.scene.kind === "sources" ? { kind: "sources", sources: s.sources } : { kind: "slits", barrierX: c.scene.barrierX, slits: s.slits };
}
/** Aperture geometry and the screen distance L. λL/d is offered only where it applies (Hecht §9.3): exactly two
    apertures aligned across the beam (same x, separated in y) with λ < d, so a first-order fringe exists. Otherwise
    `predicted` is NaN and the lab shows the summed intensity and the actual paths. */
export function geometry(c: WavesConfig, s: WState) {
  const pts: Pt[] = c.scene.kind === "sources" ? s.sources.map(q => ({ x: q.x, y: q.y })) : s.slits.map(q => ({ x: (c.scene as { barrierX: number }).barrierX, y: q.y }));
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const d = sorted.length >= 2 ? Math.hypot(sorted[1].x - sorted[0].x, sorted[1].y - sorted[0].y) : NaN;
  const meanX = pts.reduce((a, p) => a + p.x, 0) / Math.max(1, pts.length), meanY = pts.reduce((a, p) => a + p.y, 0) / Math.max(1, pts.length);
  const L = s.screenX - meanX;
  const aligned = sorted.length === 2 && Math.abs(sorted[1].x - sorted[0].x) <= 1e-6 + 0.01 * d;
  const ruleOK = aligned && s.lambda < d && L > 0;
  return { pts: sorted, d, L, meanX, meanY, aligned, ruleOK, predicted: ruleOK ? (s.lambda * L) / d : NaN };
}
export function waveModel(c: WavesConfig, s: WState, n = 400) {
  const ws = wavelets(waveScene(c, s), s.lambda).slice(0, MAXW);
  const y0 = -c.view.yHalf, y1 = c.view.yHalf;
  const profile = screenProfile(ws, s.lambda, s.screenX, y0, y1, n);
  const g = geometry(c, s);
  const measured = measuredFringeSpacing(profile, y0, y1, g.meanY);
  let peak = 0; for (const v of profile) peak = Math.max(peak, v);
  return { ws, profile, peak, y0, y1, ...g, measured };
}

const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";
const FRAG = `precision highp float;
uniform vec3 uW[${MAXW}]; uniform int uN; uniform float uK; uniform float uPhase; uniform float uMode; uniform float uNorm;
uniform vec4 uMap; uniform vec2 uRes; uniform vec2 uCentre; uniform vec3 uCol; uniform vec3 uCol2; uniform float uAlpha; uniform float uScreen; uniform float uStart;
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = vec2(uMap.x + px.x * uMap.z, uMap.y - px.y * uMap.w);
  if (p.x > uScreen || p.x < uStart) { gl_FragColor = vec4(0.0); return; }
  float re = 0.0; float im = 0.0;
  for (int i = 0; i < ${MAXW}; i++) {
    if (i >= uN) break;
    float r = max(length(p - uW[i].xy), 1e-3);
    float a = uW[i].z / sqrt(r);
    re += a * cos(uK * r - uPhase); im += a * sin(uK * r - uPhase);
  }
  float rr = max(length(p - uCentre), 1e-3);
  if (uMode < 0.5) {
    float v = pow(clamp((re * re + im * im) * rr * uNorm, 0.0, 1.4) / 1.4, 0.7);
    gl_FragColor = vec4(uCol * v, v * uAlpha);
  } else {
    float v = clamp(re * sqrt(rr) * sqrt(uNorm) * 0.8, -1.0, 1.0);
    vec3 col = v > 0.0 ? uCol : uCol2;
    gl_FragColor = vec4(col * abs(v), abs(v) * uAlpha);
  }
}`;

type GL = { gl: WebGLRenderingContext; prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> };
function makeGL(cv: HTMLCanvasElement): GL | null {
  try {
    if (import.meta.env.DEV && (window as unknown as { keatingPhysicsNoGL?: boolean }).keatingPhysicsNoGL) return null;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false }) as WebGLRenderingContext | null;
    if (!gl) return null;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ap = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
    const loc: GL["loc"] = {};
    for (const n of ["uW", "uN", "uK", "uPhase", "uMode", "uNorm", "uMap", "uRes", "uCentre", "uCol", "uCol2", "uAlpha", "uScreen", "uStart"]) loc[n] = gl.getUniformLocation(prog, n);
    return { gl, prog, loc };
  } catch { return null; }
}

export function WavesLab({ config: c, onChange, onShare }: { config: WavesConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const initial = useMemo<WState>(() => ({
    lambda: c.wavelength.value, screenX: c.screen.x, mark: null,
    sources: c.scene.kind === "sources" ? c.scene.sources.map(q => ({ ...q })) : [],
    slits: c.scene.kind === "slits" ? c.scene.slits.map(q => ({ ...q })) : [],
  }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), canvas = useRef<HTMLCanvasElement>(null), root = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const reduced = useReducedMotion();
  const dark = useScheme();
  const [msg, setMsg] = useState("");
  const [crests, setCrests] = useState(false);
  const [renderer, setRenderer] = useState<"webgl" | "cpu" | "none">("none");
  const findings = c.findings ?? (c.scene.kind === "slits" && c.scene.slits.length >= 2 ? ["bright", "dark", "spacing", "width"] : c.scene.kind === "slits" ? ["dark", "spacing", "width"] : ["bright", "dark", "spacing", "separation"]) as WaveFinding[];
  const [found, setFound] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState<{ lambda: number; spacing: number; d: number; width: number }[]>([]);
  const perf = useRef({ draws: 0, ms: 0, maxMs: 0 });
  const glRef = useRef<GL | null | undefined>(undefined);

  const s = ed.view, base = ed.state;
  const narrow = W < 460;
  const PRW = narrow ? 62 : 104, GAP = 10;
  const vx = c.view.x1 - c.view.x0, vy = 2 * c.view.yHalf;
  const ppu = Math.min((W - PRW - GAP) / vx, (narrow ? 250 : 340) / vy);
  const MW = vx * ppu, MH = vy * ppu, PX = MW + GAP;
  const X = (x: number) => (x - c.view.x0) * ppu, Y = (y: number) => (c.view.yHalf - y) * ppu;
  const UX = (px: number) => c.view.x0 + px / ppu, UY = (py: number) => c.view.yHalf - py / ppu;
  const lu = c.units.length;
  const lstep = c.wavelength.step ?? (c.wavelength.max - c.wavelength.min) / 40;
  const pstep = +(vx / 200).toPrecision(1);
  const slitMode = c.scene.kind === "slits";
  const barrierX = c.scene.kind === "slits" ? c.scene.barrierX : NaN;
  const minW = c.scene.kind === "slits" ? c.scene.minWidth ?? Math.max(pstep, c.wavelength.min / 4) : 0;
  const maxW = c.scene.kind === "slits" ? c.scene.maxWidth ?? c.view.yHalf / 2 : 0;
  const digits = (v: number) => (v >= 10 ? 1 : 2);

  const model = useMemo(() => waveModel(c, s, Math.max(200, Math.round(MH))), [c, s, MH]);
  const startX = slitMode ? barrierX : c.view.x0;

  /* ---- draw the intensity map (WebGL shader, or the CPU fallback) ---- */
  const colours = useRef<{ dark: boolean; col: number[]; col2: number[] } | null>(null);
  const drawRef = useRef<(phase: number) => void>(() => {});
  drawRef.current = (phase: number) => {
    const cv = canvas.current, el = root.current; if (!cv || !el) return;
    const t0 = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(MW), h = Math.round(MH);
    if (!colours.current || colours.current.dark !== dark) colours.current = { dark, col: readColour(el, "--pl-wave", [127, 176, 242]).map(v => v / 255), col2: readColour(el, "--pl-wave2", [236, 138, 111]).map(v => v / 255) };
    const { col, col2 } = colours.current;
    const ws = model.ws, k = (2 * Math.PI) / s.lambda;
    const norm = model.peak > 0 ? 1 / (model.peak * Math.max(model.L, 1e-9)) : 1;
    const centre = { x: model.meanX, y: model.meanY };
    if (glRef.current === undefined) { glRef.current = makeGL(cv); setRenderer(glRef.current ? "webgl" : "cpu"); }
    const g = glRef.current;
    if (g) {
      const res = Math.min(dpr, 1.5);
      if (cv.width !== Math.round(w * res) || cv.height !== Math.round(h * res)) { cv.width = Math.round(w * res); cv.height = Math.round(h * res); }
      const { gl, loc } = g;
      gl.viewport(0, 0, cv.width, cv.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      const arr = new Float32Array(MAXW * 3); ws.forEach((q, i) => { arr[i * 3] = q.x; arr[i * 3 + 1] = q.y; arr[i * 3 + 2] = q.a; });
      gl.uniform3fv(loc.uW, arr); gl.uniform1i(loc.uN, ws.length); gl.uniform1f(loc.uK, k); gl.uniform1f(loc.uPhase, phase);
      gl.uniform1f(loc.uMode, crests ? 1 : 0); gl.uniform1f(loc.uNorm, norm);
      gl.uniform4f(loc.uMap, c.view.x0, c.view.yHalf, vx / cv.width, vy / cv.height); gl.uniform2f(loc.uRes, cv.width, cv.height);
      gl.uniform2f(loc.uCentre, centre.x, centre.y); gl.uniform3f(loc.uCol, col[0], col[1], col[2]); gl.uniform3f(loc.uCol2, col2[0], col2[1], col2[2]);
      gl.uniform1f(loc.uAlpha, dark ? 0.95 : 0.85); gl.uniform1f(loc.uScreen, s.screenX); gl.uniform1f(loc.uStart, startX);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      /* CPU fallback: coarse cells while a drag runs, finer at rest. */
      const cell = dragging ? 6 : 3, gx = Math.ceil(w / cell), gy = Math.ceil(h / cell);
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const ctx = cv.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
      const img = ctx.createImageData(gx, gy);
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const x = UX((i + 0.5) * cell), y = UY((j + 0.5) * cell), o = (j * gx + i) * 4;
        if (x > s.screenX || x < startX) { img.data[o + 3] = 0; continue; }
        const rr = Math.max(Math.hypot(x - centre.x, y - centre.y), 1e-3);
        let v: number, cc = col;
        if (crests) { const d = clamp(displacementAt(ws, k, phase, x, y) * Math.sqrt(rr * norm) * 0.8, -1, 1); v = Math.abs(d); cc = d > 0 ? col : col2; }
        else v = Math.pow(clamp(intensityAt(ws, k, x, y) * rr * norm, 0, 1.4) / 1.4, 0.7);
        img.data[o] = cc[0] * 255; img.data[o + 1] = cc[1] * 255; img.data[o + 2] = cc[2] * 255; img.data[o + 3] = v * (dark ? 0.95 : 0.85) * 255;
      }
      const off = document.createElement("canvas"); off.width = gx; off.height = gy; off.getContext("2d", { willReadFrequently: true })!.putImageData(img, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, gx * cell, gy * cell);
    }
    const ms = performance.now() - t0;
    perf.current.draws++; perf.current.ms += ms; perf.current.maxMs = Math.max(perf.current.maxMs, ms);
  };
  useEffect(() => { drawRef.current(0); }, [model, MW, MH, crests, dark, dragging]);
  /* Animated crests (WebGL only; reduced motion keeps the still frame). */
  useEffect(() => {
    if (!crests || reduced || renderer !== "webgl") return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { drawRef.current(((t - t0) / 1000) * 2 * Math.PI * 0.8); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [crests, reduced, renderer]);

  /* ---- findings on commit ---- */
  const markInfo = (st: WState, m: WaveModel) => {
    if (st.mark == null || m.pts.length < 1) return null;
    const p = { x: st.screenX, y: st.mark };
    const idx = Math.round(((st.mark - m.y0) / (m.y1 - m.y0)) * (m.profile.length - 1));
    const rel = m.peak > 0 ? m.profile[clamp(idx, 0, m.profile.length - 1)] / m.peak : 0;
    /* One point source: no slit width and no second path, so no path difference at all. */
    if (m.pts.length < 2 && !slitMode) return { delta: NaN, rel, edges: false, single: true as const };
    /* Three or more: each pair's path difference, with no conclusion drawn from any one pair. */
    if (m.pts.length > 2) {
      const pairs: { a: number; b: number; delta: number }[] = [];
      for (let i = 0; i < m.pts.length; i++) for (let j = i + 1; j < m.pts.length; j++) pairs.push({ a: i, b: j, delta: pathDifference(m.pts[j], m.pts[i], p, st.lambda) });
      return { delta: NaN, rel, edges: false, pairs };
    }
    if (m.pts.length < 2) {
      /* Single slit: the first dark band sits where the slit's two halves are λ/2 apart, i.e. its edges are λ apart. */
      const w = st.slits[0]?.width ?? 0, top = { x: barrierX, y: m.pts[0].y + w / 2 }, bot = { x: barrierX, y: m.pts[0].y - w / 2 };
      return { delta: pathDifference(top, bot, p, st.lambda), rel, edges: true };
    }
    return { delta: pathDifference(m.pts[1], m.pts[0], p, st.lambda), rel, edges: false };
  };
  type WaveModel = ReturnType<typeof waveModel>;
  const baseModel = useMemo(() => waveModel(c, base, 400), [c, base]);
  useEffect(() => {
    const add: string[] = [];
    const mi = markInfo(base, baseModel);
    if (mi && Number.isFinite(mi.delta)) {
      const frac = mi.delta - Math.round(mi.delta);
      if (!mi.edges && Math.abs(frac) < 0.12 && Math.round(mi.delta) !== 0 && mi.rel > 0.2) add.push("bright");
      if (mi.edges ? Math.abs(Math.abs(mi.delta) - 1) < 0.12 && mi.rel < 0.08 : Math.abs(Math.abs(frac) - 0.5) < 0.12 && mi.rel < 0.25) add.push("dark");
    }
    const width = base.slits[0]?.width ?? 0;
    const entry = { lambda: base.lambda, spacing: baseModel.pts.length >= 2 ? baseModel.measured : width > base.lambda ? baseModel.L * Math.tan(Math.asin(base.lambda / width)) : Infinity, d: baseModel.d, width };
    const next = [...tried.filter(t => t.lambda !== entry.lambda || t.d !== entry.d || t.width !== entry.width), entry].slice(-8);
    setTried(next);
    if (ed.moves === 0) return;
    const first = next[0];
    if (next.some(t => t.lambda / first.lambda >= 1.25 || first.lambda / t.lambda >= 1.25)) add.push("spacing");
    if (next.some(t => (t.width / first.width >= 1.4 || first.width / t.width >= 1.4))) add.push("width");
    if (next.some(t => Number.isFinite(t.d) && (t.d / first.d >= 1.25 || first.d / t.d >= 1.25))) add.push("separation");
    setFound(f => { const n = new Set(f); add.filter(a => findings.includes(a as WaveFinding)).forEach(a => n.add(a)); return n.size === f.size ? f : n; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => { if (ed.unchanged) setMsg("Dropped where it started: nothing changed."); }, [ed.unchanged, ed.moves]);

  /* ---- handles ---- */
  const crestN = 2;
  const lamMove = bind("wavelength", p => {
    let lam: number;
    if (slitMode) lam = (barrierX - UX(p.x)) / crestN;
    else { const s0 = base.sources[0]; lam = Math.hypot(UX(p.x) - s0.x, UY(p.y) - s0.y) / crestN; }
    return { ...base, lambda: +clamp(snap(lam, lstep), c.wavelength.min, c.wavelength.max).toFixed(4) };
  });
  const screenMove = bind("screen", p => ({ ...base, screenX: +clamp(snap(UX(p.x), pstep), c.screen.min, c.screen.max).toFixed(4) }));
  const markMove = bind("marker", p => ({ ...base, mark: +clamp(snap(UY(p.y), pstep / 2), -c.view.yHalf, c.view.yHalf).toFixed(4) }));
  const keepSlits = (sl: WState["slits"]) => {
    const sorted = [...sl].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i].width / 2 < sorted[i - 1].y + sorted[i - 1].width / 2 + pstep) return false;
    return sorted.every(q => Math.abs(q.y) + q.width / 2 <= c.view.yHalf);
  };
  const slitMove = (id: string) => bind(`slit ${id}`, (p, start) => {
    const q = base.slits.find(z => z.id === id)!;
    const y = +snap(q.y + (UY(p.y) - UY(start.y)), pstep).toFixed(4);
    const next = base.slits.map(z => z.id === id ? { ...z, y } : z);
    return keepSlits(next) ? { ...base, slits: next } : base;
  });
  const edgeMove = (id: string) => bind(`width ${id}`, p => {
    const q = base.slits.find(z => z.id === id)!;
    const w = +clamp(snap(2 * Math.abs(UY(p.y) - q.y), pstep), minW, maxW).toFixed(4);
    const next = base.slits.map(z => z.id === id ? { ...z, width: w } : z);
    return keepSlits(next) ? { ...base, slits: next } : base;
  });
  const srcMove = (id: string) => bind(`source ${id}`, (p, start) => {
    const q = base.sources.find(z => z.id === id)!;
    const x = +clamp(snap(q.x + UX(p.x) - UX(start.x), pstep), c.view.x0, base.screenX - 4 * base.lambda).toFixed(4);
    const y = +clamp(snap(q.y + UY(p.y) - UY(start.y), pstep), -c.view.yHalf, c.view.yHalf).toFixed(4);
    return { ...base, sources: base.sources.map(z => z.id === id ? { ...z, x, y } : z) };
  });

  const commit = (next: WState, say: string) => { ed.commit(next); setMsg(say); };
  const setLam = (v: number) => commit({ ...base, lambda: +clamp(snap(v, lstep), c.wavelength.min, c.wavelength.max).toFixed(4) }, `Wavelength ${fmt(clamp(v, c.wavelength.min, c.wavelength.max), 2)} ${lu}.`);
  const setScreen = (v: number) => commit({ ...base, screenX: +clamp(v, c.screen.min, c.screen.max).toFixed(4) }, `Screen at ${fmt(clamp(v, c.screen.min, c.screen.max), 1)} ${lu}.`);
  const setMark = (v: number | null) => commit({ ...base, mark: v == null ? null : +clamp(v, -c.view.yHalf, c.view.yHalf).toFixed(4) }, v == null ? "Marker removed." : `Marker at y = ${fmt(v, 2)} ${lu}.`);
  const nudgeSlit = (id: string, dy: number, dw: number) => {
    const next = base.slits.map(z => z.id === id ? { ...z, y: +(z.y + dy).toFixed(4), width: +clamp(z.width + dw, minW, maxW).toFixed(4) } : z);
    if (keepSlits(next)) commit({ ...base, slits: next }, `Slit ${id}: centre ${fmt(next.find(z => z.id === id)!.y, 2)}, width ${fmt(next.find(z => z.id === id)!.width, 2)} ${lu}.`);
    else setMsg("Slits can't overlap or leave the barrier.");
  };
  const nudgeSrc = (id: string, dx: number, dy: number) => {
    const next = base.sources.map(z => z.id === id ? { ...z, x: +clamp(z.x + dx, c.view.x0, base.screenX - 4 * base.lambda).toFixed(4), y: +clamp(z.y + dy, -c.view.yHalf, c.view.yHalf).toFixed(4) } : z);
    commit({ ...base, sources: next }, `Source ${id} at (${fmt(next.find(z => z.id === id)!.x, 1)}, ${fmt(next.find(z => z.id === id)!.y, 1)}) ${lu}.`);
  };

  /* Messages after drags. */
  const prevRef = useRef(base);
  useEffect(() => {
    const p = prevRef.current; prevRef.current = base;
    if (p === base || ed.moves === 0) return;
    if (p.lambda !== base.lambda) setMsg(`Wavelength ${fmt(base.lambda, 2)} ${lu}; fringe spacing ${fmt(baseModel.measured, 2)} ${lu}.`);
    else if (p.screenX !== base.screenX) setMsg(`Screen at ${fmt(base.screenX, 1)} ${lu} (L = ${fmt(baseModel.L, 1)}).`);
    else if (p.mark !== base.mark && base.mark != null) setMsg(`Marker at y = ${fmt(base.mark, 2)} ${lu}.`);
    else if (JSON.stringify(p.slits) !== JSON.stringify(base.slits)) setMsg(`Slits moved: d = ${fmt(baseModel.d, 2)} ${lu}.`);
    else if (JSON.stringify(p.sources) !== JSON.stringify(base.sources)) setMsg(`Sources moved: d = ${fmt(baseModel.d, 2)} ${lu}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useTestApi(() => ({
    snapshot: () => ({
      mode: "waves", title: c.title, state: ed.state, live: ed.live, lambda: s.lambda, d: model.d, L: model.L, predicted: model.predicted, measured: model.measured,
      mark: markInfo(s, model), found: [...found], moves: ed.moves, msg, renderer, perf: { ...perf.current }, dragging, W, crests,
    }),
    point: (x, y) => svgToClient(svg.current, X(x), Y(y)),
    handles: () => handleCentres(root.current),
  }));

  /* ---- drawing helpers ---- */
  const two = model.pts.length >= 2;
  const mi = markInfo(s, model);
  const profPath = (() => {
    const n = model.profile.length; let d = "";
    for (let i = 0; i < n; i++) { const y = Y(model.y0 + ((model.y1 - model.y0) * i) / (n - 1)), x = PX + 4 + (model.peak > 0 ? model.profile[i] / model.peak : 0) * (PRW - 10); d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }
    return d;
  })();
  /* Single-slit envelope (Fraunhofer), scaled to the profile's centre value: sinc²(π w sinθ / λ). */
  const envPath = (() => {
    if (!slitMode || !s.slits.length) return "";
    const w = s.slits[0].width, n = 160; let d = "";
    const centreIdx = Math.round(((model.meanY - model.y0) / (model.y1 - model.y0)) * (model.profile.length - 1));
    const i0 = model.peak > 0 ? Math.max(...model.profile.slice(Math.max(0, centreIdx - 3), centreIdx + 4)) / model.peak : 1;
    for (let i = 0; i < n; i++) {
      const y = model.y0 + ((model.y1 - model.y0) * i) / (n - 1), th = Math.atan2(y - model.meanY, model.L), b = (Math.PI * w * Math.sin(th)) / s.lambda;
      const e = b === 0 ? 1 : (Math.sin(b) / b) ** 2;
      d += (i ? "L" : "M") + (PX + 4 + e * i0 * (PRW - 10)).toFixed(1) + " " + Y(y).toFixed(1);
    }
    return d;
  })();
  const lamHandle = slitMode ? { x: X(barrierX - crestN * s.lambda), y: Y(c.view.yHalf * 0.62) } : (() => { const s0 = s.sources[0], a = (3 * Math.PI) / 4; return { x: X(s0.x + crestN * s.lambda * Math.cos(a)), y: Y(s0.y + crestN * s.lambda * Math.sin(a)) }; })();
  const crestLines = slitMode ? Array.from({ length: Math.max(0, Math.floor((barrierX - c.view.x0) / s.lambda)) }, (_, i) => X(barrierX - (i + 1) * s.lambda)) : [];
  const barrierSegs = (() => {
    if (!slitMode) return [];
    const sorted = [...s.slits].sort((a, b) => b.y - a.y), segs: [number, number][] = []; let top = c.view.yHalf;
    for (const q of sorted) { segs.push([top, q.y + q.width / 2]); top = q.y - q.width / 2; }
    segs.push([top, -c.view.yHalf]);
    return segs;
  })();
  const fringeTicks = two && Number.isFinite(model.predicted) ? Array.from({ length: 9 }, (_, i) => model.meanY + (i - 4) * model.predicted).filter(y => Math.abs(y) < c.view.yHalf) : [];
  /* First single-slit minimum in the far field, w sin θ = λ: none exists when w ≤ λ (no fictitious clamp). */
  const singleMinFor = (st: WState, L: number) => { const w = st.slits[0]?.width ?? 0; return w > st.lambda ? L * Math.tan(Math.asin(st.lambda / w)) : NaN; };
  const singleMin = !two && slitMode && s.slits[0] ? singleMinFor(s, model.L) : NaN;
  const noSingleMin = !two && slitMode && !!s.slits[0] && s.slits[0].width <= s.lambda;
  const pairLabel = (q: { a: number; b: number }) => { const ids = (slitMode ? [...s.slits].sort((a, b) => a.y - b.y) : [...s.sources].sort((a, b) => a.y - b.y)).map(z => z.id); return `${ids[q.a]}–${ids[q.b]}`; };

  let main: string, why: string, tone = "info";
  const words = slitMode ? "slits" : "sources";
  if (two && model.ruleOK) {
    main = `λ = ${fmt(s.lambda, 2)} ${lu}, d = ${fmt(model.d, digits(model.d))} ${lu}, L = ${fmt(model.L, 1)} ${lu}: ${Number.isFinite(model.measured) ? `fringes ${fmt(model.measured, 2)} ${lu} apart on the screen` : "the fringes are wider than this screen"}; λL/d = ${fmt(model.predicted, 2)} ${lu}.`;
    why = !Number.isFinite(model.measured) ? `With the ${words} this close the bright fringes spread out past the edge of the screen. Move the ${words} apart or shorten λ to bring them back.`
      : Math.abs(model.measured / model.predicted - 1) > 0.05
      ? `They differ by ${fmt(Math.abs(model.measured / model.predicted - 1) * 100, 0)}% because λL/d is the small-angle version: it needs d ≪ L and λ ≪ d. The exact rule is d sin θ = mλ.`
      : "Bright fringes sit where the paths from the two openings differ by a whole number of wavelengths (d sin θ = mλ). For small angles that makes them λL/d apart.";
  } else if (two && model.pts.length === 2) {
    main = `λ = ${fmt(s.lambda, 2)} ${lu}, the two ${words} are ${fmt(model.d, digits(model.d))} ${lu} apart${model.aligned ? "" : ", not side by side across the beam"}: the curve on the right is the summed intensity on the screen.`;
    why = model.aligned ? `λL/d needs λ < d: with λ ≥ d there is no first-order bright fringe at all. Drop the marker to read the actual path difference.`
      : "λL/d only describes two openings side by side across the beam, with a distant screen. For this layout use the actual paths: bright where they differ by a whole number of wavelengths. Drop the marker to read them.";
  } else if (two) {
    main = `λ = ${fmt(s.lambda, 2)} ${lu}, ${model.pts.length} ${words}: the curve on the right is the sum of all their wavelets.`;
    why = "Each pair of openings adds its own fringe term, and the pattern on the screen is the sum of them all, so no single pair's separation sets the spacing. Drop the marker to see each pair's path difference.";
  } else if (!slitMode) {
    main = `λ = ${fmt(s.lambda, 2)} ${lu}, one point source: the screen intensity falls off smoothly.`;
    why = "A single point source has neither slit width nor interference fringes. Add a second source to make them.";
  } else {
    main = `λ = ${fmt(s.lambda, 2)} ${lu}, slit width w = ${fmt(s.slits[0]?.width ?? 0, 2)} ${lu}: ${noSingleMin ? "There is no first dark band at a finite position on this screen (w ≤ λ, so w sin θ = λ has no solution)." : `first dark band ${Number.isFinite(singleMin) ? `${fmt(singleMin, 2)} ${lu} from the centre` : "off the screen"} (far-field prediction, w sin θ = λ).`}`;
    why = noSingleMin ? "A single slit is many wavelets side by side. With the slit no wider than one wavelength, the paths from its two edges can never differ by a whole wavelength, so the central band spreads across the whole screen."
      : "A single slit is many wavelets side by side. At the first dark band, the paths from the slit's two edges to that point differ by one wavelength, so each wavelet in the top half cancels its partner in the bottom half. A narrower slit spreads the light more.";
  }
  if (mi && "pairs" in mi && mi.pairs) {
    main = `At the marker (y = ${fmt(s.mark!, 2)} ${lu}) the pair path differences are ${mi.pairs.map(q => `${pairLabel(q)} ${fmt(q.delta, 2)} λ`).join(", ")}; intensity ${fmt(mi.rel * 100, 0)}% of the brightest.`;
    why = "Each pair contributes its own term; the intensity here is the sum of all of them, so no one pair decides bright or dark.";
  } else if (mi && "single" in mi) {
    main = `At the marker (y = ${fmt(s.mark!, 2)} ${lu}): intensity ${fmt(mi.rel * 100, 0)}% of the brightest.`;
  } else if (mi) {
    const m = Math.round(mi.delta), frac = mi.delta - m;
    const what = mi.edges ? `the paths from the slit's edges differ by ${fmt(mi.delta, 2)} λ` : `the paths differ by ${fmt(mi.delta, 2)} λ`;
    main = `At the marker (y = ${fmt(s.mark!, 2)} ${lu}) ${what}; intensity ${fmt(mi.rel * 100, 0)}% of the brightest.`;
    if (!mi.edges && Math.abs(frac) < 0.12) { why = `A whole number (${m}) of wavelengths: the crests arrive together and add. ${m === 0 ? "This is the central fringe." : `This is the m = ${m} bright fringe.`}`; tone = "ok"; }
    else if (!mi.edges && Math.abs(Math.abs(frac) - 0.5) < 0.12) { why = `About half a wavelength out: these contributions are nearly opposite in phase. ${mi.rel < 0.02 ? "Almost nothing is left here." : "Unequal amplitudes leave residual intensity."} Here it is ${fmt(mi.rel * 100, 1)}% of the brightest.`; tone = "ok"; }
    else if (mi.edges && Math.abs(Math.abs(mi.delta) - 1) < 0.12) { why = "The paths from the slit's edges differ by one wavelength, so each wavelet in the top half cancels its partner half a wavelength away in the bottom half: dark."; tone = "ok"; }
  }

  const shareIt = () => {
    const bm = baseModel, bmi = markInfo(base, bm);
    const learnerBits = [`λ = ${fmt(base.lambda, 2)} ${lu}`, two ? `d = ${fmt(bm.d, digits(bm.d))} ${lu}` : `w = ${fmt(base.slits[0]?.width ?? 0, 2)} ${lu}`, `L = ${fmt(bm.L, 1)} ${lu}`];
    let learner = ed.unchanged && ed.moves <= 1 ? "I picked something up and put it back; nothing changed." : `With ${learnerBits.join(", ")}, ${two ? (Number.isFinite(bm.measured) ? `the fringes are ${fmt(bm.measured, 2)} ${lu} apart` : "the fringes spread past the edge of the screen") : "this is the pattern I get"}.`;
    let reply: string;
    const markLook = (r: number) => r > 0.6 ? "bright" : r < 0.12 ? "dark" : "in between";
    if (bmi && Number.isFinite(bmi.delta)) learner += ` At my marker the ${bmi.edges ? "paths from the edges" : "paths"} differ by ${fmt(bmi.delta, 2)} wavelengths and it is ${markLook(bmi.rel)} (${fmt(bmi.rel * 100, 0)}% of the brightest).`;
    else if (bmi) learner += ` At my marker the intensity is ${fmt(bmi.rel * 100, 0)}% of the brightest.`;
    const fl = [...found].map(f => findingLabel(c, f as WaveFinding));
    if (fl.length) learner += ` I found: ${fl.join("; ")}.`;
    const w0 = base.slits[0]?.width ?? 0;
    if (two && !bm.ruleOK) {
      reply = bm.pts.length > 2
        ? `With ${bm.pts.length} openings each pair adds its own fringe term, and the pattern on the screen is their sum, so no single pair's λL/d gives the spacing.`
        : bm.aligned ? "With λ ≥ d there is no first-order bright fringe, so λL/d doesn't apply; the screen shows the summed intensity."
        : `Your ${slitMode ? "slits" : "sources"} are not side by side across the beam, so λL/d doesn't describe this layout. The screen curve is the summed intensity; at any point, bright or dark depends on the actual path difference.`;
      if (bmi && "pairs" in bmi && bmi.pairs) reply += ` At your marker: ${bmi.pairs.map(q => `${pairLabel(q)} ${fmt(q.delta, 2)} λ`).join(", ")}, and the summed intensity is ${fmt(bmi.rel * 100, 0)}% of the brightest.`;
      else if (bmi && Number.isFinite(bmi.delta)) reply += ` At your marker the paths differ by ${fmt(bmi.delta, 2)} λ and the intensity is ${fmt(bmi.rel * 100, 0)}% of the brightest.`;
    } else if (two) {
      reply = !Number.isFinite(bm.measured) ? `With d = ${fmt(bm.d, digits(bm.d))} ${lu}, λL/d = ${fmt(bm.predicted, 2)} ${lu}: wider than half your screen, so no second bright fringe lands on it. Closer slits spread the pattern; move them apart to bring the fringes back. ` : `Your numbers check out: λL/d = ${fmt(base.lambda, 2)} × ${fmt(bm.L, 1)} / ${fmt(bm.d, digits(bm.d))} = ${fmt(bm.predicted, 2)} ${lu}, against ${fmt(bm.measured, 2)} ${lu} measured on the screen. `;
      reply += found.has("spacing") ? "When you changed λ the spacing changed roughly in proportion: at small angles the nominal spacing is approximately λL/d, and the exact angles obey d sin θ = mλ. " : "Try dragging the wavelength: at small angles the spacing is approximately λL/d, so it follows λ roughly in proportion (exactly, d sin θ = mλ). ";
      if (bmi) reply += Math.abs(bmi.delta - Math.round(bmi.delta)) < 0.12 ? `Your marker sits on a whole number of wavelengths (${Math.round(bmi.delta)}), so the waves arrive in step. ` : Math.abs(Math.abs(bmi.delta - Math.round(bmi.delta)) - 0.5) < 0.12 ? `Your marker sits about half a wavelength out: the two contributions are nearly opposite in phase, and the intensity there is ${fmt(bmi.rel * 100, 1)}% of the brightest${bmi.rel >= 0.02 ? " because unequal amplitudes leave residual intensity" : ""}. ` : "";
      if (found.has("width")) reply += "And widening a slit didn't shift the fringe positions much: at small angles the nominal spacing is approximately λL/d, and finite slit width shapes the envelope the fringes sit under.";
    } else {
      const sm = singleMinFor(base, bm.L);
      reply = !slitMode ? "A single point source has neither slit width nor interference fringes: its intensity on the screen just falls off with distance. Add a second source to see fringes."
        : w0 <= base.lambda ? `For a single slit of width ${fmt(w0, 2)} ${lu} (no wider than λ = ${fmt(base.lambda, 2)} ${lu}) there is no first dark band at a finite position on this screen: w sin θ = λ has no solution, so the central band spreads across it.`
        : `For a single slit of width ${fmt(w0, 2)} ${lu} the first dark band is where the paths from the slit's two edges differ by one wavelength, w sin θ = λ: in the far field about ${fmt(sm, 2)} ${lu} from the centre here. Narrow the slit and the pattern spreads: confining the wave makes it diffract more.`;
    }
    onShare?.({ learner, reply, data: `waves · ${learnerBits.join(", ")}${two ? ` · spacing ${Number.isFinite(bm.measured) ? fmt(bm.measured, 3) : "off screen"} vs λL/d ${fmt(bm.predicted, 3)}` : ""}${bmi ? ` · marker Δ = ${fmt(bmi.delta, 2)}λ` : ""} · found ${found.size}/${findings.length}` });
  };

  const svgH = MH + 18;
  return <Shell title={c.title} goal={c.goal} dragging={dragging} mode="waves" note={`${c.scaleNote ?? "Coherent waves, time-averaged intensity"}${c.soundSpeed ? ` · f = c/λ ≈ ${fmt(c.soundSpeed / s.lambda, 0)} Hz` : ""}`}>
    <div className="pl-canvas" ref={wrap}>
      <div className="pl-stage" ref={root} style={{ height: svgH }}>
        <canvas ref={canvas} className="pl-layer" style={{ left: 0, width: MW, height: MH }} aria-hidden="true" />
        <svg ref={svg} width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} role="group" aria-label="Interference pattern">
          <rect x={0} y={0} width={MW} height={MH} className="pl-frame" />
          {/* Beyond the screen: nothing (the screen absorbs). */}
          <rect x={X(s.screenX)} y={0} width={Math.max(0, MW - X(s.screenX))} height={MH} className="pl-beyond" />
          {crestLines.map((x, i) => <line key={i} x1={x} x2={x} y1={0} y2={MH} className={i === crestN - 1 ? "pl-crest is-key" : "pl-crest"} />)}
          {!slitMode && s.sources[0] && <circle cx={X(s.sources[0].x)} cy={Y(s.sources[0].y)} r={crestN * s.lambda * ppu} className="pl-crest-ring" />}
          {barrierSegs.map(([a, b], i) => <line key={i} x1={X(barrierX)} x2={X(barrierX)} y1={Y(a)} y2={Y(b)} className="pl-barrier" />)}
          {/* fringe ticks predicted by λL/d, on the screen */}
          {fringeTicks.map((y, i) => <line key={i} x1={X(s.screenX) - 5} x2={X(s.screenX)} y1={Y(y)} y2={Y(y)} className="pl-fringe-tick" />)}
          <g {...screenMove} className="pl-screen" tabIndex={0} role="slider" aria-label="Screen distance" aria-valuemin={c.screen.min} aria-valuemax={c.screen.max} aria-valuenow={s.screenX} aria-valuetext={`L = ${fmt(model.L, 1)} ${lu}`}
            onKeyDown={e => keyStep(e, { left: () => setScreen(base.screenX - pstep * 5), right: () => setScreen(base.screenX + pstep * 5), down: () => setScreen(base.screenX - pstep * 5), up: () => setScreen(base.screenX + pstep * 5) })}>
            <rect className="pl-hit" x={X(s.screenX) - 10} y={0} width={20} height={MH} />
            <line x1={X(s.screenX)} x2={X(s.screenX)} y1={0} y2={MH} className="pl-screen-line" />
            <rect x={X(s.screenX) - 5} y={MH / 2 - 14} width={10} height={28} rx={3} className="pl-screen-grip" />
          </g>
          <text x={X(s.screenX) - 6} y={MH - 6} textAnchor="end" className="pl-tick">{narrow ? "" : "screen · "}L = {fmt(model.L, 1)} {lu}</text>
          {/* the profile: intensity across the screen */}
          <line x1={PX + 4} x2={PX + 4} y1={0} y2={MH} className="pl-axis" />
          {envPath && <path d={envPath} className="pl-envelope" />}
          <path d={profPath} className="pl-profile" />
          <text x={PX + 4} y={MH + 13} className="pl-tick">intensity</text>
          {two && Number.isFinite(model.predicted) && Math.abs(model.predicted) < c.view.yHalf && <g className="pl-bracket">
            <path d={`M${PX + PRW - 4} ${Y(model.meanY)} h-4 V${Y(model.meanY + model.predicted)} h4`} />
            <text x={PX + PRW - 10} y={Y(model.meanY + model.predicted / 2) + 3} textAnchor="end">λL/d</text>
          </g>}
          {/* the marker on the screen */}
          <g {...markMove} className="pl-marker" tabIndex={0} role="slider" aria-label="Marker on the screen" aria-valuemin={-c.view.yHalf} aria-valuemax={c.view.yHalf} aria-valuenow={s.mark ?? 0} aria-valuetext={mi ? `y = ${fmt(s.mark!, 2)}${Number.isFinite(mi.delta) ? `, path difference ${fmt(mi.delta, 2)} wavelengths` : `, intensity ${fmt(mi.rel * 100, 0)}% of the brightest`}` : "not placed"}
            onKeyDown={e => keyStep(e, { up: () => setMark((base.mark ?? 0) + pstep), down: () => setMark((base.mark ?? 0) - pstep), right: () => setMark((base.mark ?? 0) + pstep), left: () => setMark((base.mark ?? 0) - pstep) })}>
            <circle className="pl-hit" cx={PX + 4} cy={Y(s.mark ?? c.view.yHalf * 0.8)} r={14} />
            <path d={`M${PX - 4} ${Y(s.mark ?? c.view.yHalf * 0.8) - 6} l8 6 l-8 6 z`} className={s.mark == null ? "pl-mark-tri is-docked" : "pl-mark-tri"} />
            {s.mark == null && <text x={PX - 8} y={Y(c.view.yHalf * 0.8) + 4} textAnchor="end" className="pl-tick">marker</text>}
          </g>
          {mi && model.pts.length >= 2 && <g className="pl-paths">
            <line x1={X(model.pts[0].x)} y1={Y(model.pts[0].y)} x2={X(s.screenX)} y2={Y(s.mark!)} />
            <line x1={X(model.pts[1].x)} y1={Y(model.pts[1].y)} x2={X(s.screenX)} y2={Y(s.mark!)} />
          </g>}
          {/* the wavelength handle: a crest of the incoming wave */}
          <g {...lamMove} className="pl-lam" tabIndex={0} role="slider" aria-label="Wavelength" aria-valuemin={c.wavelength.min} aria-valuemax={c.wavelength.max} aria-valuenow={s.lambda} aria-valuetext={`${fmt(s.lambda, 2)} ${lu}`}
            onKeyDown={e => keyStep(e, { left: () => setLam(base.lambda + (slitMode ? lstep : -lstep)), right: () => setLam(base.lambda - (slitMode ? lstep : -lstep)), up: () => setLam(base.lambda + lstep), down: () => setLam(base.lambda - lstep), home: () => setLam(c.wavelength.min), end: () => setLam(c.wavelength.max) })}>
            <circle className="pl-hit" cx={lamHandle.x} cy={lamHandle.y} r={15} />
            <circle className="pl-knob" cx={lamHandle.x} cy={lamHandle.y} r={6} />
            <text x={lamHandle.x + 9} y={lamHandle.y - 10} className="pl-knob-label">λ = {fmt(s.lambda, 2)}</text>
          </g>
          {slitMode && s.slits.map(q => <g key={q.id}>
            <g {...slitMove(q.id)} className="pl-slit" tabIndex={0} role="slider" aria-label={`Slit ${q.id} position`} aria-valuemin={-c.view.yHalf} aria-valuemax={c.view.yHalf} aria-valuenow={q.y} aria-valuetext={`centre ${fmt(q.y, 2)} ${lu}, width ${fmt(q.width, 2)} ${lu}`}
              onKeyDown={e => keyStep(e, { up: () => nudgeSlit(q.id, pstep * 2, 0), down: () => nudgeSlit(q.id, -pstep * 2, 0), plus: () => nudgeSlit(q.id, 0, pstep), minus: () => nudgeSlit(q.id, 0, -pstep), right: () => nudgeSlit(q.id, 0, pstep), left: () => nudgeSlit(q.id, 0, -pstep) })}>
              <rect className="pl-hit" x={X(barrierX) - 24} y={Y(q.y) - 9} width={21} height={18} />
              <path d={`M${X(barrierX) - 6} ${Y(q.y)} h-11`} className="pl-slit-grip" />
            </g>
            <g {...edgeMove(q.id)} className="pl-edge" tabIndex={-1} aria-hidden="true">
              <circle className="pl-hit" cx={X(barrierX) + 12} cy={Y(q.y + q.width / 2)} r={9} />
              <path d={`M${X(barrierX) + 3} ${Y(q.y + q.width / 2)} h7`} className="pl-edge-stem" />
              <circle className="pl-edge-knob" cx={X(barrierX) + 12} cy={Y(q.y + q.width / 2)} r={3.5} />
            </g>
            <text x={X(barrierX) + 19} y={Y(q.y) + 9} className="pl-tick">{q.id}</text>
          </g>)}
          {!slitMode && s.sources.map(q => <g key={q.id} {...srcMove(q.id)} className="pl-source" tabIndex={0} role="button" aria-roledescription="draggable source" aria-label={`Source ${q.id} at (${fmt(q.x, 1)}, ${fmt(q.y, 1)}) ${lu}. Arrow keys move it.`}
            onKeyDown={e => keyStep(e, { up: () => nudgeSrc(q.id, 0, pstep * 2), down: () => nudgeSrc(q.id, 0, -pstep * 2), left: () => nudgeSrc(q.id, -pstep * 2, 0), right: () => nudgeSrc(q.id, pstep * 2, 0) })}>
            <circle className="pl-hit" cx={X(q.x)} cy={Y(q.y)} r={15} />
            <circle className="pl-src" cx={X(q.x)} cy={Y(q.y)} r={6} />
            <text x={X(q.x) - 9} y={Y(q.y) + 4} textAnchor="end" className="pl-tick">{q.id}</text>
          </g>)}
          {[c.view.x0, 0, c.view.x1].filter((v, i, a) => a.indexOf(v) === i && v >= c.view.x0 && v <= c.view.x1).map(v => <text key={v} x={clamp(X(v), 10, MW - 10)} y={MH + 13} textAnchor="middle" className="pl-tick">{fmt(v, 0)}</text>)}
          <text x={MW / 2} y={MH + 13} textAnchor="middle" className="pl-tick">{lu}</text>
        </svg>
      </div>
    </div>
    <Found items={findings.map(f => ({ id: f, label: findingLabel(c, f) }))} found={found} />
    <div className={`pl-readout pl-tone-${tone}`}>
      <p className="pl-line">{main}</p>
      <p className="pl-why">{why}</p>
      <p className="pl-sr" role="status">{msg}</p>
    </div>
    <div className="pl-toggles">
      <button type="button" className="pl-toggle" aria-pressed={crests} onClick={() => setCrests(v => !v)}>{crests ? "Show the intensity" : "Show the crests"}{crests && (reduced || renderer !== "webgl") ? " (still frame)" : ""}</button>
    </div>
    <Disclosure label="Use buttons instead">
      <div className="pl-rows">
        <div className="pl-row"><span>Wavelength {fmt(base.lambda, 2)} {lu}</span><span className="pl-row-btns"><button type="button" onClick={() => setLam(base.lambda - lstep)}>shorter</button><button type="button" onClick={() => setLam(base.lambda + lstep)}>longer</button></span></div>
        <div className="pl-row"><span>Screen at {fmt(base.screenX, 1)} {lu}</span><span className="pl-row-btns"><button type="button" onClick={() => setScreen(base.screenX - pstep * 10)}>nearer</button><button type="button" onClick={() => setScreen(base.screenX + pstep * 10)}>farther</button></span></div>
        {base.slits.map(q => <div className="pl-row" key={q.id}><span>Slit {q.id}: centre {fmt(q.y, 2)}, width {fmt(q.width, 2)} {lu}</span><span className="pl-row-btns">
          <button type="button" onClick={() => nudgeSlit(q.id, pstep * 2, 0)} aria-label={`Move slit ${q.id} up`}>↑</button><button type="button" onClick={() => nudgeSlit(q.id, -pstep * 2, 0)} aria-label={`Move slit ${q.id} down`}>↓</button>
          <button type="button" onClick={() => nudgeSlit(q.id, 0, -pstep)}>narrower</button><button type="button" onClick={() => nudgeSlit(q.id, 0, pstep)}>wider</button></span></div>)}
        {base.sources.map(q => <div className="pl-row" key={q.id}><span>Source {q.id} at ({fmt(q.x, 1)}, {fmt(q.y, 1)})</span><span className="pl-row-btns">
          <button type="button" onClick={() => nudgeSrc(q.id, 0, pstep * 2)} aria-label={`Move source ${q.id} up`}>↑</button><button type="button" onClick={() => nudgeSrc(q.id, 0, -pstep * 2)} aria-label={`Move source ${q.id} down`}>↓</button>
          <button type="button" onClick={() => nudgeSrc(q.id, -pstep * 2, 0)} aria-label={`Move source ${q.id} left`}>←</button><button type="button" onClick={() => nudgeSrc(q.id, pstep * 2, 0)} aria-label={`Move source ${q.id} right`}>→</button></span></div>)}
        <div className="pl-row"><span>Marker {base.mark == null ? "not placed" : `at y = ${fmt(base.mark, 2)} ${lu}`}</span><span className="pl-row-btns">
          {base.mark == null ? <button type="button" onClick={() => setMark(two ? baseModel.meanY + baseModel.predicted : 0)}>Place it</button> : <>
            <button type="button" onClick={() => setMark(base.mark! + pstep)} aria-label="Marker up">↑</button><button type="button" onClick={() => setMark(base.mark! - pstep)} aria-label="Marker down">↓</button>
            <button type="button" onClick={() => setMark(null)}>Remove</button></>}</span></div>
      </div>
    </Disclosure>
    <Disclosure label="How this is drawn">
      <div className="pl-eq">
        <p>Every opening is a row of coherent Huygens wavelets (amplitude ∝ 1/√r, as for waves on a surface), summed exactly; nothing assumes small angles. The map shows time-averaged intensity, scaled by distance so the fringes show everywhere; the curve on the right is the true intensity across the screen{slitMode && two ? ", under the dashed single-slit envelope sinc²(πw sin θ/λ)" : ""}. Rendered with {renderer === "webgl" ? "a WebGL shader" : renderer === "cpu" ? "the CPU fallback" : "…"}.</p>
        <p>λL/d is the small-angle form of d sin θ = mλ (Hecht, Optics 5e, §9.3). It needs λ ≪ d ≪ L.</p>
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={() => { ed.undo(); setMsg("Undid the last move."); }} reset={() => { ed.reset(); setFound(new Set()); setTried([]); setMsg("Started over."); }} share={onShare ? shareIt : undefined} />
  </Shell>;
}
export type { Wavelet };
