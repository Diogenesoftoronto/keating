/* MethodsLab model: pure functions, no DOM, no React. Everything here is unit-tested in unit.test.ts.
   - DAG: d-separation by path enumeration, Pearl's backdoor criterion, minimal sufficient adjustment sets.
   - Diagnostic: Bayes' theorem, likelihood ratios, binormal score model and ROC.
   - Survival: Kaplan–Meier product-limit, median, log-rank, Cox (Efron ties) for one binary covariate.
   - Meta-analysis: inverse-variance fixed effect, DerSimonian–Laird and REML random effects, I², Egger. */

/* =============================== Causal diagrams =============================== */
export type Edge = { from: string; to: string };
export type Graph = { nodes: string[]; edges: Edge[] };
export type Step = { from: string; to: string; forward: boolean }; // forward = edge points along the walk
export type PathKind = "causal" | "backdoor" | "noncausal";
export type PathInfo = {
  nodes: string[];
  steps: Step[];
  kind: PathKind;
  colliders: string[];
  open: boolean;
  /** Non-colliders on the path that are adjusted for (each blocks it). */
  blockedBy: string[];
  /** Colliders on the path that are closed because neither they nor a descendant is adjusted for. */
  closedAt: string[];
  /** Colliders that are open only because they (or a descendant) are adjusted for. */
  openedBy: string[];
};

const key = (e: Edge) => `${e.from}>${e.to}`;
export const hasEdge = (g: Graph, a: string, b: string) => g.edges.some(e => e.from === a && e.to === b);
export const children = (g: Graph, v: string) => g.edges.filter(e => e.from === v).map(e => e.to);
export const parents = (g: Graph, v: string) => g.edges.filter(e => e.to === v).map(e => e.from);

export function descendants(g: Graph, v: string): Set<string> {
  const out = new Set<string>(); const stack = [...children(g, v)];
  while (stack.length) { const x = stack.pop()!; if (out.has(x)) continue; out.add(x); stack.push(...children(g, x)); }
  return out;
}
export function ancestors(g: Graph, v: string): Set<string> {
  const out = new Set<string>(); const stack = [...parents(g, v)];
  while (stack.length) { const x = stack.pop()!; if (out.has(x)) continue; out.add(x); stack.push(...parents(g, x)); }
  return out;
}
/** True when adding a → b would create a directed cycle (b already reaches a). */
export const makesCycle = (g: Graph, a: string, b: string) => a === b || descendants(g, b).has(a);
export function isAcyclic(g: Graph): boolean {
  return g.nodes.every(v => !descendants(g, v).has(v));
}

/** Every simple path between x and y in the skeleton (direction ignored), with each step's direction. */
export function allPaths(g: Graph, x: string, y: string): Step[][] {
  const out: Step[][] = [];
  const walk = (v: string, seen: Set<string>, steps: Step[]) => {
    if (v === y) { out.push(steps.slice()); return; }
    for (const e of g.edges) {
      let next: string | undefined, forward = true;
      if (e.from === v) next = e.to; else if (e.to === v) { next = e.from; forward = false; }
      if (next === undefined || seen.has(next)) continue;
      seen.add(next); steps.push({ from: v, to: next, forward });
      walk(next, seen, steps);
      steps.pop(); seen.delete(next);
    }
  };
  walk(x, new Set([x]), []);
  return out;
}

export function describePath(g: Graph, steps: Step[], z: Set<string>): PathInfo {
  const nodes = [steps[0].from, ...steps.map(s => s.to)];
  const colliders: string[] = [], blockedBy: string[] = [], closedAt: string[] = [], openedBy: string[] = [];
  for (let i = 1; i < nodes.length - 1; i++) {
    const v = nodes[i];
    const intoFromLeft = steps[i - 1].forward;   // prev → v
    const intoFromRight = !steps[i].forward;     // v ← next
    if (intoFromLeft && intoFromRight) {
      colliders.push(v);
      const activated = z.has(v) || [...descendants(g, v)].some(d => z.has(d));
      if (activated) openedBy.push(v); else closedAt.push(v);
    } else if (z.has(v)) blockedBy.push(v);
  }
  const kind: PathKind = steps.every(s => s.forward) ? "causal" : !steps[0].forward ? "backdoor" : "noncausal";
  return { nodes, steps, kind, colliders, open: blockedBy.length === 0 && closedAt.length === 0, blockedBy, closedAt, openedBy };
}

