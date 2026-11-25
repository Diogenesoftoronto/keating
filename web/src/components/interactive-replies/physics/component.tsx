import { useMemo } from "react";
import { FieldLab } from "./field";
import { WavesLab } from "./waves";
import { QuantumLab } from "./quantum";
import { slitSamples, MAX_WAVELETS, boundStateCount } from "./physics";
import type { FieldConfig, PhysicsConfig, QuantumConfig, ShareSummary, WavesConfig } from "./types";
import "./component.css";

/* =====================================================================================
   PhysicsLab: the learner drags the physics itself — charges in a field, slits and the
   wavelength of a wave, the walls and floor of a quantum well — and every picture is
   computed live from the physics (no canned images). Three modes chosen by config.mode.
   ===================================================================================== */

export type { ShareSummary, PhysicsConfig, FieldConfig, WavesConfig, QuantumConfig } from "./types";
export type PhysicsLabConfig = PhysicsConfig;

/* ============================ presets ============================ */

export const presets: Record<string, PhysicsConfig> = {
  dipole: {
    mode: "field", title: "A dipole: where do the lines go?",
    goal: "Drag the charges, or the knob beside each one to change its charge (drag it through the charge to flip the sign). Drop the test charge where two lines look about to cross.",
    units: { length: "cm", charge: "nC" }, view: { width: 16, height: 10 },
    charges: [{ id: "A", x: -3, y: 0, q: 2 }, { id: "B", x: 3, y: 0, q: -2 }],
    linesPerUnit: 6, qStep: 1, qMax: 4, maxCharges: 4,
    findings: ["oneArrow", "superposition", "nullPoint"],
  },
  likeCharges: {
    mode: "field", title: "Two like charges",
    goal: "The lines from two positive charges turn away from each other. Find the point between them where the test charge feels nothing.",
    units: { length: "cm", charge: "nC" }, view: { width: 16, height: 10 },
    charges: [{ id: "A", x: -3, y: 0, q: 1 }, { id: "B", x: 3, y: 0, q: 1 }],
    linesPerUnit: 8, qStep: 1, qMax: 4, maxCharges: 3,
    findings: ["nullPoint", "superposition", "oneArrow"],
  },
  inverseSquare: {
    mode: "field", title: "One charge: the inverse square law",
    goal: "Drop the test charge, read the field, then drop it twice as far away.",
    units: { length: "cm", charge: "nC" }, view: { width: 16, height: 10 },
    charges: [{ id: "A", x: -4, y: 0, q: 2, locked: true }],
    probe: { x: -2, y: 0 }, linesPerUnit: 6, qStep: 1, qMax: 4, maxCharges: 1,
    show: { equipotentials: true, potentialMap: false },
    findings: ["inverseSquare", "oneArrow"],
  },
  shielding: {
    mode: "field", title: "A metal sphere near a charge",
    goal: "The lines end on charge induced on the metal's surface. Drag the charge around and put the test charge inside the metal.",
    units: { length: "cm", charge: "nC" }, view: { width: 16, height: 10 },
    charges: [{ id: "A", x: -5, y: 0, q: 3 }], conductor: { x: 2, y: 0, r: 2 },
    linesPerUnit: 6, qStep: 1, qMax: 4, maxCharges: 2,
    findings: ["shielding", "oneArrow", "superposition"],
  },
  doubleSlit: {
    mode: "waves", title: "Two slits in a ripple tank",
    goal: "Drag the wavelength (the marked crest on the left), the slits, and the screen. Then drop the marker on a bright and a dark fringe.",
    units: { length: "cm" }, wavelength: { value: 1, min: 0.6, max: 2, step: 0.05 },
    scene: { kind: "slits", barrierX: 0, slits: [{ id: "A", y: 3, width: 0.4 }, { id: "B", y: -3, width: 0.4 }], minWidth: 0.2, maxWidth: 2.5 },
    screen: { x: 60, min: 30, max: 72 }, view: { x0: -6, x1: 74, yHalf: 20 },
    scaleNote: "Water waves, ripple-tank scale", findings: ["bright", "dark", "spacing", "width"],
  },
  twoSources: {
    mode: "waves", title: "Two speakers in phase",
    goal: "Drag the two sources apart or together and watch the quiet lines fan out or close up.",
    units: { length: "m" }, wavelength: { value: 0.7, min: 0.3, max: 1.4, step: 0.05 },
    scene: { kind: "sources", sources: [{ id: "A", x: 0, y: 1.5 }, { id: "B", x: 0, y: -1.5 }] },
    screen: { x: 20, min: 8, max: 24 }, view: { x0: -3, x1: 25, yHalf: 8 },
    scaleNote: "2-D sound model, taking c ≈ 343 m/s", soundSpeed: 343, findings: ["bright", "dark", "separation", "spacing"],
  },
  singleSlit: {
    mode: "waves", title: "One slit: diffraction",
    goal: "Narrow the slit and watch the pattern spread. Find the first dark band.",
    units: { length: "cm" }, wavelength: { value: 1, min: 0.6, max: 2, step: 0.05 },
    scene: { kind: "slits", barrierX: 0, slits: [{ id: "A", y: 0, width: 3 }], minWidth: 1, maxWidth: 7 },
    screen: { x: 50, min: 25, max: 62 }, view: { x0: -6, x1: 64, yHalf: 24 },
    scaleNote: "Water waves, ripple-tank scale", findings: ["dark", "width", "spacing"],
  },
  finiteWell: {
    mode: "quantum", title: "How many states fit in a finite well?",
    goal: "Drag the floor deeper or the walls apart and count the levels. Drag a level line to select it.",
    units: "electron", view: "bound", domain: [-2, 2], energyRange: [-4.2, 0.6],
    potential: { kind: "finiteSquare", left: -0.5, right: 0.5, depth: 2 },
    states: 8, selected: 1, depthAxis: { max: 4 }, findings: ["forbidden", "zeroPoint"],
  },
  tunnelling: {
    mode: "quantum", title: "Tunnelling through a barrier",
    goal: "Drag the barrier's edges, its top, or the electron's energy. Then send a wave packet.",
    units: "electron", view: "tunnel", domain: [-4, 4], energyRange: [0, 2.2],
    potential: { kind: "barrier", left: 0, right: 0.5, height: 1 },
    energy: { value: 0.5, min: 0.05, max: 2.1 }, widthAxis: { max: 1.6 },
    findings: ["tunnels", "exponential", "reflectsAbove", "resonance"],
  },
  infiniteWell: {
    mode: "quantum", title: "A particle in a box",
    goal: "Squeeze the box with its walls and watch every level move. Drag a level to select it.",
    units: "electron", view: "bound", domain: [-1, 1], energyRange: [0, 7],
    potential: { kind: "infinite", left: -0.5, right: 0.5 }, states: 6, selected: 1, findings: ["zeroPoint"],
  },
  harmonic: {
    mode: "quantum", title: "The harmonic oscillator's ladder",
    goal: "Drag the side of the parabola to stiffen the spring. Select a few levels and compare the gaps.",
    units: "electron", view: "bound", domain: [-4, 4], energyRange: [0, 2.2],
    potential: { kind: "harmonic", hw: 0.2 }, states: 10, selected: 1, findings: ["evenSpacing", "zeroPoint", "forbidden"],
  },
  doubleWell: {
    mode: "quantum", title: "Two wells side by side",
    goal: "Raise the barrier between the wells and watch the lowest two levels pair up.",
    units: "electron", view: "bound", domain: [-2.5, 2.5], energyRange: [0, 1.2],
    potential: { kind: "doubleWell", barrier: 0.6, separation: 0.9 }, states: 6, selected: 1, findings: ["splitting", "forbidden", "zeroPoint"],
  },
};

