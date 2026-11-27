import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import {
  accumulation, conc, cssAverage, doseRatio, fractionOfSteadyState, loadingDose, maintenanceDose, oncRun, quantal, quantalDose,
  readEc50, readHalfLife, response, solveScale, terms, type Cycle, type Dose, type OncParams, type PdState, type Route,
} from "./model";
import "./component.css";
import { useElementWidth } from "../hooks";
import { useReducedMotion } from "../../../hooks/use-media-query";

/* PharmLab: the learner drags the drug itself (doses on a timeline, antagonist molecules onto a concentration line,
   chemotherapy cycles onto a calendar). Every curve comes from model.ts. Educational model, not for clinical dosing. */

export type ShareSummary = { learner: string; data: string; reply: string };

export type PkConfig = {
  mode: "pk"; title: string; goal?: string;
  drug: {
    name: string; doseUnit: "mg" | "µg"; concUnit: "mg/L" | "µg/mL" | "µg/L" | "ng/mL";
    v: number; cl?: number; halfLife?: number;          // give cl, or halfLife (cl is then ln2·V/t½)
    f?: number; ka?: number;                            // oral: bioavailability (0–1) and absorption rate (1/h)
    q?: number; v2?: number;                            // optional second compartment (L/h, L)
    range: { low: number; high: number; label?: string };
    toxic?: number; target?: number;                    // toxic: level above which adverse-effect risk rises (a risk signal, not a cutoff)
    sampleAfter?: number;                               // hours after a dose before a level is interpretable (distribution phase); earlier points are not graded
    trough?: { max?: number; min?: number; onceDaily?: number };   // onceDaily: trough ceiling used when doses are ≥ 24 h apart
    peak?: { min?: number; max?: number; at?: number }; // at = hours after the dose starts (e.g. a 1-h level)
    source: string;
  };
  regimen: {
    route: Route; hours?: number; interval: number;
    doses: Dose[]; addRoute?: Route; addHours?: number;
    maxDose: number; doseStep: number; timeStep: number;
  };
  patient?: { clearance?: { label: string; min: number; max: number }; volume?: { label: string; min: number; max: number }; note?: string };
  view: { hours: number; yMax: number; days?: boolean };
};

export type PdLigand = { id: string; name: string; kind: "competitive" | "noncompetitive" | "partial"; k: number; efficacy?: number; conc?: number };
export type PdConfig = {
  mode: "pd"; title: string; goal?: string;
  view: "receptor" | "quantal";
  range: [number, number];                           // receptor: molar concentration; quantal: dose
  agonist?: { name: string; ec50: number; probe?: number };
  ligands?: PdLigand[];
  quantal?: { drug: string; unit: string; ed50: number; td50: number; sigma: number; dose: number; tdMin?: number; tdMax?: number };
  assumptions?: string;
  source: string;
};

export type OncConfig = {
  mode: "oncology"; title: string; goal?: string;
  regimen: { name: string; cycles: Cycle[]; maxCycles: number; dayStep?: number; doseStep?: number };
  tumour: { n0: number; k: number; b: number; logKill: number; detect?: number };
  marrow: { anc0: number; mtt: number; gamma: number; effect: number; effectDays: number; threshold: number; gcsf?: boolean; gcsfBoost?: number; gcsfMtt?: number };
  days: number; residualAfter?: number;   // residual tumour is read this many days after the last cycle given (default 21)
  source: string;
};

export type PharmConfig = PkConfig | PdConfig | OncConfig;

/* ============================ presets ============================ */

export const presets: Record<string, PharmConfig> = {
  digoxinLoading: {
    mode: "pk", title: "Digoxin: maintenance doses, then a loading dose",
    goal: "Daily 250 µg tablets take over a week to build up to their plateau. Drag the first dose taller and watch when the troughs get there.",
    drug: {
      name: "Digoxin", doseUnit: "µg", concUnit: "ng/mL", v: 500, cl: 7, f: 0.7, ka: 2,
      range: { low: 0.5, high: 2, label: "range 0.5–2 (illustrative)" }, toxic: 2, target: 1, sampleAfter: 6,
      source: "Katzung 9e Table 3–1: F 70%, CL 7 L/h, V 500 L, t½ 50 h, target 1 ng/mL. Digoxin label (DailyMed): 6–8 h distribution phase, so sample ≥ 6 h after a dose; toxicity usually above 2 ng/mL but symptoms may occur at lower levels. Heart failure: 2013 ACCF/AHA targets 0.5–0.9 ng/mL (2022 AHA/ACC/HFSA: ≤ 1.0). ka illustrative.",
    },
    regimen: { route: "oral", interval: 24, doses: Array.from({ length: 12 }, (_, i) => ({ t: i * 24, amount: 250 })), maxDose: 1000, doseStep: 25, timeStep: 1 },
    patient: { clearance: { label: "Kidney function (clearance)", min: 0.2, max: 1.6 }, volume: { label: "Volume of distribution", min: 0.5, max: 1.6 },
      note: "In this model V is held fixed when clearance changes. In severe renal impairment digoxin's V also falls, so real loading doses are reduced too." },
    view: { hours: 288, yMax: 3, days: true },
  },
  gentamicinTrough: {
    mode: "pk", title: "Gentamicin: the timed level and the pre-dose trough",
    goal: "120 mg every 8 h by 30-minute infusion. Drag the kidneys' clearance down to a quarter, then see what spacing the doses does to the pre-dose level.",
    drug: {
      name: "Gentamicin", doseUnit: "mg", concUnit: "mg/L", v: 17.5, halfLife: 2.5,
      range: { low: 4, high: 10, label: "1-h sample 4–10" }, trough: { max: 2, onceDaily: 1 }, peak: { min: 4, max: 10, at: 1 },
      source: "Gentamicin SmPC (emc 2407, 12877): V ≈ extracellular water (0.25 L/kg, 17.5 L at 70 kg); t½ 2–3 h with normal kidneys, longer in renal impairment. Divided dosing: 1-h level 4–10 mg/L (30 min after a 30-min infusion ends), trough < 2 mg/L. Once daily: trough < 1 mg/L.",
    },
    regimen: { route: "infusion", hours: 0.5, interval: 8, doses: Array.from({ length: 9 }, (_, i) => ({ t: i * 8, amount: 120 })), maxDose: 400, doseStep: 10, timeStep: 0.5 },
    patient: { clearance: { label: "Kidney function (clearance)", min: 0.15, max: 1.5 }, volume: { label: "Volume (extracellular water)", min: 0.6, max: 1.8 } },
    view: { hours: 72, yMax: 16 },
  },
  theophyllineInfusion: {
    mode: "pk", title: "Theophylline: an infusion, and a loading dose on top",
    goal: "28 mg/h by infusion (as 12-hour bags). Drag the + onto hour 0 to add a 30-minute loading infusion and watch the level rise to the plateau within half an hour.",
    drug: {
      name: "Theophylline", doseUnit: "mg", concUnit: "mg/L", v: 35, cl: 2.8,
      range: { low: 10, high: 20, label: "10–20 (illustrative band)" }, toxic: 20, target: 10,
      source: "Katzung 9e Table 3–1; worked example Katzung 13e ch. 3: CL 2.8 L/h, V 35 L, target 10 mg/L; infusion 28 mg/h; loading dose 350 mg. Theophylline injection label (DailyMed): loading dose infused over 30 minutes, only after a level if any theophylline in the past 24 h; adverse reactions more frequent and severe above 20 mcg/mL.",
    },
    regimen: { route: "infusion", hours: 12, interval: 12, doses: [0, 12, 24, 36].map(t => ({ t, amount: 336 })), addRoute: "infusion", addHours: 0.5, maxDose: 700, doseStep: 10, timeStep: 0.5 },
    patient: { clearance: { label: "Clearance (smoking raises it, heart failure lowers it)", min: 0.3, max: 2 }, volume: { label: "Volume of distribution", min: 0.6, max: 1.6 } },
    view: { hours: 48, yMax: 25 },
  },
  receptorAntagonism: {
    mode: "pd", title: "Acetylcholine on ileum: two ways to block it",
    goal: "Drag atropine onto the concentration line, then verapamil. Watch what each does to the curve's position and its top.",
    view: "receptor", range: [1e-10, 1e-2],
    agonist: { name: "Acetylcholine", ec50: 1e-7, probe: 1e-6 },
    ligands: [
      { id: "atropine", name: "Atropine", kind: "competitive", k: 1e-9 },
      { id: "verapamil", name: "Verapamil", kind: "noncompetitive", k: 3e-7 },
    ],
    assumptions: "Response ∝ occupancy, no spare receptors, Hill slope 1. ACh EC50 and the verapamil constant are illustrative orders of magnitude.",
    source: "Atropine KB ≈ 1 nM (pA2 ≈ 9 on guinea-pig ileum, Arunlakshana & Schild 1959). Rang & Dale ch. 2: competitive vs non-competitive antagonism (verapamil blocks Ca²⁺ entry downstream).",
  },
  partialAgonist: {
    mode: "pd", title: "Morphine and buprenorphine at the µ receptor",
    goal: "Buprenorphine binds tighter but does less. Drag it in while morphine is high and watch the response.",
    view: "receptor", range: [1e-12, 1e-5],
    agonist: { name: "Morphine", ec50: 1.2e-9, probe: 3e-8 },
    ligands: [{ id: "bup", name: "Buprenorphine", kind: "partial", k: 2.2e-10, efficacy: 0.4 }],
    assumptions: "Response ∝ efficacy × occupancy, no spare receptors, so EC50 = Ki. Buprenorphine's efficacy (40% of morphine's) is illustrative.",
    source: "µ-receptor Ki: morphine 1.17 nM, buprenorphine 0.22 nM (Volpe et al. 2011, Regul Toxicol Pharmacol 59:385). Katzung ch. 31: buprenorphine is a high-affinity partial µ agonist.",
  },
  therapeuticIndex: {
    mode: "pd", title: "Therapeutic index from two population curves",
    goal: "Drag the dose along the axis. Then drag the toxic curve closer and watch how the safe gap shrinks.",
    view: "quantal", range: [0.5, 1000],
    quantal: { drug: "Drug X (illustrative)", unit: "mg/kg", ed50: 10, td50: 80, sigma: 0.25, dose: 10, tdMin: 12, tdMax: 600 },
    assumptions: "Illustrative drug. Each curve is the cumulative % of a population responding (log-normal, σ = 0.25 log₁₀ units).",
    source: "Katzung ch. 2 (quantal dose–response, therapeutic index = TD50/ED50); Rang & Dale ch. 2.",
  },
  doseDense: {
    mode: "oncology", title: "Dose-dense chemotherapy and the neutrophil nadir",
    goal: "Four cycles every 21 days. Drag them to every 14 days. Then try again with G-CSF support.",
    regimen: { name: "AC-type cycles", cycles: [0, 21, 42, 63].map(day => ({ day, dose: 1 })), maxCycles: 8, dayStep: 1, doseStep: 0.05 },
    tumour: { n0: 1e10, k: 3e12, b: 0.0029, logKill: 1, detect: 1e9 },
    marrow: { anc0: 5, mtt: 125, gamma: 0.17, effect: 0.97, effectDays: 3, threshold: 1.5, gcsf: false, gcsfBoost: 0.15, gcsfMtt: 100 },
    days: 112, residualAfter: 21,
    source: "Skipper–Schabel–Wilcox log-kill (Skipper 1964); Gompertzian regrowth (Norton & Simon 1977); CALGB 9741 (Citron 2003) gave both every-2-week arms with filgrastim; neutrophil model after Friberg 2002; ANC grades from CTCAE v6.0. Rates calibrated for teaching.",
  },
};

export const scenario = {
  tab: "Pharmacology",
  prompt: "Why do we give a loading dose for some drugs?",
  intro: "Because the time to reach steady state is set by the half-life, not the dose. Digoxin's half-life is about two days, so daily tablets take four to five half-lives, more than a week, to build up. Drag the first dose and see what a loading dose changes and what it doesn't.",
  receiptLabel: "Pharmacokinetics lab",
  receiptText: "One-compartment model with first-order oral absorption; it ignores digoxin's 6–8 h distribution phase, so early peaks are not interpretable levels. Every curve is the closed-form sum of each dose's response. Educational model, not for clinical dosing.",
  preset: "digoxinLoading",
};

export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  digoxinLoading: { label: "Loading dose", prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  gentamicinTrough: { label: "Trough targeting", prompt: "Why does the gentamicin trough matter when the kidneys fail?",
    intro: "Gentamicin is cleared almost entirely by the kidneys, and toxicity tracks how long the level stays up between doses. Drag the clearance down, then decide whether to cut the dose or space it out.",
    receiptLabel: "Pharmacokinetics lab", receiptText: "One-compartment model, 30-minute infusions, superposed. Educational model, not for clinical dosing." },
  theophyllineInfusion: { label: "Infusion", prompt: "How do you work out an infusion rate and a loading dose?",
    intro: "Rate in equals rate out at steady state, so the infusion rate is CL × target: 2.8 L/h × 10 mg/L = 28 mg/h. The loading dose fills the volume: 35 L × 10 mg/L = 350 mg, which the injection label gives as an infusion over 30 minutes. Try it.",
    receiptLabel: "Pharmacokinetics lab", receiptText: "One-compartment model, zero-order infusions, including a 30-minute loading infusion. Educational model, not for clinical dosing." },
  receptorAntagonism: { label: "Antagonists", prompt: "What's the difference between competitive and non-competitive antagonists?",
    intro: "A competitive antagonist fights for the same site, so enough agonist wins it back: the curve slides right. A non-competitive one takes receptors or a downstream step out of play, so the top drops. Drag them in.",
    receiptLabel: "Dose–response lab", receiptText: "Occupancy model on a log-concentration axis. Educational model, not for clinical dosing." },
  partialAgonist: { label: "Partial agonist", prompt: "Why can buprenorphine cause withdrawal in someone on morphine?",
    intro: "Buprenorphine binds the µ receptor more tightly than morphine but activates it less. Drag it in while morphine is high and see what happens to the response.",
    receiptLabel: "Dose–response lab", receiptText: "Two ligands competing for one receptor, each with its own efficacy. Educational model, not for clinical dosing." },
  therapeuticIndex: { label: "Therapeutic index", prompt: "What does a narrow therapeutic index actually mean?",
    intro: "It compares two population curves: the dose that works in half of people and the dose that harms half. Drag the dose, then drag the toxic curve.",
    receiptLabel: "Dose–response lab", receiptText: "Log-normal quantal curves for an illustrative drug. Educational model, not for clinical dosing." },
  doseDense: { label: "Chemo cycles", prompt: "Why do some regimens give chemo every two weeks instead of three?",
    intro: "Each cycle kills a fraction of the tumour cells, and the survivors regrow between cycles. Shorter gaps leave less time to regrow, but the marrow needs time too. Drag the cycles.",
    receiptLabel: "Chemotherapy cycles lab", receiptText: "Log-kill with Gompertzian regrowth and a neutrophil transit model. A teaching model, not a treatment plan." },
};

/* ============================ validation ============================ */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 400;
function closed(o: Record<string, unknown>, keys: string[], where: string, out: string[]) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) out.push(`${where}: unknown key "${k}"`);
}

export function validatePharmLab(config: unknown): string[] {
  const p: string[] = [];
  try {
    if (!isObj(config)) return ["config must be an object"];
    const c = config;
    if (c.mode === "pk") validatePk(c, p);
    else if (c.mode === "pd") validatePd(c, p);
    else if (c.mode === "oncology") validateOnc(c, p);
    else return [`mode must be "pk", "pd" or "oncology"`];
    if (!str(c.title)) p.push("title must be a non-empty string");
    if (c.goal !== undefined && !str(c.goal)) p.push("goal must be a string");
  } catch (e) { p.push(`config could not be checked (${String(e).slice(0, 80)})`); }
  return p;
}

const CONC_FOR: Record<string, string[]> = { mg: ["mg/L", "µg/mL"], "µg": ["µg/L", "ng/mL"] };

