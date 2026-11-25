import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DraggableRenderer, translate, scale, type Draggable, type DragSpec } from "dragology";
import { ART, DIAGRAMS, artNames, diagramNames, type SortShape, type SortTone, type DiagramAnchor } from "./art";
import "./component.css";

export type { SortShape, SortTone } from "./art";
export { artNames, diagramNames } from "./art";

/* =====================================================================================
   SortBoard: one "put each thing where it belongs" manipulative with three layouts.
     sequence  order the steps of a process along a track (a timeline or a cycle). With art, the
               learner drags the drawings themselves (the cell at that stage) and the track shows the
               process transforming; without art, the step names are the subject.
     bins      classify examples (with or without a small drawing) into flat category zones.
     label     drag names onto numbered spots of a diagram; leader lines attach.
   Art comes from a vetted library by name ("cell.metaphase", diagram "plantCell") or, as an escape
   hatch, a short whitelisted shape list.
   Learning design: per-item checking, an "unsure" mark, feedback that explains each miss, a retry of
   only the missed or unsure items, and a share summary that names each miss's own misconception.
   ===================================================================================== */

export type ShareSummary = { learner: string; data: string; reply: string };

/* ---------- Config (JSON-serialisable; a model authors this) ---------- */

/** A library art name (see `artNames`) or a shape list drawn in a 100 × 80 box. */
export type ArtRef = string | SortShape[];
/** Feedback for one particular wrong place, optionally naming the misconception that place reveals. */
export type WrongEntry = string | { why: string; misconception?: string };
export type SortItem = {
  id: string;
  label: string;
  /** Why the right answer is right. Shown when the learner misplaces it (or was unsure). */
  why: string;
  /** Key into `misconceptions`: the idea a miss on this item most likely reveals. */
  misconception?: string;
  /** Sharper feedback for a particular wrong place (bin id or part id). */
  wrong?: Record<string, WrongEntry>;
};
/** A step of a process, listed in the correct order. */
export type SequenceStep = SortItem & { effect?: string; art?: ArtRef };
export type SortBin = { id: string; label: string; hint?: string };
export type BinItem = SortItem & { bin: string; art?: ArtRef };
/** A diagram part: `at` is a library anchor name (library diagram) or [x, y] (shape-list diagram). */
export type LabelPart = SortItem & { at: string | [number, number] };
export type TrackEnd = { label: string; art?: ArtRef };
export type CustomDiagram = { width: number; height: number; shapes: SortShape[] };

type ConfigBase = {
  title: string;
  instructions?: string;
  /** Short plural noun for the share text, e.g. "stages" or "examples". */
  noun?: string;
  misconceptions?: Record<string, { name: string; reply: string }>;
  /** Keating's reply when everything was right first time and nothing was marked unsure. */
  perfectReply?: string;
  /** Hide item names until the check, so the learner recognises items from their drawings alone. */
  hideLabels?: boolean;
};
export type SortBoardConfig = ConfigBase & (
  | { layout: "sequence"; steps: SequenceStep[]; track?: { shape?: "line" | "cycle"; start?: TrackEnd; end?: TrackEnd; center?: TrackEnd }; startOrder?: string[] }
  | { layout: "bins"; bins: SortBin[]; items: BinItem[] }
  | { layout: "label"; diagram: string | CustomDiagram; parts: LabelPart[] }
);

/* ---------- Validation ---------- */

const TONES = new Set<SortTone>(["ink", "muted", "line", "soft", "paper", "accent", "c1", "c2", "c3", "c4", "c5", "c6", "none"]);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isId = (v: unknown) => typeof v === "string" && ID.test(v);
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]{1,600}$/;
const fin = (...v: unknown[]) => v.every(x => typeof x === "number" && Number.isFinite(x));
const rec = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 400) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optStr = (v: unknown, max = 400) => v === undefined || str(v, max);

function shapeErrors(shapes: unknown, where: string): string[] {
  if (!Array.isArray(shapes)) return [`${where}: shapes must be a list`];
  if (shapes.length > 80) return [`${where}: at most 80 shapes`];
  const errs: string[] = [];
  shapes.forEach((s: any, i) => {
    const at = `${where}[${i}]`;
    if (!s || typeof s !== "object") return errs.push(`${at}: not a shape`);
    for (const k of ["fill", "stroke"] as const) if (s[k] !== undefined && !TONES.has(s[k])) errs.push(`${at}: unknown tone ${s[k]}`);
    if (s.width !== undefined && !fin(s.width)) errs.push(`${at}: width`);
    if (s.opacity !== undefined && !fin(s.opacity)) errs.push(`${at}: opacity`);
    const ok = s.kind === "circle" ? fin(s.cx, s.cy, s.r)
      : s.kind === "ellipse" ? fin(s.cx, s.cy, s.rx, s.ry)
      : s.kind === "rect" ? fin(s.x, s.y, s.w, s.h) && (s.rx === undefined || fin(s.rx))
      : s.kind === "path" ? typeof s.d === "string" && PATH_D.test(s.d)
      : s.kind === "text" ? fin(s.x, s.y) && str(s.text, 60) && (s.size === undefined || fin(s.size))
      : false;
    if (!ok) errs.push(`${at}: bad ${String(s.kind)} shape`);
  });
  return errs;
}
function artErrors(a: unknown, where: string): string[] {
  if (a === undefined) return [];
  if (typeof a === "string") return ART[a] ? [] : [`${where}: unknown art "${a.slice(0, 40)}"`];
  return shapeErrors(a, where);
}

/** House validator: [] means the config is valid. */
export function validateSortBoard(c: unknown): string[] {
  const cfg = c as any;
  if (!cfg || typeof cfg !== "object") return ["config is not an object"];
  const errs: string[] = [];
  if (!str(cfg.title, 120)) errs.push("title is required");
  if (!optStr(cfg.instructions, 400)) errs.push("instructions must be text");
  if (!optStr(cfg.noun, 40)) errs.push("noun must be text");
  if (!optStr(cfg.perfectReply, 600)) errs.push("perfectReply must be text");
  if (cfg.hideLabels !== undefined && typeof cfg.hideLabels !== "boolean") errs.push("hideLabels must be true or false");
  if (cfg.misconceptions !== undefined && (!rec(cfg.misconceptions) || Object.values(cfg.misconceptions).some((v: any) => !v || !str(v.name, 120) || !str(v.reply, 600)))) errs.push("misconceptions need a name and a reply");
  const items: any[] = cfg.layout === "sequence" ? cfg.steps : cfg.layout === "bins" ? cfg.items : cfg.layout === "label" ? cfg.parts : null;
  if (!items) return [...errs, "layout must be sequence, bins or label"];
  if (!Array.isArray(items) || items.length < 2 || items.length > 12) return [...errs, "between 2 and 12 items"];
  const ids = new Set<string>();
  items.forEach((it, i) => {
    if (!it || !isId(it.id)) errs.push(`item ${i}: id`);
    else if (ids.has(it.id)) errs.push(`item ${i}: duplicate id`);
    else ids.add(it.id);
    if (!str(it?.label, 140)) errs.push(`item ${i}: label`);
    if (!str(it?.why, 600)) errs.push(`item ${i}: why`);
    if (!optStr(it?.misconception, 40)) errs.push(`item ${i}: misconception must be a key`);
    if (cfg.layout === "sequence" && !optStr(it?.effect, 200)) errs.push(`step ${i}: effect must be text`);
    if (it?.wrong !== undefined && (!rec(it.wrong) || Object.values(it.wrong).some((v: any) => !(str(v, 600) || (rec(v) && str(v.why, 600) && optStr(v.misconception, 40)))))) errs.push(`item ${i}: wrong`);
  });
  if (cfg.layout === "sequence") {
    items.forEach((it, i) => errs.push(...artErrors(it?.art, `step ${i} art`)));
    const t = cfg.track;
    if (t !== undefined && !rec(t)) errs.push("track must be an object");
    else if (t !== undefined) {
      if (t.shape !== undefined && t.shape !== "line" && t.shape !== "cycle") errs.push("track.shape");
      for (const k of ["start", "end", "center"]) if (t[k] !== undefined && !rec(t[k])) errs.push(`track.${k} must be an object`);
      else if (t[k] !== undefined) {
        if (!str(t[k].label, 80)) errs.push(`track.${k}.label`);
        errs.push(...artErrors(t[k].art, `track.${k}.art`));
      }
    }
    if (cfg.startOrder !== undefined && (!Array.isArray(cfg.startOrder) || cfg.startOrder.length !== items.length || new Set(cfg.startOrder).size !== items.length || cfg.startOrder.some((x: string) => !ids.has(x)))) errs.push("startOrder must list every step once");
  }
  if (cfg.layout === "bins") {
    if (!Array.isArray(cfg.bins) || cfg.bins.length < 2 || cfg.bins.length > 4) errs.push("2 to 4 bins");
    else {
      const bins = new Set<string>();
      cfg.bins.forEach((b: any, i: number) => { if (!rec(b) || !isId(b.id) || bins.has(b.id) || !str(b.label, 40) || !optStr(b.hint, 200)) errs.push(`bin ${i}`); else bins.add(b.id); });
      items.forEach((it, i) => { if (!bins.has(it?.bin)) errs.push(`item ${i}: unknown bin`); errs.push(...artErrors(it?.art, `item ${i} art`)); });
    }
  }
  if (cfg.layout === "label") {
    const dg = cfg.diagram;
    if (typeof dg === "string") {
      const lib = DIAGRAMS[dg];
      if (!lib) errs.push(`unknown diagram "${dg.slice(0, 40)}"`);
      else items.forEach((it, i) => { if (typeof it?.at !== "string" || !lib.anchors[it.at]) errs.push(`part ${i}: at must be one of ${Object.keys(lib.anchors).join(", ")}`); });
    } else if (!dg || !fin(dg.width, dg.height) || dg.width < 40 || dg.height < 40) errs.push("diagram size");
    else {
      errs.push(...shapeErrors(dg.shapes, "diagram"));
      items.forEach((it, i) => {
        const a = it?.at;
        if (!Array.isArray(a) || !fin(a[0], a[1]) || a[0] < 0 || a[1] < 0 || a[0] > dg.width || a[1] > dg.height) errs.push(`part ${i}: at`);
      });
    }
    const seen = new Set<string>();
    items.forEach((it, i) => { const k = JSON.stringify(it?.at); if (seen.has(k)) errs.push(`part ${i}: two parts share a spot`); seen.add(k); });
  }
  return errs;
}

/* ---------- Normalised model ---------- */

type Layout = SortBoardConfig["layout"];
type NItem = SortItem & { answer: string; rank: number; effect?: string; art?: SortShape[] };
type Zone = { id: string; label: string; hint?: string; at?: [number, number]; pin?: [number, number]; num?: number };
type Model = {
  layout: Layout; cycle: boolean; hasArt: boolean; items: NItem[]; byId: Record<string, NItem>; zones: Zone[]; zoneById: Record<string, Zone>;
  home: string[]; cfg: SortBoardConfig; diagram?: CustomDiagram;
};
const TRACK = "track";
const TRAY = "tray";
const resolveArt = (a?: ArtRef): SortShape[] | undefined => typeof a === "string" ? ART[a] : a;

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffled<T>(xs: T[], seed: string, key: (x: T) => string): T[] {
  return [...xs].sort((a, b) => hash(seed + key(a)) - hash(seed + key(b)));
}

