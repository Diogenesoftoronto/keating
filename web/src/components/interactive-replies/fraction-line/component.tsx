import { Component, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DraggableRenderer, inOrder, param, scale, translate, type Draggable } from "dragology";
import { ArrowDown, ArrowUp, Check, Layers, MapPin, RotateCcw, Scissors, Undo2 } from "lucide-react";
import "./component.css";

/* ================= Public config ================= */
export type Tone = "a" | "b" | "c";
export type NumberLineRow = {
  numerator: number;
  denominator: number;
  tone?: Tone;
  /** The learner may change the numerator (markers and steppers). */
  editable?: boolean;
  /** Short name for buttons and announcements, e.g. "Top bar". */
  label?: string;
  minNumerator?: number;
  maxNumerator?: number;
};
export type NumberLineMoves = {
  /** Drag one row's shaded pieces onto another row, measured from 0. `true` allows every pair. */
  layOn?: boolean | { from: number; onto: number }[];
  /** Refine a row's partition: each piece is cut into `factor` pieces by sweeping scissors along it. */
  cut?: boolean | { rows?: number[]; factors?: number[] };
  /** One draggable point per editable row on the number line. */
  markers?: boolean;
  /** Numerator − / + buttons per editable row. */
  steppers?: boolean;
};
export type NumberLineGoal =
  | { kind: "compare"; a: number; b: number }
  | { kind: "equivalent"; a: number; b: number }
  | { kind: "place"; row?: number; target: string | { numerator: number; denominator: number } };
export type ShareSummary = { learner: string; data: string; reply: string };
/** @deprecated use ShareSummary */
export type NumberLineShare = ShareSummary;
/** JSON-serialisable: this is what a model authors. */
export type NumberLineConfig = {
  /** The line runs from 0 to `max` (a whole number, 1–4). Bars and lay-on comparisons start at 0. */
  max?: number;
  rows: NumberLineRow[];
  moves?: NumberLineMoves;
  goal?: NumberLineGoal;
  title?: string;
};
export type NumberLineProps = {
  config: NumberLineConfig;
  onChange?: () => void;
  onShare?: (summary: ShareSummary) => void;
};

/* ================= Validation =================
   Everything the component indexes into is checked here, so a bad config renders the calm fallback
   instead of throwing. Numerators outside their range are clamped, not rejected. */
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const FACTOR_MAX = 10, DEN_MAX = 24;
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KEYS = {
  top: ["max", "rows", "moves", "goal", "title"],
  row: ["numerator", "denominator", "tone", "editable", "label", "minNumerator", "maxNumerator"],
  moves: ["layOn", "cut", "markers", "steppers"],
  cut: ["rows", "factors"],
  compare: ["kind", "a", "b"], equivalent: ["kind", "a", "b"], place: ["kind", "row", "target"],
} as const;
const extraKeys = (o: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]) => {
  const extra = Object.keys(o).filter(k => !allowed.includes(k));
  if (extra.length) errors.push(`${where} has unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
};
export function validateNumberLine(config: unknown): string[] {
  const errors: string[] = [];
  if (!isRec(config)) return ["config must be an object"];
  const c = config;
  extraKeys(c, KEYS.top, "config", errors);
  if (c.max !== undefined && (!isInt(c.max) || c.max < 1 || c.max > 4)) errors.push("max must be a whole number from 1 to 4");
  const max = isInt(c.max) ? Math.min(4, Math.max(1, c.max)) : 1;
  if (c.title !== undefined && (typeof c.title !== "string" || c.title.length > 80)) errors.push("title must be a string of at most 80 characters");
  if (!Array.isArray(c.rows) || c.rows.length < 1 || c.rows.length > 3) { errors.push("rows must be an array of 1 to 3 rows"); return errors; }
  const R = c.rows.length;
  const idx = (v: unknown) => isInt(v) && v >= 0 && v < R;
  c.rows.forEach((row: unknown, r) => {
    if (!isRec(row)) { errors.push(`rows[${r}] must be an object`); return; }
    const w = row;
    extraKeys(w, KEYS.row, `rows[${r}]`, errors);
    if (!isInt(w.denominator) || w.denominator < 1 || w.denominator > DEN_MAX) errors.push(`rows[${r}].denominator must be a whole number from 1 to ${DEN_MAX}`);
    if (!isInt(w.numerator) || w.numerator < 0) errors.push(`rows[${r}].numerator must be a whole number ≥ 0`);
    if (w.tone !== undefined && !["a", "b", "c"].includes(w.tone as string)) errors.push(`rows[${r}].tone must be "a", "b" or "c"`);
    if (w.editable !== undefined && typeof w.editable !== "boolean") errors.push(`rows[${r}].editable must be a boolean`);
    if (w.label !== undefined && (typeof w.label !== "string" || !w.label.trim() || w.label.length > 30)) errors.push(`rows[${r}].label must be a non-empty string of at most 30 characters`);
    for (const k of ["minNumerator", "maxNumerator"] as const) if (w[k] !== undefined && (!isInt(w[k]) || (w[k] as number) < 0)) errors.push(`rows[${r}].${k} must be a whole number ≥ 0`);
    if (isInt(w.minNumerator) && isInt(w.maxNumerator) && w.minNumerator > w.maxNumerator) errors.push(`rows[${r}].minNumerator is above maxNumerator`);
    if (isInt(w.minNumerator) && isInt(w.denominator) && w.minNumerator > max * w.denominator) errors.push(`rows[${r}].minNumerator is past the end of the line`);
  });
  const moves = c.moves;
  let markers = false;
  if (moves !== undefined) {
    if (!isRec(moves)) errors.push("moves must be an object");
    else {
      const mv = moves;
      extraKeys(mv, KEYS.moves, "moves", errors);
      if (mv.layOn !== undefined && typeof mv.layOn !== "boolean") {
        if (!Array.isArray(mv.layOn)) errors.push("moves.layOn must be true, false or a list of { from, onto }");
        else mv.layOn.forEach((pr: unknown, i) => {
          const q = isRec(pr) ? pr : null;
          if (!q || !idx(q.from) || !idx(q.onto)) errors.push(`moves.layOn[${i}] needs row indexes from 0 to ${R - 1}`);
          else if (q.from === q.onto) errors.push(`moves.layOn[${i}] lays a row onto itself`);
        });
      }
      if (mv.cut !== undefined && typeof mv.cut !== "boolean") {
        const cut = mv.cut;
        if (!isRec(cut)) errors.push("moves.cut must be true, false or { rows?, factors? }");
        else {
          extraKeys(cut, KEYS.cut, "moves.cut", errors);
          if (cut.rows !== undefined && (!Array.isArray(cut.rows) || cut.rows.some(r => !idx(r)))) errors.push(`moves.cut.rows must list row indexes from 0 to ${R - 1}`);
          if (cut.factors !== undefined && (!Array.isArray(cut.factors) || !cut.factors.length || cut.factors.some(f => !isInt(f) || f < 2 || f > FACTOR_MAX)))
            errors.push(`moves.cut.factors must list whole numbers from 2 to ${FACTOR_MAX}`);
        }
      }
      for (const k of ["markers", "steppers"]) if (mv[k] !== undefined && typeof mv[k] !== "boolean") errors.push(`moves.${k} must be a boolean`);
      markers = mv.markers === true;
    }
  }
  const goal = c.goal;
  if (goal !== undefined) {
    if (isRec(goal) && (goal.kind === "compare" || goal.kind === "equivalent" || goal.kind === "place")) extraKeys(goal, KEYS[goal.kind], "goal", errors);
    if (!isRec(goal)) errors.push("goal must be an object");
    else if (goal.kind === "compare" || goal.kind === "equivalent") {
      if (R < 2) errors.push(`a ${goal.kind} goal needs two rows`);
      else if (!idx(goal.a) || !idx(goal.b)) errors.push(`goal.a and goal.b must be row indexes from 0 to ${R - 1}`);
      else if (goal.a === goal.b) errors.push("goal.a and goal.b must be different rows");
    } else if (goal.kind === "place") {
      if (goal.row === null) errors.push("goal.row must be a row index, or left out");
      const r = goal.row ?? 0;
      const t = goal.target;
      let pq: { p: number; q: number } | undefined;
      if (typeof t === "string" && /^\d{1,3}\/\d{1,3}$/.test(t.trim())) { const [p, q] = t.trim().split("/").map(Number); pq = { p, q }; }
      else if (t && typeof t === "object" && isInt((t as Record<string, unknown>).numerator) && isInt((t as Record<string, unknown>).denominator))
        pq = { p: (t as { numerator: number }).numerator, q: (t as { denominator: number }).denominator };
      if (!idx(r)) errors.push(`goal.row must be a row index from 0 to ${R - 1}`);
      if (!pq || pq.q < 1 || pq.p < 0) errors.push('goal.target must be a fraction like "5/4"');
      else {
        if (pq.p / pq.q > max) errors.push(`goal.target ${pq.p}/${pq.q} is past the end of the line (max ${max})`);
        const row = idx(r) ? (c.rows as Record<string, unknown>[])[r as number] : undefined;
        if (row && isInt(row.denominator) && (pq.p * row.denominator) % pq.q !== 0)
          errors.push(`goal.target ${pq.p}/${pq.q} can't be written in ${row.denominator}ths, so the marker can never land on it`);
        else if (row && isInt(row.denominator)) {
          /* The marker only reaches numerators inside the row's effective range: compare in the row's own units. */
          const k = (pq.p * row.denominator) / pq.q;
          const lo = isInt(row.minNumerator) ? row.minNumerator : 0;
          const hi = Math.min(isInt(row.maxNumerator) ? row.maxNumerator : max * row.denominator, max * row.denominator);
          const as = pq.q === row.denominator ? `goal.target ${pq.p}/${pq.q}` : `goal.target ${pq.p}/${pq.q} (${k}/${row.denominator})`;
          if (k < lo) errors.push(`${as} is below rows[${r}].minNumerator ${lo}, so the marker can never reach it`);
          if (k > hi) errors.push(`${as} is above the row's largest numerator ${hi}, so the marker can never reach it`);
        }
        if (row && (row.editable !== true || !markers)) errors.push("a place goal needs an editable row and moves.markers: true");
      }
    } else errors.push('goal.kind must be "compare", "equivalent" or "place"');
  }
  return errors;
}