function validatePk(c: Record<string, unknown>, p: string[]) {
  closed(c, ["mode", "title", "goal", "drug", "regimen", "patient", "view"], "config", p);
  const d = c.drug, r = c.regimen, v = c.view;
  if (!isObj(d)) { p.push("drug must be an object"); return; }
  if (!isObj(r)) { p.push("regimen must be an object"); return; }
  if (!isObj(v)) { p.push("view must be an object"); return; }
  closed(d, ["name", "doseUnit", "concUnit", "v", "cl", "halfLife", "f", "ka", "q", "v2", "range", "toxic", "target", "sampleAfter", "trough", "peak", "source"], "drug", p);
  closed(r, ["route", "hours", "interval", "doses", "addRoute", "addHours", "maxDose", "doseStep", "timeStep"], "regimen", p);
  closed(v, ["hours", "yMax", "days"], "view", p);
  if (!str(d.name)) p.push("drug.name must be a string");
  if (!str(d.source)) p.push("drug.source must cite where the numbers come from");
  if (d.doseUnit !== "mg" && d.doseUnit !== "µg") p.push(`drug.doseUnit must be "mg" or "µg"`);
  else if (!CONC_FOR[d.doseUnit as string].includes(d.concUnit as string)) p.push(`drug.concUnit must be ${CONC_FOR[d.doseUnit as string].join(" or ")} when doses are in ${d.doseUnit} and V is in litres`);
  if (!pos(d.v) || (d.v as number) > 1e5) p.push("drug.v must be a positive volume in litres");
  if (d.cl === undefined && d.halfLife === undefined) p.push("drug needs cl (L/h) or halfLife (h)");
  if (d.cl !== undefined && d.halfLife !== undefined) p.push("give drug.cl or drug.halfLife, not both");
  if (d.cl !== undefined && (!pos(d.cl) || (d.cl as number) > 1e4)) p.push("drug.cl must be a positive clearance in L/h");
  if (d.halfLife !== undefined && (!pos(d.halfLife) || (d.halfLife as number) > 1e4)) p.push("drug.halfLife must be positive hours");
  if (d.f !== undefined && (!num(d.f) || (d.f as number) <= 0 || (d.f as number) > 1)) p.push("drug.f must be in (0, 1]");
  if (d.ka !== undefined && (!pos(d.ka) || (d.ka as number) > 100)) p.push("drug.ka must be a positive rate (1/h)");
  if ((d.q === undefined) !== (d.v2 === undefined)) p.push("drug.q and drug.v2 come together (second compartment)");
  if (d.q !== undefined && (!pos(d.q) || !pos(d.v2))) p.push("drug.q and drug.v2 must be positive");
  const range = d.range;
  if (!isObj(range) || !num(range.low) || !num(range.high) || (range.low as number) < 0 || (range.high as number) <= (range.low as number)) p.push("drug.range needs 0 ≤ low < high");
  else {
    closed(range, ["low", "high", "label"], "drug.range", p);
    if (range.label !== undefined && !str(range.label)) p.push("drug.range.label must be a string");
  }
  for (const k of ["toxic", "target"]) if (d[k] !== undefined && !pos(d[k])) p.push(`drug.${k} must be a positive concentration`);
  if (d.sampleAfter !== undefined && (!pos(d.sampleAfter) || (d.sampleAfter as number) > 48)) p.push("drug.sampleAfter must be hours after a dose (0–48)");
  for (const k of ["trough", "peak"]) {
    const t = d[k];
    if (t === undefined) continue;
    if (!isObj(t)) { p.push(`drug.${k} must be an object`); continue; }
    closed(t, k === "peak" ? ["min", "max", "at"] : ["min", "max", "onceDaily"], `drug.${k}`, p);
    if (t.onceDaily !== undefined && !pos(t.onceDaily)) p.push(`drug.${k}.onceDaily must be a positive concentration`);
    if (t.min !== undefined && (!num(t.min) || (t.min as number) < 0)) p.push(`drug.${k}.min must be a concentration ≥ 0`);
    if (t.max !== undefined && (!pos(t.max))) p.push(`drug.${k}.max must be a positive concentration`);
    if (num(t.min) && num(t.max) && (t.min as number) >= (t.max as number)) p.push(`drug.${k}.min must be below max`);
    if (t.at !== undefined && (!pos(t.at) || (t.at as number) > 48)) p.push(`drug.${k}.at must be hours after the dose (0–48)`);
    if (t.min === undefined && t.max === undefined) p.push(`drug.${k} needs min or max`);
  }
  const routes = ["bolus", "infusion", "oral"];
  if (!routes.includes(r.route as string)) p.push(`regimen.route must be bolus, infusion or oral`);
  if (r.addRoute !== undefined && !routes.includes(r.addRoute as string)) p.push(`regimen.addRoute must be bolus, infusion or oral`);
  const usesOral = r.route === "oral" || r.addRoute === "oral" || (Array.isArray(r.doses) && r.doses.some(x => isObj(x) && x.route === "oral"));
  if (usesOral && (!num(d.f) || !pos(d.ka))) p.push("oral doses need drug.f and drug.ka");
  const usesInf = r.route === "infusion" || r.addRoute === "infusion";
  if (usesInf && r.hours === undefined && r.addHours === undefined) p.push("infusions need regimen.hours");
  for (const k of ["hours", "addHours"]) if (r[k] !== undefined && (!pos(r[k]) || (r[k] as number) > 240)) p.push(`regimen.${k} must be positive hours`);
  if (!pos(r.interval)) p.push("regimen.interval must be positive hours");
  if (!pos(r.maxDose)) p.push("regimen.maxDose must be positive");
  if (!pos(r.doseStep)) p.push("regimen.doseStep must be positive");
  if (!pos(r.timeStep)) p.push("regimen.timeStep must be positive");
  if (pos(r.maxDose) && pos(r.doseStep) && (r.maxDose as number) / (r.doseStep as number) > 2000) p.push("regimen.doseStep is too fine for maxDose");
  if (!pos(v.hours) || (v.hours as number) > 24 * 120) p.push("view.hours must be positive (≤ 120 days)");
  if (!pos(v.yMax)) p.push("view.yMax must be positive");
  if (v.days !== undefined && typeof v.days !== "boolean") p.push("view.days must be true or false");
  if (pos(r.interval) && pos(v.hours) && pos(r.timeStep) && (v.hours as number) / (r.timeStep as number) > 5000) p.push("regimen.timeStep is too fine for view.hours");
  if (pos(r.interval) && pos(v.hours) && (r.interval as number) > (v.hours as number)) p.push("regimen.interval must fit inside view.hours");
  if (pos(r.timeStep) && pos(v.hours) && (r.timeStep as number) > (v.hours as number) / 8) p.push("regimen.timeStep must be ≤ view.hours / 8");
  if (pos(r.doseStep) && pos(r.maxDose) && (r.doseStep as number) > (r.maxDose as number) / 4) p.push("regimen.doseStep must be ≤ maxDose / 4");
  if (pos(v.yMax) && isObj(range) && num(range.high) && ((v.yMax as number) < (range.low as number) || (v.yMax as number) > 50 * (range.high as number))) p.push("view.yMax must show the window (≥ range.low, ≤ 50 × range.high)");
  if (!Array.isArray(r.doses)) p.push("regimen.doses must be an array");
  else {
    if (r.doses.length < 1 || r.doses.length > 40) p.push("regimen.doses needs 1–40 doses");
    r.doses.forEach((x, i) => {
      if (!isObj(x)) { p.push(`regimen.doses[${i}] must be an object`); return; }
      closed(x, ["t", "amount", "route", "hours"], `regimen.doses[${i}]`, p);
      if (!num(x.t) || (x.t as number) < 0 || (pos(v.hours) && (x.t as number) > (v.hours as number))) p.push(`regimen.doses[${i}].t must be within the view`);
      if (!num(x.amount) || (x.amount as number) < 0 || (pos(r.maxDose) && (x.amount as number) > (r.maxDose as number))) p.push(`regimen.doses[${i}].amount must be 0–maxDose`);
      if (x.route !== undefined && !routes.includes(x.route as string)) p.push(`regimen.doses[${i}].route is not a route`);
      if (x.hours !== undefined && !pos(x.hours)) p.push(`regimen.doses[${i}].hours must be positive`);
      if (x.route === "infusion" && x.hours === undefined && r.hours === undefined) p.push(`regimen.doses[${i}] is an infusion without hours`);
    });
  }
  const pt = c.patient;
  if (pt !== undefined) {
    if (!isObj(pt)) p.push("patient must be an object");
    else {
      closed(pt, ["clearance", "volume", "note"], "patient", p);
      for (const k of ["clearance", "volume"]) {
        const m = pt[k];
        if (m === undefined) continue;
        if (!isObj(m)) { p.push(`patient.${k} must be an object`); continue; }
        closed(m, ["label", "min", "max"], `patient.${k}`, p);
        if (!str(m.label)) p.push(`patient.${k}.label must be a string`);
        if (!pos(m.min) || !pos(m.max) || (m.min as number) >= 1 || (m.max as number) <= 1 || (m.max as number) / (m.min as number) > 100) p.push(`patient.${k} needs 0 < min < 1 < max (scales of the drug's value)`);
      }
      if (pt.note !== undefined && !str(pt.note)) p.push("patient.note must be a string");
    }
  }
}

function validatePd(c: Record<string, unknown>, p: string[]) {
  closed(c, ["mode", "title", "goal", "view", "range", "agonist", "ligands", "quantal", "assumptions", "source"], "config", p);
  if (!str(c.source)) p.push("source must cite where the numbers come from");
  if (c.assumptions !== undefined && !str(c.assumptions)) p.push("assumptions must be a string");
  const r = c.range;
  if (!Array.isArray(r) || r.length !== 2 || !pos(r[0]) || !pos(r[1]) || (r[1] as number) / (r[0] as number) < 10 || (r[1] as number) / (r[0] as number) > 1e14) { p.push("range must be [low, high] with high ≥ 10 × low (≤ 14 decades)"); return; }
  const [lo, hi] = r as [number, number];
  const inR = (x: unknown) => pos(x) && (x as number) >= lo && (x as number) <= hi;
  if (c.view === "receptor") {
    const a = c.agonist;
    if (!isObj(a)) { p.push("receptor view needs agonist"); return; }
    closed(a, ["name", "ec50", "probe"], "agonist", p);
    if (!str(a.name)) p.push("agonist.name must be a string");
    if (!inR(a.ec50)) p.push("agonist.ec50 must sit inside range");
    if (a.probe !== undefined && !inR(a.probe)) p.push("agonist.probe must sit inside range");
    if (c.quantal !== undefined) p.push("quantal belongs to the quantal view");
    if (!Array.isArray(c.ligands) || c.ligands.length < 1 || c.ligands.length > 3) { p.push("ligands needs 1–3 entries"); return; }
    const ids = new Set<string>();
    c.ligands.forEach((l, i) => {
      if (!isObj(l)) { p.push(`ligands[${i}] must be an object`); return; }
      closed(l, ["id", "name", "kind", "k", "efficacy", "conc"], `ligands[${i}]`, p);
      if (typeof l.id !== "string" || !/^[a-z][a-zA-Z0-9]{0,23}$/.test(l.id)) p.push(`ligands[${i}].id must be a short camelCase id`);
      else if (ids.has(l.id)) p.push(`ligands[${i}].id repeats`); else ids.add(l.id);
      if (!str(l.name)) p.push(`ligands[${i}].name must be a string`);
      if (!["competitive", "noncompetitive", "partial"].includes(l.kind as string)) p.push(`ligands[${i}].kind must be competitive, noncompetitive or partial`);
      if (!inR(l.k)) p.push(`ligands[${i}].k must sit inside range`);
      if (l.kind === "partial" && (!num(l.efficacy) || (l.efficacy as number) <= 0 || (l.efficacy as number) >= 1)) p.push(`ligands[${i}].efficacy must be in (0, 1) for a partial agonist`);
      if (l.kind !== "partial" && l.efficacy !== undefined) p.push(`ligands[${i}].efficacy only applies to partial agonists`);
      if (l.conc !== undefined && !(l.conc === 0 || inR(l.conc))) p.push(`ligands[${i}].conc must be 0 (in the tray) or inside range`);
    });
  } else if (c.view === "quantal") {
    const q = c.quantal;
    if (!isObj(q)) { p.push("quantal view needs quantal"); return; }
    if (c.agonist !== undefined || c.ligands !== undefined) p.push("agonist and ligands belong to the receptor view");
    closed(q, ["drug", "unit", "ed50", "td50", "sigma", "dose", "tdMin", "tdMax"], "quantal", p);
    if (!str(q.drug) || !str(q.unit)) p.push("quantal.drug and quantal.unit must be strings");
    if (!inR(q.ed50) || !inR(q.td50)) p.push("quantal.ed50 and td50 must sit inside range");
    else if ((q.td50 as number) <= (q.ed50 as number)) p.push("quantal.td50 must be above ed50");
    if (!num(q.sigma) || (q.sigma as number) < 0.02 || (q.sigma as number) > 2) p.push("quantal.sigma must be 0.02–2 log₁₀ units");
    if (!inR(q.dose)) p.push("quantal.dose must sit inside range");
    if (q.tdMin !== undefined && !inR(q.tdMin)) p.push("quantal.tdMin must sit inside range");
    if (q.tdMax !== undefined && !inR(q.tdMax)) p.push("quantal.tdMax must sit inside range");
    if (pos(q.ed50) && pos(q.tdMin) && (q.tdMin as number) <= (q.ed50 as number)) p.push("quantal.tdMin must be above ed50");
  } else p.push(`view must be "receptor" or "quantal"`);
}

function validateOnc(c: Record<string, unknown>, p: string[]) {
  closed(c, ["mode", "title", "goal", "regimen", "tumour", "marrow", "days", "residualAfter", "source"], "config", p);
  if (!str(c.source)) p.push("source must cite where the numbers come from");
  if (!pos(c.days) || (c.days as number) < 14 || (c.days as number) > 240) p.push("days must be 14–240");
  if (c.residualAfter !== undefined && (!pos(c.residualAfter) || (c.residualAfter as number) > 60)) p.push("residualAfter must be 0–60 days");
  const r = c.regimen, t = c.tumour, m = c.marrow;
  if (!isObj(r) || !isObj(t) || !isObj(m)) { p.push("regimen, tumour and marrow must be objects"); return; }
  closed(r, ["name", "cycles", "maxCycles", "dayStep", "doseStep"], "regimen", p);
  closed(t, ["n0", "k", "b", "logKill", "detect"], "tumour", p);
  closed(m, ["anc0", "mtt", "gamma", "effect", "effectDays", "threshold", "gcsf", "gcsfBoost", "gcsfMtt"], "marrow", p);
  if (!str(r.name)) p.push("regimen.name must be a string");
  if (!Number.isInteger(r.maxCycles) || (r.maxCycles as number) < 1 || (r.maxCycles as number) > 12) p.push("regimen.maxCycles must be 1–12");
  if (r.dayStep !== undefined && (!pos(r.dayStep) || (r.dayStep as number) > 7)) p.push("regimen.dayStep must be 0–7 days");
  if (r.doseStep !== undefined && (!pos(r.doseStep) || (r.doseStep as number) > 0.5)) p.push("regimen.doseStep must be 0–0.5");
  if (!Array.isArray(r.cycles) || r.cycles.length < 1 || (Number.isInteger(r.maxCycles) && r.cycles.length > (r.maxCycles as number))) p.push("regimen.cycles needs 1–maxCycles cycles");
  else r.cycles.forEach((x, i) => {
    if (!isObj(x)) { p.push(`regimen.cycles[${i}] must be an object`); return; }
    closed(x, ["day", "dose"], `regimen.cycles[${i}]`, p);
    if (!num(x.day) || (x.day as number) < 0 || (pos(c.days) && (x.day as number) > (c.days as number))) p.push(`regimen.cycles[${i}].day must be inside days`);
    if (!num(x.dose) || (x.dose as number) < 0.25 || (x.dose as number) > 1.25) p.push(`regimen.cycles[${i}].dose must be 0.25–1.25 (fraction of full dose)`);
  });
  if (!pos(t.n0) || !pos(t.k) || (t.n0 as number) >= (t.k as number) || (t.k as number) > 1e14) p.push("tumour needs 0 < n0 < k ≤ 1e14 cells");
  if (!pos(t.b) || (t.b as number) > 0.2) p.push("tumour.b must be a positive Gompertz rate per day (≤ 0.2)");
  if (!pos(t.logKill) || (t.logKill as number) > 5) p.push("tumour.logKill must be 0–5 logs per full cycle");
  if (t.detect !== undefined && !pos(t.detect)) p.push("tumour.detect must be a cell count");
  if (!pos(m.anc0) || (m.anc0 as number) > 20) p.push("marrow.anc0 must be 0–20 ×10⁹/L");
  if (!pos(m.mtt) || (m.mtt as number) < 24 || (m.mtt as number) > 400) p.push("marrow.mtt must be 24–400 h");
  if (m.gcsfMtt !== undefined && (!pos(m.gcsfMtt) || (m.gcsfMtt as number) < 24 || (m.gcsfMtt as number) > 400)) p.push("marrow.gcsfMtt must be 24–400 h");
  if (!num(m.gamma) || (m.gamma as number) < 0 || (m.gamma as number) > 1) p.push("marrow.gamma must be 0–1");
  if (!num(m.effect) || (m.effect as number) <= 0 || (m.effect as number) >= 1) p.push("marrow.effect must be in (0, 1)");
  if (!pos(m.effectDays) || (m.effectDays as number) > 14) p.push("marrow.effectDays must be 0–14");
  if (!pos(m.threshold) || (pos(m.anc0) && (m.threshold as number) >= (m.anc0 as number))) p.push("marrow.threshold must be below anc0");
  if (m.gcsf !== undefined && typeof m.gcsf !== "boolean") p.push("marrow.gcsf must be true or false");
  if (m.gcsfBoost !== undefined && (!num(m.gcsfBoost) || (m.gcsfBoost as number) < 0 || (m.gcsfBoost as number) > 0.4)) p.push("marrow.gcsfBoost must be 0–0.4");
}

/* ============================ shared helpers ============================ */

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const snap = (x: number, s: number) => Math.round(x / s) * s;
const trim = (x: number, d = 2) => {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const digits = a >= 100 ? 0 : a >= 10 ? Math.min(1, d) : a >= 1 ? d : d + 1;
  return x.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1").replace("-", "−");
};
const molar = (m: number) => {
  const units: [number, string][] = [[1e-3, "mM"], [1e-6, "µM"], [1e-9, "nM"], [1e-12, "pM"]];
  for (const [f, u] of units) if (m >= f * 0.9995) return `${trim(m / f, 1)} ${u}`;
  return `${trim(m / 1e-12, 2)} pM`;
};
const sci = (n: number) => { const e = Math.floor(Math.log10(n)); const m = n / 10 ** e; return m < 1.05 ? `10${sup(e)}` : `${m.toFixed(1)}×10${sup(e)}`; };
const sup = (e: number) => String(e).split("").map(ch => "⁰¹²³⁴⁵⁶⁷⁸⁹"["0123456789".indexOf(ch)] ?? (ch === "-" ? "⁻" : ch)).join("");

/** Committed state + undo stack + a live preview while a gesture runs. Cancelled gestures discard the preview. */
function useEditable<S>(initial: S, onChange?: () => void) {
  const [state, setState] = useState(initial);
  const [past, setPast] = useState<S[]>([]);
  const [live, setLive] = useState<S | null>(null);
  const [moves, setMoves] = useState(0);
  const [unchangedDrop, setUnchangedDrop] = useState(false);
  const commit = useCallback((next: S) => {
    setLive(null);
    if (JSON.stringify(next) === JSON.stringify(state)) { setUnchangedDrop(true); return; }
    setUnchangedDrop(false);
    setPast(p => [...p.slice(-40), state]); setState(next); setMoves(m => m + 1); onChange?.();
  }, [state, onChange]);
  const undo = useCallback(() => { setPast(p => { if (!p.length) return p; setState(p[p.length - 1]); return p.slice(0, -1); }); setLive(null); setMoves(m => m + 1); onChange?.(); }, [onChange]);
  const reset = useCallback(() => { setPast([]); setState(initial); setLive(null); setMoves(0); setUnchangedDrop(false); onChange?.(); }, [initial, onChange]);
  return { state, live, view: live ?? state, setLive, commit, undo, reset, canUndo: past.length > 0, moves, unchangedDrop };
}