function buildModel(cfg: SortBoardConfig): Model {
  let items: NItem[]; let zones: Zone[]; let diagram: CustomDiagram | undefined;
  if (cfg.layout === "sequence") {
    items = cfg.steps.map((s, i) => ({ ...s, art: resolveArt(s.art), answer: TRACK, rank: i }));
    zones = [{ id: TRACK, label: "the track" }];
  } else if (cfg.layout === "bins") {
    items = cfg.items.map((s, i) => ({ ...s, art: resolveArt(s.art), answer: s.bin, rank: i }));
    zones = cfg.bins.map(b => ({ ...b }));
  } else {
    const lib = typeof cfg.diagram === "string" ? DIAGRAMS[cfg.diagram] : undefined;
    diagram = lib ? { width: lib.width, height: lib.height, shapes: lib.shapes } : cfg.diagram as CustomDiagram;
    items = cfg.parts.map((p, i) => ({ ...p, answer: p.id, rank: i }));
    zones = cfg.parts.map((p, i) => {
      const a: DiagramAnchor = lib ? lib.anchors[p.at as string] : { at: p.at as [number, number] };
      return { id: p.id, label: `spot ${i + 1}`, at: a.at, pin: a.pin, num: i + 1 };
    });
  }
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  let home = cfg.layout === "sequence" && cfg.startOrder ? [...cfg.startOrder] : shuffled(items, cfg.title, i => i.id).map(i => i.id);
  if (cfg.layout === "sequence" && !cfg.startOrder && home.every((id, i) => id === items[i].id)) home = [...home.slice(1), home[0]];
  return {
    layout: cfg.layout, cycle: cfg.layout === "sequence" && cfg.track?.shape === "cycle", hasArt: items.some(i => i.art?.length),
    items, byId, zones, zoneById: Object.fromEntries(zones.map(z => [z.id, z])), home, cfg, diagram,
  };
}

/* ---------- Board state (what Dragology renders) ---------- */

type Board = { z: Record<string, string[]>; u: string[]; hot: string | null };
function emptyBoard(m: Model): Board {
  const z: Record<string, string[]> = { [TRAY]: m.items.map(i => i.id) };
  for (const zone of m.zones) z[zone.id] = [];
  return { z, u: [], hot: null };
}
const zoneOf = (b: Board, id: string) => Object.keys(b.z).find(k => b.z[k].includes(id)) ?? TRAY;
function without(b: Board, id: string): Board {
  return { ...b, z: Object.fromEntries(Object.entries(b.z).map(([k, v]) => [k, v.filter(x => x !== id)])) };
}
function insert(b: Board, zone: string, id: string, at: number, hot: string | null = zone): Board {
  const list = [...b.z[zone]]; list.splice(Math.max(0, Math.min(at, list.length)), 0, id);
  return { ...b, z: { ...b.z, [zone]: list }, hot };
}
/** Every place item `id` could be dropped, as whole boards. Label spots hold one label: dropping on a
    taken spot swaps, sending the occupant to where the dragged label came from. */
function candidates(m: Model, b: Board, id: string, locked: Set<string>): Board[] {
  const from = zoneOf(b, id);
  const rest = without(b, id);
  const out: Board[] = [insert(rest, TRAY, id, rest.z[TRAY].length, TRAY)];
  for (const zone of m.zones) {
    const list = rest.z[zone.id];
    if (m.layout === "label") {
      const occ = list[0];
      if (occ && locked.has(occ)) continue;
      let next = insert({ ...rest, z: { ...rest.z, [zone.id]: [] } }, zone.id, id, 0);
      if (occ) next = { ...next, z: { ...next.z, [from]: from === TRAY ? [...next.z[TRAY], occ] : [occ] } };
      out.push(next);
    } else for (let p = 0; p <= list.length; p++) out.push(insert(rest, zone.id, id, p));
  }
  return out;
}

/* ---------- Grading ---------- */

type Outcome = "right" | "wrong" | "lucky" | "doubt"; // lucky = right but unsure, doubt = wrong and unsure
type ItemResult = { outcome: Outcome; zone: string; prev?: string; correctPrev?: string };
type Grade = Record<string, ItemResult>;

/** Longest correctly ordered run (by rank) of a placed order; locked items weigh more so a retry never
    re-flags a step already earned. Returns the ids judged "in order". */
function inOrder(order: string[], rank: (id: string) => number, weight: (id: string) => number): Set<string> {
  const n = order.length; if (!n) return new Set();
  const best = order.map(weight); const prev = order.map(() => -1);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++)
    if (rank(order[j]) < rank(order[i]) && best[j] + weight(order[i]) > best[i]) { best[i] = best[j] + weight(order[i]); prev[i] = j; }
  let end = 0; for (let i = 1; i < n; i++) if (best[i] > best[end]) end = i;
  const keep = new Set<string>(); for (let i = end; i >= 0; i = prev[i]) keep.add(order[i]);
  return keep;
}

/** Grades placed items. Unplaced items are graded only when `includeTray` (a full check). */
function grade(m: Model, b: Board, locked: Set<string>, includeTray = true): Grade {
  const unsure = new Set(b.u);
  const g: Grade = {};
  const mark = (id: string, ok: boolean, extra: Partial<ItemResult>) => {
    g[id] = { outcome: ok ? (unsure.has(id) ? "lucky" : "right") : (unsure.has(id) ? "doubt" : "wrong"), zone: zoneOf(b, id), ...extra };
  };
  if (m.layout === "sequence") {
    const order = b.z[TRACK];
    const rank = (id: string) => m.byId[id].rank;
    const weight = (id: string) => locked.has(id) ? 100 : 1;
    let keep = new Set<string>(); let score = -1;
    for (let r = 0; r < (m.cycle ? order.length : 1); r++) {
      const o = [...order.slice(r), ...order.slice(0, r)];
      const k = inOrder(o, rank, weight);
      const s = [...k].reduce((a, id) => a + weight(id), 0);
      if (s > score) { score = s; keep = k; }
    }
    const firstLabel = m.cycle ? undefined : (m.cfg as any).track?.start?.label as string | undefined;
    order.forEach((id, i) => {
      const prevId = i > 0 ? order[i - 1] : m.cycle ? order[order.length - 1] : undefined;
      const r = rank(id);
      const correctPrevId = r > 0 ? m.items[r - 1].id : m.cycle ? m.items[m.items.length - 1].id : undefined;
      mark(id, keep.has(id), {
        prev: prevId ? m.byId[prevId].label : firstLabel ?? "the start",
        correctPrev: correctPrevId ? m.byId[correctPrevId].label : firstLabel ?? "the start",
      });
    });
    if (includeTray) for (const id of b.z[TRAY]) mark(id, false, {});
  } else {
    for (const it of m.items) if (includeTray || zoneOf(b, it.id) !== TRAY) mark(it.id, zoneOf(b, it.id) === it.answer, {});
  }
  return g;
}
const isMiss = (r?: ItemResult) => !r || r.outcome !== "right";
const isWrong = (r?: ItemResult) => !!r && (r.outcome === "wrong" || r.outcome === "doubt");
const wrongEntry = (it: NItem, zone?: string): { why?: string; misconception?: string } => {
  const w = zone ? it.wrong?.[zone] : undefined;
  return typeof w === "string" ? { why: w } : w ?? {};
};
/** The misconception a miss reveals: the wrong place's own key if it names one, else the item's. */
const missKey = (it: NItem, r: ItemResult) => wrongEntry(it, r.zone).misconception ?? it.misconception;

function feedbackFor(m: Model, it: NItem, r: ItemResult): string {
  const why = wrongEntry(it, r.zone).why ?? it.why;
  if (r.outcome === "lucky") return `Right, though you weren’t sure. ${it.why}`;
  if (m.layout === "sequence") {
    if (r.zone === TRAY) return `Not placed yet. ${it.why}`;
    return `You put it after ${r.prev}; it comes right after ${r.correctPrev}. ${why}`;
  }
  const chosen = r.zone === TRAY ? "not placed" : m.layout === "label" ? `on ${m.zoneById[r.zone].label}` : `in ${m.zoneById[r.zone].label}`;
  const right = m.layout === "label" ? `it labels ${m.zoneById[it.answer].label}` : `it belongs in ${m.zoneById[it.answer].label}`;
  return `You put it ${chosen}; ${right}. ${why}`;
}

/* ---------- Geometry ---------- */

const PAD = 14;
const LINE = 15;
function wrap(text: string, width: number, charW = 6.5): string[] {
  const max = Math.max(5, Math.floor(width / charW));
  const lines: string[] = []; let cur = "";
  for (const w of text.split(/\s+/)) {
    if (!cur) cur = w; else if ((cur + " " + w).length <= max) cur += " " + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 5);
}
const textH = (lines: number) => lines * LINE + 9;
const Q_SPACE = 24; // right-hand room for the "?" toggle on text items

type Pt = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** How one item is drawn in one state. Every item renders the same children in every state, so
    Dragology can blend tray ⇄ placed: only numbers (positions, sizes, opacities) differ. */
type ItemPos = {
  x: number; y: number; w: number; h: number; placed: boolean;
  artX: number; artY: number; aw: number;          // aw = drawn art width (0 = no art)
  nameX: number; nameY: number; lines: string[]; nameO: number;
  capX: number; capY: number; capLines: string[]; capO: number;
  ruleO: number; qX: number; qY: number; markX: number; markY: number;
};

/** The tray reflows: items sit in `order`, packed into `cols` columns. Its height is fixed for the
    round (sized for everything that started the round there) so nothing below it jumps mid-drag. */
type Tray = { top: number; h: number; cols: number; cellW: number; gap: number; x0: number; hOf: (id: string) => number };
function flowTray(t: Tray, ids: string[]): Record<string, Pt> {
  const pos: Record<string, Pt> = {}; let y = t.top;
  for (let r = 0; r * t.cols < ids.length; r++) {
    const row = ids.slice(r * t.cols, r * t.cols + t.cols);
    row.forEach((id, c) => { pos[id] = { x: t.x0 + c * (t.cellW + t.gap), y }; });
    y += Math.max(...row.map(t.hOf)) + t.gap;
  }
  return pos;
}
function makeTray(roundIds: string[], cols: number, cellW: number, hOf: (id: string) => number, gap: number, x0 = PAD): Tray {
  const t: Tray = { top: PAD + 18, h: 0, cols, cellW, gap, x0, hOf };
  if (!roundIds.length) return { ...t, top: 0, h: 0 }; // collapsed after a check
  let y = 0;
  for (let r = 0; r * cols < roundIds.length; r++) y += Math.max(...roundIds.slice(r * cols, r * cols + cols).map(hOf)) + gap;
  t.h = y - gap;
  return t;
}

type SeqGeom = {
  kind: "sequence"; W: number; H: number; tray: Tray; nodes: Pt[]; NW: number; nodeH: number; artW: number; artH: number; TA: number; cellW: number;
  nameLines: Record<string, string[]>; capLines: Record<string, string[]>; nameH: number; slotNode: (s: number) => number;
  hasStart: boolean; hasEnd: boolean; cycle?: { cx: number; cy: number; rx: number; ry: number }; links: { d: string; head: string; a: number; b: number }[];
};
type BinsGeom = { kind: "bins"; W: number; wide: boolean; cw: number; tray: Tray; lines: Record<string, string[]>; hOf: (id: string) => number; headH: number; hints: Record<string, string[]>; zonesTop: number; minZoneH: number; maxChip: number };
type LabelGeom = {
  kind: "label"; W: number; H: number; tray: Tray; gw: number; ch: number; lines: Record<string, string[]>; wide: boolean;
  dx: number; dy: number; s: number; slots: Record<string, Pt & { side: "left" | "right" }>; anchors: Record<string, Pt>; markers: Record<string, Pt>; leaders: Record<string, string>; mr: number;
};
type Geom = SeqGeom | BinsGeom | LabelGeom;

function ellipsePt(c: { cx: number; cy: number; rx: number; ry: number }, a: number): Pt { return { x: c.cx + c.rx * Math.cos(a), y: c.cy + c.ry * Math.sin(a) }; }
function arrowHead(tip: Pt, from: Pt, size = 6): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const p = (da: number) => `${(tip.x - size * Math.cos(a + da)).toFixed(1)} ${(tip.y - size * Math.sin(a + da)).toFixed(1)}`;
  return `M${p(0.5)} L${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L${p(-0.5)}`;
}
const inside = (p: Pt, b: Box, pad: number) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
const fmt = (pts: Pt[]) => "M" + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L");

