import { DraggableRenderer, inOrder, param, rotateDeg, translate, type Draggable } from "dragology";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Lightbulb, RotateCcw, Undo2 } from "lucide-react";
import "./component.css";
import * as M from "./model";
import * as P from "./prose";
import type { Data, State, Zone } from "./model";

export type { DataExplorerConfig } from "./model";
export { presets, scenario, variants } from "./presets";
export type ShareSummary = { learner: string; data: string; reply: string };
/** [] when the config can be drawn; otherwise the problems, in plain words. The component shows a calm fallback for these. */
export function validateDataExplorer(config: unknown): string[] { return M.compile(config).problems; }

/* ================= geometry =================
   One canvas, no shelves. Spare field chips sit loose at the top; a dashed "keep only" zone sits beside
   them. The chart's legend line (above the bars) is the Columns slot: a chip there splits each bar and
   carries the colour key. The axis line (under the group labels) is the Rows slot: a chip there groups
   the bars along the axis, and doubles as the axis title. Dropping a chip on the bars lands on whichever
   of the two lines is nearer. */
const ZONES: Zone[] = ["fields", "filter", "rows", "cols"];
const ZONE_SAY: Record<Zone, string> = { fields: "taken off the chart", filter: "keeps only one value", rows: "moved to the axis", cols: "now splits each bar" };
const ZONE_MENU: Record<Zone, string> = { fields: "Not used", filter: "Keep only one value", rows: "Group along the axis", cols: "Split each bar" };
const CH = 28, CGAP = 6, LGAP = 6, PLOTX = 36, TOP = 4;
const textW = (s: string, px = 12) => s.length * px * 0.57 + 2;

const zoneFields = (d: Data, s: State, z: Zone): string[] =>
  z === "fields" ? d.dims.filter(f => !s.rows.includes(f) && !s.cols.includes(f) && s.filter !== f)
    : z === "filter" ? (s.filter ? [s.filter] : []) : s[z];
const zoneOf = (s: State, f: string): Zone => (s.rows.includes(f) ? "rows" : s.cols.includes(f) ? "cols" : s.filter === f ? "filter" : "fields");
const chipText = (d: Data, s: State, f: string) => (s.filter === f ? `${d.label(f)}: ${d.values[f][s.filterValue]}` : d.label(f));
const chipW = (d: Data, s: State, f: string) => Math.round(textW(chipText(d, s, f)) + 34 + (s.filter === f ? 14 : 0));

type Item = { key: string; w: number };
/** Lay items left to right from x0, wrapping at x1. */
function flow(items: Item[], x0: number, x1: number, y0: number) {
  let x = x0, y = y0, lines = 1;
  const pos: Record<string, { x: number; y: number; w: number }> = {};
  for (const it of items) {
    const w = Math.min(it.w, x1 - x0);
    if (x + w > x1 && x > x0) { x = x0; y += CH + LGAP; lines++; }
    pos[it.key] = { x, y, w }; x += w + CGAP;
  }
  return { pos, lines, end: { x, y }, h: lines * CH + (lines - 1) * LGAP };
}

/** Make a row of labels legible in `w` px: as is, then without a shared prefix ("Dept A" → "A"),
    then wrapped onto two lines, then shortened. Always two line slots, so element structure is stable. */
export function fitLabels(labels: string[], w: number, px: number): { lines: [string, string][]; prefix: string; cut: boolean } {
  const fits = (t: string) => textW(t, px) <= w;
  if (labels.every(fits)) return { lines: labels.map(l => [l, ""]), prefix: "", cut: false };
  const pre = labels.some(l => l.includes(" · ")) ? "" : M.sharedPrefix([...new Set(labels)]);
  const base = pre ? labels.map(l => l.slice(pre.length)) : labels;
  if (base.every(fits)) return { lines: base.map(l => [l, ""]), prefix: pre, cut: false };
  const wrap = (t: string): [string, string] | null => {
    const parts = t.includes(" · ") ? t.split(" · ").map((p, i, a) => (i < a.length - 1 ? p + " ·" : p)) : t.split(" ");
    for (let k = 1; k < parts.length; k++) {
      const a = parts.slice(0, k).join(" "), b = parts.slice(k).join(" ");
      if (fits(a) && fits(b)) return [a, b];
    }
    return null;
  };
  const wrapped = base.map(l => (fits(l) ? ([l, ""] as [string, string]) : wrap(l)));
  if (wrapped.every(Boolean)) return { lines: wrapped as [string, string][], prefix: pre, cut: false };
  const k = Math.max(2, Math.floor((w - 2) / (px * 0.57)));
  const short = (t: string) => (fits(t) ? t : t.slice(0, Math.max(1, k - 1)) + "…");
  return { lines: base.map(l => { const wr = wrap(l); return wr ?? [short(l), ""]; }), prefix: pre, cut: true };
}

type Bar = { gid: string; a: M.Assign; x: number; w: number; h: number; v: number; n: number; label: [string, string]; full: string; color: number; small: boolean; text: string };
type Geo = ReturnType<typeof geometry>;
/** `home` is the committed layout: the tray keeps room for its chips plus one more, so the chart doesn't
    jump while a chip is carried between the tray and the chart. */