export function pathsBetween(g: Graph, x: string, y: string, z: Set<string>): PathInfo[] {
  const order: Record<PathKind, number> = { causal: 0, backdoor: 1, noncausal: 2 };
  return allPaths(g, x, y).map(p => describePath(g, p, z))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.nodes.length - b.nodes.length);
}

/** d-separation of x and y given z, by path enumeration. */
export const dSeparated = (g: Graph, x: string, y: string, z: Set<string>) =>
  allPaths(g, x, y).every(p => !describePath(g, p, z).open);

export type BackdoorCheck = { ok: boolean; descendantsAdjusted: string[]; openBackdoor: PathInfo[] };
/** Pearl's backdoor criterion: no member of Z is a descendant of X, and Z blocks every path with an arrow into X. */
export function backdoor(g: Graph, x: string, y: string, z: Set<string>): BackdoorCheck {
  const desc = descendants(g, x);
  const descendantsAdjusted = [...z].filter(v => desc.has(v));
  const openBackdoor = pathsBetween(g, x, y, z).filter(p => p.kind === "backdoor" && p.open);
  return { ok: descendantsAdjusted.length === 0 && openBackdoor.length === 0, descendantsAdjusted, openBackdoor };
}

/** All minimal sufficient adjustment sets drawn from `candidates` (default: every node but x and y).
    Descendants of x are never candidates. Sorted smallest first, then alphabetically by node order. */
export function minimalSets(g: Graph, x: string, y: string, candidates?: string[]): string[][] {
  const desc = descendants(g, x);
  const pool = (candidates ?? g.nodes).filter(v => v !== x && v !== y && !desc.has(v));
  if (pool.length > 14) throw new Error("too many candidates");
  const ok: number[] = [];
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const z = new Set(pool.filter((_, i) => mask & (1 << i)));
    if (backdoor(g, x, y, z).ok) ok.push(mask);
  }
  const minimal = ok.filter(m => !ok.some(o => o !== m && (o & m) === o));
  const bits = (m: number) => pool.filter((_, i) => m & (1 << i));
  return minimal.map(bits).sort((a, b) => a.length - b.length || pool.indexOf(a[0] ?? "") - pool.indexOf(b[0] ?? ""));
}

export type Role = "common cause" | "mediator" | "collider" | "descendant of exposure" | "cause of outcome" | "cause of exposure";
/** Structural roles of v relative to exposure x and outcome y in the current graph. */
export function rolesOf(g: Graph, v: string, x: string, y: string): Role[] {
  if (v === x || v === y) return [];
  const roles: Role[] = [];
  const descX = descendants(g, x), ancY = ancestors(g, y);
  const gNoX: Graph = { nodes: g.nodes, edges: g.edges.filter(e => e.from !== x && e.to !== x) };
  const reachesYAvoidingX = descendants(gNoX, v).has(y);
  const ancX = ancestors(g, x);
  if (ancX.has(v) && reachesYAvoidingX) roles.push("common cause");
  if (descX.has(v) && ancY.has(v)) roles.push("mediator");
  if (allPaths(g, x, y).some(p => describePath(g, p, new Set()).colliders.includes(v))) roles.push("collider");
  if (!roles.length) {
    if (descX.has(v)) roles.push("descendant of exposure");
    else if (ancX.has(v)) roles.push("cause of exposure");
    else if (ancY.has(v)) roles.push("cause of outcome");
  }
  return roles;
}