function seqGeom(m: Model, W: number, roundIds: string[]): SeqGeom {
  const cfg = m.cfg as Extract<SortBoardConfig, { layout: "sequence" }>;
  const n = m.items.length; const cyc = m.cycle; const art = m.hasArt;
  const hasStart = !cyc && !!cfg.track?.start, hasEnd = !cyc && !!cfg.track?.end;
  const N = n + +hasStart + +hasEnd;
  const gap = 18; const narrowCycle = cyc && W < 460;
  let NW: number, cols = 1, rows = 1;
  if (!cyc) {
    const maxCols = Math.max(2, Math.min(6, Math.floor((W - 2 * PAD + gap) / ((art ? 100 : 108) + gap))));
    rows = Math.ceil(N / Math.min(maxCols, N)); cols = Math.ceil(N / rows);
    NW = (W - 2 * PAD - (cols - 1) * gap) / cols;
  } else NW = narrowCycle ? Math.min(108, (W - 2 * PAD - 28) / 2) : 124;
  const artW = !art ? 0 : cyc ? (narrowCycle ? NW - 14 : NW - 34) : Math.min(NW - 10, 110);
  const artH = artW * 0.8;
  // art items: the drawing is the item, its name sits under it; text items: the name with a left rule
  // Names keep the same lines in the tray and on the track (stable tspans across drop candidates), so an art
  // name wraps to the narrower tray cell: "Cytokinesis complete" would otherwise overflow its tray cell.
  const TA = art ? Math.min(artW, W < 460 ? 56 : 74) : 0;
  const cellW = art ? Math.max(TA + 14, Math.min(NW, W < 460 ? 70 : 92)) : NW;
  const nameLines = Object.fromEntries(m.items.map(i => [i.id, wrap(i.label, art ? Math.min(NW, cellW + 8) - 4 : NW - 14 - Q_SPACE, art ? 6.6 : 6.5)]));
  const maxLines = Math.max(...Object.values(nameLines).map(l => l.length));
  const nameH = art ? maxLines * 14 + 4 : textH(maxLines);
  const capLines = Object.fromEntries(m.items.map(i => [i.id, i.effect ? wrap(i.effect, NW - 2, 5.7) : []]));
  const capH = Math.max(0, ...Object.values(capLines).map(l => l.length)) * 13;
  const nodeH = artH + (art ? 6 : 0) + nameH + (capH ? 6 + capH : 0);
  // tray: drawings sit smaller in the tray and grow as they are placed
  const trayH = (_: string) => art ? TA * 0.8 + 6 + nameH : nameH;
  const tgap = W < 460 ? 6 : 12;
  const tcols = Math.max(1, Math.floor((W - 2 * PAD + tgap) / (cellW + tgap)));
  const tray = makeTray(roundIds, tcols, cellW, trayH, tgap);
  const trackTop = roundIds.length ? tray.top + tray.h + 30 : PAD + 8; // room for the result marks
  const nodes: Pt[] = []; const links: SeqGeom["links"] = [];
  const midY = (p: Pt) => p.y + (art ? artH / 2 : nameH / 2);
  const edgeX = (p: Pt, right: boolean, pad: number) => art ? (right ? p.x + (NW + artW) / 2 + pad : p.x + (NW - artW) / 2 - pad) : (right ? p.x + NW + pad : p.x - pad);
  let H: number; let cycle: SeqGeom["cycle"];
  const across = (a: Pt, b: Pt) => {
    const y = Math.max(midY(a), midY(b)); const right = b.x > a.x;
    const p1 = { x: edgeX(a, right, 4), y }, p2 = { x: edgeX(b, !right, 5), y };
    return { d: fmt([p1, p2]), head: arrowHead(p2, p1) };
  };
  const down = (a: Pt, b: Pt) => {
    const x = a.x + NW / 2; const goingDown = b.y > a.y;
    const p1 = { x, y: goingDown ? a.y + nodeH + 3 : a.y - 6 }, p2 = { x, y: goingDown ? b.y - 6 : b.y + nodeH + 3 };
    return { d: fmt([p1, p2]), head: arrowHead(p2, p1) };
  };
  if (!cyc) {
    const rowGap = 30;
    for (let k = 0; k < N; k++) {
      const r = Math.floor(k / cols); let c = k % cols; if (r % 2) c = cols - 1 - c;
      nodes.push({ x: PAD + c * (NW + gap), y: trackTop + r * (nodeH + rowGap) });
    }
    for (let k = 0; k + 1 < N; k++) links.push({ ...(Math.abs(nodes[k].y - nodes[k + 1].y) < 1 ? across(nodes[k], nodes[k + 1]) : down(nodes[k], nodes[k + 1])), a: k, b: k + 1 });
    const endH = hasEnd ? artH + 40 + 13 * wrap(cfg.track!.end!.label, NW - 4, 6.1).length : nodeH;
    H = Math.max(...nodes.map((p, k) => p.y + (hasEnd && k === N - 1 ? Math.max(endH, 30) : nodeH))) + PAD;
  } else if (narrowCycle) {
    // narrow cycle: a two-column loop (down the right, up the left) so stations never overlap
    const right = Math.ceil(n / 2), rowGap = 34;
    const colX = [PAD, W - PAD - NW];
    const top = trackTop + 26;
    cycle = { cx: W / 2, cy: trackTop + 6, rx: 0, ry: 0 };
    for (let s = 0; s < n; s++) {
      const onRight = s < right; const r = onRight ? s : n - 1 - s;
      nodes.push({ x: colX[onRight ? 1 : 0], y: top + r * (nodeH + rowGap) });
    }
    for (let s = 0; s < n; s++) {
      const a = nodes[s], b = nodes[(s + 1) % n];
      links.push({ ...(Math.abs(a.x - b.x) < 1 ? down(a, b) : across(a, b)), a: s, b: (s + 1) % n });
    }
    H = top + right * nodeH + (right - 1) * rowGap + PAD;
  } else {
    // stations sit centred on an ellipse; the centre keeps room for the driver label
    const rx = Math.min((W - 2 * PAD - NW) / 2, 200);
    const ry = Math.max(rx * 0.66, nodeH / 2 + 58);
    const cy = trackTop + ry + nodeH / 2;
    cycle = { cx: W / 2, cy, rx, ry };
    const angles = m.items.map((_, s) => -Math.PI / 2 + (s * 2 * Math.PI) / n);
    for (const a of angles) { const p = ellipsePt(cycle, a); nodes.push({ x: p.x - NW / 2, y: p.y - nodeH / 2 }); }
    const boxes: Box[] = nodes.map(p => ({ x: p.x, y: p.y, w: NW, h: nodeH }));
    for (let s = 0; s < n; s++) {
      const pts: Pt[] = [];
      for (let i = 0; i <= 80; i++) {
        const p = ellipsePt(cycle, angles[s] + ((2 * Math.PI) / n) * (i / 80));
        if (!boxes.some(b => inside(p, b, 6))) pts.push(p); else if (pts.length) break;
      }
      if (pts.length < 4) continue;
      const k = Math.max(1, Math.floor(pts.length / 14));
      const kept = pts.filter((_, i) => i % k === 0 || i === pts.length - 1);
      links.push({ d: fmt(kept), head: arrowHead(kept[kept.length - 1], kept[kept.length - 2]), a: s, b: (s + 1) % n });
    }
    H = cy + ry + nodeH / 2 + PAD;
  }
  return { kind: "sequence", W, H, tray, nodes, NW, nodeH, artW, artH, TA, cellW, nameLines, capLines, nameH, slotNode: s => s + +hasStart, hasStart, hasEnd, cycle, links };
}

function binsGeom(m: Model, W: number, roundIds: string[]): BinsGeom {
  const k = m.zones.length; const gap = 12;
  const cwWide = (W - 2 * PAD - (k - 1) * gap) / k;
  const wide = cwWide >= 150;
  const cw = wide ? cwWide : W - 2 * PAD;
  const AW = 40; const art = m.hasArt;
  const lines = Object.fromEntries(m.items.map(i => [i.id, wrap(i.label, cw - 12 - Q_SPACE - (art ? AW + 8 : 0))]));
  const hOf = (id: string) => Math.max(art ? AW * 0.8 + 6 : 0, textH(lines[id]?.length ?? 1));
  const hints = Object.fromEntries(m.zones.map(z => [z.id, z.hint ? wrap(z.hint, cw - 8, 5.9) : []]));
  const headH = 24 + Math.max(0, ...Object.values(hints).map(h => h.length)) * 13 + 6;
  const tray = makeTray(roundIds, wide ? k : 1, cw, hOf, 8);
  const maxChip = Math.max(...m.items.map(i => hOf(i.id)));
  return { kind: "bins", W, wide, cw, tray, lines, hOf, headH, hints, zonesTop: roundIds.length ? tray.top + tray.h + 26 : PAD + 4, minZoneH: wide ? maxChip + 22 : 42, maxChip };
}

/** Push numbered markers apart so close spots stay legible and tappable, inside the diagram box. */
function relax(pts: Pt[], min: number, box: Box): Pt[] {
  const p = pts.map(q => ({ ...q }));
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
      let dx = p[j].x - p[i].x, dy = p[j].y - p[i].y; let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.01) { dx = 1; dy = 0.3; d = 1.04; }
      const push = (min - d) / 2 + 0.2; const ux = dx / d, uy = dy / d;
      p[i].x -= ux * push; p[i].y -= uy * push; p[j].x += ux * push; p[j].y += uy * push; moved = true;
    }
    for (const q of p) { q.x = Math.max(box.x, Math.min(box.x + box.w, q.x)); q.y = Math.max(box.y, Math.min(box.y + box.h, q.y)); }
    if (!moved) break;
  }
  return p;
}

function labelGeom(m: Model, W: number, roundIds: string[]): LabelGeom {
  const { width: dw, height: dh } = m.diagram!;
  const wide = W >= 540; const gap = 18;
  // narrow: the diagram takes the full width and the slots sit in two numbered columns below it
  const gw = wide ? 138 : (W - 2 * PAD - 12) / 2;
  const lines = Object.fromEntries(m.items.map(i => [i.id, wrap(i.label, gw - 46)]));
  const ch = textH(Math.max(...Object.values(lines).map(l => l.length)));
  const tcols = Math.max(1, Math.floor((W - 2 * PAD + 12) / (gw + 12)));
  const tray = makeTray(roundIds, tcols, gw, () => ch, 8);
  const area = wide ? W - 2 * PAD - 2 * gw - 2 * gap : W - 12; // narrow: the diagram runs nearly edge to edge
  const s = Math.min(area / dw, (wide ? 360 : 300) / dh);
  const dx = (wide ? PAD + gw + gap : 6) + (area - dw * s) / 2;
  const dy = roundIds.length ? tray.top + tray.h + 30 : PAD + 10;
  const mr = wide ? 9.5 : 9;
  const anchors: LabelGeom["anchors"] = {}; const slots: LabelGeom["slots"] = {}; const leaders: LabelGeom["leaders"] = {};
  const want: Pt[] = m.zones.map(z => {
    const a = { x: dx + z.at![0] * s, y: dy + z.at![1] * s }; anchors[z.id] = a;
    return z.pin ? { x: dx + z.pin[0] * s, y: dy + z.pin[1] * s } : a;
  });
  const relaxed = relax(want, 2 * mr + 3, { x: dx - 4, y: dy - 4, w: dw * s + 8, h: dh * s + 8 });
  const markers = Object.fromEntries(m.zones.map((z, i) => [z.id, relaxed[i]]));
  let bottom = dy + dh * s;
  if (wide) {
    const sides: Record<"left" | "right", { id: string; want: number }[]> = { left: [], right: [] };
    for (const z of m.zones) sides[markers[z.id].x < dx + dw * s / 2 ? "left" : "right"].push({ id: z.id, want: markers[z.id].y - ch / 2 });
    for (const sd of ["left", "right"] as const) {
      const list = sides[sd].sort((a, b) => a.want - b.want);
      let y = -Infinity;
      for (const it of list) {
        y = Math.max(it.want, y + ch + 8, dy - 6);
        const sl = { x: sd === "left" ? PAD : W - PAD - gw, y, side: sd }; slots[it.id] = sl;
        const ex = sd === "left" ? sl.x + gw : sl.x, ey = y + ch - 2, mk = markers[it.id];
        const elbow = sd === "left" ? ex + 8 : ex - 8;
        leaders[it.id] = fmt([{ x: ex, y: ey }, { x: elbow, y: ey }, { x: mk.x + (sd === "left" ? -mr : mr) * 0.7, y: mk.y + (ey > mk.y ? mr : -mr) * 0.7 }]);
      }
      if (list.length) bottom = Math.max(bottom, y + ch);
    }
  } else {
    const top = dy + dh * s + 22;
    const half = Math.ceil(m.zones.length / 2);
    m.zones.forEach((z, i) => {
      const col = i < half ? 0 : 1, r = i < half ? i : i - half;
      const y = top + r * (ch + 8);
      slots[z.id] = { x: PAD + col * (gw + 12), y, side: col ? "right" : "left" };
      leaders[z.id] = "M0 0 L0 0";
      bottom = Math.max(bottom, y + ch);
    });
  }
  return { kind: "label", W, H: bottom + PAD + 4, tray, gw, ch, lines, wide, dx, dy, s, slots, anchors, markers, leaders, mr };
}