function geometry(d: Data, s: State, W: number, home: State = s) {
  const narrow = W < 440;
  /* --- top: loose field chips + the keep-only zone --- */
  const keepW = narrow ? W : Math.min(270, Math.round(W * 0.42));
  const trayX1 = narrow ? W : W - keepW - 14;
  const plain = (f: string) => ({ key: f, w: chipW(d, { ...s, filter: null }, f) });
  const homeTray = zoneFields(d, home, "fields"), away = d.dims.filter(f => !homeTray.includes(f)).map(plain).sort((a, b) => b.w - a.w);
  const reserve = flow([...homeTray.map(plain), ...away.slice(0, 1)], 0, trayX1, 0);
  const tray = flow(zoneFields(d, s, "fields").map(f => ({ key: f, w: chipW(d, s, f) })), 0, trayX1, TOP + 4);
  const trayH = Math.max(reserve.h, CH);
  const keep = narrow ? { x: 0, y: TOP + trayH + 12, w: W, h: CH + 8 } : { x: W - keepW, y: TOP, w: keepW, h: CH + 8 };
  const chips: Record<string, { x: number; y: number; w: number }> = { ...tray.pos };
  if (s.filter) chips[s.filter] = { x: keep.x + 4, y: keep.y + 4, w: Math.min(chipW(d, s, s.filter), keep.w - 8) };
  const trayHint = { x: tray.end.x + 4, y: tray.end.y, show: false, text: "" };
  {
    const t = zoneFields(d, s, "fields").length ? "drag a field onto the chart" : "every field is on the chart";
    if (tray.end.x + textW(t, 11) + 8 <= trayX1) Object.assign(trayHint, { show: true, text: t });
    if (!zoneFields(d, s, "fields").length) Object.assign(trayHint, { x: 0, y: TOP + 4 });
  }
  const filterHint = s.filter ? chips[s.filter].x + chips[s.filter].w + 8 : 0;
  const topBottom = Math.max(TOP + 4 + trayH, keep.y + keep.h);

  /* --- legend line = Columns slot (chips + colour key) --- */
  const yL = topBottom + 12;
  const inLayout = !!d.colorBy && [...s.rows, ...s.cols].includes(d.colorBy);
  const keyItems: Item[] = inLayout ? d.values[d.colorBy!].slice(0, 6).map((v, i) => ({ key: `key${i}`, w: Math.round(16 + textW(v, 11) + 6) })) : [];
  const legend = flow([...s.cols.map(f => ({ key: f, w: chipW(d, s, f) })), ...keyItems], 0, W, yL);
  for (const f of s.cols) chips[f] = legend.pos[f];
  const keyPos = keyItems.map(k => legend.pos[k.key]);
  const legendH = Math.max(CH, legend.h);
  const legendLine = yL + legendH + 4;
  const legendEnd = s.cols.length || keyItems.length ? legend.end : { x: 0, y: yL };

  /* --- the plot --- */
  const plot = { x: PLOTX, y: legendLine + 26, w: W - PLOTX - 2, h: narrow ? 140 : 150 };
  const y0 = plot.y + plot.h;
  const f = M.filterAssign(s);
  const rowsT = M.tuples(d, s.rows), colsT = M.tuples(d, s.cols);
  const G = rowsT.length, B = colsT.length;
  const tooMany = G * B > M.MAX_BARS;
  const groupGap = G > 1 ? (narrow ? 8 : 18) : 0;
  const slot = Math.min(B === 1 ? 92 : 70, (plot.w - (G - 1) * groupGap) / Math.max(1, G * B));
  const w = Math.max(3, Math.min(58, slot - (B > 1 ? 4 : 10)));
  const used = G * B * slot + (G - 1) * groupGap, ox = plot.x + (plot.w - used) / 2;
  const countView = s.view === "count" || d.measure.kind === "count";
  const dims = [...s.rows, ...s.cols];
  const raw = tooMany ? [] : rowsT.flatMap((rt, gi) => colsT.map((ct, bi) => {
    const a = { ...f, ...M.assignOf(s.rows, rt), ...M.assignOf(s.cols, ct) };
    return { a, gi, bi, g: M.agg(d, a) };
  }));
  const ymax = countView ? M.niceMax(Math.max(1, ...raw.map(r => r.g.n))) : d.measure.kind === "rate" ? 1 : d.domain[1];
  const Y = (v: number) => y0 - (Math.max(0, v) / ymax) * plot.h;
  const showValues = slot >= 31;
  const barFit = fitLabels(raw.map(r => M.groupLabel(d, r.a, s.cols)), slot + (G === 1 ? 4 : 0), 10.5);
  const showBarLabels = B > 1 && !barFit.cut;
  const barLines = showBarLabels && barFit.lines.some(l => l[1]) ? 2 : 1;
  const bars: Bar[] = raw.map(({ a, gi, bi, g }, i) => {
    const v = M.valueOf(d, g, s.view);
    const cb = d.colorBy && d.colorBy in a ? a[d.colorBy] : -1;
    return {
      gid: M.gidOf(d, a), a, x: ox + gi * (B * slot + groupGap) + bi * slot + (slot - w) / 2, w,
      h: g.n > 0 ? Math.max(0, y0 - Y(v)) : 0, v, n: g.n, label: barFit.lines[i] ?? ["", ""], full: M.groupLabel(d, a, dims),
      color: cb, small: !countView && g.n > 0 && g.n < d.small, text: g.n > 0 ? M.fmtValue(d, v, s.view) : "none",
    };
  });

  /* --- axis labels: inner groups (last Rows field), then outer groups (first Rows field) --- */
  const inner = s.rows.length ? s.rows[s.rows.length - 1] : null, outer = s.rows.length === 2 ? s.rows[0] : null;
  const gw = B * slot;
  const innerFit = fitLabels(rowsT.map(rt => inner ? d.values[inner][rt[rt.length - 1]] : s.filter ? d.values[s.filter][s.filterValue] : "All cases"), gw + groupGap - 4, 11.5);
  /* last resort before shortening: tilt the inner labels (full text, up to ~96 px) */
  const innerRaw = rowsT.map(rt => inner ? d.values[inner][rt[rt.length - 1]] : "");
  const tilt = !!inner && innerFit.cut;
  const tiltText = innerRaw.map(l => (textW(l, 11) <= 96 ? l : l.slice(0, Math.floor(96 / 6.3) - 1) + "…"));
  const tiltH = tilt ? Math.ceil(Math.max(...tiltText.map(l => textW(l, 11))) * 0.643) + 10 : 0;
  const groups = rowsT.map((rt, gi) => {
    const a = { ...f, ...M.assignOf(s.rows, rt) };
    return { id: M.gidOf(d, a) + "r", x: ox + gi * (gw + groupGap), w: gw, lines: tilt ? ["", ""] as [string, string] : innerFit.lines[gi], tilt: tilt ? tiltText[gi] : "" };
  });
  const per = outer ? M.tuples(d, [inner!]).length : 1;
  const outerVals = outer ? d.values[outer] : [];
  const outerFit = fitLabels(outerVals, per * gw + (per - 1) * groupGap, 11.5);
  const outers = outerVals.map((_, oi) => ({ id: M.gidOf(d, { ...f, [outer!]: oi }) + "o", x: ox + oi * per * (gw + groupGap), w: per * gw + (per - 1) * groupGap, lines: outerFit.lines[oi] }));
  let cy = y0 + 14;
  const labelY = { bar: cy, n: 0, group: 0, outer: 0 };
  if (showBarLabels) cy += 12 * barLines;
  labelY.n = cy; if (showValues) cy += 13;
  labelY.group = cy + 2; cy += 2 + (tilt ? tiltH : 13 * (innerFit.lines.some(l => l[1]) ? 2 : 1));
  labelY.outer = cy + 3; if (outer) cy += 3 + 13 * (outerFit.lines.some(l => l[1]) ? 2 : 1);

  /* --- axis line = Rows slot --- */
  /* the axis chips sit centred under the plot, like an axis title (so a chip dropped on the bars lands here) */
  const axisItems = s.rows.map(f2 => ({ key: f2, w: chipW(d, s, f2) }));
  const axisW = axisItems.reduce((t, it) => t + it.w, 0) + CGAP * Math.max(0, axisItems.length - 1);
  const axisRow = flow(axisItems, axisW <= W ? Math.round((W - axisW) / 2) : 0, W, cy + 10);
  for (const f2 of s.rows) chips[f2] = axisRow.pos[f2];
  const axisLine = cy + 10 + Math.max(CH, axisRow.h) + 4;
  const axisEnd = s.rows.length ? axisRow.end : { x: 0, y: cy + 10 };
  const prefixNote = innerFit.prefix && s.rows.length === 1 ? innerFit.prefix.trim() : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => (countView || d.measure.kind !== "rate" ? t * ymax : t));
  const H = axisLine + 6;
  return { W, H, narrow, chips, keep, trayHint, filterHint, legendLine, legendEnd, keyPos, yL, axisLine, axisEnd, prefixNote,
    plot, y0, Y, ymax, bars, groups, outers, ticks, showValues, showBarLabels, barLines, slot, tooMany, countView, labelY };
}

