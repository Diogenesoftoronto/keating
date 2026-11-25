/* DataExplorer model: config type, validation, aggregation and the statistician's reading of a layout.
   Pure functions only, so the component and the test hook agree on every number. */

export type FieldSpec = {
  label: string;
  role: "dimension" | "measure";
  /** Category order for a dimension. Defaults to first appearance in `rows`. */
  values?: string[];
  /** Unit for a measure, used in prose ("points", "kg"). */
  unit?: string;
  digits?: number;
};
export type MeasureSpec =
  | { kind: "count"; label?: string }
  | { kind: "rate"; field: string; value: string; label?: string }
  | { kind: "mean"; field: string; label?: string; domain?: [number, number] };
export type DataExplorerConfig = {
  title: string;
  goal?: string;
  /** Where the numbers come from, shown under the chart. */
  source?: string;
  fields: Record<string, FieldSpec>;
  /** Records, at most 200. Aggregated rows are fine: name the count field in `weight`. */
  rows: Record<string, string | number>[];
  weight?: string;
  measure: MeasureSpec;
  layout: { rows: string[]; cols: string[]; filter?: { field: string; value: string } | null };
  /** Dimension whose categories keep one colour across every regrouping. */
  colorBy?: string;
  /** Groups with fewer cases than this are flagged. Default 30. */
  smallGroup?: number;
  question?: {
    ask?: string;
    /** The dimension being judged (treatment, gender…). Exactly two of its values are compared. */
    compare: string;
    pair?: [string, string];
    /** Dimensions that reveal the insight when the learner groups by them. */
    reveal?: string[];
    expect?: "flip" | "no-flip";
    /** Domain story told in "Explain", after the computed explanation. */
    explain?: string;
    /** What grouping cannot fix (shown in Explain and in the reply). */
    caveat?: string;
  };
};

export type Zone = "fields" | "filter" | "rows" | "cols";
export type View = "measure" | "count";
export type State = {
  rows: string[]; cols: string[]; filter: string | null; filterValue: number;
  view: View; compare: [string, string] | null; hot: Zone | null;
};

type Rec = { v: Record<string, number>; w: number; y: number };
export type Data = {
  config: DataExplorerConfig;
  dims: string[];                         // pivotable dimensions, config order
  values: Record<string, string[]>;
  label: (f: string) => string;
  recs: Rec[];
  measure: MeasureSpec;
  small: number;
  compare?: string;
  pair?: [number, number];
  reveal: string[];
  colorBy?: string;
  domain: [number, number];               // measure axis (rate: 0..1)
};

export const MAX_ROWS = 200;
export const MAX_BARS = 24;

/* ---------------- validation ---------------- */
/* Structural (JSON shape) check, run before anything reads the config. Closed schema; never throws.
   Every record is checked here once, so aggregation and the weight check never meet a null row. */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