function geometry(m: Model, W: number, roundIds: string[]): Geom {
  return m.layout === "sequence" ? seqGeom(m, W, roundIds) : m.layout === "bins" ? binsGeom(m, W, roundIds) : labelGeom(m, W, roundIds);
}

/** Bins: positions depend on the board (columns grow, narrow bands push each other down). */
function binsLayout(m: Model, g: BinsGeom, b: Board) {
  const zones: Record<string, Box> = {};
  const pos: Record<string, Pt> = {};
  const stack = (z: string, x: number, y: number) => {
    let yy = y; for (const id of b.z[z]) { pos[id] = { x, y: yy }; yy += g.hOf(id) + 8; }
    return yy - y;
  };
  if (g.wide) {
    const contents = m.zones.map((z, i) => stack(z.id, PAD + i * (g.cw + 12), g.zonesTop + g.headH));
    const h = g.headH + Math.max(g.minZoneH, Math.max(...contents) + g.maxChip + 16);
    m.zones.forEach((z, i) => { zones[z.id] = { x: PAD + i * (g.cw + 12), y: g.zonesTop, w: g.cw, h }; });
    return { zones, pos, H: g.zonesTop + h + PAD };
  }
  let y = g.zonesTop;
  m.zones.forEach((z, i) => {
    const c = stack(z.id, PAD, y + g.headH);
    const last = i === m.zones.length - 1;
    const h = g.headH + Math.max(g.minZoneH, c + 6) + (last ? g.maxChip + 8 : 0);
    zones[z.id] = { x: PAD, y, w: g.cw, h }; y += h + 12;
  });
  return { zones, pos, H: y - 12 + PAD };
}

/* ---------- Drawing helpers ---------- */

function drawShapes(shapes: SortShape[] | undefined): ReactElement[] {
  return (shapes ?? []).map(s => {
    const cls = `sb-f-${s.fill ?? (s.kind === "text" ? "ink" : "none")} sb-s-${s.stroke ?? "none"}${s.dash ? " sb-dash" : ""}`;
    const common = { className: cls, strokeWidth: s.width ?? 1.6, opacity: s.opacity ?? 1 };
    switch (s.kind) {
      case "circle": return <circle cx={s.cx} cy={s.cy} r={s.r} {...common} />;
      case "ellipse": return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
      case "rect": return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx ?? 0} {...common} />;
      case "path": return <path d={s.d} strokeLinecap="round" strokeLinejoin="round" {...common} />;
      case "text": return <text transform={translate(s.x, s.y)} fontSize={s.size ?? 10} fontWeight={s.weight ?? 500} textAnchor={s.anchor ?? "middle"} className={cls} opacity={s.opacity ?? 1}>{s.text}</text>;
    }
  });
}

function useReducedMotion() {
  const [r, setR] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(prefers-reduced-motion: reduce)"); const on = () => setR(q.matches);
    q.addEventListener("change", on); return () => q.removeEventListener("change", on);
  }, []);
  return r;
}

declare global { interface Window { keatingSortBoard?: { snapshot: () => unknown } } }

/* ---------- Component ---------- */

