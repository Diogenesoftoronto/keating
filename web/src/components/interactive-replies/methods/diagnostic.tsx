import { useState } from "react";
import type { DiagnosticConfig, ShareSummary } from "./config";
import { atThreshold, binormalAuc, counts, faganScale, naturalFrequencies, normalPdf, readTest, type Accuracy } from "./model";
import { SourceLine } from "./dag";
import { Shell, clamp, fmt, pctSmart, textWidth, useHistory, useSvgDrag, useWidth, type Tone } from "./shared";

type DxState = { prevalence: number; sensitivity: number; specificity: number; threshold: number; guess?: number; last?: "prevalence" | "sensitivity" | "specificity" | "threshold" | "guess" };
type Payload = { kind: "b1" | "b2" | "b3" | "guess" | "threshold" | "roc" | "pre"; dy: number };
const N = 1000;
const LOW = 0.001, HIGH = 0.99;
const people = (n: number) => n.toLocaleString("en");
/** "Of the modeled positives, X are true and Y false", at a denominator where no non-zero group rounds to 0. */
export function positivesLine(a: Accuracy, cond: string) {
  const f = naturalFrequencies(a), r = readTest(a);
  const per = f.scaled ? ` per ${people(f.n)} people (at 1,000 a group would round to zero)` : "";
  return { f, r, text: `Among the modeled positives${per}, ${people(f.tp)} have ${cond} and ${people(f.fp)} don't. The exact probability is ${pctSmart(r.ppv)}.` };
}