/* ================= Presets ================= */
export const presets = {
  quarterVsEighths: {
    max: 1,
    rows: [
      { numerator: 1, denominator: 4, tone: "a", editable: true, minNumerator: 1, maxNumerator: 4, label: "Top bar" },
      { numerator: 3, denominator: 8, tone: "b", editable: true, label: "Bottom bar" },
    ],
    moves: { layOn: [{ from: 0, onto: 1 }], cut: { rows: [0], factors: [2] }, markers: true, steppers: true },
    goal: { kind: "compare", a: 0, b: 1 },
  },
  thirdsVsFifths: {
    max: 1,
    rows: [
      { numerator: 2, denominator: 3, tone: "a", editable: true, minNumerator: 1, label: "Top bar" },
      { numerator: 3, denominator: 5, tone: "b", editable: true, minNumerator: 1, label: "Bottom bar" },
    ],
    moves: { layOn: true, cut: { factors: [2, 3, 4, 5] }, markers: true, steppers: true },
    goal: { kind: "compare", a: 0, b: 1 },
  },
  halfIsThreeSixths: {
    max: 1,
    rows: [
      { numerator: 1, denominator: 2, tone: "a", label: "Top bar" },
      { numerator: 3, denominator: 6, tone: "b", editable: true, label: "Bottom bar" },
    ],
    moves: { layOn: [{ from: 0, onto: 1 }], cut: { rows: [0], factors: [2, 3] }, markers: true, steppers: true },
    goal: { kind: "equivalent", a: 0, b: 1 },
  },
  placeFiveQuarters: {
    max: 2,
    rows: [{ numerator: 0, denominator: 4, tone: "a", editable: true, label: "Quarters" }],
    moves: { markers: true, steppers: true },
    goal: { kind: "place", row: 0, target: "5/4" },
  },
} satisfies Record<string, NumberLineConfig>;
/** @deprecated old name, kept so existing imports build; use `presets`. */
export const numberLinePresets = presets;

export const scenario = {
  tab: "Number line",
  prompt: "Can you show me why 3/8 is bigger than 1/4?",
  intro: "Quarters and eighths are different sized pieces, so counting them doesn’t tell you much yet. Pick up the shaded quarter and lay it on the eighths. Look at what it leaves uncovered.",
  receiptLabel: "Number line",
  receiptText: "Fraction bars measured from 0 on one shared number line. The learner lays one bar on another, cuts pieces into smaller pieces, and moves markers; comparisons use the least common denominator.",
  preset: "quarterVsEighths",
};
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  quarterVsEighths: { label: "1/4 vs 3/8", prompt: scenario.prompt, intro: scenario.intro },
  thirdsVsFifths: { label: "2/3 vs 3/5", prompt: "Which is bigger, 2/3 or 3/5?",
    intro: "Lay one on the other first. You’ll see which is longer, but thirds and fifths don’t line up, so you’ll need smaller pieces to say by how much." },
  halfIsThreeSixths: { label: "1/2 = 3/6", prompt: "Is 1/2 really the same as 3/6?",
    intro: "Lay the half on the sixths and see where it ends. Then cut the half into smaller pieces and count them." },
  placeFiveQuarters: { label: "Place 5/4", prompt: "Where does 5/4 go on a number line?",
    intro: "5/4 means five quarters. Move the marker one quarter at a time and watch what happens when you reach 1." },
};