export function shapeProblems(raw: unknown): string[] {
  const out: string[] = [];
  const bad = (m: string) => { if (out.length < 12) out.push(m); };
  const closed = (o: Record<string, unknown>, keys: string[], where: string) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${where}: unknown key "${k}".`); };
  const optStr = (o: Record<string, unknown>, k: string, where: string) => { if (o[k] !== undefined && !isStr(o[k])) bad(`${where}.${k} must be text.`); };
  if (!isObj(raw)) return ["Config is not an object."];
  const c = raw;
  closed(c, ["title", "goal", "source", "fields", "rows", "weight", "measure", "layout", "colorBy", "smallGroup", "question"], "config");
  if (!isStr(c.title)) bad("title must be text.");
  optStr(c, "goal", "config"); optStr(c, "source", "config"); optStr(c, "weight", "config"); optStr(c, "colorBy", "config");
  if (c.smallGroup !== undefined && !(typeof c.smallGroup === "number" && Number.isFinite(c.smallGroup))) bad("smallGroup must be a number.");
  if (!isObj(c.fields)) bad("fields must be an object.");
  else for (const [id, f] of Object.entries(c.fields)) {
    if (!isObj(f)) { bad(`field ${id} must be an object.`); continue; }
    closed(f, ["label", "role", "values", "unit", "digits"], `field ${id}`);
    if (!isStr(f.label)) bad(`field ${id} needs a label.`);
    if (f.values !== undefined && !(Array.isArray(f.values) && f.values.every(isStr))) bad(`field ${id} values must be a list of text.`);
    optStr(f, "unit", `field ${id}`);
    if (f.digits !== undefined && !(Number.isInteger(f.digits) && (f.digits as number) >= 0 && (f.digits as number) <= 6)) bad(`field ${id} digits must be a whole number 0–6.`);
  }
  if (!Array.isArray(c.rows)) bad("rows must be a list of records.");
  else c.rows.forEach((r, i) => {
    if (!isObj(r)) { bad(`row ${i + 1} must be a record (an object), not ${r === null ? "null" : Array.isArray(r) ? "a list" : typeof r}.`); return; }
    for (const [k, v] of Object.entries(r)) if (!(isStr(v) || (typeof v === "number" && Number.isFinite(v)))) bad(`row ${i + 1}: ${k} must be text or a number.`);
  });
  const m = c.measure;
  if (!isObj(m)) bad("measure must be an object.");
  else {
    closed(m, ["kind", "field", "value", "label", "domain"], "measure");
    optStr(m, "label", "measure"); optStr(m, "field", "measure"); optStr(m, "value", "measure");
    if (m.domain !== undefined && !(Array.isArray(m.domain) && m.domain.length === 2 && m.domain.every(x => typeof x === "number" && Number.isFinite(x)))) bad("measure.domain must be [min, max] numbers.");
  }
  const L = c.layout;
  if (!isObj(L)) bad("layout must be an object.");
  else {
    closed(L, ["rows", "cols", "filter"], "layout");
    for (const k of ["rows", "cols"]) if (!(Array.isArray(L[k]) && (L[k] as unknown[]).every(isStr))) bad(`layout.${k} must be a list of field ids.`);
    if (L.filter !== undefined && L.filter !== null) {
      if (!isObj(L.filter) || !isStr(L.filter.field) || !isStr(L.filter.value)) bad("layout.filter must be {field, value} or null.");
      else closed(L.filter, ["field", "value"], "layout.filter");
    }
  }
  const q = c.question;
  if (q !== undefined) {
    if (!isObj(q)) bad("question must be an object.");
    else {
      closed(q, ["ask", "compare", "pair", "reveal", "expect", "explain", "caveat"], "question");
      if (!isStr(q.compare)) bad("question.compare must be a field id.");
      for (const k of ["ask", "expect", "explain", "caveat"]) optStr(q, k, "question");
      if (q.pair !== undefined && !(Array.isArray(q.pair) && q.pair.length === 2 && q.pair.every(isStr))) bad("question.pair must be two values.");
      if (q.reveal !== undefined && !(Array.isArray(q.reveal) && q.reveal.every(isStr))) bad("question.reveal must be a list of field ids.");
    }
  }
  return out;
}

export function compile(raw: unknown): { data?: Data; problems: string[] } {
  try { return compileInner(raw); }
  catch (e) { return { problems: [`The config could not be read (${e instanceof Error ? e.message : "unknown error"}).`] }; }
}
function compileInner(raw: unknown): { data?: Data; problems: string[] } {
  const shape = shapeProblems(raw);
  if (shape.length) return { problems: shape };
  const p: string[] = [];
  const c = raw as DataExplorerConfig;
  if (typeof c.title !== "string" || !c.title.trim()) p.push("title must be a non-empty string.");
  if (!c.fields || typeof c.fields !== "object") return { problems: [...p, "fields must be an object."] };
  if (!Array.isArray(c.rows) || c.rows.length === 0) return { problems: [...p, "rows must be a non-empty array."] };
  if (c.rows.length > MAX_ROWS) p.push(`rows has ${c.rows.length} records; the limit is ${MAX_ROWS}.`);
  const ids = Object.keys(c.fields);
  for (const id of ids) {
    const f = c.fields[id];
    if (!/^[A-Za-z][\w]*$/.test(id)) p.push(`field id "${id}" must be letters, digits or _.`);
    if (!f || typeof f.label !== "string") p.push(`field ${id} needs a label.`);
    else if (f.role !== "dimension" && f.role !== "measure") p.push(`field ${id} role must be dimension or measure.`);
  }
  const isDim = (f: string) => c.fields[f]?.role === "dimension";
  const isMeasure = (f: string) => c.fields[f]?.role === "measure";
  if (c.weight !== undefined && !isMeasure(c.weight)) p.push(`weight "${c.weight}" must be a measure field.`);
  const m = c.measure;
  if (!m || !["count", "rate", "mean"].includes((m as MeasureSpec).kind)) p.push("measure.kind must be count, rate or mean.");
  else if (m.kind === "rate" && !isDim(m.field)) p.push(`rate field "${m.field}" must be a dimension (the outcome).`);
  else if (m.kind === "mean" && !isMeasure(m.field)) p.push(`mean field "${m.field}" must be a measure.`);
  const outcome = m && m.kind === "rate" ? m.field : undefined;
  const values: Record<string, string[]> = {};
  for (const id of ids.filter(isDim)) {
    const given = c.fields[id].values;
    if (given !== undefined && (!Array.isArray(given) || given.some(v => typeof v !== "string"))) p.push(`field ${id} values must be strings.`);
    const seen = Array.isArray(given) ? [...given] : [];
    for (const r of c.rows) {
      const v = r?.[id];
      if (typeof v !== "string") { p.push(`a row is missing text for ${id}.`); break; }
      if (!seen.includes(v)) { if (Array.isArray(given)) { p.push(`row value "${v}" is not listed in ${id}.values.`); break; } seen.push(v); }
    }
    values[id] = seen;
  }
  for (const id of ids.filter(isMeasure)) {
    if (c.rows.some(r => typeof r?.[id] !== "number" || !Number.isFinite(r[id] as number))) { p.push(`every row needs a number for ${id}.`); }
  }
  if (c.weight && c.rows.some(r => (r[c.weight!] as number) < 0)) p.push("weights must be zero or more.");
  if (m?.kind === "rate" && values[m.field] && !values[m.field].includes(m.value)) p.push(`"${m.value}" is not a value of ${m.field}.`);
  const dims = ids.filter(f => isDim(f) && f !== outcome);
  if (dims.length < 2) p.push("need at least two dimensions to regroup.");
  const L = c.layout;
  if (!L || !Array.isArray(L.rows) || !Array.isArray(L.cols)) p.push("layout needs rows and cols arrays.");
  else {
    const used = [...L.rows, ...L.cols, ...(L.filter ? [L.filter.field] : [])];
    for (const f of used) if (!dims.includes(f)) p.push(`layout uses "${f}", which is not a dimension that can be grouped.`);
    if (new Set(used).size !== used.length) p.push("a field appears twice in the layout.");
    if (L.rows.length > 2 || L.cols.length > 2) p.push("layout allows at most two fields each in rows and cols.");
    if (L.filter && values[L.filter.field] && !values[L.filter.field].includes(L.filter.value)) p.push(`filter value "${L.filter.value}" is not a value of ${L.filter.field}.`);
  }
  if (c.colorBy !== undefined && !dims.includes(c.colorBy)) p.push(`colorBy "${c.colorBy}" must be a dimension.`);
  const q = c.question;
  let pair: [number, number] | undefined;
  if (q) {
    if (!dims.includes(q.compare)) p.push(`question.compare "${q.compare}" must be a dimension.`);
    else {
      const vals = values[q.compare];
      const pv = q.pair ?? vals.slice(0, 2);
      const idx = pv.map(v => vals.indexOf(v));
      if (pv.length !== 2 || idx.some(i => i < 0) || idx[0] === idx[1]) p.push("question.pair must name two different values of the compared field.");
      else pair = [idx[0], idx[1]];
    }
    for (const r of q.reveal ?? []) if (!dims.includes(r) || r === q.compare) p.push(`question.reveal "${r}" must be another dimension.`);
    if (q.expect && q.expect !== "flip" && q.expect !== "no-flip") p.push("question.expect must be flip or no-flip.");
  }
  if (c.smallGroup !== undefined && !(c.smallGroup >= 0)) p.push("smallGroup must be a number ≥ 0.");
  if (m?.kind === "mean" && m.domain && !(Array.isArray(m.domain) && m.domain[1] > m.domain[0])) p.push("measure.domain must be [min, max] with max > min.");
  if (p.length) return { problems: p };

  const recs: Rec[] = c.rows.map(r => {
    const v: Record<string, number> = {};
    for (const d of dims) v[d] = values[d].indexOf(r[d] as string);
    const w = c.weight ? (r[c.weight] as number) : 1;
    const y = m.kind === "rate" ? (r[m.field] === m.value ? 1 : 0) : m.kind === "mean" ? (r[m.field] as number) : 1;
    return { v, w, y };
  });
  let domain: [number, number] = [0, 1];
  if (m.kind === "mean") domain = m.domain ?? [0, niceMax(Math.max(...recs.map(r => r.y)))];
  const data: Data = {
    config: c, dims, values, recs, measure: m, small: c.smallGroup ?? 30,
    label: f => c.fields[f]?.label ?? f,
    compare: q?.compare, pair, reveal: q?.reveal ?? [], colorBy: c.colorBy ?? q?.compare,
    domain,
  };
  return { data, problems: [] };
}

export function initialState(data: Data): State {
  const L = data.config.layout;
  return {
    rows: [...L.rows], cols: [...L.cols], filter: L.filter?.field ?? null,
    filterValue: L.filter ? data.values[L.filter.field].indexOf(L.filter.value) : 0,
    view: "measure", compare: null, hot: null,
  };
}

/* ---------------- aggregation ---------------- */
export type Assign = Record<string, number>;
export type Agg = { n: number; s: number; m: number };     // n = Σw, s = Σw·y, m = s/n (NaN if empty)
export function agg(data: Data, a: Assign): Agg {
  let n = 0, s = 0;
  for (const r of data.recs) {
    let ok = true;
    for (const k in a) if (r.v[k] !== a[k]) { ok = false; break; }
    if (ok) { n += r.w; s += r.w * r.y; }
  }
  return { n, s, m: n > 0 ? s / n : NaN };
}
export const valueOf = (data: Data, g: Agg, view: View) =>
  view === "count" || data.measure.kind === "count" ? g.n : g.m;

export function tuples(data: Data, dims: string[]): number[][] {
  return dims.reduce<number[][]>((acc, d) => acc.flatMap(t => data.values[d].map((_, i) => [...t, i])), [[]]);
}
export const assignOf = (dims: string[], t: number[]): Assign => Object.fromEntries(dims.map((d, i) => [d, t[i]]));
export const filterAssign = (s: State): Assign => (s.filter ? { [s.filter]: s.filterValue } : {});

/** A stable id for a group: dims in config order, so a bar keeps its id when its field moves between rows and cols. */
export function gidOf(data: Data, a: Assign): string {
  const parts = data.dims.filter(d => d in a).map(d => `${data.dims.indexOf(d)}v${a[d]}`);
  return "g" + (parts.length ? parts.join("x") : "all");
}
export function groupLabel(data: Data, a: Assign, dims: string[]): string {
  return dims.map(d => data.values[d][a[d]]).join(" · ") || "All";
}
export function barCount(data: Data, s: State) {
  return tuples(data, s.rows).length * tuples(data, s.cols).length;
}

/* ---------------- formatting ---------------- */
const MINUS = "−";
export const isRateView = (data: Data, view: View) => data.measure.kind === "rate" && view === "measure";
export function fmtValue(data: Data, v: number, view: View): string {
  if (!Number.isFinite(v)) return "–";
  if (view === "count" || data.measure.kind === "count") return Math.round(v).toLocaleString("en");
  if (data.measure.kind === "rate") return `${Math.round(v * 100)}%`;
  const d = data.config.fields[(data.measure as { field: string }).field]?.digits ?? 1;
  return v.toFixed(d);
}
/** A difference as a magnitude with a unit: "6 points", "1.2 points", "183 cases". */
export function fmtGap(data: Data, d: number, view: View, short = false): string {
  const a = Math.abs(d);
  if (view === "count" || data.measure.kind === "count") return `${Math.round(a).toLocaleString("en")}${short ? "" : " cases"}`;
  if (data.measure.kind === "rate") { const r = Math.round(a * 100); return `${r} ${short ? "pts" : r === 1 ? "point" : "points"}`; }
  const f = data.config.fields[data.measure.field];
  const v = a.toFixed(f?.digits ?? 1);
  return `${v} ${short ? "pts" : f?.unit ?? "points"}`;
}
export const signed = (data: Data, d: number, view: View) => {
  const g = fmtGap(data, d, view, true);
  return /^0(\.0+)? /.test(g) ? `±${g}` : `${d > 0 ? "+" : MINUS}${g}`;
};
export const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Rough 95% margin for a rate from n cases, in points. */
export const margin = (p: number, n: number) => (n > 0 ? 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.0025) / n) : 1);
export function niceMax(x: number): number {
  if (!(x > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  for (const k of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * e >= x * 1.04) return k * e;
  return 10 * e;
}
export function joinAnd(xs: string[]) { return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`; }
/** Name some values of field z, in the field's own order: "Dept C–F" only for a consecutive run
    sharing a prefix; otherwise "Dept A, B, D and F" (the shared prefix said once). */