export function SortBoard({ config, onChange, onShare }: { config: SortBoardConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const errors = useMemo(() => validateSortBoard(config), [config]);
  if (errors.length) return <section className="activity sortboard sb-fallback" data-sortboard="invalid">
    <p className="sb-fallback-text">This sorting activity couldn’t be drawn, so let’s do it in words: ask me to list the items and answer in your own words.</p>
    <details className="receipt"><summary>What was wrong with the activity</summary><div className="receipt-details"><p>{errors.slice(0, 4).join(" · ")}</p></div></details>
  </section>;
  return <SortBoardInner config={config} onChange={onChange} onShare={onShare} />;
}

function SortBoardInner({ config, onChange, onShare }: { config: SortBoardConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const m = useMemo(() => buildModel(config), [config]);
  const uid = useId().replace(/[^A-Za-z0-9]/g, "");
  const eid = (kind: string, id: string) => `sb${uid}-${kind}-${id}`;
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [board, setBoard] = useState<Board>(() => emptyBoard(m));
  const [undo, setUndo] = useState<Board[]>([]);
  const [home, setHome] = useState<string[]>(m.home);
  const [locked, setLocked] = useState<string[]>([]);
  const [result, setResult] = useState<Grade | null>(null);
  const [history, setHistory] = useState<Grade[]>([]);
  const [dragging, setDragging] = useState(false);
  // Bumping this remounts the renderer on the last committed board: an interrupted gesture (pointercancel)
  // or a width change mid-drag discards the live preview instead of dropping the hovered candidate.
  const [renderKey, setRenderKey] = useState(0);
  const draggingRef = useRef(false);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);

  useLayoutEffect(() => {
    const el = canvas.current; if (!el) return;
    const measure = () => {
      const w = Math.max(260, Math.floor(el.clientWidth));
      setW(prev => {
        if (prev !== w && draggingRef.current) { draggingRef.current = false; setDragging(false); setRenderKey(k => k + 1); }
        return w;
      });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const cancel = () => { draggingRef.current = false; setDragging(false); setRenderKey(k => k + 1); setStatus("Drag interrupted; nothing moved."); };
    document.addEventListener("pointercancel", cancel);
    return () => document.removeEventListener("pointercancel", cancel);
  }, [dragging]);

  const lockedSet = useMemo(() => new Set(locked), [locked]);
  const checked = !!result;
  const roundIds = useMemo(() => checked ? [] : home.filter(id => !lockedSet.has(id)), [checked, home, lockedSet]);
  const g = useMemo(() => geometry(m, W, roundIds), [m, W, roundIds]);
  const n = m.items.length;
  const placed = n - board.z[TRAY].length;
  const round = history.length + (checked ? 0 : 1);
  const hide = !!config.hideLabels && !checked;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.keatingSortBoard = { snapshot: () => ({ board, locked, result, history, round, W }) };
  }, [board, locked, result, history, round, W]);

  const where = (b: Board, id: string) => {
    const z = zoneOf(b, id);
    if (z === TRAY) return "back in the tray";
    if (m.layout === "sequence") return `at ${m.cycle ? "station" : "step"} ${b.z[TRACK].indexOf(id) + 1}`;
    return m.layout === "label" ? `on ${m.zoneById[z].label}` : `in ${m.zoneById[z].label}`;
  };
  const itemName = (id: string) => hide ? `drawing ${m.home.indexOf(id) + 1}` : m.byId[id].label;
  const commit = (next: Board, moved?: string) => {
    // keep the live unsure marks (Dragology hands back the board as it was when the drag began)
    const clean = { ...next, hot: null, u: board.u.filter(id => zoneOf(next, id) !== TRAY) };
    setUndo(u => [...u.slice(-30), board]);
    setBoard(clean);
    setShared(false);
    if (moved) setStatus(`${itemName(moved)} ${where(clean, moved)}. ${n - clean.z[TRAY].length} of ${n} placed.`);
    onChange?.();
  };
  const toggleUnsure = (id: string) => {
    if (checked || lockedSet.has(id) || zoneOf(board, id) === TRAY) return;
    const on = !board.u.includes(id);
    setUndo(u => [...u.slice(-30), board]);
    setBoard(b => ({ ...b, u: on ? [...b.u, id] : b.u.filter(x => x !== id) }));
    setStatus(`${itemName(id)} ${on ? "marked unsure" : "no longer marked unsure"}.`);
    setShared(false);
    onChange?.();
  };
  const moveTo = (id: string, zone: string, at = 0) => {
    if (checked || lockedSet.has(id)) return;
    const c = candidates(m, board, id, lockedSet);
    const target = zone === TRAY ? c[0] : m.layout === "label"
      ? c.find(b => b.z[zone]?.[0] === id)
      : insert(without(board, id), zone, id, at);
    if (target) commit(target, id);
  };
  const doUndo = () => {
    const prev = undo[undo.length - 1]; if (!prev || checked) return;
    setUndo(u => u.slice(0, -1)); setBoard(prev); setShared(false);
    setStatus(`Undone. ${n - prev.z[TRAY].length} of ${n} placed.`); onChange?.();
  };
  const check = () => {
    if (board.z[TRAY].length) return;
    const gr = grade(m, board, lockedSet);
    setResult(gr); setHistory(h => [...h, gr]); setUndo([]); setShared(false);
    const right = Object.values(gr).filter(r => r.outcome === "right" || r.outcome === "lucky").length;
    const doubts = Object.values(gr).filter(r => r.outcome === "lucky").length;
    setStatus(`${right} of ${n} right${doubts ? `, ${doubts} of them marked unsure` : ""}.${right < n ? " Each miss is explained below." : ""}`);
    onChange?.();
  };
  const retry = () => {
    if (!result) return;
    const again = m.items.filter(i => isMiss(result[i.id])).map(i => i.id);
    const keep = m.items.filter(i => !isMiss(result[i.id])).map(i => i.id);
    let b = board; for (const id of again) b = insert(without(b, id), TRAY, id, 99, null);
    setBoard({ ...b, u: [], hot: null }); setUndo([]);
    setLocked(keep);
    setHome([...shuffled(again, `retry${history.length}`, x => x), ...keep]);
    setResult(null); setShared(false);
    setStatus(`${again.length} back in the tray. The ones you got right stay put.`);
    onChange?.();
  };
  const restart = () => {
    setBoard(emptyBoard(m)); setUndo([]); setLocked([]); setResult(null); setHistory([]); setHome(m.home); setShared(false);
    setStatus("Board cleared."); onChange?.();
  };
  // Dragology swaps a draggable's DOM node on press, so a click never completes; the "?" toggle
  // listens for a press + release without travel instead, through a ref so it sees the latest board.
  const press = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ toggleUnsure });
  live.current = { toggleUnsure };
  const share = () => {
    const s = summarise(m, { board, history, result, locked: lockedSet });
    setShared(true); setStatus("Shared with Keating."); onShare?.(s);
  };

  /* ----- Dragology render function ----- */
  const draggable: Draggable<Board> = ({ state, d, draggedId }) => {
    const specFor = (id: string): DragSpec<Board> => {
      const cands = candidates(m, state, id, lockedSet);
      const specs: DragSpec<Board>[] = cands.map(c => d.fixed(c));
      if (m.layout === "label") for (const c of cands.slice(1)) {
        const zone = m.zones.find(z => c.z[z.id][0] === id)!;
        specs.push(d.dropTarget(eid("hit", zone.id), c));
      }
      const s = d.closest(specs).withFloating({ ghost: { opacity: 0.3 } });
      return reduced ? s.withDropTransition(false) : s.withDropTransition(170);
    };
    const pos: Record<string, ItemPos> = {};
    const layers: ReactElement[] = [];
    const tp = flowTray(g.tray, home.filter(id => state.z[TRAY].includes(id)));

    if (g.kind === "sequence") {
      const track = state.z[TRACK];
      const art = m.hasArt;
      const filled = (k: number) => (g.hasStart && k === 0) || (g.hasEnd && k === g.nodes.length - 1) || !!track[k - +g.hasStart];
      g.links.forEach((l, i) => {
        const lit = m.cycle ? !!track[l.a] && !!track[l.b] : filled(l.a) && filled(l.b);
        layers.push(<g id={eid("link", String(i))} className="sb-link">
          <path d={l.d} className="sb-link-base" />
          <path d={l.d} className="sb-link-lit" opacity={lit ? 1 : 0} />
          <path d={l.head} className="sb-link-head" opacity={lit ? 1 : 0.5} />
        </g>);
      });
      const cfg = m.cfg as Extract<SortBoardConfig, { layout: "sequence" }>;
      const endNode = (k: number, end: TrackEnd, tag: string) => {
        const p = g.nodes[k];
        const lines = wrap(end.label, g.NW - 4, 6.1);
        const aw = art ? g.artW : 0, ah = aw * 0.8;
        layers.push(<g id={eid("end", tag)} transform={translate(p.x, p.y)} className="sb-endnode">
          <g transform={translate((g.NW - aw) / 2, 0) + scale(Math.max(aw, 1) / 100)} opacity={art ? 1 : 0}>{drawShapes(resolveArt(end.art))}</g>
          <text className="sb-end-tag" transform={translate(g.NW / 2, ah + (art ? 16 : 10))} textAnchor="middle">{tag === "start" ? "Before" : "After"}</text>
          <text className="sb-end-label" transform={translate(g.NW / 2, ah + (art ? 31 : 25))} textAnchor="middle">
            {lines.map((l, i) => <tspan x={0} dy={i ? 13 : 0}>{l}</tspan>)}
          </text>
        </g>);
      };
      if (g.hasStart && cfg.track?.start) endNode(0, cfg.track.start, "start");
      if (g.hasEnd && cfg.track?.end) endNode(g.nodes.length - 1, cfg.track.end, "end");
      if (g.cycle && cfg.track?.center) {
        const c = cfg.track.center;
        if (g.cycle.rx === 0) {
          layers.push(<g id={eid("center", "x")} transform={translate(g.cycle.cx, g.cycle.cy)} className="sb-endnode">
            <g transform={translate(-60, -10) + scale(0.3)}>{drawShapes(resolveArt(c.art))}</g>
            <text className="sb-end-label" transform={translate(-26, 8)}>{c.label}</text>
          </g>);
        } else {
          const lines = wrap(c.label, Math.min(150, Math.max(70, g.cycle.rx * 1.2 - g.NW / 2)), 6);
          const aw = Math.min(64, g.cycle.rx * 0.6);
          layers.push(<g id={eid("center", "x")} transform={translate(g.cycle.cx, g.cycle.cy)} className="sb-endnode">
            <g transform={translate(-aw / 2, -aw * 0.8 / 2 - 14) + scale(aw / 100)}>{drawShapes(resolveArt(c.art))}</g>
            <text className="sb-end-label" transform={translate(0, aw * 0.4 + 2)} textAnchor="middle">{lines.map((l, i) => <tspan x={0} dy={i ? 13 : 0}>{l}</tspan>)}</text>
          </g>);
        }
      }
      // empty stops: one dashed outline where the drawing goes (or one dashed baseline for text steps)
      m.items.forEach((_, s) => {
        const p = g.nodes[g.slotNode(s)];
        const empty = !track[s];
        const num = m.cycle ? "" : String(s + 1);
        layers.push(<g id={eid("slot", String(s))} data-sb-slot={s} transform={translate(p.x, p.y)} opacity={empty ? 1 : 0} className="sb-slot">
          {art
            ? <rect x={(g.NW - g.artW) / 2} y={0} width={g.artW} height={g.artH} rx={12} className="sb-slot-mark" />
            : <path d={`M0 ${g.nameH - 1} L${g.NW} ${g.nameH - 1}`} className="sb-slot-mark" />}
          <text transform={translate(art ? g.NW / 2 : 6, art ? g.artH / 2 + 5 : g.nameH - 7)} textAnchor={art ? "middle" : "start"} className="sb-slot-num">{num}</text>
        </g>);
      });
      for (const it of m.items) {
        const s = track.indexOf(it.id);
        const lines = g.nameLines[it.id]; const capLines = g.capLines[it.id];
        if (art) {
          const onTrack = s >= 0;
          const aw = onTrack ? g.artW : g.TA;
          const p = onTrack ? g.nodes[g.slotNode(s)] : tp[it.id];
          const ox = onTrack ? p.x + (g.NW - aw) / 2 : p.x + (g.cellW - aw) / 2;
          const ah = aw * 0.8;
          pos[it.id] = { x: ox, y: p.y, w: aw, h: ah + 6 + lines.length * 14, placed: onTrack,
            artX: 0, artY: 0, aw, nameX: aw / 2, nameY: ah + 16, lines, nameO: hide ? 0 : 1,
            capX: aw / 2, capY: ah + 6 + g.nameH + 10, capLines, capO: onTrack && !hide ? 1 : 0,
            ruleO: 0, qX: aw - 3, qY: 5, markX: 3, markY: 5 };
        } else {
          const p = s >= 0 ? g.nodes[g.slotNode(s)] : tp[it.id];
          pos[it.id] = { x: p.x, y: p.y, w: g.NW, h: g.nameH, placed: s >= 0,
            artX: 0, artY: 0, aw: 0, nameX: 10, nameY: 17, lines, nameO: 1,
            capX: g.NW / 2, capY: g.nameH + 15, capLines, capO: s >= 0 ? 1 : 0,
            ruleO: 1, qX: g.NW - 12, qY: g.nameH / 2, markX: -1, markY: 0 };
        }
      }
    } else if (g.kind === "bins") {
      const lay = binsLayout(m, g, state);
      m.zones.forEach((z, i) => {
        const r = lay.zones[z.id];
        layers.push(<g id={eid("zone", z.id)} transform={translate(r.x, r.y)} data-sb-zone={z.id} data-hot={state.hot === z.id ? "1" : "0"} className="sb-zone" dragologyZIndex={-1}>
          <rect x={-6} y={-6} width={r.w + 12} height={r.h + 6} rx={10} className="sb-zone-bg" />
          <text className="sb-zone-label" transform={translate(0, 14)}>{z.label}</text>
          <text className="sb-zone-hint" transform={translate(0, 31)}>{g.hints[z.id].map((l, j) => <tspan x={0} dy={j ? 13 : 0}>{l}</tspan>)}</text>
          <path d={g.wide ? `M-6 0 L-6 ${r.h - 6}` : `M0 -6 L${r.w} -6`} className="sb-zone-rule" opacity={g.wide ? (i ? 1 : 0) : (i ? 1 : 0)} />
          <text className="sb-zone-empty" transform={translate(r.w / 2, g.headH + 22)} textAnchor="middle" opacity={state.z[z.id].length ? 0 : 1}>Drop here</text>
        </g>);
      });
      const AW = m.hasArt ? 40 : 0;
      for (const it of m.items) {
        const lines = g.lines[it.id]; const h = g.hOf(it.id);
        const inTray = zoneOf(state, it.id) === TRAY;
        const p = inTray ? tp[it.id] : lay.pos[it.id];
        pos[it.id] = { x: p.x, y: p.y, w: g.cw, h, placed: !inTray,
          artX: 0, artY: (h - AW * 0.8) / 2, aw: AW, nameX: AW ? AW + 8 : 10, nameY: Math.max(17, h / 2 - (lines.length - 1) * LINE / 2 + 4), lines, nameO: hide ? 0 : 1,
          capX: 0, capY: 0, capLines: [], capO: 0, ruleO: AW ? 0 : 1, qX: g.cw - 12, qY: h / 2, markX: AW ? 2 : -1, markY: AW ? 4 : 0 };
      }
    } else {
      const zoneShapes = m.diagram!.shapes;
      layers.push(<g id={eid("diagram", "x")} transform={translate(g.dx, g.dy) + scale(g.s)} className="sb-diagram" dragologyZIndex={-2}>{drawShapes(zoneShapes)}</g>);
      const textW = g.gw - 18;
      for (const z of m.zones) {
        const a = g.anchors[z.id], mk = g.markers[z.id], sl = g.slots[z.id];
        const occ = state.z[z.id][0];
        const pinned = Math.hypot(mk.x - a.x, mk.y - a.y) > 3;
        layers.push(<g id={eid("lead", z.id)} className="sb-lead" dragologyZIndex={-1}>
          <path d={g.leaders[z.id]} className="sb-lead-empty" opacity={g.wide && !occ ? 1 : 0} />
          <path d={g.leaders[z.id]} className="sb-lead-full" opacity={g.wide && occ ? 1 : 0} />
          <path d={fmt([a, mk])} className="sb-pin" opacity={pinned ? 1 : 0} />
          <circle transform={translate(a.x, a.y)} r={2.2} className="sb-pin-dot" opacity={pinned ? 1 : 0} />
        </g>);
        layers.push(<g id={eid("slotline", z.id)} transform={translate(sl.x, sl.y)} className="sb-slot" data-sb-slot={z.id}>
          <path d={`M0 ${g.ch - 1} L${g.gw} ${g.ch - 1}`} className="sb-slot-mark" opacity={occ ? 0 : 1} />
          <text transform={translate(4, g.ch / 2 + 4)} className="sb-slot-num">{z.num}</text>
        </g>);
        layers.push(<g id={eid("spot", z.id)} transform={translate(mk.x, mk.y)} className="sb-spot" data-sb-spot={z.id} data-filled={occ ? "1" : "0"}>
          <circle r={g.mr} className="sb-spot-ring" />
          <circle r={g.mr} className="sb-spot-fill" opacity={occ ? 1 : 0} />
          <text transform={translate(0, 3.6)} textAnchor="middle" className="sb-spot-num">{z.num}</text>
        </g>);
        layers.push(<circle id={eid("hit", z.id)} transform={translate(mk.x, mk.y)} r={g.mr + 9} className="sb-hit" />);
      }
      for (const it of m.items) {
        const z = zoneOf(state, it.id);
        const p = z === TRAY ? tp[it.id] : { x: g.slots[z].x + 18, y: g.slots[z].y };
        pos[it.id] = { x: p.x, y: p.y, w: textW, h: g.ch, placed: z !== TRAY,
          artX: 0, artY: 0, aw: 0, nameX: 10, nameY: 17, lines: g.lines[it.id], nameO: 1,
          capX: 0, capY: 0, capLines: [], capO: 0, ruleO: 1, qX: textW - 12, qY: g.ch / 2, markX: -1, markY: 0 };
      }
    }

    const trayEmpty = state.z[TRAY].length === 0;
    const trayWord = m.layout === "sequence" ? (m.hasArt ? "Drawings to place" : "Steps to place") : m.layout === "bins" ? "Examples to sort" : "Labels to place";
    if (g.tray.h > 0) layers.unshift(<g id={eid("tray", "x")} data-hot={state.hot === TRAY ? "1" : "0"} className="sb-tray" dragologyZIndex={-1}>
      <rect x={g.tray.x0 - 8} y={g.tray.top - 24} width={g.W - 2 * g.tray.x0 + 16} height={g.tray.h + 32} rx={10} className="sb-tray-bg" />
      <text className="sb-tray-label" transform={translate(g.tray.x0, g.tray.top - 7)} opacity={trayEmpty ? 0 : 1}>{trayWord}</text>
      <text className="sb-tray-done" transform={translate(g.W / 2, g.tray.top + Math.min(g.tray.h, 40) / 2 + 4)} textAnchor="middle" opacity={trayEmpty ? 1 : 0}>
        All placed. Tap ? on any you’re unsure of, then check.
      </text>
    </g>);

    const unsure = new Set(state.u);
    const items = m.items.map(it => {
      const p = pos[it.id]; const id = eid("item", it.id);
      const res = result?.[it.id]; const isLocked = lockedSet.has(it.id);
      const canDrag = !checked && !isLocked;
      const showQ = p.placed && canDrag;
      const nameAnchor = m.layout === "sequence" && m.hasArt ? "middle" : "start";
      return <g id={id} transform={translate(p.x, p.y)} data-sb-item={it.id} data-placed={p.placed ? "1" : "0"}
        data-unsure={unsure.has(it.id) ? "1" : "0"} data-res={res?.outcome ?? "none"} data-locked={isLocked ? "1" : "0"} data-lifted={draggedId === id ? "1" : "0"}
        className="sb-item" dragologyZIndex={draggedId === id ? "/1" : 1}
        dragologyOnDrag={canDrag ? () => specFor(it.id) : undefined}>
        <rect width={p.w} height={p.h} className="sb-hit" />
        <rect x={p.artX - 4} y={p.artY - 4} width={p.aw + 8} height={p.aw * 0.8 + 8} rx={10} className="sb-art-ring" opacity={p.aw ? 1 : 0} />
        <g transform={translate(p.artX, p.artY) + scale(Math.max(p.aw, 1) / 100)} opacity={p.aw ? 1 : 0} className="sb-art">{drawShapes(it.art)}</g>
        <path d={`M0 3 L0 ${p.h - 3}`} className="sb-rule" opacity={p.ruleO} />
        <text className="sb-name" transform={translate(p.nameX, p.nameY)} textAnchor={nameAnchor} opacity={p.nameO}>{p.lines.map((l, i) => <tspan x={0} dy={i ? 14 : 0}>{l}</tspan>)}</text>
        <text className="sb-cap" transform={translate(p.capX, p.capY)} textAnchor="middle" opacity={p.capO}>{p.capLines.map((l, i) => <tspan x={0} dy={i ? 13 : 0}>{l}</tspan>)}</text>
        <g transform={translate(p.qX, p.qY)} className="sb-q" opacity={showQ ? 1 : 0} pointerEvents={showQ ? "auto" : "none"}
          data-sb-unsure={it.id}
          onPointerDown={e => { press.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={e => {
            const start = press.current; press.current = null;
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 5) live.current.toggleUnsure(it.id);
          }}>
          <circle r={13} className="sb-q-hit" />
          <circle r={8.5} className="sb-q-ring" />
          <text transform={translate(0, 4)} textAnchor="middle" className="sb-q-text">?</text>
        </g>
        <g transform={translate(p.markX, p.markY)} className="sb-mark" opacity={res ? 1 : 0}>
          <circle r={8} className="sb-mark-dot" />
          <text transform={translate(0, 3.8)} textAnchor="middle" className="sb-mark-text">{res && (res.outcome === "right" || res.outcome === "lucky" ? "✓" : "!")}</text>
        </g>
      </g>;
    });
    return <g>{layers}{items}</g>;
  };

  const H = g.kind === "bins" ? binsLayout(m, g, board).H : g.H;

  /* ----- feedback ----- */
  const misses = result ? m.items.filter(i => isMiss(result[i.id])) : [];
  const right = result ? n - m.items.filter(i => isWrong(result[i.id])).length : 0;
  const hint = checked ? (misses.length ? "Read why below, then retry just those." : "All right. Share it with Keating, or start over.")
    : locked.length ? `Try ${round}: place the ${n - locked.length} that went back. The rest are locked in.`
    : m.layout === "sequence" ? (m.hasArt ? `Drag each drawing onto the ${m.cycle ? "loop" : "track"} in order; the others make room.` : `Drag each step onto the ${m.cycle ? "loop" : "track"} in order; the others make room.`)
    : m.layout === "bins" ? "Drag each example into the group it belongs to."
    : "Drag each name onto its numbered spot on the diagram.";
  const canShare = (placed > 0 || history.length > 0) && !shared;

  return <section className="activity sortboard" data-sortboard={m.layout} data-checked={checked ? "1" : "0"}>
    <div className="sb-head">
      <h3>{config.title}</h3>
      <span className="sb-count">{checked ? `${right} of ${n} right` : `${placed} of ${n} placed`}{round > 1 ? ` · try ${round}` : ""}</span>
    </div>
    {config.instructions && <p className="sb-instructions">{config.instructions}</p>}
    <div className={`sb-canvas${dragging ? " is-dragging" : ""}`} ref={canvas} aria-hidden="true">
      <DraggableRenderer key={renderKey} draggable={draggable} state={board} width={W} height={H}
        onDropState={next => {
          const changed = m.items.filter(i => zoneOf(next, i.id) !== zoneOf(board, i.id) || next.z[zoneOf(next, i.id)].indexOf(i.id) !== board.z[zoneOf(board, i.id)].indexOf(i.id));
          // on a swap the displaced label lands in the tray; report the one the learner carried
          const moved = changed.find(i => zoneOf(next, i.id) !== TRAY && zoneOf(board, i.id) !== zoneOf(next, i.id)) ?? changed[0];
          if (moved) commit(next, moved.id); // a press without travel also "drops"; ignore it
        }}
        onDragStatus={s => { draggingRef.current = s.type === "dragging"; setDragging(draggingRef.current); }} />
    </div>
    <p className="sb-hint">{hint}</p>
    <div className="actions sb-actions">
      {!checked && <button type="button" className="primary" disabled={board.z[TRAY].length > 0} onClick={check}>
        {board.z[TRAY].length ? `Check · ${board.z[TRAY].length} to place` : "Check my answers"}</button>}
      {checked && misses.length > 0 && <button type="button" className="primary" onClick={retry}>
        {misses.length === 1 ? "Retry the one" : `Retry the ${misses.length}`} I {misses.every(i => result![i.id].outcome === "lucky") ? "wasn’t sure of" : misses.some(i => result![i.id].outcome === "lucky") ? "missed or wasn’t sure of" : "missed"}</button>}
      <button type="button" className={checked && !misses.length ? "primary" : "quiet"} onClick={share} disabled={!canShare}>Share with Keating</button>
      {!checked && <button type="button" className="quiet" onClick={doUndo} disabled={!undo.length}>Undo</button>}
      <button type="button" className="quiet" onClick={restart} disabled={placed === 0 && !history.length}>Start over</button>
    </div>
    {checked && misses.length > 0 && <ul className="sb-feedback" aria-label="Feedback on each miss">
      {misses.map(it => {
        const r = result![it.id];
        return <li key={it.id} data-res={r.outcome}>
          <strong>{it.label}</strong>{r.outcome === "lucky" ? <span className="sb-fb-tag"> · right, but unsure</span> : r.outcome === "doubt" ? <span className="sb-fb-tag"> · unsure, and missed</span> : null}
          <p>{feedbackFor(m, it, r)}</p>
        </li>;
      })}
    </ul>}
    <details className="receipt sb-keys">
      <summary>Use buttons instead</summary>
      <ul className="sb-key-rows">
        {m.items.map(it => {
          const z = zoneOf(board, it.id); const isLocked = lockedSet.has(it.id);
          const value = z === TRAY ? TRAY : m.layout === "sequence" ? `${TRACK}:${board.z[TRACK].indexOf(it.id)}` : z;
          const trackLen = board.z[TRACK]?.length ?? 0;
          const steps = m.layout === "sequence" ? Array.from({ length: z === TRAY ? trackLen + 1 : trackLen }, (_, i) => i) : [];
          const name = itemName(it.id);
          return <li key={it.id}>
            <span className="sb-key-label">{name}</span>
            <select aria-label={`Place ${name}`} value={value} disabled={checked || isLocked}
              onChange={e => {
                const v = e.currentTarget.value;
                if (v === TRAY) moveTo(it.id, TRAY);
                else if (v.startsWith(`${TRACK}:`)) moveTo(it.id, TRACK, Number(v.slice(TRACK.length + 1)));
                else moveTo(it.id, v);
              }}>
              <option value={TRAY}>Not placed</option>
              {m.layout === "sequence" ? steps.map(i => <option key={i} value={`${TRACK}:${i}`}>{m.cycle ? "Station" : "Step"} {i + 1}</option>)
                : m.zones.map(zz => <option key={zz.id} value={zz.id}>{m.layout === "label" ? `Spot ${zz.num}` : zz.label}</option>)}
            </select>
            <button type="button" className="quiet sb-key-unsure" aria-pressed={board.u.includes(it.id)} disabled={checked || isLocked || z === TRAY}
              onClick={() => toggleUnsure(it.id)}>Unsure</button>
          </li>;
        })}
      </ul>
    </details>
    <span className="sb-sr" role="status">{status}</span>
  </section>;
}