export const scenario = {
  tab: "Physics",
  prompt: "Why do field lines never cross?",
  intro: "Because at a regular point where E ≠ 0 the field has a unique direction. The pushes from all the charges add up to a single arrow, and a field line just follows that arrow. Lines can only meet where E = 0, or begin and end on the charges themselves, where the field is singular. Drag the charges, flip one's sign, and drop the test charge where two lines look about to meet.",
  receiptLabel: "Physics simulation",
  receiptText: "The learner asked why electric field lines never cross. The lab computes the Coulomb field of the charges live (field lines integrated along E, equipotentials at equal steps of V). A test charge shows the single net force and each charge's contribution to scale. Like charges have a null point where E = 0: the only place lines can meet.",
  preset: "dipole",
};

export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  dipole: { label: "Field lines", prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  likeCharges: { label: "Like charges", prompt: "What happens to the field between two positive charges?",
    intro: "Their pushes point opposite ways in the middle, so somewhere between them they cancel exactly. Find that point with the test charge.",
    receiptLabel: "Physics simulation", receiptText: "Two equal positive charges. The lab finds the null point (E = 0) numerically and reveals it once the learner's test charge lands on it." },
  inverseSquare: { label: "Inverse square", prompt: "Why does the electric field fall off as 1/r²?",
    intro: "The field lines from a charge spread over a sphere whose area grows as r², so the field per area falls as 1/r². Measure it: drop the test charge at two distances.",
    receiptLabel: "Physics simulation", receiptText: "A single 2 nC charge. The learner's test-charge readings are in N/C from E = kq/r²; the lab compares two distances against the inverse square law." },
  shielding: { label: "Shielding", prompt: "Why is there no field inside a metal box?",
    intro: "Free charges in metal move until the field inside cancels; the surface ends up charged just right. Drag the outside charge and probe inside the metal.",
    receiptLabel: "Physics simulation", receiptText: "A neutral conducting sphere near a point charge, solved exactly with image charges (Griffiths §3.2). The field inside the metal is zero." },
  doubleSlit: { label: "Double slit", prompt: "Why are the fringes in the double-slit experiment evenly spaced?",
    intro: "Each bright fringe is where the paths from the two slits differ by a whole number of wavelengths. For small angles that puts them λL/d apart. Drag the wavelength and the slits and test it.",
    receiptLabel: "Physics simulation", receiptText: "Ripple-tank double slit. Intensity is a live Huygens sum over both slits (no small-angle assumption); the lab compares the measured spacing with λL/d." },
  twoSources: { label: "Two sources", prompt: "Why are there quiet spots between two speakers playing the same note?",
    intro: "Where the paths from the two speakers differ by half a wavelength, a compression from one meets a rarefaction from the other. Drag the speakers and find a quiet line.",
    receiptLabel: "Physics simulation", receiptText: "Two coherent point sources in 2-D; the learner's marker reports the path difference in wavelengths." },
  singleSlit: { label: "Single slit", prompt: "Why does light spread out more through a narrower slit?",
    intro: "Each part of the slit sends out wavelets. The first dark band is where the top half of the slit cancels the bottom half, at w sin θ = λ. A narrower slit needs a bigger angle for that.",
    receiptLabel: "Physics simulation", receiptText: "Single slit sampled by Huygens wavelets; first minimum at w sin θ = λ." },
  finiteWell: { label: "Finite well", prompt: "How many bound states does a finite square well have?",
    intro: "It depends on the width and depth together: one new state each time (w/2)√(2mV₀)/ℏ passes another π/2. In one dimension there's always at least one. Drag the floor and count.",
    receiptLabel: "Physics simulation", receiptText: "An electron in a 1 nm finite square well. Levels come from a finite-difference Schrödinger solver; the depth axis marks where each new bound state appears (Griffiths QM §2.6)." },
  tunnelling: { label: "Tunnelling", prompt: "How can an electron get through a barrier it doesn't have the energy to climb?",
    intro: "Inside the barrier its wave doesn't stop; it decays exponentially. If the barrier is thin, some is left on the far side. Drag the width and see how fast the chance falls.",
    receiptLabel: "Physics simulation", receiptText: "An electron at a rectangular barrier: exact transmission (Griffiths, Introduction to Quantum Mechanics, rectangular-barrier problem: Prob. 2.33 in the 2nd ed.), |ψ|², T against width on a log scale, and a Crank–Nicolson wave packet." },
  infiniteWell: { label: "Particle in a box", prompt: "Why are the energies in a box quantised?",
    intro: "The wave has to fit: ψ must vanish at both walls, so only whole numbers of half-wavelengths fit, giving Eₙ = n²π²ℏ²/2mL². Squeeze the box and watch.",
    receiptLabel: "Physics simulation", receiptText: "Infinite square well for an electron; numerical levels match n²π²ℏ²/2mL²." },
  harmonic: { label: "Oscillator", prompt: "Why are a quantum oscillator's levels evenly spaced?",
    intro: "For a parabolic well the levels are (n + ½)ℏω. That's a ladder with equal rungs, and the bottom rung is half a rung up. Stiffen the spring and compare gaps.",
    receiptLabel: "Physics simulation", receiptText: "Harmonic oscillator, ℏω adjustable; numerical levels are (n + ½)ℏω." },
  doubleWell: { label: "Double well", prompt: "What happens to the energy levels when two wells are side by side?",
    intro: "Each level of one well pairs with its twin in the other. They split into a symmetric and an antisymmetric state, and the split shrinks as the barrier grows.",
    receiptLabel: "Physics simulation", receiptText: "Quartic double well; tunnelling splitting of the lowest pair." },
};

