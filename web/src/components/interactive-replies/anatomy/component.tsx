import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./component.css";
import {
  CT_LEVELS_CAVEAT, edges, getModel, hasActed, inSlice, levelAt, levelCenter, LEVEL_NOTES, nameOf, parseLevel, project, slice, stepNote, structureOf, summarize,
  theName, validate, webglAvailable, wrongTurn, yRange,
  type Anatomy3DConfig, type Model, type Progress, type ShareSummary, type SliceShape, type Structure, type V3,
} from "./engine";
import type { AnatomyView } from "./view3d";

export type { Anatomy3DConfig, Anatomy3DMode, ShareSummary } from "./engine";

/* ------------------------------------------------------------------ catalogue exports */
export function validateAnatomy3D(config: unknown): string[] { return validate(config); }

export const presets: Record<string, Anatomy3DConfig> = {
  heartLabel: { model: "heart", mode: "label", targets: ["rightAtrium", "rightVentricle", "leftAtrium", "leftVentricle", "tricuspidValve", "pulmonaryValve", "mitralValve", "aorticValve"],
    question: "Drag each name onto its chamber or valve. Turn the heart by dragging the space around it, and pull a chamber aside to see the valve behind it." },
  heartTrace: { model: "heart", mode: "trace", route: ["superiorVenaCava", "rightAtrium", "tricuspidValve", "rightVentricle", "pulmonaryValve", "pulmonaryTrunk", "pulmonaryArteries", "pulmonaryVeins", "leftAtrium", "mitralValve", "leftVentricle", "aorticValve", "aorta"],
    question: "Drag the drop of blood from the superior vena cava to the aorta, one chamber or valve at a time." },
  thoraxT4: { model: "thoracicCrossSection", mode: "section", level: "T4", targets: ["aorta", "superiorVenaCava", "trachea", "esophagus"],
    question: "Drag the plane down to T4, then name the four structures on the slice." },
  thoraxT8: { model: "thoracicCrossSection", mode: "section", level: "T8", targets: ["rightAtrium", "rightVentricle", "leftVentricle", "aorta", "esophagus", "azygosVein"],
    question: "Drag the plane to T8 and name what the slice shows." },
  coronaryLabel: { model: "heart", mode: "label", targets: ["rightCoronaryArtery", "leftCoronaryArtery", "leftAnteriorDescending", "circumflexArtery", "aorta"],
    title: "Coronary arteries", question: "Name the coronary arteries. Turn the heart to follow the circumflex and the RCA round the back." },
  heartExplore: { model: "thoracicCrossSection", mode: "explore", targets: ["leftAtrium"],
    question: "Which chamber lies just in front of the esophagus, so it's the one seen best on a transesophageal echo?" },
};
export const scenario = {
  tab: "Anatomy",
  prompt: "I keep mixing up the heart's chambers and valves. Can you quiz me?",
  intro: "Here's a heart you can turn and take apart. Drag each name onto the chamber or valve it belongs to. A wrong drop tells you what you actually hit and how to tell them apart.",
  receiptLabel: "Schematic heart · label quiz",
  receiptText: "A schematic, topologically correct heart (not to scale), built from the relations in Moore's Clinically Oriented Anatomy (ch. 4), Gray's Anatomy (thorax section) and Netter's Atlas (plates on the heart). Oxygenated blood is red and deoxygenated blue, as in atlases. Educational model, not for clinical use.",
  preset: "heartLabel",
};
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  heartLabel: { label: "Label the heart", prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  heartTrace: { label: "Trace blood flow", prompt: "What's the actual order blood goes through the heart? I always lose track after the right ventricle.",
    intro: "Drag the drop of blood yourself, from the superior vena cava to the aorta. Each step is one chamber or one valve. A wrong turn stays put and I'll tell you why blood can't go that way.",
    receiptLabel: "Schematic heart · blood-flow trace", receiptText: "Flow graph: venae cavae → RA → tricuspid → RV → pulmonary valve → pulmonary trunk → pulmonary arteries → lungs → pulmonary veins → LA → mitral → LV → aortic valve → aorta (Moore ch. 4). Schematic geometry. Educational model, not for clinical use." },
  thoraxT4: { label: "Section at T4", prompt: "How am I supposed to recognise the aortic arch on an axial CT? Everything looks like blobs.",
    intro: "Drag the plane through the chest and watch the slice, which is shown the way CT is read: from the feet, with the patient's right on your left. Stop at T4 and name what you see.",
    receiptLabel: "Schematic thorax · axial section", receiptText: "Traditional teaching levels: sternal angle plane at the T4/T5 disc; arch begins and ends there; carina at T4/T5 (Moore ch. 4). On CT these structures often lie at T5–T6 (Mirjalili et al., Clin Anat 2012), so identify them directly. Slices are computed from schematic geometry, not imaging data. Educational model, not for clinical use." },
  thoraxT8: { label: "Section at T8", prompt: "Can we go through what a CT slice at T8 shows? Lower thorax always confuses me.",
    intro: "Drag the plane down to T8. The slice beside it updates as you go, read from the feet like a CT. Then put the names on the structures you see.",
    receiptLabel: "Schematic thorax · axial section", receiptText: "At T8, the traditional level of the caval opening (IVC; on CT it is often lower, Mirjalili et al., Clin Anat 2012): esophagus in front of and to the right of the descending aorta; azygos on the right of the vertebral bodies (Moore ch. 4). Schematic geometry. Educational model, not for clinical use." },
  coronaryLabel: { label: "Coronary arteries", prompt: "Which coronary artery is which? I can never keep the LAD and circumflex straight.",
    intro: "Here are the coronary arteries on a schematic heart. Drag each name onto its vessel, and turn the heart to follow the ones that run round the back.",
    receiptLabel: "Schematic heart · coronary label quiz", receiptText: "RCA from the right aortic sinus in the right AV groove; left main from the left sinus, dividing into LAD (anterior interventricular groove) and circumflex (left AV groove) (Moore ch. 4). Nodal supply varies: SA-node artery from the RCA in 63% and AV-node artery in 90% of 150 dissected hearts (Pejković et al., J Int Med Res 2008); right dominance in 81.6% of 5,548 angiograms (Altin et al., Singapore Med J 2015). Educational model, not for clinical use." },
  heartExplore: { label: "Explore", prompt: "Why do they do echo through the esophagus to look at the left atrium?",
    intro: "Turn the chest round and pull the chambers out of the way. Tap any structure to see what it is. The left atrium is highlighted: find what lies behind it.",
    receiptLabel: "Schematic thorax · explore", receiptText: "The left atrium is the most posterior chamber (Moore ch. 4). The esophagus runs close behind it, across the fibrous pericardium and a variable fibrofatty layer (Sánchez-Quintana et al., Circulation 2005), which is why transesophageal echocardiography sees it so well. Schematic geometry. Educational model, not for clinical use." },
};