/* ---------- Share summary (scripted; derived from what the learner did) ---------- */

const lower1 = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
function summarise(m: Model, st: { board: Board; history: Grade[]; result: Grade | null; locked: Set<string> }): ShareSummary {
  const cfg = m.cfg; const n = m.items.length;
  const noun = cfg.noun ?? (m.layout === "sequence" ? "steps" : m.layout === "bins" ? "examples" : "labels");
  const short = (label: string) => {
    if (label.length <= 32) return label;
    const words = label.replace(/[.;:,]$/, "").split(/\s+/);
    return `“${words.slice(0, 6).join(" ").replace(/[.;:,]$/, "")}…”`;
  };
  const names = (ids: string[]) => {
    const ls = ids.map(id => short(m.byId[id].label));
    return ls.length <= 1 ? ls.join("") : `${ls.slice(0, -1).join(", ")} and ${ls[ls.length - 1]}`;
  };
  const verb = (ids: string[], one: string, many: string) => ids.length === 1 ? one : many;
  const placedWhere = (id: string, r: ItemResult) => {
    if (r.zone === TRAY) return "unplaced";
    if (m.layout === "sequence") return `after ${r.prev}`;
    return m.layout === "label" ? `on ${m.zoneById[r.zone].label}` : `in ${m.zoneById[r.zone].label}`;
  };
  const { board, history } = st;
  const placedIds = m.items.filter(i => zoneOf(board, i.id) !== TRAY).map(i => i.id);
  const unsureNow = board.u.filter(id => placedIds.includes(id));

  /* --- Shared before any check: report progress, using what they've placed so far --- */
  if (!history.length) {
    const gr = grade(m, board, st.locked, false);
    const off = placedIds.filter(id => isWrong(gr[id]));
    const ok = placedIds.length - off.length;
    const learner = placedIds.length === n
      ? `I’ve placed all ${n} ${noun} but haven’t checked yet${unsureNow.length ? `. I’m unsure about ${names(unsureNow)}` : ""}.`
      : `I’ve placed ${placedIds.length} of ${n} ${noun} so far${unsureNow.length ? `, and I’m unsure about ${names(unsureNow)}` : ""}.`;
    const data = [`SortBoard · ${cfg.title} · ${m.layout} · progress, not checked`, `placed ${placedIds.length}/${n}`,
      placedIds.length ? `placements: ${placedIds.map(id => `${m.byId[id].label} (${placedWhere(id, gr[id])})`).join("; ")}` : "",
      unsureNow.length ? `unsure: ${names(unsureNow)}` : "", `in order or in place so far: ${ok}/${placedIds.length}`].filter(Boolean).join(" · ");
    if (placedIds.length === 0) {
      const where = m.layout === "sequence" ? `the ${m.cycle ? "loop" : "track"}` : m.layout === "bins" ? "the columns" : "the diagram";
      return { learner: `I haven’t placed any ${noun} yet.`, data: data.replace(" · in order or in place so far: 0/0", ""),
        reply: `Nothing is on ${where} right now, so the board is unchanged from the start. Pick the one you’re surest of and drag it into place.` };
    }
    if (placedIds.length === 1) {
      // one move: name exactly what was moved and what its placement currently says, nothing about untouched items
      const it = m.byId[placedIds[0]]; const r = gr[it.id]; const rest = n - 1;
      let reply: string;
      if (m.layout === "sequence" && m.cycle) {
        reply = `You’ve put ${it.label} on the loop${it.effect ? ` (${lower1(it.effect.replace(/\.$/, ""))})` : ""}. On a loop one stage can’t be out of order by itself; what matters is what leads into it. Place the stage that has to come just before it next.`;
      } else if (m.layout === "sequence") {
        reply = `You’ve put ${it.label} first on the track, straight after ${r.prev}. As it stands, that says ${it.effect ? `“${lower1(it.effect.replace(/\.$/, ""))}”` : "this"} is the very next thing to happen. Is that true, or does something else have to happen first? Place the other ${rest} around it and check.`;
      } else {
        const z = m.zoneById[r.zone].label;
        reply = `You’ve put ${short(it.label)} ${m.layout === "label" ? "on" : "in"} ${z}. ${isWrong(r)
          ? `Have another look before you check: ${m.layout === "bins" ? `is it really ${z.toLowerCase()}?` : `does ${z} point at ${it.label}?`}`
          : `That one is where it belongs.`}${unsureNow.length ? " You marked it unsure; say what you’d need to know to decide." : ""} Place the other ${rest}, then check.`;
      }
      return { learner, data, reply };
    }
    let reply = off.length ? `${ok} of the ${placedIds.length} you’ve placed are where they belong. ` : `So far all ${placedIds.length} are where they belong. `;
    if (off.length) reply += `Have another look at ${names(off.slice(0, 2))} before you check: ${m.layout === "sequence" ? "what has to have happened just before it?" : "what is it really an example of?"} `;
    if (unsureNow.length) reply += `You marked ${names(unsureNow)} as unsure; say what you’d need to know to decide. `;
    reply += placedIds.length === n ? "When you’re ready, press Check and I’ll explain any that don’t fit." : `Place the other ${n - placedIds.length}, then check.`;
    return { learner, data, reply: reply.trim() };
  }

  /* --- After at least one check --- */
  const first = history[0]; const last = history[history.length - 1];
  const midRetry = !st.result;
  const wrongFirst = m.items.filter(i => isWrong(first[i.id])).map(i => i.id);
  const luckyFirst = m.items.filter(i => first[i.id]?.outcome === "lucky").map(i => i.id);
  const rightFirst = n - wrongFirst.length;
  const stillWrong = m.items.filter(i => isWrong(last[i.id])).map(i => i.id);
  // group first-try misses by the misconception each one reveals (the wrong place's key, else the item's)
  const groups = new Map<string, string[]>(); const loose: string[] = [];
  for (const id of wrongFirst) {
    const k = missKey(m.byId[id], first[id]);
    if (k && cfg.misconceptions?.[k]) groups.set(k, [...(groups.get(k) ?? []), id]); else loose.push(id);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length); // stable: ties keep item order

  let learner: string;
  if (!wrongFirst.length && !luckyFirst.length) learner = `I got all ${n} ${noun} right on the first try.`;
  else if (!wrongFirst.length) learner = `I got all ${n} right, but I wasn’t sure about ${names(luckyFirst)}.`;
  else {
    learner = `I got ${rightFirst} of ${n} on the first try and missed ${names(wrongFirst)}.`;
    if (history.length > 1) learner += stillWrong.length ? ` After ${history.length - 1 === 1 ? "a retry" : `${history.length - 1} retries`} I still have ${names(stillWrong)} wrong.` : ` I fixed ${wrongFirst.length === 1 ? "it" : "them"} on the retry.`;
    if (midRetry) learner += ` I’m partway through ${history.length > 1 ? "another" : "the"} retry.`;
  }

  const data = [
    `SortBoard · ${cfg.title} · ${m.layout}`,
    `try 1: ${rightFirst}/${n} right${luckyFirst.length ? ` (${luckyFirst.length} unsure: ${names(luckyFirst)})` : ""}`,
    wrongFirst.length ? `missed: ${wrongFirst.map(id => {
      const k = missKey(m.byId[id], first[id]); const mis = k ? cfg.misconceptions?.[k] : undefined;
      return `${m.byId[id].label.replace(/\.$/, "")} (${placedWhere(id, first[id])}${mis ? `; ${lower1(mis.name)}` : ""})`;
    }).join("; ")}` : "missed: none",
    history.length > 1 ? `latest try ${history.length}: ${n - stillWrong.length}/${n}` : "",
    midRetry ? `retry in progress: ${n - st.board.z[TRAY].length}/${n} placed` : "",
  ].filter(Boolean).join(" · ");

  let reply: string;
  if (!wrongFirst.length && !luckyFirst.length) reply = cfg.perfectReply ?? `All ${n} right first time. Next, try explaining one of them out loud: why does it go where you put it?`;
  else if (!wrongFirst.length) {
    const it = m.byId[luckyFirst[0]];
    reply = `Everything’s right, and it’s good you flagged ${names(luckyFirst)} as unsure, because a lucky guess doesn’t stick. Here’s the reason for ${it.label}: ${it.why} Could you say that back in your own words?`;
  } else {
    const parts: string[] = [];
    ordered.forEach(([k, ids], i) => {
      const mis = cfg.misconceptions![k];
      if (i === 0) parts.push(`${names(ids)} ${ids.length === 1 ? "suggests" : ids.length === 2 ? "both suggest" : "all suggest"} ${lower1(mis.name)}. ${mis.reply}`);
      else if (i === 1) parts.push(`${names(ids)} ${verb(ids, "is", "are")} a different slip: ${lower1(mis.name)}. ${mis.reply}`);
      else parts.push(`And ${names(ids)}: ${lower1(mis.name)}.`);
    });
    if (loose.length) parts.push(ordered.length ? `${names(loose)} ${verb(loose, "is", "are")} worth another look too: ${m.byId[loose[0]].why}` : `You missed ${names(loose)}. ${m.byId[loose[0]].why}`);
    const fixed = history.length > 1 && !stillWrong.length;
    parts.push(fixed ? `You fixed ${wrongFirst.length === 1 ? "it" : "them"} on the retry, which is the part that makes it stick. I’ll bring this back in a few minutes to check it held.`
      : stillWrong.length && history.length > 1 ? `${names(stillWrong)} ${verb(stillWrong, "is", "are")} still out of place, so let’s go through ${verb(stillWrong, "that one", "those")} together.`
      : midRetry ? "Finish placing the retry, then check again." : "Want to retry just those?");
    reply = parts.join(" ");
  }
  return { learner, data, reply };
}