type Pt = { x: number; y: number };
/** Pointer drag on an SVG element. The handler maps a point in SVG coordinates to a preview state. */
function useDrag<S>(svg: React.RefObject<SVGSVGElement | null>, ed: { state: S; setLive: (s: S | null) => void; commit: (s: S) => void }, setDragging: (on: string | null) => void) {
  /* The gesture is tracked on window, not on the grabbed element: a preview can unmount that element (a dose being
     removed), and an unmounted element never gets its pointerup. Cancel or lost capture discards the preview. */
  const g = useRef<{ id: number; move: (p: Pt, start: Pt) => S; last: S | null; start: Pt; name: string; off: () => void; finalize?: (s: S) => S } | null>(null);
  const edRef = useRef(ed); edRef.current = ed;
  const toSvg = (e: { clientX: number; clientY: number }): Pt => {
    const el = svg.current; if (!el) return { x: 0, y: 0 };
    const m = el.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const end = (commitIt: boolean) => {
    const cur = g.current; g.current = null; setDragging(null);
    if (!cur) return;
    cur.off();
    if (commitIt && cur.last) edRef.current.commit(cur.finalize ? cur.finalize(cur.last) : cur.last);
    else edRef.current.setLive(null);
  };
  useEffect(() => () => { g.current?.off(); g.current = null; }, []);
  return (name: string, move: (p: Pt, start: Pt) => S, finalize?: (s: S) => S) => ({
    onPointerDown: (e: RPointerEvent<SVGElement>) => {
      if (e.button !== 0 || g.current) return;
      e.preventDefault(); e.stopPropagation();
      const target = e.currentTarget as SVGElement & { focus?: () => void };
      try { target.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
      target.focus?.();
      const id = e.pointerId;
      const onMove = (ev: PointerEvent) => {
        const cur = g.current; if (!cur || ev.pointerId !== id) return;
        const next = cur.move(toSvg(ev), cur.start); cur.last = next; edRef.current.setLive(next);
      };
      const onUp = (ev: PointerEvent) => { if (ev.pointerId === id) end(true); };
      const onCancel = (ev: PointerEvent) => { if (ev.pointerId === id || ev.type === "blur") end(false); };
      const onBlur = () => end(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("blur", onBlur);
      const off = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onCancel); window.removeEventListener("blur", onBlur); };
      g.current = { id, move, last: null, start: toSvg(e), name, off, finalize }; setDragging(name);
    },
    onLostPointerCapture: (e: RPointerEvent<SVGElement>) => {
      // fires after a normal pointerup too (gesture already ended); otherwise capture was taken away: discard
      if (g.current?.id === e.pointerId && e.currentTarget.isConnected) setTimeout(() => { if (g.current?.id === e.pointerId) end(false); }, 0);
    },
  });
}

function keyStep(e: KeyboardEvent, opts: { dec: () => void; inc: () => void; home?: () => void; end?: () => void; del?: () => void }) {
  const k = e.key;
  if (k === "ArrowLeft" || k === "ArrowDown") opts.dec();
  else if (k === "ArrowRight" || k === "ArrowUp") opts.inc();
  else if (k === "Home" && opts.home) opts.home();
  else if (k === "End" && opts.end) opts.end();
  else if ((k === "Delete" || k === "Backspace") && opts.del) opts.del();
  else return;
  e.preventDefault();
}

function Shell({ title, goal, warning, children, tone, dragging }: { title: string; goal?: string; warning: string; children: ReactNode; tone?: string; dragging?: string | null }) {
  const uid = useId();
  return <section className={`activity pharm${tone ? " ph-" + tone : ""}${dragging ? " is-dragging" : ""}`} data-simulation="pharm-lab" aria-labelledby={`${uid}-t`}>
    <header className="ph-header">
      <h3 className="ph-title" id={`${uid}-t`}>{title}</h3>
      <p className="ph-warning"><span aria-hidden="true">⚠</span> {warning}</p>
    </header>
    {goal && <p className="ph-goal">{goal}</p>}
    {children}
  </section>;
}

function Actions({ moves, canUndo, undo, reset, share, children }: { moves: number; canUndo: boolean; undo: () => void; reset: () => void; share?: () => void; children?: ReactNode }) {
  return <div className="ph-actions">
    {children}
    <span className="ph-spacer" />
    <button type="button" className="ph-quiet" onClick={undo} disabled={!canUndo}><Undo2 size={14} aria-hidden="true" />Undo</button>
    <button type="button" className="ph-quiet" onClick={reset} disabled={moves === 0}><RotateCcw size={14} aria-hidden="true" />Start over</button>
    {moves > 0 && share && <button type="button" className="ph-share" onClick={share}>Share with Keating</button>}
  </div>;
}

function Disclosure({ label, children, initial = false }: { label: string; children: ReactNode; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return <div className="ph-disclosure">
    <button type="button" className="ph-toggle" aria-expanded={open} onClick={() => setOpen(v => !v)}><span className="ph-chev" aria-hidden="true">›</span>{label}</button>
    {open && <div className="ph-disclosed">{children}</div>}
  </div>;
}

type Mapper = Record<string, (a: number, b: number) => Pt>;
declare global { interface Window { keatingPharm?: { snapshot: () => unknown; handles: () => Record<string, { x: number; y: number }>; point: (kind: string, a: number, b: number) => Pt | null; call: (name: string, ...args: number[]) => unknown } } }
function useDebugHook(snapshot: () => unknown, root: React.RefObject<HTMLElement | null>, mappers: Mapper = {}) {
  const snap = useRef(snapshot); snap.current = snapshot;
  const maps = useRef(mappers); maps.current = mappers;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined") return;
    window.keatingPharm = {
      snapshot: () => Object.fromEntries(Object.entries(snap.current() as Record<string, unknown>).filter(([, v]) => typeof v !== "function")),
      call: (name, ...args) => { const f = (snap.current() as Record<string, unknown>)[name]; return typeof f === "function" ? f(...args) : undefined; },
      handles: () => {
        const out: Record<string, { x: number; y: number }> = {};
        root.current?.querySelectorAll<SVGElement>("[data-handle]").forEach(el => {
          const r = (el.querySelector(".ph-hit") ?? el).getBoundingClientRect(); out[el.dataset.handle!] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        return out;
      },
      point: (kind, a, b) => {
        const f = maps.current[kind], svgEl = root.current?.querySelector("svg"); if (!f || !svgEl) return null;
        const p = f(a, b), m = svgEl.getScreenCTM(); if (!m) return null;
        const q = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: q.x, y: q.y };
      },
    };
  });
}

/* ============================ entry ============================ */

export function PharmLab({ config, onChange, onShare }: { config: PharmConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const problems = useMemo(() => validatePharmLab(config), [config]);
  if (problems.length) return <section className="activity pharm" data-simulation="pharm-lab" data-invalid="true">
    <p className="ph-fallback">This pharmacology lab couldn’t be drawn from its settings, so here is the idea in words instead: ask Keating to walk through it.</p>
    <details className="receipt"><summary>What was wrong</summary><ul className="ph-problems">{problems.slice(0, 8).map(p => <li key={p}>{p}</li>)}</ul></details>
  </section>;
  if (config.mode === "pk") return <PkLab config={config} onChange={onChange} onShare={onShare} />;
  if (config.mode === "pd") return config.view === "quantal" ? <QuantalLab config={config} onChange={onChange} onShare={onShare} /> : <ReceptorLab config={config} onChange={onChange} onShare={onShare} />;
  return <OncLab config={config} onChange={onChange} onShare={onShare} />;
}

/* ============================ PK ============================ */

type PkState = { doses: Dose[]; cl: number; v: number; interval: number; removing?: number };   // removing: preview of a dose being pulled off

export function pkModel(c: PkConfig, s: Pick<PkState, "cl" | "v">) {
  const v = c.drug.v * s.v;
  const cl0 = c.drug.cl ?? Math.LN2 * c.drug.v / c.drug.halfLife!;
  const cl = cl0 * s.cl;
  const disp = { cl, v, q: c.drug.q, v2: c.drug.v2 };
  const tm = terms(disp);
  const abs = { f: c.drug.f ?? 1, ka: c.drug.ka ?? 1 };
  const lambda = Math.min(...tm.l);
  return { v, cl, cl0, tm, abs, k: cl / v, lambda, halfLife: Math.LN2 / lambda, f: c.drug.f ?? 1, vss: v + (c.drug.v2 ?? 0) * (c.drug.q ? s.v : 0) };
}
export function pkCurve(c: PkConfig, s: PkState) {
  const m = pkModel(c, s);
  const route = c.regimen.route, hours = c.regimen.hours ?? c.regimen.addHours ?? 1;
  return { ...m, at: (t: number) => conc(s.doses, t, m.tm, m.abs, route, hours) };
}

function respace(doses: Dose[], interval: number, horizon: number): Dose[] {
  const sorted = [...doses].sort((a, b) => a.t - b.t);
  if (!sorted.length) return sorted;
  const t0 = sorted[0].t, n = Math.max(1, Math.floor((horizon - t0) / interval + 1e-9) + 1);
  return Array.from({ length: n }, (_, i) => ({ ...(sorted[Math.min(i, sorted.length - 1)]), t: +(t0 + i * interval).toFixed(3) }));
}

function PkLab({ config: c, onChange, onShare }: { config: PkConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const initial = useMemo<PkState>(() => ({ doses: c.regimen.doses.map(d => ({ ...d })), cl: 1, v: 1, interval: c.regimen.interval }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const W = useElementWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const [msg, setMsg] = useState("");
  const reduced = useReducedMotion();
  const shown = ed.view, base = ed.state;
  const s: PkState = shown.removing === undefined ? shown : { ...shown, doses: shown.doses.filter((_, j) => j !== shown.removing) };
  const narrow = W < 460;
  const pad = { l: narrow ? 38 : 46, r: narrow ? 10 : 16, t: 14 };
  const plotH = narrow ? 180 : 214, laneTop = pad.t + plotH + 40, laneH = 62, laneBase = laneTop + laneH, H = laneBase + 50;
  const pw = W - pad.l - pad.r;
  const X = (t: number) => pad.l + (t / c.view.hours) * pw;
  const T = (x: number) => clamp((x - pad.l) / pw * c.view.hours, 0, c.view.hours);
  const Y = (v: number) => pad.t + plotH * (1 - clamp(v, 0, c.view.yMax) / c.view.yMax);
  const Cy = (y: number) => clamp((1 - (y - pad.t) / plotH) * c.view.yMax, c.view.yMax * 0.004, c.view.yMax);
  const DH = (a: number) => laneBase - (a / c.regimen.maxDose) * (laneH - 8);
  const A = (y: number) => clamp(snap((laneBase - y) / (laneH - 8) * c.regimen.maxDose, c.regimen.doseStep), c.regimen.doseStep, c.regimen.maxDose);
  const du = c.drug.doseUnit, cu = c.drug.concUnit;
  const routeOf = (d: Dose) => d.route ?? c.regimen.route;
  const hoursOf = (d: Dose) => d.hours ?? (routeOf(d) === "infusion" ? (d.route ? c.regimen.addHours ?? c.regimen.hours : c.regimen.hours) ?? 1 : 0);

  const model = useMemo(() => {
    const cur = pkCurve(c, s);
    const times = new Set<number>();
    const N = 480;
    for (let i = 0; i <= N; i++) times.add(i / N * c.view.hours);
    for (const d of s.doses) {
      const hrs = hoursOf(d);
      for (let j = 0; j <= 24; j++) { const t = d.t + (j / 24) * Math.max(4, Math.min(c.view.hours / 10, 12)); if (t <= c.view.hours) times.add(t); }
      times.add(Math.max(0, d.t - 1e-4)); times.add(d.t + 1e-4); if (hrs) times.add(Math.min(c.view.hours, d.t + hrs));
    }
    const ts = [...times].sort((a, b) => a - b);
    const pts = ts.map(t => ({ t, c: cur.at(t) }));
    return { ...cur, pts };
  }, [c, s]);
  const baseModel = useMemo(() => ed.live ? pkCurve(c, base) : null, [c, base, ed.live]);
  const path = (pts: { t: number; c: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.c).toFixed(1)}`).join("");
  const basePath = useMemo(() => {
    if (!baseModel) return "";
    const N = 360; const pts = []; for (let i = 0; i <= N; i++) { const t = i / N * c.view.hours; pts.push({ t, c: baseModel.at(t) }); }
    return path(pts);
  }, [baseModel, W]);

  /* ----- numbers read off the curve ----- */
  const sorted = [...s.doses].sort((a, b) => a.t - b.t);
  const amounts = sorted.map(d => d.amount);
  const maint = amounts.length > 1 ? [...amounts.slice(1)].sort((a, b) => a - b)[Math.floor((amounts.length - 1) / 2)] : amounts[0] ?? 0;
  const interval = s.interval;
  const target = c.drug.target ?? (c.drug.range.low + c.drug.range.high) / 2;
  const css = c.regimen.route === "infusion" ? (maint / interval) / model.cl : cssAverage(model.f, maint, model.cl, interval);
  const ld = loadingDose(model.vss, target, (c.regimen.addRoute ?? c.regimen.route) === "oral" ? model.f : 1);
  const md = maintenanceDose(model.cl, target, interval, c.regimen.route === "oral" ? model.f : 1);
  const t4 = (sorted[0]?.t ?? 0) + 4 * model.halfLife, t5 = (sorted[0]?.t ?? 0) + 5 * model.halfLife;
  const times = [...new Set(sorted.map(d => +d.t.toFixed(6)))];   // distinct dose times (a bolus and an infusion can share one)
  const nextT = times[1] ?? (times[0] ?? 0) + interval;
  const continuous = c.regimen.route === "infusion" && (c.regimen.hours ?? 0) >= interval - 1e-9;
  const troughs = times.slice(1).map(t => ({ t, c: model.at(t - 1e-6) }));
  const peakOf = (i: number) => {
    const d = sorted[i], end = sorted[i + 1]?.t ?? Math.min(c.view.hours, d.t + interval);
    if (c.drug.peak?.at !== undefined) return { t: d.t + c.drug.peak.at, c: model.at(d.t + c.drug.peak.at) };
    let best = { t: d.t, c: 0 };
    for (const p of model.pts) if (p.t > d.t && p.t <= end && p.c > best.c) best = p;
    return best;
  };
  const lastFull = sorted.length >= 2 ? sorted.length - 2 : 0;
  const peak = sorted.length ? peakOf(lastFull) : { t: 0, c: 0 };
  const trough = troughs.length ? troughs[troughs.length - 1] : null;
  const maxC = Math.max(...model.pts.map(p => p.c));
  /* Levels inside a distribution phase (drug.sampleAfter hours after any dose) are not interpretable, so they are
     neither graded against the risk line nor counted as reaching the range. */
  const sampleAfter = c.drug.sampleAfter ?? 0;
  const sinceDose = (t: number) => { let last = -Infinity; for (const d of sorted) if (d.t <= t + 1e-9 && d.t > last) last = d.t; return t - last; };
  const graded = sampleAfter > 0 ? model.pts.filter(p => sinceDose(p.t) >= sampleAfter - 1e-9) : model.pts;
  const maxGraded = graded.length ? Math.max(...graded.map(p => p.c)) : 0;
  const firstIn = graded.find(p => p.c >= c.drug.range.low);
  const firstToxic = c.drug.toxic ? graded.find(p => p.c > c.drug.toxic!) : undefined;
  const twoComp = !!(c.drug.q && c.drug.v2);
  const alpha = Math.max(...model.tm.l);
  const hlFrom = Math.max(1e-3, model.halfLife) + (twoComp ? 7 * Math.LN2 / alpha : 0);   // read the terminal slope after the α phase has gone
  const hl = readHalfLife(t => conc([{ t: 0, amount: 1, route: "bolus" }], t, model.tm, model.abs, "bolus", 1), hlFrom, hlFrom + 12 * model.halfLife);
  const hlLabel = twoComp ? "terminal t½ = ln2/β" : "t½ = ln2·V/CL";
  const timedMode = c.drug.peak?.at !== undefined;
  const timeLabel = (h: number) => c.view.days ? `day ${trim(h / 24, 1)}` : `${trim(h, 1)} h`;
  const span = (h: number) => c.view.days || h >= 72 ? `${trim(h / 24, 1)} days` : `${trim(h, 1)} h`;

  /* ----- verdict ----- */
  const addRoute = c.regimen.addRoute, addHours = c.regimen.addHours;
  // the + chip adds a loading dose when its route or duration differs from the maintenance doses (e.g. a 30-min loading infusion)
  const addIsLoad = !!addRoute && (addRoute !== c.regimen.route || (addHours ?? c.regimen.hours) !== c.regimen.hours);
  const isLoad = (d: Dose) => addIsLoad && d.route === addRoute && d.hours === addHours;
  const loads = sorted.filter(isLoad);
  const loadingRatio = sorted.length > 1 && maint > 0 ? sorted[0].amount / maint : 1;
  const extra = s.doses.length > initial.doses.length;
  const loadDose = loads[0] ?? (loadingRatio > 1.3 ? sorted[0] : undefined);
  const overLoad = !!loadDose && loadDose.amount > 1.2 * ld;
  const dur = (h: number) => h < 1 ? `${trim(h * 60, 0)}-minute` : `${trim(h)}-hour`;
  const shown2 = (x: number) => Number(trim(x));   // compare against limits exactly as the value is displayed
  /* Timed level: hours after the dose starts; for an infusion say how long after it ends (the 1-h sample of a 30-min infusion is 30 min after it ends). */
  const at = c.drug.peak?.at;
  const infH = c.regimen.route === "infusion" ? c.regimen.hours ?? 0 : 0;
  const timedLbl = at !== undefined ? `${trim(at)}-h level${infH > 0 && at > infH ? ` (${(at - infH) < 1 ? `${trim((at - infH) * 60, 0)} min` : `${trim(at - infH)} h`} after the infusion ends)` : ""}` : "Peak";
  /* The trough and timed-level targets belong to the configured (conventional) regimen: every gap equals regimen.interval.
     For any other schedule the readout reports the simulated values and does not grade them against divided-dose targets. */
  const conventional = Math.abs(interval - c.regimen.interval) < 1e-6 && times.slice(1).every((t, j) => Math.abs(t - times[j] - c.regimen.interval) < 1e-6);
  const timedAndTrough = (st: PkState) => {
    const m = pkCurve(c, st), ts = [...new Set([...st.doses].sort((a, b) => a.t - b.t).map(d => +d.t.toFixed(6)))];
    const lf = ts.length >= 2 ? ts.length - 2 : 0;
    return { timed: at !== undefined && ts.length ? m.at(ts[lf] + at) : NaN, trough: ts.length > 1 ? m.at(ts[ts.length - 1] - 1e-6) : NaN };
  };
  const ref = conventional || !(c.drug.trough || c.drug.peak) ? null : timedAndTrough({ ...s, interval: c.regimen.interval, doses: respace(s.doses, c.regimen.interval, c.view.hours) });
  const onceDaily = interval >= 24 - 1e-6;
  const troughMax = c.drug.trough ? (onceDaily && c.drug.trough.onceDaily !== undefined ? c.drug.trough.onceDaily : c.drug.trough.max) : undefined;
  const lines: { tone: string; text: string }[] = [];
  if (firstToxic) lines.push({ tone: "bad", text: `${sampleAfter ? "Post-distribution level" : "Level"} above ${trim(c.drug.toxic!)} ${cu} from ${timeLabel(firstToxic.t)} (highest ${trim(maxGraded)} ${cu}): higher levels are associated with greater adverse-effect risk. The line is a risk signal, not a safe/toxic cutoff.` });
  if (sampleAfter > 0) lines.push({ tone: "info", text: `Illustrative one-compartment exposure. Early peaks (less than ${trim(sampleAfter)} h after a dose) do not represent interpretable post-distribution ${c.drug.name.toLowerCase()} levels, so they are not graded here.` });
  if (c.drug.trough && trough) {
    const tmin = c.drug.trough.min;
    if (conventional) {
      if (troughMax !== undefined && shown2(trough.c) >= troughMax) lines.push({ tone: "bad", text: `Pre-dose trough before the last dose is ${trim(trough.c)} ${cu}, not under this example's < ${trim(troughMax)} target: the level does not fall far enough between doses.` });
      else if (tmin !== undefined && shown2(trough.c) < tmin) lines.push({ tone: "warn", text: `Pre-dose trough ${trim(trough.c)} ${cu} is below ${trim(tmin)}.` });
      else lines.push({ tone: "ok", text: `Pre-dose trough before the last dose ${trim(trough.c)} ${cu}: under this example's < ${trim(troughMax ?? Infinity)} target.` });
    } else {
      const dir = !ref || !Number.isFinite(ref.trough) ? "changed" : trough.c < ref.trough - 1e-9 ? "lowered" : trough.c > ref.trough + 1e-9 ? "raised" : "left unchanged";
      const verb = Math.abs(interval - c.regimen.interval) > 1e-6 ? "Spacing" : "Moving the doses";
      const above = troughMax !== undefined && shown2(trough.c) >= troughMax;
      const ceiling = troughMax === undefined ? "" : onceDaily && c.drug.trough.onceDaily !== undefined
        ? ` The label gives a lower trough ceiling for once-daily dosing (< ${trim(troughMax)} ${cu})${above ? "; this is above it" : ""}.`
        : above ? ` That is not under the < ${trim(troughMax)} ${cu} ceiling for multiple daily dosing.` : "";
      lines.push({ tone: above ? "warn" : "info", text: `${verb} ${dir} the simulated pre-dose concentration ${dir === "left unchanged" ? "at" : "to"} ${trim(trough.c)} ${cu}.${ceiling} The divided-dose targets do not establish appropriateness of this schedule.` });
    }
  }
  if (c.drug.peak && sorted.length) {
    const { min, max } = c.drug.peak;
    const range = `${trim(min ?? 0)}–${max !== undefined ? trim(max) : "∞"} ${cu}`;
    if (!conventional) lines.push({ tone: "info", text: `The timed concentration (${timedLbl}) also changed from ${trim(ref?.timed ?? NaN)} to ${trim(peak.c)} ${cu}. Its ${range} monitoring range belongs to the every-${trim(c.regimen.interval)}-h example, so it is not graded here.` });
    else if (min !== undefined && shown2(peak.c) < min) lines.push({ tone: "warn", text: `The modeled timed concentration (${timedLbl}, ${trim(peak.c)} ${cu}) falls below this example's monitoring range (${range}). Organism susceptibility and exposure are needed to infer antibacterial effect.` });
    else if (max !== undefined && shown2(peak.c) > max) lines.push({ tone: "bad", text: `${timedLbl} ${trim(peak.c)} ${cu} is above this example's monitoring range (${range}).` });
    else lines.push({ tone: "ok", text: `${timedLbl} ${trim(peak.c)} ${cu}: inside this example's ${range} monitoring range.` });
  }
  if (!c.drug.trough && !firstToxic) {
    const post = sampleAfter > 0 ? ` (judged from ${trim(sampleAfter)} h after a dose)` : "";
    if (!firstIn && maxGraded >= 0.85 * c.drug.range.low) lines.push({ tone: "warn", text: `Creeps up toward the range's floor (${trim(c.drug.range.low)} ${cu}) but is only at ${trim(maxGraded)} after ${span(c.view.hours)}: approaching a plateau takes 4–5 half-lives.` });
    else if (!firstIn) lines.push({ tone: "warn", text: `Never reaches the range (${trim(c.drug.range.low)} ${cu}) within ${span(c.view.hours)}${post}.` });
    else if (firstIn.t <= nextT + 1e-6) lines.push({ tone: "ok", text: `In the range from the first dose (${timeLabel(firstIn.t)})${post}.` });
    else lines.push({ tone: "warn", text: `Reaches the range only at ${timeLabel(firstIn.t)}, after ${times.filter(t => t < firstIn.t).length} doses${post}.` });
  }
  // steady-state trough of the maintenance regimen alone (many doses), and when the learner's troughs first come within 20% of it
  const ssTrough = (() => {
    if (!maint || interval <= 0) return 0;
    const n = Math.min(2000, Math.ceil(12 * model.halfLife / interval) + 2);
    const ds = Array.from({ length: n }, (_, i) => ({ t: i * interval, amount: maint }));
    return conc(ds, n * interval - 1e-6, model.tm, model.abs, c.regimen.route, c.regimen.hours ?? 1);
  })();
  const firstNear = troughs.find(tr => tr.c >= 0.8 * ssTrough);
  if (!c.drug.trough && ssTrough > 0 && troughs.length) {
    if (!firstNear) lines.push({ tone: "info", text: `Troughs are still climbing at the end: more than 20% below the plateau trough (${trim(ssTrough)} ${cu}).` });
    else lines.push({ tone: firstNear.t <= nextT + 1e-6 ? "ok" : "info", text: `Troughs are within 20% of the plateau trough (${trim(ssTrough)} ${cu}) ${firstNear.t <= nextT + 1e-6 ? "from the first trough" : `only from ${timeLabel(firstNear.t)}`}.` });
  }
  const tone = lines.some(l => l.tone === "bad") ? "bad" : lines.some(l => l.tone === "warn") ? "warn" : lines.some(l => l.tone === "ok") ? "ok" : "info";
  const why: string[] = [];
  if (loadDose) {
    const lr = routeOf(loadDose), lh = hoursOf(loadDose);
    const fillHow = lr === "oral" ? "approaches the target earlier as it is absorbed" : lr === "infusion" ? `fills the volume of distribution over its ${dur(lh)} infusion` : "fills the volume of distribution at once";
    why.push(`${loads.length ? "The loading dose" : "A larger first dose"} ${fillHow} (V·C/F ≈ ${trim(ld, 0)} ${du} is the amount that brings the level to ${trim(target)} ${cu}${continuous || twoComp ? "" : `; matching the plateau's peaks and troughs takes maintenance × accumulation ≈ ${trim(maint * accumulation(model.lambda, interval), 0)} ${du}`}).${overLoad ? ` ${trim(loadDose.amount, 0)} ${du} is more than V·C/F ≈ ${trim(ld, 0)} ${du} needs.` : ""} It gets the level near the plateau sooner. It does not shorten the 4–5 half-lives (${span(4 * model.halfLife)}–${span(5 * model.halfLife)}) the maintenance doses alone would need.`);
  }
  if (Math.abs(s.cl - 1) > 0.04) why.push(`Clearance ×${trim(s.cl)}: ${hlLabel} is now ${trim(model.halfLife)} h and the average plateau ×${trim(1 / s.cl)}. Same doses, ${s.cl < 1 ? "more" : "less"} exposure, and ${s.cl < 1 ? "longer" : "shorter"} to reach steady state.`);
  if (Math.abs(s.v - 1) > 0.04) why.push(`Volume ×${trim(s.v)}: peaks after each dose are ${s.v > 1 ? "lower" : "higher"} and ${twoComp ? "terminal " : ""}t½ ${s.v > 1 ? "longer" : "shorter"} (${trim(model.halfLife)} h), but the average plateau F·Dose/(CL·τ) is unchanged: it depends only on clearance.`);
  if (Math.abs(interval - c.regimen.interval) > 1e-6) why.push(twoComp
    ? `Doses every ${trim(interval)} h: the curve is the simulated periodic profile. With two compartments no single accumulation factor matches both peaks and troughs.`
    : `Doses every ${trim(interval)} h: accumulation factor 1/(1 − e^(−kτ)) = ${trim(accumulation(model.lambda, interval))}.`);
  if (c.patient?.note && Math.abs(s.cl - 1) > 0.04) why.push(c.patient.note);

  const changed = ed.moves > 0;
  const announce = (t: string) => setMsg(t);
  useEffect(() => { if (ed.moves) announce(`${lines.map(l => l.text).join(" ")}`); }, [ed.moves]);

  /* ----- handles ----- */
  const doseIds = sorted.map(d => s.doses.indexOf(d));
  const curve = pkCurve;
  const setDose = (st: PkState, i: number, patch: Partial<Dose> | null): PkState => {
    const doses = st.doses.map(d => ({ ...d }));
    if (patch === null) doses.splice(i, 1); else doses[i] = { ...doses[i], ...patch };
    return { ...st, doses };
  };
  const removeZone = laneBase + 26;
  const headProps = (i: number) => bind(`head-${i}`, p => setDose(base, i, { amount: A(p.y) }));
  const baseProps = (i: number) => bind(`base-${i}`, p => p.y > removeZone && base.doses.length > 1 ? { ...base, removing: i } : setDose(base, i, { t: clamp(snap(T(p.x), c.regimen.timeStep), 0, c.view.hours) }),
    st => st.removing === undefined ? st : setDose({ ...st, removing: undefined }, st.removing, null));
  const defaultAmount = maint || c.regimen.maxDose / 4;
  const addText = addIsLoad ? (addRoute === "infusion" && addHours ? `${dur(addHours)} loading infusion` : `loading ${addRoute === "bolus" ? "bolus" : "dose"}`) : `${c.regimen.route} dose`;
  const newDose = (t: number): Dose => addIsLoad ? { t, amount: addRoute === "oral" ? defaultAmount : snap(Math.min(c.regimen.maxDose, ld), c.regimen.doseStep), route: addRoute, ...(addHours ? { hours: addHours } : {}) } : { t, amount: defaultAmount };
  const addProps = bind("add", p => p.y > laneTop - 12 && p.y < laneBase + 18 && p.x > pad.l - 4 && s.doses.length < 40
    ? { ...base, doses: [...base.doses, newDose(clamp(snap(T(p.x), c.regimen.timeStep), 0, c.view.hours))] } : base);
  const intervalProps = bind("interval", p => {
    const t0 = sorted[0]?.t ?? 0;
    const tau = clamp(snap(T(p.x) - t0, c.regimen.timeStep), c.regimen.timeStep * 2, c.view.hours);
    return { ...base, interval: tau, doses: respace(base.doses, tau, c.view.hours) };
  });
  const clT = (() => { const bs = [...base.doses].sort((a, b) => a.t - b.t), last = bs[bs.length - 1]?.t ?? 0, t = last + base.interval * 0.5; return t < c.view.hours * 0.97 && t > (bs[0]?.t ?? 0) ? t : c.view.hours * 0.94; })();
  const vT = useMemo(() => {
    const bs = [...base.doses].sort((a, b) => a.t - b.t), d = bs[0]; if (!d) return 0;
    const at = pkCurve(c, base).at, end = Math.min(c.view.hours, bs[1]?.t ?? d.t + base.interval);
    let best = d.t, bc = -1; for (let i = 1; i <= 120; i++) { const t = d.t + (end - d.t) * i / 120; const v = at(t); if (v > bc) { bc = v; best = t; } }
    return best;
  }, [c, base]);
  const clProps = c.patient?.clearance && bind("clearance", p => {
    const target = Cy(p.y), m = c.patient!.clearance!;
    return { ...base, cl: +solveScale(sc => curve(c, { ...base, cl: sc }).at(clT), target, m.min, m.max).toFixed(3) };
  });
  const vProps = c.patient?.volume && bind("volume", p => {
    const target = Cy(p.y), m = c.patient!.volume!;
    return { ...base, v: +solveScale(sc => curve(c, { ...base, v: sc }).at(vT), target, m.min, m.max).toFixed(3) };
  });
  const removing = shown.removing;

  /* keyboard edits commit directly */
  const kDose = (i: number, dir: number) => ed.commit(setDose(base, i, { amount: clamp(base.doses[i].amount + dir * c.regimen.doseStep, c.regimen.doseStep, c.regimen.maxDose) }));
  const kTime = (i: number, dir: number) => ed.commit(setDose(base, i, { t: clamp(+(base.doses[i].t + dir * c.regimen.timeStep * (c.view.days ? 12 : 1)).toFixed(3), 0, c.view.hours) }));
  const kRemove = (i: number) => { if (base.doses.length > 1) ed.commit(setDose(base, i, null)); };
  const kAdd = (t: number) => ed.commit({ ...base, doses: [...base.doses, newDose(t)] });
  const kScale = (k: "cl" | "v", dir: number) => {
    const m = k === "cl" ? c.patient!.clearance! : c.patient!.volume!;
    ed.commit({ ...base, [k]: +clamp(base[k] * (dir > 0 ? 1.1 : 1 / 1.1), m.min, m.max).toFixed(3) });
  };
  const kInterval = (dir: number) => { const tau = clamp(base.interval + dir * (c.view.days ? 6 : 1), c.regimen.timeStep * 2, c.view.hours); ed.commit({ ...base, interval: tau, doses: respace(base.doses, tau, c.view.hours) }); };

  /* ticks */
  const ticks: number[] = [];
  const stepT = c.view.days ? 24 * Math.max(1, Math.ceil(c.view.hours / 24 / (narrow ? 6 : 12))) : niceStep(c.view.hours, narrow ? 6 : 10);
  for (let t = 0; t <= c.view.hours + 1e-9; t += stepT) ticks.push(t);
  const yTicks: number[] = []; const ys = niceStep(c.view.yMax, 5); for (let v = 0; v <= c.view.yMax + 1e-9; v += ys) yTicks.push(+v.toFixed(6));

  const snapshot = () => ({
    mode: "pk", doses: s.doses, cl: model.cl, v: model.v, clScale: s.cl, vScale: s.v, interval, halfLife: model.halfLife, halfLifeRead: hl,
    css, ld, md, peak, trough, conventional, troughMax: troughMax ?? null, timedRef: ref, loads, ssTrough, firstNear: firstNear?.t ?? null, ldAccum: maint * accumulation(model.lambda, interval), firstIn: firstIn?.t ?? null, firstToxic: firstToxic?.t ?? null, maxC, tone, lines: lines.map(l => l.text), why,
    live: !!ed.live, removing: removing ?? null, accumulation: accumulation(model.lambda, interval), t4, t5, frac4: fractionOfSteadyState(4),
    sample: (t: number) => model.at(t), moves: ed.moves, unchangedDrop: ed.unchangedDrop, width: W,
  });
  useDebugHook(snapshot, wrap, { curve: (t, v) => ({ x: X(t), y: Y(v) }), lane: (t, a) => ({ x: X(t), y: DH(a) }), below: (t, dy) => ({ x: X(t), y: laneBase + dy }) });

  const share = () => {
    const changes: string[] = [];
    if (loadingRatio > 1.3) changes.push(`made the first dose ${trim(sorted[0].amount, 0)} ${du} (${trim(loadingRatio, 1)}× the ${trim(maint, 0)} ${du} maintenance dose)`);
    const routeText = (d: Dose) => routeOf(d) === "infusion" ? `${dur(hoursOf(d))} infusion` : routeOf(d) === "bolus" ? "IV bolus" : "oral dose";
    const maintText = continuous ? `the maintenance infusion (${trim(maint / interval)} ${du}/h)` : `the maintenance doses (${trim(maint, 0)} ${du} every ${trim(interval)} h)`;
    for (const L of loads) changes.push(`added a ${trim(L.amount, 0)} ${du} loading dose as a ${routeText(L)} at ${timeLabel(L.t)}, alongside ${maintText}`);
    const otherAdded = s.doses.length - initial.doses.length - loads.length;
    if (otherAdded > 0) changes.push(`added ${otherAdded} dose${otherAdded > 1 ? "s" : ""}`);
    if (s.doses.length < initial.doses.length && Math.abs(interval - c.regimen.interval) < 1e-6) changes.push(`removed ${initial.doses.length - s.doses.length} dose(s)`);
    if (Math.abs(s.cl - 1) > 0.04) changes.push(`set clearance to ×${trim(s.cl)}`);
    if (Math.abs(s.v - 1) > 0.04) changes.push(`set volume to ×${trim(s.v)}`);
    if (Math.abs(interval - c.regimen.interval) > 1e-6) changes.push(`spaced doses every ${trim(interval)} h`);
    const moved = s.doses.some((d, i) => initial.doses[i] && Math.abs(d.t - initial.doses[i].t) > 1e-6) && Math.abs(interval - c.regimen.interval) < 1e-6;
    if (moved) changes.push("moved dose times");
    const amountsChanged = s.doses.some((d, i) => initial.doses[i] && i > 0 && Math.abs(d.amount - initial.doses[i].amount) > 1e-6);
    if (amountsChanged) changes.push("changed maintenance amounts");
    const did = changes.length ? changes.join(", ") : "looked at the curve without changing the regimen (it is as it started)";
    const learner = `In the ${c.drug.name} lab I ${did}. ${lines.map(l => l.text).join(" ")}`;
    const data = `${c.drug.name} · ${s.doses.length} doses · CL ${trim(model.cl)} L/h · V ${trim(model.v)} L · t½ ${trim(model.halfLife)} h · Css,avg ${trim(css)} ${cu} · LD(V·C/F) ${trim(ld, 0)} ${du} · peak ${trim(peak.c)}${trough ? ` · trough ${trim(trough.c)}` : ""} ${cu} · educational model`;
    let reply = "";
    const practice = " In practice, interval and dose are set from measured levels and local protocol with a pharmacist.";
    if (loadDose) {
      const what = loads.length ? `You added a ${trim(loadDose.amount, 0)} ${du} loading dose as a ${routeText(loadDose)} at ${timeLabel(loadDose.t)}, alongside ${maintText}.` : `You made the first dose ${trim(loadDose.amount, 0)} ${du}.`;
      const when = firstIn ? `The level reaches the shaded range at ${timeLabel(firstIn.t)}${sampleAfter ? ` (judged from ${trim(sampleAfter)} h after a dose; earlier levels are pre-distribution)` : ""}.` : "The level still misses the shaded range.";
      const over = overLoad ? ` That load is more than V·C/F ≈ ${trim(ld, 0)} ${du} needs.` : "";
      const risk = firstToxic ? ` In this model the ${sampleAfter ? "post-distribution " : ""}level passes ${trim(c.drug.toxic!)} ${cu}, where adverse effects become more likely; try a smaller load and compare.` : "";
      reply = `${what} ${when}${over}${risk} Notice what didn't change: the curve's shape after that is set by the maintenance doses and t½ (${trim(model.halfLife)} h). The loading dose depends on V (V·C/F ≈ ${trim(ld, 0)} ${du}); the maintenance dose depends on CL (CL·C·τ/F ≈ ${trim(md, 0)} ${du} every ${trim(interval)} h). Try halving clearance next: which of the two doses would you change?`;
    }
    else if (Math.abs(s.cl - 1) > 0.04 && c.drug.trough) {
      const tl = c.drug.peak?.at !== undefined ? `timed level (${timedLbl})` : "peak";
      if (conventional && trough && troughMax !== undefined && shown2(trough.c) >= troughMax)
        reply = `Right: with clearance ×${trim(s.cl)} the half-life is ${trim(model.halfLife)} h, so in the model the pre-dose level is ${trim(trough.c)} ${cu}, not under this example's < ${trim(troughMax)} ${cu} target. The product label's response to a high trough is to lengthen the interval rather than cut the dose (gentamicin SmPC, emc 12877). In the model, cutting the dose lowers every level in proportion; spacing the doses gives more half-lives between them, and the ${tl} changes too because less drug accumulates. Drag the spacing bracket and compare.${practice}`;
      else if (!conventional && trough) {
        const dir = !ref ? "changed" : trough.c < ref.trough - 1e-9 ? "lowered" : trough.c > ref.trough + 1e-9 ? "raised" : "left unchanged";
        const how = interval > c.regimen.interval + 1e-6 ? "Spacing reduced accumulation" : interval < c.regimen.interval - 1e-6 ? "Closer dosing increased accumulation" : "Moving the doses changed the profile";
        const once = onceDaily && c.drug.trough.onceDaily !== undefined ? ` For once-daily dosing the label's trough ceiling is < ${trim(troughMax!)} ${cu}${shown2(trough.c) >= troughMax! ? ", and this is above it" : ""}.` : "";
        reply = `${how} and ${dir} the trough ${dir === "left unchanged" ? "at" : "to"} ${trim(trough.c)} ${cu}. The ${tl} also changed from ${trim(ref?.timed ?? NaN)} to ${trim(peak.c)} ${cu}.${once} The divided-dose targets do not establish appropriateness of this schedule.${practice}`;
      } else reply = `With clearance ×${trim(s.cl)} at every ${trim(interval)} h, the model's pre-dose trough is ${trim(trough?.c ?? 0)} ${cu} and the ${tl} ${trim(peak.c)} ${cu}.${practice}`;
    }
    else if (Math.abs(s.cl - 1) > 0.04) reply = `Clearance ×${trim(s.cl)} changes two things at once: the plateau (×${trim(1 / s.cl)}) and the time to reach it (t½ ${trim(model.halfLife)} h, so 4–5 half-lives is ${span(4 * model.halfLife)}–${span(5 * model.halfLife)}). That's why a level checked too early in renal impairment underestimates where it is heading.`;
    else if (Math.abs(s.v - 1) > 0.04) reply = `Changing V moved the peaks and the half-life but not the average plateau. That plateau is F·Dose/(CL·τ) = ${trim(css)} ${cu}. Volume decides the loading dose; clearance decides the maintenance dose.`;
    else reply = `You've got ${s.doses.length} doses with t½ ${trim(model.halfLife)} h. ${lines.map(l => l.text).join(" ")} The rule that ties it together: after n half-lives of regular dosing you're at 1 − ½ⁿ of the plateau, so about 94% after 4.`;
    onShare?.({ learner, data, reply });
  };

  const showT4 = t4 <= c.view.hours, showT5 = t5 <= c.view.hours;
  return <Shell title={c.title} goal={c.goal} warning="Educational model, not for clinical dosing." tone={tone} dragging={dragging}>
    <div className={`ph-canvas${reduced ? " is-reduced" : ""}`} ref={wrap}>
      <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${c.drug.name} plasma concentration over ${span(c.view.hours)} with ${s.doses.length} doses`}>
        <rect className="ph-plot-bg" x={pad.l} y={pad.t} width={pw} height={plotH} rx={4} />
        {/* a timed-sample range is drawn only at its sample time, and only for the configured regimen; other ranges span the plot */}
        {!timedMode ? <rect className="ph-band ph-band-ok" x={pad.l} y={Y(c.drug.range.high)} width={pw} height={Y(c.drug.range.low) - Y(c.drug.range.high)} />
          : conventional && sorted.length > 0 && <rect className="ph-band ph-band-ok ph-band-timed" x={X(peak.t) - 5} y={Y(c.drug.range.high)} width={10} height={Y(c.drug.range.low) - Y(c.drug.range.high)} />}
        {c.drug.toxic && <rect className="ph-band ph-band-bad" x={pad.l} y={pad.t} width={pw} height={Math.max(0, Y(c.drug.toxic) - pad.t)} />}
        {yTicks.map(v => <g key={v}><line className="ph-grid" x1={pad.l} x2={pad.l + pw} y1={Y(v)} y2={Y(v)} /><text className="ph-tick" x={pad.l - 6} y={Y(v) + 3.5} textAnchor="end">{trim(v)}</text></g>)}
        {!timedMode ? <text className="ph-band-label ph-tone-ok" x={pad.l + 4} y={Y(c.drug.range.high) + 12}>{c.drug.range.label ?? "range"}</text>
          : conventional && sorted.length > 0 && <text className="ph-band-label ph-tone-ok" x={X(peak.t) - 9} y={Y(c.drug.range.high) + 10} textAnchor="end">{c.drug.range.label ?? "timed sample"}</text>}
        {c.drug.toxic && <text className="ph-band-label ph-tone-bad" x={pad.l + pw - 4} y={pad.t + 11} textAnchor="end">risk rises above {trim(c.drug.toxic)} (illustrative)</text>}
        {troughMax !== undefined && trough && (conventional || (onceDaily && c.drug.trough?.onceDaily !== undefined)) && <g className="ph-pre-dose"><line className="ph-target" x1={X(trough.t) - 22} x2={Math.min(pad.l + pw, X(trough.t) + 4)} y1={Y(troughMax)} y2={Y(troughMax)} /><text className="ph-band-label" x={Math.min(X(trough.t) - 26, clProps ? X(clT) - 20 : Infinity)} y={Y(troughMax) - 4} textAnchor="end">{conventional ? "pre-dose" : "once-daily pre-dose"} &lt; {trim(troughMax)}</text></g>}
        <text className="ph-axis-label" x={pad.l} y={pad.t - 3}>{cu}</text>
        {/* time to steady state */}
        {showT4 && <g className="ph-ss"><line x1={X(t4)} x2={X(t4)} y1={pad.t} y2={pad.t + plotH} /><text x={X(t4) - 3} y={pad.t + plotH - 6} textAnchor="end">94% · 4 t½</text></g>}
        {showT5 && (!showT4 || X(t5) - X(t4) > 72) && <g className="ph-ss"><line x1={X(t5)} x2={X(t5)} y1={pad.t} y2={pad.t + plotH} /><text x={X(t5) + 3} y={pad.t + plotH - 6}>97% · 5 t½</text></g>}
        {css > 0 && css < c.view.yMax && <g className="ph-css"><line x1={pad.l} x2={pad.l + pw} y1={Y(css)} y2={Y(css)} />{!narrow && <text x={pad.l + 4} y={Y(css) - 4}>average plateau {trim(css)}</text>}</g>}
        {basePath && <path className="ph-ghost" d={basePath} />}
        <path className="ph-curve" d={path(model.pts)} />
        {trough && <g className="ph-mark"><circle cx={X(trough.t)} cy={Y(trough.c)} r={3.5} />{!narrow && <text x={X(trough.t) - 6} y={Math.min(pad.t + plotH - 4, Y(trough.c) + 13)} textAnchor="end">trough {trim(trough.c)}</text>}</g>}
        {sorted.length > 0 && !continuous && <g className="ph-mark"><circle cx={X(peak.t)} cy={Y(peak.c)} r={3.5} /><text x={X(peak.t)} y={Math.max(pad.t + 10, Y(peak.c) - 7)} textAnchor="middle">{c.drug.peak?.at ? `${trim(c.drug.peak.at)}-h` : sampleAfter && peak.t - (sorted[lastFull]?.t ?? 0) < sampleAfter ? "early peak" : "peak"} {trim(peak.c)}</text></g>}
        {maxC > c.view.yMax && <text className="ph-offchart" x={X(model.pts.find(p => p.c > c.view.yMax)!.t)} y={pad.t + 10}>↑ off chart</text>}
        {/* patient knobs on the curve */}
        {clProps && <g data-handle="clearance" className="ph-knob ph-knob-cl" transform={`translate(${X(clT)},${Y(model.at(clT))})`} tabIndex={0} role="slider" aria-label={`${c.patient!.clearance!.label}, scale`} aria-valuemin={c.patient!.clearance!.min} aria-valuemax={c.patient!.clearance!.max} aria-valuenow={s.cl} aria-valuetext={`clearance ×${trim(s.cl)}, CL ${trim(model.cl)} L/h`}
          onKeyDown={e => keyStep(e, { dec: () => kScale("cl", -1), inc: () => kScale("cl", 1) })} {...clProps}>
          <circle r={14} className="ph-hit" /><circle r={6.5} /><text y={-12} textAnchor={X(clT) > pad.l + pw - 30 ? "end" : "middle"}>CL ×{trim(s.cl)}</text></g>}
        {vProps && sorted.length > 0 && <g data-handle="volume" className="ph-knob ph-knob-v" transform={`translate(${X(vT)},${Y(model.at(vT))})`} tabIndex={0} role="slider" aria-label={`${c.patient!.volume!.label}, scale`} aria-valuemin={c.patient!.volume!.min} aria-valuemax={c.patient!.volume!.max} aria-valuenow={s.v} aria-valuetext={`volume ×${trim(s.v)}, V ${trim(model.v)} L`}
          onKeyDown={e => keyStep(e, { dec: () => kScale("v", -1), inc: () => kScale("v", 1) })} {...vProps}>
          <circle r={14} className="ph-hit" /><rect x={-6} y={-6} width={12} height={12} rx={2} /><text x={10} y={-10}>V ×{trim(s.v)}</text></g>}
        {/* dose lane */}
        <text className="ph-lane-label" x={pad.l} y={laneTop - 16}>{narrow ? `doses (${du}) · drag height, slide foot, pull off` : `doses (${du}) · drag a dot’s height, slide its foot, pull it off to remove`}</text>
        <line className="ph-lane-base" x1={pad.l} x2={pad.l + pw} y1={laneBase} y2={laneBase} />
        {ticks.map(t => <g key={t}><line className="ph-grid ph-grid-v" x1={X(t)} x2={X(t)} y1={pad.t + plotH} y2={pad.t + plotH + 4} /><text className="ph-tick" x={X(t)} y={laneBase + 14} textAnchor="middle">{c.view.days ? trim(t / 24, 0) : trim(t, 1)}</text></g>)}
        <text className="ph-axis-label" x={pad.l + pw} y={laneBase + 28} textAnchor="end">{c.view.days ? "days" : "hours"}</text>
        {dragging?.startsWith("base-") && <g className="ph-remove-zone"><rect x={pad.l} y={removeZone} width={pw} height={H - removeZone - 2} rx={5} /><text x={pad.l + pw / 2} y={removeZone + 15} textAnchor="middle">{removing !== undefined ? "release to remove this dose" : "drop here to remove"}</text></g>}
        {sorted.length > 1 && (() => { const a = X(sorted[0].t), b = X(sorted[0].t + interval); return <g data-handle="interval" className="ph-interval" tabIndex={0} role="slider" aria-label="Dosing interval" aria-valuenow={interval} aria-valuetext={`every ${trim(interval)} hours`}
          onKeyDown={e => keyStep(e, { dec: () => kInterval(-1), inc: () => kInterval(1) })} {...intervalProps} transform={`translate(${b},${laneTop - 4})`}>
          <path d={`M${a - b},4 V0 H0 V4`} className="ph-bracket" /><rect x={-9} y={-7} width={18} height={14} rx={4} className="ph-hit" /><circle r={4} />
          <text x={8} y={3.5}>every {trim(interval)} h</text></g>; })()}
        {shown.doses.map((d, i) => {
          const x = X(d.t), y = DH(d.amount), r = routeOf(d), hrs = hoursOf(d), w = r === "infusion" ? Math.max(3, X(d.t + hrs) - x) : 0;
          const gone = removing === i;
          return <g key={i} className={`ph-dose${gone ? " is-removing" : ""}`}>
            {r === "infusion" ? <rect className="ph-dose-block" x={x} y={y} width={w} height={laneBase - y} /> : <line className="ph-stem" x1={x} x2={x} y1={laneBase} y2={y} />}
            <g data-handle={`head-${i}`} className="ph-head" transform={`translate(${x + w / 2},${y})`} tabIndex={0} role="slider" aria-label={`Dose ${i + 1} amount (${r})`} aria-valuemin={c.regimen.doseStep} aria-valuemax={c.regimen.maxDose} aria-valuenow={d.amount} aria-valuetext={`${trim(d.amount, 0)} ${du} at ${timeLabel(d.t)}`}
              onKeyDown={e => keyStep(e, { dec: () => kDose(i, -1), inc: () => kDose(i, 1), del: () => kRemove(i) })} {...headProps(i)}>
              <circle r={13} className="ph-hit" /><circle r={5.5} className={r === "bolus" && c.regimen.route !== "bolus" ? "ph-head-alt" : ""} />
              {(i === doseIds[0] || d.amount !== maint || r !== c.regimen.route) && <text y={-9} textAnchor="middle">{trim(d.amount, 0)}</text>}
            </g>
            <g data-handle={`base-${i}`} className="ph-foot" transform={`translate(${x},${laneBase})`} tabIndex={0} role="slider" aria-label={`Dose ${i + 1} time`} aria-valuemin={0} aria-valuemax={c.view.hours} aria-valuenow={d.t} aria-valuetext={`${timeLabel(d.t)}; Delete removes it`}
              onKeyDown={e => keyStep(e, { dec: () => kTime(i, -1), inc: () => kTime(i, 1), del: () => kRemove(i) })} {...baseProps(i)}>
              <rect x={-9} y={-6} width={18} height={18} className="ph-hit" /><path d="M0,0 L5,7 H-5 Z" /></g>
          </g>;
        })}
        {s.doses.length < 40 && <g data-handle="add" className="ph-add" transform={`translate(${pad.l - (narrow ? 20 : 24)},${laneTop + laneH / 2})`} tabIndex={0} role="button" aria-label={`Add a ${addText} at hour 0`}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kAdd(0); } }} {...addProps}>
          <circle r={14} className="ph-hit" /><circle r={10} /><path d="M-4.5,0 H4.5 M0,-4.5 V4.5" /><text y={24} textAnchor="middle">{addIsLoad ? "load" : "dose"}</text></g>}
      </svg>
    </div>
    <div className={`ph-readout ph-tone-${tone}`} role="status" aria-live="polite">
      {lines.map((l, i) => <p key={i} className={`ph-line ph-tone-${l.tone}`}>{l.text}</p>)}
      {why.slice(0, 2).map((w, i) => <p key={"w" + i} className="ph-why">{w}</p>)}
      {ed.unchangedDrop && <p className="ph-why">That drop left the regimen unchanged.</p>}
      <span className="ph-sr">{msg}</span>
    </div>
    <dl className="ph-stats">
      <div><dt>{hlLabel}</dt><dd>{trim(model.halfLife)} h</dd></div>
      <div><dt>steady state (4–5 t½)</dt><dd>{span(4 * model.halfLife)}–{span(5 * model.halfLife)}</dd></div>
      {continuous ? <div><dt>infusion rate</dt><dd>{trim(maint / interval)} {du}/h</dd></div> : twoComp ? <div><dt>plateau trough (simulated)</dt><dd>{trim(ssTrough)} {cu}</dd></div> : <div><dt>accumulation</dt><dd>×{trim(accumulation(model.lambda, interval))}</dd></div>}
      {c.drug.target !== undefined && <div><dt>loading dose V·C/F</dt><dd>{trim(ld, 0)} {du}</dd></div>}
    </dl>
    <Disclosure label="Show the equations">
      <div className="ph-eq">
        <p>{c.drug.q ? "Two-compartment" : "One-compartment"} model, linear kinetics: each dose adds its own closed-form curve (superposition).</p>
        {twoComp ? <p>Terminal rate β = {trim(model.lambda, 3)} h⁻¹ · terminal t½ = ln2/β = {trim(model.halfLife)} h{hl ? ` (read off a single-dose curve: ${trim(hl)} h)` : ""}. With two compartments ln2·V/CL (here {trim(Math.LN2 * model.v / model.cl)} h) is not the terminal half-life.</p>
          : <p>k = CL/V = {trim(model.cl)}/{trim(model.v)} = {trim(model.k, 3)} h⁻¹ · t½ = ln2/k = {trim(model.halfLife)} h{hl ? ` (read off a single-dose curve: ${trim(hl)} h)` : ""}</p>}
        {twoComp && <p>Each input is convolved with the two-exponential disposition a₁e^(−αt) + a₂e^(−βt), in closed form.</p>}
        {!twoComp && c.regimen.route === "oral" && <p>Oral: C = F·D·ka/(V(ka − k))·(e^(−kt) − e^(−ka·t)), F = {trim(model.f)}, ka = {trim(model.abs.ka)} h⁻¹</p>}
        {!twoComp && c.regimen.route === "infusion" && <p>Infusion of R = D/T: C = (R/CL)(1 − e^(−kt)) while it runs, then decays at k.</p>}
        <p>After n half-lives of regular dosing: 1 − ½ⁿ of the plateau (n = 4 gives {trim(fractionOfSteadyState(4) * 100, 1)}%).</p>
        <p>Average plateau = F·Dose/(CL·τ) = {trim(css)} {cu} · maintenance dose for {trim(target)} {cu} = CL·C·τ/F = {trim(md, 0)} {du} every {trim(interval)} h · loading dose = V·C/F = {trim(ld, 0)} {du}</p>
        <p className="ph-source">{c.drug.source}</p>
      </div>
    </Disclosure>
    <Disclosure label="Use buttons instead">
      <div className="ph-rows">
        {sorted.map(d => { const i = s.doses.indexOf(d); return <div className="ph-row" key={i}>
          <span>Dose {sorted.indexOf(d) + 1} · {timeLabel(d.t)} · {trim(d.amount, 0)} {du}{isLoad(d) ? ` (loading, ${routeOf(d) === "infusion" ? `${dur(hoursOf(d))} infusion` : routeOf(d)})` : routeOf(d) !== c.regimen.route ? ` (${routeOf(d)})` : ""}</span>
          <span className="ph-row-btns">
            <button type="button" onClick={() => kTime(i, -1)} aria-label={`Dose ${sorted.indexOf(d) + 1} earlier`}>Earlier</button>
            <button type="button" onClick={() => kTime(i, 1)} aria-label={`Dose ${sorted.indexOf(d) + 1} later`}>Later</button>
            <button type="button" onClick={() => kDose(i, -1)} aria-label={`Dose ${sorted.indexOf(d) + 1} less`}>−{trim(c.regimen.doseStep)}</button>
            <button type="button" onClick={() => kDose(i, 1)} aria-label={`Dose ${sorted.indexOf(d) + 1} more`}>+{trim(c.regimen.doseStep)}</button>
            <button type="button" onClick={() => kRemove(i)} disabled={s.doses.length < 2} aria-label={`Remove dose ${sorted.indexOf(d) + 1}`}>Remove</button>
          </span></div>; })}
        <div className="ph-row"><span>New dose at hour 0</span><span className="ph-row-btns"><button type="button" onClick={() => kAdd(0)}>Add a {addText}</button></span></div>
        <div className="ph-row"><span>Interval · every {trim(interval)} h</span><span className="ph-row-btns"><button type="button" onClick={() => kInterval(-1)}>Shorter</button><button type="button" onClick={() => kInterval(1)}>Longer</button></span></div>
        {c.patient?.clearance && <div className="ph-row"><span>{c.patient.clearance.label} · ×{trim(s.cl)}</span><span className="ph-row-btns"><button type="button" onClick={() => kScale("cl", -1)}>Lower</button><button type="button" onClick={() => kScale("cl", 1)}>Higher</button></span></div>}
        {c.patient?.volume && <div className="ph-row"><span>{c.patient.volume.label} · ×{trim(s.v)}</span><span className="ph-row-btns"><button type="button" onClick={() => kScale("v", -1)}>Smaller</button><button type="button" onClick={() => kScale("v", 1)}>Larger</button></span></div>}
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={ed.undo} reset={() => { ed.reset(); setMsg("Back to the starting regimen."); }} share={changed ? share : undefined} />
  </Shell>;
}

function niceStep(range: number, target: number) {
  const raw = range / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ============================ PD: receptor ============================ */

type RecState = { conc: Record<string, number>; probe: number };

export function pdState(c: PdConfig, conc: Record<string, number>): PdState {
  const s: PdState = { ka: c.agonist!.ec50 };
  for (const l of c.ligands ?? []) {
    const x = conc[l.id] ?? 0; if (!x) continue;
    if (l.kind === "competitive") { s.b = x; s.kb = l.k; }
    else if (l.kind === "noncompetitive") { s.n = x; s.kn = l.k; }
    else { s.p = x; s.kp = l.k; s.ep = l.efficacy; }
  }
  return s;
}

function ReceptorLab({ config: c, onChange, onShare }: { config: PdConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const ag = c.agonist!, ligs = c.ligands!;
  const initial = useMemo<RecState>(() => ({ conc: Object.fromEntries(ligs.map(l => [l.id, l.conc ?? 0])), probe: ag.probe ?? ag.ec50 * 10 }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const W = useElementWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const s = ed.view, base = ed.state;
  const narrow = W < 460;
  const [lo, hi] = c.range, L0 = Math.log10(lo), L1 = Math.log10(hi);
  const pad = { l: narrow ? 34 : 42, r: 12, t: 30 };
  const plotH = narrow ? 190 : 220, stripY = pad.t + plotH + 44, trayY = stripY + 46, H = trayY + 30;
  const pw = W - pad.l - pad.r;
  const X = (m: number) => pad.l + (Math.log10(m) - L0) / (L1 - L0) * pw;
  const M = (x: number) => 10 ** (L0 + clamp((x - pad.l) / pw, 0, 1) * (L1 - L0));
  const Y = (f: number) => pad.t + plotH * (1 - f);
  const snapLog = (m: number) => 10 ** (Math.round(Math.log10(m) * 20) / 20);
  const ps = pdState(c, s.conc), ps0 = pdState(c, {});
  const curve = (st: PdState) => { const pts: string[] = []; for (let i = 0; i <= 160; i++) { const m = 10 ** (L0 + i / 160 * (L1 - L0)); pts.push(`${i ? "L" : "M"}${X(m).toFixed(1)},${Y(response(m, st)).toFixed(1)}`); } return pts.join(""); };
  const partial = ligs.find(l => l.kind === "partial");
  const comp = ligs.find(l => l.kind === "competitive"), nonc = ligs.find(l => l.kind === "noncompetitive");
  const ec = readEc50(ps, lo / 1e3, hi * 1e3), ec0 = readEc50(ps0, lo / 1e3, hi * 1e3);
  const top = response(hi * 1e6, ps);
  const r = comp && s.conc[comp.id] ? doseRatio(s.conc[comp.id], comp.k) : 1;
  const probeE = response(s.probe, ps), probeE0 = response(s.probe, ps0);
  const placed = ligs.filter(l => s.conc[l.id] > 0);

  const lines: { tone: string; text: string }[] = [];
  if (!placed.length) lines.push({ tone: "info", text: `${ag.name} alone: EC50 ${molar(ec0)}, maximum 100%. At the probe (${molar(s.probe)}) the response is ${trim(probeE0 * 100, 0)}%.` });
  if (comp && s.conc[comp.id]) lines.push({ tone: "warn", text: `${comp.name} ${molar(s.conc[comp.id])} (${trim(s.conc[comp.id] / comp.k)} × KB): the curve slides right by a dose ratio of ${trim(r)} = 1 + [B]/KB, from EC50 ${molar(ec0)} to ${molar(ec)}${nonc && s.conc[nonc.id] ? "" : ". The top is still 100%: enough agonist wins the receptors back (surmountable)"}.` });
  if (nonc && s.conc[nonc.id]) lines.push({ tone: "bad", text: `${nonc.name} ${molar(s.conc[nonc.id])}: the maximum falls to ${trim(top * 100, 0)}% and no amount of ${ag.name.toLowerCase()} gets it back (insurmountable). ${comp && s.conc[comp.id] ? "" : `EC50 stays at ${molar(ec)}.`}` });
  if (partial && s.conc[partial.id]) {
    const alone = response(0, ps);
    lines.push({ tone: probeE < probeE0 - 0.02 ? "bad" : "info", text: `${partial.name} ${molar(s.conc[partial.id])} (${trim(s.conc[partial.id] / partial.k)} × its K) holds ${trim(alone * 100, 0)}% response on its own (its ceiling is ${trim((partial.efficacy ?? 0) * 100, 0)}%). At ${molar(s.probe)} ${ag.name.toLowerCase()} the response goes ${trim(probeE0 * 100, 0)}% → ${trim(probeE * 100, 0)}%: ${probeE < probeE0 - 0.02 ? "it displaces the full agonist and acts as an antagonist" : "at low full-agonist levels it adds to the response"}.` });
  }
  if (placed.length && !partial) lines.push({ tone: "info", text: `At the probe (${molar(s.probe)} ${ag.name.toLowerCase()}): ${trim(probeE0 * 100, 0)}% → ${trim(probeE * 100, 0)}%.` });
  const tone = lines.some(l => l.tone === "bad") ? "bad" : lines.some(l => l.tone === "warn") ? "warn" : "ok";

  const ligProps = (l: PdLigand) => bind(`lig-${l.id}`, p => ({ ...base, conc: { ...base.conc, [l.id]: p.y < stripY + 22 && p.y > pad.t + plotH - 10 ? snapLog(clamp(M(p.x), lo, hi)) : 0 } }));
  const probeProps = bind("probe", p => ({ ...base, probe: snapLog(clamp(M(p.x), lo, hi)) }));
  const kLig = (l: PdLigand, dir: number) => {
    const cur = base.conc[l.id];
    const next = !cur ? (dir > 0 ? l.k : 0) : clamp(cur * (dir > 0 ? 10 ** 0.25 : 10 ** -0.25), lo, hi);
    ed.commit({ ...base, conc: { ...base.conc, [l.id]: !cur && dir <= 0 ? 0 : snapLog(next) } });
  };
  const kRemove = (l: PdLigand) => ed.commit({ ...base, conc: { ...base.conc, [l.id]: 0 } });
  const kProbe = (dir: number) => ed.commit({ ...base, probe: snapLog(clamp(base.probe * 10 ** (dir * 0.25), lo, hi)) });

  const decades: number[] = []; for (let e = Math.ceil(L0); e <= Math.floor(L1); e++) decades.push(e);
  const every = narrow ? Math.ceil(decades.length / 4) : Math.ceil(decades.length / 9);
  const snapshot = () => ({ mode: "pd", conc: s.conc, probe: s.probe, ec50: ec, ec50Alone: ec0, top, doseRatio: r, probeE, probeE0, lines: lines.map(l => l.text), live: !!ed.live, moves: ed.moves, width: W });
  useDebugHook(snapshot, wrap, { strip: m => ({ x: X(m), y: stripY }), tray: x => ({ x: pad.l + x, y: trayY }), curve: (m, f) => ({ x: X(m), y: Y(f) }) });
  const share = () => {
    const did = placed.length ? placed.map(l => `${l.name} at ${molar(s.conc[l.id])}`).join(" and ") : "no antagonist (just moved the probe)";
    const learner = `I put ${did}. ${lines.map(l => l.text).join(" ")}`;
    const data = `${ag.name} EC50 ${molar(ec0)} → ${molar(ec)} · max ${trim(top * 100, 0)}% · dose ratio ${trim(r)} · probe ${molar(s.probe)} ${trim(probeE * 100, 0)}% · educational model`;
    let reply: string;
    if (comp && s.conc[comp.id] && !(nonc && s.conc[nonc.id])) reply = `Exactly the Schild result: dose ratio ${trim(r)} = 1 + ${molar(s.conc[comp.id])}/${molar(comp.k)}. Plot log(r − 1) against log[B] and the line crosses zero at −log KB = pA2 ≈ ${trim(-Math.log10(comp.k), 1)}. That's how KB is measured without ever seeing a receptor. Now drag ${nonc ? nonc.name : "a non-competitive blocker"} in: what happens to the top instead?`;
    else if (nonc && s.conc[nonc.id]) reply = `Right: ${nonc.name} doesn't compete for the ${ag.name.toLowerCase()} site, so more agonist can't overcome it. The maximum dropped to ${trim(top * 100, 0)}%. ${comp && s.conc[comp.id] ? `With both present you see both signatures: shifted right (×${trim(r)}) and lowered.` : "The maximum response fell but the EC50 didn't."} Caveat: with spare receptors, an irreversible blocker first shifts the curve and only lowers the top once the reserve is used up.`;
    else if (partial && s.conc[partial.id]) reply = probeE < probeE0 - 0.02 ? `That's precipitated withdrawal in one picture. ${partial.name} binds about ${trim(ag.ec50 / partial.k, 1)}× more tightly, takes receptors from ${ag.name.toLowerCase()}, and gives only ${trim((partial.efficacy ?? 0) * 100, 0)}% of the effect on each one. Response fell from ${trim(probeE0 * 100, 0)}% to ${trim(probeE * 100, 0)}%. Potency (where the curve sits) and efficacy (how high it goes) are separate properties.` : `At this low ${ag.name.toLowerCase()} level the partial agonist adds response. Slide the probe up to where ${ag.name.toLowerCase()} alone gives 90% or more and watch the sign flip.`;
    else reply = `The probe shows ${trim(probeE * 100, 0)}% at ${molar(s.probe)}. EC50 is where the curve crosses 50%: ${molar(ec)}. Now bring in an antagonist and see which property it changes.`;
    onShare?.({ learner, data, reply });
  };

  return <Shell title={c.title} goal={c.goal} warning="Educational model, not for clinical dosing." tone={tone} dragging={dragging}>
    <div className="ph-canvas" ref={wrap}>
      <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${ag.name} concentration–response curve`}>
        <rect className="ph-plot-bg" x={pad.l} y={pad.t} width={pw} height={plotH} rx={4} />
        {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line className={`ph-grid${f === 0.5 ? " ph-grid-strong" : ""}`} x1={pad.l} x2={pad.l + pw} y1={Y(f)} y2={Y(f)} /><text className="ph-tick" x={pad.l - 5} y={Y(f) + 3.5} textAnchor="end">{f * 100}</text></g>)}
        <text className="ph-axis-label" x={pad.l} y={pad.t - 8}>response, % of {ag.name.toLowerCase()} maximum</text>
        {decades.map((e, i) => i % every === 0 && <g key={e}><line className="ph-grid ph-grid-v" x1={X(10 ** e)} x2={X(10 ** e)} y1={pad.t} y2={pad.t + plotH} /><text className="ph-tick" x={X(10 ** e)} y={pad.t + plotH + 13} textAnchor={X(10 ** e) > pad.l + pw - 14 ? "end" : X(10 ** e) < pad.l + 14 ? "start" : "middle"}>{molar(10 ** e)}</text></g>)}
        <text className="ph-axis-label" x={pad.l + pw} y={pad.t + plotH + 26} textAnchor="end">log [{ag.name.toLowerCase()}]</text>
        {placed.length > 0 && <path className="ph-ghost" d={curve(ps0)} />}
        {partial && s.conc[partial.id] > 0 && <path className="ph-partial" d={(() => { const pts: string[] = []; for (let i = 0; i <= 120; i++) { const m = 10 ** (L0 + i / 120 * (L1 - L0)); pts.push(`${i ? "L" : "M"}${X(m).toFixed(1)},${Y(response(m, { ka: partial.k, ea: partial.efficacy })).toFixed(1)}`); } return pts.join(""); })()} />}
        <path className="ph-curve" d={curve(ps)} />
        {Number.isFinite(ec) && <g className="ph-mark"><line className="ph-ec" x1={X(ec)} x2={X(ec)} y1={Y(response(ec, ps))} y2={pad.t + plotH} /><circle cx={X(ec)} cy={Y(response(ec, ps))} r={3.5} /><text x={X(ec) + 5} y={Y(response(ec, ps)) + 13}>EC50 {molar(ec)}</text></g>}
        {placed.length > 0 && Math.abs(Math.log10(ec / ec0)) > 0.05 && <g className="ph-shift"><path d={`M${X(ec0)},${Y(0.5) - 10} H${X(ec) - 4}`} /><path d={`M${X(ec) - 8},${Y(0.5) - 14} L${X(ec) - 3},${Y(0.5) - 10} L${X(ec) - 8},${Y(0.5) - 6}`} /><text x={(X(ec0) + X(ec)) / 2} y={Y(0.5) - 15} textAnchor="middle">×{trim(ec / ec0)}</text></g>}
        {top < 0.98 && <g className="ph-topline"><line x1={pad.l} x2={pad.l + pw} y1={Y(top)} y2={Y(top)} /><text x={pad.l + pw - 4} y={Y(top) - 4} textAnchor="end">new maximum {trim(top * 100, 0)}%</text></g>}
        {/* probe: the agonist concentration, riding the curve */}
        <g data-handle="probe" className="ph-probe" transform={`translate(${X(s.probe)},${Y(probeE)})`} tabIndex={0} role="slider" aria-label={`${ag.name} concentration`} aria-valuenow={Math.log10(s.probe)} aria-valuetext={`${molar(s.probe)}, response ${trim(probeE * 100, 0)}%`}
          onKeyDown={e => keyStep(e, { dec: () => kProbe(-1), inc: () => kProbe(1) })} {...probeProps}>
          <line y1={0} y2={pad.t + plotH - Y(probeE)} className="ph-probe-line" /><circle r={13} className="ph-hit" /><circle r={6} />
          <text x={X(s.probe) > pad.l + pw - 90 ? -9 : 9} y={-9} textAnchor={X(s.probe) > pad.l + pw - 90 ? "end" : "start"}>{trim(probeE * 100, 0)}%</text></g>
        {/* the antagonist concentration line */}
        <text className="ph-lane-label" x={pad.l} y={stripY - 14}>{narrow ? "second drug, same log scale" : "antagonist / second drug concentration (same log scale)"}</text>
        <line className="ph-lane-base" x1={pad.l} x2={pad.l + pw} y1={stripY} y2={stripY} />
        {ligs.map(l => <g key={l.id} className={`ph-k ph-lig-${l.kind}`}><line x1={X(l.k)} x2={X(l.k)} y1={stripY - 4} y2={stripY + 4} /><text x={X(l.k)} y={stripY + 15} textAnchor="middle">{l.kind === "competitive" ? "KB" : "K"}</text></g>)}
        <text className="ph-lane-label" x={pad.l} y={trayY - 16}>{placed.length < ligs.length ? (narrow ? "tray · drag up onto the line" : "tray · drag a molecule up onto the line") : (narrow ? "drag back here to remove" : "drag a molecule back down here to remove it")}</text>
        <line className="ph-tray" x1={pad.l} x2={pad.l + pw} y1={trayY + 12} y2={trayY + 12} />
        {ligs.map((l, i) => {
          const on = s.conc[l.id] > 0;
          const tx = on ? X(s.conc[l.id]) : pad.l + (narrow ? 12 : 44) + i * Math.min(150, (pw - 30) / ligs.length);
          const ty = on ? stripY : trayY;
          return <g key={l.id} data-handle={`lig-${l.id}`} className={`ph-mol ph-lig-${l.kind}${on ? " is-on" : ""}`} transform={`translate(${tx},${ty})`} tabIndex={0} role="slider"
            aria-label={`${l.name} (${l.kind === "noncompetitive" ? "non-competitive" : l.kind}) concentration`} aria-valuenow={on ? Math.log10(s.conc[l.id]) : 0} aria-valuetext={on ? molar(s.conc[l.id]) : "in the tray"}
            onKeyDown={e => keyStep(e, { dec: () => kLig(l, -1), inc: () => kLig(l, 1), del: () => kRemove(l) })} {...ligProps(l)}>
            <circle r={15} className="ph-hit" />{l.kind === "competitive" ? <path d="M-7,-7 H7 V7 H-7 Z" /> : l.kind === "noncompetitive" ? <path d="M0,-8 L8,7 H-8 Z" /> : <circle r={7.5} />}
            {on ? <text x={tx > pad.l + pw - 110 ? -11 : 11} y={-9} textAnchor={tx > pad.l + pw - 110 ? "end" : "start"}>{l.name} {molar(s.conc[l.id])}</text> : <text x={12} y={4}>{l.name}</text>}</g>;
        })}
      </svg>
    </div>
    <div className={`ph-readout ph-tone-${tone}`} role="status" aria-live="polite">
      {lines.map((l, i) => <p key={i} className={`ph-line ph-tone-${l.tone}`}>{l.text}</p>)}
      {ed.unchangedDrop && <p className="ph-why">That drop left everything as it was.</p>}
    </div>
    <Disclosure label="Show the equations">
      <div className="ph-eq">
        <p>E/Emax = (A/KA + e·P/KP) / (1 + A/KA + P/KP + B/KB) × 1/(1 + N/KN)</p>
        <p>Competitive B: dose ratio r = 1 + [B]/KB (Schild), so log(r − 1) = log[B] − log KB and pA2 = −log KB{comp ? ` = ${trim(-Math.log10(comp.k), 1)}` : ""}.</p>
        <p>Non-competitive N: maximum × 1/(1 + [N]/KN), EC50 unchanged. Partial agonist P: its own ceiling is e{partial ? ` = ${trim(partial.efficacy ?? 0)}` : ""}.</p>
        {c.assumptions && <p>{c.assumptions}</p>}
        <p className="ph-source">{c.source}</p>
      </div>
    </Disclosure>
    <Disclosure label="Use buttons instead">
      <div className="ph-rows">
        <div className="ph-row"><span>{ag.name} probe · {molar(s.probe)}</span><span className="ph-row-btns"><button type="button" onClick={() => kProbe(-1)}>Lower</button><button type="button" onClick={() => kProbe(1)}>Higher</button></span></div>
        {ligs.map(l => <div className="ph-row" key={l.id}><span>{l.name} · {s.conc[l.id] ? molar(s.conc[l.id]) : "in the tray"}</span><span className="ph-row-btns">
          <button type="button" onClick={() => kLig(l, 1)}>{s.conc[l.id] ? "More" : "Add at K"}</button>
          <button type="button" onClick={() => kLig(l, -1)} disabled={!s.conc[l.id]}>Less</button>
          <button type="button" onClick={() => kRemove(l)} disabled={!s.conc[l.id]}>Remove</button></span></div>)}
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={ed.undo} reset={ed.reset} share={ed.moves ? share : undefined} />
  </Shell>;
}

/* ============================ PD: quantal ============================ */

type QState = { dose: number; td50: number };

function QuantalLab({ config: c, onChange, onShare }: { config: PdConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const q = c.quantal!;
  const initial = useMemo<QState>(() => ({ dose: q.dose, td50: q.td50 }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const W = useElementWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const s = ed.view, base = ed.state;
  const narrow = W < 460;
  const [lo, hi] = c.range, L0 = Math.log10(lo), L1 = Math.log10(hi);
  const pad = { l: narrow ? 34 : 42, r: 12, t: 26 };
  const plotH = narrow ? 200 : 230, H = pad.t + plotH + 40;
  const pw = W - pad.l - pad.r;
  const X = (d: number) => pad.l + (Math.log10(d) - L0) / (L1 - L0) * pw;
  const D = (x: number) => 10 ** (L0 + clamp((x - pad.l) / pw, 0, 1) * (L1 - L0));
  const Y = (f: number) => pad.t + plotH * (1 - f);
  const snapLog = (d: number) => 10 ** (Math.round(Math.log10(d) * 40) / 40);
  const path = (d50: number) => { const pts: string[] = []; for (let i = 0; i <= 160; i++) { const d = 10 ** (L0 + i / 160 * (L1 - L0)); pts.push(`${i ? "L" : "M"}${X(d).toFixed(1)},${Y(quantal(d, d50, q.sigma)).toFixed(1)}`); } return pts.join(""); };
  const eff = quantal(s.dose, q.ed50, q.sigma), tox = quantal(s.dose, s.td50, q.sigma);
  const ti = s.td50 / q.ed50, ed99 = quantalDose(0.99, q.ed50, q.sigma), td1 = quantalDose(0.01, s.td50, q.sigma), csf = td1 / ed99;
  const tone = tox > 0.05 ? "bad" : eff < 0.5 ? "warn" : "ok";
  const lines = [
    { tone: eff < 0.5 ? "warn" : "ok", text: `${trim(s.dose)} ${q.unit}: works in ${trim(eff * 100, 0)}% of people and is toxic in ${trim(tox * 100, 1)}%.` },
    { tone: ti < 3 ? "bad" : "info", text: `Therapeutic index TD50/ED50 = ${trim(s.td50)}/${trim(q.ed50)} = ${trim(ti, 1)}. ${csf < 1 ? `The curves overlap: the dose that helps 99% (${trim(ed99, 1)}) already harms ${trim(quantal(ed99, s.td50, q.sigma) * 100, 1)}%.` : `TD1/ED99 = ${trim(csf, 2)}, so there is a dose that helps almost everyone and harms almost no one.`}` },
  ];
  const doseProps = bind("dose", p => ({ ...base, dose: snapLog(clamp(D(p.x), lo, hi)) }));
  const tdProps = bind("td50", p => ({ ...base, td50: snapLog(clamp(D(p.x), q.tdMin ?? q.ed50 * 1.05, q.tdMax ?? hi)) }));
  const kDose = (dir: number) => ed.commit({ ...base, dose: snapLog(clamp(base.dose * 10 ** (dir / 20), lo, hi)) });
  const kTd = (dir: number) => ed.commit({ ...base, td50: snapLog(clamp(base.td50 * 10 ** (dir / 20), q.tdMin ?? q.ed50 * 1.05, q.tdMax ?? hi)) });
  const decades: number[] = []; for (let e = Math.ceil(L0); e <= Math.floor(L1); e++) decades.push(e);
  const snapshot = () => ({ mode: "quantal", dose: s.dose, td50: s.td50, eff, tox, ti, csf, lines: lines.map(l => l.text), live: !!ed.live, moves: ed.moves, width: W });
  useDebugHook(snapshot, wrap, { axis: d => ({ x: X(d), y: pad.t + plotH }), mid: d => ({ x: X(d), y: Y(0.5) }) });
  const share = () => onShare?.({
    learner: `I set the dose to ${trim(s.dose)} ${q.unit}${Math.abs(s.td50 - q.td50) > 1e-9 ? ` and moved the TD50 to ${trim(s.td50)}` : ""}. ${lines.map(l => l.text).join(" ")}`,
    data: `${q.drug} · dose ${trim(s.dose)} ${q.unit} · effective ${trim(eff * 100, 0)}% · toxic ${trim(tox * 100, 1)}% · TI ${trim(ti, 1)} · TD1/ED99 ${trim(csf, 2)} · educational model`,
    reply: ti < 3 ? `With a TI of ${trim(ti, 1)}, the dose that helps most people already harms some. That's the situation with drugs like digoxin or lithium, where we measure blood levels instead of trusting the dose. TI is a population ratio, though: it says nothing about which patient is at the sensitive end of the toxic curve.`
      : `A TI of ${trim(ti, 1)} looks comfortable, but check the slopes, not just the midpoints: TD1/ED99 is ${trim(csf, 2)}${csf < 1 ? ", so even here the dose that helps nearly everyone already harms some people" : ""}. Two drugs can share a TI and differ wildly here if one has a shallow curve.${csf < 1 ? "" : " Try dragging the toxic curve closer and watch when TD1/ED99 drops below 1."}`,
  });
  return <Shell title={c.title} goal={c.goal} warning="Educational model, not for clinical dosing." tone={tone} dragging={dragging}>
    <div className="ph-canvas" ref={wrap}>
      <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Quantal dose–response curves for ${q.drug}`}>
        <rect className="ph-plot-bg" x={pad.l} y={pad.t} width={pw} height={plotH} rx={4} />
        {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line className={`ph-grid${f === 0.5 ? " ph-grid-strong" : ""}`} x1={pad.l} x2={pad.l + pw} y1={Y(f)} y2={Y(f)} /><text className="ph-tick" x={pad.l - 5} y={Y(f) + 3.5} textAnchor="end">{f * 100}</text></g>)}
        <text className="ph-axis-label" x={pad.l} y={pad.t - 8}>% of people responding</text>
        {decades.map(e => <g key={e}><line className="ph-grid ph-grid-v" x1={X(10 ** e)} x2={X(10 ** e)} y1={pad.t} y2={pad.t + plotH} /><text className="ph-tick" x={X(10 ** e)} y={pad.t + plotH + 13} textAnchor="middle">{trim(10 ** e)}</text></g>)}
        <text className="ph-axis-label" x={pad.l + pw} y={pad.t + plotH + 28} textAnchor="end">dose, {q.unit} (log scale)</text>
        {ti >= 1 && <rect className="ph-gap" x={X(q.ed50)} y={Y(0.5) - 3} width={X(s.td50) - X(q.ed50)} height={6} />}
        <path className="ph-curve" d={path(q.ed50)} />
        <path className="ph-curve-tox" d={path(s.td50)} />
        {ed.live && Math.abs(base.td50 - s.td50) > 1e-9 && <path className="ph-ghost" d={path(base.td50)} />}
        <g className="ph-mark"><circle cx={X(q.ed50)} cy={Y(0.5)} r={3.5} /><text x={X(q.ed50) - 5} y={Y(0.5) - 8} textAnchor="end">ED50 {trim(q.ed50)}</text></g>
        <text className="ph-band-label ph-tone-ok" x={X(q.ed50 * 3)} y={Y(0.93)}>therapeutic effect</text>
        <g data-handle="td50" className="ph-knob ph-knob-tox" transform={`translate(${X(s.td50)},${Y(0.5)})`} tabIndex={0} role="slider" aria-label="TD50, the dose toxic in half of people" aria-valuenow={s.td50} aria-valuetext={`${trim(s.td50)} ${q.unit}`}
          onKeyDown={e => keyStep(e, { dec: () => kTd(-1), inc: () => kTd(1) })} {...tdProps}>
          <circle r={14} className="ph-hit" /><circle r={6.5} /><text x={9} y={16}>TD50 {trim(s.td50)}</text></g>
        <text className="ph-band-label ph-tone-bad" x={Math.min(pad.l + pw - 4, X(s.td50 * 2.5))} y={Y(0.78)} textAnchor="end">toxic effect</text>
        <g data-handle="dose" className="ph-probe" transform={`translate(${X(s.dose)},${pad.t + plotH})`} tabIndex={0} role="slider" aria-label="Dose" aria-valuenow={s.dose} aria-valuetext={`${trim(s.dose)} ${q.unit}: ${trim(eff * 100, 0)}% effective, ${trim(tox * 100, 1)}% toxic`}
          onKeyDown={e => keyStep(e, { dec: () => kDose(-1), inc: () => kDose(1) })} {...doseProps}>
          <line y1={0} y2={-plotH} className="ph-probe-line" /><circle cy={Y(eff) - pad.t - plotH} r={4} className="ph-dot-ok" /><circle cy={Y(tox) - pad.t - plotH} r={4} className="ph-dot-bad" />
          <rect x={-9} y={-8} width={18} height={16} rx={4} className="ph-hit" /><path d="M0,-7 L6,4 H-6 Z" />
          <text x={X(s.dose) > pad.l + pw - 70 ? -8 : 8} y={-plotH + 12} textAnchor={X(s.dose) > pad.l + pw - 70 ? "end" : "start"}>{trim(s.dose)} {q.unit}</text></g>
      </svg>
    </div>
    <div className={`ph-readout ph-tone-${tone}`} role="status" aria-live="polite">
      {lines.map((l, i) => <p key={i} className={`ph-line ph-tone-${l.tone}`}>{l.text}</p>)}
    </div>
    <Disclosure label="Show the equations">
      <div className="ph-eq"><p>Fraction responding = Φ((log D − log D50)/σ), σ = {q.sigma} log₁₀ units. TI = TD50/ED50; a stricter margin is TD1/ED99.</p>
        {c.assumptions && <p>{c.assumptions}</p>}<p className="ph-source">{c.source}</p></div>
    </Disclosure>
    <Disclosure label="Use buttons instead">
      <div className="ph-rows">
        <div className="ph-row"><span>Dose · {trim(s.dose)} {q.unit}</span><span className="ph-row-btns"><button type="button" onClick={() => kDose(-1)}>Lower</button><button type="button" onClick={() => kDose(1)}>Higher</button></span></div>
        <div className="ph-row"><span>TD50 · {trim(s.td50)} {q.unit}</span><span className="ph-row-btns"><button type="button" onClick={() => kTd(-1)}>Closer</button><button type="button" onClick={() => kTd(1)}>Further</button></span></div>
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={ed.undo} reset={ed.reset} share={ed.moves ? share : undefined} />
  </Shell>;
}

/* ============================ Oncology ============================ */

type OncState = { cycles: Cycle[]; gcsf: boolean; removing?: number };

export function oncParams(c: OncConfig, gcsf: boolean): OncParams {
  return { ...c.tumour, ...c.marrow, gcsf };
}

/** CTCAE v6.0 "Neutrophil count decreased" grade for an ANC in ×10⁹/L: 1 <1.5–1.0, 2 <1.0–0.5, 3 <0.5–0.1, 4 <0.1 (below LLN is not graded here). */
export function ctcaeV6Anc(anc: number): 0 | 1 | 2 | 3 | 4 {
  return anc < 0.1 ? 4 : anc < 0.5 ? 3 : anc < 1 ? 2 : anc < 1.5 ? 1 : 0;
}

function OncLab({ config: c, onChange, onShare }: { config: OncConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const initial = useMemo<OncState>(() => ({ cycles: c.regimen.cycles.map(x => ({ ...x })), gcsf: !!c.marrow.gcsf }), [c]);
  const ed = useEditable(initial, onChange);
  const wrap = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const W = useElementWidth(wrap);
  const [dragging, setDragging] = useState<string | null>(null);
  const bind = useDrag(svg, ed, setDragging);
  const shown = ed.view, base = ed.state;
  const s: OncState = shown.removing === undefined ? shown : { ...shown, cycles: shown.cycles.filter((_, j) => j !== shown.removing) };
  const narrow = W < 460;
  const pad = { l: narrow ? 36 : 44, r: 12, t: 22 };
  const tH = narrow ? 120 : 140, aTop = pad.t + tH + 26, aH = narrow ? 110 : 124, laneTop = aTop + aH + 26, laneH = 46, laneBase = laneTop + laneH, H = laneBase + 46;
  const pw = W - pad.l - pad.r;
  const X = (d: number) => pad.l + d / c.days * pw;
  const Dd = (x: number) => clamp((x - pad.l) / pw * c.days, 0, c.days);
  const logLo = 5, logHi = Math.ceil(Math.log10(c.tumour.k));
  const Yt = (n: number) => pad.t + tH * (1 - (clamp(Math.log10(n), logLo, logHi) - logLo) / (logHi - logLo));
  const aMax = Math.max(8, c.marrow.anc0 * 1.6);
  const Ya = (a: number) => aTop + aH * (1 - clamp(a, 0, aMax) / aMax);
  const step = c.regimen.dayStep ?? 1, dStep = c.regimen.doseStep ?? 0.05;
  const DH = (f: number) => laneBase - (f / 1.25) * (laneH - 6);
  const F = (y: number) => clamp(snap((laneBase - y) / (laneH - 6) * 1.25, dStep), 0.25, 1.25);
  const run = useMemo(() => oncRun(s.cycles, oncParams(c, s.gcsf), c.days), [c, s]);
  const run0 = useMemo(() => oncRun(initial.cycles, oncParams(c, initial.gcsf), c.days), [c, initial]);
  const showRef = ed.moves > 0 || !!ed.live;
  const pathOf = (r: typeof run, y: (v: number) => number, key: "tumour" | "anc") => {
    const pts = r.days.map((d, i) => ({ d, v: r[key][i] }));
    if (key === "tumour") for (const k of r.kills) { const j = pts.findIndex(p => p.d >= k.day - 1e-6); if (j >= 0) pts.splice(j, 0, { d: k.day, v: k.before }); }
    return pts.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  };
  const sortedPlan = [...s.cycles].map((cy, i) => ({ ...cy, i })).sort((a, b) => a.day - b.day);
  const after = c.residualAfter ?? 21;
  const at = (r: typeof run, day: number) => r.tumour[Math.min(r.tumour.length - 1, Math.round(day * 4))];
  const endOf = (r: typeof run) => Math.min(c.days, (r.given.length ? r.given[r.given.length - 1].day : 0) + after);
  const cmpDay = endOf(run), cmpDay0 = endOf(run0);
  const nAt = at(run, cmpDay), nAt0 = at(run0, cmpDay0);
  const lowest = Math.min(...run.nadirs.map(n => n.anc));
  const lowestShown = +lowest.toFixed(2);   // grade the value exactly as it is displayed
  const grade = ctcaeV6Anc(lowestShown);
  const delays = run.delays.map((d, j) => ({ d, j })).filter(x => x.d > 0.5);
  const missed = run.delays.filter(d => !Number.isFinite(d)).length;
  const gaps = sortedPlan.slice(1).map((cy, j) => cy.day - sortedPlan[j].day);
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const nadirDays = run.nadirs.map(n => n.day);
  const lines: { tone: string; text: string }[] = [];
  lines.push({ tone: "info", text: `Neutrophil nadir ${Math.round(Math.min(...nadirDays)) === Math.round(Math.max(...nadirDays)) ? `on day ${trim(Math.min(...nadirDays), 0)}` : `on days ${trim(Math.min(...nadirDays), 0)}–${trim(Math.max(...nadirDays), 0)}`} after each cycle, lowest ${lowestShown.toFixed(2)} ×10⁹/L${grade ? ` (CTCAE v6.0 grade ${grade} neutrophil count decreased)` : ""}.` });
  if (delays.length) lines.push({ tone: "bad", text: delays.map(x => Number.isFinite(x.d) ? `Cycle ${x.j + 1} delayed ${trim(x.d, 0)} day${Math.round(x.d) === 1 ? "" : "s"}` : `Cycle ${x.j + 1} never given`).join(", ") + `: ANC below ${trim(c.marrow.threshold, 1)} on the planned day.` });
  else lines.push({ tone: "ok", text: `Every cycle went ahead on time (ANC ≥ ${trim(c.marrow.threshold, 1)} on each start day).` });
  lines.push({ tone: nAt < nAt0 * 0.8 ? "ok" : nAt > nAt0 * 1.25 ? "warn" : "info", text: `${after} days after the last cycle (day ${trim(cmpDay, 0)}): ${sci(nAt)} tumour cells${showRef ? ` (the plan you started with: ${sci(nAt0)} on day ${trim(cmpDay0, 0)})` : ""}, from ${sci(c.tumour.n0)}.` });
  const tone = delays.length ? "bad" : lowest < 0.5 ? "warn" : "ok";
  const setCycle = (st: OncState, i: number, patch: Partial<Cycle> | null): OncState => {
    const cycles = st.cycles.map(x => ({ ...x }));
    if (patch === null) cycles.splice(i, 1); else cycles[i] = { ...cycles[i], ...patch };
    return { ...st, cycles };
  };
  const removeZone = laneBase + 24;
  const baseProps = (i: number) => bind(`cycle-${i}`, p => p.y > removeZone && base.cycles.length > 1 ? { ...base, removing: i } : setCycle(base, i, { day: clamp(snap(Dd(p.x), step), 0, c.days) }),
    st => st.removing === undefined ? st : setCycle({ ...st, removing: undefined }, st.removing, null));
  const headProps = (i: number) => bind(`dose-${i}`, p => setCycle(base, i, { dose: +F(p.y).toFixed(2) }));
  const addProps = bind("add", p => p.y > laneTop - 14 && p.y < laneBase + 18 && p.x > pad.l - 4 && base.cycles.length < c.regimen.maxCycles
    ? { ...base, cycles: [...base.cycles, { day: clamp(snap(Dd(p.x), step), 0, c.days), dose: 1 }] } : base);
  const removing = shown.removing;
  const kDay = (i: number, dir: number) => ed.commit(setCycle(base, i, { day: clamp(base.cycles[i].day + dir * step, 0, c.days) }));
  const kDose = (i: number, dir: number) => ed.commit(setCycle(base, i, { dose: +clamp(base.cycles[i].dose + dir * dStep, 0.25, 1.25).toFixed(2) }));
  const kRemove = (i: number) => { if (base.cycles.length > 1) ed.commit(setCycle(base, i, null)); };
  const kAdd = () => { if (base.cycles.length < c.regimen.maxCycles) { const last = Math.max(...base.cycles.map(x => x.day)); ed.commit({ ...base, cycles: [...base.cycles, { day: clamp(last + (meanGap || 21), 0, c.days), dose: 1 }] }); } };
  const kSpace = (gap: number) => { const sorted = [...base.cycles].sort((a, b) => a.day - b.day); const t0 = sorted[0].day; ed.commit({ ...base, cycles: sorted.map((x, j) => ({ ...x, day: clamp(t0 + j * gap, 0, c.days) })) }); };
  const toggleG = () => ed.commit({ ...base, gcsf: !base.gcsf });
  const ticks: number[] = []; for (let d = 0; d <= c.days; d += 7) ticks.push(d);
  const snapshot = () => ({ mode: "oncology", cycles: s.cycles, gcsf: s.gcsf, given: run.given, delays: run.delays, nadirs: run.nadirs, tumourAtCompare: nAt, tumourAtCompare0: nAt0, lowest, lines: lines.map(l => l.text), live: !!ed.live, removing: removing ?? null, moves: ed.moves, width: W, ancAt: (d: number) => run.anc[Math.round(d * 4)] });
  useDebugHook(snapshot, wrap, { lane: (d, f) => ({ x: X(d), y: DH(f) }), below: (d, dy) => ({ x: X(d), y: laneBase + dy }) });
  const share = () => {
    const plan = sortedPlan.map(x => `day ${trim(x.day, 0)}${Math.abs(x.dose - 1) > 0.001 ? ` at ${trim(x.dose * 100, 0)}%` : ""}`).join(", ");
    const learner = `I planned ${s.cycles.length} cycles (${plan})${s.gcsf ? " with G-CSF" : " without G-CSF"}. ${lines.map(l => l.text).join(" ")}`;
    const data = `${s.cycles.length} cycles · mean gap ${trim(meanGap, 1)} d · G-CSF ${s.gcsf ? "yes" : "no"} · delays ${delays.length} · nadir ${trim(lowest, 1)} ×10⁹/L · residual ${sci(nAt)} on day ${trim(cmpDay, 0)} · teaching model, not a treatment plan`;
    let reply: string;
    const logsOf = (r: typeof run) => r.given.reduce((a, g) => a + g.dose * c.tumour.logKill, 0);
    const doseKey = (r: typeof run) => r.given.map(g => g.dose.toFixed(2)).sort().join(",");
    const sameDelivery = run.given.length === run0.given.length && doseKey(run) === doseKey(run0);
    const firstDelay = delays.find(x => Number.isFinite(x.d));
    const nadirTxt = `nadir around day ${trim(Math.min(...nadirDays), 0)}`;
    if (meanGap < 18 && delays.length && !s.gcsf) {
      const planned = firstDelay ? sortedPlan[firstDelay.j]?.day : undefined;
      reply = `That's the catch with dose density in this model: ${planned !== undefined ? `on day ${trim(planned, 0)}, when cycle ${firstDelay!.j + 1} was scheduled,` : "on a scheduled start day"} the modelled neutrophil count is still below the ${trim(c.marrow.threshold, 1)} start rule (${nadirTxt}), so the cycle slips and you lose the density you planned. CALGB 9741 administered the two-week regimens with filgrastim. In this simulation the support toggle changes modeled recovery. Turn it on and drag again.`;
    } else if (meanGap < 18 && !delays.length) {
      const cmp = `The tumour ends at ${sci(nAt)} on day ${trim(cmpDay, 0)} versus ${sci(nAt0)} on day ${trim(cmpDay0, 0)} for the plan you started with (both toy-model outputs, ${after} days after the last cycle).`;
      reply = sameDelivery
        ? `Every cycle on time at a ${trim(meanGap, 0)}-day mean gap${s.gcsf ? " with G-CSF" : ""}. ${cmp} The delivered doses and cycle count match the starting plan, so the difference comes from timing: shorter intervals leave less time for regrowth in this simulation. Smaller burdens have higher fractional (per-cell) growth rates. This model uses fixed log-kill; the Norton–Simon hypothesis instead ties regression to the growth rate of an unperturbed tumour of that size.`
        : `Every cycle on time at a ${trim(meanGap, 0)}-day mean gap${s.gcsf ? " with G-CSF" : ""}. ${cmp} The delivered doses differ from the starting plan (${trim(logsOf(run), 2)} versus ${trim(logsOf(run0), 2)} logs of modelled kill over ${run.given.length} versus ${run0.given.length} cycles), so the difference is not from timing alone.`;
    } else if (s.cycles.some(x => x.dose < 0.95)) reply = `Reducing a dose lowers the modelled nadir but costs log-kill: with ${c.tumour.logKill} log per full cycle, an 80% dose kills ${trim(c.tumour.logKill * 0.8, 1)} logs in this model. Delays and reductions both lower the delivered dose intensity.`;
    else reply = `With these gaps the modelled counts recover in time and the tumour is at ${sci(nAt)} ${after} days after the last cycle. Try moving the cycles closer together: what limits how close they can go?`;
    onShare?.({ learner, data, reply });
  };

  return <Shell title={c.title} goal={c.goal} warning="Teaching model, not a treatment plan. Not for clinical use." tone={tone} dragging={dragging}>
    <div className="ph-canvas" ref={wrap}>
      <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tumour cells and neutrophils over ${c.days} days with ${s.cycles.length} cycles`}>
        {/* tumour */}
        <rect className="ph-plot-bg" x={pad.l} y={pad.t} width={pw} height={tH} rx={4} />
        {Array.from({ length: logHi - logLo + 1 }, (_, i) => logLo + i).map(e => <g key={e}><line className="ph-grid" x1={pad.l} x2={pad.l + pw} y1={Yt(10 ** e)} y2={Yt(10 ** e)} />{(e - logLo) % 2 === 0 && <text className="ph-tick" x={pad.l - 5} y={Yt(10 ** e) + 3.5} textAnchor="end">10{sup(e)}</text>}</g>)}
        <text className="ph-axis-label" x={pad.l} y={pad.t - 7}>tumour cells (log scale)</text>
        {c.tumour.detect && <g className="ph-css"><line x1={pad.l} x2={pad.l + pw} y1={Yt(c.tumour.detect)} y2={Yt(c.tumour.detect)} /><text x={pad.l + pw - 4} y={Yt(c.tumour.detect) - 4} textAnchor="end">~1 cm³: clinically detectable</text></g>}
        {showRef && <path className="ph-ghost" d={pathOf(run0, Yt, "tumour")} />}
        <path className="ph-curve" d={pathOf(run, Yt, "tumour")} />
        <g className="ph-mark"><line className="ph-ec" x1={X(cmpDay)} x2={X(cmpDay)} y1={pad.t} y2={pad.t + tH} /><circle cx={X(cmpDay)} cy={Yt(nAt)} r={3.5} /><text x={X(cmpDay) + (X(cmpDay) > pad.l + pw - 90 ? -5 : 5)} y={Yt(nAt) - 6} textAnchor={X(cmpDay) > pad.l + pw - 90 ? "end" : "start"}>{sci(nAt)}</text></g>
        {/* neutrophils */}
        <rect className="ph-plot-bg" x={pad.l} y={aTop} width={pw} height={aH} rx={4} />
        <rect className="ph-band ph-band-bad" x={pad.l} y={Ya(0.5)} width={pw} height={Ya(0) - Ya(0.5)} />
        {[0, 2, 4, 6, 8].filter(v => v <= aMax).map(v => <g key={v}><line className="ph-grid" x1={pad.l} x2={pad.l + pw} y1={Ya(v)} y2={Ya(v)} /><text className="ph-tick" x={pad.l - 5} y={Ya(v) + 3.5} textAnchor="end">{v}</text></g>)}
        <text className="ph-axis-label" x={pad.l} y={aTop - 7}>neutrophils (ANC, ×10⁹/L)</text>
        <line className="ph-target" x1={pad.l} x2={pad.l + pw} y1={Ya(c.marrow.threshold)} y2={Ya(c.marrow.threshold)} />
        <text className="ph-band-label" x={pad.l + pw - 4} y={Ya(c.marrow.threshold) - 4} textAnchor="end">{narrow ? `start rule ≥ ${trim(c.marrow.threshold, 1)}` : `simulated protocol: start a cycle at ≥ ${trim(c.marrow.threshold, 1)}`}</text>
        <text className="ph-band-label ph-tone-bad" x={pad.l + pw - 4} y={Ya(0) - 3} textAnchor="end">&lt; 0.5: CTCAE v6 grade 3–4</text>
        {showRef && <path className="ph-ghost" d={pathOf(run0, Ya, "anc")} />}
        <path className="ph-curve ph-curve-anc" d={pathOf(run, Ya, "anc")} />
        {run.nadirs.map((n, j) => <circle key={j} className="ph-nadir" cx={X(run.given[j].day + n.day)} cy={Ya(n.anc)} r={3} />)}
        {run.given.length > 0 && <text className="ph-mark-text" x={X(run.given[0].day + run.nadirs[0].day)} y={Ya(run.nadirs[0].anc) + 13} textAnchor="middle">nadir d{trim(run.nadirs[0].day, 0)}</text>}
        {/* cycle lane */}
        <text className="ph-lane-label" x={pad.l} y={laneTop - 8}>{narrow ? "cycles · slide, lift for dose %, pull off" : "cycles · slide a foot to move it, drag a dot for dose %, pull it off to remove"}</text>
        <line className="ph-lane-base" x1={pad.l} x2={pad.l + pw} y1={laneBase} y2={laneBase} />
        {ticks.map(d => <g key={d}><line className="ph-grid ph-grid-v" x1={X(d)} x2={X(d)} y1={laneBase} y2={laneBase + 4} />{(narrow ? d % 14 === 0 : true) && <text className="ph-tick" x={X(d)} y={laneBase + 14} textAnchor="middle">{d}</text>}</g>)}
        <text className="ph-axis-label" x={pad.l + pw} y={laneBase + 28} textAnchor="end">days</text>
        {dragging?.startsWith("cycle-") && <g className="ph-remove-zone"><rect x={pad.l} y={removeZone} width={pw} height={H - removeZone - 2} rx={5} /><text x={pad.l + pw / 2} y={removeZone + 15} textAnchor="middle">{removing !== undefined ? "release to remove this cycle" : "drop here to remove"}</text></g>}
        {run.given.map((g, j) => {
          const planned = sortedPlan[j]; if (!planned || g.day - planned.day < 0.5) return null;
          return <g key={"d" + j} className="ph-delay"><path d={`M${X(planned.day)},${laneBase - 3} H${X(g.day) - 3}`} /><path d={`M${X(g.day) - 7},${laneBase - 7} L${X(g.day) - 2},${laneBase - 3} L${X(g.day) - 7},${laneBase + 1}`} /><circle cx={X(g.day)} cy={laneBase} r={3.5} /><text x={X(g.day) + 4} y={laneBase - 7}>+{trim(g.day - planned.day, 0)}d</text></g>;
        })}
        {shown.cycles.map((cy, i) => {
          const x = X(cy.day), y = DH(cy.dose), gone = removing === i;
          return <g key={i} className={`ph-dose${gone ? " is-removing" : ""}`}>
            <line className="ph-stem" x1={x} x2={x} y1={laneBase} y2={y} />
            <g data-handle={`dose-${i}`} className="ph-head" transform={`translate(${x},${y})`} tabIndex={0} role="slider" aria-label={`Cycle ${i + 1} dose`} aria-valuemin={25} aria-valuemax={125} aria-valuenow={Math.round(cy.dose * 100)} aria-valuetext={`${trim(cy.dose * 100, 0)}% of full dose on day ${trim(cy.day, 0)}`}
              onKeyDown={e => keyStep(e, { dec: () => kDose(i, -1), inc: () => kDose(i, 1), del: () => kRemove(i) })} {...headProps(i)}>
              <circle r={12} className="ph-hit" /><circle r={5.5} />{Math.abs(cy.dose - 1) > 0.001 && <text y={-8} textAnchor="middle">{trim(cy.dose * 100, 0)}%</text>}</g>
            <g data-handle={`cycle-${i}`} className="ph-foot" transform={`translate(${x},${laneBase})`} tabIndex={0} role="slider" aria-label={`Cycle ${i + 1} start day`} aria-valuemin={0} aria-valuemax={c.days} aria-valuenow={cy.day} aria-valuetext={`day ${trim(cy.day, 0)}; Delete removes it`}
              onKeyDown={e => keyStep(e, { dec: () => kDay(i, -1), inc: () => kDay(i, 1), del: () => kRemove(i) })} {...baseProps(i)}>
              <rect x={-9} y={-6} width={18} height={18} className="ph-hit" /><path d="M0,0 L5,7 H-5 Z" /></g>
          </g>;
        })}
        {s.cycles.length < c.regimen.maxCycles && <g data-handle="add" className="ph-add" transform={`translate(${pad.l - (narrow ? 20 : 24)},${laneTop + laneH / 2})`} tabIndex={0} role="button" aria-label="Add a cycle after the last one"
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kAdd(); } }} {...addProps}>
          <circle r={14} className="ph-hit" /><circle r={10} /><path d="M-4.5,0 H4.5 M0,-4.5 V4.5" /><text y={24} textAnchor="middle">cycle</text></g>}
      </svg>
    </div>
    <div className={`ph-readout ph-tone-${tone}`} role="status" aria-live="polite">
      {lines.map((l, i) => <p key={i} className={`ph-line ph-tone-${l.tone}`}>{l.text}</p>)}
      {missed > 0 && <p className="ph-why">{missed} cycle{missed > 1 ? "s" : ""} could not start before day {c.days}.</p>}
      {ed.unchangedDrop && <p className="ph-why">That drop left the plan unchanged.</p>}
    </div>
    <Disclosure label="Show the equations">
      <div className="ph-eq">
        <p>Log-kill: each cycle multiplies the cell count by 10^(−{c.tumour.logKill} × dose fraction), the same fraction whatever the size (Skipper–Schabel–Wilcox). Norton–Simon instead relates regression to the growth rate of an unperturbed tumour of that size; this model does not implement that.</p>
        <p>Regrowth between cycles is Gompertzian: N(t) = K·exp(ln(N₀/K)·e^(−bt)), K = {sci(c.tumour.k)}, b = {c.tumour.b}/day. The per-cell (fractional) growth rate b·ln(K/N) is higher at smaller burdens; absolute growth peaks at N = K/e.</p>
        <p>Neutrophils: proliferating pool → 3 transit pools → blood, mean transit {c.marrow.mtt} h, feedback (ANC₀/ANC)^{c.marrow.gamma}; each cycle suppresses proliferation, decaying over {c.marrow.effectDays} days. G-CSF is modelled as extra proliferation on days 2–11{c.marrow.gcsfMtt ? ` and a ${c.marrow.gcsfMtt} h transit` : ""} (illustrative).</p>
        <p className="ph-source">{c.source}</p>
      </div>
    </Disclosure>
    <Disclosure label="Use buttons instead">
      <div className="ph-rows">
        {sortedPlan.map((cy, j) => <div className="ph-row" key={cy.i}><span>Cycle {j + 1} · day {trim(cy.day, 0)} · {trim(cy.dose * 100, 0)}%</span><span className="ph-row-btns">
          <button type="button" onClick={() => kDay(cy.i, -1)} aria-label={`Cycle ${j + 1} earlier`}>Earlier</button>
          <button type="button" onClick={() => kDay(cy.i, 1)} aria-label={`Cycle ${j + 1} later`}>Later</button>
          <button type="button" onClick={() => kDose(cy.i, -1)} aria-label={`Cycle ${j + 1} lower dose`}>−5%</button>
          <button type="button" onClick={() => kDose(cy.i, 1)} aria-label={`Cycle ${j + 1} higher dose`}>+5%</button>
          <button type="button" onClick={() => kRemove(cy.i)} disabled={s.cycles.length < 2} aria-label={`Remove cycle ${j + 1}`}>Remove</button></span></div>)}
        <div className="ph-row"><span>Spacing</span><span className="ph-row-btns"><button type="button" onClick={() => kSpace(21)}>Every 21 days</button><button type="button" onClick={() => kSpace(14)}>Every 14 days</button><button type="button" onClick={kAdd} disabled={s.cycles.length >= c.regimen.maxCycles}>Add a cycle</button></span></div>
      </div>
    </Disclosure>
    <Actions moves={ed.moves} canUndo={ed.canUndo} undo={ed.undo} reset={ed.reset} share={ed.moves ? share : undefined}>
      <button type="button" className="ph-quiet ph-gcsf" aria-pressed={s.gcsf} onClick={toggleG}>{s.gcsf ? "G-CSF support on" : "Add G-CSF support"}</button>
    </Actions>
  </Shell>;
}