/* ================= state moves ================= */
function without(s: State, f: string): State {
  return { ...s, rows: s.rows.filter(x => x !== f), cols: s.cols.filter(x => x !== f), filter: s.filter === f ? null : s.filter };
}
const layoutKey = (s: State) => `${s.rows.join(",")}|${s.cols.join(",")}|${s.filter ?? ""}:${s.filter ? s.filterValue : ""}`;
function moveTo(d: Data, s: State, f: string, z: Zone, idx?: number): State {
  const base = without(s, f);
  let next: State;
  if (z === "fields") next = base;
  else if (z === "filter") next = { ...base, filter: f, filterValue: s.filter === f ? s.filterValue : 0 };
  else { const arr = [...base[z]]; arr.splice(idx ?? arr.length, 0, f); next = { ...base, [z]: arr }; }
  return { ...next, compare: layoutKey(next) === layoutKey(s) ? s.compare : null, hot: null };
}
function chipCandidates(d: Data, s: State, f: string): State[] {
  const base = without(s, f);
  const out: State[] = [{ ...moveTo(d, s, f, "fields"), hot: "fields" }];
  for (const z of ["rows", "cols"] as const) {
    if (base[z].length >= 2) continue;
    for (let i = 0; i <= base[z].length; i++) {
      const c = moveTo(d, s, f, z, i);
      if (M.barCount(d, c) <= M.MAX_BARS) out.push({ ...c, hot: z });
    }
  }
  /* keep-only is offered only if a comparison would still be drawable */
  out.push({ ...moveTo(d, s, f, "filter"), hot: "filter" });
  return out;
}

/* ================= the explorer ================= */
type Flags = { seenFlip: boolean; stratified: boolean; explained: boolean };
declare global { interface Window { keatingData?: Record<string, (...a: any[]) => unknown> } }