/* ============================ validation ============================ */

type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function closed(o: O, allowed: string[], path: string, p: string[]) { for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`${path}.${k} is not a known setting`); }
function common(o: O, p: string[]) {
  if (!str(o.title, 120)) p.push("title must be a short text");
  if (o.goal !== undefined && !(typeof o.goal === "string" && o.goal.length <= 400)) p.push("goal must be text (≤ 400 characters)");
}
function findingsOk(o: O, allowed: string[], p: string[]) {
  if (o.findings === undefined) return [] as string[];
  if (!Array.isArray(o.findings) || o.findings.length > 8) { p.push("findings must be a list"); return []; }
  const out: string[] = [];
  for (const f of o.findings) { if (typeof f !== "string" || !allowed.includes(f)) p.push(`unknown finding ${JSON.stringify(f)} (use ${allowed.join(", ")})`); else if (out.includes(f)) p.push(`finding ${f} is listed twice`); else out.push(f); }
  return out;
}

function validateField(o: O, p: string[]) {
  closed(o, ["mode", "title", "goal", "units", "view", "charges", "conductor", "probe", "linesPerUnit", "qStep", "qMax", "maxCharges", "show", "findings"], "config", p);
  common(o, p);
  if (!isObj(o.units)) p.push("units must be { length, charge }");
  else { closed(o.units, ["length", "charge"], "units", p); if (!["mm", "cm", "m"].includes(o.units.length as string)) p.push("units.length must be mm, cm or m"); if (!["nC", "µC"].includes(o.units.charge as string)) p.push("units.charge must be nC or µC"); }
  if (!isObj(o.view) || !num(o.view.width) || !num(o.view.height) || o.view.width <= 0 || o.view.height <= 0) { p.push("view must be { width, height } with positive numbers"); return; }
  closed(o.view, ["width", "height"], "view", p);
  const vw = o.view.width, vh = o.view.height;
  if (vw / vh > 3 || vw / vh < 0.6) p.push("view aspect (width/height) must be between 0.6 and 3");
  const qStep = o.qStep === undefined ? 1 : o.qStep, qMax = o.qMax === undefined ? 4 : o.qMax;
  if (!num(qStep) || qStep <= 0) p.push("qStep must be a positive number");
  if (!num(qMax) || !num(qStep) || qMax < qStep || qMax / qStep > 40) p.push("qMax must be at least qStep and at most 40 steps");
  const lpu = o.linesPerUnit === undefined ? 6 : o.linesPerUnit;
  if (!num(lpu) || !Number.isInteger(lpu) || lpu < 1 || lpu > 16) p.push("linesPerUnit must be a whole number 1–16");
  if (!Array.isArray(o.charges) || o.charges.length < 1 || o.charges.length > 6) { p.push("charges must list 1–6 charges"); return; }
  const ids = new Set<string>(); const qs: { x: number; y: number; q: number }[] = [];
  o.charges.forEach((q, i) => {
    if (!isObj(q)) { p.push(`charges[${i}] must be an object`); return; }
    closed(q, ["id", "x", "y", "q", "locked"], `charges[${i}]`, p);
    if (!str(q.id, 3)) p.push(`charges[${i}].id must be 1–3 characters`); else if (ids.has(q.id)) p.push(`charge id ${q.id} is used twice`); else ids.add(q.id);
    if (!num(q.x) || !num(q.y) || Math.abs(q.x) > vw / 2 || Math.abs(q.y) > vh / 2) { p.push(`charges[${i}] must sit inside the view`); return; }
    if (!num(q.q) || q.q === 0) { p.push(`charges[${i}].q must be a non-zero number`); return; }
    if (num(qMax) && Math.abs(q.q) > qMax) p.push(`charges[${i}].q is beyond qMax`);
    if (num(qStep) && qStep > 0 && Math.abs(q.q / qStep - Math.round(q.q / qStep)) > 1e-6) p.push(`charges[${i}].q must be a multiple of qStep`);
    if (q.locked !== undefined && typeof q.locked !== "boolean") p.push(`charges[${i}].locked must be true or false`);
    qs.push({ x: q.x, y: q.y, q: q.q });
  });
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) if (Math.hypot(qs[i].x - qs[j].x, qs[i].y - qs[j].y) < vw * 0.04) p.push("two charges are on top of each other");
  if (num(lpu) && qs.reduce((a, q) => a + Math.abs(q.q), 0) * lpu > 140) p.push("too many field lines: lower linesPerUnit or the charges");
  if (o.maxCharges !== undefined && (!num(o.maxCharges) || !Number.isInteger(o.maxCharges) || o.maxCharges < o.charges.length || o.maxCharges > 6)) p.push("maxCharges must be a whole number from the number of charges up to 6");
  if (num(lpu) && num(qMax) && num(o.maxCharges ?? o.charges.length) && (o.maxCharges as number ?? o.charges.length) * qMax * lpu > 220) p.push("maxCharges × qMax × linesPerUnit is too many lines (≤ 220)");
  if (o.conductor !== undefined) {
    const c = o.conductor;
    if (!isObj(c) || !num(c.x) || !num(c.y) || !num(c.r) || c.r <= 0) p.push("conductor must be { x, y, r } with r > 0");
    else {
      closed(c, ["x", "y", "r", "grounded"], "conductor", p);
      if (c.grounded !== undefined && typeof c.grounded !== "boolean") p.push("conductor.grounded must be true or false");
      if (Math.abs(c.x) + c.r > vw / 2 || Math.abs(c.y) + c.r > vh / 2) p.push("conductor must fit inside the view");
      const cx = c.x as number, cy = c.y as number, cr = c.r as number;
      if (qs.some(q => Math.hypot(q.x - cx, q.y - cy) < cr * 1.15)) p.push("charges must sit outside the conductor");
    }
  }
  if (o.probe !== undefined && (!isObj(o.probe) || !num(o.probe.x) || !num(o.probe.y) || Math.abs(o.probe.x) > vw / 2 || Math.abs(o.probe.y) > vh / 2)) p.push("probe must be { x, y } inside the view");
  else if (isObj(o.probe)) closed(o.probe, ["x", "y"], "probe", p);
  if (o.show !== undefined) { if (!isObj(o.show)) p.push("show must be an object"); else { closed(o.show, ["lines", "equipotentials", "potentialMap"], "show", p); for (const [k, v] of Object.entries(o.show)) if (typeof v !== "boolean") p.push(`show.${k} must be true or false`); } }
  const f = findingsOk(o, ["oneArrow", "nullPoint", "superposition", "inverseSquare", "shielding"], p);
  if (f.includes("shielding") && o.conductor === undefined) p.push("the shielding finding needs a conductor");
  if (f.includes("inverseSquare") && o.conductor !== undefined) p.push("the inverseSquare finding needs no conductor");
  if (f.includes("superposition") && o.charges.length < 2 && (o.maxCharges ?? 1) as number < 2 && o.conductor === undefined) p.push("the superposition finding needs two charges (or maxCharges ≥ 2)");
}