/* ------------------------------------------------------------------ test hook */
type Hook = Record<string, (...a: never[]) => unknown>;
declare global { interface Window { keatingAnatomy?: Hook } }

const DEFAULT_TITLE: Record<string, string> = { label: "Name the structures", trace: "Trace the blood", section: "Read the slice", explore: "Explore the model" };
const emptyProgress = (mode: Progress["mode"], start: string[], planeY: number): Progress => ({ mode, placed: [], attempts: [], path: start, turns: [], planeY, planeMoved: false, inspected: [], pulled: [] });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ component */
export function Anatomy3D(props: { config: Anatomy3DConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const errors = useMemo(() => validateAnatomy3D(props.config), [props.config]);
  if (errors.length) return <section className="activity anatomy" aria-label="Anatomy model">
    <p className="an-fallback">This anatomy model couldn’t start: {errors[0]}.</p>
  </section>;
  return <Anatomy3DInner {...props} />;
}

type Drag =
  | { kind: "orbit"; x0: number; y0: number; yaw0: number; pitch0: number }
  | { kind: "pull"; id: string; x0: number; y0: number; moved: boolean }
  | { kind: "plane"; y0: number; ref?: [number, number] }
  | { kind: "label"; label: string; over: string | null }
  | { kind: "token"; over: string | null };

function Anatomy3DInner({ config: cfg, onChange, onShare }: { config: Anatomy3DConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const model = getModel(cfg.model);
  const uid = useId().replace(/:/g, "");
  const [lo, hi] = useMemo(() => yRange(model), [model]);
  const targetLevel = cfg.level ? parseLevel(cfg.level) : 0;
  const startY = cfg.mode === "section" ? clamp(levelCenter(targetLevel === 6 ? 9 : 6), lo + 0.5, hi - 0.5) : levelCenter(6);
  const route = cfg.route ?? [];
  const targets = cfg.targets ?? [];
  const fresh = useCallback(() => emptyProgress(cfg.mode, cfg.mode === "trace" ? [route[0]] : [], startY), [cfg.mode, route[0], startY]);
  const [progress, setProgress] = useState<Progress>(fresh);
  const [history, setHistory] = useState<Progress[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: "ok" | "off" | "info" }>({ text: "", tone: "info" });
  const [gl, setGl] = useState<"pending" | "3d" | "2d">("pending");
  const [hover, setHover] = useState<string | null>(null);
  const [pull, setPull] = useState<{ id: string; off: V3 } | null>(null);
  const [kbPulled, setKbPulled] = useState<string | null>(null);
  const [liveY, setLiveY] = useState<number | null>(null);          // plane while dragging
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rot, setRot] = useState(() => ({ yaw: cfg.mode === "section" ? -0.25 : -0.12, pitch: cfg.mode === "section" ? 0.5 : 0.12 }));
  const [reduced, setReduced] = useState(false);
  const [wide, setWide] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const flatRef = useRef<SVGSVGElement>(null);
  const sliceRef = useRef<SVGSVGElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<AnatomyView | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tries = useRef<Record<string, number>>({});
  const planeY = liveY ?? progress.planeY;
  const atLevel = !targetLevel || levelAt(planeY).label === cfg.level;
  const current = progress.path[progress.path.length - 1];
  const finished = cfg.mode === "label" || cfg.mode === "section" ? progress.placed.length === targets.length : cfg.mode === "trace" ? progress.path.length === route.length : false;

  /* After mount: pick 3D or the 2D fallback, read motion and width preferences (nothing of this during render). */
  useEffect(() => {
    let cancelled = false;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(!!mq?.matches);
    const card = cardRef.current!;
    const ro = new ResizeObserver(() => setWide(card.clientWidth >= 560)); ro.observe(card); setWide(card.clientWidth >= 560);
    /* Probe WebGL first: without it, render the flat view now and never fetch the three.js chunk. */
    if (!webglAvailable()) { setGl("2d"); return () => { cancelled = true; ro.disconnect(); }; }
    import("./view3d").then(({ createView }) => {
      if (cancelled) return;
      try { viewRef.current = createView(stageRef.current!, model, { section: cfg.mode === "section", reducedMotion: !!mq?.matches }); setGl("3d"); }
      catch { setGl("2d"); }
    }).catch(() => !cancelled && setGl("2d"));
    return () => { cancelled = true; ro.disconnect(); viewRef.current?.destroy(); viewRef.current = null; };
  }, [model, cfg.mode]);

  /* Keep the 3D view in sync with component state */
  const highlights = useMemo(() => {
    const h: string[] = [];
    if (hover) h.push(hover);
    if (drag?.kind === "pull") h.push(drag.id);
    if (cfg.mode === "explore") for (const t of targets) if (!h.includes(t)) h.push(t);
    return h;
  }, [hover, drag, cfg.mode, targets.join()]);
  const pathPoints = useMemo(() => progress.path.map(id => structureOf(model, id)!.anchor), [progress.path, model]);
  useEffect(() => {
    const v = viewRef.current; if (!v || gl !== "3d") return;
    v.setRotation(rot.yaw, rot.pitch); v.setHighlight(highlights);
    v.setSection(cfg.mode === "section" ? planeY : null);
    v.setPath(cfg.mode === "trace" ? pathPoints : []);
  }, [gl, rot, highlights, planeY, pathPoints, cfg.mode]);
  useEffect(() => {
    const v = viewRef.current; if (!v || gl !== "3d") return;
    for (const s of model.structures) v.setOffset(s.id, pull?.id === s.id ? pull.off : kbPulled === s.id ? pullOut(model, s) : null);
  }, [gl, pull, kbPulled, model]);

  /* Overlay (pins, placed names, token, plane grip): positioned from projections every frame */
  const pointOf = useCallback((p: V3, id?: string): { x: number; y: number } | null => {
    if (gl === "3d") return viewRef.current?.project(p) ?? null;
    const svg = flatRef.current; if (!svg) return null;
    const ctm = svg.getScreenCTM(); if (!ctm) return null;
    const off = id && pull?.id === id ? pull.off : id && kbPulled === id ? pullOut(model, structureOf(model, id)!) : [0, 0, 0];
    const q = new DOMPoint(p[0] + off[0], -(p[1] + off[1])).matrixTransform(ctm);
    return { x: q.x, y: q.y };
  }, [gl, pull, kbPulled, model]);
  const layout = useCallback(() => {
    const ov = overlayRef.current, st = stageRef.current; if (!ov || !st) return;
    const r = st.getBoundingClientRect();
    for (const el of Array.from(ov.querySelectorAll<HTMLElement>("[data-at]"))) {
      const id = el.dataset.at!;
      const s = structureOf(model, id); if (!s) continue;
      const p = pointOf(s.anchor, id);
      if (!p) { el.style.visibility = "hidden"; continue; }
      el.style.visibility = "";
      el.style.transform = `translate(${(p.x - r.left).toFixed(1)}px, ${(p.y - r.top).toFixed(1)}px)`;
    }
    const grip = ov.querySelector<HTMLElement>("[data-grip]");
    if (grip) {
      const p = pointOf([model.center[0] + model.radius * (gl === "3d" ? 0.9 : 0.7), planeY, model.center[2]]);
      if (p) grip.style.transform = `translate(0px, ${clamp(p.y - r.top, 8, r.height - 8).toFixed(1)}px)`;
    }
  }, [model, pointOf, planeY, gl]);
  useEffect(() => { viewRef.current?.onFrame(layout); }, [layout, gl]);
  useLayoutEffect(() => { if (gl === "2d") layout(); });
  useEffect(() => { if (gl !== "2d") return; const st = stageRef.current!; const ro = new ResizeObserver(() => layout()); ro.observe(st); return () => ro.disconnect(); }, [gl, layout]);

  /* ---------- picking ---------- */
  const pickStage = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as Element | null;
    const pin = el?.closest?.("[data-pin]") as HTMLElement | null;
    if (pin && stageRef.current?.contains(pin)) return pin.dataset.pin!;
    if (gl === "3d") { const st = stageRef.current!.getBoundingClientRect(); if (x < st.left || x > st.right || y < st.top || y > st.bottom) return null; return viewRef.current?.pick(x, y) ?? null; }
    const hit = el?.closest?.("[data-sid]") as SVGElement | null;
    return hit && flatRef.current?.contains(hit) ? hit.getAttribute("data-sid") : null;
  }, [gl]);
  const pickSlice = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as Element | null;
    const hit = el?.closest?.("[data-slice]") as SVGElement | null;
    return hit && sliceRef.current?.contains(hit) ? hit.getAttribute("data-slice") : null;
  }, []);

  /* ---------- commits ---------- */
  const commit = (next: Progress, fb?: { text: string; tone: "ok" | "off" | "info" }) => {
    setHistory(h => [...h, progress]); setProgress(next); if (fb) setFeedback(fb); onChange?.();
  };
  const placeLabel = (label: string, on: string | null) => {
    if (!on) { setFeedback({ text: `The ${lower(nameOf(model, label))} label didn’t land on anything. Drop it right on a structure${cfg.mode === "section" ? " in the slice" : " or on a numbered pin"}.`, tone: "info" }); return; }
    if (cfg.mode === "section" && !atLevel) { setFeedback({ text: `Move the plane to ${cfg.level} first: the names are for that slice.`, tone: "info" }); return; }
    const ok = on === label;
    const attempt = { label, on, ok };
    if (ok) {
      const s = structureOf(model, label)!;
      commit({ ...progress, placed: [...progress.placed, label], attempts: [...progress.attempts, attempt] },
        { text: `Yes: ${theName(model, label)}. ${cfg.mode === "section" ? s.sliceHint ? cap(s.sliceHint) + "." : s.info : s.info}`, tone: "ok" });
    } else {
      const want = structureOf(model, label)!, hit = structureOf(model, on)!;
      const hint = cfg.mode === "section" ? want.sliceHint ?? want.hint : want.hint;
      const already = progress.placed.includes(on) ? " (you’ve already named that one)" : "";
      commit({ ...progress, attempts: [...progress.attempts, attempt] },
        { text: `That’s ${theName(model, on)}${already}, not ${theName(model, label)}. The ${lower(want.name)} is ${hint}.${hit.tone === "lung" ? "" : ""}`, tone: "off" });
    }
  };
  const moveToken = (to: string | null) => {
    if (!to || to === current) { if (to === current) setFeedback({ text: `The blood is already in ${theName(model, current)}.`, tone: "info" }); return; }
    const step = progress.path.length - 1, next = route[step + 1];
    if (!next) return;
    if (to === next) {
      tries.current[step] = 0;
      const done = progress.path.length + 1 === route.length;
      commit({ ...progress, path: [...progress.path, to] }, { text: `${stepNote(model, current, to)}${done ? ` That’s the whole route, ${route.length - 1} steps.` : ""}`, tone: "ok" });
    } else {
      const n = (tries.current[step] = (tries.current[step] ?? 0) + 1);
      const why = wrongTurn(model, current, to, next, n, route[route.length - 1]);
      commit({ ...progress, turns: [...progress.turns, { from: current, to, why }] }, { text: why, tone: "off" });
    }
  };
  const inspect = (id: string) => {
    const s = structureOf(model, id)!;
    if (cfg.mode === "explore") {
      if (progress.inspected[progress.inspected.length - 1] !== id) setProgress(p => ({ ...p, inspected: [...p.inspected.filter(x => x !== id), id] }));
      setFeedback({ text: `${s.name}. ${s.info}`, tone: "info" }); onChange?.();
    } else if (cfg.mode === "label" && progress.placed.includes(id)) setFeedback({ text: `${s.name}. ${s.info}`, tone: "info" });
  };
  const setPlane = (y: number, announce = true) => {
    const yy = snapLevel(clamp(y, lo, hi));
    commit({ ...progress, planeY: yy, planeMoved: true }, announce ? { text: planeText(model, yy, cfg.level), tone: cfg.level && levelAt(yy).label === cfg.level ? "ok" : "info" } : undefined);
  };

  /* ---------- pointer: stage ---------- */
  const onStageDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gl === "pending" || (e.target as Element).closest("[data-handle]")) return;
    const v = viewRef.current;
    const under = gl === "3d" ? v?.pick(e.clientX, e.clientY) : null;
    if (cfg.mode === "section" && gl === "3d" && v?.hitsPlane(e.clientX, e.clientY) && (!under || structureOf(model, under)!.tone === "lung")) { const q = v.sheetPoint(e.clientX, e.clientY); begin(e, { kind: "plane", y0: progress.planeY, ref: q ? [q[0], q[2]] : undefined }); return; }
    if (cfg.mode === "section" && gl === "2d" && Math.abs(flatYAt(e.clientY) - progress.planeY) < 0.8) { begin(e, { kind: "plane", y0: progress.planeY }); return; }
    const id = pickStage(e.clientX, e.clientY);
    if (id) { begin(e, { kind: "pull", id, x0: e.clientX, y0: e.clientY, moved: false }); return; }
    if (gl === "3d") begin(e, { kind: "orbit", x0: e.clientX, y0: e.clientY, yaw0: rot.yaw, pitch0: rot.pitch });
  };
  const begin = (e: React.PointerEvent, d: Drag) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = d; setDrag(d); e.preventDefault();
  };
  const flatYAt = (cy: number) => {
    const svg = flatRef.current; const ctm = svg?.getScreenCTM(); if (!ctm) return 0;
    return -new DOMPoint(0, cy).matrixTransform(ctm.inverse()).y;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) {
      if (cfg.mode === "explore" && e.pointerType === "mouse" && (e.target as Element).closest(".an-stage")) { const id = pickStage(e.clientX, e.clientY); if (id !== hover) setHover(id); }
      return;
    }
    if (d.kind === "orbit") setRot({ yaw: d.yaw0 + (e.clientX - d.x0) * 0.011, pitch: clamp(d.pitch0 + (e.clientY - d.y0) * 0.011, -1.3, 1.3) });
    else if (d.kind === "pull") {
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      const off: V3 = gl === "3d" ? viewRef.current!.worldDelta(dx, dy) : flatDelta(dx, dy);
      setPull({ id: d.id, off });
    } else if (d.kind === "plane") {
      const y = gl === "3d" ? solveY(d.ref ?? [model.center[0] + model.radius * 0.9, model.center[2]], e.clientY) : flatYAt(e.clientY);
      setLiveY(snapLevel(clamp(y, lo, hi)));
    } else {
      setGhost({ x: e.clientX, y: e.clientY });
      const over = d.kind === "label" && cfg.mode === "section" ? pickSlice(e.clientX, e.clientY) : pickStage(e.clientX, e.clientY);
      if (over !== d.over) { d.over = over; setHover(over); }
    }
  };
  /* The plane height whose point (x, ·, z) projects to the pointer's screen y (monotonic in y; bisection). */
  const solveY = (ref: [number, number], cy: number) => {
    const v = viewRef.current!; let a = lo - 1, b = hi + 1;
    for (let i = 0; i < 30; i++) { const m = (a + b) / 2, p = v.project([ref[0], m, ref[1]]); if (!p) break; if (p.y > cy) a = m; else b = m; }
    return (a + b) / 2;
  };
  const flatDelta = (dx: number, dy: number): V3 => {
    const ctm = flatRef.current?.getScreenCTM(); const k = ctm ? ctm.a : 10;
    return [dx / k, -dy / k, 0];
  };
  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = dragRef.current; if (!d) return;
    dragRef.current = null; setDrag(null); setGhost(null); setHover(null);
    if (d.kind === "orbit") { if (cancelled) setRot({ yaw: d.yaw0, pitch: d.pitch0 }); return; }
    if (d.kind === "pull") {
      setPull(null);
      if (cancelled) return;
      if (!d.moved) { inspect(d.id); return; }
      setProgress(p => p.pulled.includes(d.id) ? p : { ...p, pulled: [...p.pulled, d.id] }); onChange?.();
      setFeedback({ text: `${cap(theName(model, d.id))} snapped back.${behindText(model, d.id)}`, tone: "info" });
      return;
    }
    if (d.kind === "plane") {
      const y = liveY; setLiveY(null);
      if (cancelled || y === null || Math.abs(y - d.y0) < 0.05) return;
      setPlane(y); return;
    }
    if (cancelled) { setFeedback({ text: "Drag interrupted, nothing changed.", tone: "info" }); return; }
    const over = d.kind === "label" && cfg.mode === "section" ? pickSlice(e.clientX, e.clientY) : pickStage(e.clientX, e.clientY);
    if (d.kind === "label") placeLabel(d.label, over);
    else moveToken(over);
  };
  const handlers = {
    onPointerMove: onMove,
    onPointerUp: (e: React.PointerEvent) => end(e, false),
    onPointerCancel: (e: React.PointerEvent) => end(e, true),
    onLostPointerCapture: (e: React.PointerEvent) => { if (dragRef.current) end(e, true); },
  };
  const startHandle = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    if (d.kind === "label" && cfg.mode === "section" && !atLevel) { setFeedback({ text: `Move the plane to ${cfg.level} first: the names are for that slice.`, tone: "info" }); return; }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = d; setDrag(d); setGhost({ x: e.clientX, y: e.clientY }); e.preventDefault(); e.stopPropagation();
  };

  /* ---------- keyboard ---------- */
  const onStageKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (gl === "3d" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(k)) {
      e.preventDefault();
      setRot(r => ({ yaw: r.yaw + (k === "ArrowLeft" ? -0.3 : k === "ArrowRight" ? 0.3 : 0), pitch: clamp(r.pitch + (k === "ArrowUp" ? -0.3 : k === "ArrowDown" ? 0.3 : 0), -1.3, 1.3) }));
    } else if (cfg.mode === "section" && (k === "PageUp" || k === "PageDown")) { e.preventDefault(); stepLevel(k === "PageUp" ? -1 : 1); }
  };
  const stepLevel = (dir: number) => {
    const L = levelAt(progress.planeY), n = clamp((L.disc ? (dir < 0 ? Math.floor(4.5 - progress.planeY / 2.4) : Math.ceil(4.5 - progress.planeY / 2.4)) : L.n + dir), 1, 12);
    setPlane(levelCenter(n));
  };
  const undo = () => { const h = history[history.length - 1]; if (!h) return; setHistory(history.slice(0, -1)); setProgress(h); setFeedback({ text: "Took back the last move.", tone: "info" }); onChange?.(); };
  const startOver = () => { setHistory([]); setProgress(fresh()); tries.current = {}; setKbPulled(null); setRot({ yaw: cfg.mode === "section" ? -0.25 : -0.12, pitch: cfg.mode === "section" ? 0.5 : 0.12 }); setFeedback({ text: "Started over.", tone: "info" }); onChange?.(); };
  const share = () => onShare?.(summarize(model, cfg, progress));

  /* ---------- test hook ---------- */
  const hookState = useRef({ progress, planeY, rot, gl, feedback, hover, pull });
  hookState.current = { progress, planeY, rot, gl, feedback, hover, pull };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const stage = () => stageRef.current!.getBoundingClientRect();
    const center = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    window.keatingAnatomy = {
      snapshot: () => { const s = hookState.current; return { gl: s.gl, mode: cfg.mode, placed: s.progress.placed, attempts: s.progress.attempts, path: s.progress.path, turns: s.progress.turns.map(t => t.to), planeY: s.planeY, level: levelAt(s.planeY).label, yaw: s.rot.yaw, pitch: s.rot.pitch, feedback: s.feedback.text, tone: s.feedback.tone, hover: s.hover, pulled: s.progress.pulled, inspected: s.progress.inspected, pulling: s.pull?.id ?? null }; },
      point: ((id: string) => {
        if (hookState.current.gl === "3d") return viewRef.current?.screenPointFor(id) ?? null;
        const g = flatRef.current?.querySelector(`[data-sid="${id}"]`); if (!g) return null;
        const cands: { x: number; y: number }[] = [];
        for (const el of Array.from(g.children) as SVGGraphicsElement[]) {
          const m = el.getScreenCTM(); if (!m) continue;
          const pts: DOMPoint[] = [];
          if (el instanceof SVGPathElement) { const L = el.getTotalLength(); for (let i = 0; i <= 16; i++) pts.push(el.getPointAtLength(L * i / 16)); }
          else if (el instanceof SVGEllipseElement) { const cx = el.cx.baseVal.value, cy = el.cy.baseVal.value, rx = el.rx.baseVal.value, ry = el.ry.baseVal.value; for (const [a, b] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) pts.push(new DOMPoint(cx + a * rx, cy + b * ry)); }
          for (const p of pts) { const q = p.matrixTransform(m); cands.push({ x: q.x, y: q.y }); }
        }
        return cands.find(c => pickStage(c.x, c.y) === id) ?? null;
      }) as never,
      slicePoint: ((id: string) => { const el = sliceRef.current?.querySelector(`[data-slice="${id}"] [data-core]`) ?? null; return center(el); }) as never,
      pin: ((id: string) => center(overlayRef.current?.querySelector(`[data-pin="${id}"]`) ?? null)) as never,
      chip: ((id: string) => center(cardRef.current?.querySelector(`[data-chip="${id}"]`) ?? null)) as never,
      token: () => center(overlayRef.current?.querySelector("[data-token]") ?? null),
      grip: () => center(overlayRef.current?.querySelector("[data-grip] .an-grip-knob") ?? null),
      empty: () => { const r = stage(); return { x: r.left + 14, y: r.top + r.height - 14 }; },
      stage: () => { const r = stage(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
      yFor: ((y: number, x?: number) => pointOf([x ?? model.center[0] + model.radius * 0.9, y, model.center[2]])) as never,
    };
  }, [cfg.mode, model, pointOf, pickStage]);

  /* ---------- render ---------- */
  const title = cfg.title ?? (cfg.mode === "explore" ? model.title : DEFAULT_TITLE[cfg.mode]);
  const count = cfg.mode === "label" || cfg.mode === "section" ? `${progress.placed.length} of ${targets.length} named` : cfg.mode === "trace" ? `Step ${progress.path.length - 1} of ${route.length - 1}` : `${progress.inspected.length} looked at`;
  const unplaced = targets.filter(t => !progress.placed.includes(t));
  const sliceShapes = useMemo(() => cfg.mode === "section" ? slice(model, planeY) : [], [cfg.mode, model, planeY]);
  const pinNumber = (id: string) => targets.indexOf(id) + 1;
  const orient = orientation(rot.yaw, rot.pitch);
  const dragging = drag?.kind;
  const tokenPreview = drag?.kind === "token" && drag.over && drag.over !== current ? drag.over : null;

  return <section ref={cardRef} className={`activity anatomy an-${cfg.mode}${finished ? " an-done" : ""}${dragging ? " an-dragging" : ""}`} aria-label={`${title}: schematic ${model.title.toLowerCase()} model`} {...handlers}>
    <header className="an-header">
      <h3>{title}</h3>
      <span className="an-count" aria-live="off">{count}</span>
    </header>
    {cfg.question && <p className="an-question">{cfg.question}</p>}

    <div className={`an-well${cfg.mode === "section" && wide ? " an-well-split" : ""}`}>
      <div ref={stageRef} className={`an-stage${gl === "2d" ? " an-flat-stage" : ""}`} tabIndex={0} role="application"
        aria-label={`${model.title} model, ${orient}. ${gl === "3d" ? "Arrow keys turn it." : ""}${cfg.mode === "section" ? " Page Up and Page Down move the section plane." : ""} Every move also has a button under “Use buttons instead”.`}
        onPointerDown={onStageDown} onKeyDown={onStageKey}>
        {gl === "pending" && <p className="an-loading">Loading the model…</p>}
        {gl === "2d" && <Flat2D svgRef={flatRef} model={model} pull={pull ?? (kbPulled ? { id: kbPulled, off: pullOut(model, structureOf(model, kbPulled)!) } : null)} hover={highlights} planeY={cfg.mode === "section" ? planeY : null} path={cfg.mode === "trace" ? pathPoints : []} uid={uid} snapping={!drag && !reduced} />}
        <div ref={overlayRef} className="an-overlay">
          {(cfg.mode === "label") && targets.map(t => progress.placed.includes(t)
            ? <span key={t} data-at={t} className="an-tag"><span className="an-tag-dot" />{structureOf(model, t)!.short}</span>
            : <span key={t} data-at={t} data-pin={t} className={`an-pin${hover === t ? " an-pin-over" : ""}`} aria-hidden="true">{pinNumber(t)}</span>)}
          {cfg.mode === "trace" && <>
            {progress.path.slice(0, -1).map((id, i) => <span key={id + i} data-at={id} className="an-step" aria-hidden="true">{i + 1}</span>)}
            {route.slice(-1).map(id => current !== id && <span key="end" data-at={id} className="an-goal" aria-hidden="true">{structureOf(model, id)!.short}</span>)}
            <span data-at={current} data-token="" data-handle="" className={`an-token${drag?.kind === "token" ? " an-token-lifted" : ""}${finished ? " an-token-done" : ""}`}
              role="img" aria-label={`Blood in ${theName(model, current)}`} onPointerDown={e => !finished && startHandle(e, { kind: "token", over: null })} />
          </>}
          {cfg.mode === "section" && <div data-grip="" data-handle="" className={`an-grip${drag?.kind === "plane" ? " an-grip-active" : ""}`} onPointerDown={e => startHandle(e, { kind: "plane", y0: progress.planeY })}>
            <span className="an-grip-knob" aria-hidden="true" /><span className="an-grip-label">{levelAt(planeY).label}</span>
          </div>}
        </div>
        <span className="an-orient" aria-hidden="true">{gl === "2d" ? "Anterior view" : orient} · schematic, not to scale</span>
        {gl === "2d" && <span className="an-flat-note">3D isn’t available here, so this is the flat anterior view.</span>}
      </div>

      {cfg.mode === "section" && <SlicePanel svgRef={sliceRef} model={model} y={planeY} shapes={sliceShapes} placed={progress.placed} over={drag?.kind === "label" ? drag.over : null} numbered={panelOpen} target={cfg.level} />}

      {(cfg.mode === "label" || cfg.mode === "section") && <div className="an-tray" aria-label="Names to place">
        {unplaced.map(t => <button key={t} type="button" data-chip={t} data-handle="" className={`an-chip${drag?.kind === "label" && drag.label === t ? " an-chip-lifted" : ""}`}
          disabled={cfg.mode === "section" && !atLevel} onPointerDown={e => startHandle(e, { kind: "label", label: t, over: null })}
          aria-label={`${structureOf(model, t)!.name}: drag onto the ${cfg.mode === "section" ? "slice" : "model"}, or use the buttons below`}>{structureOf(model, t)!.short === structureOf(model, t)!.name ? structureOf(model, t)!.name : nameChip(structureOf(model, t)!)}</button>)}
        {!unplaced.length && <span className="an-tray-done">All named.</span>}
        {cfg.mode === "section" && !atLevel && unplaced.length > 0 && <span className="an-tray-wait">Bring the plane to {cfg.level} to place these.</span>}
      </div>}
    </div>

    <p role="status" className={`an-feedback an-fb-${feedback.tone}`}>{feedback.text || defaultPrompt(cfg)}</p>
    {tokenPreview && ghost && <span className="an-ghost-tag" style={{ left: ghost.x, top: ghost.y }}>Into {theName(model, tokenPreview)}?</span>}
    {drag?.kind === "label" && ghost && <span className="an-ghost-chip" style={{ left: ghost.x, top: ghost.y }}>{nameChip(structureOf(model, drag.label)!)}</span>}
    {drag?.kind === "token" && ghost && <span className="an-ghost-token" style={{ left: ghost.x, top: ghost.y }} />}

    <div className="actions">
      <button type="button" className="primary" disabled={!hasActed(progress)} onClick={share}>Share with Keating</button>
      <button type="button" className="quiet" disabled={!history.length} onClick={undo}>Undo</button>
      <button type="button" className="quiet" onClick={startOver}>Start over</button>
    </div>

    <details className="an-controls" open={panelOpen} onToggle={e => setPanelOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Use buttons instead</summary>
      <KeyboardPanel model={model} cfg={cfg} gl={gl} progress={progress} unplaced={unplaced} sliceIds={sliceShapes.map(s => s.id)} current={current} atLevel={atLevel}
        rotate={(dy, dp) => setRot(r => dy === 0 && dp === 0 ? { yaw: 0, pitch: 0 } : { yaw: r.yaw + dy, pitch: clamp(r.pitch + dp, -1.3, 1.3) })}
        place={placeLabel} move={moveToken} inspect={inspect} stepLevel={stepLevel} setPlane={y => setPlane(y)} lo={lo} hi={hi}
        kbPulled={kbPulled} togglePull={id => { setKbPulled(kbPulled === id ? null : id); if (kbPulled !== id) { setProgress(p => p.pulled.includes(id) ? p : { ...p, pulled: [...p.pulled, id] }); setFeedback({ text: `Pulled ${theName(model, id)} out.${behindText(model, id)}`, tone: "info" }); onChange?.(); } else setFeedback({ text: `Put ${theName(model, id)} back.`, tone: "info" }); }} />
    </details>
  </section>;
}