/* ---------- Presets ---------- */

export const presets: Record<string, SortBoardConfig> = {
  mitosis: {
    layout: "sequence",
    title: "Put the stages of mitosis in order",
    instructions: "One cell becomes two. Mitosis runs continuously, and its stages blend into each other; each drawing shows one illustrated milestone. Drag them onto the track in the order the cell reaches them.",
    noun: "stages",
    track: {
      shape: "line",
      start: { label: "Interphase: DNA already copied", art: "cell.interphase" },
      end: { label: "Two identical daughter cells", art: "cell.daughters" },
    },
    steps: [
      { id: "prophase", label: "Prophase", art: "cell.prophase", effect: "Chromosomes condense; the nuclear envelope breaks down",
        why: "Chromosomes have to condense into compact X shapes before anything can move them. That is the first visible stage.", misconception: "condense" },
      { id: "metaphase", label: "Metaphase", art: "cell.metaphase", effect: "Chromosomes line up across the middle",
        why: "Spindle fibres attach to every chromosome and line them up on the cell’s equator. They line up before anything is pulled apart.", misconception: "separate" },
      { id: "anaphase", label: "Anaphase", art: "cell.anaphase", effect: "Sister chromatids are pulled to opposite poles",
        why: "Only once every chromosome is lined up do the sister chromatids split and get pulled to opposite ends. Splitting comes after lining up.", misconception: "separate" },
      { id: "telophase", label: "Telophase", art: "cell.telophase", effect: "Two new nuclei form at the poles",
        why: "With the chromatids at the poles, a nuclear envelope re-forms around each set. The cell may already be pinching in at the middle, but it is still one cell.", misconception: "split" },
      { id: "cytokinesis", label: "Cytokinesis complete", art: "cell.cytokinesis", effect: "The cytoplasm has pinched fully in two",
        why: "The pinching of the cytoplasm (cytokinesis) often begins during anaphase and overlaps telophase. This drawing shows it complete: two separate cells, each with its own nucleus. That milestone is reached last.", misconception: "split" },
    ],
    startOrder: ["anaphase", "cytokinesis", "prophase", "telophase", "metaphase"],
    misconceptions: {
      separate: { name: "Thinking chromosomes split apart before they line up", reply: "The cell lines every chromosome up on the equator first (metaphase) so that each new cell gets exactly one copy when they split (anaphase). Line up, then pull apart: M before A, like the alphabet." },
      split: { name: "Confusing two new nuclei with a completed split", reply: "Telophase is about nuclei: two new envelopes form around the separated chromosomes. Cytokinesis is about the cytoplasm pinching in, and it often starts during anaphase, so the two overlap in time. What comes last is the split being complete: two separate cells. Two nuclei in one cell, then two cells." },
      condense: { name: "Missing that chromosomes condense first", reply: "Nothing can be lined up or pulled until the long thin DNA strands coil into compact chromosomes. That condensing is prophase, the start of mitosis." },
    },
    perfectReply: "All five in order on the first try. Quick check that it’s understanding and not memory: why does the cell line the chromosomes up in metaphase before pulling them apart?",
  },
  mitosisSeen: {
    layout: "sequence",
    title: "Which cell comes next?",
    instructions: "No names this time: order the cells by what you see happening to the chromosomes. Each drawing is one milestone of a continuous process. Names appear when you check.",
    noun: "stages",
    hideLabels: true,
    track: { shape: "line", start: { label: "DNA copied", art: "cell.interphase" }, end: { label: "Two cells", art: "cell.daughters" } },
    steps: [
      { id: "prophase", label: "Prophase", art: "cell.prophase", effect: "Chromosomes condense", why: "The X shapes appear first: copied DNA coiling into chromosomes while the nucleus breaks down.", misconception: "condense" },
      { id: "metaphase", label: "Metaphase", art: "cell.metaphase", effect: "They line up in the middle", why: "The chromosomes sit in a single line across the middle with fibres from both poles.", misconception: "separate" },
      { id: "anaphase", label: "Anaphase", art: "cell.anaphase", effect: "Copies pulled apart", why: "The V shapes are single chromatids being dragged to opposite poles, which can only happen after they’ve lined up.", misconception: "separate" },
      { id: "telophase", label: "Telophase", art: "cell.telophase", effect: "Two nuclei, one cell", why: "Two nuclei have formed but the cell is still one pinched shape.", misconception: "split" },
      { id: "cytokinesis", label: "Cytokinesis complete", art: "cell.cytokinesis", effect: "Two separate cells", why: "The pinching may have begun back in anaphase, but here the membrane has closed right across the middle: the split is complete, and that comes last.", misconception: "split" },
    ],
    startOrder: ["telophase", "metaphase", "cytokinesis", "prophase", "anaphase"],
    misconceptions: {
      separate: { name: "Reading the V shapes as coming before the line", reply: "In the line-up (metaphase) each chromosome is still an X. The V shapes are those Xs pulled into halves, so the line comes first." },
      split: { name: "Confusing two nuclei with two cells", reply: "Two nuclei in one pinched cell is telophase. The pinching can start earlier, but only when the membrane closes across the middle (cytokinesis complete) are there two cells." },
      condense: { name: "Missing where the X shapes first appear", reply: "Before any lining up, the chromosomes have to become visible X shapes inside a fading nucleus. That’s the first drawing." },
    },
  },
  waterCycle: {
    layout: "sequence",
    title: "Close the water cycle",
    instructions: "Water goes round and round. Place each stage around the loop so it leads into the next.",
    noun: "stages",
    track: { shape: "cycle", center: { label: "The sun’s heat drives it", art: "sun" } },
    steps: [
      { id: "evaporation", label: "Evaporation", art: "water.evaporation", effect: "Liquid water warms into vapour",
        why: "Heat turns liquid water at the surface into invisible water vapour, which rises.", misconception: "vapour" },
      { id: "condensation", label: "Condensation", art: "water.condensation", effect: "Vapour cools into droplets: a cloud",
        why: "Rising vapour cools and condenses into tiny liquid droplets. A cloud is made of those droplets, not of vapour.", misconception: "vapour" },
      { id: "precipitation", label: "Precipitation", art: "water.precipitation", effect: "Droplets grow heavy and fall",
        why: "Droplets in the cloud merge until they’re too heavy to stay up, then fall as rain, snow or hail. They can only fall after they’ve condensed.", misconception: "order" },
      { id: "collection", label: "Collection", art: "water.collection", effect: "Water gathers in rivers and seas",
        why: "Fallen water runs off and collects in rivers, lakes, oceans and the ground, which is where evaporation starts again.", misconception: "order" },
    ],
    startOrder: ["precipitation", "evaporation", "collection", "condensation"],
    misconceptions: {
      vapour: { name: "Thinking clouds are made of water vapour", reply: "Vapour is invisible. You see a cloud only after the vapour cools and condenses into droplets. So evaporation makes vapour, condensation makes the cloud." },
      order: { name: "Mixing up what has to happen before rain", reply: "Rain is water that’s already been lifted and condensed, so precipitation can only follow condensation, and collection follows the rain." },
    },
  },
  scientificMethod: {
    layout: "sequence",
    title: "Put the scientific method in order",
    instructions: "Drag each step onto the track in the order a scientist works.",
    noun: "steps",
    steps: [
      { id: "observe", label: "Observe", art: "method.observe", effect: "Notice something puzzling", why: "Science starts with noticing: you need something to explain." },
      { id: "question", label: "Ask a question", art: "method.question", effect: "Narrow enough to test", why: "The observation becomes a question narrow enough to test." },
      { id: "hypothesis", label: "Hypothesis", art: "method.hypothesis", effect: "A testable explanation", why: "A hypothesis is a testable explanation that answers the question.", misconception: "hypothesisLate" },
      { id: "experiment", label: "Experiment", art: "method.experiment", effect: "Test it fairly", why: "The experiment checks the hypothesis under controlled conditions.", misconception: "hypothesisLate" },
      { id: "analyse", label: "Analyse", art: "method.analyse", effect: "What do the data show?", why: "Raw results need analysing before they say anything about the hypothesis.", misconception: "conclusionEarly" },
      { id: "conclude", label: "Conclude", art: "method.conclude", effect: "Did it hold up?", why: "Only after analysis can you say whether the hypothesis held up.", misconception: "conclusionEarly" },
    ],
    startOrder: ["experiment", "conclude", "observe", "analyse", "hypothesis", "question"],
    misconceptions: {
      hypothesisLate: { name: "Putting the hypothesis after the experiment", reply: "An experiment is designed to test a guess, so the guess (the hypothesis) has to exist first. Testing first and guessing later isn’t a test." },
      conclusionEarly: { name: "Concluding before analysing", reply: "You can only conclude once the data are analysed; otherwise the conclusion is just the hypothesis again." },
    },
    perfectReply: "All in order first time. Notice the loop: a conclusion often raises the next question.",
  },
  cer: {
    layout: "bins",
    title: "Claim, evidence or reasoning?",
    instructions: "A class tested whether ice melts faster on a metal tray or a wooden one. Sort each sentence from their write-up.",
    noun: "sentences",
    bins: [
      { id: "claim", label: "Claim", hint: "The answer to the question" },
      { id: "evidence", label: "Evidence", hint: "What this test observed or measured" },
      { id: "reasoning", label: "Reasoning", hint: "The science that links them" },
    ],
    items: [
      { id: "c1", bin: "claim", label: "Ice melts faster on a metal tray than on a wooden one.", why: "It directly answers the question the class was testing.", misconception: "claim",
        wrong: { reasoning: "It says what happens, not why. Reasoning would explain the cause (how heat moves).",
          evidence: { why: "It’s what the class concluded from the timings, not something they measured directly.", misconception: "dataAsClaim" } } },
      { id: "e1", bin: "evidence", label: "The cube on metal melted in 4 minutes; the one on wood took 11.", why: "These are measurements from this test, which makes them evidence.", misconception: "data",
        wrong: { claim: { why: "Numbers from the test support the claim; they aren’t the claim itself.", misconception: "dataAsClaim" } } },
      { id: "e2", bin: "evidence", label: "We repeated it three times and metal was faster every time.", why: "Repeat trials are observations from the investigation, so they count as evidence (and make it stronger).", misconception: "data",
        wrong: { claim: { why: "It reports what the repeats showed; the claim is the one-line answer those repeats support.", misconception: "dataAsClaim" } } },
      { id: "e3", bin: "evidence", label: "The metal tray felt colder to touch than the wooden one.", why: "It’s something the class observed with their own hands during the test, so it’s evidence, even though it sounds like an explanation.", misconception: "data",
        wrong: { reasoning: "It’s an observation, not an explanation. The reasoning is why metal feels colder: it carries heat away from your hand faster.",
          claim: { why: "It’s an observation made during the test, not the answer to the question.", misconception: "dataAsClaim" } } },
      { id: "r1", bin: "reasoning", label: "Metal conducts heat better than wood, so it moves heat from the room into the ice faster.", why: "It’s a general science idea that explains why the evidence supports the claim.", misconception: "fact",
        wrong: { evidence: "It’s true, but it wasn’t measured in this test. A science fact that explains the result is reasoning, not evidence.",
          claim: { why: "It explains why metal wins; the claim only says that it does.", misconception: "claim" } } },
      { id: "r2", bin: "reasoning", label: "Because heat reached the ice sooner, it got to its melting point first.", why: "It connects the measured result to the cause, which is what reasoning does.", misconception: "fact",
        wrong: { claim: { why: "It explains the claim rather than stating it. The ‘because’ is a clue that it’s reasoning.", misconception: "claim" } } },
    ],
    misconceptions: {
      fact: { name: "Counting a true science fact as evidence", reply: "Evidence has to come from this investigation: what you saw or measured. A fact like ‘metal conducts heat’ is true everywhere, so it isn’t evidence here; it’s the reasoning that explains the evidence." },
      data: { name: "Treating observations as explanations", reply: "If the class saw it, timed it, or felt it during the test, it’s evidence, even when it sounds explanatory. Ask: did they find this out by doing the test? Then it’s evidence." },
      dataAsClaim: { name: "Mixing up the measurements with the claim they support", reply: "The claim is the one-sentence answer to the question. The timings and observations are evidence for it. Ask: is this something they measured, or what they decided from the measurements?" },
      claim: { name: "Mixing up the claim with the explanation for it", reply: "The claim is just the answer: metal melts ice faster. Anything with ‘because’ or ‘so’ that explains why is reasoning." },
    },
  },
  plantCell: {
    layout: "label",
    title: "Label the plant cell",
    instructions: "Drag each name onto its numbered spot.",
    noun: "labels",
    diagram: "plantCell",
    parts: [
      { id: "wall", label: "Cell wall", at: "wall", why: "The thick outer band. Plant cells have this rigid wall outside the membrane; animal cells don’t.", misconception: "boundary",
        wrong: { membrane: "The membrane is the thin line just inside. The wall is the thick, rigid band on the outside." } },
      { id: "membrane", label: "Cell membrane", at: "membrane", why: "The thin line just inside the wall. It controls what goes in and out.", misconception: "boundary",
        wrong: { wall: "The wall is the thick outer band. The membrane is the thin line pressed just inside it." } },
      { id: "nucleus", label: "Nucleus", at: "nucleus", why: "The round body holding the DNA, with a dark nucleolus. In a plant cell it’s often pushed to one side by the vacuole.", misconception: "size",
        wrong: { vacuole: { why: "The big central sac is the vacuole. The nucleus is the smaller round body with a dark spot inside.", misconception: "size" } } },
      { id: "vacuole", label: "Vacuole", at: "vacuole", why: "The large central sac of cell sap. It’s the biggest thing in a plant cell and keeps it firm.", misconception: "size",
        wrong: { nucleus: "This big sac is the vacuole. Biggest doesn’t mean nucleus: in plant cells the vacuole is far larger." } },
      { id: "chloroplast", label: "Chloroplast", at: "chloroplast", why: "The oval bodies with stacked membranes inside. They capture light for photosynthesis.", misconception: "energy",
        wrong: { mitochondrion: "Mitochondria release energy from food; they’re the bean shapes with a folded inner membrane. Chloroplasts have flat stacks and capture light." } },
      { id: "mitochondrion", label: "Mitochondrion", at: "mitochondrion", why: "The bean shape with a folded inner membrane. It releases energy from glucose in respiration.", misconception: "energy",
        wrong: { chloroplast: "Chloroplasts have flat stacked membranes and capture light. Mitochondria have a folded inner membrane and release energy from food." } },
    ],
    misconceptions: {
      boundary: { name: "Mixing up the cell wall and the cell membrane", reply: "Think of a balloon in a box. The membrane is the thin balloon that controls what passes; the wall is the rigid box outside it. Plant cells have both, wall on the outside." },
      size: { name: "Assuming the biggest part must be the nucleus", reply: "In plant cells the largest structure is the vacuole, a sac of cell sap. The nucleus is smaller, round, and has a dark spot (the nucleolus)." },
      energy: { name: "Confusing chloroplasts with mitochondria", reply: "Both deal with energy, in opposite directions. Chloroplasts capture light to make sugar; mitochondria break sugar down to release energy. Plant cells have both." },
    },
  },
  heart: {
    layout: "label",
    title: "Label the heart",
    instructions: "You’re facing the person, so their right side is on your left. Drag each name onto its spot.",
    noun: "labels",
    diagram: "heart",
    parts: [
      { id: "ra", label: "Right atrium", at: "rightAtrium", why: "Top chamber on the person’s right (your left). It receives blood returning from the body.", misconception: "sides",
        wrong: { la: "Same chamber, other side: the diagram faces you, so the person’s right is on your left.", rv: { why: "Atria are the top, thin-walled receiving chambers; ventricles are below and pump out.", misconception: "chambers" } } },
      { id: "rv", label: "Right ventricle", at: "rightVentricle", why: "Bottom chamber on the person’s right. It pumps blood to the lungs.", misconception: "sides",
        wrong: { lv: "This is the person’s right ventricle (your left). The left ventricle has the thicker wall and pumps to the body.", ra: { why: "Ventricles are the lower pumping chambers.", misconception: "chambers" } } },
      { id: "la", label: "Left atrium", at: "leftAtrium", why: "Top chamber on the person’s left (your right). It receives oxygen-rich blood from the lungs.", misconception: "sides",
        wrong: { ra: "The person’s left is on your right when you face them.", lv: { why: "Atria are on top and receive blood.", misconception: "chambers" } } },
      { id: "lv", label: "Left ventricle", at: "leftVentricle", why: "Bottom chamber on the person’s left, with the thickest wall. It pumps blood round the whole body.", misconception: "sides",
        wrong: { rv: "The person’s left ventricle is on your right as you face them.", la: { why: "Ventricles are the lower pumping chambers.", misconception: "chambers" } } },
      { id: "aorta", label: "Aorta", at: "aorta", why: "The big arch leaving the left ventricle. It carries oxygen-rich blood to the body.", misconception: "vessels",
        wrong: { pa: "The pulmonary artery leaves the right ventricle for the lungs; the aorta arches up from the left ventricle to the body." } },
      { id: "pa", label: "Pulmonary artery", at: "pulmonaryArtery", why: "Leaves the right ventricle and carries blood to the lungs to pick up oxygen.", misconception: "vessels",
        wrong: { aorta: "The aorta leaves the left side for the body. This vessel leaves the right ventricle for the lungs." } },
    ],
    misconceptions: {
      sides: { name: "Reading left and right from your own side", reply: "Heart diagrams face you, like the person standing opposite. Their right side is on your left, so the right atrium and ventricle are drawn on the left of the page." },
      chambers: { name: "Mixing up atria and ventricles", reply: "Atria sit on top and receive blood; ventricles sit below and pump it out. A for arrive, V for ‘venture out’." },
      vessels: { name: "Mixing up the aorta and the pulmonary artery", reply: "Follow the colour of the side. The right side pumps oxygen-poor blood to the lungs (pulmonary artery); the left side pumps oxygen-rich blood to the body (aorta)." },
    },
  },
};