function validateWaves(o: O, p: string[]) {
  closed(o, ["mode", "title", "goal", "units", "wavelength", "scene", "screen", "view", "scaleNote", "soundSpeed", "findings"], "config", p);
  common(o, p);
  if (!isObj(o.units) || !["nm", "µm", "mm", "cm", "m"].includes(o.units.length as string)) p.push("units must be { length: nm | µm | mm | cm | m }");
  else closed(o.units, ["length"], "units", p);
  if (o.scaleNote !== undefined && !str(o.scaleNote, 80)) p.push("scaleNote must be short text");
  if (o.soundSpeed !== undefined && (!num(o.soundSpeed) || o.soundSpeed < 1 || o.soundSpeed > 10000 || !isObj(o.units) || o.units.length !== "m")) p.push("soundSpeed must be a speed in m/s (1–10000) with length unit m");
  const w = o.wavelength;
  if (!isObj(w) || !num(w.value) || !num(w.min) || !num(w.max) || w.min <= 0 || w.min > w.value || w.value > w.max) { p.push("wavelength must be { value, min, max } with 0 < min ≤ value ≤ max"); return; }
  closed(w, ["value", "min", "max", "step"], "wavelength", p);
  if (w.step !== undefined && (!num(w.step) || w.step <= 0 || (w.max - w.min) / w.step > 2000)) p.push("wavelength.step must be positive (≤ 2000 steps)");
  const v = o.view;
  if (!isObj(v) || !num(v.x0) || !num(v.x1) || !num(v.yHalf) || v.x1 <= v.x0 || v.yHalf <= 0) { p.push("view must be { x0, x1, yHalf } with x1 > x0 and yHalf > 0"); return; }
  closed(v, ["x0", "x1", "yHalf"], "view", p);
  const vx = v.x1 - v.x0, vx0 = v.x0 as number, vx1 = v.x1 as number, vyh = v.yHalf as number;
  if (vx / (2 * v.yHalf) > 4 || vx / (2 * v.yHalf) < 0.8) p.push("view must be 0.8–4 times wider than tall");
  if (vx / w.min > 260) p.push("the shortest wavelength is too small to draw in this view (view width ≤ 260 λ)");
  const sc = o.scene;
  let sourceX = -Infinity, apertures = 0;
  if (!isObj(sc) || (sc.kind !== "sources" && sc.kind !== "slits")) { p.push("scene.kind must be sources or slits"); return; }
  if (sc.kind === "sources") {
    closed(sc, ["kind", "sources"], "scene", p);
    if (!Array.isArray(sc.sources) || sc.sources.length < 1 || sc.sources.length > 8) { p.push("scene.sources must list 1–8 sources"); return; }
    const ids = new Set<string>();
    sc.sources.forEach((q, i) => {
      if (!isObj(q) || !num(q.x) || !num(q.y)) { p.push(`scene.sources[${i}] must be { id, x, y }`); return; }
      closed(q, ["id", "x", "y"], `scene.sources[${i}]`, p);
      if (!str(q.id, 3) || ids.has(q.id)) p.push(`scene.sources[${i}].id must be a unique 1–3 character id`); else ids.add(q.id);
      if (q.x < vx0 || q.x > vx1 || Math.abs(q.y) > vyh) p.push(`scene.sources[${i}] must be inside the view`);
      sourceX = Math.max(sourceX, q.x);
    });
    apertures = sc.sources.length;
  } else {
    closed(sc, ["kind", "barrierX", "slits", "minWidth", "maxWidth"], "scene", p);
    if (!num(sc.barrierX) || sc.barrierX <= v.x0 || sc.barrierX >= v.x1) p.push("scene.barrierX must be inside the view");
    else if (sc.barrierX - v.x0 < 2 * w.max) p.push("leave at least two of the longest wavelengths left of the barrier (for the wavelength crest)");
    const minW = sc.minWidth === undefined ? w.min / 4 : sc.minWidth, maxW = sc.maxWidth === undefined ? v.yHalf / 2 : sc.maxWidth;
    if (!num(minW) || !num(maxW) || minW <= 0 || maxW < minW) p.push("slit minWidth/maxWidth must be positive with max ≥ min");
    if (!Array.isArray(sc.slits) || sc.slits.length < 1 || sc.slits.length > 4) { p.push("scene.slits must list 1–4 slits"); return; }
    const ids = new Set<string>(); const sl: { y: number; width: number }[] = [];
    sc.slits.forEach((q, i) => {
      if (!isObj(q) || !num(q.y) || !num(q.width) || q.width <= 0) { p.push(`scene.slits[${i}] must be { id, y, width > 0 }`); return; }
      closed(q, ["id", "y", "width"], `scene.slits[${i}]`, p);
      if (!str(q.id, 3) || ids.has(q.id)) p.push(`scene.slits[${i}].id must be a unique 1–3 character id`); else ids.add(q.id);
      if (num(minW) && num(maxW) && (q.width < minW - 1e-9 || q.width > maxW + 1e-9)) p.push(`scene.slits[${i}].width must be within minWidth–maxWidth`);
      if (Math.abs(q.y) + q.width / 2 > vyh) p.push(`scene.slits[${i}] must fit on the barrier`);
      sl.push({ y: q.y, width: q.width });
    });
    sl.sort((a, b) => a.y - b.y);
    for (let i = 1; i < sl.length; i++) if (sl[i].y - sl[i].width / 2 <= sl[i - 1].y + sl[i - 1].width / 2) p.push("slits overlap");
    if (num(maxW) && Math.ceil((2 * maxW) / w.min) + 1 > Math.floor(MAX_WAVELETS / sl.length)) p.push(`maxWidth is too wide for the shortest wavelength (≤ ${fmtN(((Math.floor(MAX_WAVELETS / Math.max(1, sl.length)) - 1) * w.min) / 2)})`);
    void slitSamples;
    sourceX = num(sc.barrierX) ? sc.barrierX : 0; apertures = sl.length;
  }
  const s = o.screen;
  if (!isObj(s) || !num(s.x) || !num(s.min) || !num(s.max) || s.min > s.x || s.x > s.max) p.push("screen must be { x, min, max } with min ≤ x ≤ max");
  else {
    closed(s, ["x", "min", "max"], "screen", p);
    if (s.max > v.x1) p.push("screen.max must be inside the view");
    if (s.min < sourceX + 4 * w.max) p.push("screen.min must be at least four of the longest wavelengths past the sources/slits");
  }
  const f = findingsOk(o, ["bright", "dark", "spacing", "width", "separation"], p);
  if ((f.includes("bright") || f.includes("separation")) && apertures < 2) p.push("bright and separation findings need two or more slits or sources");
  if (f.includes("width") && sc.kind !== "slits") p.push("the width finding needs slits");
}