/* ------------------------------------------------------------------ helpers */
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const lower = (s: string) => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
const nameChip = (s: Structure) => s.name.replace(/ \(LAD\)$/, "").replace(/^Anterior interventricular artery$/, "Anterior interventricular (LAD)");
function snapLevel(y: number) { const u = 4.5 - y / 2.4, n = Math.round(u); const c = (4.5 - n) * 2.4; return Math.abs(y - c) < 0.35 ? c : Math.round(y * 20) / 20; }
function pullOut(m: Model, s: Structure): V3 {
  const d = [s.anchor[0] - m.center[0], 0, s.anchor[2] - m.center[2] + 0.5];
  const l = Math.hypot(d[0], d[2]) || 1;
  return [d[0] / l * 4, 0.5, d[2] / l * 4];
}
export function behindText(m: Model, id: string): string {
  const BEHIND: Record<string, string> = {
    rightVentricle: " Behind the right ventricle sit the aortic and mitral valves and the left ventricle.",
    rightAtrium: " Behind the right atrium are the right pulmonary veins and the left atrium.",
    leftAtrium: " The esophagus runs close behind the posterior left atrium, across the pericardium and a variable layer of tissue. This proximity makes the left atrium accessible to transesophageal ultrasound.",
    aorta: " Under the arch you can see the pulmonary trunk dividing.",
    pulmonaryTrunk: " Behind the pulmonary trunk is the ascending aorta and the aortic valve.",
    sternum: " Behind the sternum the right ventricle forms most of the front of the heart.",
  };
  return BEHIND[id] ?? (m.id ? "" : "");
}
function orientation(yaw: number, pitch: number): string {
  const a = ((yaw % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // −π..π
  const side = Math.abs(a) < Math.PI / 4 ? "Anterior view" : Math.abs(a) > 3 * Math.PI / 4 ? "Posterior view" : a < 0 ? "Left lateral view" : "Right lateral view";
  return side + (pitch > 0.45 ? ", from above" : pitch < -0.45 ? ", from below" : "");
}
function planeText(m: Model, y: number, target?: string) {
  const L = levelAt(y), notes = LEVEL_NOTES[L.n];
  const on = slice(m, y).filter(s => s.id !== "rightLung" && s.id !== "leftLung").length;
  return `Plane at ${L.label}${target ? L.label === target ? ", the level asked about" : ` (the question asks about ${target})` : ""}. ${!L.disc && notes ? notes + " " : ""}${on} structures cut.`;
}
function defaultPrompt(cfg: Anatomy3DConfig) {
  return cfg.mode === "label" ? "Drag a name onto the model. Drag empty space to turn it; drag a structure to pull it aside."
    : cfg.mode === "trace" ? "Drag the drop of blood to where it goes next."
    : cfg.mode === "section" ? `Drag the plane (or its handle on the right) to move the cut.${cfg.level ? ` The question is about ${cfg.level}.` : ""}`
    : "Tap a structure to see what it is. Drag empty space to turn the model; drag a structure to pull it aside.";
}

/* ------------------------------------------------------------------ 2D fallback: anterior projection */
const TONE_CLASS = (t: string) => `an-t-${t}`;
function Flat2D({ svgRef, model, pull, hover, planeY, path, uid, snapping }: { svgRef: React.RefObject<SVGSVGElement | null>; model: Model; pull: { id: string; off: V3 } | null; hover: string[]; planeY: number | null; path: V3[]; uid: string; snapping: boolean }) {
  const items = useMemo(() => model.structures.map(project).sort((a, b) => a.z - b.z || ((structureOf(model, a.id)!.priority ?? 0) - (structureOf(model, b.id)!.priority ?? 0))), [model]);
  const [lo, hi] = yRange(model);
  const xs = model.structures.flatMap(s => s.prims.flatMap(p => p.k === "ell" ? [p.c[0] - p.r[0], p.c[0] + p.r[0]] : p.k === "cyl" ? [p.c[0] - p.rx, p.c[0] + p.rx] : p.k === "ring" ? [p.c[0] - p.R, p.c[0] + p.R] : p.path.map(q => q[0])));
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
  const vb = `${x0} ${-hi - 1} ${x1 - x0} ${hi - lo + 2}`;
  const draw = (faded: boolean) => items.map(it => {
    const s = structureOf(model, it.id)!;
    const off = pull?.id === it.id ? pull.off : [0, 0, 0];
    const hl = !faded && hover.includes(it.id);
    return <g key={it.id + (faded ? "f" : "")} {...(faded ? {} : { "data-sid": it.id })} className={`an-flat-part ${TONE_CLASS(s.tone)}${hl ? " an-flat-hl" : ""}${snapping && pull?.id !== it.id ? " an-flat-snap" : ""}`}
      style={{ transform: `translate(${off[0]}px, ${-off[1]}px)` }}>
      {it.ellipses.map((e, i) => <ellipse key={i} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={`rotate(${e.rot} ${e.cx} ${e.cy})`} />)}
      {it.strokes.map((st, i) => <path key={i} d={st.d} strokeWidth={st.w} className={s.tone === "valve" ? "an-flat-ring" : "an-flat-tube"} />)}
    </g>;
  });
  return <svg ref={svgRef} className="an-flat" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Anterior view of the schematic model">
    {planeY !== null && <defs>
      <clipPath id={`${uid}-below`}><rect x={x0} y={-planeY} width={x1 - x0} height={hi - lo + 4} /></clipPath>
      <clipPath id={`${uid}-above`}><rect x={x0} y={-hi - 2} width={x1 - x0} height={hi + 2 - planeY} /></clipPath>
    </defs>}
    {planeY !== null && <g clipPath={`url(#${uid}-above)`} className="an-flat-faded" aria-hidden="true">{draw(true)}</g>}
    <g clipPath={planeY !== null ? `url(#${uid}-below)` : undefined}>{draw(false)}</g>
    {path.length > 1 && <polyline className="an-flat-path" points={path.map(p => `${p[0]},${-p[1]}`).join(" ")} />}
    {planeY !== null && <line className="an-flat-plane" x1={x0} x2={x1} y1={-planeY} y2={-planeY} />}
  </svg>;
}

/* ------------------------------------------------------------------ slice panel: axial, viewed from the feet */
function SlicePanel({ svgRef, model, y, shapes, placed, over, numbered, target }: { svgRef: React.RefObject<SVGSVGElement | null>; model: Model; y: number; shapes: SliceShape[]; placed: string[]; over: string | null; numbered: boolean; target?: string }) {
  const thorax = model.vertebrae;
  const [x0, x1, z0, z1] = thorax ? [-13, 13, -10.5, 10] : [-7.5, 8.5, -7.5, 6.5];
  const order = (s: SliceShape) => { const t = structureOf(model, s.id)!.tone; return t === "lung" ? 0 : t === "bone" ? 1 : t === "valve" ? 4 : t === "coronary" ? 3 : 2; };
  const sorted = [...shapes].sort((a, b) => order(a) - order(b));
  const L = levelAt(y);
  return <figure className="an-slice">
    <svg ref={svgRef} viewBox={`${x0} ${-z1} ${x1 - x0} ${z1 - z0}`} role="img" aria-label={`Axial slice at ${L.label}, viewed from the feet: ${shapes.map(s => s.id).length} structures`}>
      <rect className="an-ct-bg" x={x0} y={-z1} width={x1 - x0} height={z1 - z0} />
      {thorax && <ellipse className="an-ct-wall" cx={0} cy={0.9} rx={12.2} ry={9.6} />}
      {sorted.map(s => {
        const t = structureOf(model, s.id)!.tone, hl = over === s.id;
        return <g key={s.id} data-slice={s.id} className={`an-ct an-ct-${t}${hl ? " an-ct-over" : ""}${placed.includes(s.id) ? " an-ct-named" : ""}`}>
          <g className="an-ct-edge">{s.ellipses.map((e, i) => <ellipse key={i} cx={e.cx} cy={-e.cy} rx={e.rx + 0.14} ry={e.ry + 0.14} transform={`rotate(${-e.rot} ${e.cx} ${-e.cy})`} />)}{s.discs.map((d, i) => <circle key={i} cx={d.x} cy={-d.z} r={d.r + 0.14} />)}</g>
          <g className="an-ct-fill" data-core="">{s.ellipses.map((e, i) => <ellipse key={i} cx={e.cx} cy={-e.cy} rx={e.rx} ry={e.ry} transform={`rotate(${-e.rot} ${e.cx} ${-e.cy})`} />)}{s.discs.map((d, i) => <circle key={i} cx={d.x} cy={-d.z} r={d.r} />)}</g>
          {t === "airway" && <g className="an-ct-air">{s.discs.map((d, i) => <circle key={i} cx={d.x} cy={-d.z} r={d.r * 0.68} />)}</g>}
        </g>;
      })}
      {placeLabels(sorted.filter(s => placed.includes(s.id)).map(s => ({ id: s.id, text: structureOf(model, s.id)!.short, x: s.c[0], y: -s.c[1] }))).map(l => <g key={l.id}>
        {(l.dx || l.dy) ? <line className="an-ct-leader" x1={l.x} y1={l.y} x2={l.x + l.dx} y2={l.y + l.dy * 0.8} /> : null}
        <text className="an-ct-label" x={l.x + l.dx} y={l.y + l.dy} textAnchor="middle" dominantBaseline="middle">{l.text}</text>
      </g>)}
      {numbered && sorted.map((s, i) => !placed.includes(s.id) && <text key={"n" + s.id} className="an-ct-num" x={s.c[0]} y={-s.c[1]} textAnchor="middle" dominantBaseline="middle">{i + 1}</text>)}
      <text className="an-ct-dir" x={x0 + 0.6} y={0} dominantBaseline="middle">R</text>
      <text className="an-ct-dir" x={x1 - 0.6} y={0} textAnchor="end" dominantBaseline="middle">L</text>
      <text className="an-ct-dir" x={(x0 + x1) / 2} y={-z1 + 1.1} textAnchor="middle">A</text>
    </svg>
    <figcaption><strong>{L.label}</strong>{target && L.label === target ? " ✓" : ""} · axial, seen from the feet (patient’s right on your left)
      {thorax && <span className="an-slice-caveat">{CT_LEVELS_CAVEAT}</span>}</figcaption>
  </figure>;
}
/* Greedy placement so names on a crowded slice don't overprint each other (slice units: font ≈ 1.05). */
function placeLabels(ls: { id: string; text: string; x: number; y: number }[]) {
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const cands = [[0, 0], [0, -1.5], [0, 1.5], [2.6, 0], [-2.6, 0], [0, -2.9], [0, 2.9], [3, -1.6], [-3, 1.6]];
  return ls.map(l => {
    const w = l.text.length * 0.62 + 0.4, h = 1.25;
    for (const [dx, dy] of cands) {
      const b = { x0: l.x + dx - w / 2, x1: l.x + dx + w / 2, y0: l.y + dy - h / 2, y1: l.y + dy + h / 2 };
      if (!boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) { boxes.push(b); return { ...l, dx, dy }; }
    }
    return { ...l, dx: 0, dy: 0 };
  });
}
export const sliceOrderForPanel = (model: Model, shapes: SliceShape[]) => {
  const order = (s: SliceShape) => { const t = structureOf(model, s.id)!.tone; return t === "lung" ? 0 : t === "bone" ? 1 : t === "valve" ? 4 : t === "coronary" ? 3 : 2; };
  return [...shapes].sort((a, b) => order(a) - order(b));
};

/* ------------------------------------------------------------------ keyboard / button path */
function KeyboardPanel(p: {
  model: Model; cfg: Anatomy3DConfig; gl: string; progress: Progress; unplaced: string[]; sliceIds: string[]; current: string; atLevel: boolean;
  rotate: (dy: number, dp: number) => void; place: (label: string, on: string | null) => void; move: (to: string) => void; inspect: (id: string) => void;
  stepLevel: (d: number) => void; setPlane: (y: number) => void; lo: number; hi: number; kbPulled: string | null; togglePull: (id: string) => void;
}) {
  const { model, cfg } = p;
  const targets = cfg.targets ?? [];
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState("");
  const [dest, setDest] = useState("");
  const [part, setPart] = useState(model.structures[0].id);
  const lbl = p.unplaced.includes(label) ? label : p.unplaced[0] ?? "";
  const shapes = cfg.mode === "section" ? sliceOrderForPanel(model, slice(model, p.progress.planeY)) : [];
  const pinOptions = cfg.mode === "section" ? shapes.map((s, i) => ({ id: s.id, n: i + 1 })) : targets.map((t, i) => ({ id: t, n: i + 1 })).filter(o => !p.progress.placed.includes(o.id));
  const pinSel = pinOptions.some(o => o.id === pin) ? pin : pinOptions[0]?.id ?? "";
  const destSel = dest && dest !== p.current ? dest : model.structures.find(s => s.id !== p.current)!.id;
  return <div className="an-panel">
    {p.gl === "3d" && <div className="an-row" role="group" aria-label="Turn the model">
      <span className="an-row-label">View</span>
      <button type="button" onClick={() => p.rotate(-0.4, 0)}>Turn left</button>
      <button type="button" onClick={() => p.rotate(0.4, 0)}>Turn right</button>
      <button type="button" onClick={() => p.rotate(0, -0.4)}>Tilt up</button>
      <button type="button" onClick={() => p.rotate(0, 0.4)}>Tilt down</button>
      <button type="button" onClick={() => p.rotate(0, 0)}>Front view</button>
    </div>}
    {(cfg.mode === "label" || cfg.mode === "section") && p.unplaced.length > 0 && <div className="an-row">
      <label>Name <select value={lbl} onChange={e => setLabel(e.target.value)}>{p.unplaced.map(t => <option key={t} value={t}>{nameOf(model, t)}</option>)}</select></label>
      <label>{cfg.mode === "section" ? "Onto slice structure" : "Onto pin"} <select value={pinSel} onChange={e => setPin(e.target.value)}>{pinOptions.map(o => <option key={o.id} value={o.id}>{o.n}</option>)}</select></label>
      <button type="button" disabled={cfg.mode === "section" && !p.atLevel} onClick={() => p.place(lbl, pinSel || null)}>Place name</button>
    </div>}
    {cfg.mode === "section" && <div className="an-row">
      <span className="an-row-label">Plane</span>
      <button type="button" onClick={() => p.stepLevel(-1)}>Up a level</button>
      <button type="button" onClick={() => p.stepLevel(1)}>Down a level</button>
      <label className="an-range">Height <input type="range" min={p.lo} max={p.hi} step={0.1} value={p.progress.planeY} aria-valuetext={levelAt(p.progress.planeY).label} onChange={e => p.setPlane(Number(e.target.value))} /></label>
    </div>}
    {cfg.mode === "trace" && p.progress.path.length < (cfg.route?.length ?? 0) && <div className="an-row">
      <label>Move the blood from {theName(model, p.current)} to <select value={destSel} onChange={e => setDest(e.target.value)}>{model.structures.filter(s => s.id !== p.current && s.tone !== "bone" && s.tone !== "lung").map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <button type="button" onClick={() => p.move(destSel)}>Move</button>
    </div>}
    <div className="an-row">
      <label>Structure <select value={part} onChange={e => setPart(e.target.value)}>{model.structures.map(s => <option key={s.id} value={s.id}>{cfg.mode === "label" && targets.includes(s.id) && !p.progress.placed.includes(s.id) ? `Pin ${targets.indexOf(s.id) + 1}` : s.name}</option>)}</select></label>
      {cfg.mode === "explore" && <button type="button" onClick={() => p.inspect(part)}>Show details</button>}
      <button type="button" onClick={() => p.togglePull(part)}>{p.kbPulled === part ? "Put back" : "Pull out"}</button>
    </div>
    {cfg.mode === "trace" && p.progress.path.length < (cfg.route?.length ?? 0) && <p className="an-panel-note">Possible next steps aren’t listed separately, so a wrong choice is explained the same way as a wrong drag. From {theName(model, p.current)} blood can go {edges(model, p.current).length === 1 ? "one way" : `${edges(model, p.current).length} ways`}.</p>}
    {cfg.mode === "section" && !p.atLevel && <p className="an-panel-note">Names unlock when the plane is at {cfg.level}.</p>}
    {cfg.mode === "section" && cfg.targets && <p className="an-panel-note">{cfg.targets.filter(t => !inSlice(model, t, p.progress.planeY)).length ? "Some names aren’t in this slice yet." : ""}</p>}
  </div>;
}