export const scenario = {
  tab: "Sort & label",
  prompt: "Can you quiz me on the stages of mitosis?",
  intro: "Let’s make it a sort. The stages of mitosis blend into each other, so each drawing is one illustrated milestone. Drag the five onto the track in the order the cell reaches them. Tap ? on any you’re guessing, and I’ll explain the ones that don’t fit.",
  receiptLabel: "Sort & label exercise",
  receiptText: "The learner asked to be quizzed. The board checks each placement separately, explains each miss, and retries only the missed ones.",
  preset: "mitosis",
};

export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  mitosis: { label: "Mitosis · sequence", prompt: scenario.prompt, intro: scenario.intro },
  mitosisSeen: { label: "Mitosis · pictures only", prompt: "Test me on mitosis from the pictures, without the names.",
    intro: "Here are the five cells with the names hidden. Order them by what the chromosomes are doing; the names appear when you check." },
  waterCycle: { label: "Water cycle · loop", prompt: "What order does the water cycle go in?",
    intro: "It’s a loop, so there’s no first stage, only what leads into what. Drag each picture onto the loop." },
  scientificMethod: { label: "Scientific method", prompt: "Can you test me on the order of the scientific method?",
    intro: "Six steps, one track. Drag each picture into the order a scientist works through them." },
  cer: { label: "Claim/evidence · bins", prompt: "I keep mixing up evidence and reasoning in lab reports.",
    intro: "Let’s sort a real write-up. Six sentences from one ice-melting test: put each one where it belongs." },
  plantCell: { label: "Plant cell · label", prompt: "Can you test me on the parts of a plant cell?",
    intro: "Here’s a plant cell with six parts numbered. Drag each name to its spot, and tap ? on any you’re guessing." },
  heart: { label: "Heart · label", prompt: "Quiz me on the chambers of the heart.",
    intro: "This heart faces you, so the person’s right is on your left. Drag each name to its numbered spot." },
};
