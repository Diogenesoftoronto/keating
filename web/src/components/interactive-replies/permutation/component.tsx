import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DraggableRenderer, Vec2, rotateDeg, translate, type Draggable } from "dragology";
import "./component.css";
import { useCancelGesture } from "../hooks";

/* ============================================================================
   PermutationLab: one permutation, seen several linked ways at once.
   - tiles: the arrangement itself (drag a tile onto another to swap them)
   - strands: the arrow (two-line) diagram, drawn as wires from row to row
   - cycle notation, parity, and optionally the permutation matrix
   - rings: the cycles drawn as loops (sort and order goals)
   Convention used everywhere: a permutation is a rule on places. "σ sends 1 to 3"
   means whatever sits in place 1 moves to place 3. Composition "σ then τ" applies σ
   to the start, then τ to the result.
   ========================================================================== */

export type ShareSummary = { learner: string; data: string; reply: string };

export type PermutationLabConfig = {
  /** Heading above the canvas. */
  title: string;
  /** 2 to 8 short labels, in their starting order (place 1, place 2, ...). */
  items: string[];
  /** Word for a place: "seat", "position", "slot". Default "place". */
  place?: string;
  /** Show the permutation matrix beside the facts. Default false. */
  matrix?: boolean;
  goal:
    /* Stack two permutations and compare both orders. Each is given as the row
       you get by applying it to the start. */
    | { kind: "compose"; first: string[]; second: string[]; firstName?: string; secondName?: string }
    /* Swap tiles back into the start order in as few swaps as possible. */
    | { kind: "sort"; scrambled: string[] }
    /* Apply one rule again and again until everything is back. */
    | { kind: "order"; rule: string[]; ruleName?: string; step?: string; predict?: boolean };
};

type Props = { config: PermutationLabConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void };

/* ---------- Permutation math (0-indexed; arrangement arr[place] = item) ---------- */
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** Where each item (= its home place) ended up: p[item] = place. */
const posMap = (arr: number[]) => { const p: number[] = []; arr.forEach((item, j) => { p[item] = j; }); return p; };
/** Apply rule R (given as the row it makes from the start) to arrangement X. */
const applyRule = (X: number[], R: number[]) => R.map(i => X[i]);
const swapItems = (arr: number[], a: number, b: number) => arr.map(x => (x === a ? b : x === b ? a : x));
const isIdentity = (arr: number[]) => arr.every((v, i) => v === i);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
function cyclesOf(p: number[]): number[][] {
  const seen = new Set<number>(); const out: number[][] = [];
  for (let v = 0; v < p.length; v++) {
    if (seen.has(v)) continue;
    const c: number[] = []; let x = v;
    while (!seen.has(x)) { seen.add(x); c.push(x); x = p[x]; }
    out.push(c);
  }
  return out;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);
const orderOf = (p: number[]) => cyclesOf(p).reduce((acc, c) => lcm(acc, c.length), 1);
const power = (R: number[], k: number) => { let X = range(R.length); for (let i = 0; i < k; i++) X = applyRule(X, R); return X; };
const support = (p: number[]) => p.flatMap((v, i) => (v !== i ? [i] : []));

/* ---------- Config validation ---------- */
type Mode = "compose" | "sort" | "order";
type Ready = {
  ok: true; mode: Mode; n: number; labels: string[]; title: string; place: string; matrix: boolean;
  first: number[]; second: number[]; firstName: string; secondName: string;
  scrambled: number[]; rule: number[]; ruleName: string; step: string; predict: boolean;
};
type Checked = Ready | { ok: false; reason: string };

/** Labels are compared, looked up and displayed in one normal form: trimmed, inner whitespace collapsed. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const TOP_KEYS = ["title", "items", "place", "matrix", "goal"];
const GOAL_KEYS: Record<Mode, string[]> = {
  compose: ["kind", "first", "second", "firstName", "secondName"],
  sort: ["kind", "scrambled"],
  order: ["kind", "rule", "ruleName", "step", "predict"],
};
const unknownKeys = (o: Record<string, unknown>, allowed: string[], where: string) => {
  const extra = Object.keys(o).filter(k => !allowed.includes(k));
  return extra.length ? `${where} has unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}.` : "";
};

function check(config: unknown): Checked {
  /* 1. JSON shape: container types, closed keys and field types, before any permutation work. */
  if (!isObj(config)) return { ok: false, reason: "The configuration must be an object." };
  const c = config;
  const top = unknownKeys(c, TOP_KEYS, "The configuration"); if (top) return { ok: false, reason: top };
  if (c.title !== undefined && !(typeof c.title === "string" && c.title.trim() && c.title.length <= 90)) return { ok: false, reason: "title must be a short string." };
  if (c.place !== undefined && !(typeof c.place === "string" && c.place.trim() && c.place.length <= 16)) return { ok: false, reason: "place must be a short word such as \"seat\"." };
  if (c.matrix !== undefined && typeof c.matrix !== "boolean") return { ok: false, reason: "matrix must be true or false." };
  const items = c.items;
  if (!Array.isArray(items) || items.length < 2 || items.length > 8) return { ok: false, reason: "It needs between 2 and 8 items." };
  if (!items.every(s => typeof s === "string" && norm(s).length > 0 && norm(s).length <= 12)) return { ok: false, reason: "Every item needs a label of 1 to 12 characters." };
  const labels = (items as string[]).map(norm);
  if (new Set(labels).size !== labels.length) return { ok: false, reason: "Item labels must all be different (ignoring spaces at the ends)." };
  const g = c.goal;
  if (!isObj(g)) return { ok: false, reason: "No goal was given." };
  if (g.kind !== "compose" && g.kind !== "sort" && g.kind !== "order") return { ok: false, reason: "The goal kind must be compose, sort or order." };
  const mode = g.kind as Mode;
  const gk = unknownKeys(g, GOAL_KEYS[mode], `The ${mode} goal`); if (gk) return { ok: false, reason: gk };
  for (const k of ["firstName", "secondName", "ruleName"]) {
    if (g[k] !== undefined && !(typeof g[k] === "string" && norm(g[k] as string).length >= 1 && norm(g[k] as string).length <= 3))
      return { ok: false, reason: `${k} must be 1 to 3 characters, such as "σ".` };
  }
  if (g.step !== undefined && !(typeof g.step === "string" && g.step.trim() && g.step.length <= 16)) return { ok: false, reason: "step must be a short noun such as \"week\"." };
  if (g.predict !== undefined && typeof g.predict !== "boolean") return { ok: false, reason: "predict must be true or false." };

  /* 2. Semantics. Rows are matched by the same normal form the tiles display. */
  const n = labels.length;
  const arr = (row: unknown, what: string): number[] | string => {
    if (!Array.isArray(row) || row.length !== n || !row.every(x => typeof x === "string")) return `${what} must list all ${n} items once.`;
    const idx = row.map(x => labels.indexOf(norm(x as string)));
    if (idx.some(i => i < 0) || new Set(idx).size !== n) return `${what} must list all ${n} items once.`;
    return idx;
  };
  const base = {
    ok: true as const, n, labels, title: typeof c.title === "string" ? c.title.trim() : "Permutation lab",
    place: typeof c.place === "string" ? c.place.trim() : "place", matrix: c.matrix === true,
    first: range(n), second: range(n), firstName: "σ", secondName: "τ", scrambled: range(n), rule: range(n), ruleName: "σ", step: "step", predict: false,
  };
  const name = (s: unknown, fallback: string) => (typeof s === "string" ? norm(s) : fallback);
  if (mode === "compose") {
    const first = arr(g.first, "The first permutation"); if (typeof first === "string") return { ok: false, reason: first };
    const second = arr(g.second, "The second permutation"); if (typeof second === "string") return { ok: false, reason: second };
    const firstName = name(g.firstName, "σ"), secondName = name(g.secondName, "τ");
    if (firstName === secondName) return { ok: false, reason: "The two permutations need different names." };
    return { ...base, mode: "compose", first, second, firstName, secondName };
  }
  if (mode === "sort") {
    const scrambled = arr(g.scrambled, "The scrambled row"); if (typeof scrambled === "string") return { ok: false, reason: scrambled };
    if (isIdentity(scrambled)) return { ok: false, reason: "The scrambled row is already in order." };
    return { ...base, mode: "sort", scrambled };
  }
  const rule = arr(g.rule, "The rule"); if (typeof rule === "string") return { ok: false, reason: rule };
  if (isIdentity(rule)) return { ok: false, reason: "The rule leaves everything in place." };
  return { ...base, mode: "order", rule, ruleName: name(g.ruleName, "σ"), step: typeof g.step === "string" ? g.step.trim() : "step", predict: g.predict === true };
}

/* ---------- Dragology state ---------- */
type Hint = { row: number; a: number; b: number };
type Lab = {
  a: number[]; b: number[]; order: "ab" | "ba"; // compose: a = first-named, b = second-named
  now: number[];                                  // sort
  k: number;                                      // order
  guess?: number;                                 // order: where the learner put the prediction flag
  hint?: Hint;
};