export function DataExplorer({ config, onChange, onShare }: { config: M.DataExplorerConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const compiled = useMemo(() => M.compile(config), [config]);
  if (!compiled.data) return <section className="activity data-explorer" data-simulation="data-explorer">
    <p className="dx-fallback">This dataset couldn’t be drawn, so there’s nothing to regroup yet.</p>
    <details className="receipt"><summary><span>What was wrong</span></summary>
      <div className="receipt-details">{compiled.problems.slice(0, 8).map((p, i) => <p key={i}>{p}</p>)}</div></details>
  </section>;
  return <Explorer data={compiled.data} onChange={onChange} onShare={onShare} />;
}

function Explorer({ data, onChange, onShare }: { data: Data; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = "dx" + useId().replace(/[^a-zA-Z0-9]/g, "") + "-";
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [model, setModel] = useState<State>(() => M.initialState(data));
  const [live, setLive] = useState<State | null>(null);
  const [history, setHistory] = useState<State[]>([]);
  const [flags, setFlags] = useState<Flags>({ seenFlip: false, stratified: false, explained: false });
  const [strataState, setStrataState] = useState<State | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [whatIfT, setWhatIfT] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);
  const [reduced, setReduced] = useState(false);
  /* Bumping gestureKey remounts both renderers on the committed state: an interrupted gesture
     (pointercancel) or a width change mid-drag discards the preview instead of dropping the hovered candidate. */
  const [gestureKey, setGestureKey] = useState(0);
  const draggingRef = useRef(false);
  const interrupt = useCallback(() => { draggingRef.current = false; setLive(null); setDragging(null); setGestureKey(k => k + 1); }, []);
  const onAnyDragStatus = useCallback((st: { type: string }) => { draggingRef.current = st.type === "dragging"; }, []);
  useEffect(() => {
    const cancel = () => { if (draggingRef.current) { interrupt(); setStatus("Drag interrupted; nothing moved."); } };
    document.addEventListener("pointercancel", cancel, true);
    return () => document.removeEventListener("pointercancel", cancel, true);
  }, [interrupt]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const resize = () => setW(prev => {
      const w = Math.max(220, Math.floor(el.clientWidth - 16));
      if (w !== prev && draggingRef.current) interrupt();
      return w;
    });
    resize(); const ro = new ResizeObserver(resize); ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches); sync(); q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);

  const view = live ?? model;
  const geo = geometry(data, view, W, model);
  const expectFlip = data.config.question?.expect !== "no-flip";

  const describeMove = (prev: State, next: State) => {
    const moved = data.dims.find(f => zoneOf(prev, f) !== zoneOf(next, f));
    const said = next.compare ? compareSaid(next) : P.describe(data, next, { seenFlip: flags.seenFlip || seesFlip(next) });
    const where = moved ? `${data.label(moved)} ${ZONE_SAY[zoneOf(next, moved)]}${zoneOf(next, moved) === "filter" ? ` (${data.values[moved][next.filterValue]})` : ""}. ` : "";
    return `${where}${said?.head ?? ""}`;
  };
  const seesFlip = (s: State) => {
    if (s.view !== "measure") return false;
    const r = M.read(data, s);
    return !!r && r.kind === "flip" && (r.reveal.length > 0 || data.reveal.length === 0);
  };
  const compareSaid = (s: State) => {
    if (!s.compare) return null;
    const bars = P.barAssigns(data, s);
    const a = bars.get(s.compare[0]), b = bars.get(s.compare[1]);
    return a && b ? P.compareText(data, s, a, b, { seenFlip: flags.seenFlip || seesFlip(s) }) : null;
  };
  const commit = (next: State, how: "drag" | "menu" | "click") => {
    const clean = { ...next, hot: null };
    setLive(null);
    if (JSON.stringify(clean) === JSON.stringify(model)) return;
    setHistory(h => [...h.slice(-30), model]);
    setModel(clean);
    setShared(false);
    const r = M.read(data, clean, "measure");
    const hasStrata = !!r && "strata" in r;
    setFlags(f => ({ ...f, stratified: f.stratified || hasStrata, seenFlip: f.seenFlip || seesFlip(clean) }));
    if (hasStrata) setStrataState(clean);
    setStatus(describeMove(model, clean) + (how === "click" ? "" : ""));
    onChange?.();
  };
  const commitRef = useRef(commit); commitRef.current = commit;

  /* ---------- the draggable ---------- */
  const draggable: Draggable<State> = ({ state, d, draggedId }) => {
    const g = geometry(data, state, W, model);
    const tr = reduced ? false : 150;
    const chipDrag = !!draggedId && draggedId.startsWith(`${uid}chip-`);
    /* No whenFar: a chip dropped anywhere (on the bars too) lands on the nearest line it can go to. */
    const chipSpec = (f: string) => d.closest(chipCandidates(data, state, f))
      .withBranchTransition(tr)
      .withFloating({ ghost: { opacity: 0.3 } })
      .withDropTransition(reduced ? false : "cubic-out")
      .onDrop((p: State) => ({ ...p, hot: null }));
    /* Bars snap beside their target instead of floating: a floating bar ran below the baseline and its
       ghost doubled the value labels. The source slot keeps a dashed outline instead. */
    const barSpec = (gid: string) => {
      const others = g.bars.filter(b => b.gid !== gid && b.n > 0);
      return d.closest(others.map(b => ({ ...state, hot: null, compare: [gid, b.gid] as [string, string] })))
        .whenFar({ ...state, hot: null, compare: null }, { gapIn: 46, gapOut: 64 })
        .withBranchTransition(tr)
        .withDropTransition(reduced ? false : "cubic-out");
    };
    const cmp = state.compare && g.bars.find(b => b.gid === state.compare![0]) && g.bars.find(b => b.gid === state.compare![1]) ? state.compare : null;
    const src = cmp ? g.bars.find(b => b.gid === cmp[0])! : null, tgt = cmp ? g.bars.find(b => b.gid === cmp[1])! : null;
    const dir = src && tgt ? (src.x < tgt.x ? -1 : 1) : 1;
    /* the carried bar stands in front of the target, half as wide, so the two heights read against each other */
    const silX = src && tgt ? tgt.x + tgt.w * 0.25 : 0;
    const bx = src && tgt ? (dir < 0 ? tgt.x - 6 : tgt.x + tgt.w + 6) : 0;
    const yS = src ? g.y0 - src.h : g.y0, yT = tgt ? g.y0 - tgt.h : g.y0;
    const diff = src && tgt ? src.v - tgt.v : 0;
    const pill = src && tgt ? `${diff > 0 ? "▲" : diff < 0 ? "▼" : "="} ${M.fmtGap(data, diff, state.view, true)}` : "";
    const pillW = textW(pill, 11) + 12;
    const pillX = Math.min(Math.max(bx - pillW / 2, g.plot.x), g.plot.x + g.plot.w - pillW);
    const pillY = Math.max(g.plot.y - 24, Math.min(yS, yT) - 34);
    const tickFmt = (v: number) => (g.countView ? Math.round(v).toLocaleString("en") : data.measure.kind === "rate" ? `${Math.round(v * 100)}%` : `${Math.round(v)}`);
    const hot = (z: Zone) => (state.hot === z ? 1 : 0);
    const roomIn = (z: "rows" | "cols") => state[z].length < 2;
    const legendEmpty = !state.cols.length;
    return <g>
      {/* drop places, drawn inside the well: one dashed zone, two dashed lines */}
      <g id={`${uid}slot-filter`} transform={translate(g.keep.x, g.keep.y)}>
        <rect className="dx-zone" width={g.keep.w} height={g.keep.h} rx={9} fillOpacity={hot("filter") * 0.14} strokeOpacity={0.45 + hot("filter") * 0.5} />
        <text className="dx-slot-cap" transform={translate(12, g.keep.h / 2 + 4)}>{state.filter ? "" : g.keep.w < 250 ? "keep only one value" : "keep only one value: drop a field"}</text>
        <text className="dx-slot-cap" transform={translate(g.filterHint - g.keep.x, g.keep.h / 2 + 4)}>{state.filter && g.keep.w - (g.filterHint - g.keep.x) > 64 ? "tap to switch" : ""}</text>
      </g>
      <g id={`${uid}tray-hint`} transform={translate(g.trayHint.x, g.trayHint.y + CH / 2 + 4)}>
        <text className="dx-slot-cap">{g.trayHint.show ? g.trayHint.text : ""}</text>
      </g>
      <g id={`${uid}slot-cols`} transform={translate(0, g.legendLine)}>
        <line className="dx-slot-line" x2={g.W} strokeOpacity={0.4 + hot("cols") * 0.55} strokeWidth={1.2 + hot("cols") * 1.3} />
      </g>
      <g id={`${uid}cap-cols`} transform={translate(g.legendEnd.x + (legendEmpty ? 0 : 4), g.legendEnd.y + CH / 2 + 4)}>
        <text className="dx-slot-cap">{legendEmpty ? (g.narrow ? "drop here to split each bar" : "drop a field here to split each bar") : ""}</text>
        <text className="dx-slot-plus" opacity={chipDrag && roomIn("cols") && !legendEmpty ? 0.8 : 0}>{"+ split"}</text>
      </g>
      <g id={`${uid}slot-rows`} transform={translate(0, g.axisLine)}>
        <line className="dx-slot-line" x2={g.W} strokeOpacity={0.4 + hot("rows") * 0.55} strokeWidth={1.2 + hot("rows") * 1.3} />
      </g>
      <g id={`${uid}cap-rows-empty`} transform={translate(g.W / 2, g.axisLine - CH / 2 + 1)}>
        <text className="dx-slot-cap" textAnchor="middle">{state.rows.length ? "" : g.narrow ? "drop here to group the bars" : "drop a field here to group the bars along the axis"}</text>
      </g>
      <g id={`${uid}cap-rows`} transform={translate(g.axisEnd.x + 4, g.axisEnd.y + CH / 2 + 4)}>
        <text className="dx-slot-plus" opacity={chipDrag && roomIn("rows") && state.rows.length ? 0.8 : 0}>{"+ group"}</text>
      </g>
      {g.keyPos.map((k, i) => <g id={`${uid}key-${i}`} transform={translate(k.x, k.y)}>
        <rect className={`dx-bar dx-c${i % 6}`} y={CH / 2 - 5} width={10} height={10} rx={2} />
        <text className="dx-key-text" transform={translate(15, CH / 2 + 4)}>{data.values[data.colorBy!][i]}</text>
      </g>)}
      <g id={`${uid}axis`}>
        <line className="dx-baseline" x1={g.plot.x} x2={g.plot.x + g.plot.w} y1={g.y0} y2={g.y0} />
      </g>
      {g.ticks.map(t => <g id={`${uid}tick-${g.countView ? "c" : "m"}${Math.round(t * 1000)}`} transform={translate(0, g.Y(t))}>
        <line className="dx-grid" x1={g.plot.x} x2={g.plot.x + g.plot.w} opacity={t === 0 ? 0 : 1} />
        <text className="dx-tick" transform={translate(g.plot.x - 6, 3.5)} textAnchor="end">{tickFmt(t)}</text>
      </g>)}
      {g.groups.map(gr => <g id={`${uid}grp-${gr.id}`} transform={translate(gr.x + gr.w / 2, g.labelY.group)}>
        <text className="dx-group-label" textAnchor="middle">{gr.lines[0]}</text>
        <text className="dx-group-label" transform={translate(0, 13)} textAnchor="middle">{gr.lines[1]}</text>
        <text className="dx-group-label" transform={translate(4, -2) + rotateDeg(-40)} textAnchor="end" opacity={gr.tilt ? 1 : 0}>{gr.tilt}</text>
      </g>)}
      {g.outers.map(o => <g id={`${uid}og-${o.id}`} transform={translate(o.x + o.w / 2, g.labelY.outer)}>
        <path className="dx-span" d={`M${-o.w / 2 + 2},-10v-3h${o.w - 4}v3`} />
        <text className="dx-outer-label" transform={translate(0, 2)} textAnchor="middle">{o.lines[0]}</text>
        <text className="dx-outer-label" transform={translate(0, 15)} textAnchor="middle">{o.lines[1]}</text>
      </g>)}
      {g.bars.map(b => <g id={`${uid}bl-${b.gid}`} transform={translate(b.x + b.w / 2, 0)}>
        <text className="dx-bar-label" transform={translate(0, g.labelY.bar)} textAnchor="middle" opacity={g.showBarLabels ? 1 : 0}>{b.label[0]}</text>
        <text className="dx-bar-label" transform={translate(0, g.labelY.bar + 12)} textAnchor="middle" opacity={g.showBarLabels ? 1 : 0}>{b.label[1]}</text>
        <text className="dx-bar-n" transform={translate(0, g.labelY.n)} textAnchor="middle" opacity={g.showValues ? 1 : 0}>{`n=${Math.round(b.n)}`}</text>
        <path className="dx-bar-n-flag" d={`M${-textW(`n=${Math.round(b.n)}`, 10) / 2 - 6},${g.labelY.n - 3.5}h0`} opacity={b.small && g.showValues ? 1 : 0} />
      </g>)}
      <g id={`${uid}origin`} transform={translate(src ? src.x : 0, g.y0)} opacity={src ? 1 : 0}>
        <rect className="dx-origin" y={src ? -Math.max(src.h, 2) : -2} width={src ? src.w : 8} height={src ? Math.max(src.h, 2) : 2} />
      </g>
      {g.bars.map(b => {
        const id = `${uid}bar-${b.gid}`;
        const isSrc = src?.gid === b.gid;
        const x = isSrc ? silX : b.x, bw = isSrc && tgt ? tgt.w * 0.5 : b.w;
        const dim = cmp && !isSrc && tgt?.gid !== b.gid;
        const valueAt = tgt?.gid === b.gid ? translate(dir < 0 ? bw + 17 : -17, -b.h + 12) : translate(bw / 2, -b.h - 6);
        return <g id={id} transform={translate(x, g.y0)} dragologyZIndex={draggedId === id ? "/1" : isSrc ? 3 : 1}
          dragologyOnDrag={() => barSpec(b.gid)} opacity={dim ? 0.3 : 1} className="dx-bar-g">
          <rect className={b.color >= 0 ? `dx-bar dx-c${b.color % 6}` : "dx-bar dx-neutral"} y={-b.h} width={bw} height={Math.max(b.h, 1)}
            fillOpacity={b.small ? 0.42 : 1} />
          <rect className="dx-bar-small" y={-b.h} width={bw} height={Math.max(b.h, 1)} opacity={b.small ? 1 : 0} />
          <rect className="dx-bar-carry" y={-b.h} width={bw} height={Math.max(b.h, 1)} opacity={isSrc ? 1 : 0} />
          <rect className="dx-bar-hit" y={-Math.max(b.h, 24)} width={bw} height={Math.max(b.h, 24)} />
          <text className="dx-bar-value" transform={valueAt} textAnchor="middle" opacity={g.showValues || isSrc || tgt?.gid === b.gid ? 1 : 0}>{b.text}</text>
        </g>;
      })}
      <g id={`${uid}cmp`} opacity={src && tgt ? 1 : 0}>
        <path className="dx-bracket" d={`M${bx + dir * 4},${yT}L${bx},${yT}L${bx},${yS}L${bx + dir * 4},${yS}`} />
        <g transform={translate(pillX, pillY)}>
          <rect className="dx-pill" width={pillW} height={20} rx={10} />
          <text className="dx-pill-text" transform={translate(pillW / 2, 14)} textAnchor="middle">{pill}</text>
        </g>
      </g>
      {ZONES.flatMap(z => zoneFields(data, state, z)).map(f => {
        const c = g.chips[f], id = `${uid}chip-${f}`, inFilter = state.filter === f;
        return <g id={id} transform={translate(c.x, c.y)} dragologyZIndex={draggedId === id ? "/1" : 4} dragologyOnDrag={() => chipSpec(f)}
          className="dx-chip-g" onClick={() => { if (inFilter) commitRef.current({ ...state, filterValue: (state.filterValue + 1) % data.values[f].length, compare: null }, "click"); }}>
          <rect className="dx-chip" width={c.w} height={CH} rx={CH / 2} />
          <path className="dx-grip" d="M11,10h0M11,14h0M11,18h0M15,10h0M15,14h0M15,18h0" />
          <text className="dx-chip-text" transform={translate(23, CH / 2 + 4.2)}>{shorten(chipText(data, state, f), (c.w - 34 - (inFilter ? 14 : 0)) / 6.84)}</text>
          <path className="dx-caret" d={`M${c.w - 17},${CH / 2 - 2}L${c.w - 13},${CH / 2 + 2}L${c.w - 9},${CH / 2 - 2}`} opacity={inFilter ? 1 : 0} />
        </g>;
      })}
    </g>;
  };

  /* ---------- text ---------- */
  const said = view.compare ? compareSaid(view) ?? P.describe(data, view, flags) : P.describe(data, view, { seenFlip: flags.seenFlip || (!!live && seesFlip(view)) });
  const canExplain = !!data.config.question && (expectFlip ? flags.seenFlip : flags.stratified);
  const explainBase = (() => { const r = M.read(data, model, "measure"); return r && "strata" in r ? model : strataState; })();
  const ex = explainOpen && explainBase ? P.explain(data, explainBase) : null;
  const measureLabel = view.view === "count" ? "Cases" : data.measure.label ?? "Value";
  const title = `${measureLabel}${view.rows.length ? ` by ${M.joinAnd(view.rows.map(data.label))}` : ""}${view.cols.length ? `${view.rows.length ? ", split by " : " by "}${M.joinAnd(view.cols.map(data.label))}` : ""}${!view.rows.length && !view.cols.length ? ", all cases" : ""}${view.filter ? ` · only ${data.values[view.filter][view.filterValue]}` : ""}`;

  const share = () => {
    const s = P.shareSummary(data, model, { ...flags, whatIfT });
    setShared(true); onShare?.(s); setStatus("Shared with Keating.");
  };
  const setView = (v: M.View) => commit({ ...model, view: v }, "menu");
  const reset = () => { setHistory(h => [...h, model]); setModel(M.initialState(data)); setLive(null); setExplainOpen(false); setShared(false); onChange?.(); setStatus("Back to the starting layout."); };
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory(h => h.slice(0, -1)); setModel(prev); setLive(null); setShared(false); onChange?.(); setStatus(`Undone. ${P.describe(data, prev, flags).head}`); };

  /* test hook (one explorer per page) */
  const geoRef = useRef(geo); geoRef.current = geometry(data, model, W);
  const modelRef = useRef(model); modelRef.current = model;
  const liveRef = useRef(live); liveRef.current = live;
  const textRef = useRef({ said, flags, explainOpen, ex }); textRef.current = { said, flags, explainOpen, ex };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const origin = () => { const r = wrap.current!.querySelector("svg")!.getBoundingClientRect(); return { x: r.left, y: r.top }; };
    const chipAt = (gg: Geo, f: string) => { const o = origin(), c = gg.chips[f]; return { x: o.x + c.x + c.w / 2, y: o.y + c.y + CH / 2 }; };
    window.keatingData = {
      snapshot: () => {
        const s = modelRef.current, l = liveRef.current;
        return {
          title: data.config.title, rows: s.rows, cols: s.cols, filter: s.filter ? `${s.filter}:${data.values[s.filter][s.filterValue]}` : null, view: s.view,
          compare: s.compare, live: l ? { rows: l.rows, cols: l.cols, filter: l.filter, hot: l.hot, compare: l.compare } : null,
          reading: M.read(data, s)?.kind ?? null, head: textRef.current.said.head, tone: textRef.current.said.tone, flags: textRef.current.flags,
          explainOpen: textRef.current.explainOpen, explain: textRef.current.ex?.lines ?? null,
          bars: geoRef.current.bars.map(b => ({ label: b.full, value: b.v, n: b.n, small: b.small, gid: b.gid })),
        };
      },
      chip: (f: string) => chipAt(geoRef.current, f),
      /** A point on the canvas: the middle of the bars, the legend line, the axis line or the keep-only zone. */
      spot: (name: "bars" | "legend" | "axis" | "keep" | "tray") => {
        const o = origin(), gg = geoRef.current;
        const p = name === "bars" ? { x: gg.plot.x + gg.plot.w / 2, y: gg.plot.y + gg.plot.h * 0.55 }
          : name === "legend" ? { x: gg.W * 0.6, y: gg.legendLine - CH / 2 } : name === "axis" ? { x: gg.W * 0.6, y: gg.axisLine - CH / 2 }
          : name === "keep" ? { x: gg.keep.x + gg.keep.w * 0.7, y: gg.keep.y + gg.keep.h / 2 } : { x: 30, y: TOP + CH / 2 };
        return { x: o.x + p.x, y: o.y + p.y };
      },
      labels: () => ({ groups: geoRef.current.groups.map(x => x.tilt || x.lines.filter(Boolean).join(" ")), outers: geoRef.current.outers.map(x => x.lines.filter(Boolean).join(" ")), bars: geoRef.current.showBarLabels ? geoRef.current.bars.map(b => b.label.filter(Boolean).join(" ")) : [] }),
      target: (f: string, z: Zone, idx?: number) => chipAt(geometry(data, moveTo(data, modelRef.current, f, z, idx), W, modelRef.current), f),
      bar: (label: string) => {
        const b = geoRef.current.bars.find(x => x.full === label); if (!b) return null;
        const o = origin(); return { x: o.x + b.x + b.w / 2, y: o.y + geoRef.current.y0 - Math.max(b.h, 24) / 2 };
      },
    };
  });

  return <section className={`activity data-explorer${dragging ? " is-dragging" : ""}`} data-simulation="data-explorer" aria-labelledby={`${uid}title`}>
    <div className="dx-header">
      <h3 className="dx-title" id={`${uid}title`}>{data.config.title}</h3>
      {data.config.question?.ask && <span className="dx-ask">{data.config.question.ask}</span>}
    </div>
    {data.config.goal && <p className="dx-goal">{data.config.goal}</p>}
    {/* The first move is on the data: compare two bars. Shown above the chart until the learner regroups. */}
    {!view.compare && geo.bars.length > 1 && !flags.stratified && <p className="dx-hint dx-hint-first">Start with the bars: drag one onto another to compare them directly.</p>}
    <div className="dx-chart-head">
      <p className="dx-chart-title" aria-live="off">{title}</p>
      {data.measure.kind !== "count" && <div className="dx-seg" role="group" aria-label="Show">
        <button type="button" aria-pressed={model.view === "measure"} onClick={() => setView("measure")}>{data.measure.label ?? "Value"}</button>
        <button type="button" aria-pressed={model.view === "count"} onClick={() => setView("count")}>Counts</button>
      </div>}
    </div>
    <div className="dx-canvas" ref={wrap} aria-hidden="true">
      {geo.tooMany && <p className="dx-toomany">Too many groups to draw as bars ({M.barCount(data, view)}). The table below has them all.</p>}
      <DraggableRenderer key={gestureKey} draggable={draggable} state={view} width={W} height={geo.H}
        onDragState={s => setLive(s)}
        onDropState={s => commit(s, "drag")}
        onDragStatus={st => { onAnyDragStatus(st); setDragging(st.type === "dragging" ? "drag" : null); }} />
    </div>
    {data.config.source && <Source text={data.config.source} />}
    <div className={`dx-readout dx-tone-${said.tone}`}>
      <p className="dx-head">{said.head}</p>
      {said.body.map((b, i) => <p key={i}>{b}</p>)}

      {view.compare && <p className="dx-hint">
        {said.split && !dragging && <><button type="button" className="dx-link dx-split" onClick={() => { const z = said.split!; commit({ ...model, rows: [...model.rows.filter(k => k !== z), z].slice(-2), cols: model.cols.filter(k => k !== z), filter: model.filter === z ? null : model.filter, compare: null }, "menu"); }}>Split these bars by {data.label(said.split).toLowerCase()}</button>{" · "}</>}
        <button type="button" className="dx-link" onClick={() => commit({ ...model, compare: null }, "menu")}>Clear comparison</button></p>}
    </div>
    {canExplain && <div className="dx-explain">
      {!explainOpen ? <button type="button" className="quiet dx-explain-btn" onClick={() => { setExplainOpen(true); setFlags(f => ({ ...f, explained: true })); setStatus("Explanation opened."); }}>
        <Lightbulb size={14} aria-hidden="true" />{expectFlip ? "Explain the flip" : "Why didn’t it flip?"}</button>
        : ex && <div className="dx-explain-body" aria-label="Explanation">
          <p className="dx-explain-title">{expectFlip ? "Why it flips" : "Why it doesn’t flip"}</p>
          {ex.lines.map((l, i) => <p key={i}>{l}</p>)}
          <WhatIfView data={data} s={explainBase!} z={ex.z} W={W} uid={uid} reduced={reduced} gestureKey={gestureKey} onDragStatus={onAnyDragStatus} onT={t => { setWhatIfT(t); onChange?.(); }} />
          {data.config.question?.caveat && <p className="dx-caveat">{data.config.question.caveat}</p>}
        </div>}
    </div>}
    <details className="dx-more dx-table-details">
      <summary>Show the table <span className="dx-summary-meta">every group with its n</span></summary>
      <PivotTable data={data} s={view} />
    </details>
    <details className="dx-more dx-menus">
      <summary>Use buttons instead</summary>
      <div className="dx-menu-rows">
        {data.dims.map(f => {
          const z = zoneOf(model, f);
          return <div className="dx-menu-row" key={f}>
            <label htmlFor={`${uid}m-${f}`}>{data.label(f)}</label>
            <select id={`${uid}m-${f}`} value={z} onChange={e => commit(moveTo(data, model, f, e.target.value as Zone), "menu")}>
              {ZONES.map(o => <option key={o} value={o} disabled={(o === "rows" || o === "cols") && z !== o && (model[o].length >= 2 || M.barCount(data, moveTo(data, model, f, o)) > M.MAX_BARS)}>{ZONE_MENU[o]}</option>)}
            </select>
            {z === "filter" && <select aria-label={`${data.label(f)} value`} value={model.filterValue} onChange={e => commit({ ...model, filterValue: Number(e.target.value), compare: null }, "menu")}>
              {data.values[f].map((v, i) => <option key={v} value={i}>{v}</option>)}
            </select>}
          </div>;
        })}
        {geo.bars.length > 1 && <CompareMenu data={data} s={model} bars={geo.bars} uid={uid} onPick={c => commit({ ...model, compare: c }, "menu")} />}
      </div>
    </details>
    <span className="learning-lab__sr-only" role="status">{status}</span>
    <div className="actions dx-actions">
      <button type="button" className="primary" onClick={share} disabled={shared}>{shared ? "Shared" : "Share with Keating"}</button>
      {history.length > 0 && <button type="button" className="quiet" onClick={undo}><Undo2 size={13} aria-hidden="true" />Undo</button>}
      {history.length > 0 && <button type="button" className="quiet" onClick={reset}><RotateCcw size={13} aria-hidden="true" />Start over</button>}
    </div>
  </section>;
}