/** Diagnosis of an adjustment set, in the categories an epidemiologist uses. */
export type DagDiagnosis = {
  paths: PathInfo[];
  ok: boolean;                      // backdoor criterion holds
  openBackdoor: PathInfo[];         // confounding left (open via unadjusted forks/chains)
  collideredBackdoor: PathInfo[];   // backdoor paths open only because a collider was adjusted
  openedNoncausal: PathInfo[];      // non-backdoor non-causal paths opened by adjusting a collider (selection bias)
  blockedCausal: PathInfo[];        // causal paths blocked by adjusting a mediator (overadjustment)
  descendantsAdjusted: string[];
  minimal: string[][];              // minimal sufficient sets among measured variables
  minimalAny: string[][];           // minimal sufficient sets if every variable were measured
};
export function diagnose(g: Graph, x: string, y: string, z: Set<string>, measured: string[]): DagDiagnosis {
  const paths = pathsBetween(g, x, y, z);
  const bd = backdoor(g, x, y, z);
  const openBD = paths.filter(p => p.kind === "backdoor" && p.open);
  return {
    paths, ok: bd.ok,
    openBackdoor: openBD.filter(p => p.openedBy.length === 0),
    collideredBackdoor: openBD.filter(p => p.openedBy.length > 0),
    openedNoncausal: paths.filter(p => p.kind === "noncausal" && p.open),
    blockedCausal: paths.filter(p => p.kind === "causal" && !p.open),
    descendantsAdjusted: bd.descendantsAdjusted,
    minimal: minimalSets(g, x, y, measured),
    minimalAny: minimalSets(g, x, y),
  };
}
export const edgeKey = key;

/* ================================ Diagnostic tests ================================ */
/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
export const normalPdf = (x: number, m: number, s: number) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
export type Accuracy = { prevalence: number; sensitivity: number; specificity: number };
export type TestReading = Accuracy & {
  ppv: number; npv: number; lrPos: number; lrNeg: number;
  preOdds: number; postOddsPos: number; postOddsNeg: number; postPos: number; postNeg: number;
};
export function readTest(a: Accuracy): TestReading {
  const { prevalence: p, sensitivity: se, specificity: sp } = a;
  const tp = p * se, fp = (1 - p) * (1 - sp), fn = p * (1 - se), tn = (1 - p) * sp;
  const lrPos = (1 - sp) > 0 ? se / (1 - sp) : Infinity;
  const lrNeg = sp > 0 ? (1 - se) / sp : Infinity;
  const preOdds = p / (1 - p);
  const postOddsPos = preOdds * lrPos, postOddsNeg = preOdds * lrNeg;
  return {
    ...a, ppv: tp + fp > 0 ? tp / (tp + fp) : 0, npv: tn + fn > 0 ? tn / (tn + fn) : 0, lrPos, lrNeg, preOdds, postOddsPos, postOddsNeg,
    postPos: Number.isFinite(postOddsPos) ? postOddsPos / (1 + postOddsPos) : 1, postNeg: postOddsNeg / (1 + postOddsNeg),
  };
}
/** Natural-frequency counts in a population of n (rounded the way an icon array must be). */
export function counts(a: Accuracy, n = 1000) {
  const sick = Math.round(a.prevalence * n);
  const tp = Math.round(a.sensitivity * sick);
  const fp = Math.round((1 - a.specificity) * (n - sick));
  return { n, sick, well: n - sick, tp, fn: sick - tp, fp, tn: n - sick - fp };
}
/**
 * Counts at the smallest denominator (1,000, 10,000, …) at which no cell with a non-zero expected count rounds to 0,
 * so the rounded people can never contradict the exact probability (e.g. "0 of 90 positives" while PPV is 0.4%).
 */
export function naturalFrequencies(a: Accuracy) {
  const { prevalence: p, sensitivity: se, specificity: sp } = a;
  const ex = { tp: p * se, fn: p * (1 - se), fp: (1 - p) * (1 - sp), tn: (1 - p) * sp };
  for (let n = 1000; n <= 1e7; n *= 10) {
    const c = counts(a, n);
    if ((["tp", "fn", "fp", "tn"] as const).every(k => ex[k] <= 0 || c[k] > 0)) return { ...c, scaled: n > 1000 };
  }
  return { ...counts(a, 1e7), scaled: true };
}
/**
 * Fagan nomogram geometry. Pre-test probability on the left (logit scale, low at the top), post-test on the right
 * (reversed), likelihood ratio on the middle axis at half scale. The middle axis must sit exactly half-way between the
 * outer two for a straight line through pre-test and LR to land on the post-test probability (Fagan, NEJM 1975).
 */