export function listLabel(data: Data, z: string, idx: number[]) {
  const vals = data.values[z], is = [...new Set(idx)].sort((a, b) => a - b), xs = is.map(i => vals[i]);
  if (xs.length <= 1) return xs.join("");
  const pre = sharedPrefix(xs);
  const run = is.every((v, k) => k === 0 || v === is[k - 1] + 1);
  if (pre && run && xs.length >= 3) return `${xs[0]}–${xs[xs.length - 1].slice(pre.length)}`;
  return pre ? joinAnd([xs[0], ...xs.slice(1).map(x => x.slice(pre.length))]) : joinAnd(xs);
}
/** A word prefix every value shares ("Dept "), or "" when stripping it would leave nothing. */
export function sharedPrefix(xs: string[]) {
  if (xs.length < 2) return "";
  let pre = xs[0];
  for (const x of xs) while (pre && !x.startsWith(pre)) pre = pre.slice(0, -1);
  const cut = pre.lastIndexOf(" ");
  pre = cut > 0 ? pre.slice(0, cut + 1) : "";
  return pre && xs.every(x => x.length > pre.length) ? pre : "";
}

/* ---------------- the reading ---------------- */
export type Stratum = { a: Assign; label: string; A: Agg; B: Agg; d: number; n: number; small: boolean };
export type Reading =
  | { kind: "no-compare"; why: "filtered" | "absent" }
  | { kind: "overall"; A: Agg; B: Agg; D: number }
  | { kind: "flip" | "stable" | "mixed"; A: Agg; B: Agg; D: number; strata: Stratum[]; W: number; leadA: number; leadB: number;
      /** strata where the gap has the case-weighted direction W, the opposite one, and (near) ties */
      withW: Stratum[]; againstW: Stratum[]; even: Stratum[]; every: boolean; by: string[]; reveal: string[] };