function CompareMenu({ data, s, bars, uid, onPick }: { data: Data; s: State; bars: Bar[]; uid: string; onPick: (c: [string, string] | null) => void }) {
  const [a, setA] = useState(s.compare?.[0] ?? "");
  const [b, setB] = useState(s.compare?.[1] ?? "");
  useEffect(() => { setA(s.compare?.[0] ?? ""); setB(s.compare?.[1] ?? ""); }, [s.compare?.[0], s.compare?.[1]]);
  const pick = (x: string, y: string) => { setA(x); setB(y); if (x && y && x !== y) onPick([x, y]); else if (!x || !y) onPick(null); };
  const opts = bars.filter(x => x.n > 0);
  return <div className="dx-menu-row">
    <label htmlFor={`${uid}cmp-a`}>Compare</label>
    <select id={`${uid}cmp-a`} value={a} onChange={e => pick(e.target.value, b)}><option value="">a bar…</option>{opts.map(x => <option key={x.gid} value={x.gid}>{x.full}</option>)}</select>
    <span className="dx-with">with</span>
    <select aria-label="Compare with" value={b} onChange={e => pick(a, e.target.value)}><option value="">another bar…</option>{opts.filter(x => x.gid !== a).map(x => <option key={x.gid} value={x.gid}>{x.full}</option>)}</select>
  </div>;
}