function validateQuantum(o: O, p: string[]) {
  closed(o, ["mode", "title", "goal", "units", "view", "domain", "energyRange", "potential", "energy", "states", "selected", "depthAxis", "widthAxis", "findings"], "config", p);
  common(o, p);
  if (o.units !== "natural" && o.units !== "electron") p.push("units must be natural or electron");
  if (o.view !== "bound" && o.view !== "tunnel") { p.push("view must be bound or tunnel"); return; }
  const d = o.domain, er = o.energyRange;
  if (!Array.isArray(d) || d.length !== 2 || !num(d[0]) || !num(d[1]) || d[1] <= d[0]) { p.push("domain must be [xMin, xMax] with xMax > xMin"); return; }
  if (!Array.isArray(er) || er.length !== 2 || !num(er[0]) || !num(er[1]) || er[1] <= er[0]) { p.push("energyRange must be [eMin, eMax] with eMax > eMin"); return; }
  const [d0, d1] = d as number[], [e0, e1] = er as number[], span = d1 - d0;
  const inD = (x: number) => x >= d0 && x <= d1;
  const pot = o.potential;
  if (!isObj(pot) || typeof pot.kind !== "string") { p.push("potential must be an object with a kind"); return; }
  const need = (keys: string[]) => { closed(pot, ["kind", ...keys], "potential", p); };
  switch (pot.kind) {
    case "infinite":
      need(["left", "right"]);
      if (!num(pot.left) || !num(pot.right) || pot.right - pot.left < span * 0.05 || !inD(pot.left) || !inD(pot.right)) p.push("infinite well needs left < right inside the domain (width ≥ 5% of it)");
      break;
    case "finiteSquare":
      need(["left", "right", "depth"]);
      if (!num(pot.left) || !num(pot.right) || pot.right - pot.left < span * 0.05 || !inD(pot.left) || !inD(pot.right)) p.push("finite well needs left < right inside the domain (width ≥ 5% of it)");
      else if (pot.left - d0 < (pot.right - pot.left) * 0.4 || d1 - pot.right < (pot.right - pot.left) * 0.4) p.push("leave room outside the finite well (at least 0.4 × its width each side) for ψ to decay");
      if (!num(pot.depth) || pot.depth <= 0 || -pot.depth < e0) p.push("finite well depth must be positive and inside the energy range");
      break;
    case "harmonic":
      need(["hw", "center"]);
      if (!num(pot.hw) || pot.hw <= 0 || pot.hw > (e1 - e0)) p.push("harmonic hw must be positive and smaller than the energy range");
      if (pot.center !== undefined && (!num(pot.center) || !inD(pot.center))) p.push("harmonic center must be inside the domain");
      break;
    case "doubleWell":
      need(["barrier", "separation", "center"]);
      if (!num(pot.barrier) || pot.barrier <= 0 || pot.barrier > e1) p.push("doubleWell barrier must be positive and on the energy axis");
      if (!num(pot.separation) || pot.separation <= 0) p.push("doubleWell separation must be positive");
      else { const c0 = pot.center === undefined ? 0 : pot.center; if (!num(c0) || !inD(c0 - 1.6 * pot.separation) || !inD(c0 + 1.6 * pot.separation)) p.push("doubleWell needs the domain to reach 1.6 × separation either side of its center"); }
      break;
    case "barrier":
      need(["left", "right", "height"]);
      if (!num(pot.left) || !num(pot.right) || pot.right <= pot.left || !inD(pot.left) || !inD(pot.right)) p.push("barrier needs left < right inside the domain");
      if (!num(pot.height) || pot.height <= 0 || pot.height > e1) p.push("barrier height must be positive and on the energy axis");
      break;
    case "points": {
      need(["points"]);
      const pts = pot.points;
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > 12) { p.push("points must list 2–12 [x, V] pairs"); break; }
      let prev = -Infinity;
      pts.forEach((q, i) => {
        if (!Array.isArray(q) || q.length !== 2 || !num(q[0]) || !num(q[1])) { p.push(`points[${i}] must be [x, V]`); return; }
        if (q[0] <= prev) p.push("points must have increasing x"); prev = q[0];
        if (!inD(q[0]) || q[1] < e0 || q[1] > e1) p.push(`points[${i}] must be inside the domain and the energy range`);
      });
      break;
    }
    default: p.push("potential.kind must be infinite, finiteSquare, harmonic, doubleWell, barrier or points");
  }
  if (o.states !== undefined && (!num(o.states) || !Number.isInteger(o.states) || o.states < 1 || o.states > 12)) p.push("states must be a whole number 1–12");
  if (o.selected !== undefined && (!num(o.selected) || !Number.isInteger(o.selected) || o.selected < 1 || o.selected > (num(o.states) ? o.states : 6))) p.push("selected must be a level number within states");
  if (o.view === "tunnel") {
    if (pot.kind !== "barrier" && pot.kind !== "points") p.push("the tunnel view needs a barrier or points potential");
    const en = o.energy;
    if (!isObj(en) || !num(en.value) || !num(en.min) || !num(en.max) || en.min <= 0 || en.min > en.value || en.value > en.max || en.max > e1) p.push("tunnel view needs energy { value, min, max } with 0 < min ≤ value ≤ max ≤ eMax");
    else {
      closed(en, ["value", "min", "max"], "energy", p);
      if (pot.kind === "points" && Array.isArray(pot.points) && pot.points.length >= 2) {
        const a = pot.points[0], b = pot.points[pot.points.length - 1];
        if (Array.isArray(a) && Array.isArray(b) && (a[1] !== 0 || b[1] !== 0)) p.push("for tunnelling, the first and last points must have V = 0 (free on both sides)");
      }
    }
    if (o.depthAxis !== undefined) p.push("depthAxis is only for a bound finiteSquare well");
    if (o.widthAxis !== undefined) {
      if (!isObj(o.widthAxis) || !num(o.widthAxis.max) || o.widthAxis.max <= 0) p.push("widthAxis must be { max > 0 }");
      else { closed(o.widthAxis, ["max"], "widthAxis", p); if (pot.kind !== "barrier") p.push("widthAxis needs a barrier potential"); else if (num(pot.left) && num(pot.right) && (pot.right - pot.left > o.widthAxis.max || pot.left + o.widthAxis.max > d1)) p.push("widthAxis.max must cover the barrier width and fit in the domain from its left edge"); }
    }
    findingsOk(o, ["tunnels", "exponential", "reflectsAbove", "resonance"], p);
  } else {
    if (pot.kind === "barrier") p.push("a barrier has no bound states: use view tunnel");
    if (o.energy !== undefined) p.push("energy is only for the tunnel view");
    if (o.widthAxis !== undefined) p.push("widthAxis is only for the tunnel view");
    if (o.depthAxis !== undefined) {
      if (!isObj(o.depthAxis) || !num(o.depthAxis.max) || o.depthAxis.max <= 0) p.push("depthAxis must be { max > 0 }");
      else {
        closed(o.depthAxis, ["max"], "depthAxis", p);
        if (pot.kind !== "finiteSquare") p.push("depthAxis needs a finiteSquare potential");
        else if (num(pot.depth) && (pot.depth > o.depthAxis.max || -o.depthAxis.max < e0)) p.push("depthAxis.max must be ≥ the depth and its floor must fit on the energy axis");
        else if (num(pot.left) && num(pot.right) && o.units !== undefined && (o.units === "natural" || o.units === "electron") && boundStateCount(pot.right - pot.left, o.depthAxis.max, o.units) > 12) p.push("depthAxis.max allows more than 12 bound states");
      }
    }
    findingsOk(o, ["zeroPoint", "forbidden", "evenSpacing", "splitting"], p);
  }
}
const fmtN = (v: number) => (Math.round(v * 100) / 100).toString();