export function read(data: Data, s: State, view: View = s.view): Reading | null {
  const C = data.compare, pair = data.pair;
  if (!C || !pair) return null;
  if (s.filter === C) return { kind: "no-compare", why: "filtered" };
  if (![...s.rows, ...s.cols].includes(C)) return { kind: "no-compare", why: "absent" };
  const f = filterAssign(s);
  const val = (g: Agg) => valueOf(data, g, view);
  const A = agg(data, { ...f, [C]: pair[0] }), B = agg(data, { ...f, [C]: pair[1] });
  const D = val(A) - val(B);
  const by = [...s.rows, ...s.cols].filter(d => d !== C);
  if (!by.length) return { kind: "overall", A, B, D };
  const strata: Stratum[] = [];
  for (const t of tuples(data, by)) {
    const a = { ...f, ...assignOf(by, t) };
    const SA = agg(data, { ...a, [C]: pair[0] }), SB = agg(data, { ...a, [C]: pair[1] });
    if (!(SA.n > 0 && SB.n > 0)) continue;
    strata.push({ a, label: groupLabel(data, a, by), A: SA, B: SB, d: val(SA) - val(SB), n: SA.n + SB.n, small: Math.min(SA.n, SB.n) < data.small });
  }
  const N = strata.reduce((t, x) => t + x.n, 0);
  const W = N ? strata.reduce((t, x) => t + x.n * x.d, 0) / N : 0;
  const tiny = view === "count" || data.measure.kind === "count" ? 0.5 : data.measure.kind === "rate" ? 0.005 : 0.05;
  const leadA = strata.filter(x => x.d > tiny).length, leadB = strata.filter(x => x.d < -tiny).length;
  /* The flip rule: a case-weighted reversal. Weight each group by its cases (both sides), average the
     within-group gaps, and call it a flip when that average and the pooled gap point opposite ways.
     Not every group has to reverse; withW / againstW say which do and which don't. */
  const opposite = Math.sign(W) !== Math.sign(D) && Math.abs(W) > tiny && Math.abs(D) > tiny;
  const kind = opposite ? "flip" : (D > 0 ? leadB : leadA) === 0 ? "stable" : "mixed";
  const dirW = Math.abs(W) > tiny ? Math.sign(W) : Math.sign(D);
  const withW = strata.filter(x => Math.abs(x.d) > tiny && Math.sign(x.d) === dirW);
  const againstW = strata.filter(x => Math.abs(x.d) > tiny && Math.sign(x.d) !== dirW);
  const even = strata.filter(x => Math.abs(x.d) <= tiny);
  return { kind, A, B, D, strata, W, leadA, leadB, withW, againstW, even, every: withW.length === strata.length,
    by, reveal: by.filter(b => data.reveal.includes(b)) };
}