export function faganScale(g: { xPre: number; xPost: number; top: number; height: number; low: number; high: number }) {
  const range = logit(g.high) - logit(g.low), k = g.height / range;
  const xLr = (g.xPre + g.xPost) / 2;
  const yPre = (p: number) => g.top + (logit(p) - logit(g.low)) * k;
  const yPostOfLogit = (z: number) => g.top + (logit(g.high) - z) * k;
  const yPost = (p: number) => yPostOfLogit(logit(p));
  const yLr = (lr: number) => g.top + g.height / 2 - (k / 2) * Math.log(lr);
  /** The straight line from the pre-test point through the LR mark. Off-scale post-test odds end at the axis edge with clipped = "top" | "bottom". */
  const line = (pre: number, lr: number) => {
    const x1 = g.xPre, y1 = yPre(pre);
    const z = clamp(logit(pre) + Math.log(lr), -40, 40); // LR 0 or ∞ give ±∞
    const yRaw = yPostOfLogit(z), y0 = g.top, yB = g.top + g.height;
    if (yRaw >= y0 && yRaw <= yB) return { x1, y1, x2: g.xPost, y2: yRaw, clipped: null as null | "top" | "bottom" };
    const yEnd = yRaw < y0 ? y0 : yB, t = (yEnd - y1) / (yRaw - y1);
    return { x1, y1, x2: x1 + t * (g.xPost - x1), y2: yEnd, clipped: (yRaw < y0 ? "top" : "bottom") as null | "top" | "bottom" };
  };
  return { xLr, yPre, yPost, yLr, line, pOfPre: (y: number) => expit(logit(g.low) + (y - g.top) / k) };
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export type Binormal = { healthy: { mean: number; sd: number }; disease: { mean: number; sd: number } };
/** Sensitivity and specificity at threshold t, positive when score ≥ t. */
export const atThreshold = (b: Binormal, t: number) => ({
  sensitivity: 1 - phi((t - b.disease.mean) / b.disease.sd),
  specificity: phi((t - b.healthy.mean) / b.healthy.sd),
});
/** Binormal AUC = Φ((μ1 − μ0) / √(σ0² + σ1²)). */
export const binormalAuc = (b: Binormal) => phi((b.disease.mean - b.healthy.mean) / Math.hypot(b.healthy.sd, b.disease.sd));
export const logit = (p: number) => Math.log(p / (1 - p));
export const expit = (x: number) => 1 / (1 + Math.exp(-x));

/* =================================== Survival =================================== */
export type SurvObs = { time: number; event: boolean };
export type KmRow = { time: number; atRisk: number; events: number; censored: number; survival: number; se: number };
/** Kaplan–Meier product-limit estimate. Ties: events at t happen before censorings at t
    (censored-at-t subjects are still at risk at t). Greenwood standard errors. */
export function kaplanMeier(obs: SurvObs[]): KmRow[] {
  const times = [...new Set(obs.map(o => o.time))].sort((a, b) => a - b);
  let s = 1, gw = 0; const rows: KmRow[] = [];
  for (const t of times) {
    const atRisk = obs.filter(o => o.time >= t).length;
    const events = obs.filter(o => o.time === t && o.event).length;
    const censored = obs.filter(o => o.time === t && !o.event).length;
    if (events > 0) {
      s *= 1 - events / atRisk;
      if (atRisk > events) gw += events / (atRisk * (atRisk - events));
    }
    rows.push({ time: t, atRisk, events, censored, survival: s, se: s * Math.sqrt(gw) });
  }
  return rows;
}
/** Survival just after time t (right-continuous step function). */
export function survivalAt(rows: KmRow[], t: number): number {
  let s = 1; for (const r of rows) { if (r.time <= t) s = r.survival; else break; } return s;
}
/** Median survival: the smallest time at which S(t) ≤ 0.5; null when the curve never gets there. */
export function medianSurvival(rows: KmRow[]): number | null {
  const r = rows.find(row => row.events > 0 && row.survival <= 0.5 + 1e-12);
  return r ? r.time : null;
}
export type LogRank = { o: [number, number]; e: [number, number]; variance: number; chi2: number; p: number };
/** Two-group log-rank test (group 0 vs 1). */
export function logRank(a: SurvObs[], b: SurvObs[]): LogRank {
  const all = [...a.map(o => ({ ...o, g: 0 })), ...b.map(o => ({ ...o, g: 1 }))];
  const times = [...new Set(all.filter(o => o.event).map(o => o.time))].sort((x, y) => x - y);
  let o0 = 0, e0 = 0, o1 = 0, e1 = 0, v = 0;
  for (const t of times) {
    const n0 = all.filter(o => o.g === 0 && o.time >= t).length, n1 = all.filter(o => o.g === 1 && o.time >= t).length;
    const d0 = all.filter(o => o.g === 0 && o.time === t && o.event).length, d1 = all.filter(o => o.g === 1 && o.time === t && o.event).length;
    const n = n0 + n1, d = d0 + d1;
    o0 += d0; o1 += d1; e0 += d * n0 / n; e1 += d * n1 / n;
    if (n > 1) v += d * (n0 / n) * (n1 / n) * (n - d) / (n - 1);
  }
  const chi2 = v > 0 ? (o0 - e0) ** 2 / v : 0;
  return { o: [o0, o1], e: [e0, e1], variance: v, chi2, p: chiSq1P(chi2) };
}
/** Upper tail of chi-square with 1 df = 2(1 − Φ(√x)). */
export const chiSq1P = (x: number) => 2 * (1 - phi(Math.sqrt(Math.max(0, x))));

export type CoxFit = { beta: number; se: number; hr: number; lo: number; hi: number; converged: boolean };
/** Cox proportional hazards with one binary covariate (1 = `treated`), Efron or Breslow ties, Newton–Raphson. */
export function coxBinary(control: SurvObs[], treated: SurvObs[], ties: "efron" | "breslow" = "efron"): CoxFit | null {
  const all = [...control.map(o => ({ ...o, x: 0 })), ...treated.map(o => ({ ...o, x: 1 }))];
  const times = [...new Set(all.filter(o => o.event).map(o => o.time))].sort((a, b) => a - b);
  if (!times.length || !control.some(o => o.event) && !treated.some(o => o.event)) return null;
  let beta = 0, info = 0, converged = false;
  for (let it = 0; it < 60; it++) {
    let u = 0; info = 0;
    const eb = Math.exp(beta);
    for (const t of times) {
      const risk = all.filter(o => o.time >= t), dead = all.filter(o => o.time === t && o.event);
      const d = dead.length;
      const s0 = risk.reduce((acc, o) => acc + (o.x ? eb : 1), 0), s1 = risk.reduce((acc, o) => acc + (o.x ? eb : 0), 0);
      const d0 = dead.reduce((acc, o) => acc + (o.x ? eb : 1), 0), d1 = dead.reduce((acc, o) => acc + (o.x ? eb : 0), 0);
      u += dead.reduce((acc, o) => acc + o.x, 0);
      for (let l = 0; l < d; l++) {
        const f = ties === "efron" ? l / d : 0;
        const den = s0 - f * d0, num = s1 - f * d1; // binary x: S2 = S1
        u -= num / den;
        info += num / den - (num / den) ** 2;
      }
    }
    if (info <= 1e-12) return null; // no information (e.g. one arm empty)
    const stepB = u / info;
    beta += Math.max(-5, Math.min(5, stepB));
    if (Math.abs(stepB) < 1e-10) { converged = true; break; }
    if (Math.abs(beta) > 20) return null; // monotone likelihood: an arm with no events
  }
  const se = 1 / Math.sqrt(info);
  return { beta, se, hr: Math.exp(beta), lo: Math.exp(beta - 1.959964 * se), hi: Math.exp(beta + 1.959964 * se), converged };
}

/* ================================ Meta-analysis ================================ */
export type StudyEffect = { y: number; v: number };
export type Pooled = { y: number; se: number; lo: number; hi: number; w: number[] };
export type MetaFit = {
  k: number; fixed: Pooled; random: Pooled; q: number; df: number; pQ: number; i2: number; tau2: number;
};
/** Log risk ratio and its variance from a 2×2 table; adds 0.5 to every cell when any cell is zero. */
export function logRR(e1: number, n1: number, e2: number, n2: number): StudyEffect {
  let a = e1, b = n1 - e1, c = e2, d = n2 - e2;
  if ([a, b, c, d].some(x => x === 0)) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
  return { y: Math.log((a / (a + b)) / (c / (c + d))), v: 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d) };
}
export function logOR(e1: number, n1: number, e2: number, n2: number): StudyEffect {
  let a = e1, b = n1 - e1, c = e2, d = n2 - e2;
  if ([a, b, c, d].some(x => x === 0)) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; }
  return { y: Math.log((a * d) / (b * c)), v: 1 / a + 1 / b + 1 / c + 1 / d };
}
function pool(s: StudyEffect[], tau2: number): Pooled {
  const w = s.map(x => 1 / (x.v + tau2)), sw = w.reduce((a, b) => a + b, 0);
  const y = s.reduce((acc, x, i) => acc + w[i] * x.y, 0) / sw, se = Math.sqrt(1 / sw);
  return { y, se, lo: y - 1.959964 * se, hi: y + 1.959964 * se, w: w.map(x => x / sw) };
}
/** Inverse-variance fixed effect + random effects (DerSimonian–Laird by default, or REML). */
export function metaAnalyse(s: StudyEffect[], method: "DL" | "REML" = "DL"): MetaFit {
  const k = s.length;
  const fixed = pool(s, 0);
  const w = s.map(x => 1 / x.v), sw = w.reduce((a, b) => a + b, 0), sw2 = w.reduce((a, b) => a + b * b, 0);
  const q = s.reduce((acc, x, i) => acc + w[i] * (x.y - fixed.y) ** 2, 0), df = k - 1;
  let tau2 = k > 1 ? Math.max(0, (q - df) / (sw - sw2 / sw)) : 0;
  if (method === "REML" && k > 1) tau2 = remlTau2(s, tau2);
  return { k, fixed, random: pool(s, tau2), q, df, pQ: df > 0 ? chiSqP(q, df) : 1, i2: q > 0 && df > 0 ? Math.max(0, (q - df) / q) : 0, tau2 };
}
/** REML τ² by Fisher scoring (Viechtbauer 2005), started from DL. */
function remlTau2(s: StudyEffect[], start: number): number {
  let t = start;
  for (let it = 0; it < 200; it++) {
    const w = s.map(x => 1 / (x.v + t)), sw = w.reduce((a, b) => a + b, 0);
    const mu = s.reduce((acc, x, i) => acc + w[i] * x.y, 0) / sw;
    const num = s.reduce((acc, x, i) => acc + w[i] ** 2 * ((x.y - mu) ** 2 - x.v), 0);
    const next = Math.max(0, num / s.reduce((acc, _, i) => acc + w[i] ** 2, 0) + 1 / sw);
    if (Math.abs(next - t) < 1e-12) return next;
    t = next;
  }
  return t;
}
/** Egger's regression test: regress y/se on 1/se; intercept ≠ 0 suggests small-study effects. */
export function egger(s: StudyEffect[]): { intercept: number; se: number; t: number; df: number; p: number } | null {
  const k = s.length; if (k < 3) return null;
  const X = s.map(x => 1 / Math.sqrt(x.v)), Y = s.map(x => x.y / Math.sqrt(x.v));
  const mx = X.reduce((a, b) => a + b, 0) / k, my = Y.reduce((a, b) => a + b, 0) / k;
  const sxx = X.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const slope = X.reduce((a, x, i) => a + (x - mx) * (Y[i] - my), 0) / sxx, intercept = my - slope * mx;
  const rss = Y.reduce((a, y, i) => a + (y - intercept - slope * X[i]) ** 2, 0), df = k - 2;
  const se = Math.sqrt((rss / df) * (1 / k + mx * mx / sxx));
  const t = se > 0 ? intercept / se : 0;
  return { intercept, se, t, df, p: se > 0 ? 2 * (1 - tCdf(Math.abs(t), df)) : 1 };
}
/* Student t and chi-square tails via the regularised incomplete beta / gamma (Numerical Recipes). */
function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015; for (const v of c) ser += v / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - (a + b) * x / (a + 1); if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export const tCdf = (t: number, df: number) => { const x = df / (df + t * t); const tail = 0.5 * betai(df / 2, 0.5, x); return t >= 0 ? 1 - tail : tail; };
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; } return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)); }
  let b = x + 1 - a, c = 1e30, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30; c = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-14) break; }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
export const chiSqP = (x: number, df: number) => gammaQ(df / 2, x / 2);