export function validatePhysicsLab(config: unknown): string[] {
  const p: string[] = [];
  try {
    if (!isObj(config)) return ["config must be an object"];
    if (config.mode === "field") validateField(config, p);
    else if (config.mode === "waves") validateWaves(config, p);
    else if (config.mode === "quantum") validateQuantum(config, p);
    else p.push("mode must be field, waves or quantum");
  } catch (e) { p.push("config could not be checked: " + String(e).slice(0, 80)); }
  return p;
}

/* ============================ the component ============================ */

export function PhysicsLab({ config, onChange, onShare }: { config: PhysicsConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const problems = useMemo(() => validatePhysicsLab(config), [config]);
  if (problems.length) return <section className="activity physics" data-simulation="physics-lab" data-invalid="true">
    <p className="pl-fallback">This physics lab couldn’t be drawn from its settings, so here is the idea in words instead: ask Keating to walk through it.</p>
    <details className="receipt"><summary>What was wrong</summary><ul className="pl-problems">{problems.slice(0, 8).map(q => <li key={q}>{q}</li>)}</ul></details>
  </section>;
  if (config.mode === "field") return <FieldLab config={config} onChange={onChange} onShare={onShare} />;
  if (config.mode === "waves") return <WavesLab config={config} onChange={onChange} onShare={onShare} />;
  return <QuantumLab config={config} onChange={onChange} onShare={onShare} />;
}