/** How differently the two compared groups are spread over field Z. */
export type Mix = { z: string; shareA: number[]; shareB: number[]; all: Agg[]; byA: Agg[]; byB: Agg[]; gap: number; worst: number };
export function mixOf(data: Data, s: State, z: string): Mix | null {
  const C = data.compare, pair = data.pair;
  if (!C || !pair || z === C) return null;
  const f = filterAssign(s);
  if (s.filter === z) return null;
  const tA = agg(data, { ...f, [C]: pair[0] }).n, tB = agg(data, { ...f, [C]: pair[1] }).n;
  const vals = data.values[z].map((_, i) => i);
  const byA = vals.map(i => agg(data, { ...f, [C]: pair[0], [z]: i }));
  const byB = vals.map(i => agg(data, { ...f, [C]: pair[1], [z]: i }));
  const shareA = byA.map(g => (tA ? g.n / tA : 0)), shareB = byB.map(g => (tB ? g.n / tB : 0));
  const all = vals.map(i => agg(data, { ...f, [z]: i }));
  let gap = 0, worst = 0;
  /* the most lopsided category; on a tie (always, for two categories) name the one with the worse outcome */
  vals.forEach(i => {
    const g = Math.abs(shareA[i] - shareB[i]);
    if (g > gap + 1e-9 || (Math.abs(g - gap) <= 1e-9 && all[i].m < all[worst].m)) { gap = g; worst = i; }
  });
  return { z, shareA, shareB, all, byA, byB, gap, worst };
}
/** The other dimension with the most lopsided mix between the compared groups. */
export function lurking(data: Data, s: State): Mix | null {
  let best: Mix | null = null;
  for (const z of data.dims) {
    if (z === data.compare || z === s.filter) continue;
    const m = mixOf(data, s, z);
    if (m && (!best || m.gap > best.gap)) best = m;
  }
  return best;
}