/** The source line: its first sentence, the rest on request (keeps the reply short). */
function Source({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  const first = m ? m[0] : text, more = text.slice(first.length).trim();
  return <p className="dx-source">{open || !more ? text : first}{more && <> <button type="button" className="dx-link dx-source-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Less" : "More about the data"}</button></>}</p>;
}

function shorten(s: string, n: number) { const k = Math.max(3, Math.floor(n)); return s.length <= k ? s : s.slice(0, k - 1) + "…"; }

/* ================= pivot table: every rate with its n ================= */
function PivotTable({ data, s }: { data: Data; s: State }) {
  const f = M.filterAssign(s);
  const rowsT = M.tuples(data, s.rows), colsT = M.tuples(data, s.cols);
  const cmp = new Set(s.compare ?? []);
  let anySmall = false;
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const check = () => { const el = box.current; if (el) setOver(el.scrollWidth - el.clientWidth - el.scrollLeft > 4); };
  useEffect(() => { check(); const el = box.current; if (!el) return; const ro = new ResizeObserver(check); ro.observe(el); return () => ro.disconnect(); });
  const cell = (a: M.Assign, margin = false) => {
    const g = M.agg(data, a);
    const small = s.view === "measure" && data.measure.kind !== "count" && g.n > 0 && g.n < data.small;
    anySmall ||= small;
    const v = M.valueOf(data, g, s.view);
    const n = s.view === "count" || data.measure.kind === "count" ? "" : data.measure.kind === "rate" ? `${Math.round(g.s)}/${Math.round(g.n)}` : `n=${Math.round(g.n)}`;
    const gid = M.gidOf(data, a);
    return <td className={`${small ? "is-small" : ""}${margin ? " is-margin" : ""}${cmp.has(gid) ? " is-compared" : ""}`} data-gid={gid}>
      <span className="dx-v">{g.n > 0 ? M.fmtValue(data, v, s.view) : "–"}</span>
      {n && <span className="dx-n">{n}{small && <span className="dx-flag" aria-label="small group">†</span>}</span>}
    </td>;
  };
  const colHead = s.cols.length ? colsT.map(ct => M.groupLabel(data, M.assignOf(s.cols, ct), s.cols)) : [s.view === "count" ? "Cases" : data.measure.label ?? "Value"];
  const body = (s.rows.length ? rowsT : [[]]).map(rt => {
    const ra = { ...f, ...M.assignOf(s.rows, rt) };
    return <tr key={rt.join("-") || "all"}>
      <th scope="row">{s.rows.length ? M.groupLabel(data, ra, s.rows) : s.filter ? data.values[s.filter][s.filterValue] : "All cases"}</th>
      {(s.cols.length ? colsT : [[]]).map((ct, i) => <Frag key={i}>{cell({ ...ra, ...M.assignOf(s.cols, ct) })}</Frag>)}
      {s.cols.length > 0 && cell(ra, true)}
    </tr>;
  });
  const totals = s.rows.length > 0 && <tr className="is-total">
    <th scope="row">All</th>
    {(s.cols.length ? colsT : [[]]).map((ct, i) => <Frag key={i}>{cell({ ...f, ...M.assignOf(s.cols, ct) }, true)}</Frag>)}
    {s.cols.length > 0 && cell(f, true)}
  </tr>;
  return <div className="dx-table-box">
    <div className="dx-table-wrap" ref={box} onScroll={check}>
    <table className="dx-table">
      <caption className="learning-lab__sr-only">{data.measure.label} table</caption>
      <thead><tr><th scope="col">{s.rows.map(data.label).join(" · ")}</th>{colHead.map(h => <th scope="col" key={h}>{h}</th>)}{s.cols.length > 0 && <th scope="col">All</th>}</tr></thead>
      <tbody>{body}{totals}</tbody>
    </table>
    </div>
    {over && <p className="dx-foot dx-scroll-cue">Scroll sideways for the rest of the table →</p>}
    {anySmall && <p className="dx-foot">† fewer than {data.small} cases: a rate from a group this small can swing a lot by chance.</p>}
  </div>;
}
function Frag({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/* ================= what-if: same per-group results, change one thing ================= */
type WState = { t: number };
function WhatIfView({ data, s, z, W, uid, onT, gestureKey, onDragStatus }: { data: Data; s: State; z: string; W: number; uid: string; reduced?: boolean; onT: (t: number) => void; gestureKey: number; onDragStatus: (st: { type: string }) => void }) {
  const w = M.whatIf(data, s, z);
  const [model, setModel] = useState<WState>({ t: 0 });
  const [live, setLive] = useState<WState | null>(null);
  useEffect(() => { setLive(null); }, [gestureKey]);
  if (!w) return null;
  const C = data.compare!, pair = data.pair!;
  const T = data.values[C][pair[w.target]], R = data.values[C][pair[1 - w.target]];
  const tColor = pair[w.target], rColor = pair[1 - w.target];
  const own = M.blend(w, 0).hardShare, ref = M.blend(w, 1).hardShare;
  const sw = W, H = 214;
  /* Magnetic ends: within about 12 px of the observed mix or of R's mix, the divider snaps there, so a
     hand drag lands on R's exact mix (it used to land a point short). */
  const snapT = (t: number) => {
    const span = Math.abs(own - ref) * sw;
    if (span <= 0) return t;
    return (1 - t) * span < 12 ? 1 : t * span < 12 ? 0 : t;
  };
  const st = { t: snapT((live ?? model).t) };
  const cur = M.blend(w, st.t);
  const movable = Math.abs(own - ref) >= 0.03;
  const fm = (v: number) => M.fmtValue(data, v, "measure");
  const ymax = data.measure.kind === "rate" ? 1 : data.domain[1];

  const draggable: Draggable<WState> = ({ state, d, draggedId }) => {
    const b = M.blend(w, snapT(state.t));
    const refX = (1 - ref) * sw;
    const kx = (1 - b.hardShare) * sw;
    const strip = (row: string, y: number, mix: number[]) => {
      let x = 0;
      return w.order.map((zi, k) => {
        const width = mix[zi] * sw, x0 = x; x += width;
        const name = data.values[z][zi], label = `${name} ${M.pct(mix[zi])}`;
        const txt = textW(label, 10.5) < width - 8 ? label : textW(M.pct(mix[zi]), 10.5) < width - 6 ? M.pct(mix[zi]) : "";
        const hard = w.hard.includes(zi);
        return <g id={`${uid}w-${row}-${zi}`} transform={translate(x0, y)}>
          <rect className="dx-mixseg" width={Math.max(0.5, width - 1)} height={22} fillOpacity={0.08 + 0.24 * (k / Math.max(1, w.order.length - 1))} />
          <text className={hard ? "dx-mixseg-text is-hard" : "dx-mixseg-text"} transform={translate(5, 15)}>{txt}</text>
        </g>;
      });
    };
    const res = [
      { id: "obs", label: `${T} as observed`, v: w.observed, cls: `dx-c${tColor % 6}`, op: 0.35 },
      { id: "mix", label: `${T} with this mix`, v: b.value, cls: `dx-c${tColor % 6}`, op: 1 },
      { id: "ref", label: `${R} as observed`, v: w.refValue, cls: `dx-c${rColor % 6}`, op: 1 },
    ];
    return <g>
      <g id={`${uid}w-cap-t`}><text className="dx-w-cap" transform={translate(0, 11)} opacity={movable && (1 - M.blend(w, 1).hardShare) * sw <= 190 ? 0 : 1}>{`${T}’s cases by ${data.label(z).toLowerCase()}`}</text></g>
      {strip("t", 16, b.mix)}
      <g id={`${uid}w-refmark`} transform={translate(refX, 0)} opacity={movable ? 1 : 0}>
        <line className="dx-refmark" y1={13} y2={41} />
        <text className="dx-w-cap" transform={translate(-6, 11)} textAnchor="end" opacity={refX > 190 ? 1 : 0}>{`${R}’s mix`}</text>
        <text className="dx-w-cap" transform={translate(6, 11)} opacity={refX > 190 ? 0 : 1}>{`${R}’s mix`}</text>
      </g>
      <g id={`${uid}w-cap-r`}><text className="dx-w-cap" transform={translate(0, 69)}>{`${R}’s cases (fixed)`}</text></g>
      {strip("r", 74, w.ref)}
      <g id={`${uid}w-knob`} transform={translate(kx, 0)} dragologyZIndex={draggedId === `${uid}w-knob` ? "/1" : 2}
        dragologyOnDrag={movable ? () => d.vary(state, param("t"), { constraint: (x: WState) => inOrder([0, x.t, 1]) }) : undefined} opacity={movable ? 1 : 0}>
        <rect className="dx-hit" x={-14} y={8} width={28} height={46} />
        <line className="dx-knob-line" y1={12} y2={42} />
        <circle className="dx-knob" cy={44} r={7} />
      </g>
      {res.map((r, i) => <g id={`${uid}w-res-${r.id}`} transform={translate(0, 122 + i * 30)}>
        <text className="dx-w-res-label" transform={translate(0, 0)}>{r.label}</text>
        <rect className={`dx-bar ${r.cls}`} y={6} width={Math.max(1, (Math.max(0, r.v) / ymax) * (sw - 44))} height={11} fillOpacity={r.op} />
        <text className="dx-w-res-v" transform={translate(Math.max(1, (Math.max(0, r.v) / ymax) * (sw - 44)) + 5, 16)}>{fm(r.v)}</text>
      </g>)}
    </g>;
  };
  const commitT = (t: number, snap = true) => { const c = Math.min(1, Math.max(0, snap ? snapT(t) : t)); setModel({ t: c }); setLive(null); onT(c); };
  const flipped = Math.sign(cur.value - w.refValue) !== Math.sign(w.observed - w.refValue);
  const msg = !movable
    ? `${T} and ${R} already have almost the same share of ${w.hardLabel} cases, so changing the mix can’t move much here.`
    : `Same results within each ${data.label(z).toLowerCase()}; only ${T}’s mix changes. With ${M.pct(cur.hardShare)} of its cases in ${w.hardLabel} (observed ${M.pct(own)}, ${R} ${M.pct(ref)}), ${T} would come out at ${fm(cur.value)} overall, against ${R}’s ${fm(w.refValue)}.${flipped ? ` That’s ahead of ${R}.` : ""}`;
  return <div className="dx-whatif">
    <p className="dx-whatif-title">Change one thing: {T}’s mix of {data.label(z).toLowerCase()}</p>
    {movable && <p className="dx-whatif-hint">Drag the divider on {T}’s strip. The results within each {data.label(z).toLowerCase()} stay fixed.</p>}
    <div className="dx-canvas dx-whatif-canvas" aria-hidden="true">
      <DraggableRenderer key={gestureKey} draggable={draggable} state={st} width={sw} height={H}
        onDragState={x => setLive(x)} onDropState={x => commitT(x.t)} onDragStatus={onDragStatus} />
    </div>
    <p className="dx-whatif-text" role="status">{msg}</p>
    <div className="dx-whatif-controls">
      <label htmlFor={`${uid}w-range`}>Move {T}’s mix toward {R}’s</label>
      <input id={`${uid}w-range`} type="range" min={0} max={100} step={1} value={Math.round(st.t * 100)} disabled={!movable}
        onChange={e => commitT(Number(e.target.value) / 100, false)} />
      <button type="button" className="quiet" onClick={() => commitT(0)} disabled={!movable || model.t === 0}>Observed mix</button>
      <button type="button" className="quiet" onClick={() => commitT(1)} disabled={!movable || model.t === 1}>Same mix as {R}</button>
    </div>
  </div>;
}