const start = (r: Ready): Lab => ({ a: r.first, b: r.second, order: "ab", now: r.scrambled, k: 0 });
const strip = (s: Lab): Lab => { if (!s.hint) return s; const { hint: _drop, ...rest } = s; return rest; };
/** Compose: the middle and bottom rows for a state. */
function stack(s: Lab) {
  const [F, S] = s.order === "ab" ? [s.a, s.b] : [s.b, s.a];
  return { middle: F, bottom: applyRule(F, S) };
}

/* ---------- Geometry ---------- */
type Ring = { id: string; center: Vec2; r: number; slots: number[] };
type Geo = {
  W: number; H: number; n: number; TS: number; step: number; x0: number; gutter: number; compact: boolean;
  rows: number[]; band: number; NR: number; ringTop: number; ringH: number; ringLines: number;
  /* order mode: the repeat ruler (ticks 0..N) and where the prediction flag parks */
  rulerY: number; N: number; rx0: number; rx1: number; park: number;
};
const ringRadius = (m: number, NR: number) => (m <= 1 ? 0 : Math.max(NR * 1.9, ((NR * 2 + 8) * m) / (2 * Math.PI)));

function geometry(W: number, r: Ready): Geo {
  const n = r.n, compact = W < 440;
  /* Narrow and crowded: drop the row labels so the tiles keep a usable size. */
  const gutter = !compact ? 74 : r.n * 30 + (r.n - 1) * 7 > W - 54 ? 8 : 46;
  const avail = W - gutter - (compact ? 8 : 20);
  const TS = Math.max(24, Math.min(46, Math.floor(avail / (n + (n - 1) * 0.24))));
  const step = TS + Math.round(TS * 0.24);
  const x0 = gutter + Math.max(0, (avail - (n * step - (step - TS))) / 2);
  const band = Math.round(Math.max(54, Math.min(76, TS * 1.6)));
  const NR = compact ? 14 : 16;
  const noRuler = { rulerY: 0, N: 0, rx0: 0, rx1: 0, park: 0 };
  const pad = compact ? 36 : 24; // room under the picture for the drag readout
  if (r.mode === "compose") {
    const top = 26;
    const rows = [top, top + TS + band, top + 2 * (TS + band)];
    return { W, H: rows[2] + TS + pad + 10, n, TS, step, x0, gutter, compact, rows, band, NR, ringTop: 0, ringH: 0, ringLines: 1, ...noRuler };
  }
  const maxM = r.mode === "sort" ? n : Math.max(...cyclesOf(posMap(r.rule)).map(c => c.length));
  const ringH = Math.round(2 * ringRadius(maxM, NR) + 2 * NR + 40);
  if (r.mode === "sort") {
    const rows = [14, 14 + TS + band];
    const ringTop = rows[1] + TS + 18;
    return { W, H: ringTop + ringH + pad, n, TS, step, x0, gutter, compact, rows, band, NR, ringTop, ringH, ringLines: 1, ...noRuler };
  }
  const ringTop = 6;
  /* Order mode never rescales its rings: when they do not fit on one line they wrap. */
  const ringLines = packRings(cyclesOf(posMap(r.rule)), W, NR, compact).length;
  const ringHAll = ringH * ringLines - (ringLines - 1) * 14;
  const rows = [ringTop + ringHAll + 10, ringTop + ringHAll + 10 + TS + band];
  /* The ruler is longer than the answer, so its length gives nothing away. */
  const ord = orderOf(posMap(r.rule));
  const N = Math.max(12, Math.ceil(ord * 1.5));
  const rulerY = rows[1] + TS + 50;
  const park = Math.max(20, x0 - 4);
  const rx0 = park + 34, rx1 = W - (compact ? 14 : 22);
  return { W, H: rulerY + 34 + pad, n, TS, step, x0, gutter, compact, rows, band, NR, ringTop, ringH, ringLines, rulerY, N, rx0, rx1, park };
}

/** Width a ring needs including its place-number labels. */
const ringWidth = (m: number, NR: number, compact: boolean) => {
  const r = ringRadius(m, NR), gap = compact ? 6 : 22;
  return (m <= 1 ? 2 * (NR + 4) : 2 * Math.max(r * 0.87 + NR, (r + NR + 8) * 0.87 + 6)) + gap;
};
/** Greedy line packing of cycles for order mode. */
function packRings(cycles: number[][], W: number, NR: number, compact: boolean): number[][][] {
  const room = W - 16, lines: number[][][] = [[]]; let used = 0;
  for (const c of cycles) {
    const w = ringWidth(c.length, NR, compact);
    if (used + w > room && lines[lines.length - 1].length) { lines.push([]); used = 0; }
    lines[lines.length - 1].push(c); used += w;
  }
  return lines;
}
/** Order mode: rings at full size, wrapped onto as many lines as geometry() allowed for. */
function orderRingLayout(cycles: number[][], g: Geo): Ring[] {
  const lines = packRings(cycles, g.W, g.NR, g.compact);
  const lineH = g.ringH - 14;
  return lines.flatMap((line, li) => {
    const widths = line.map(c => ringWidth(c.length, g.NR, g.compact));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = Math.max(8, (g.W - total) / 2 + (g.compact ? 0 : (g.x0 - g.gutter) * 0.15));
    const cy = g.ringTop + li * lineH + g.ringH / 2 + 8;
    return line.map((c, i) => {
      const ring = { id: `ring-${Math.min(...c)}`, center: Vec2(x + widths[i] / 2, cy), r: ringRadius(c.length, g.NR), slots: c };
      x += widths[i];
      return ring;
    });
  });
}
/** Lay cycles out left to right as rings, scaled to fit the canvas width. */
function ringLayout(cycles: number[][], g: Geo): Ring[] {
  const widths = cycles.map(c => 2 * ringRadius(c.length, g.NR) + 2 * g.NR + (g.compact ? 14 : 26));
  const total = widths.reduce((a, b) => a + b, 0);
  const left = g.compact ? g.gutter : Math.min(g.x0 - 4, g.gutter + Math.max(0, (g.W - g.gutter - 8 - total) / 2));
  const room = g.W - left - 8;
  const s = Math.min(1, room / total);
  let x = left + Math.max(0, (room - total * s) / 2);
  const cy = g.ringTop + g.ringH / 2 + 8;
  return cycles.map((c, i) => {
    const w = widths[i] * s;
    const ring = { id: `ring-${Math.min(...c)}`, center: Vec2(x + w / 2, cy), r: ringRadius(c.length, g.NR) * Math.min(1, s * 1.08), slots: c };
    x += w;
    return ring;
  });
}
const rulerX = (g: Geo, i: number) => g.rx0 + (Math.min(i, g.N) * (g.rx1 - g.rx0)) / g.N;
const chipX = (g: Geo) => Math.max(g.compact ? 18 : 22, g.x0 - (g.compact ? 24 : 34));
const slotAngle = (k: number, m: number) => -90 + (360 * k) / m;

/* ---------- Formatting ---------- */
const cycleText = (p: number[], name: (i: number) => string, keepFixed = false) => {
  const cs = cyclesOf(p).filter(c => keepFixed || c.length > 1);
  if (!cs.length) return "identity";
  return cs.map(c => `(${c.map(name).join(" ")})`).join("");
};
const sup = (k: number) => String(k).split("").map(ch => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(ch)]).join("");
const parityWord = (p: number[]) => ((p.length - cyclesOf(p).length) % 2 === 0 ? "even" : "odd");
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
/** "seat 2" / "seats 1 and 2" */
const placesText = (place: string, xs: string[]) => `${place}${xs.length === 1 ? "" : "s"} ${listJoin(xs)}`;

/** Dragology listens for pointerup only, so an interrupted gesture (pointercancel, window blur) would leave
    the drag live and the next pointerup would apply the hovered edit. Remount the renderer instead: the
    preview is discarded and the last committed state stays. */

/* ---------- Component ---------- */
/* SSR-safe first-render width; the real width is measured before the first paint. */
const INITIAL_WIDTH = 600;

/** House contract: [] means the config is valid; otherwise the reasons it is not. */
export function validatePermutationLab(config: unknown): string[] {
  const c = check(config);
  return c.ok ? [] : [c.reason];
}

export function PermutationLab({ config, onChange, onShare }: Props) {
  const checked = useMemo(() => check(config), [config]);
  if (!checked.ok) {
    return <section className="activity perm-lab is-fallback" aria-label="Permutation lab">
      <p className="pl-fallback">This permutation lab could not be set up. {checked.reason}</p>
    </section>;
  }
  return <Lab key={JSON.stringify(config)} r={checked} onChange={onChange} onShare={onShare} />;
}

type SortMove = { a: number; b: number; before: number[]; delta: number; joined?: string[]; split?: string };