export function DiagnosticLab({ config, onChange, onShare }: { config: DiagnosticConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const sc = config.scores;
  const start = (): DxState => {
    const t = sc ? sc.threshold : 0;
    const acc = sc ? atThreshold(sc, t) : { sensitivity: config.sensitivity!, specificity: config.specificity! };
    return { prevalence: config.prevalence, ...acc, threshold: t };
  };
  const h = useHistory(start);
  const s = h.state;
  const [status, setStatus] = useState("");
  const revealed = !config.predict || s.guess !== undefined;

  /* ---------- geometry ---------- */
  const { ref, width: W } = useWidth();
  const compact = W < 470;
  const wide = W >= 600, nomW = wide ? 190 : 0;
  const cols = compact ? 40 : 50, rows = N / cols;
  const cell = Math.max(6, Math.floor(Math.min(12.5, (W - 28 - nomW) / cols)));
  const AW = cols * cell, ax0 = wide ? 14 : Math.round((W - AW) / 2), ay0 = 46;
  const arrayBottom = ay0 + rows * cell;
  const legendY = arrayBottom + 17, rulerY = arrayBottom + (config.predict ? 66 : 58), rx0 = ax0, rx1 = ax0 + AW;
  const blockBottom = rulerY + (config.predict ? 60 : 24);
  const scoreTop = blockBottom + 22, scoreH = sc ? (compact ? 300 : 158) : 0;
  const nomTop = wide ? ay0 + 6 : (sc ? scoreTop + scoreH : blockBottom) + 30;
  const NH = wide ? Math.max(170, blockBottom - nomTop - 30) : compact ? 170 : 160;
  const H = wide ? Math.max(blockBottom, nomTop + NH + 24) + (sc ? scoreH + 30 : 8) : nomTop + NH + 46;
  const scoreTopW = wide ? Math.max(blockBottom, nomTop + NH + 24) + 22 : scoreTop;
  const distW = sc ? (compact ? W - 28 : W - 28 - 170) : 0, distX = 14, distH = 140;
  const roc = sc ? (compact ? { x: Math.round(W / 2 - 66), y: scoreTopW + distH + 34, size: 132 } : { x: W - 14 - 140, y: scoreTopW, size: 140 }) : { x: 0, y: 0, size: 0 };
  const nxPre = wide ? W - nomW + 34 : compact ? 40 : W * 0.2, nxPost = wide ? W - 36 : compact ? W - 40 : W * 0.8;
  /* Fagan: the LR axis must be exactly half-way between the outer axes, or the straight line misses the LR mark. */
  const fg = faganScale({ xPre: nxPre, xPost: nxPost, top: nomTop, height: NH, low: LOW, high: HIGH });
  const nx = { pre: nxPre, lr: fg.xLr, post: nxPost };
  const nomLabels = wide ? ["pre-test", "LR", "post-test"] : ["pre-test", "likelihood ratio", "post-test"];

  const idxPos = (i: number) => ({ x: ax0 + (i % cols) * cell, y: ay0 + Math.floor(i / cols) * cell });
  const idxAt = (x: number, y: number) => {
    const r = clamp(Math.floor((y - ay0) / cell), 0, rows - 1), c = clamp(Math.round((x - ax0) / cell), 0, cols);
    return clamp(r * cols + c, 0, N);
  };
  const tx = (v: number) => distX + ((v - sc!.min) / (sc!.max - sc!.min)) * distW;
  const vOf = (x: number) => sc!.min + ((x - distX) / distW) * (sc!.max - sc!.min);
  const yL = fg.yPre, yR = fg.yPost, yM = fg.yLr, pOfL = fg.pOfPre;

  /* ---------- moves ---------- */
  const roundP = (p: number) => clamp(Math.round(p * N) / N, 1 / N, 0.99);
  const preview = (p: Payload, x: number, y: number): DxState | null => {
    const c = counts(s);
    if (p.kind === "b2") { const sick = clamp(idxAt(x, y - p.dy), 1, 990); return { ...s, prevalence: sick / N, last: "prevalence" }; }
    if (p.kind === "b1") { const fn = clamp(idxAt(x, y - p.dy), 0, c.sick); return { ...s, sensitivity: clamp((c.sick - fn) / c.sick, 0.01, 1), last: "sensitivity" }; }
    if (p.kind === "b3") { const fp = clamp(idxAt(x, y - p.dy) - c.sick, 0, c.well); return { ...s, specificity: clamp(1 - fp / c.well, 0.01, 1), last: "specificity" }; }
    if (p.kind === "guess") return { ...s, guess: clamp(Math.round(((x - rx0) / (rx1 - rx0)) * 100) / 100, 0, 1), last: "guess" };
    if (p.kind === "pre") return { ...s, prevalence: roundP(pOfL(y)), last: "prevalence" };
    if (p.kind === "threshold" && sc) { const t = clamp(Math.round(vOf(x)), sc.min + 1, sc.max - 1); return { ...s, threshold: t, ...atThreshold(sc, t), last: "threshold" }; }
    if (p.kind === "roc" && sc) {
      let best = s.threshold, bd = Infinity;
      for (let t = sc.min + 1; t <= sc.max - 1; t++) {
        const a = atThreshold(sc, t), px = roc.x + (1 - a.specificity) * roc.size, py = roc.y + (1 - a.sensitivity) * roc.size;
        const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = t; }
      }
      return { ...s, threshold: best, ...atThreshold(sc, best), last: "threshold" };
    }
    return null;
  };
  const same = (a: DxState, b: DxState) => a.prevalence === b.prevalence && a.sensitivity === b.sensitivity && a.specificity === b.specificity && a.threshold === b.threshold && a.guess === b.guess;
  const commit = (next: DxState | null, say?: string) => {
    if (!next) return;
    if (same(next, s)) { setStatus("Nothing changed."); return; }
    h.commit(next); onChange?.(); if (say) setStatus(say);
  };
  const { svgRef, drag, begin, handlers } = useSvgDrag<Payload>(d => { if (d.moved || d.payload.kind === "guess") commit(preview(d.payload, d.x, d.y), describe(preview(d.payload, d.x, d.y))); });
  const shown = drag && (drag.moved || drag.payload.kind === "guess") ? preview(drag.payload, drag.x, drag.y) ?? s : s;
  const showRevealed = !config.predict || shown.guess !== undefined && (revealed || !drag);
  const r = readTest(shown), c = counts(shown);
  const rNow = readTest(s);
  function describe(n: DxState | null) {
    if (!n) return "";
    const rr = readTest(n);
    if (n.last === "guess") return `Your guess: ${Math.round(n.guess! * 100)}%.`;
    const f = naturalFrequencies(n);
    return `${people(f.sick)} in ${people(f.n)} have ${config.condition}; ${people(f.tp + f.fp)} test positive, ${people(f.tp)} of them truly. Positive predictive value ${pctSmart(rr.ppv)}.`;
  }

  /* ---------- words ---------- */
  const cond = config.condition, test = config.test;
  const pos = c.tp + c.fp;
  const dragLine = drag && (drag.moved || drag.payload.kind === "guess") ? (shown.last === "guess" ? `Drop to guess ${Math.round(shown.guess! * 100)}%`
    : shown.last === "prevalence" ? `Drop: ${c.sick} in 1,000 have ${cond} (${pctSmart(shown.prevalence)}). PPV becomes ${pctSmart(r.ppv)}`
      : shown.last === "sensitivity" ? `Drop: ${c.tp} of ${c.sick} cases detected (sensitivity ${pctSmart(shown.sensitivity)}). PPV ${pctSmart(r.ppv)}`
        : shown.last === "specificity" ? `Drop: ${c.fp} false alarms among ${c.well} (specificity ${pctSmart(shown.specificity)}). PPV ${pctSmart(r.ppv)}`
          : `Drop the cut-off at ${shown.threshold}: sensitivity ${pctSmart(shown.sensitivity)}, specificity ${pctSmart(shown.specificity)}, PPV ${pctSmart(r.ppv)}`) : "";

  let instruction: string, tone: Tone = "neutral";
  const start0 = start();
  /* Feedback compares with the state just before the last move, not the preset, and reads every count from the current state. */
  const before = h.prev ?? start0, rBefore = readTest(before);
  const pl = positivesLine(s, cond), fNow = pl.f, perN = fNow.scaled ? ` (per ${people(fNow.n)})` : "";
  const moved = (a: number, b: number) => (pctSmart(a) === pctSmart(b) ? `stayed at about ${pctSmart(a)}` : `went ${a > b ? "up" : "down"} from ${pctSmart(b)} to ${pctSmart(a)}`);
  if (config.predict && s.guess === undefined) {
    instruction = `Someone from this group gets a positive ${test}. Drag the flag along the bar to how likely you think it is that they have ${cond}.`;
  } else if (s.last === "guess" || (config.predict && h.moves === 1)) {
    const g = s.guess!, gap = Math.abs(g - rNow.ppv);
    if (gap <= 0.05) { tone = "good"; instruction = `Close. ${pl.text} Now drag the edges in the array and see what moves it.`; }
    else if (Math.abs(g - s.sensitivity) <= 0.1) { tone = "warn"; instruction = `You guessed ${Math.round(g * 100)}%. Your guess is near the sensitivity (${pctSmart(s.sensitivity)}). Check which probability is conditional on a positive test: sensitivity is P(positive | ${cond}); the question is P(${cond} | positive). ${pl.text}`; }
    else { tone = "warn"; instruction = `You guessed ${Math.round(g * 100)}%. ${pl.text} ${g > rNow.ppv ? (fNow.fp > fNow.tp ? "Most positives are false alarms from the much larger group without the condition: that's the base rate at work." : "The exact value is lower than your guess.") : `A positive result multiplies the pre-test odds by LR+ ${fmt(rNow.lrPos, 1)}, which moves the probability further than you guessed.`}`; }
  } else if (!h.moves) {
    instruction = sc ? `Drag the cut-off line or the point on the ROC curve. Everyone at or above the cut-off tests positive.` : `Drag the edges in the array: the one marked “${cond}” sets prevalence, “missed” sets sensitivity, “false +” sets false alarms.`;
  } else {
    if (s.last === "prevalence") { tone = "good"; instruction = `Same test, different population: at ${pctSmart(s.prevalence)} prevalence, PPV ${moved(rNow.ppv, rBefore.ppv)}. ${pl.text} Sensitivity and specificity didn't change; the base rate did.`; }
    else if (s.last === "sensitivity") { tone = "neutral"; instruction = `Sensitivity ${pctSmart(s.sensitivity)}: ${people(fNow.fn)} of ${people(fNow.sick)} cases missed${perN}. PPV ${moved(rNow.ppv, rBefore.ppv)}. ${pl.text} ${fNow.fp > fNow.tp ? "False alarms outnumber true positives here, so a positive is still more likely false than true." : "True positives outnumber false alarms here."} Sensitivity also sets how reassuring a negative is: NPV ${pctSmart(rNow.npv)}.`; }
    else if (s.last === "specificity") { tone = "good"; instruction = `Specificity ${pctSmart(s.specificity)}: ${people(fNow.fp)} false alarms among ${people(fNow.well)}${perN}, ${people(counts(before, fNow.n).fp)} before this move. PPV ${moved(rNow.ppv, rBefore.ppv)}. ${pl.text} ${fNow.fp > fNow.sick ? `False alarms outnumber everyone with ${cond}, so even a perfectly sensitive test would give more false than true positives: specificity sets what a positive means here.` : fNow.fp > fNow.tp ? "False alarms still outnumber true positives." : "True positives outnumber false alarms here."}`; }
    else { tone = "neutral"; instruction = `Cut-off ${s.threshold}${sc?.unit ? ` ${sc.unit}` : ""}: sensitivity ${pctSmart(s.sensitivity)}, specificity ${pctSmart(s.specificity)}. ${s.threshold < (sc?.threshold ?? 0) ? "Lower cut-offs catch more cases and add false alarms" : s.threshold > (sc?.threshold ?? 0) ? "Higher cut-offs cut false alarms and miss more cases" : "The original cut-off"}: ${people(fNow.fn)} missed, ${people(fNow.fp)} false alarms${perN}, PPV ${pctSmart(rNow.ppv)}.`; }
  }

  /* ---------- share ---------- */
  const touched = h.moves > 0;
  const share: ShareSummary | undefined = touched ? (() => {
    const unchanged = same(s, start0);
    const g = s.guess;
    const learner = unchanged ? `I moved things around and ended where we started: prevalence ${pctSmart(s.prevalence)}, sensitivity ${pctSmart(s.sensitivity)}, specificity ${pctSmart(s.specificity)}.`
      : config.predict && g !== undefined && h.moves === 1 ? `I guessed a ${Math.round(g * 100)}% chance of ${cond} after a positive ${test}.`
        : `With prevalence ${pctSmart(s.prevalence)}, sensitivity ${pctSmart(s.sensitivity)} and specificity ${pctSmart(s.specificity)}, a positive ${test} gives ${pctSmart(rNow.ppv)}.${g !== undefined ? ` I had guessed ${Math.round(g * 100)}%.` : ""}`;
    const bayes = `By Bayes: PPV = (${fmt(s.prevalence, 3)} × ${fmt(s.sensitivity)}) / (${fmt(s.prevalence, 3)} × ${fmt(s.sensitivity)} + ${fmt(1 - s.prevalence, 3)} × ${fmt(1 - s.specificity)}) = ${pctSmart(rNow.ppv)}.`;
    const freq = `In natural frequencies: of ${people(fNow.n)} people, ${people(fNow.sick)} have ${cond} and ${people(fNow.tp)} of them test positive; of the ${people(fNow.well)} without it, ${people(fNow.fp)} test positive anyway. So ${people(fNow.tp)} of ${people(fNow.tp + fNow.fp)}.${fNow.scaled ? " (A population of 1,000 would round a group to zero.)" : ""}`;
    const odds = `With odds: pre-test ${fmt(rNow.preOdds, 3)} × LR+ ${fmt(rNow.lrPos, 1)} = post-test ${fmt(rNow.postOddsPos, 3)}, which is ${pctSmart(rNow.postPos)}. A negative result (LR− ${fmt(rNow.lrNeg, 2)}) leaves ${pctSmart(rNow.postNeg)}.`;
    const mis = g !== undefined && Math.abs(g - s.sensitivity) <= 0.1 && Math.abs(g - rNow.ppv) > 0.05
      ? ` Your guess is near the sensitivity. Check which probability is conditional on a positive test: P(positive | ${cond}) is not P(${cond} | positive). In this teaching example, ${people(fNow.tp)} of about ${people(fNow.tp + fNow.fp)} positives${fNow.scaled ? ` per ${people(fNow.n)}` : ""} have ${cond}.${config.source?.includes("Gigerenzer") ? " (In the source study, the majority of 160 gynaecologists answered 90% or 81% before training; 21% gave the best answer, about 1 in 10.)" : ""}`
      : g !== undefined && Math.abs(g - rNow.ppv) <= 0.05 ? " Your guess was right on." : "";
    const scoreNote = sc ? ` At cut-off ${s.threshold} the binormal AUC is ${fmt(binormalAuc(sc), 2)}; the cut-off changes sensitivity and specificity, not the AUC.` : "";
    return { learner, reply: `${freq} ${bayes} ${odds}${mis}${scoreNote} The rates are illustrative teaching values, not a measured test. Educational model, not for clinical use.`.trim(),
      data: `diagnostic · prevalence ${fmt(s.prevalence, 3)} · sens ${fmt(s.sensitivity, 3)} · spec ${fmt(s.specificity, 3)}${sc ? ` · cut-off ${s.threshold}` : ""} · PPV ${fmt(rNow.ppv, 4)} · NPV ${fmt(rNow.npv, 4)} · LR+ ${fmt(rNow.lrPos, 2)} · LR− ${fmt(rNow.lrNeg, 3)}${g !== undefined ? ` · guess ${g}` : ""} · ${h.moves} moves` };
  })() : undefined;

  /* ---------- drawing ---------- */
  const dotR = Math.max(2, cell * 0.36);
  const circlePath = (idx: number[]) => idx.map(i => { const p = idxPos(i); const cx = p.x + cell / 2, cy = p.y + cell / 2; return `M${(cx - dotR).toFixed(1)} ${cy.toFixed(1)}a${dotR} ${dotR} 0 1 0 ${2 * dotR} 0a${dotR} ${dotR} 0 1 0 ${-2 * dotR} 0`; }).join("");
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const groups = showRevealed
    ? { fn: range(0, c.fn), tp: range(c.fn, c.sick), fp: range(c.sick, c.sick + c.fp), tn: range(c.sick + c.fp, N) }
    : { fn: [], tp: range(0, c.sick), fp: [], tn: range(c.sick, N) };
  const spanOutline = (i0: number, i1: number) => {
    if (i1 <= i0) return "";
    const r0 = Math.floor(i0 / cols), c0 = i0 % cols, r1 = Math.floor((i1 - 1) / cols), c1 = ((i1 - 1) % cols) + 1;
    const X = (cc: number) => ax0 + cc * cell, Y = (rr: number) => ay0 + rr * cell;
    if (r0 === r1) return `M${X(c0)} ${Y(r0)}H${X(c1)}V${Y(r0 + 1)}H${X(c0)}Z`;
    return `M${X(c0)} ${Y(r0)}H${X(cols)}V${Y(r1)}H${X(c1)}V${Y(r1 + 1)}H${X(0)}V${Y(r0 + 1)}H${X(c0)}Z`;
  };
  const handle = (kind: "b1" | "b2" | "b3", b: number, label: string, up: boolean) => {
    const p = idxPos(Math.min(b, N - 1)); const x = b === N ? ax0 + AW : p.x, y = b === N ? ay0 + (rows - 1) * cell : p.y;
    const ky = up ? y - 11 : y + cell + 11;
    const active = drag?.payload.kind === kind;
    const lx = clamp(x, ax0 + 22, ax0 + AW - 22);
    return <g key={kind} className={`ml-edgehandle is-${kind}${active ? " is-active" : ""}`} data-handle={kind}
      onPointerDown={e => begin(e, { kind, dy: (up ? -11 : cell + 11) - cell / 2 })}>
      <line x1={x} y1={y - 1} x2={x} y2={y + cell + 1} className="ml-edgehandle-bar" />
      <line x1={x} y1={up ? ky : y + cell} x2={x} y2={up ? y : ky} className="ml-edgehandle-stem" />
      <circle cx={x} cy={ky} r={6} className="ml-edgehandle-knob" />
      <text x={lx} y={up ? ky - 9 : ky + 17} textAnchor="middle" className="ml-edgehandle-label">{label}</text>
      <circle cx={x} cy={ky} r={16} className="ml-hit" />
    </g>;
  };
  const ppvX = rx0 + rNow.ppv * (rx1 - rx0);
  const guessX = shown.guess !== undefined ? rx0 + shown.guess * (rx1 - rx0) : rx0;
  const dist = sc ? (() => {
    const pts = (m: number, sd: number) => { const out: string[] = []; const peak = normalPdf(m, m, Math.min(sc.healthy.sd, sc.disease.sd)); for (let i = 0; i <= 120; i++) { const v = sc.min + (i / 120) * (sc.max - sc.min); out.push(`${tx(v).toFixed(1)},${(scoreTopW + distH - (normalPdf(v, m, sd) / peak) * (distH - 18)).toFixed(1)}`); } return out; };
    const area = (m: number, sd: number, from: number, to: number) => { const peak = normalPdf(m, m, Math.min(sc.healthy.sd, sc.disease.sd)); const a: string[] = [`M${tx(from)} ${scoreTopW + distH}`]; for (let i = 0; i <= 60; i++) { const v = from + (i / 60) * (to - from); a.push(`L${tx(v).toFixed(1)} ${(scoreTopW + distH - (normalPdf(v, m, sd) / peak) * (distH - 18)).toFixed(1)}`); } a.push(`L${tx(to)} ${scoreTopW + distH}Z`); return a.join(""); };
    const t = shown.threshold, tX = tx(t);
    const rocPts: string[] = []; for (let v = sc.min; v <= sc.max; v += (sc.max - sc.min) / 80) { const a = atThreshold(sc, v); rocPts.push(`${(roc.x + (1 - a.specificity) * roc.size).toFixed(1)},${(roc.y + (1 - a.sensitivity) * roc.size).toFixed(1)}`); }
    const px = roc.x + (1 - shown.specificity) * roc.size, py = roc.y + (1 - shown.sensitivity) * roc.size;
    return <g className="ml-scores">
      <line x1={distX} x2={distX + distW} y1={scoreTopW + distH} y2={scoreTopW + distH} className="ml-axis" />
      <path d={area(sc.healthy.mean, sc.healthy.sd, t, sc.max)} className="ml-area is-fp" />
      <path d={area(sc.disease.mean, sc.disease.sd, sc.min, t)} className="ml-area is-fn" />
      <polyline points={pts(sc.healthy.mean, sc.healthy.sd).join(" ")} className="ml-curve is-healthy" />
      <polyline points={pts(sc.disease.mean, sc.disease.sd).join(" ")} className="ml-curve is-disease" />
      <text x={tx(sc.healthy.mean)} y={scoreTopW + 10} textAnchor="middle" className="ml-small">without</text>
      <text x={tx(sc.disease.mean)} y={scoreTopW + 10} textAnchor="middle" className="ml-small is-disease">with {cond}</text>
      {[sc.min, (sc.min + sc.max) / 2, sc.max].map(v => <text key={v} x={tx(v)} y={scoreTopW + distH + 14} textAnchor={v === sc.min ? "start" : v === sc.max ? "end" : "middle"} className="ml-tick">{Math.round(v)}</text>)}
      <text x={distX + distW} y={scoreTopW + distH + 26} textAnchor="end" className="ml-tick">{sc.label}{sc.unit ? ` (${sc.unit})` : ""} · positive ≥ cut-off</text>
      <g className={`ml-threshold${drag?.payload.kind === "threshold" ? " is-active" : ""}`} data-handle="threshold" onPointerDown={e => begin(e, { kind: "threshold", dy: 0 })}>
        <line x1={tX} x2={tX} y1={scoreTopW + 4} y2={scoreTopW + distH} className="ml-threshold-line" />
        <circle cx={tX} cy={scoreTopW + 4} r={6.5} className="ml-edgehandle-knob" />
        <text x={clamp(tX, distX + 30, distX + distW - 30)} y={scoreTopW + distH - 6} textAnchor="middle" className="ml-threshold-label">cut-off {t}</text>
        <rect x={tX - 16} y={scoreTopW - 6} width={32} height={distH + 8} className="ml-hit" />
      </g>
      <g className="ml-roc">
        <rect x={roc.x} y={roc.y} width={roc.size} height={roc.size} className="ml-roc-frame" />
        <line x1={roc.x} y1={roc.y + roc.size} x2={roc.x + roc.size} y2={roc.y} className="ml-roc-chance" />
        <polyline points={rocPts.join(" ")} className="ml-curve is-roc" />
        <text x={roc.x + roc.size / 2} y={roc.y + roc.size + 13} textAnchor="middle" className="ml-tick">1 − specificity</text>
        <text x={roc.x - 5} y={roc.y + roc.size / 2} textAnchor="middle" className="ml-tick" transform={`rotate(-90 ${roc.x - 5} ${roc.y + roc.size / 2})`}>sensitivity</text>
        <text x={roc.x + roc.size - 4} y={roc.y + roc.size - 6} textAnchor="end" className="ml-tick">AUC {fmt(binormalAuc(sc), 2)}</text>
        <g className={`ml-rocpoint${drag?.payload.kind === "roc" ? " is-active" : ""}`} data-handle="roc" onPointerDown={e => begin(e, { kind: "roc", dy: 0 })}>
          <circle cx={px} cy={py} r={6.5} className="ml-edgehandle-knob" /><circle cx={px} cy={py} r={18} className="ml-hit" />
        </g>
      </g>
    </g>;
  })() : null;
  const lrTicks = [0.01, 0.1, 1, 10, 100];
  /* A straight line through pre-test and LR; an off-scale post-test probability ends in an arrow at the axis edge instead of a clipped value. */
  const faganLine = (ln: ReturnType<typeof fg.line>, cls: string, label: string, dy: number) => {
    const ang = Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1), a = 7;
    const head = `M${ln.x2} ${ln.y2}L${ln.x2 - a * Math.cos(ang - 0.45)} ${ln.y2 - a * Math.sin(ang - 0.45)}M${ln.x2} ${ln.y2}L${ln.x2 - a * Math.cos(ang + 0.45)} ${ln.y2 - a * Math.sin(ang + 0.45)}`;
    return <g className={`ml-fagan-set ${cls}`} data-fagan={cls.slice(3)} data-clipped={ln.clipped ?? undefined}>
      <line x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} className={`ml-fagan ${cls}`} />
      {ln.clipped ? <path d={head} className={`ml-fagan ${cls}`} /> : <circle cx={ln.x2} cy={ln.y2} r={cls === "is-pos" ? 4 : 0} className="ml-fagan-dot is-pos" />}
      <text x={nx.post - 8} y={ln.y2 + (ln.clipped === "top" ? 13 : ln.clipped === "bottom" ? -6 : dy)} textAnchor="end" className={`ml-fagan-label${cls === "is-pos" ? " is-pos" : ""}`}>{label}{ln.clipped ? " (off scale)" : ""}</text>
    </g>;
  };
  const pTicks = [0.001, 0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99];
  const nom = <g className="ml-nomogram">
    <text x={nx.pre} y={nomTop - 8} textAnchor="middle" className="ml-small">{nomLabels[0]}</text>
    <text x={nx.lr} y={nomTop - 8} textAnchor="middle" className="ml-small">{nomLabels[1]}</text>
    <text x={nx.post} y={nomTop - 8} textAnchor="middle" className="ml-small">{nomLabels[2]}</text>
    {[nx.pre, nx.lr, nx.post].map((x, i) => <line key={i} x1={x} x2={x} y1={nomTop} y2={nomTop + NH} className="ml-axis" />)}
    {pTicks.map(p => <g key={p}><line x1={nx.pre - 4} x2={nx.pre} y1={yL(p)} y2={yL(p)} className="ml-axis" /><text x={nx.pre - 7} y={yL(p) + 3.5} textAnchor="end" className="ml-tick">{p * 100 < 1 ? (p * 100).toFixed(1) : Math.round(p * 100)}</text>
      <line x1={nx.post} x2={nx.post + 4} y1={yR(p)} y2={yR(p)} className="ml-axis" /><text x={nx.post + 7} y={yR(p) + 3.5} className="ml-tick">{p * 100 < 1 ? (p * 100).toFixed(1) : Math.round(p * 100)}</text></g>)}
    {lrTicks.map(lr => <g key={lr}><line x1={nx.lr - 4} x2={nx.lr + 4} y1={yM(lr)} y2={yM(lr)} className="ml-axis" /><text x={nx.lr + 7} y={yM(lr) + 3.5} className="ml-tick">{lr}</text></g>)}
    {showRevealed && <>
      {faganLine(fg.line(clamp(shown.prevalence, LOW, HIGH), r.lrPos), "is-pos", `+ ${pctSmart(r.postPos)}`, -6)}
      {faganLine(fg.line(clamp(shown.prevalence, LOW, HIGH), r.lrNeg), "is-neg", `− ${pctSmart(r.postNeg)}`, 13)}
    </>}
    <g className={`ml-prehandle${drag?.payload.kind === "pre" ? " is-active" : ""}`} data-handle="pre" onPointerDown={e => begin(e, { kind: "pre", dy: 0 })}>
      <circle cx={nx.pre} cy={yL(clamp(shown.prevalence, LOW, HIGH))} r={6.5} className="ml-edgehandle-knob" />
      <text x={nx.pre + 10} y={yL(clamp(shown.prevalence, LOW, HIGH)) + 4} className="ml-fagan-label">{pctSmart(shown.prevalence)}</text>
      <circle cx={nx.pre} cy={yL(clamp(shown.prevalence, LOW, HIGH))} r={18} className="ml-hit" />
    </g>
  </g>;
  const canvas = <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="ml-svg" {...handlers} role="img"
    aria-label={`Icon array of 1,000 ${config.population}: ${c.sick} have ${cond}.${showRevealed ? ` ${pos} test positive, ${c.tp} of them with ${cond}.` : ""}`}>
    <text x={ax0} y={15} className="ml-small">1,000 {config.population}</text>
    <path d={circlePath(groups.tn)} className="ml-dot is-tn" />
    <path d={circlePath(groups.fp)} className="ml-dot is-fp" />
    <path d={circlePath(groups.tp)} className="ml-dot is-tp" />
    <path d={circlePath(groups.fn)} className="ml-dot is-fn" />
    {showRevealed && <path d={spanOutline(c.fn, c.sick + c.fp)} className="ml-positives" />}
    {showRevealed && !sc && handle("b1", c.fn, "missed", false)}
    {handle("b2", showRevealed ? c.sick : c.sick, cond.length > 14 ? "cases" : cond, true)}
    {showRevealed && !sc && handle("b3", c.sick + c.fp, "false +", c.sick + c.fp - c.sick > 60 || compact ? true : false)}
    <g className="ml-legend" transform={`translate(${ax0} ${legendY})`}>
      {(() => { const items = showRevealed ? [["is-tp", `${c.tp} true +`], ["is-fn", `${c.fn} missed`], ["is-fp", `${c.fp} false +`], ["is-tn", `${c.tn} true −`]] : [["is-tp", `${c.sick} with ${cond}`], ["is-tn", `${c.well} without`]];
        let x = 0; return items.map(([k, t]) => { const at = x; x += textWidth(t, 11) + 26; return <g key={k} transform={`translate(${at} 0)`}><circle cx={4} cy={-4} r={4} className={`ml-dot ${k}`} /><text x={12} y={0} className="ml-small">{t}</text></g>; }); })()}
    </g>
    <g className="ml-ruler">
      <line x1={rx0} x2={rx1} y1={rulerY} y2={rulerY} className="ml-axis" />
      {[0, 0.25, 0.5, 0.75, 1].map(v => <text key={v} x={rx0 + v * (rx1 - rx0)} y={rulerY + 15} textAnchor="middle" className="ml-tick">{v * 100}%</text>)}
      <text x={rx0} y={rulerY - 22} className="ml-small">P({cond} | positive result)</text>
      {showRevealed && <g className="ml-ppv-mark"><line x1={ppvX} x2={ppvX} y1={rulerY - 9} y2={rulerY + 4} /><text x={clamp(ppvX, rx0 + 30, rx1 - 30)} y={rulerY - 12} textAnchor="middle">PPV {pctSmart(rNow.ppv)}</text></g>}
      {showRevealed && config.predict && <g className="ml-sens-mark"><line x1={rx0 + s.sensitivity * (rx1 - rx0)} x2={rx0 + s.sensitivity * (rx1 - rx0)} y1={rulerY - 5} y2={rulerY + 4} /></g>}
      {config.predict && <g className={`ml-guess${drag?.payload.kind === "guess" ? " is-active" : ""}`} data-handle="guess" onPointerDown={e => begin(e, { kind: "guess", dy: 0 })}>
        <line x1={guessX} x2={guessX} y1={rulerY - 2} y2={rulerY + 32} className="ml-guess-pole" />
        <path d={`M${guessX} ${rulerY + 32} l12 5 l-12 5 Z`} className={`ml-guess-flag${shown.guess === undefined ? " is-parked" : ""}`} />
        <text x={clamp(guessX, rx0 + 30, rx1 - 30)} y={rulerY + 54} textAnchor="middle" className="ml-guess-label">{shown.guess !== undefined ? `your guess ${Math.round(shown.guess * 100)}%` : "drag to guess"}</text>
        <rect x={guessX - 16} y={rulerY - 12} width={34} height={58} className="ml-hit" />
      </g>}
    </g>
    {dist}
    {nom}
  </svg>;

  const below = <dl className="ml-facts">
    <div className="ml-fact"><dt>Positive predictive value</dt><dd>{revealed ? <>{people(fNow.tp)} of {people(fNow.tp + fNow.fp)} positives{fNow.scaled ? ` per ${people(fNow.n)}` : ""} = <b>{pctSmart(rNow.ppv)}</b></> : "after your guess"}</dd></div>
    <div className="ml-fact"><dt>Negative predictive value</dt><dd>{revealed ? <>{people(fNow.tn)} of {people(fNow.tn + fNow.fn)} negatives{fNow.scaled ? ` per ${people(fNow.n)}` : ""} = {pctSmart(rNow.npv)}</> : "after your guess"}</dd></div>
    <div className="ml-fact"><dt>Sensitivity · specificity</dt><dd>{pctSmart(s.sensitivity)} · {pctSmart(s.specificity)}</dd></div>
    <div className="ml-fact"><dt>Likelihood ratios</dt><dd>LR+ {fmt(rNow.lrPos, 1)} · LR− {fmt(rNow.lrNeg, 2)}</dd></div>
  </dl>;

  const setRate = (k: "prevalence" | "sensitivity" | "specificity", v: number) => commit({ ...s, [k]: k === "prevalence" ? roundP(v) : clamp(v, 0.01, 1), last: k }, `${k} ${pctSmart(v)}.`);
  const controls = <>
    {config.predict && <div className="ml-control-row"><label className="ml-select">My guess
      <select aria-label="My guess" value={s.guess === undefined ? "" : String(Math.round(s.guess * 100))} onChange={e => commit({ ...s, guess: Number(e.currentTarget.value) / 100, last: "guess" }, `Your guess: ${e.currentTarget.value}%.`)}>
        <option value="" disabled>not yet</option>{Array.from({ length: 21 }, (_, i) => i * 5).map(v => <option key={v} value={v}>{v}%</option>)}
      </select></label></div>}
    <div className="ml-control-row">
      <NumberField label="Prevalence %" value={s.prevalence * 100} min={0.1} max={99} step={0.1} onSet={v => setRate("prevalence", v / 100)} />
      {!sc && <NumberField label="Sensitivity %" value={s.sensitivity * 100} min={1} max={100} step={1} onSet={v => setRate("sensitivity", v / 100)} disabled={!revealed} />}
      {!sc && <NumberField label="Specificity %" value={s.specificity * 100} min={1} max={100} step={1} onSet={v => setRate("specificity", v / 100)} disabled={!revealed} />}
      {sc && <NumberField label="Cut-off" value={s.threshold} min={sc.min + 1} max={sc.max - 1} step={1} onSet={v => commit({ ...s, threshold: Math.round(v), ...atThreshold(sc, Math.round(v)), last: "threshold" }, `Cut-off ${Math.round(v)}.`)} />}
    </div>
  </>;

  return <Shell mode="diagnostic" title={config.title} count={revealed ? `PPV ${pctSmart(rNow.ppv)}` : "guess first"} canvasRef={ref} dragging={!!drag && (drag.moved || drag.payload.kind === "guess")}
    dragLine={dragLine} canvas={canvas} below={below} instruction={instruction} tone={tone} controls={controls} status={status}
    share={share} onShare={onShare} canUndo={h.canUndo} onUndo={() => { h.undo(); onChange?.(); setStatus("Undone."); }} acted={touched}
    onReset={() => { h.reset(); onChange?.(); setStatus("Back to the start."); }}
    caption={<SourceLine text={`Educational model, not for clinical use.${config.source ? ` ${config.source}` : ""}`} />} />;
}

export function NumberField({ label, value, min, max, step, onSet, disabled }: { label: string; value: number; min: number; max: number; step: number; onSet: (v: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shownVal = draft ?? String(Math.round(value / step) * step >= 100 ? Math.round(value) : +value.toFixed(step < 1 ? 1 : 0));
  return <label className="ml-select">{label}
    <input type="number" inputMode="decimal" aria-label={label} min={min} max={max} step={step} value={shownVal} disabled={disabled}
      onChange={e => setDraft(e.currentTarget.value)}
      onBlur={() => { if (draft !== null) { const v = Number(draft); setDraft(null); if (Number.isFinite(v)) onSet(clamp(v, min, max)); } }}
      onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
  </label>;
}