/* ================= Arithmetic and words ================= */
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : Math.abs(a);
const lcm = (a: number, b: number) => a / gcd(a, b) * b;
const NUMBER = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (k: number) => NUMBER[k] ?? String(k);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const UNIT: Record<number, [string, string]> = {
  1: ["whole", "wholes"], 2: ["half", "halves"], 3: ["third", "thirds"], 4: ["quarter", "quarters"],
};
const ORDINAL = ["", "", "", "", "", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
  "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
function unit(d: number, k = 1) {
  const [one, many] = UNIT[d] ?? (() => { const o = ORDINAL[d] ?? `${d}th`; return [o, `${o}s`]; })();
  return k === 1 ? one : many;
}
const count = (k: number, d: number) => `${k} ${unit(d, k)}`;
const countWords = (k: number, d: number) => `${word(k)} ${unit(d, k)}`;
const into = (f: number) => f === 2 ? "in half" : `into ${unit(f, 2)}`;
const fr = (n: number, d: number) => `${n}/${d}`;
function parseTarget(t: string | { numerator: number; denominator: number }) {
  if (typeof t !== "string") return { p: t.numerator, q: t.denominator };
  const [p, q] = t.split("/").map(Number);
  return { p, q: q || 1 };
}
function mixedWords(p: number, q: number) {
  const whole = Math.floor(p / q), rest = p % q;
  if (!whole) return countWords(rest, q);
  const w = whole === 1 ? "one whole" : `${word(whole)} wholes`;
  return rest ? `${w} and ${word(rest)} more ${unit(q, rest)}` : w;
}

/* ================= State ================= */
type S = { nums: number[]; picks: number[]; knives: number[]; laid: string };
type Pair = { from: number; onto: number };
type History = { laid: string[]; cut: number[]; equal: boolean };
const parseLaid = (laid: string): Pair | undefined => {
  if (!laid) return undefined;
  const [from, onto] = laid.split(">").map(Number);
  return { from, onto };
};

/* Everything derived from config once: allowed moves, factors, partners. */
function useModel(props: NumberLineConfig) {
  return useMemo(() => {
    const { rows, moves = {}, goal } = props;
    const max = Math.max(1, Math.min(4, Math.round(props.max ?? 1)));
    const R = rows.length;
    const all = rows.map((_, i) => i);
    const pairs: Pair[] = moves.layOn === true
      ? all.flatMap(from => all.filter(onto => onto !== from).map(onto => ({ from, onto })))
      : Array.isArray(moves.layOn) ? moves.layOn.filter(p => p.from !== p.onto && p.from < R && p.onto < R) : [];
    const cutCfg = moves.cut === true ? {} : moves.cut || undefined;
    const cutRows = cutCfg ? (cutCfg.rows ?? all).filter(r => r < R) : [];
    const factors = cutCfg?.factors?.length ? cutCfg.factors.filter(f => f >= 2) : [2, 3];
    const pair = goal && goal.kind !== "place" ? { a: goal.a, b: goal.b } : R >= 2 ? { a: 0, b: 1 } : undefined;
    const L = pair ? lcm(rows[pair.a].denominator, rows[pair.b].denominator) : rows[0].denominator;
    /* The scissors start on the smallest factor. Choosing the piece size both bars share is the
       learner's step, so it is never preset to the common denominator. */
    const defaultPick = (r: number) => cutRows.includes(r) ? Math.min(...factors) : 1;
    const minN = (r: number) => rows[r].minNumerator ?? 0;
    const maxN = (r: number) => Math.min(rows[r].maxNumerator ?? max * rows[r].denominator, max * rows[r].denominator);
    const start: S = {
      nums: rows.map((row, r) => clamp(row.numerator, minN(r), maxN(r))),
      picks: all.map(defaultPick), knives: all.map(() => 0), laid: "",
    };
    const target = goal?.kind === "place" ? { row: goal.row ?? 0, ...parseTarget(goal.target) } : undefined;
    const name = (r: number) => rows[r].label ?? (R === 2 ? ["Top bar", "Bottom bar"][r] : `Row ${r + 1}`);
    return {
      rows, max, R, pairs, cutRows, factors, pair, L, start, target, goal, name, minN, maxN,
      /* Steppers are the keyboard path for markers, so markers always bring them (steppers: false can't remove them). */
      markers: !!moves.markers, steppers: !!moves.steppers || !!moves.markers,
      canCut: (r: number) => cutRows.includes(r),
      canLay: (from: number, onto: number) => pairs.some(p => p.from === from && p.onto === onto),
    };
  }, [props]);
}
type Model = ReturnType<typeof useModel>;
const SHARE_LABEL = "Share with Keating";

/* ================= Derived comparison ================= */
const factorOf = (s: S, r: number) => s.knives[r] >= 1 ? s.picks[r] : 1;
const effDen = (m: Model, s: S, r: number) => m.rows[r].denominator * factorOf(s, r);
const str = (m: Model, s: S, r: number) => fr(s.nums[r], m.rows[r].denominator);

function analyse(m: Model, s: S) {
  if (!m.pair) return undefined;
  const { a, b } = m.pair;
  const dA = m.rows[a].denominator, dB = m.rows[b].denominator, L = lcm(dA, dB);
  const ca = s.nums[a] * L / dA, cb = s.nums[b] * L / dB;
  const laid = parseLaid(s.laid);
  const pairLaid = laid && ((laid.from === a && laid.onto === b) || (laid.from === b && laid.onto === a)) ? laid : undefined;
  const common = effDen(m, s, a) === effDen(m, s, b);
  /* A laid row can be measured in the units of the row under it when that row's partition is fine enough. */
  const eOnto = pairLaid ? effDen(m, s, pairLaid.onto) : 0;
  const measurable = !!pairLaid && eOnto % L === 0;
  const need = [a, b].filter(r => effDen(m, s, r) !== L);
  const cutFix = need.length > 0 && need.every(r => m.canCut(r) && m.factors.includes(L / m.rows[r].denominator));
  return { a, b, dA, dB, L, ca, cb, diff: cb - ca, laid: pairLaid, common, measurable, eOnto, need, cutFix };
}
type Analysis = NonNullable<ReturnType<typeof analyse>>;

/* The learner cut one or both rows, but the pieces still differ in size: say so with their pieces. */
function mismatchNote(m: Model, s: S, x: Analysis) {
  const eA = effDen(m, s, x.a), eB = effDen(m, s, x.b);
  if (x.common || (factorOf(s, x.a) === 1 && factorOf(s, x.b) === 1) || x.dA === x.dB) return "";
  const L = lcm(eA, eB);
  return `${cap(unit(eA, 2))} and ${unit(eB, 2)} still don’t line up: they are different sizes. `
    + (x.cutFix ? `Try pieces that both ${unit(x.dA, 2)} and ${unit(x.dB, 2)} split into evenly.` : `They would meet in ${unit(L, 2)}.`);
}

function compareSentence(m: Model, s: S, x: Analysis, history: History) {
  const A = str(m, s, x.a), B = str(m, s, x.b);
  if (x.dA === x.dB) {
    return x.diff === 0 ? `Both count ${unit(x.dA, 2)} and both have ${s.nums[x.a]}, so ${A} and ${B} are equal.`
      : `Both count ${unit(x.dA, 2)}, so compare the counts: ${Math.max(s.nums[x.a], s.nums[x.b])} is more than ${Math.min(s.nums[x.a], s.nums[x.b])}.`;
  }
  const mismatch = mismatchNote(m, s, x);
  if (mismatch && !(x.laid && x.measurable)) return mismatch;
  if (!x.laid && !x.common) return `${cap(unit(x.dA, 2))} and ${unit(x.dB, 2)} are different sizes, so ${s.nums[x.a]} and ${s.nums[x.b]} can’t be compared as counts yet. Put the pieces side by side.`;
  if (x.laid) {
    const X = str(m, s, x.laid.from), Y = str(m, s, x.laid.onto);
    const cx = x.laid.from === x.a ? x.ca : x.cb, cy = x.laid.from === x.a ? x.cb : x.ca;
    const d = cy - cx;
    if (x.measurable) {
      const e = x.eOnto, k = e / x.L;
      if (d > 0) return `${X} covers exactly ${count(cx * k, e)}. ${cap(count(d * k, e))} of ${Y} ${d * k === 1 ? "is" : "are"} left uncovered, so ${Y} is bigger by ${fr(d, x.L)}.`;
      if (d < 0) return `${X} covers all ${cy * k} shaded ${unit(e, cy * k)} and runs ${count(-d * k, e)} past them, so ${X} is bigger by ${fr(-d, x.L)}.`;
      return `${X} covers the ${count(cx * k, e)} exactly. Same length, so ${X} and ${Y} are equal.`;
    }
    if (d === 0) return `${X} and ${Y} end at exactly the same point. Same length, so they are equal.`;
    const longer = d < 0 ? X : Y;
    return `${longer} is longer, but the gap isn’t a whole number of ${unit(x.dA, 2)} or ${unit(x.dB, 2)}.`
      + (x.cutFix ? " Cut both into smaller pieces that line up to measure it." : ` It is ${fr(Math.abs(d), x.L)}.`);
  }
  const e = effDen(m, s, x.a), ka = x.ca * e / x.L, kb = x.cb * e / x.L;
  const tail = history.laid.length || !m.pairs.length ? "" : " Lay one on the other to see the difference.";
  if (ka === kb) return `Cut into ${unit(e, 2)}, ${A} is ${fr(ka, e)} and ${B} is ${fr(kb, e)}: the same.${tail}`;
  return `Cut into ${unit(e, 2)}, ${A} is ${fr(ka, e)} and ${B} is ${fr(kb, e)}. Now both count ${unit(e, 2)}, and ${Math.max(ka, kb)} is more than ${Math.min(ka, kb)}.${tail}`;
}

function placeInfo(m: Model, s: S) {
  const t = m.target!;
  const d = m.rows[t.row].denominator, n = s.nums[t.row];
  const L = lcm(d, t.q), cv = n * L / d, ct = t.p * L / t.q;
  return { ...t, d, n, L, cv, ct, T: fr(t.p, t.q), at: fr(n, d), done: cv === ct };
}
function placeSentence(m: Model, s: S) {
  const x = placeInfo(m, s);
  if (x.done) return `That’s ${x.T}: ${mixedWords(x.p, x.q)}${x.p > x.q ? `, so it sits past ${Math.floor(x.p / x.q)} on the line` : ""}.`;
  if (x.cv < x.ct) return `Your marker is at ${x.at}. ${x.T} is ${fr(x.ct - x.cv, x.L)} further right.`
    + (x.p >= x.q && x.n < x.d ? ` Keep going past 1: ${fr(x.d, x.d)} is one whole.` : "");
  return `Your marker is at ${x.at}, which is ${fr(x.cv - x.ct, x.L)} past ${x.T}.`;
}

function sentence(m: Model, s: S, history: History) {
  if (m.target) return placeSentence(m, s);
  const x = analyse(m, s);
  if (!x) return `${str(m, s, 0)} is ${count(s.nums[0], m.rows[0].denominator)}.`;
  return compareSentence(m, s, x, history);
}

function shareSummary(m: Model, s: S, history: History): NumberLineShare {
  if (m.target) {
    const x = placeInfo(m, s);
    const learner = `I put the marker at ${x.at}.`;
    const data = `${x.at} placed · target ${x.T} · ${x.done ? "correct" : `${x.cv < x.ct ? "short" : "past"} by ${fr(Math.abs(x.ct - x.cv), x.L)}`}`;
    const whole = Math.floor(x.p / x.q), rest = x.p % x.q;
    const reply = x.done
      ? `Yes. ${x.T} is ${countWords(x.p, x.q)}.${x.p >= x.q ? ` ${cap(word(x.q))} of them make one whole, so ${x.T} is ${mixedWords(x.p, x.q)}${rest ? `, and it sits ${countWords(rest, x.q)} past ${whole}` : ""}.` : ""}`
      : `Not quite: ${x.at} is ${x.cv < x.ct ? "short of" : "past"} ${x.T} by ${fr(Math.abs(x.ct - x.cv), x.L)}. Count ${unit(x.q, 2)} from 0. ${cap(word(x.q))} of them reach 1, then keep counting until you have ${x.p}.`;
    return { learner, data, reply };
  }
  const x = analyse(m, s);
  if (!x) return { learner: `I made ${str(m, s, 0)}.`, data: str(m, s, 0), reply: sentence(m, s, history) };
  const A = str(m, s, x.a), B = str(m, s, x.b);
  const cutNow = [x.a, x.b].filter(r => factorOf(s, r) > 1);
  let learner: string;
  if (x.laid) {
    const X = str(m, s, x.laid.from), Y = str(m, s, x.laid.onto);
    const cx = x.laid.from === x.a ? x.ca : x.cb, cy = x.laid.from === x.a ? x.cb : x.ca, d = cy - cx;
    if (x.measurable) {
      const k = x.eOnto / x.L;
      learner = d > 0 ? `I laid ${X} on ${Y}. It covered ${cx * k} of the ${cy * k} ${unit(x.eOnto, 2)} and left ${d * k} uncovered.`
        : d < 0 ? `I laid ${X} on ${Y}. It ran ${count(-d * k, x.eOnto)} past the end.` : `I laid ${X} on ${Y} and it covered them exactly.`;
    } else learner = d === 0 ? `I laid ${X} on ${Y} and they ended at the same point.` : `I laid ${X} on ${Y}. ${d < 0 ? X : Y} was longer, by a bit that wasn’t a whole ${unit(x.dA)} or ${unit(x.dB)}.`;
  } else if (x.common) learner = `I cut them so both count ${unit(effDen(m, s, x.a), 2)}: ${A} is ${fr(x.ca * effDen(m, s, x.a) / x.L, effDen(m, s, x.a))} and ${B} is ${fr(x.cb * effDen(m, s, x.b) / x.L, effDen(m, s, x.b))}.`;
  else if (cutNow.length) learner = `I cut the ${unit(m.rows[cutNow[0]].denominator, 2)} ${into(s.picks[cutNow[0]])}, so ${str(m, s, cutNow[0])} became ${fr(s.nums[cutNow[0]] * s.picks[cutNow[0]], effDen(m, s, cutNow[0]))}.`;
  else learner = `I’m comparing ${A} and ${B}.`;

  const data = [
    `${A} vs ${B}`,
    x.laid ? `laid ${str(m, s, x.laid.from)} on ${str(m, s, x.laid.onto)}` : "not laid on",
    cutNow.length ? `cut: ${cutNow.map(r => `${str(m, s, r)} → ${fr(s.nums[r] * s.picks[r], effDen(m, s, r))}`).join(", ")}` : history.cut.length ? "cut, then joined again" : "no cuts",
    x.diff === 0 ? "equal" : `${x.diff > 0 ? B : A} bigger by ${fr(Math.abs(x.diff), x.L)}`,
  ].join(" · ");

  const bigger = x.diff > 0 ? x.b : x.a, smaller = x.diff > 0 ? x.a : x.b;
  const cS = Math.min(x.ca, x.cb), cB = Math.max(x.ca, x.cb), gap = Math.abs(x.diff);
  const dS = m.rows[smaller].denominator, dBig = m.rows[bigger].denominator;
  const nameAs = (r: number, c: number) => m.rows[r].denominator === x.L ? "" : `, so ${str(m, s, r)} = ${fr(c, x.L)}`;
  const renamed = () => {
    const r = cutNow[0] ?? history.cut[0];
    return r === undefined ? "" : ` Cutting the ${unit(m.rows[r].denominator, 2)} showed the same thing another way: you renamed ${str(m, s, r)} as ${fr(s.nums[r] * s.picks[r], m.rows[r].denominator * s.picks[r])} without changing its size.`;
  };
  let reply: string;
  const eA = effDen(m, s, x.a), eB = effDen(m, s, x.b);
  if (mismatchNote(m, s, x) && !(x.laid && x.measurable)) {
    reply = `Good instinct to cut, but ${unit(eA, 2)} and ${unit(eB, 2)} are still different sizes, so the counts ${fr(x.ca * eA / x.L, eA)} and ${fr(x.cb * eB / x.L, eB)} can’t be compared directly. You need a piece that both ${unit(x.dA, 2)} and ${unit(x.dB, 2)} split into evenly: ${unit(x.L, 2)}, because ${x.dA} × ${x.L / x.dA} = ${x.dB} × ${x.L / x.dB} = ${x.L}. In ${unit(x.L, 2)}, ${A} is ${fr(x.ca, x.L)} and ${B} is ${fr(x.cb, x.L)}, so ${x.diff === 0 ? "they are equal" : `${str(m, s, bigger)} is bigger by ${fr(gap, x.L)}`}.`;
  } else if (!x.laid && !x.common) {
    reply = history.laid.length || history.cut.length
      ? `You’ve put everything back, so here it is in words: write both in ${unit(x.L, 2)}. ${A} is ${fr(x.ca, x.L)} and ${B} is ${fr(x.cb, x.L)}, so ${x.diff === 0 ? "they are equal" : `${str(m, s, bigger)} is bigger by ${fr(gap, x.L)}`}.`
      : `Before deciding, put both fractions in the same size pieces. ${m.pairs.length ? `Drag the shaded ${unit(x.dA, s.nums[x.a])} onto the ${unit(x.dB, 2)} and count how many ${unit(x.dB, 2)} ${s.nums[x.a] === 1 ? "it covers" : "they cover"}.` : `Cut both into ${unit(x.L, 2)} and count.`}`;
  } else if (x.diff === 0) {
    const k = Math.max(x.dA, x.dB) % Math.min(x.dA, x.dB) === 0 ? Math.max(x.dA, x.dB) / Math.min(x.dA, x.dB) : 0;
    const small = x.dA < x.dB ? x.a : x.b;
    reply = `Exactly the same length. ${A} and ${B} are two names for the same amount: ${A} = ${B}.`
      + (k ? ` Each ${unit(m.rows[small].denominator)} is ${countWords(k, Math.max(x.dA, x.dB))}, so ${countWords(s.nums[small], m.rows[small].denominator)} make ${countWords(s.nums[small] * k, Math.max(x.dA, x.dB))}.` : "")
      + renamed();
  } else if (x.laid && !x.measurable && !x.common) {
    reply = `You can see ${str(m, s, bigger)} is longer, but by how much? ${cap(unit(x.dA, 2))} and ${unit(x.dB, 2)} don’t line up. In ${unit(x.L, 2)}, ${A} is ${fr(x.ca, x.L)} and ${B} is ${fr(x.cb, x.L)}, so ${str(m, s, bigger)} is bigger by ${fr(gap, x.L)}.`
      + (x.cutFix ? ` Cut both rows into ${unit(x.L, 2)} to see that ${unit(x.L)} for yourself.` : "");
  } else if (x.laid) {
    const extra = x.laid.onto === bigger ? "leftover" : "extra";
    reply = `${gap === 1 ? `That ${extra} ${unit(x.L)} is` : `Those ${word(gap)} ${extra} ${unit(x.L, 2)} are`} the whole answer. ${cap(countWords(s.nums[smaller], dS))} ${s.nums[smaller] === 1 ? "is" : "are"} exactly as long as ${countWords(cS, x.L)}${nameAs(smaller, cS)}. ${str(m, s, bigger)}${dBig === x.L ? "" : ` is ${fr(cB, x.L)},`} ${dBig === x.L ? "is " : ""}${word(gap)} more ${unit(x.L, gap)} than that, so it is bigger by ${fr(gap, x.L)}.`;
    const tryRow = [x.a, x.b].find(r => m.canCut(r) && effDen(m, s, r) !== x.L && m.factors.includes(x.L / m.rows[r].denominator));
    reply += cutNow.length || history.cut.length ? renamed()
      : tryRow !== undefined ? ` Try the scissors on the ${str(m, s, tryRow)} bar next. Cutting each ${unit(m.rows[tryRow].denominator)} ${into(x.L / m.rows[tryRow].denominator)} renames ${str(m, s, tryRow)} as ${fr(s.nums[tryRow] * x.L / m.rows[tryRow].denominator, x.L)} without changing its size.` : "";
  } else {
    reply = `Right. In ${unit(x.L, 2)}, ${A} is ${fr(x.ca, x.L)} and ${B} is ${fr(x.cb, x.L)}, so both fractions count the same size piece and ${cB} is more than ${cS}. ${str(m, s, bigger)} is bigger by ${fr(gap, x.L)}.`
      + (m.pairs.length ? " Lay the pieces on top of each other to see the extra one." : "");
  }
  if (history.equal && x.diff !== 0) reply += " You also found a pair that matched exactly, which is what equal fractions look like on a bar.";
  return { learner, data, reply };
}

/* ================= Geometry ================= */
type Geo = ReturnType<typeof geometry>;
function geometry(width: number, m: Model) {
  const compact = width < 430;
  const padL = compact ? 4 : 10;
  const labelW = compact ? 30 : 46;
  const barX = padL + labelW + (compact ? 10 : 14);
  const barW = Math.max(160, width - barX - 20);
  const barH = compact ? 38 : 44;
  const targets = new Set(m.pairs.map(p => p.onto));
  const knifeY: number[] = [], barY: number[] = [], bracketBelow: boolean[] = [];
  let y = 6;
  m.rows.forEach((_, r) => {
    const above = targets.has(r) && !m.canCut(r);
    if (r > 0) y += m.pairs.length ? (above ? 30 : 18) : 16;
    if (m.canCut(r)) { knifeY[r] = y + 10; y += 26; }
    barY[r] = y; y += barH;
    bracketBelow[r] = targets.has(r) && m.canCut(r);
    if (bracketBelow[r]) y += 30;
  });
  const lineY = y + (m.markers ? 44 : 30);
  return {
    compact, width, padL, labelW, barX, barW, barH, knifeY, barY, bracketBelow, lineY,
    height: lineY + 40, inset: 3, radius: compact ? 5 : 6,
    kx0: barX + 12, kx1: barX + barW - 12,
  };
}
const xAt = (g: Geo, m: Model, value: number) => g.barX + value / m.max * g.barW;
const knifeX = (g: Geo, knife: number) => g.kx0 + knife * (g.kx1 - g.kx0);
/* Each base piece is cut as the blade crosses its middle, so cuts appear one after another. */
const seamAt = (g: Geo, knife: number, center: number) => clamp((knifeX(g, knife) - center) / 9 + .5);
/* Rounded rectangle with independent left/right radii and a fixed command list, so any two blend. */
function slab(x0: number, x1: number, h: number, rl: number, rr: number) {
  return `M ${x0 + rl} 0 H ${x1 - rr} Q ${x1} 0 ${x1} ${rr} V ${h - rr} Q ${x1} ${h} ${x1 - rr} ${h} H ${x0 + rl} Q ${x0} ${h} ${x0} ${h - rl} V ${rl} Q ${x0} 0 ${x0 + rl} 0 Z`;
}

function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setReduce(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduce;
}

export function Frac({ num, den, tone }: { num: number | string; den: number | string; tone: Tone | "plain" }) {
  return <span className={`nl-frac nl-tone-${tone}`}><span>{num}</span><span>{den}</span></span>;
}


/** Dragology listens for pointerup only, so an interrupted gesture (pointercancel, window blur) would leave
    the drag live and the next pointerup would apply the hovered edit. Remount the renderer instead: the
    preview is discarded and the last committed state stays. */
function useCancelGesture(active: boolean, cancel: () => void) {
  const ref = useRef({ active, cancel });
  ref.current = { active, cancel };
  useEffect(() => {
    const on = () => { if (!ref.current.active) return; document.body.style.cursor = ""; ref.current.cancel(); };
    document.addEventListener("pointercancel", on);
    window.addEventListener("blur", on);
    return () => { document.removeEventListener("pointercancel", on); window.removeEventListener("blur", on); };
  }, []);
}

/* ================= Component ================= */
export function NumberLine(props: NumberLineProps) {
  /* Older callers spread the config as props; accept both shapes. */
  const config = (props.config ?? props) as NumberLineConfig;
  const errors = useMemo(() => validateNumberLine(config), [config]);
  if (errors.length) return <Fallback errors={errors} />;
  return <Guard><NumberLineView config={config} onChange={props.onChange} onShare={props.onShare} /></Guard>;
}

function Fallback({ errors }: { errors: string[] }) {
  return <section className="activity number-line nl-fallback" data-simulation="number-line" data-invalid="true">
    <p className="nl-fallback-line">This number line couldn’t be set up. Ask Keating to try again, or to explain it in words.</p>
    <details className="receipt"><summary>What was wrong</summary>
      <ul className="nl-fallback-errors">{errors.slice(0, 6).map(e => <li key={e}>{e}</li>)}</ul>
    </details>
  </section>;
}

/* Last line of defence: an error inside the canvas must never blank the conversation. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("NumberLine recovered from", error); }
  render() {
    return this.state.failed
      ? <section className="activity number-line nl-fallback" data-simulation="number-line" data-crashed="true">
          <p className="nl-fallback-line">Something went wrong with that move.</p>
          <div className="actions nl-actions"><button type="button" className="quiet" onClick={() => this.setState({ failed: false })}>Start over</button></div>
        </section>
      : this.props.children;
  }
}

function NumberLineView({ config, onChange, onShare }: NumberLineProps) {
  const m = useModel(config);
  const p = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [state, setState] = useState<S>(m.start);
  const [history, setHistory] = useState<History>({ laid: [], cut: [], equal: false });
  const [epoch, setEpoch] = useState(0);
  const [status, setStatus] = useState("");
  const [past, setPast] = useState<{ state: S; history: History }[]>([]);
  const [holding, setHolding] = useState<"" | "piece" | "knife" | "pin">("");
  useCancelGesture(holding !== "", () => { setEpoch(k => k + 1); setHolding(""); setStatus("Drag interrupted. Nothing changed."); });
  const reduce = useReducedMotion();
  const drop = reduce ? false : { easing: "cubic-out" as const, duration: 260 };
  const tone = (r: number): Tone => m.rows[r].tone ?? (["a", "b", "c"] as const)[r % 3];

  useEffect(() => { setState(m.start); setHistory({ laid: [], cut: [], equal: false }); setPast([]); }, [m]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function commit(next: S, how: "drag" | "button" | "undo") {
    const prev = state;
    const same = next.laid === prev.laid && next.nums.every((v, i) => v === prev.nums[i])
      && next.knives.every((v, i) => v === prev.knives[i]) && next.picks.every((v, i) => v === prev.picks[i]);
    if (same) { if (next !== prev) setState(next); return; }
    if (how !== "undo") setPast(list => [...list.slice(-30), { state: prev, history }]);
    setState(next);
    if (how !== "drag" && reduce) setEpoch(v => v + 1);
    const x = analyse(m, next);
    setHistory(h => ({
      laid: next.laid && !h.laid.includes(next.laid) ? [...h.laid, next.laid] : h.laid,
      cut: [...h.cut, ...next.knives.map((k, r) => k >= 1 ? r : -1).filter(r => r >= 0 && !h.cut.includes(r))],
      equal: h.equal || (!!x && (!!x.laid || x.common) && x.diff === 0),
    }));
    const changedRow = next.nums.findIndex((v, i) => v !== prev.nums[i]);
    const knifeRow = next.knives.findIndex((v, i) => v !== prev.knives[i]);
    const pickRow = next.picks.findIndex((v, i) => v !== prev.picks[i]);
    const laid = parseLaid(next.laid);
    setStatus(next.laid !== prev.laid
      ? laid ? `${str(m, next, laid.from)} laid on the ${str(m, next, laid.onto)} bar. ${sentence(m, next, history)}` : `${str(m, next, parseLaid(prev.laid)!.from)} lifted back to its own bar.`
      : knifeRow >= 0 ? (next.knives[knifeRow] >= 1
        ? `Every ${unit(m.rows[knifeRow].denominator)} cut ${into(next.picks[knifeRow])}. ${str(m, next, knifeRow)} is now ${fr(next.nums[knifeRow] * next.picks[knifeRow], effDen(m, next, knifeRow))}.`
        : `The ${unit(m.rows[knifeRow].denominator, 2)} are whole again.`)
      : pickRow >= 0 ? `Scissors on ${m.name(pickRow).toLowerCase()} cut each piece ${into(next.picks[pickRow])}.`
      : changedRow >= 0 ? `${m.name(changedRow)}: ${str(m, next, changedRow)}.` : "");
    onChange?.();
  }

  const g = geometry(width, m);
  const id = (name: string) => `${p}-${name}`;
  const x = analyse(m, state);
  const laidNow = parseLaid(state.laid);

  /* Dragology blends between preview renders, so an element that exists in more than one candidate
     keeps the same id, classes and path commands in every one; what changes is carried by
     transforms, path numbers and opacity. Elements that exist in only one state (ghost slots, the
     difference bracket, the drag hint) have ids of their own and fade. Every id'd element carries
     its own tone class, because Dragology lifts it into a separate layer away from its parent. */
  const draggable: Draggable<S> = ({ state: s, d: drag, draggedId }) => {
    const ph = g.barH - 2 * g.inset;
    const laid = parseLaid(s.laid);
    const pieceDragged = !!draggedId && draggedId.includes("-pc-");
    const out: ReactNode[] = [];

    const layOnSpec = (from: number) => () => {
      if (laid) return drag.between([{ ...s, laid: "" }, s]).withSnapRadius(18).withDropTransition(drop);
      const targets = m.pairs.filter(pr => pr.from === from).map(pr => ({ ...s, laid: `${from}>${pr.onto}` }));
      const specs = targets.map(t => drag.between([s, t]).withSnapRadius(18));
      return (specs.length === 1 ? specs[0] : drag.closest(specs, { lockPast: 24 })).withDropTransition(drop);
    };
    const cutSpec = (r: number) => () => drag.vary(s, param<S>("knives", r), { constraint: v => inOrder([0, v.knives[r], 1]) })
      .onDrop(v => ({ ...v, knives: v.knives.map((k, i) => i === r ? (k >= .5 ? 1 : 0) : k) })).withDropTransition(drop);

    m.rows.forEach((row, r) => {
      const d = row.denominator, n = s.nums[r], f = s.picks[r], t = tone(r);
      const u = g.barW / (m.max * d);
      const y = g.barY[r];
      const seams = Array.from({ length: m.max * d }, (_, i) => m.canCut(r) ? seamAt(g, s.knives[r], g.barX + (i + .5) * u) : 0);
      const cutAll = m.canCut(r) ? clamp(seams.reduce((a, b) => a + b, 0) / Math.max(1, seams.length)) : 0;

      /* Bar with its partition. Cut lines inside each base cell fade in as the blade passes. */
      out.push(<g id={id(`bar-${r}`)} data-nl-bar={r} className={`nl-bar nl-tone-${t}`}>
        <rect className="nl-bar-body" transform={translate(g.barX, y)} width={g.barW} height={g.barH} rx={g.radius + 2} />
        {Array.from({ length: m.max * d - 1 }, (_, i) => <line className={`nl-cell-line${(i + 1) % d === 0 ? " is-whole" : ""}`}
          x1={g.barX + (i + 1) * u} x2={g.barX + (i + 1) * u} y1={y + ((i + 1) % d === 0 ? 2 : 4)} y2={y + g.barH - ((i + 1) % d === 0 ? 2 : 4)} />)}
        {m.canCut(r) && Array.from({ length: m.max * d }, (_, i) => Array.from({ length: f - 1 }, (_, k) =>
          <line className="nl-cut-line" opacity={seams[i]} x1={g.barX + (i + (k + 1) / f) * u} x2={g.barX + (i + (k + 1) / f) * u} y1={y + 5} y2={y + g.barH - 5} />))}
      </g>);

      /* Fraction label beside the bar, crossfading to its renamed form as the row is cut. */
      const label = (num: number, den: number, name: string, opacity: number) =>
        <g id={id(name)} className={`nl-label nl-tone-${t}`} transform={translate(g.padL + g.labelW / 2, y + g.barH / 2)} opacity={opacity}>
          <text className="nl-label-num" transform={translate(0, -9)} textAnchor="middle" dominantBaseline="central">{num}</text>
          <line className="nl-label-rule" x1={-10} x2={10} y1={0} y2={0} />
          <text className="nl-label-den" transform={translate(0, 10)} textAnchor="middle" dominantBaseline="central">{den}</text>
        </g>;
      out.push(label(n, d, `label-${r}`, 1 - cutAll));
      if (m.canCut(r)) out.push(label(n * f, d * f, `label-${r}-cut`, cutAll));

      /* Layering: plain z-indexes here are top-level paths [3]…[9], so a carried piece must use an
         absolute path above all of them ("/20"); "/1" would sort under the bar it is carried onto. */
      /* Pieces. Each shaded base piece is f sub-pieces. Joined, they read as one piece; cut, or laid
         on a row whose partition they match, a gap opens and each rounds off. */
      const from = laid?.from === r ? laid : undefined;
      const coveredBy = laid?.onto === r;
      const draggableRow = m.pairs.some(pr => pr.from === r) && !coveredBy;
      const py = (from ? g.barY[from.onto] : y) + g.inset;
      const aligned = from ? (effDen(m, s, from.onto) % (d * f) === 0) : false;
      const subW = u / f;
      for (let i = 0; i < n; i++) {
        const split = f === 1 ? 1 : aligned ? 1 : seams[i];
        for (let k = 0; k < f; k++) {
          const outerL = k === 0, outerR = k === f - 1;
          const inner = 2.5 * split - .5 * (1 - split);
          const x0 = outerL ? 2 : inner, x1 = subW - (outerR ? 2 : inner);
          const shape = slab(x0, x1, ph, outerL ? g.radius : g.radius * split, outerR ? g.radius : g.radius * split);
          const pid = `r${r}-pc-${i}-${k}`;
          out.push(<g id={id(pid)} data-nl-piece={`${r}-${i}-${k}`} className={`nl-piece nl-tone-${t}${m.pairs.some(pr => pr.from === r) ? " is-draggable" : ""}`}
            transform={translate(g.barX + i * u + k * subW, py)}
            dragologyZIndex={pieceDragged && (from || draggedId!.includes(`-r${r}-`)) ? "/20" : from ? 6 : 3}
            dragologyEmergeFrom={i > 0 ? id(`r${r}-pc-0-${k}`) : undefined} dragologyEmergeMode="clone"
            dragologyOnDrag={draggableRow ? layOnSpec(r) : undefined}>
            <path d={shape} className="nl-piece-body" />
            <path d={shape} className="nl-piece-edge" opacity={split} />
            {subW >= 21 && <text className="nl-piece-text" transform={translate((x0 + x1) / 2, ph / 2) + scale(.25 + .75 * split)}
              opacity={split} textAnchor="middle" dominantBaseline="central">{fr(1, d * f)}</text>}
          </g>);
        }
        if (f > 1) {
          /* One outline and label per base piece, drawn over its sub-pieces while they are joined.
             Labels shrink as they fade so mid-split labels never overlap. */
          out.push(<g id={id(`r${r}-whole-${i}`)} className={`nl-whole nl-tone-${t}`} pointerEvents="none" opacity={1 - split}
            transform={translate(g.barX + i * u, py)} dragologyZIndex={pieceDragged && (from || draggedId!.includes(`-r${r}-`)) ? "/21" : from ? 7 : 4}
            dragologyEmergeFrom={i > 0 ? id(`r${r}-whole-0`) : undefined} dragologyEmergeMode="clone">
            <path d={slab(2, u - 2, ph, g.radius, g.radius)} className="nl-piece-edge" />
            {u >= 24 && <text className="nl-piece-text nl-piece-text--whole" transform={translate(u / 2, ph / 2) + scale(1 - .75 * split)}
              textAnchor="middle" dominantBaseline="central">{fr(1, d)}</text>}
          </g>);
        }
      }
      if (from) {
        for (let i = 0; i < n; i++) out.push(<path id={id(`r${r}-ghost-${i}`)} className={`nl-ghost nl-tone-${t}`}
          transform={translate(g.barX + i * u, y + g.inset)} d={slab(2, u - 2, ph, g.radius, g.radius)} />);
      }

      /* Scissors */
      if (m.canCut(r)) {
        const ky = g.knifeY[r], kx = knifeX(g, s.knives[r]);
        out.push(<g id={id(`track-${r}`)} className="nl-knife-track" pointerEvents="none">
          <line x1={g.kx0} x2={g.kx1} y1={ky} y2={ky} />
          {s.knives[r] < .5
            ? <path id={id(`track-${r}-r`)} d={`M ${g.kx1 - 5} ${ky - 4} L ${g.kx1} ${ky} L ${g.kx1 - 5} ${ky + 4}`} />
            : <path id={id(`track-${r}-l`)} d={`M ${g.kx0 + 5} ${ky - 4} L ${g.kx0} ${ky} L ${g.kx0 + 5} ${ky + 4}`} />}
        </g>);
        const many = m.factors.length > 1;
        const w = many ? 40 : 24;
        out.push(<g id={id(`knife-${r}`)} data-nl-knife={r} className={`nl-knife nl-tone-${t}`} transform={translate(kx, ky)} dragologyZIndex={8}
          dragologyOnDrag={cutSpec(r)}
          onClick={many && s.knives[r] < .5 ? () => {
            const next = m.factors[(m.factors.indexOf(s.picks[r]) + 1) % m.factors.length];
            commit({ ...s, picks: s.picks.map((v, i) => i === r ? next : v) }, "button");
          } : undefined}>
          <line className="nl-blade" x1={0} x2={0} y1={10} y2={y - ky + 3} />
          <rect className="nl-knife-hit" x={-w / 2 - 6} y={-16} width={w + 12} height={32} />
          <rect className="nl-knife-body" x={-w / 2} y={-10} width={w} height={20} rx={10} />
          <Scissors x={many ? -w / 2 + 5 : -6.5} y={-6.5} width={13} height={13} strokeWidth={2.2} className="nl-knife-icon" />
          {many && <text className="nl-knife-text" transform={translate(w / 2 - 6, 0.5)} textAnchor="end" dominantBaseline="central">×{f}</text>}
        </g>);
      }
    });

    /* The difference, once one row's pieces rest on another. */
    if (laid) {
      const X = laid.from, Y = laid.onto;
      const dX = m.rows[X].denominator, dY = m.rows[Y].denominator, L = lcm(dX, dY);
      const vx = s.nums[X] / dX, vy = s.nums[Y] / dY;
      const diff = s.nums[Y] * L / dY - s.nums[X] * L / dX;
      const lo = xAt(g, m, Math.min(vx, vy)), hi = xAt(g, m, Math.max(vx, vy));
      const below = g.bracketBelow[Y];
      const by = below ? g.barY[Y] + g.barH + 9 : g.barY[Y] - 9;
      const ty = below ? by + 13 : by - 9;
      const dir = below ? -5 : 5;
      if (diff !== 0) {
        const caption = `${fr(Math.abs(diff), L)} ${diff > 0 ? "left over" : "too long"}`;
        const xl = lo + 3, xr = hi - 3;
        const fits = xl + caption.length * 6.6 <= g.barX + g.barW;
        const t = diff > 0 ? tone(Y) : tone(X);
        /* The id names the pair and the direction, so each id always carries the same tone class. */
        out.push(<g id={id(`diff-${diff > 0 ? "more" : "over"}-${X}-${Y}`)} className={`nl-diff nl-tone-${t}`} pointerEvents="none">
          <rect className="nl-diff-glow" transform={translate(lo + 1, g.barY[Y] + 1)} width={Math.max(2, hi - lo - 2)} height={g.barH - 2} rx={g.radius + 1} />
          <path className="nl-diff-bracket" d={`M ${xl} ${by + dir} V ${by} H ${Math.max(xl + 2, xr)} V ${by + dir}`} />
          <text dragologyKey={fits ? "caption-start" : "caption-end"} className="nl-diff-text" transform={translate(fits ? xl : xr, ty)} textAnchor={fits ? "start" : "end"} dominantBaseline="central">{caption}</text>
        </g>);
      } else {
        out.push(<g id={id(`diff-equal-${X}-${Y}`)} className="nl-diff nl-tone-plain" pointerEvents="none">
          <path className="nl-diff-bracket" d={`M ${lo} ${g.barY[Y] - 6} V ${g.barY[Y] + g.barH + 6}`} />
          <text className="nl-diff-text" transform={translate(clamp(lo, g.barX + 30, g.barX + g.barW - 30), ty)} textAnchor="middle" dominantBaseline="central">exact fit</text>
        </g>);
      }
    }

    /* Drag hint for the first lay-on move, while nothing is laid. */
    const first = m.pairs[0];
    if (first && !laid && !draggedId && s.nums[first.from] > 0) {
      const down = first.onto > first.from;
      const yA = g.barY[first.from], yB = g.barY[first.onto];
      const mid = down ? (yA + g.barH + yB) / 2 : (yB + g.barH + yA) / 2;
      out.push(<g id={id("hint")} className={`nl-hint nl-tone-${tone(first.from)}`} pointerEvents="none"
        transform={translate(xAt(g, m, s.nums[first.from] / m.rows[first.from].denominator / 2), mid + (down ? -4 : 4)) + (down ? "" : " rotate(180)")}>
        <g className="nl-hint-bob"><path d="M -5 -4 L 0 1 L 5 -4" /><path d="M -5 2 L 0 7 L 5 2" /></g>
      </g>);
    }

    /* Number line on the same scale as the bars. */
    const tickDen = (() => {
      const L = m.rows.reduce((acc, row) => lcm(acc, row.denominator), 1);
      return L * m.max <= 32 ? L : Math.max(...m.rows.map(row => row.denominator));
    })();
    const downPins = m.rows.map((_, r) => r).filter(r => r % 2 === 1).map(r => s.nums[r] / m.rows[r].denominator);
    out.push(<g id={id("line")} className="nl-line" pointerEvents="none">
      <line className="nl-axis" x1={g.barX} x2={g.barX + g.barW} y1={g.lineY} y2={g.lineY} />
      {Array.from({ length: m.max * tickDen + 1 }, (_, k) => {
        const whole = k % tickDen === 0;
        return <line className={`nl-tick${whole ? " is-whole" : ""}`} x1={g.barX + k / tickDen / m.max * g.barW} x2={g.barX + k / tickDen / m.max * g.barW}
          y1={g.lineY - (whole ? 6 : 3)} y2={g.lineY + (whole ? 6 : 3)} />;
      })}
      <text className="nl-axis-text" transform={translate(g.barX - 9, g.lineY)} textAnchor="end" dominantBaseline="central">0</text>
      <text className="nl-axis-text" transform={translate(g.barX + g.barW + 9, g.lineY)} textAnchor="start" dominantBaseline="central">{m.max}</text>
      {Array.from({ length: m.max - 1 }, (_, k) => k + 1).map(v => <text className="nl-axis-text"
        transform={translate(xAt(g, m, v), g.lineY + 17)} textAnchor="middle" dominantBaseline="central"
        opacity={downPins.some(pv => Math.abs(pv - v) < .26 / m.max) ? 0 : 1}>{v}</text>)}
    </g>);
    if (x) {
      const va = s.nums[x.a] / x.dA, vb = s.nums[x.b] / x.dB;
      const lo = xAt(g, m, Math.min(va, vb)), hi = xAt(g, m, Math.max(va, vb));
      /* One span per direction, each with a fixed tone. Which one shows is carried by opacity, so the
         className of every id'd element is the same in every drop candidate (Dragology can't blend
         class strings: "Cannot lerp prop className"). */
      const span = (name: string, r: number, on: boolean) => <rect id={id(name)} className={`nl-line-diff nl-tone-${tone(r)}`} pointerEvents="none"
        transform={translate(lo, g.lineY - 2)} width={Math.max(1, hi - lo)} height={4} rx={2} opacity={on ? 1 : 0} />;
      out.push(span("line-diff-b", x.b, vb > va), span("line-diff-a", x.a, va > vb));
    }
    if (m.target && s.nums[m.target.row] * m.target.q === m.target.p * m.rows[m.target.row].denominator) {
      out.push(<g id={id("target-hit")} className="nl-target nl-tone-plain" pointerEvents="none" transform={translate(xAt(g, m, m.target.p / m.target.q), g.lineY)}>
        <circle r={11} />
      </g>);
    }
    m.rows.forEach((row, r) => {
      if (!m.markers) return;
      const up = r % 2 === 0, t = tone(r);
      const editable = !!row.editable;
      const states = editable ? Array.from({ length: m.maxN(r) - m.minN(r) + 1 }, (_, k) => ({ ...s, nums: s.nums.map((v, i) => i === r ? m.minN(r) + k : v) })) : [];
      out.push(<g id={id(`pin-${r}`)} data-nl-pin={r} className={`nl-pin nl-tone-${t}${editable ? " is-draggable" : ""}`}
        transform={translate(xAt(g, m, s.nums[r] / row.denominator), g.lineY)} dragologyZIndex={9}
        dragologyOnDrag={editable ? () => drag.closest(states).withBranchTransition(reduce ? false : 110).withDropTransition(drop) : undefined}>
        <rect className="nl-pin-hit" x={-15} y={up ? -34 : 0} width={30} height={34} />
        <path className="nl-pin-mark" d={up ? "M 0 -2 L -6 -11 Q -7 -17 0 -17 Q 7 -17 6 -11 Z" : "M 0 2 L -6 11 Q -7 17 0 17 Q 7 17 6 11 Z"} />
        <text className="nl-pin-text" transform={translate(0, up ? -25 : 28)} textAnchor="middle" dominantBaseline="central">{str(m, s, r)}</text>
      </g>);
    });
    /* Guides from each row's shaded end to the line. */
    out.unshift(<g id={id("guides")} className="nl-guides" pointerEvents="none">
      {m.rows.map((row, r) => {
        const gx = xAt(g, m, s.nums[r] / row.denominator);
        return <line className={`nl-guide nl-tone-${tone(r)}`} x1={gx} x2={gx} y1={g.barY[r] + g.barH} y2={g.lineY + (r % 2 ? 3 : -3)} />;
      })}
    </g>);
    return <g>{out}</g>;
  };

  /* ================= Moves shared by drags and buttons ================= */
  const lay = (pair?: Pair) => commit({ ...state, laid: pair ? `${pair.from}>${pair.onto}` : "" }, "button");
  const setKnife = (r: number, on: boolean) => commit({ ...state, knives: state.knives.map((k, i) => i === r ? (on ? 1 : 0) : k) }, "button");
  const setPick = (r: number, f: number) => commit({ ...state, picks: state.picks.map((v, i) => i === r ? f : v) }, "button");
  const setNum = (r: number, v: number) => commit({ ...state, nums: state.nums.map((n, i) => i === r ? clamp(v, m.minN(r), m.maxN(r)) : n) }, "button");
  const cutTo = (rows: number[]) => {
    const L = x!.L;
    commit({ ...state, picks: state.picks.map((f, i) => rows.includes(i) ? L / m.rows[i].denominator : f), knives: state.knives.map((k, i) => rows.includes(i) ? 1 : k) }, "button");
  };
  const reset = () => { commit(m.start, "button"); setHistory({ laid: [], cut: [], equal: false }); setStatus("Back to the start."); };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(list => list.slice(0, -1));
    commit(last.state, "undo");
    setHistory(last.history);
    setStatus(`Undone. ${sentence(m, last.state, last.history)}`);
  };

  /* ================= Instruction, derived ================= */
  type Instruction = { icon: typeof Check; text: ReactNode; action?: { label: string; run: () => void } };
  let instruction: Instruction;
  if (m.target) {
    const t = placeInfo(m, state);
    instruction = t.done ? { icon: Check, text: <>That’s <strong>{t.T}</strong>. Try another number with the marker, or share it with Keating.</> }
      : { icon: MapPin, text: <>Drag the marker to where <strong>{t.T}</strong> belongs. Count {unit(t.q, 2)} from 0{t.p > t.q ? ", and keep going past 1" : ""}.</> };
  } else if (x) {
    const firstPair = m.pairs.find(pr => [x.a, x.b].includes(pr.from) && [x.a, x.b].includes(pr.onto));
    const ready = (x.laid && x.measurable) || x.common;
    const cutRow = x.need.length === 1 ? x.need[0] : undefined;
    if (!x.laid && firstPair && !x.common) {
      const X = firstPair.from, f = factorOf(state, X);
      const dir = firstPair.onto > firstPair.from ? "down" : "up";
      instruction = { icon: dir === "down" ? ArrowDown : ArrowUp,
        text: f > 1 ? <>Each {unit(m.rows[X].denominator)} is now {count(f, m.rows[X].denominator * f)}. Drag the shaded pieces {dir} onto <strong>{str(m, state, firstPair.onto)}</strong>.</>
          : <>Drag the shaded {unit(m.rows[X].denominator, state.nums[X])} {dir} onto the <strong>{str(m, state, firstPair.onto)}</strong> bar and see how much {state.nums[X] === 1 ? "it covers" : "they cover"}.</>,
        action: { label: "Lay it on", run: () => lay(firstPair) } };
    } else if (!x.common && x.cutFix) {
      const lead = mismatchNote(m, state, x) ? <>{cap(unit(effDen(m, state, x.a), 2))} and {unit(effDen(m, state, x.b), 2)} still don’t line up. </>
        : x.laid && x.measurable && x.diff !== 0 ? (() => {
        const cx = x.laid!.from === x.a ? x.ca : x.cb, cy = x.laid!.from === x.a ? x.cb : x.ca, k = x.eOnto / x.L;
        return <>{cap(countWords(state.nums[x.laid!.from], m.rows[x.laid!.from].denominator))} {state.nums[x.laid!.from] === 1 ? "covers" : "cover"} {countWords(cx * k, x.eOnto)}, with {count(Math.abs(cy - cx) * k, x.eOnto)} {cy > cx ? "left over" : "too many"}. </>;
      })() : x.laid && !x.measurable ? <>The gap isn’t a whole number of {unit(x.dA, 2)} or {unit(x.dB, 2)}. </> : null;
      /* With one possible factor the cut is the move; with several, choosing it is the learner's step,
         so the text doesn't name it and the button is a hint. */
      const choose = m.factors.length > 1;
      instruction = cutRow !== undefined
        ? { icon: Scissors, text: choose
            ? <>{lead}Tap the scissors on the {str(m, state, cutRow)} bar to choose how many pieces, then drag them along until its pieces line up with the {unit(m.rows[cutRow === x.a ? x.b : x.a].denominator, 2)}.</>
            : <>{lead}Now drag the scissors along the {str(m, state, cutRow)} bar to cut every {unit(m.rows[cutRow].denominator)} {into(x.L / m.rows[cutRow].denominator)}.</>,
            action: { label: choose ? "Show me" : x.L / m.rows[cutRow].denominator === 2 ? "Cut in half" : `Cut into ${unit(x.L / m.rows[cutRow].denominator, 2)}`, run: () => cutTo([cutRow]) } }
        : { icon: Scissors, text: <>{lead}Cut both rows into pieces of one size: tap each pair of scissors to choose how many pieces, then drag it along its bar.</>,
            action: { label: "Show me", run: () => cutTo(x.need) } };
    } else if (ready) {
      const e = x.common ? effDen(m, state, x.a) : x.eOnto;
      instruction = { icon: Check, text: <>{x.common ? <>Both bars count {unit(e, 2)} now. </> : x.diff === 0 ? <>An exact fit. </> : null}
        {m.markers && m.rows.some(r => r.editable) ? "Drag the markers on the line to try other fractions." : "Share it with Keating."}</> };
    } else {
      instruction = { icon: Layers, text: <>Compare <strong>{str(m, state, x.a)}</strong> and <strong>{str(m, state, x.b)}</strong> on the line.</> };
    }
  } else {
    instruction = { icon: MapPin, text: <>Drag the marker to change <strong>{str(m, state, 0)}</strong>.</> };
  }
  const Icon = instruction.icon;

  /* ================= Readout, derived ================= */
  let equation: ReactNode, equationLabel: string;
  if (m.target) {
    const t = placeInfo(m, state);
    const op = t.cv < t.ct ? "<" : t.cv > t.ct ? ">" : "=";
    const whole = Math.floor(t.p / t.q), rest = t.p % t.q;
    equation = <><Frac num={t.n} den={t.d} tone={tone(t.row)} />
      {t.done && whole > 0 ? <><span className="nl-op is-known">=</span><span className="nl-mixed">{whole}{rest ? <Frac num={rest} den={t.q} tone="plain" /> : null}</span></>
        : <><span className="nl-op is-known">{op}</span><Frac num={t.p} den={t.q} tone="plain" /></>}</>;
    equationLabel = `${t.at} ${op === "<" ? "is less than" : op === ">" ? "is more than" : "equals"} ${t.T}`;
  } else if (x) {
    const discovered = !!x.laid || x.common || x.dA === x.dB;
    const named = discovered && ((x.laid && x.measurable) || x.common);
    const op = x.diff > 0 ? "<" : x.diff < 0 ? ">" : "=";
    /* Rename into the common denominator only where it adds something: "1/2 = 3/6", not "1/2 = 3/6 = 3/6". */
    const showA = named && x.dA !== x.L && !(x.diff === 0 && x.dB === x.L);
    const showB = named && x.dB !== x.L && !(x.diff === 0 && x.dA === x.L);
    equation = <>
      <Frac num={state.nums[x.a]} den={x.dA} tone={tone(x.a)} />
      {showA && <><span className="nl-op">=</span><Frac num={x.ca} den={x.L} tone={tone(x.a)} /></>}
      <span className={`nl-op${discovered ? " is-known" : ""}`}>{discovered ? op : "?"}</span>
      {showB && <><Frac num={x.cb} den={x.L} tone={tone(x.b)} /><span className="nl-op">=</span></>}
      <Frac num={state.nums[x.b]} den={x.dB} tone={tone(x.b)} />
    </>;
    const rel = x.diff > 0 ? "less than" : x.diff < 0 ? "greater than" : "equal to";
    equationLabel = discovered
      ? `${str(m, state, x.a)}${showA ? ` equals ${fr(x.ca, x.L)},` : " is"} ${rel} ${showB ? `${fr(x.cb, x.L)}, which equals ` : ""}${str(m, state, x.b)}`
      : `${str(m, state, x.a)} compared with ${str(m, state, x.b)}`;
  } else {
    equation = <Frac num={state.nums[0]} den={m.rows[0].denominator} tone={tone(0)} />;
    equationLabel = str(m, state, 0);
  }

  const title = config.title ?? (m.target ? <>Where does <Frac num={m.target.p} den={m.target.q} tone="plain" /> go?</>
    : x ? m.goal?.kind === "equivalent"
      ? <>Is <Frac num={m.start.nums[x.a]} den={x.dA} tone={tone(x.a)} /> the same as <Frac num={m.start.nums[x.b]} den={x.dB} tone={tone(x.b)} />?</>
      : m.pairs.length ? <>Lay <Frac num={m.start.nums[m.pairs[0].from]} den={m.rows[m.pairs[0].from].denominator} tone={tone(m.pairs[0].from)} /> on <Frac num={m.start.nums[m.pairs[0].onto]} den={m.rows[m.pairs[0].onto].denominator} tone={tone(m.pairs[0].onto)} /></>
      : <>Compare <Frac num={m.start.nums[x.a]} den={x.dA} tone={tone(x.a)} /> and <Frac num={m.start.nums[x.b]} den={x.dB} tone={tone(x.b)} /></>
    : "Fractions on a line");

  const cutRowsShown = m.cutRows;
  const editableRows = m.rows.map((_, r) => r).filter(r => m.rows[r].editable);
  const hasButtons = m.pairs.length || cutRowsShown.length || (m.steppers && editableRows.length);

  return <section className="activity number-line" data-simulation="number-line"
    data-laid={state.laid} data-nums={state.nums.join(",")} data-cuts={state.knives.map(k => k >= 1 ? 1 : 0).join(",")}
    data-dens={state.nums.map((_, r) => effDen(m, state, r)).join(",")}>
    <div className="nl-head"><h3>{title}</h3></div>
    <p className="nl-instruction">
      <span><Icon size={15} strokeWidth={2.2} aria-hidden="true" className="nl-instruction-icon" />{instruction.text}</span>
      {instruction.action && <button type="button" className="quiet nl-instruction-do" onClick={instruction.action.run}>{instruction.action.label}</button>}
    </p>
    <div className={`nl-canvas${holding ? ` is-holding-${holding}` : ""}`} ref={canvas} aria-hidden="true">
      <DraggableRenderer key={epoch} draggable={draggable} state={state} width={width} height={g.height}
        onDropState={next => commit(next, "drag")}
        onDragStatus={st => {
          const dragged = st.type === "dragging" ? st.behaviorCtx.draggedId ?? "" : "";
          const next = !dragged ? "" : dragged.includes("-pc-") ? "piece" : dragged.includes("-knife-") ? "knife" : "pin";
          setHolding(h => h === next ? h : next);
        }} />
    </div>
    <div className="nl-readout">
      <p className="nl-equation" aria-label={equationLabel}>{equation}</p>
      <p className="nl-why">{sentence(m, state, history)}</p>
    </div>
    {hasButtons ? <details className="receipt nl-controls">
      <summary>Use buttons instead</summary>
      <div className="nl-rows">
        {m.pairs.length > 0 && <div className="nl-row">
          <span className="nl-row-label">Lay on</span>
          <span className="nl-row-buttons">
            {m.pairs.map(pr => {
              const on = laidNow?.from === pr.from && laidNow.onto === pr.onto;
              return <button key={`${pr.from}>${pr.onto}`} type="button" className="nl-button" aria-pressed={on} onClick={() => lay(on ? undefined : pr)}>
                <Layers size={14} aria-hidden="true" />{on ? `Lift ${str(m, state, pr.from)} back` : `Lay ${str(m, state, pr.from)} on ${str(m, state, pr.onto)}`}</button>;
            })}
          </span>
        </div>}
        {cutRowsShown.map(r => {
          const cut = state.knives[r] >= 1, units = unit(m.rows[r].denominator, 2);
          return <div className="nl-row" key={`cut-${r}`}>
            <span className="nl-row-label">Cut {str(m, state, r)}</span>
            <span className="nl-row-buttons">
              {m.factors.length > 1 && <span className="nl-factor" role="group" aria-label={`Cut each ${unit(m.rows[r].denominator)} into`}>
                {m.factors.map(f => <button key={f} type="button" className="nl-button nl-chip" aria-pressed={state.picks[r] === f}
                  aria-label={`Into ${f}`} onClick={() => setPick(r, f)}>×{f}</button>)}
              </span>}
              <button type="button" className="nl-button" aria-pressed={cut} onClick={() => setKnife(r, !cut)}>
                <Scissors size={14} aria-hidden="true" />{cut ? `Join the ${units}` : `Cut ${units} ${into(state.picks[r])}`}
              </button>
            </span>
          </div>;
        })}
        {m.steppers && editableRows.map(r => {
          const d = m.rows[r].denominator;
          const dup = m.rows.filter(row => row.denominator === d).length > 1;
          const suffix = dup ? ` on ${m.name(r).toLowerCase()}` : "";
          return <div className="nl-row" key={`step-${r}`}>
            <span className="nl-row-label">{m.name(r)}</span>
            <span className="nl-stepper" role="group" aria-label={`${m.name(r)} ${unit(d, 2)}`}>
              <button type="button" className="nl-button nl-step" aria-label={`One fewer ${unit(d)}${suffix}`} disabled={state.nums[r] <= m.minN(r)} onClick={() => setNum(r, state.nums[r] - 1)}>−</button>
              <output className={`nl-step-value nl-tone-${tone(r)}`}>{str(m, state, r)}</output>
              <button type="button" className="nl-button nl-step" aria-label={`One more ${unit(d)}${suffix}`} disabled={state.nums[r] >= m.maxN(r)} onClick={() => setNum(r, state.nums[r] + 1)}>+</button>
            </span>
          </div>;
        })}
      </div>
    </details> : null}
    <div className="actions nl-actions">
      <button type="button" className="primary" onClick={() => onShare?.(shareSummary(m, state, history))}>{SHARE_LABEL}</button>
      <button type="button" className="quiet" onClick={undo} disabled={!past.length}><Undo2 size={13} aria-hidden="true" /> Undo</button>
      <button type="button" className="quiet" onClick={reset}><RotateCcw size={13} aria-hidden="true" /> Start over</button>
    </div>
    <span className="learning-lab__sr-only" role="status">{status}</span>
  </section>;
}