function Lab({ r, onChange, onShare }: { r: Ready; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(INITIAL_WIDTH);
  const [model, setModel] = useState<Lab>(() => start(r));
  const [preview, setPreview] = useState<Lab>();
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [remount, setRemount] = useState(0);
  useCancelGesture(dragging, () => { setRemount(k => k + 1); setPreview(undefined); setDragging(false); setStatus("Drag interrupted. Nothing changed."); });
  /* compose */
  const [flipped, setFlipped] = useState(false);        // has the learner swapped the order at least once
  const [editsAfter, setEditsAfter] = useState(0);      // edits since the orders were first compared
  /* sort */
  const [moves, setMoves] = useState<SortMove[]>([]);
  /* order */
  const [maxK, setMaxK] = useState(0);
  /* keyboard selects */
  const [pickA, setPickA] = useState(0);
  const [pickB, setPickB] = useState(1);
  const [pickWhich, setPickWhich] = useState<"a" | "b">("a");
  /* Undo: snapshots of everything an action changes */
  type Snap = { model: Lab; moves: SortMove[]; flipped: boolean; editsAfter: number; maxK: number };
  const [history, setHistory] = useState<Snap[]>([]);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const resize = () => setWidth(Math.max(240, el.clientWidth));
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches); sync();
    q.addEventListener("change", sync); return () => q.removeEventListener("change", sync);
  }, []);

  const g = useMemo(() => geometry(width, r), [width, r]);
  const L = (i: number) => r.labels[i];
  const P = (i: number) => String(i + 1);
  const view = preview ?? model;
  const xAt = (place: number) => g.x0 + place * g.step;
  const fontSize = (label: string) => Math.round(Math.min(g.TS * 0.44, (g.TS * 1.5) / Math.max(1, label.length)));
  const orderRings = useMemo(() => (r.mode === "order" ? orderRingLayout(cyclesOf(posMap(r.rule)), g) : []), [r, g]);
  const ruleOrder = r.mode === "order" ? orderOf(posMap(r.rule)) : 0;

  /* ---------- The draggable picture ---------- */
  const draggable: Draggable<Lab> = useCallback(({ state, d, draggedId }) => {
    const id = (s: string) => `pl${uid}-${s}`;
    const TS = g.TS;
    const tile = (row: number, item: number, place: number, opts: { faint?: boolean; drag?: () => ReturnType<typeof d.fixed> } = {}) => {
      const tid = id(`t${row}-${item}`);
      return <g id={tid} transform={translate(xAt(place), g.rows[row])}
        className={`pl-tile pl-tone-${item % 8}${opts.faint ? " is-faint" : ""}${opts.drag ? " is-grab" : ""}`}
        dragologyZIndex={draggedId === tid ? "/1" : false}
        {...(opts.drag ? { dragologyOnDrag: opts.drag } : {})}>
        <rect width={TS} height={TS} rx={7} className="pl-tile-face" />
        <text transform={translate(TS / 2, TS / 2 + 0.5)} textAnchor="middle" dominantBaseline="central" fontSize={fontSize(L(item))} className="pl-tile-label">{L(item)}</text>
      </g>;
    };
    /* A wire from an item's tile in one row to its tile in the next. A halo in the
       canvas colour underneath makes later wires read as passing over earlier ones. */
    const wires = (rowTop: number, from: number[], to: number[]) => {
      const pf = posMap(from), pt = posMap(to);
      const y1 = g.rows[rowTop] + TS + 2, y2 = g.rows[rowTop + 1] - 2, ym = (y1 + y2) / 2;
      return <g>{range(g.n).map(item => {
        const x1 = xAt(pf[item]) + TS / 2, x2 = xAt(pt[item]) + TS / 2;
        const dd = `M ${x1} ${y1} C ${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
        return <g className={`pl-tone-${item % 8}`}>
          <path d={dd} className="pl-wire-halo" />
          <path d={dd} className="pl-wire" />
        </g>;
      })}</g>;
    };
    const rowLabel = (row: number, text: string) => g.gutter < 30 ? null :
      <text dragologyKey={`row-label-${row}`} transform={translate(g.x0 - 12, g.rows[row] + TS / 2)} textAnchor="end" dominantBaseline="central" className="pl-row-label">{text}</text>;
    /* Label for the ring area, only when it fits to the left of the first ring. */
    const ringLabel = (x: number, text: string) => x < text.length * 6.5 ? null :
      <text dragologyKey="ring-label" transform={translate(x, r.mode === "order" && orderRings.length ? orderRings[0].center.y : g.ringTop + g.ringH / 2 + 8)} textAnchor="end" dominantBaseline="central" className="pl-row-label">{text}</text>;
    const placeNumbers = (row: number, above: boolean) => <g>{range(g.n).map(p =>
      <text transform={translate(xAt(p) + TS / 2, above ? g.rows[row] - 9 : g.rows[row] + TS + 12)} textAnchor="middle" dominantBaseline="central" className="pl-place-num">{P(p)}</text>)}</g>;
    /* Swap specs: drop a tile on another to swap the two (a transposition). */
    const swapSpec = (row: number, arr: number[], item: number, make: (next: number[], other: number) => Lab) => () => {
      const states = arr.filter(o => o !== item).map(o => ({ ...make(swapItems(arr, item, o), o), hint: { row, a: item, b: o } }));
      return d.closest(states).whenFar(state).withFloating();
    };
    const target = (row: number, arr: number[]) => {
      const h = state.hint;
      if (!h || h.row !== row) return null;
      const at = posMap(arr)[h.a];
      return <g id={id("target")} transform={translate(xAt(at) - 4, g.rows[row] - 4)} className="pl-target" pointerEvents="none">
        <rect width={TS + 8} height={TS + 8} rx={10} />
      </g>;
    };

    if (r.mode === "compose") {
      const { middle, bottom } = stack(state);
      const editMiddle = (next: number[]): Lab => (state.order === "ab" ? { ...state, a: next } : { ...state, b: next });
      const editBottom = (next: number[]): Lab => {
        const second = next.map(item => middle.indexOf(item));
        return state.order === "ab" ? { ...state, b: second } : { ...state, a: second };
      };
      const flip: Lab = { ...state, order: state.order === "ab" ? "ba" : "ab" };
      const chip = (which: "a" | "b") => {
        const firstBand = (state.order === "ab") === (which === "a");
        const cy = firstBand ? g.rows[0] + TS + g.band / 2 : g.rows[1] + TS + g.band / 2;
        const cid = id(`chip-${which}`);
        return <g id={cid} transform={translate(chipX(g), cy)} className={`pl-chip pl-chip-${which}`}
          dragologyZIndex={draggedId === cid ? "/2" : 1}
          dragologyOnDrag={() => d.between([state, flip])}>
          <circle r={g.compact ? 15 : 17} className="pl-chip-face" />
          <text textAnchor="middle" dominantBaseline="central" className="pl-chip-text">{which === "a" ? r.firstName : r.secondName}</text>
        </g>;
      };
      /* The band's rule in cycle notation, to the right of the wires when there is room. */
      const noteX = xAt(g.n - 1) + TS + 18;
      const note = (which: "a" | "b") => {
        if (g.W - noteX < 84) return null;
        const firstBand = (state.order === "ab") === (which === "a");
        const cy = firstBand ? g.rows[0] + TS + g.band / 2 : g.rows[1] + TS + g.band / 2;
        return <g id={id(`note-${which}`)} transform={translate(noteX, cy)} className="pl-band-note" pointerEvents="none">
          <text dominantBaseline="central">{`${which === "a" ? r.firstName : r.secondName} = ${cycleText(posMap(which === "a" ? state.a : state.b), P)}`}</text>
        </g>;
      };
      return <g>
        {placeNumbers(0, true)}
        {rowLabel(0, "start")}
        {rowLabel(1, g.compact ? "1st" : "after 1st")}
        {rowLabel(2, g.compact ? "both" : "after both")}
        {wires(0, range(g.n), middle)}
        {wires(1, middle, bottom)}
        {range(g.n).map(item => tile(0, item, item, { faint: true }))}
        {middle.map((item, place) => tile(1, item, place, { drag: swapSpec(1, middle, item, next => editMiddle(next)) }))}
        {bottom.map((item, place) => tile(2, item, place, { drag: swapSpec(2, bottom, item, next => editBottom(next)) }))}
        {target(1, middle)}
        {target(2, bottom)}
        {note("a")}
        {note("b")}
        {chip("a")}
        {chip("b")}
      </g>;
    }

    if (r.mode === "sort") {
      const now = state.now;
      const p = posMap(now);
      const rings = ringLayout(cyclesOf(p), g);
      const nodeAt = new Map<number, Vec2>();
      rings.forEach(ring => ring.slots.forEach((item, s) => nodeAt.set(item, ring.center.add(Vec2.polarDeg(ring.r, slotAngle(s, ring.slots.length))))));
      const centerOf = new Map<number, Vec2>(); rings.forEach(ring => ring.slots.forEach(item => centerOf.set(item, ring.center)));
      return <g>
        {rowLabel(0, "now")}
        {rowLabel(1, g.compact ? "goal" : "in order")}
        {ringLabel(Math.min(g.x0, rings[0].center.x - rings[0].r - g.NR - 6) - 10, "cycles")}
        {wires(0, now, range(g.n))}
        {range(g.n).map(item => tile(1, item, item, { faint: true }))}
        {now.map((item, place) => tile(0, item, place, { drag: swapSpec(0, now, item, next => ({ ...state, now: next })) }))}
        {target(0, now)}
        {rings.map(ring => <g id={id(ring.id)} dragologyZIndex={-1} transform={translate(ring.center)} className="pl-ring" pointerEvents="none">
          <circle r={Math.max(ring.r, 0.01)} className="pl-ring-line" />
        </g>)}
        <g pointerEvents="none">{range(g.n).map(item => arrowArc(nodeAt.get(item)!, nodeAt.get(p[item])!, centerOf.get(item)!, g.NR, item))}</g>
        <g pointerEvents="none">{range(g.n).map(item => <g transform={translate(nodeAt.get(item)!)} className={`pl-node pl-tone-${item % 8}`}>
          <circle r={g.NR} className="pl-node-face" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={Math.min(13, (g.NR * 2.1) / Math.max(1, L(item).length))} className="pl-node-label">{L(item)}</text>
        </g>)}</g>
      </g>;
    }

    /* order */
    const R = r.rule, k = state.k;
    const now = power(R, k);
    const pinSpec = () => d.between(range(g.N).map(i => ({ ...state, guess: i + 1 })));
    const locked = maxK >= ruleOrder;
    const rx = (i: number) => rulerX(g, i);
    const ruler = <g>
      <line x1={rx(0)} x2={g.rx1} y1={g.rulerY} y2={g.rulerY} className="pl-ruler-line" />
      <line x1={rx(0)} x2={rx(k)} y1={g.rulerY} y2={g.rulerY} className="pl-ruler-progress" />
      {range(g.N + 1).map(i => {
        const every = (g.rx1 - g.rx0) / g.N < 19 ? 2 : 1;
        return <g transform={translate(rx(i), g.rulerY)}>
          <line y1={-4} y2={4} className="pl-ruler-tick" />
          {i % every === 0 && <text dragologyKey="num" transform={translate(0, 15)} textAnchor="middle" dominantBaseline="central" className="pl-place-num">{i}</text>}
        </g>;
      })}
      <g>{range(g.N + 1).filter(i => i > 0 && i % ruleOrder === 0 && i <= maxK).map(i =>
        <g id={id(`rhome-${i}`)} transform={translate(rx(i), g.rulerY)} className="pl-ruler-home-wrap"><circle r={6} className="pl-ruler-home" /></g>)}</g>
      <path transform={translate(rx(k), g.rulerY - 7)} d="M -5 -7 L 5 -7 L 0 0 Z" className="pl-ruler-now" />
      <text transform={translate(g.rx1, g.rulerY - 16)} textAnchor="end" dominantBaseline="central" className="pl-row-label">{`${r.step}s`}</text>
    </g>;
    const pinAt = state.guess === undefined ? Vec2(g.park, g.rulerY) : Vec2(rx(state.guess), g.rulerY);
    const pinId = id("pin");
    const pin = r.predict ? <g id={pinId} transform={translate(pinAt)} className="pl-pin"
      dragologyZIndex={draggedId === pinId ? "/2" : 3}
      {...(locked ? {} : { dragologyOnDrag: pinSpec })}>
      <circle r={20} className="pl-hit" />
      <path d="M 0 0 L 0 -30" className="pl-pin-pole" />
      <path d="M 0 -30 L 15 -25 L 0 -19 Z" className="pl-pin-flag" />
      <circle r={3.2} className="pl-pin-foot" />
    </g> : null;
    const parkMark = r.predict ? <g transform={translate(g.park, g.rulerY)} pointerEvents="none">
      <circle r={9} className="pl-park" />
      <text transform={translate(0, 15)} textAnchor="middle" dominantBaseline="central" className="pl-place-num">guess</text>
    </g> : null;
    const tokenSpec = () => d.closest([
      d.between([state, { ...state, k: k + 1 }]),
      k > 0 && d.between([state, { ...state, k: k - 1 }]),
    ]).withSnapRadius(4, { chain: true });
    return <g>
      {ringLabel(Math.min(g.x0, orderRings[0].center.x - orderRings[0].r - g.NR - 8) - 12, g.compact ? "rule" : `rule ${r.ruleName}`)}
      {rowLabel(0, "start")}
      {rowLabel(1, "now")}
      {orderRings.map(ring => <g transform={translate(ring.center)} className="pl-ring" pointerEvents="none">
        <circle r={Math.max(ring.r, 0.01)} className="pl-ring-line" />
        {ring.slots.map((place, s) => {
          const at = Vec2.polarDeg(ring.r, slotAngle(s, ring.slots.length));
          const out = ring.r ? Vec2.polarDeg(ring.r + g.NR + 8, slotAngle(s, ring.slots.length)) : Vec2(0, g.NR + 10);
          return <g>
            <circle transform={translate(at)} r={g.NR + 2.5} className="pl-slot" />
            <text transform={translate(out)} textAnchor="middle" dominantBaseline="central" className="pl-place-num">{P(place)}</text>
          </g>;
        })}
      </g>)}
      <g pointerEvents="none">{orderRings.flatMap(ring => ring.slots.map((place, s) => {
        const m = ring.slots.length;
        const a = ring.center.add(Vec2.polarDeg(ring.r, slotAngle(s, m)));
        const b = ring.center.add(Vec2.polarDeg(ring.r, slotAngle((s + 1) % m, m)));
        return arrowArc(a, m === 1 ? a : b, ring.center, g.NR + 2, place, true);
      }))}</g>
      {orderRings.map(ring => ring.slots.length > 1 && k > 0 && k % ring.slots.length === 0
        ? <g id={id(`home-${ring.id}`)} transform={translate(ring.center)} className="pl-home" pointerEvents="none" dragologyZIndex={-1}>
            <circle r={ring.r + g.NR + 5} />
          </g>
        : null)}
      {wires(0, range(g.n), now)}
      {range(g.n).map(item => tile(0, item, item, { faint: true }))}
      {now.map((item, place) => tile(1, item, place))}
      {ruler}
      {parkMark}
      {pin}
      {orderRings.flatMap(ring => ring.slots.map((item, s) => {
        const m = ring.slots.length;
        const ang = slotAngle(s + k, m);
        const tid = id(`tok-${item}`);
        return <g id={tid} className={`pl-token pl-tone-${item % 8}${m > 1 ? " is-grab" : ""}`}
          transform={translate(ring.center) + rotateDeg(ang) + translate(ring.r, 0) + rotateDeg(-ang)}
          dragologyZIndex={draggedId === tid ? "/1" : 2}
          {...(m > 1 ? { dragologyOnDrag: tokenSpec } : {})}>
          {m > 1 && <circle r={Math.max(g.NR + 6, 21)} className="pl-hit" />}
          <circle r={g.NR} className="pl-node-face" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={Math.min(13, (g.NR * 2.1) / Math.max(1, L(item).length))} className="pl-node-label">{L(item)}</text>
        </g>;
      }))}
    </g>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, r, uid, orderRings, ruleOrder, maxK]);

  /* ---------- Derived facts for the current (or previewed) state ---------- */
  type Facts =
    | { kind: "compose"; pa: number[]; pb: number[]; ab: number[]; ba: number[]; bottom: number[]; pc: number[]; commute: boolean }
    | { kind: "sort"; p: number[]; cycles: number[][]; need: number }
    | { kind: "order"; p: number[] };
  const facts: Facts = (() => {
    if (r.mode === "compose") {
      const pa = posMap(view.a), pb = posMap(view.b);
      const ab = applyRule(view.a, view.b), ba = applyRule(view.b, view.a);
      const { bottom } = stack(view);
      return { kind: "compose" as const, pa, pb, ab, ba, bottom, pc: posMap(bottom), commute: same(ab, ba) };
    }
    if (r.mode === "sort") {
      const p = posMap(view.now);
      const cycles = cyclesOf(p);
      return { kind: "sort" as const, p, cycles, need: r.n - cycles.length };
    }
    const p = posMap(power(r.rule, view.k));
    return { kind: "order" as const, p };
  })();

  /* ---------- Commit ---------- */
  function commit(next: Lab, message: string, opts: { animate?: boolean; keepHistory?: boolean } = {}) {
    if (!opts.keepHistory) setHistory(h => [...h, { model, moves, flipped, editsAfter, maxK }]);
    setModel(next);
    setPreview(undefined);
    setShared(false);
    if (message) setStatus(message);
    if (reduced && opts.animate) setRemount(x => x + 1);
    onChange?.();
  }

  function sortSwap(prev: Lab, a: number, b: number, via: string) {
    const before = cyclesOf(posMap(prev.now));
    const nextNow = swapItems(prev.now, a, b);
    const after = cyclesOf(posMap(nextNow));
    const delta = after.length - before.length; // +1 split, -1 join
    const fmt = (c: number[]) => `(${c.map(L).join(" ")})`;
    const ca = before.find(c => c.includes(a))!, cb = before.find(c => c.includes(b))!;
    const move: SortMove = { a, b, before: prev.now, delta, ...(delta < 0 ? { joined: [fmt(ca), fmt(cb)] } : { split: fmt(ca) }) };
    setMoves(m => [...m, move]);
    commit({ ...prev, now: nextNow }, `${via}Swapped ${L(a)} and ${L(b)}. ${delta > 0 ? "A cycle split" : "Two cycles joined"}. ${plural(r.n - after.length, "swap")} still needed.`);
  }

  function onDrop(raw: Lab) {
    setDragging(false);
    const next = strip(raw);
    const h = raw.hint;
    if (r.mode === "compose") {
      if (next.order !== model.order) {
        setFlipped(true);
        const firstNow = next.order === "ab" ? r.firstName : r.secondName;
        commit(next, `${firstNow} now acts first. Bottom row: ${stack(next).bottom.map(L).join(" ")}.`);
        return;
      }
      if (h && (!same(next.a, model.a) || !same(next.b, model.b))) {
        if (flipped) setEditsAfter(e => e + 1);
        const changed = !same(next.a, model.a) ? r.firstName : r.secondName;
        commit(next, `Swapped ${L(h.a)} and ${L(h.b)}, which changed ${changed}. Bottom row: ${stack(next).bottom.map(L).join(" ")}.`);
        return;
      }
      setPreview(undefined); return;
    }
    if (r.mode === "sort") {
      if (h && !same(next.now, model.now)) { sortSwap(model, h.a, h.b, ""); return; }
      setPreview(undefined); return;
    }
    if (next.k !== model.k) {
      setMaxK(m => Math.max(m, next.k));
      commit(next, orderStatus(next.k));
      return;
    }
    if (next.guess !== model.guess && next.guess !== undefined) {
      commit(next, `Your guess: back to the start after ${plural(next.guess, r.step)}.`);
      return;
    }
    setPreview(undefined);
  }

  const orderStatus = (k: number) => {
    const X = power(r.rule, k);
    return isIdentity(X) ? `After ${plural(k, r.step)} everything is back where it started.` : `After ${plural(k, r.step)}: ${X.map(L).join(" ")}.`;
  };

  const actions = {
    flip: () => { setFlipped(true); const next: Lab = { ...model, order: model.order === "ab" ? "ba" : "ab" }; commit(next, `${next.order === "ab" ? r.firstName : r.secondName} now acts first. Bottom row: ${stack(next).bottom.map(L).join(" ")}.`, { animate: true }); },
    editPerm: () => {
      if (pickA === pickB) { setStatus("Pick two different items to swap."); return; }
      const next = pickWhich === "a" ? { ...model, a: swapItems(model.a, pickA, pickB) } : { ...model, b: swapItems(model.b, pickA, pickB) };
      if (flipped) setEditsAfter(e => e + 1);
      commit(next, `Swapped ${L(pickA)} and ${L(pickB)} in ${pickWhich === "a" ? r.firstName : r.secondName}. Bottom row: ${stack(next).bottom.map(L).join(" ")}.`, { animate: true });
    },
    sortSwap: () => { if (pickA === pickB) { setStatus("Pick two different tiles to swap."); return; } sortSwap(model, pickA, pickB, ""); if (reduced) setRemount(x => x + 1); },
    undo: () => {
      const last = history[history.length - 1]; if (!last) return;
      setHistory(h => h.slice(0, -1));
      setMoves(last.moves); setFlipped(last.flipped); setEditsAfter(last.editsAfter); setMaxK(last.maxK);
      commit(last.model, "Undid the last move.", { animate: true, keepHistory: true });
    },
    guess: (v: number) => commit({ ...model, guess: v }, `Your guess: back to the start after ${plural(v, r.step)}.`),
    apply: (dk: number) => { const k = Math.max(0, model.k + dk); setMaxK(m => Math.max(m, k)); commit({ ...model, k }, orderStatus(k), { animate: true }); },
    reset: () => { setMoves([]); setFlipped(false); setEditsAfter(0); setMaxK(0); setHistory([]); commit(start(r), "Started over.", { animate: true, keepHistory: true }); },
  };

  /* ---------- Test / tooling hook ---------- */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingPerm?: unknown };
    host.keatingPerm = Object.freeze({
      snapshot: () => {
        if (r.mode === "compose") { const { middle, bottom } = stack(model); return { mode: r.mode, order: model.order, a: model.a.map(L), b: model.b.map(L), middle: middle.map(L), bottom: bottom.map(L), flipped }; }
        if (r.mode === "sort") return { mode: r.mode, now: model.now.map(L), swaps: moves.length, need: r.n - cyclesOf(posMap(model.now)).length, sorted: isIdentity(model.now) };
        return { mode: r.mode, k: model.k, now: power(r.rule, model.k).map(L), home: isIdentity(power(r.rule, model.k)), guess: model.guess ?? null };
      },
      handles: () => {
        const svg = wrap.current?.querySelector("svg")?.getBoundingClientRect(); if (!svg) return null;
        const at = (x: number, y: number) => ({ x: svg.left + x, y: svg.top + y });
        const tileAt = (row: number, place: number) => at(xAt(place) + g.TS / 2, g.rows[row] + g.TS / 2);
        const out: Record<string, unknown> = { tile: {} as Record<string, unknown>, TS: g.TS };
        const tiles = out.tile as Record<string, { x: number; y: number }>;
        if (r.mode === "compose") {
          const { middle, bottom } = stack(model);
          middle.forEach((item, p) => { tiles[`1:${L(item)}`] = tileAt(1, p); });
          bottom.forEach((item, p) => { tiles[`2:${L(item)}`] = tileAt(2, p); });
          const firstY = g.rows[0] + g.TS + g.band / 2, secondY = g.rows[1] + g.TS + g.band / 2;
          out.chip = { a: at(chipX(g), model.order === "ab" ? firstY : secondY), b: at(chipX(g), model.order === "ab" ? secondY : firstY) };
          out.bands = { first: at(chipX(g), firstY), second: at(chipX(g), secondY) };
        } else if (r.mode === "sort") {
          model.now.forEach((item, p) => { tiles[`0:${L(item)}`] = tileAt(0, p); });
        } else {
          const tok: Record<string, unknown> = {};
          orderRings.forEach(ring => ring.slots.forEach((item, s) => {
            const m = ring.slots.length;
            const pos = (kk: number) => { const v = ring.center.add(Vec2.polarDeg(ring.r, slotAngle(s + kk, m))); return at(v.x, v.y); };
            tok[L(item)] = { now: pos(model.k), next: pos(model.k + 1), center: at(ring.center.x, ring.center.y), r: ring.r, m };
          }));
          out.token = tok;
          out.ruler = { tick: range(g.N + 1).map(i => at(rulerX(g, i), g.rulerY)), N: g.N,
            pin: at(model.guess === undefined ? g.park : rulerX(g, model.guess), g.rulerY - 12) };
        }
        return out;
      },
    });
    return () => { delete host.keatingPerm; };
  });

  /* ---------- Copy ---------- */
  const firstName = view.order === "ab" ? r.firstName : r.secondName;
  const secondNameNow = view.order === "ab" ? r.secondName : r.firstName;
  const acted = history.length > 0;
  const row = (xs: number[]) => xs.map(L).join(" ");
  let instruction = ""; let tone: "plain" | "good" | "warn" = "plain";
  let dragLine = "";
  let share: ShareSummary | undefined;

  if (facts.kind === "compose") {
    const { pa, pb, ab, ba, commute } = facts;
    const sa = support(pa), sb = support(pb);
    const sharedPlaces = sa.filter(x => sb.includes(x));
    const diffPlace = ab.findIndex((v, i) => v !== ba[i]);
    /* Follow one thing through both orders, place by place. */
    const trace = (() => {
      if (diffPlace < 0) return "";
      /* Pick the thing whose journey involves the most actual moves. */
      const hop = (item: number, F: number[], S: number[]) => { const p1 = posMap(F)[item]; return [p1, posMap(S)[p1]] as const; };
      const moved = (item: number) => { const [x1, x2] = hop(item, view.a, view.b), [y1, y2] = hop(item, view.b, view.a); return +(x1 !== item) + +(x2 !== x1) + +(y1 !== item) + +(y2 !== y1); };
      const item = range(r.n).filter(i => posMap(ab)[i] !== posMap(ba)[i]).sort((i, j) => moved(j) - moved(i))[0];
      const leg = (F: string, S: string, x1: number, x2: number) =>
        `${F} ${x1 === item ? "leaves it" : `sends it to ${P(x1)}`}, then ${S} ${x2 === x1 ? (x1 === item ? "leaves it too" : "leaves it there") : `${x1 === item ? "sends" : "moves"} it to ${P(x2)}`}`;
      const [x1, x2] = hop(item, view.a, view.b), [y1, y2] = hop(item, view.b, view.a);
      return `Follow ${L(item)} from ${r.place} ${P(item)}: ${leg(r.firstName, r.secondName, x1, x2)}; the other way, ${leg(r.secondName, r.firstName, y1, y2)}.`;
    })();
    const reason = (() => {
      if (isIdentity(view.a) || isIdentity(view.b)) return `${isIdentity(view.a) ? r.firstName : r.secondName} leaves everything in place, so it can go before or after anything.`;
      if (!sharedPlaces.length) return `${r.firstName} only moves ${placesText(r.place, sa.map(P))} and ${r.secondName} only moves ${listJoin(sb.map(P))}. They never touch the same ${r.place}, so neither can disturb the other.`;
      for (let k = 1; k < 8; k++) if (same(power(view.a, k), view.b)) return `${r.secondName} is just ${r.firstName} done ${plural(k, "time")}, and a permutation always commutes with its own repeats.`;
      return `They both move ${placesText(r.place, sharedPlaces.map(P))}, yet here the two orders still happen to agree.`;
    })();
    const sharedText = placesText(r.place, sharedPlaces.map(P));
    if (!flipped) {
      instruction = `Right now ${r.firstName} acts first, then ${r.secondName}. Drag the ${r.secondName} chip up onto the first band (or press Swap order) and watch the bottom row.`;
    } else if (!commute) {
      tone = editsAfter > 0 ? "warn" : "plain";
      instruction = editsAfter === 0
        ? `The bottom rows differ: ${r.firstName} then ${r.secondName} gives ${row(ab)}, ${r.secondName} then ${r.firstName} gives ${row(ba)}. ${trace} Now try to make the two orders agree: swap tiles in either row to change ${r.firstName} or ${r.secondName}.`
        : `Still different. ${sharedPlaces.length ? `Both ${r.firstName} and ${r.secondName} move ${sharedText}, so whichever goes second rearranges what the first one left there.` : ""} ${trace}`;
    } else {
      tone = "good";
      instruction = `Both orders end at ${row(ab)}: these two commute. ${reason}`;
    }
    const data = `${firstName} first; ${r.firstName} = ${cycleText(pa, P)}, ${r.secondName} = ${cycleText(pb, P)}; ${r.firstName} then ${r.secondName} = ${row(ab)}, ${r.secondName} then ${r.firstName} = ${row(ba)}`;
    if (acted) share = !flipped
      ? { learner: `With ${r.firstName} = ${cycleText(pa, P)} first and ${r.secondName} = ${cycleText(pb, P)} second, I get ${row(ab)}.`, data,
          reply: commute
            ? `Right, ${r.firstName} then ${r.secondName} gives ${row(ab)}. Before you swap the order, here’s a spoiler: this pair gives the same row both ways. ${reason} Drag the ${r.secondName} chip up anyway and check.`
            : `Right, ${r.firstName} then ${r.secondName} gives ${row(ab)}. Now drag the ${r.secondName} chip up so it acts first and compare. You’ll get ${row(ba)}, because both rules touch ${sharedText}.` }
      : commute
        ? { learner: `I made ${r.firstName} and ${r.secondName} commute: both orders end at ${row(ab)}.`, data,
            reply: `Yes. ${reason} That’s the general rule: permutations whose cycles share nothing always commute. When they do share a ${r.place}, the one that goes second acts on whatever the first one left there, so the order usually shows.` }
        : { learner: `${r.firstName} then ${r.secondName} gave ${row(ab)}, but ${r.secondName} then ${r.firstName} gave ${row(ba)}.`, data,
            reply: `That difference is the whole story. ${trace} Each permutation is a rule about ${r.place}s, not about particular letters: it moves whatever happens to be sitting there. So the second rule acts on the first one’s output, and because both rules touch ${sharedText}, the order changes who lands where. Composition is like socks then shoes: same two steps, different result.` };
    if (dragging && preview && view.order !== model.order) dragLine = `Drop to make ${firstName} act first, then ${secondNameNow}.`;
    else if (dragging && preview?.hint) dragLine = `Drop to swap ${L(preview.hint.a)} and ${L(preview.hint.b)}: bottom row becomes ${row(stack(preview).bottom)}${flipped ? (commute ? ", and the two orders agree" : ", orders still differ") : ""}.`;
  }

  if (facts.kind === "sort") {
    const minimum = r.n - cyclesOf(posMap(r.scrambled)).length;
    const used = moves.length;
    const joins = moves.filter(m => m.delta < 0).length, splits = used - joins;
    const last = moves[moves.length - 1];
    const sorted = isIdentity(model.now);
    const cyclesNow = cyclesOf(posMap(model.now)).length;
    const needNow = r.n - cyclesNow;
    const scrambleText = cycleText(posMap(r.scrambled), L);
    const parity = parityWord(posMap(r.scrambled));
    const joinText = joins === 1 ? "one swap that joined two cycles" : `${joins} swaps that joined cycles`;
    if (sorted) {
      tone = used === minimum ? "good" : "warn";
      instruction = used === minimum
        ? `Sorted in ${plural(used, "swap")}, the fewest possible: ${plural(r.n, "item")} − ${plural(r.n - minimum, "cycle")} = ${minimum}. ${used === 1 ? "Your swap" : "Each of your swaps"} split a cycle.`
        : `Sorted in ${plural(used, "swap")}; the fewest was ${minimum}. The ${used - minimum} extra came from ${joinText}: ${joins === 1 ? "it cost" : "each cost"} the swap itself plus one more to split the cycles again. Extras always come in pairs, because every swap flips the parity.`;
    } else if (!last) {
      instruction = `Drag a tile onto another to swap them. Can you put it back in order in ${plural(minimum, "swap")}? Watch the cycles below: each loop is a group of tiles sitting in each other’s ${r.place}s.`;
    } else if (last.delta > 0) {
      tone = "good";
      instruction = `Good swap: it split ${last.split}. ${plural(needNow, "swap")} still needed (${plural(r.n, "item")} − ${plural(cyclesNow, "cycle")}).`;
    } else {
      tone = "warn";
      instruction = `That swap joined ${last.joined![0]} and ${last.joined![1]} into one cycle, so you now need ${plural(needNow, "swap")}, one more than before. A swap only helps when both tiles are in the same cycle.`;
    }
    const data = `start ${scrambleText}; swaps ${moves.map(m => `${L(m.a)}↔${L(m.b)}`).join(", ") || "none"}; now ${cycleText(posMap(model.now), L, true)}; minimum ${minimum}`;
    if (acted) share = sorted
      ? { learner: `I sorted it in ${plural(used, "swap")}.`, data,
          reply: used === minimum
            ? `That’s optimal. The scramble was ${scrambleText}: a cycle of length m takes m − 1 swaps to undo, so the total is n − (number of cycles) = ${r.n} − ${r.n - minimum} = ${minimum}. Read your swaps backwards and they rebuild the scramble: that’s its inverse.`
            : `You got there with ${used - minimum} extra. The scramble was ${scrambleText}, which needs n − cycles = ${minimum}. ${joins === 1 ? "One of your swaps" : `${joins} of your swaps`} paired tiles from different cycles, which glues those cycles together and costs a swap later to undo. Notice the extra is even: every swap flips odd/even, so any sort of this ${parity} scramble uses an ${parity} number of swaps.` }
      : { learner: used ? `I’ve made ${plural(used, "swap")} and it isn’t sorted yet.` : "I undid my swaps and I’m back at the start.", data,
          reply: used
            ? `So far ${splits === used ? (used === 1 ? "your swap split a cycle" : `all ${used} swaps split a cycle`) : joins === used ? (used === 1 ? "your swap joined two cycles" : `all ${used} swaps joined cycles`) : `${plural(splits, "swap")} split a cycle and ${joins === 1 ? "one joined two" : `${joins} joined cycles`}`}. The shelf is now ${cycleText(posMap(model.now), L, true)}, ${plural(cyclesNow, "cycle")}, so it needs ${plural(needNow, "more swap")}. Pick two books that sit in the same loop: swapping them always splits it.`
            : `Back to ${scrambleText}: ${plural(r.n - minimum, "cycle")} among ${plural(r.n, "book")}, so ${plural(minimum, "swap")} at best. Each swap of two books in the same loop splits it.` };
    if (dragging && preview?.hint) {
      const before = cyclesNow, after = facts.cycles.length;
      dragLine = `Drop to swap ${L(preview.hint.a)} and ${L(preview.hint.b)}: ${after > before ? "splits a cycle" : "joins two cycles"}, ${plural(facts.need, "swap")} left.`;
    }
  }

  if (r.mode === "order") {
    const k = model.k, guess = model.guess;
    const cycles = orderRings.filter(rg => rg.slots.length > 1);
    const home = cycles.filter(c => k % c.slots.length === 0), away = cycles.filter(c => k % c.slots.length !== 0);
    const fmt = (c: Ring) => `(${c.slots.map(P).join(" ")})`;
    const lengths = cycles.map(c => c.slots.length);
    const distinct = [...new Set(lengths)];
    const lcmText = distinct.length > 1 ? `lcm(${distinct.join(", ")}) = ${ruleOrder}` : `${ruleOrder}`;
    const lengthText = lengths.length === 1 ? `The only cycle has length ${lengths[0]}` : distinct.length === 1 ? `All ${lengths.length} cycles have length ${lengths[0]}` : `The cycles have lengths ${listJoin(lengths.map(String))}`;
    const reached = maxK >= ruleOrder;
    const shuffle = /riffle|shuffl/i.test(r.step);
    if (k === 0 && !reached) {
      instruction = r.predict && guess === undefined
        ? `First, drag the flag along the ruler to where you think everything is back. Then drag any token round its ring to apply ${r.ruleName}; keep going in one drag to apply it again.`
        : `Drag any token round its ring to apply ${r.ruleName} once; keep going in one drag to apply it again. Every token moves one step along its own cycle.`;
    } else if (k % ruleOrder === 0) {
      const wrongGuess = guess !== undefined && guess !== ruleOrder;
      tone = wrongGuess ? "warn" : "good";
      instruction = `Back to the start after ${plural(k === 0 ? ruleOrder : k, r.step)}.${k > ruleOrder ? ` It repeats every ${ruleOrder}.` : ""} ${lengthText}, and every cycle is home together only at a common multiple: ${lcmText}. That’s the order of ${r.ruleName}.`;
      if (wrongGuess) instruction = `You guessed ${guess}. ${guess === r.n ? `There are ${plural(r.n, "item")}, but the count of items isn’t what matters. ` : ""}${instruction}`;
      else if (guess === ruleOrder) instruction = `Your guess of ${guess} was right. ${instruction}`;
    } else {
      instruction = `After ${plural(k, r.step)}. ${home.length ? `${listJoin(home.map(fmt))} ${home.length === 1 ? "is" : "are"} home; ${listJoin(away.map(fmt))} ${away.length === 1 ? "is" : "are"} not. Everything is back only when all cycles are home at once.` : "No cycle is home yet."}`;
    }
    const guessNote = guess === undefined || guess === ruleOrder ? "" : ` Your guess of ${guess} ${guess === Math.max(...lengths) ? "is the longest cycle; the shorter cycles have to line up too" : guess === r.n ? "counts the items, but the cycle lengths are what decide it" : "doesn’t line all the cycles up"}.`;
    const data = `${r.ruleName} = ${cycleText(posMap(r.rule), P)}; applied ${k}; furthest ${maxK}; order ${reached ? ruleOrder : "not reached"}${guess !== undefined ? `; guessed ${guess}` : ""}`;
    if (reached) share = {
      learner: `It came back to the start after ${plural(ruleOrder, r.step)}.${guess !== undefined ? ` I had guessed ${guess}.` : ""}`, data,
      reply: `Right: ${ruleOrder}. ${r.ruleName} breaks into ${lengths.length > 1 ? `cycles of length ${listJoin(lengths.map(String))}` : `one cycle of length ${lengths[0]}`}. Each cycle returns after its own length, so everything is home first at the least common multiple, ${lcmText}.${guessNote}${shuffle ? " That’s why a perfect riffle of 52 cards needs 8 shuffles, not 52." : ""}`,
    };
    else if (acted) share = k === 0 && guess !== undefined
      ? { learner: `I guess it comes back after ${plural(guess, r.step)}.`, data,
          reply: `Let’s test it. ${r.ruleName} moves the ${r.place}s in ${lengths.length > 1 ? `separate loops: ${listJoin(cycles.map(fmt))}` : `one loop, ${cycles.map(fmt).join("")}`}. Turn the rings and watch which loop gets home first.` }
      : { learner: `After ${plural(k, r.step)} it isn’t back to the start yet.${guess !== undefined ? ` I guessed ${guess}.` : ""}`, data,
          reply: home.length
            ? `Look at the rings: ${listJoin(home.map(fmt))} ${home.length === 1 ? "is" : "are"} already home, but ${listJoin(away.map(fmt))} ${away.length === 1 ? "isn’t" : "aren’t"}. Everything is back only on a ${r.step} where every loop is home at once. When is the next one?`
            : `No loop is home yet after ${plural(k, r.step)}. A loop of length m is home every m ${r.step}s, so check each ring’s length and look for the first ${r.step} that suits all of them.` };
    if (dragging && preview && preview.k !== model.k) dragLine = `Drop to stop at ${plural(preview.k, r.step)}${isIdentity(power(r.rule, preview.k)) ? ", back at the start" : ""}.`;
    else if (dragging && preview && preview.guess !== undefined) dragLine = `Drop to guess ${plural(preview.guess, r.step)}.`;
  }

  /* ---------- Fact rows ---------- */
  const p = facts.kind === "compose" ? facts.pc : facts.p;
  const factRows: { label: string; value: string; note?: string }[] = [];
  if (facts.kind === "compose") {
    factRows.push({ label: r.firstName, value: cycleText(facts.pa, P), note: parityWord(facts.pa) });
    factRows.push({ label: r.secondName, value: cycleText(facts.pb, P), note: parityWord(facts.pb) });
    factRows.push({ label: `${firstName} then ${secondNameNow}`, value: cycleText(facts.pc, P), note: parityWord(facts.pc) });
  } else if (facts.kind === "sort") {
    factRows.push({ label: "cycles", value: cycleText(facts.p, L, true), note: `${facts.cycles.length} of them` });
    factRows.push({ label: "swaps needed", value: `${r.n} − ${facts.cycles.length} = ${facts.need}`, note: `used ${moves.length}` });
    factRows.push({ label: "parity", value: parityWord(facts.p), note: "flips with every swap" });
  } else if (r.mode === "order") {
    factRows.push({ label: r.ruleName, value: cycleText(posMap(r.rule), P), note: parityWord(posMap(r.rule)) });
    factRows.push({ label: `${r.ruleName}${sup(view.k)}`, value: cycleText(facts.p, P), note: `${plural(view.k, r.step)}` });
    if (maxK >= ruleOrder) factRows.push({ label: "order", value: String(ruleOrder), note: "applications to get home" });
  }

  const opts = range(r.n);
  return <section className={`activity perm-lab is-${r.mode}`} data-simulation="permutation-lab" aria-labelledby={`pl${uid}-title`}>
    <div className="pl-header">
      <h3 id={`pl${uid}-title`}>{r.title}</h3>
      <span className="pl-count">{r.mode === "sort" ? plural(moves.length, "swap") : r.mode === "order" ? plural(model.k, r.step) : `${firstName} first`}</span>
    </div>
    <div className={`pl-canvas${dragging ? " is-dragging" : ""}`} ref={wrap} aria-hidden="true">
      <DraggableRenderer key={remount} draggable={draggable} state={model} width={g.W} height={g.H}
        onDropState={onDrop}
        onDragState={s => setPreview(s)}
        onDragStatus={st => { const on = st.type === "dragging"; setDragging(d => (d === on ? d : on)); if (!on) setPreview(p => (p ? undefined : p)); }} />
      <p className="pl-dragline">{dragLine}</p>
    </div>
    <div className="pl-facts-row">
      <dl className="pl-facts">
        {factRows.map(f => <div key={f.label} className="pl-fact">
          <dt>{f.label}</dt><dd><span className="pl-cycle">{f.value}</span>{f.note && <span className="pl-fact-note">{f.note}</span>}</dd>
        </div>)}
        {facts.kind === "compose" && flipped && ([["ab", `${r.firstName} then ${r.secondName}`], ["ba", `${r.secondName} then ${r.firstName}`]] as const).map(([key, label]) => {
          const out = key === "ab" ? facts.ab : facts.ba, other = key === "ab" ? facts.ba : facts.ab;
          return <div key={key} className="pl-fact pl-compare-row">
            <dt>{label}</dt>
            <dd><span className="pl-cycle" aria-label={`${label} gives ${row(out)}`}>{out.map((item, i) => <span key={i} className={`pl-mini pl-tone-${item % 8}${item !== other[i] ? " is-diff" : ""}`}>{L(item)}</span>)}</span>
              <span className="pl-fact-note">{facts.commute ? "same" : `${plural(out.filter((v, i) => v !== other[i]).length, r.place)} differ`}</span></dd>
          </div>;
        })}
      </dl>
      {r.matrix && <div className="pl-matrix-wrap">
        <span className="pl-matrix-label">matrix</span>
        <div className="pl-matrix" style={{ gridTemplateColumns: `repeat(${r.n}, 1fr)` }} role="img"
          aria-label={`Permutation matrix: ${range(r.n).map(i => `row ${r.mode === "sort" ? L(i) : P(i)} has its 1 in column ${P(p[i])}`).join(", ")}`}>
          {range(r.n * r.n).map(cell => { const rr = Math.floor(cell / r.n), col = cell % r.n; const on = p[rr] === col; return <span key={cell} className={`pl-cell${on ? ` is-on pl-tone-${rr % 8}` : ""}${rr === col ? " is-diag" : ""}`}>{on ? "1" : "·"}</span>; })}
        </div>
      </div>}
    </div>
    <p className={`pl-instruction is-${tone}`} aria-live="polite">{instruction}</p>
    <details className="receipt pl-controls">
      <summary>Use buttons instead</summary>
      <div className="pl-control-rows">
        {r.mode === "compose" && <div className="pl-control-row">
          <button type="button" className="pl-chip-btn" onClick={actions.flip}>Swap order</button>
        </div>}
        {r.mode !== "order" && <div className="pl-control-row">
          {r.mode === "compose" && <label className="pl-select">In
            <select value={pickWhich} onChange={e => setPickWhich(e.currentTarget.value as "a" | "b")}><option value="a">{r.firstName}</option><option value="b">{r.secondName}</option></select>
          </label>}
          <label className="pl-select">swap
            <select aria-label="First tile" value={pickA} onChange={e => setPickA(Number(e.currentTarget.value))}>{opts.map(i => <option key={i} value={i}>{L(i)}</option>)}</select>
          </label>
          <label className="pl-select">with
            <select aria-label="Second tile" value={pickB} onChange={e => setPickB(Number(e.currentTarget.value))}>{opts.map(i => <option key={i} value={i}>{L(i)}</option>)}</select>
          </label>
          <button type="button" className="pl-chip-btn" onClick={r.mode === "compose" ? actions.editPerm : actions.sortSwap} disabled={r.mode === "sort" && isIdentity(model.now)}>Swap</button>
        </div>}
        {r.mode === "order" && <div className="pl-control-row">
          {r.predict && <label className="pl-select">My guess
            <select aria-label="My guess" value={model.guess ?? ""} disabled={maxK >= ruleOrder} onChange={e => actions.guess(Number(e.currentTarget.value))}>
              <option value="" disabled>not yet</option>
              {range(g.N).map(i => <option key={i} value={i + 1}>{plural(i + 1, r.step)}</option>)}
            </select>
          </label>}
          <button type="button" className="pl-chip-btn" onClick={() => actions.apply(-1)} disabled={model.k === 0}>Step back</button>
        </div>}
      </div>
    </details>
    <span className="learning-lab__sr-only" role="status">{status}</span>
    <div className="actions pl-actions">
      {r.mode === "order" && <button type="button" className="quiet" onClick={() => actions.apply(1)}>Apply {r.ruleName} again</button>}
      {share && <button type="button" className="primary" disabled={shared} onClick={() => { setShared(true); onShare?.(share!); }}>{shared ? "Shared" : "Share with Keating"}</button>}
      {history.length > 0 && <button type="button" className="quiet" onClick={actions.undo}>Undo</button>}
      {acted && <button type="button" className="quiet" onClick={actions.reset}>Start over</button>}
    </div>
  </section>;
}

/** A curved arrow from node a to node b around a ring centre (or a small loop for a fixed point).
    Same path commands in every case so states blend. */
function arrowArc(a: Vec2, b: Vec2, center: Vec2, NR: number, tone: number, faint = false) {
  let s: Vec2, e: Vec2, c: Vec2;
  if (a.sub(b).len() < 0.5) {
    s = a.add(Vec2(-6, -NR + 1)); e = a.add(Vec2(6, -NR + 1)); c = a.add(Vec2(0, -NR - 22));
  } else {
    const mid = a.add(b).div(2);
    let out = mid.sub(center);
    if (out.len() < 0.5) out = Vec2(-(b.y - a.y), b.x - a.x);
    const bow = out.div(out.len()).mul(Math.max(8, a.sub(b).len() * 0.22));
    c = mid.add(bow);
    s = a.add(c.sub(a).div(c.sub(a).len()).mul(NR + 1));
    e = b.add(c.sub(b).div(c.sub(b).len()).mul(NR + 2));
  }
  const dir = e.sub(c); const u = dir.div(Math.max(0.001, dir.len()));
  const nrm = Vec2(-u.y, u.x);
  const h1 = e.sub(u.mul(6)).add(nrm.mul(3.6)), h2 = e.sub(u.mul(6)).sub(nrm.mul(3.6));
  return <path d={`M ${s.x} ${s.y} Q ${c.x} ${c.y} ${e.x} ${e.y} M ${h1.x} ${h1.y} L ${e.x} ${e.y} L ${h2.x} ${h2.y}`}
    className={`pl-arc pl-tone-${tone % 8}${faint ? " is-faint" : ""}`} />;
}

/* ---------- Presets ---------- */
export const presets: Record<string, PermutationLabConfig> = {
  composeSeats: {
    title: "Do σ then τ, then τ then σ",
    items: ["A", "B", "C", "D"],
    place: "seat",
    goal: { kind: "compose", first: ["B", "A", "C", "D"], second: ["A", "C", "B", "D"], firstName: "σ", secondName: "τ" },
  },
  sortShelf: {
    title: "Shelve the books in the fewest swaps",
    items: ["A", "B", "C", "D", "E", "F", "G"],
    place: "spot",
    matrix: true,
    goal: { kind: "sort", scrambled: ["E", "D", "A", "F", "C", "B", "G"] },
  },
  riffle: {
    title: "How many perfect riffles restore the deck?",
    items: ["A♠", "2♠", "3♠", "4♠", "5♠", "6♠", "7♠", "8♠"],
    place: "position",
    goal: { kind: "order", rule: ["A♠", "5♠", "2♠", "6♠", "3♠", "7♠", "4♠", "8♠"], ruleName: "r", step: "riffle", predict: true },
  },
  dinnerSeats: {
    title: "Same seat swap every week: when is everyone back?",
    items: ["Ana", "Ben", "Cai", "Dev", "Eli"],
    place: "seat",
    goal: { kind: "order", rule: ["Cai", "Ana", "Ben", "Eli", "Dev"], ruleName: "σ", step: "week", predict: true },
  },
};

export const scenario = {
  tab: "Permutations",
  prompt: "Why does the order matter when I compose two permutations?",
  intro: "Because a permutation is a rule about places, not about particular things: it moves whatever happens to be sitting in each seat. Below, σ swaps seats 1 and 2 and τ swaps seats 2 and 3. Stack them, then drag τ’s chip up so it acts first, and watch the bottom row.",
  receiptLabel: "Composition explorer",
  receiptText: "The learner asked why composing permutations depends on order. The lab stacks σ and τ as wiring, lets them swap the order and edit either permutation, and checks whether the two orders agree.",
  preset: "composeSeats",
};

/* Per-preset chat framing (house contract). The catalogue imports these. */
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  composeSeats: { label: "Order matters", prompt: scenario.prompt, intro: scenario.intro, receiptLabel: scenario.receiptLabel, receiptText: scenario.receiptText },
  sortShelf: {
    label: "Fewest swaps",
    prompt: "What’s the fewest number of swaps to sort a list?",
    intro: "It’s the number of items minus the number of cycles. Rather than take that on faith, put this shelf back in order by swapping two books at a time and watch the loops underneath: every useful swap splits one.",
    receiptLabel: "Sorting by swaps", receiptText: "The learner asked about the minimum number of swaps. The lab counts swaps and cycles and flags swaps that join cycles.",
  },
  riffle: {
    label: "Riffle shuffle",
    prompt: "If I riffle a deck perfectly, does it ever come back to the same order?",
    intro: "Always, and you can say exactly when. Here are 8 cards and one perfect riffle (cut in half, interleave, top card stays on top). Drag the flag to your guess, then turn the rings and see.",
    receiptLabel: "Order of a permutation", receiptText: "The learner asked whether perfect shuffles repeat. The lab applies the riffle again and again and reports when the deck returns.",
  },
  dinnerSeats: {
    label: "Seat swap",
    prompt: "Five of us swap seats the same way every week. When are we back where we started?",
    intro: "Each week Ana, Ben and Cai rotate round three seats while Dev and Eli trade places. Drag the flag to the week you expect, then turn the rings.",
    receiptLabel: "Repeating a rearrangement", receiptText: "The learner asked when a repeated seat swap returns. The lab shows each group of seats as a cycle.",
  },
};