/* ---------------- the what-if: same per-group results, change one thing (the mix) ---------------- */
export type WhatIf = {
  z: string; target: 0 | 1; order: number[]; hard: number[]; easyLabel: string; hardLabel: string;
  own: number[]; ref: number[]; rates: number[]; observed: number; refValue: number;
};
export function whatIf(data: Data, s: State, z: string): WhatIf | null {
  const mix = mixOf(data, s, z);
  if (!mix || data.measure.kind === "count") return null;
  const C = data.compare!, pair = data.pair!;
  const f = filterAssign(s);
  const mA = agg(data, { ...f, [C]: pair[0] }).m, mB = agg(data, { ...f, [C]: pair[1] }).m;
  const target: 0 | 1 = mA <= mB ? 0 : 1;          // change the mix of the group that looks worse
  const byT = target === 0 ? mix.byA : mix.byB;
  const own = target === 0 ? mix.shareA : mix.shareB, ref = target === 0 ? mix.shareB : mix.shareA;
  const vals = data.values[z].map((_, i) => i).filter(i => mix.all[i].n > 0);
  const order = [...vals].sort((i, j) => mix.all[j].m - mix.all[i].m);         // easiest first
  let cut = 1, best = -1;
  for (let k = 1; k < order.length; k++) { const g = mix.all[order[k - 1]].m - mix.all[order[k]].m; if (g > best) { best = g; cut = k; } }
  const hard = order.slice(cut);
  const name = (is: number[]) => listLabel(data, z, is);
  return {
    z, target, order, hard, easyLabel: name(order.slice(0, cut)), hardLabel: name(hard), own, ref,
    rates: byT.map(g => g.m), observed: target === 0 ? mA : mB, refValue: target === 0 ? mB : mA,
  };
}
export function blend(w: WhatIf, t: number) {
  const mix = w.own.map((o, i) => (1 - t) * o + t * w.ref[i]);
  let num = 0, den = 0;
  mix.forEach((m, i) => { if (Number.isFinite(w.rates[i]) && m > 0) { num += m * w.rates[i]; den += m; } });
  return { mix, value: den ? num / den : NaN, hardShare: w.hard.reduce((t2, i) => t2 + mix[i], 0) };
}
