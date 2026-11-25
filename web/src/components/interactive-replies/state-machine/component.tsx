import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DraggableRenderer, param, translate, type Draggable } from "dragology";
import {
  Ban, CircleCheck, CircleDot, Coins, CupSoda, FileCheck2, Flag, Handshake, Hourglass, Inbox, Link2,
  LockKeyhole, LockKeyholeOpen, MapPin, Play, Power, Search, Send, Server, TriangleAlert,
} from "lucide-react";
import "./component.css";

/* ============================================================================
   StateMachineBuilder: a finite state machine the learner wires, steps or repairs.
   - build: draw arrows by dragging one state onto another, then drop an event
            token from the shelf onto the arrow. Check compares with `answer`.
   - trace: the machine is given. Drag the marker along the arrow for each input.
   - fix:   the machine is given with a wrong transition. Run the inputs, then drag
            the wrong event chip onto the state it should lead to.
   The machine is deterministic: each (state, event) pair has at most one arrow.
   A missing arrow means the input is rejected ("stuck").
   ========================================================================== */

export type ShareSummary = { learner: string; data: string; reply: string };

export type MachineIcon =
  | "link" | "search" | "pin" | "lock" | "unlock" | "hourglass" | "file" | "coin" | "cup" | "check"
  | "x" | "send" | "inbox" | "power" | "play" | "flag" | "alert" | "dot" | "handshake" | "server";
const ICONS = {
  link: Link2, search: Search, pin: MapPin, lock: LockKeyhole, unlock: LockKeyholeOpen, hourglass: Hourglass,
  file: FileCheck2, coin: Coins, cup: CupSoda, check: CircleCheck, x: Ban, send: Send, inbox: Inbox, power: Power,
  play: Play, flag: Flag, alert: TriangleAlert, dot: CircleDot, handshake: Handshake, server: Server,
} as const;

export type MachineState = { id: string; label: string; kind?: "start" | "goal" | "error"; icon?: MachineIcon };
export type MachineEvent = { id: string; label: string };
export type MachineTransition = { event: string; from: string; to: string; why?: string };
export type MachineTrace = { input: string[]; expect: string; label?: string; note?: string };
export type StateMachineConfig = {
  /** Heading above the canvas. */
  title: string;
  mode: "build" | "trace" | "fix";
  /** 2 to 8 states. Exactly one has kind "start". */
  states: MachineState[];
  /** 1 to 8 events (inputs). */
  events: MachineEvent[];
  /** The correct machine. `why` explains a transition; feedback quotes it. */
  answer: MachineTransition[];
  /** build: correct transitions drawn in advance (locked). fix: the machine as shown, with the mistake. */
  given?: MachineTransition[];
  /** Inputs to run. `expect` is the state the answer machine ends in, or "stuck". */
  traces?: MachineTrace[];
  /** What Keating says when the learner gets it right. */
  takeaway?: string;
  /** The simplifying assumptions the model relies on, shown under the title from the start (≤ 200 chars). */
  assumes?: string;
};

type Props = { config: StateMachineConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void };

/* ---------- Validation ---------- */
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

const TOP_KEYS = new Set(["title", "mode", "states", "events", "answer", "given", "traces", "takeaway", "assumes"]);
export function validateStateMachine(config: unknown): string[] {
  if (!isObj(config)) return ["The config must be an object."];
  const c = config as Record<string, unknown>;
  const errs: string[] = [];
  if (!str(c.title, 90)) errs.push("title must be a short string.");
  if (c.mode !== "build" && c.mode !== "trace" && c.mode !== "fix") errs.push('mode must be "build", "trace" or "fix".');
  const states = Array.isArray(c.states) ? c.states : [];
  if (!Array.isArray(c.states) || states.length < 2 || states.length > 8) errs.push("states must list 2 to 8 states.");
  const sids = new Set<string>();
  let starts = 0;
  states.forEach((s, i) => {
    if (!isObj(s) || typeof s.id !== "string" || !ID_RE.test(s.id) || s.id === "stuck") { errs.push(`states[${i}] needs an id (letters, digits, - or _; not "stuck").`); return; }
    if (sids.has(s.id)) errs.push(`State id "${s.id}" is used twice.`);
    sids.add(s.id);
    if (!str(s.label, 28)) errs.push(`State "${s.id}" needs a label of at most 28 characters.`);
    if (s.kind !== undefined && s.kind !== "start" && s.kind !== "goal" && s.kind !== "error") errs.push(`State "${s.id}" kind must be start, goal or error.`);
    if (s.kind === "start") starts++;
    if (s.icon !== undefined && !(typeof s.icon === "string" && s.icon in ICONS)) errs.push(`State "${s.id}" icon must be one of: ${Object.keys(ICONS).join(", ")}.`);
  });
  if (states.length && starts !== 1) errs.push('Exactly one state needs kind "start".');
  const events = Array.isArray(c.events) ? c.events : [];
  if (!Array.isArray(c.events) || events.length < 1 || events.length > 8) errs.push("events must list 1 to 8 events.");
  const eids = new Set<string>();
  events.forEach((e, i) => {
    if (!isObj(e) || typeof e.id !== "string" || !ID_RE.test(e.id)) { errs.push(`events[${i}] needs an id.`); return; }
    if (eids.has(e.id)) errs.push(`Event id "${e.id}" is used twice.`);
    eids.add(e.id);
    if (!str(e.label, 22)) errs.push(`Event "${e.id}" needs a label of at most 22 characters.`);
  });
  const trList = (v: unknown, name: string, min: number, max: number): MachineTransition[] => {
    if (!Array.isArray(v) || v.length < min || v.length > max) { errs.push(`${name} must list ${min} to ${max} transitions.`); return []; }
    const seen = new Set<string>();
    const out: MachineTransition[] = [];
    v.forEach((t, i) => {
      if (!isObj(t)) { errs.push(`${name}[${i}] must be {event, from, to}.`); return; }
      const bad = [!eids.has(t.event as string) && "event", !sids.has(t.from as string) && "from", !sids.has(t.to as string) && "to"].filter(Boolean);
      if (bad.length) { errs.push(`${name}[${i}] has an unknown ${bad.join(" and ")}.`); return; }
      if (t.why !== undefined && !str(t.why, 260)) errs.push(`${name}[${i}].why must be a sentence of at most 260 characters.`);
      const k = `${t.from} ${t.event}`;
      if (seen.has(k)) errs.push(`${name} has two "${t.event}" transitions out of "${t.from}". Each state takes each event at most once.`);
      seen.add(k);
      out.push(t as MachineTransition);
    });
    return out;
  };
  const answer = trList(c.answer, "answer", 1, 24);
  const given = c.given === undefined ? undefined : trList(c.given, "given", 0, 24);
  const traces = Array.isArray(c.traces) ? c.traces : [];
  if (c.traces !== undefined && (!Array.isArray(c.traces) || traces.length > 6)) errs.push("traces must list at most 6 inputs.");
  traces.forEach((t, i) => {
    if (!isObj(t) || !Array.isArray(t.input) || t.input.length < 1 || t.input.length > 12) { errs.push(`traces[${i}].input must list 1 to 12 event ids.`); return; }
    if (!t.input.every(e => eids.has(e as string))) errs.push(`traces[${i}].input uses an unknown event.`);
    if (!(t.expect === "stuck" || sids.has(t.expect as string))) errs.push(`traces[${i}].expect must be a state id or "stuck".`);
    if (t.label !== undefined && !str(t.label, 40)) errs.push(`traces[${i}].label must be short.`);
    if (t.note !== undefined && !str(t.note, 260)) errs.push(`traces[${i}].note must be a sentence of at most 260 characters.`);
  });
  if (c.takeaway !== undefined && !str(c.takeaway, 320)) errs.push("takeaway must be at most 320 characters.");
  if (c.assumes !== undefined && !str(c.assumes, 200)) errs.push("assumes must be a sentence of at most 200 characters.");
  const unknown = Object.keys(c).filter(k => !TOP_KEYS.has(k));
  if (unknown.length) errs.push(`Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
  if (errs.length) return errs;

  /* Semantic checks: the science must hold in the answer machine. */
  const start = (states as MachineState[]).find(s => s.kind === "start")!.id;
  const ans = answer.map((t, i) => ({ ...t, id: `a${i}`, event: t.event as string | null }));
  (traces as MachineTrace[]).forEach((t, i) => {
    const r = runInput(ans, start, t.input);
    const end = r.stuck ? "stuck" : r.end;
    if (end !== t.expect) errs.push(`traces[${i}] expects "${t.expect}", but the answer machine ends ${end === "stuck" ? "stuck" : `at "${end}"`}.`);
  });
  const reach = reachableFrom(ans, start);
  for (const s of states as MachineState[]) if (!reach.has(s.id)) errs.push(`State "${s.id}" can't be reached from the start in the answer.`);
  const key = (t: MachineTransition) => `${t.from} ${t.event} ${t.to}`;
  const ansKeys = new Set(answer.map(key));
  if (c.mode === "build") {
    if (given?.some(t => !ansKeys.has(key(t)))) errs.push("In build mode every given transition must also be in the answer.");
    if (given && given.length >= answer.length) errs.push("In build mode the learner must have something left to draw.");
    const goals = (states as MachineState[]).filter(s => s.kind === "goal");
    if (!traces.length && !goals.length) errs.push("Build mode needs a goal state or at least one trace to run.");
  }
  if (c.mode === "trace" && !traces.length) errs.push("Trace mode needs at least one trace.");
  if (c.mode === "fix") {
    if (!given) errs.push("Fix mode needs `given`: the machine as shown, with the mistake.");
    else {
      const gKeys = new Set(given.map(key));
      const diff = [...ansKeys].filter(k => !gKeys.has(k)).length + [...gKeys].filter(k => !ansKeys.has(k)).length;
      if (diff === 0) errs.push("In fix mode `given` must differ from the answer.");
      if (diff > 4) errs.push("In fix mode `given` should differ from the answer in one or two transitions.");
      if (!traces.length) errs.push("Fix mode needs at least one trace.");
      else {
        const g = given.map((t, i) => ({ ...t, id: `g${i}`, event: t.event as string | null }));
        const fails = (traces as MachineTrace[]).some(t => { const r = runInput(g, start, t.input); return (r.stuck ? "stuck" : r.end) !== t.expect; });
        if (!fails) errs.push("In fix mode at least one trace must go wrong on the given machine, or the mistake can't be found.");
      }
    }
  }
  return errs;
}

/* ---------- Machine ---------- */
type Tr = { id: string; event: string | null; from: string; to: string; locked?: boolean };
type Step = { from: string; event: string; to?: string; tid?: string };
type Run = { steps: Step[]; end: string; stuck: boolean };
const findTr = (trs: Tr[], from: string, ev: string) => trs.find(t => t.from === from && t.event === ev);
function runInput(trs: Tr[], start: string, input: string[]): Run {
  let cur = start;
  const steps: Step[] = [];
  for (const ev of input) {
    const t = findTr(trs, cur, ev);
    if (!t) { steps.push({ from: cur, event: ev }); return { steps, end: cur, stuck: true }; }
    steps.push({ from: cur, event: ev, to: t.to, tid: t.id });
    cur = t.to;
  }
  return { steps, end: cur, stuck: false };
}
const endOf = (r: Run) => (r.stuck ? "stuck" : r.end);
function reachableFrom(trs: Tr[], start: string) {
  const seen = new Set([start]);
  for (const s of seen) for (const t of trs) if (t.from === s) seen.add(t.to);
  return seen;
}
type Diff = { right: number; total: number; wrongTo: { t: Tr; want: MachineTransition }[]; extra: Tr[]; missing: MachineTransition[]; unlabeled: Tr[] };
function diffMachine(trs: Tr[], answer: MachineTransition[]): Diff {
  const wrongTo: Diff["wrongTo"] = [], missing: MachineTransition[] = [];
  let right = 0;
  for (const a of answer) {
    const t = findTr(trs, a.from, a.event);
    if (!t) missing.push(a);
    else if (t.to !== a.to) wrongTo.push({ t, want: a });
    else right++;
  }
  const extra = trs.filter(t => t.event !== null && !answer.some(a => a.from === t.from && a.event === t.event));
  return { right, total: answer.length, wrongTo, extra, missing, unlabeled: trs.filter(t => t.event === null) };
}
const diffOk = (d: Diff) => !d.wrongTo.length && !d.extra.length && !d.missing.length && !d.unlabeled.length;

/* ---------- Normalised config ---------- */
type Ready = {
  title: string; mode: StateMachineConfig["mode"]; takeaway?: string; assumes?: string;
  states: MachineState[]; events: MachineEvent[]; answer: MachineTransition[]; given: MachineTransition[];
  traces: (MachineTrace & { label: string })[]; start: string; goals: Set<string>;
  si: Map<string, number>; ei: Map<string, number>;
};
function ready(c: StateMachineConfig): Ready {
  const states = c.states.map(s => ({ ...s, label: s.label.trim() }));
  const start = states.find(s => s.kind === "start")!.id;
  const answer = c.answer;
  const ev = new Map(c.events.map(e => [e.id, e.label.trim()]));
  let traces = (c.traces ?? []).map(t => ({ ...t, label: t.label ?? t.input.map(e => ev.get(e)).join(" ") }));
  const goals = new Set(states.filter(s => s.kind === "goal").map(s => s.id));
  if (!traces.length && c.mode === "build") {
    /* No traces: run the shortest path from the start to a goal in the answer. */
    const prev = new Map<string, MachineTransition>();
    const q = [start]; const seen = new Set(q);
    while (q.length) {
      const u = q.shift()!;
      if (goals.has(u)) {
        const input: string[] = []; let x = u;
        while (x !== start) { const t = prev.get(x)!; input.unshift(t.event); x = t.from; }
        traces = [{ input, expect: u, label: "the main path" }];
        break;
      }
      for (const t of answer) if (t.from === u && !seen.has(t.to)) { seen.add(t.to); prev.set(t.to, t); q.push(t.to); }
    }
  }
  return {
    title: c.title.trim(), mode: c.mode, takeaway: c.takeaway, assumes: c.assumes?.trim(), states, events: c.events.map(e => ({ ...e, label: e.label.trim() })),
    answer, given: c.given ?? [], traces, start, goals,
    si: new Map(states.map((s, i) => [s.id, i])), ei: new Map(c.events.map((e, i) => [e.id, i])),
  };
}

/* ---------- Layout ---------- */
type P = { x: number; y: number };
type Geo = {
  W: number; H: number; compact: boolean; bw: number; bh: number; shelfH: number;
  chipH: number; charW: number; fs: number;
  min: P; max: P;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function shelfItems(r: Ready, W: number, compact: boolean) {
  const chipH = compact ? 24 : 26, charW = compact ? 6.3 : 6.8;
  let x = 10, row = 0;
  const items = r.events.map(e => {
    const w = Math.round(e.label.length * charW + 22);
    if (x + w > W - 10 && x > 10) { x = 10; row++; }
    const item = { id: e.id, x: x + w / 2, y: 10 + row * (chipH + 7) + chipH / 2, w };
    x += w + 7;
    return item;
  });
  return { items, h: r.mode === "trace" ? 48 : 10 + (row + 1) * (chipH + 7) + 8, chipH };
}

/** Longest-path layers from the start over the learner's arrows; goals last. */
function layers(r: Ready, trs: Tr[], cap: number): string[][] {
  const adj = new Map<string, string[]>(r.states.map(s => [s.id, []]));
  for (const t of trs) if (t.from !== t.to && !adj.get(t.from)!.includes(t.to)) adj.get(t.from)!.push(t.to);
  const mark = new Map<string, number>(); const back = new Set<string>(); const post: string[] = [];
  const dfs = (u: string) => {
    mark.set(u, 1);
    for (const v of adj.get(u)!) { if (mark.get(v) === 1) back.add(`${u} ${v}`); else if (!mark.get(v)) dfs(v); }
    mark.set(u, 2); post.push(u);
  };
  dfs(r.start);
  const rank = new Map<string, number>([[r.start, 0]]);
  for (const u of post.reverse()) for (const v of adj.get(u)!) if (!back.has(`${u} ${v}`)) rank.set(v, Math.max(rank.get(v) ?? 0, rank.get(u)! + 1));
  const isGoal = (id: string) => r.goals.has(id) && id !== r.start;
  for (const g of r.goals) if (isGoal(g)) rank.delete(g);
  const count = (k: number) => [...rank.values()].filter(v => v === k).length;
  for (const s of r.states) {
    if (rank.has(s.id) || isGoal(s.id)) continue;
    let k = 1;
    while (count(k) >= cap) k++;
    rank.set(s.id, k);
  }
  const top = Math.max(0, ...rank.values());
  for (const g of r.goals) if (isGoal(g)) rank.set(g, top + 1);
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const out: string[][] = used.map(k => r.states.filter(s => rank.get(s.id) === k).map(s => s.id));
  /* Barycentre ordering: two sweeps against the previous layer. */
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < out.length; i++) {
      const prevIdx = new Map(out[i - 1].map((id, j) => [id, j]));
      const bary = (id: string) => {
        const ps = trs.filter(t => t.to === id && prevIdx.has(t.from)).map(t => prevIdx.get(t.from)!);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : out[i].indexOf(id);
      };
      out[i] = [...out[i]].sort((a, b) => bary(a) - bary(b));
    }
  }
  return out;
}

/** State label lines and font size that fit a box of width bw. */
function nodeLines(label: string, bw: number, hasIcon: boolean, compact: boolean): { lines: string[]; fs: number } {
  const room = bw - 14 - (hasIcon ? (compact ? 20 : 23) : 0);
  for (const fs of compact ? [11.5, 10.5, 9.5] : [12.5, 11.5, 10.5]) {
    const cw = fs * 0.56;
    const lines = splitLabel(label, room, cw);
    if (!lines.some(l => l.endsWith("…"))) return { lines, fs };
  }
  return { lines: splitLabel(label, room, 9.5 * 0.56), fs: 9.5 };
}
/** Width a state box wants so its label fits on at most two lines at the normal size. */
function wantWidth(r: Ready, compact: boolean) {
  const fs = compact ? 11.5 : 12.5;
  return Math.max(...r.states.map(s => {
    return s.label.length * fs * 0.56 + 14 + (s.icon ? (compact ? 20 : 23) : 0);
  }));
}

function layout(r: Ready, trs: Tr[], W: number): { pos: Record<string, P>; geo: Geo } {
  const compact = W < 460;
  const want = wantWidth(r, compact);
  /* Leave room between columns for the widest event label. */
  const labelRoom = Math.max(...r.events.map(e => e.label.length * (compact ? 6.1 : 6.6) + 18)) + 18;
  const shelf = shelfItems(r, W, compact);
  const middles = r.states.length - 1 - r.goals.size;
  const ls = layers(r, trs, compact ? 2 : middles > 4 ? 3 : 2);
  const pos: Record<string, P> = {};
  let bw: number, bh: number, H: number;
  if (!compact) {
    const mx = 26, avail = W - 2 * mx;
    const maxPer = Math.max(2, Math.floor(avail / 128));
    const bands = Math.ceil(ls.length / maxPer), per = Math.ceil(ls.length / bands);
    const colW = avail / per;
    bw = clamp(want, 104, Math.max(104, Math.min(150, colW - 44, colW - labelRoom))); bh = 48;
    const maxM = Math.max(...ls.map(l => l.length));
    const rowH = bh + 64, bandH = maxM * rowH, gap = 44;
    const top = shelf.h + 52;
    ls.forEach((layer, li) => {
      const b = Math.floor(li / per), ii = li % per;
      const col = b % 2 === 0 ? ii : per - 1 - ii;
      const bandTop = top + b * (bandH + gap);
      layer.forEach((id, i) => { pos[id] = { x: mx + colW * (col + 0.5), y: bandTop + ((maxM - layer.length) * rowH) / 2 + i * rowH + bh / 2 }; });
    });
    H = top + bands * bandH + (bands - 1) * gap - 64 + bh + 50;
  } else {
    const pairs = ls.some(l => l.length > 1);
    bw = clamp(want, 86, pairs ? (W - 24) / 2 - 18 : Math.min(150, W - 120)); bh = 46;
    const rowH = bh + 60;
    const top = shelf.h + 48;
    let row = 0;
    for (const layer of ls) {
      for (let i = 0; i < layer.length; i += 2) {
        const chunk = layer.slice(i, i + 2);
        chunk.forEach((id, j) => {
          const x = chunk.length === 1 ? W / 2 : W / 2 + (j === 0 ? -1 : 1) * (bw / 2 + 12);
          pos[id] = { x, y: top + row * rowH + bh / 2 };
        });
        row++;
      }
    }
    H = top + (row - 1) * rowH + bh + 48;
  }
  const geo: Geo = {
    W, H, compact, bw, bh, shelfH: shelf.h, chipH: compact ? 21 : 23, charW: compact ? 6.1 : 6.6, fs: compact ? 11 : 12,
    min: { x: bw / 2 + 6, y: shelf.h + 40 + bh / 2 }, max: { x: W - bw / 2 - 6, y: H - bh / 2 - 26 },
  };
  return { pos, geo };
}

/* ---------- Routing ---------- */
type Route = { key: string; from: string; to: string; d: string; start: P; c1: P; c2: P; end: P; angle: number; loop: boolean };
type Box = { x: number; y: number; w: number; h: number };
const bez = (r: Route, t: number): P => {
  const u = 1 - t, p = [r.start, r.c1, r.c2, r.end];
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
};
const inBox = (p: P, b: Box) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
function exitPoint(c: P, toward: P, g: Geo, pad: number): P {
  const dx = toward.x - c.x, dy = toward.y - c.y;
  const hw = g.bw / 2 + pad, hh = g.bh / 2 + pad;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}
/** Loops sit on top of a state, or on its right in a narrow single-column row. */
type Link = { from: string; to: string };
function loopSide(id: string, pos: Record<string, P>, g: Geo, links: Link[]): "top" | "topLeft" | "right" {
  const p = pos[id];
  if (g.compact && !Object.entries(pos).some(([k, q]) => k !== id && Math.abs(q.y - p.y) < g.bh)) return "right";
  /* Put the loop on the half of the top edge away from this state's other arrows. */
  let lean = 0;
  for (const l of links) {
    if (l.from === l.to) continue;
    const other = l.from === id ? l.to : l.to === id ? l.from : undefined;
    if (other && pos[other]) lean += Math.sign(pos[other].x - p.x);
  }
  return lean > 0 ? "topLeft" : "top";
}
function loopAimAt(id: string, pos: Record<string, P>, g: Geo, links: Link[]): P {
  const p = pos[id];
  const side = loopSide(id, pos, g, links);
  return side === "right" ? { x: p.x + g.bw / 2 + 34, y: p.y } : { x: p.x + (side === "top" ? 1 : -1) * g.bw * 0.2, y: p.y - g.bh / 2 - 34 };
}
function loopRoute(key: string, id: string, pos: Record<string, P>, g: Geo, links: Link[]): Route {
  const c = pos[id];
  const side = loopSide(id, pos, g, links);
  if (side === "topLeft") {
    const top = c.y - g.bh / 2;
    const start = { x: c.x - g.bw * 0.34, y: top - 1 }, end = { x: c.x - g.bw * 0.06, y: top - 3 };
    const c1 = { x: c.x - g.bw * 0.48, y: top - 44 }, c2 = { x: c.x + g.bw * 0.06, y: top - 44 };
    const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
    return { key, from: id, to: id, start, c1, c2, end, loop: true, angle: (angle * 180) / Math.PI, d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}` };
  }
  if (side === "right") {
    const rx = c.x + g.bw / 2;
    const start = { x: rx + 1, y: c.y - g.bh * 0.3 }, end = { x: rx + 3, y: c.y + g.bh * 0.3 };
    const c1 = { x: rx + 44, y: c.y - g.bh * 0.55 }, c2 = { x: rx + 44, y: c.y + g.bh * 0.55 };
    const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
    return { key, from: id, to: id, start, c1, c2, end, loop: true, angle: (angle * 180) / Math.PI, d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}` };
  }
  const top = c.y - g.bh / 2;
  const start = { x: c.x + g.bw * 0.06, y: top - 1 }, end = { x: c.x + g.bw * 0.34, y: top - 3 };
  const c1 = { x: c.x - g.bw * 0.06, y: top - 44 }, c2 = { x: c.x + g.bw * 0.48, y: top - 44 };
  const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
  return { key, from: id, to: id, start, c1, c2, end, loop: true, angle: (angle * 180) / Math.PI, d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}` };
}
function routeOne(key: string, from: string, to: string, pos: Record<string, P>, g: Geo, boxes: Box[], prior: P[], reverse: boolean): Route {
  const a = pos[from], b = pos[to];
  const vx = b.x - a.x, vy = b.y - a.y, len = Math.max(1, Math.hypot(vx, vy));
  const nx = -vy / len, ny = vx / len;
  const bends = reverse ? [0.3, 0.42, 0.56, 0.7] : [0, 0.2, -0.2, 0.34, -0.34, 0.5, -0.5, 0.7, -0.7];
  let best: { r: Route; cost: number } | undefined;
  for (const k of bends) {
    const off = Math.sign(k) * Math.min(Math.abs(k) * len, 130) / 0.75;
    const c1 = { x: a.x + vx * 0.3 + nx * off, y: a.y + vy * 0.3 + ny * off };
    const c2 = { x: a.x + vx * 0.7 + nx * off, y: a.y + vy * 0.7 + ny * off };
    const start = exitPoint(a, c1, g, 2), end = exitPoint(b, c2, g, 4);
    const angle = Math.atan2(end.y - c2.y, end.x - c2.x);
    const r: Route = { key, from, to, start, c1, c2, end, loop: false, angle: (angle * 180) / Math.PI, d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}` };
    let cost = Math.abs(k) * 40;
    for (let i = 1; i < 16; i++) {
      const p = bez(r, i / 16);
      for (const bx of boxes) if (inBox(p, bx)) cost += 400;
      if (p.y < g.shelfH + 4 || p.y > g.H - 6 || p.x < 4 || p.x > g.W - 4) cost += 300;
      for (const q of prior) if (Math.abs(p.x - q.x) < 10 && Math.abs(p.y - q.y) < 10) cost += 25;
    }
    if (!best || cost < best.cost) best = { r, cost };
    if (cost < 1) break;
  }
  return best!.r;
}
type Group = { key: string; from: string; to: string; trs: Tr[] };
function groupsOf(trs: Tr[], r: Ready): Group[] {
  const m = new Map<string, Group>();
  for (const t of trs) {
    const key = `${r.si.get(t.from)}-${r.si.get(t.to)}`;
    if (!m.has(key)) m.set(key, { key, from: t.from, to: t.to, trs: [] });
    m.get(key)!.trs.push(t);
  }
  for (const gr of m.values()) gr.trs.sort((x, y) => (x.event === null ? 99 : r.ei.get(x.event)!) - (y.event === null ? 99 : r.ei.get(y.event)!));
  return [...m.values()];
}
const nodeBox = (p: P, g: Geo, pad = 6): Box => ({ x: p.x - g.bw / 2 - pad, y: p.y - g.bh / 2 - pad, w: g.bw + 2 * pad, h: g.bh + 2 * pad });
function routeAll(groups: Group[], pos: Record<string, P>, g: Geo) {
  const routes = new Map<string, Route>();
  const prior: P[] = [];
  const keys = new Set(groups.map(gr => `${gr.from} ${gr.to}`));
  const sorted = [...groups].sort((a, b) => Number(b.from === b.to) - Number(a.from === a.to));
  for (const gr of sorted) {
    let rt: Route;
    if (gr.from === gr.to) rt = loopRoute(gr.key, gr.from, pos, g, groups);
    else {
      const boxes = Object.entries(pos).filter(([id]) => id !== gr.from && id !== gr.to).map(([, p]) => nodeBox(p, g));
      rt = routeOne(gr.key, gr.from, gr.to, pos, g, boxes, prior, keys.has(`${gr.to} ${gr.from}`));
    }
    for (let i = 1; i < 12; i++) prior.push(bez(rt, i / 12));
    routes.set(gr.key, rt);
  }
  return routes;
}
const chipW = (label: string | null, g: Geo) => (label === null ? 26 : Math.round(label.length * g.charW + 18));
function placeLabels(groups: Group[], routes: Map<string, Route>, pos: Record<string, P>, g: Geo, labelOf: (t: Tr) => string | null, captions: string[] = []) {
  const placed: Box[] = [...Object.values(pos).map(p => nodeBox(p, g, 3)), ...captions.filter(id => pos[id]).map(id => ({ x: pos[id].x - g.bw / 2, y: pos[id].y - g.bh / 2 - 17, w: 46, h: 14 }))];
  const out = new Map<string, { p: P; w: number }>();
  for (const gr of groups) {
    const rt = routes.get(gr.key)!;
    const w = gr.trs.reduce((s, t) => s + chipW(labelOf(t), g), 0) + (gr.trs.length - 1) * 4;
    const h = g.chipH;
    let best: { p: P; cost: number } | undefined;
    /* On the arrow if it fits; otherwise just beside it (offset along the normal). */
    search: for (const off of rt.loop ? [0] : [0, -(h / 2 + 5), h / 2 + 5]) {
      for (const t of rt.loop ? [0.5, 0.42, 0.58] : [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73]) {
        const q = bez(rt, t), q2 = bez(rt, Math.min(1, t + 0.02));
        const tl = Math.max(0.001, Math.hypot(q2.x - q.x, q2.y - q.y));
        const p = { x: q.x - ((q2.y - q.y) / tl) * off, y: q.y + ((q2.x - q.x) / tl) * off };
        const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
        const outside = Math.max(0, -box.x + 2) + Math.max(0, box.x + w - g.W + 2);
        const cost = placed.reduce((s, o) => s + overlap(box, o), 0) + outside * 40 + Math.abs(t - 0.5) * 30 + (off ? 40 : 0);
        if (!best || cost < best.cost) best = { p, cost };
        if (cost < 6) break search;
      }
    }
    const p = { x: clamp(best!.p.x, w / 2 + 2, g.W - w / 2 - 2), y: best!.p.y };
    out.set(gr.key, { p, w });
    placed.push({ x: p.x - w / 2 - 3, y: p.y - h / 2 - 3, w: w + 6, h: h + 6 });
  }
  return out;
}
/** Where each chip of a group sits: a row centred on the label point. */
function chipSpots(gr: Group, at: { p: P; w: number }, g: Geo, labelOf: (t: Tr) => string | null) {
  let x = at.p.x - at.w / 2;
  return gr.trs.map(t => { const w = chipW(labelOf(t), g); const spot = { t, x: x + w / 2, y: at.p.y, w }; x += w + 4; return spot; });
}
function splitLabel(label: string, room: number, charW: number): string[] {
  if (label.length * charW <= room) return [label];
  const words = label.split(" ");
  let best = [label];
  let bestMax = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const m = Math.max(a.length, b.length);
    if (m < bestMax) { bestMax = m; best = [a, b]; }
  }
  const maxChars = Math.floor(room / charW);
  return best.map(s => (s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s));
}

/* ---------- Drag state ---------- */
type Intent =
  | { kind: "arrow"; from: string; to: string }
  | { kind: "label"; event: string; key: string }
  | { kind: "chipArrow"; tid: string; key: string }
  | { kind: "chipState"; tid: string; to: string }
  | { kind: "chipShelf"; tid: string }
  | { kind: "step"; to: string };
type DState = { pos: Record<string, P>; intent?: Intent };

type Model = { trs: Tr[]; pos: Record<string, P>; geo: Geo; moved: boolean };
type Mistake = { ti: number; si: number; from: string; event: string; chose: string; want: string };
type TraceProgress = { ti: number; si: number; cur: string; ends: (string | undefined)[]; mistakes: Mistake[] };
type Check = { diff: Diff; runs: Run[]; ok: boolean };

let uidCounter = 0;
const newId = () => `t${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
const seed = (list: MachineTransition[], locked: boolean, prefix: string): Tr[] => list.map((t, i) => ({ id: `${prefix}${i}`, event: t.event, from: t.from, to: t.to, locked }));
const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

/* SSR-safe: no window/document reads during render or initial state. The real width is measured after mount. */
const INITIAL_WIDTH = 600;


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

/* ---------- Component ---------- */
export function StateMachineBuilder({ config, onChange, onShare }: Props) {
  const errors = useMemo(() => validateStateMachine(config), [config]);
  if (errors.length) {
    return <section className="activity sm-lab is-fallback" aria-label="State machine">
      <p className="sm-fallback">This state machine could not be set up. {errors[0]}</p>
    </section>;
  }
  return <Machine key={JSON.stringify(config)} r={ready(config)} onChange={onChange} onShare={onShare} />;
}

function Machine({ r, onChange, onShare }: { r: Ready; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const L = (id: string) => r.states[r.si.get(id)!]?.label ?? id;
  const E = (id: string | null) => (id === null ? "?" : r.events[r.ei.get(id)!]?.label ?? id);
  const startTrs = (): Tr[] => r.mode === "build" ? seed(r.given, true, "g") : r.mode === "fix" ? seed(r.given, false, "g") : seed(r.answer, true, "a");
  const fresh = (W: number, trs = startTrs()): Model => {
    const base = r.mode === "trace" || r.mode === "fix" ? trs : trs;
    const { pos, geo } = layout(r, r.mode === "build" ? trs : base, W);
    return { trs, pos, geo, moved: false };
  };
  const [model, setModel] = useState<Model>(() => fresh(INITIAL_WIDTH));
  const [history, setHistory] = useState<Model[]>([]);
  const [preview, setPreview] = useState<DState>();
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState<{ text: string; tone: "plain" | "good" | "warn" }>();
  const [check, setCheck] = useState<Check>();
  const [focusRun, setFocusRun] = useState(0);
  const [replay, setReplay] = useState<number>(Infinity);
  const [reduced, setReduced] = useState(false);
  const [shared, setShared] = useState(false);
  const [edits, setEdits] = useState(0);
  const [trace, setTrace] = useState<TraceProgress>({ ti: 0, si: 0, cur: r.start, ends: [], mistakes: [] });
  const [remount, setRemount] = useState(0);
  /* Dragology builds DOM containers while rendering, so the renderer only mounts on the client. */
  const [mounted, setMounted] = useState(false);
  useCancelGesture(dragging, () => { setRemount(k => k + 1); setPreview(undefined); setDragging(false); setStatus("Drag interrupted. Nothing changed."); });
  /* "Use buttons instead" selections */
  const [pickFrom, setPickFrom] = useState(r.start);
  const [pickEvent, setPickEvent] = useState(r.events[0].id);
  const [pickTo, setPickTo] = useState(r.states[1].id);
  const [pickStep, setPickStep] = useState(r.start);

  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches); sync();
    q.addEventListener("change", sync); return () => q.removeEventListener("change", sync);
  }, []);
  useLayoutEffect(() => {
    setMounted(true);
    const el = wrap.current; if (!el) return;
    const resize = () => {
      const W = Math.max(240, Math.floor(el.clientWidth));
      setModel(m => {
        if (Math.abs(m.geo.W - W) < 1) return m;
        /* A discrete layout change (wide ↔ stacked) remounts the renderer: any drag in flight is dropped
           without applying its preview, and nothing tries to blend two unrelated layouts. */
        if ((W < 460) !== m.geo.compact) queueMicrotask(() => { setRemount(k => k + 1); setPreview(undefined); setDragging(false); });
        if (!m.moved || (W < 460) !== m.geo.compact) return { ...fresh(W, m.trs), trs: m.trs };
        const { geo } = layout(r, m.trs, W);
        const pos = Object.fromEntries(Object.entries(m.pos).map(([id, p]) => [id, { x: clamp(p.x * W / m.geo.W, geo.min.x, geo.max.x), y: clamp(p.y, geo.min.y, geo.max.y) }]));
        return { ...m, pos, geo };
      });
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Run replay: step through quickly (≤ 1.5 s in total), skippable. */
  const activeRun = check?.runs[focusRun];
  useEffect(() => {
    if (!activeRun || replay >= activeRun.steps.length) return;
    const every = Math.min(220, 1250 / Math.max(1, activeRun.steps.length));
    const t = setTimeout(() => setReplay(k => k + 1), every);
    return () => clearTimeout(t);
  }, [activeRun, replay]);

  const g = model.geo;
  const labelOf = useCallback((t: Tr) => (t.event === null ? null : E(t.event)), [r]);
  const groups = useMemo(() => groupsOf(model.trs, r), [model.trs, r]);
  const captioned = useMemo(() => r.states.filter(s => s.kind).map(s => s.id), [r]);
  const shelf = useMemo(() => shelfItems(r, g.W, g.compact), [r, g.W, g.compact]);
  const trByKey = (t: Tr) => `${t.from}>${t.event}>${t.to}`;

  /* Committed flags that colour the graph (the same in every drop candidate). */
  const badIds = useMemo(() => new Set(check ? [...check.diff.wrongTo.map(w => w.t.id), ...(r.mode === "build" ? check.diff.extra.map(t => t.id) : []), ...check.diff.unlabeled.map(t => t.id)] : []), [check, r.mode]);
  const replaySteps = activeRun ? activeRun.steps.slice(0, Math.min(replay, activeRun.steps.length)) : [];
  const visited = new Set(replaySteps.map(s => s.tid).filter(Boolean) as string[]);
  const runnerAt = activeRun ? (replaySteps.length ? replaySteps[replaySteps.length - 1].to ?? replaySteps[replaySteps.length - 1].from : r.start) : undefined;
  const runDone = !!activeRun && replay >= activeRun.steps.length;
  const runFailedAt = runDone && activeRun && check ? (activeRun.stuck || endOf(activeRun) !== r.traces[focusRun]?.expect ? (activeRun.stuck ? activeRun.steps[activeRun.steps.length - 1].from : activeRun.end) : undefined) : undefined;
  const traceInput = r.mode === "trace" ? r.traces[trace.ti]?.input ?? [] : [];
  const traceDone = r.mode === "trace" && trace.ends[trace.ti] !== undefined;

  const commit = (next: Model, say: string, edit = true) => {
    setHistory(h => [...h.slice(-30), model]);
    setModel(next);
    setStatus(say);
    if (edit) { setCheck(undefined); setReplay(Infinity); setShared(false); setEdits(e => e + 1); onChange?.(); }
  };

  /* ---------- Edits ---------- */
  function addTransition(trs: Tr[], from: string, event: string, to: string, keepId?: string): { trs: Tr[]; say: string } | string {
    const clash = trs.find(t => t.from === from && t.event === event && t.id !== keepId);
    if (clash?.locked) return `${E(event)} out of ${L(from)} is already given (it goes to ${L(clash.to)}).`;
    let next = trs.filter(t => t !== clash);
    const say = clash && clash.to !== to ? `${E(event)} from ${L(from)} now goes to ${L(to)} instead of ${L(clash.to)}.` : `${E(event)}: ${L(from)} → ${L(to)}.`;
    if (keepId) next = next.map(t => (t.id === keepId ? { ...t, from, to, event } : t));
    else {
      const empty = next.find(t => t.from === from && t.to === to && t.event === null);
      next = empty ? next.map(t => (t === empty ? { ...t, event } : t)) : [...next, { id: newId(), event, from, to }];
    }
    /* A labelled transition fills any "?" placeholder on the same arrow. */
    const labelled = next.some(t => t.from === from && t.to === to && t.event !== null);
    if (labelled) next = next.filter(t => !(t.from === from && t.to === to && t.event === null && t.id !== keepId));
    return { trs: next, say };
  }
  function apply(intent: Intent) {
    const trs = model.trs;
    if (intent.kind === "arrow") {
      const { from, to } = intent;
      if (trs.some(t => t.from === from && t.to === to)) { setStatus(`${L(from)} already has an arrow to ${L(to)}. Drop an event on it.`); return; }
      commit({ ...model, trs: [...trs, { id: newId(), event: null, from, to }] }, from === to ? `Loop drawn on ${L(from)}. Drop an event on it.` : `Arrow drawn from ${L(from)} to ${L(to)}. Drop an event on it.`);
      setNote({ text: "Now drop an event from the shelf onto the new arrow.", tone: "plain" });
      return;
    }
    if (intent.kind === "label" || intent.kind === "chipArrow") {
      const gr = groups.find(x => x.key === intent.key); if (!gr) return;
      const t = intent.kind === "chipArrow" ? trs.find(x => x.id === intent.tid) : undefined;
      const event = intent.kind === "label" ? intent.event : t?.event;
      if (event === undefined) return;
      if (event === null) {
        /* Dragging a "?" onto another arrow just removes the placeholder. */
        commit({ ...model, trs: trs.filter(x => x.id !== t!.id) }, "Empty arrow removed."); return;
      }
      if (gr.trs.some(x => x.event === event && x.id !== t?.id)) { setStatus(`That arrow already carries ${E(event)}.`); return; }
      const out = addTransition(trs, gr.from, event, gr.to, t?.id);
      if (typeof out === "string") { setStatus(out); setNote({ text: out, tone: "warn" }); return; }
      commit({ ...model, trs: out.trs }, out.say); setNote(undefined); return;
    }
    if (intent.kind === "chipState") {
      const t = trs.find(x => x.id === intent.tid); if (!t || t.to === intent.to) return;
      if (t.event === null) {
        if (trs.some(x => x.from === t.from && x.to === intent.to)) { commit({ ...model, trs: trs.filter(x => x.id !== t.id) }, "Empty arrow removed."); return; }
        commit({ ...model, trs: trs.map(x => (x.id === t.id ? { ...x, to: intent.to } : x)) }, `Arrow now goes from ${L(t.from)} to ${L(intent.to)}.`); return;
      }
      const out = addTransition(trs, t.from, t.event, intent.to, t.id);
      if (typeof out === "string") { setStatus(out); return; }
      commit({ ...model, trs: out.trs }, `${E(t.event)} from ${L(t.from)} now goes to ${L(intent.to)}.`); setNote(undefined); return;
    }
    if (intent.kind === "chipShelf") {
      const t = trs.find(x => x.id === intent.tid); if (!t) return;
      commit({ ...model, trs: trs.filter(x => x.id !== t.id) }, t.event ? `Removed ${E(t.event)} from ${L(t.from)} → ${L(t.to)}.` : "Empty arrow removed.");
      return;
    }
    if (intent.kind === "step") stepTo(intent.to);
  }

  /* ---------- Trace stepping ---------- */
  function stepTo(choice: string) {
    if (r.mode !== "trace" || traceDone) return;
    const ev = traceInput[trace.si];
    const t = findTr(model.trs, trace.cur, ev);
    const want = t ? t.to : "stuck";
    if (choice !== want) {
      const prior = trace.mistakes.filter(m => m.ti === trace.ti && m.si === trace.si).length;
      setTrace(tr => ({ ...tr, mistakes: [...tr.mistakes, { ti: tr.ti, si: tr.si, from: tr.cur, event: ev, chose: choice, want }] }));
      const why = t ? r.answer.find(a => a.from === t.from && a.event === ev)?.why : undefined;
      const text = want === "stuck"
        ? `No ${E(ev)} arrow leaves ${L(trace.cur)}, so the machine can’t move: it is stuck. Press “No ${E(ev)} arrow”.`
        : choice === "stuck"
          ? `There is a ${E(ev)} arrow out of ${L(trace.cur)}. Follow it.`
          : prior === 0
            ? `Not ${L(choice)}. From ${L(trace.cur)}, follow the arrow labelled ${E(ev)}.`
            : `From ${L(trace.cur)}, ${E(ev)} leads to ${L(want)}, not ${L(choice)}.${why ? ` ${why}` : ""}`;
      setNote({ text, tone: "warn" }); setStatus(text); setRemount(k => k + 1); setEdits(e => e + 1); onChange?.(); setShared(false);
      return;
    }
    const si = trace.si + 1;
    const cur = want === "stuck" ? trace.cur : want;
    const finished = want === "stuck" || si >= traceInput.length;
    const ends = [...trace.ends];
    if (finished) ends[trace.ti] = want === "stuck" ? "stuck" : cur;
    setTrace(tr => ({ ...tr, si, cur, ends }));
    setPickStep(cur);
    setShared(false); setEdits(e => e + 1); onChange?.();
    const tr = r.traces[trace.ti];
    if (finished) {
      const where = want === "stuck" ? `gets stuck at ${L(cur)}` : `ends at ${L(cur)}`;
      const mistakesHere = trace.mistakes.filter(m => m.ti === trace.ti).length;
      const text = `“${tr.label}” ${where}.${tr.note ? ` ${tr.note}` : ""}${mistakesHere ? ` (${plural(mistakesHere, "wrong move")} on the way.)` : ""}`;
      setNote({ text, tone: mistakesHere ? "warn" : "good" }); setStatus(text);
    } else {
      setNote(undefined); setStatus(`${E(ev)}: moved to ${L(cur)}.`);
    }
  }
  function nextTrace() {
    const ti = trace.ends.findIndex((e, i) => i > trace.ti && e === undefined);
    const next = ti >= 0 ? ti : r.traces.findIndex((_, i) => trace.ends[i] === undefined);
    if (next < 0) return;
    setTrace(tr => ({ ...tr, ti: next, si: 0, cur: r.start }));
    setPickStep(r.start); setNote(undefined); setStatus(`Input ${next + 1}: ${r.traces[next].label}.`);
  }

  /* ---------- Check ---------- */
  function runCheck() {
    const diff = diffMachine(model.trs, r.answer);
    const runs = r.traces.map(t => runInput(model.trs, r.start, t.input));
    const ok = diffOk(diff) && runs.every((x, i) => endOf(x) === r.traces[i].expect);
    const failing = runs.findIndex((x, i) => endOf(x) !== r.traces[i].expect);
    setCheck({ diff, runs, ok });
    setFocusRun(failing >= 0 ? failing : 0);
    setReplay(reduced ? Infinity : 0);
    setNote(undefined);
    setStatus(ok ? "The machine works." : "Checked. See the feedback below the canvas.");
  }

  function undo() {
    const prev = history[history.length - 1]; if (!prev) return;
    setHistory(h => h.slice(0, -1));
    setModel({ ...prev, geo: model.geo, pos: model.pos });
    setCheck(undefined); setReplay(Infinity); setNote(undefined); setStatus("Undone."); onChange?.();
  }
  function startOver() {
    setHistory([]); setModel(fresh(model.geo.W)); setCheck(undefined); setReplay(Infinity); setNote(undefined); setShared(false);
    setTrace({ ti: 0, si: 0, cur: r.start, ends: [], mistakes: [] }); setPickStep(r.start);
    setStatus("Started over."); setEdits(0); onChange?.();
  }
  function tidy() {
    const { pos, geo } = layout(r, model.trs, model.geo.W);
    setModel(m => ({ ...m, pos, geo, moved: false })); setRemount(k => k + 1); setStatus("Laid out from the arrows.");
  }

  /* ---------- Drop handling ---------- */
  const dstate = useMemo<DState>(() => ({ pos: model.pos }), [model.pos]);
  function onDrop(s: DState) {
    setDragging(false); setPreview(undefined);
    if (s.intent) { apply(s.intent); setRemount(k => k + 1); return; }
    const movedId = Object.keys(s.pos).find(id => s.pos[id].x !== model.pos[id].x || s.pos[id].y !== model.pos[id].y);
    if (movedId) { setModel(m => ({ ...m, pos: s.pos, moved: true })); setStatus(`Moved ${L(movedId)}.`); }
  }

  /* ---------- The draggable picture ---------- */
  const editable = r.mode !== "trace";
  const draggable: Draggable<DState> = useCallback(({ state, d, draggedId }) => {
    const id = (s: string) => `sm${uid}-${s}`;
    const pos = state.pos;
    const routes = routeAll(groups, pos, g);
    const labels = placeLabels(groups, routes, pos, g, labelOf, captioned);
    const intent = state.intent;
    const spotOf = new Map<string, { x: number; y: number; w: number; t: Tr }>();
    for (const gr of groups) for (const s of chipSpots(gr, labels.get(gr.key)!, g, labelOf)) spotOf.set(s.t.id, s);
    const labelAim = (key: string) => { const l = labels.get(key)!; return { x: l.p.x + l.w / 2 + 14, y: l.p.y }; };
    const loopAim = (sid: string) => loopAimAt(sid, pos, g, groups);
    const markerSpot = (sid: string) => ({ x: pos[sid].x - g.bw / 2 + 2, y: pos[sid].y + g.bh / 2 - 1 });
    const base: DState = { pos };
    const gap = g.compact ? 34 : 42;
    const ring = (key: string, p: P, w: number, h: number) => <g id={id(`ring-${key}`)} transform={translate(p.x, p.y)} className="sm-ring" pointerEvents="none">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={Math.min(12, h / 2)} />
    </g>;
    const edgeShape = (rt: Route, eid: string, cls: string) => <g id={eid} className={cls}>
      <path d={rt.d} className="sm-edge-halo" />
      <path d={rt.d} className="sm-edge-line" />
      <path d="M -8 -4.5 L 0 0 L -8 4.5 Z" className="sm-edge-head" transform={`${translate(rt.end.x, rt.end.y)} rotate(${rt.angle})`} />
    </g>;
    const draftRoute = (from: string, to: string) => from === to ? loopRoute("draft", from, pos, g, groups)
      : routeOne("draft", from, to, pos, g, Object.entries(pos).filter(([k]) => k !== from && k !== to).map(([, p]) => nodeBox(p, g)), [], model.trs.some(t => t.from === to && t.to === from));

    /* Overlays that differ per drop candidate carry ids unique to that candidate. */
    let overlay: ReactElement | null = null;
    if (intent?.kind === "arrow" || intent?.kind === "chipState") {
      const from = intent.kind === "arrow" ? intent.from : model.trs.find(t => t.id === intent.tid)!.from;
      const to = intent.to;
      const exists = groups.find(gr => gr.from === from && gr.to === to);
      overlay = <g id={id(`ov-${intent.kind}-${r.si.get(from)}-${r.si.get(to)}`)}>
        {exists ? edgeShape(routes.get(exists.key)!, id(`hl-${exists.key}-${intent.kind}`), "sm-edge sm-edge-hl")
          : edgeShape(draftRoute(from, to), id(`draft-${r.si.get(from)}-${r.si.get(to)}-${intent.kind}`), "sm-edge sm-edge-draft")}
        {ring(`n${r.si.get(to)}-${intent.kind}`, pos[to], g.bw + 12, g.bh + 12)}
      </g>;
    } else if (intent?.kind === "label" || intent?.kind === "chipArrow") {
      const gr = groups.find(x => x.key === intent.key)!;
      const l = labels.get(gr.key)!;
      overlay = <g id={id(`ov-${intent.kind}-${gr.key}`)}>
        {edgeShape(routes.get(gr.key)!, id(`hl-${gr.key}-${intent.kind}`), "sm-edge sm-edge-hl")}
        {ring(`l${gr.key}-${intent.kind}`, { x: l.p.x + 7, y: l.p.y }, l.w + 46, g.chipH + 10)}
      </g>;
    } else if (intent?.kind === "chipShelf") {
      const t = model.trs.find(x => x.id === intent.tid)!;
      const item = shelf.items.find(i => i.id === t.event) ?? shelf.items[0];
      overlay = <g id={id("ov-shelf")}>{ring("shelf", { x: item.x, y: item.y }, item.w + 14, shelf.chipH + 10)}</g>;
    } else if (intent?.kind === "step") {
      const exists = groups.find(gr => gr.from === trace.cur && gr.to === intent.to);
      overlay = <g id={id(`ov-step-${r.si.get(intent.to)}`)}>
        {exists && edgeShape(routes.get(exists.key)!, id(`hl-${exists.key}-step`), "sm-edge sm-edge-hl")}
        {ring(`n${r.si.get(intent.to)}-step`, pos[intent.to], g.bw + 12, g.bh + 12)}
      </g>;
    }

    /* Edges */
    const edgeLayer = groups.map(gr => {
      const rt = routes.get(gr.key)!;
      const anyBad = gr.trs.some(t => badIds.has(t.id));
      const anyVisited = gr.trs.some(t => visited.has(t.id));
      const empty = gr.trs.every(t => t.event === null);
      return edgeShape(rt, id(`e-${gr.key}`), `sm-edge${anyBad ? " is-bad" : ""}${activeRun ? (anyVisited ? " is-visited" : anyBad ? "" : " is-dim") : ""}${empty ? " is-empty" : ""}`);
    });

    /* Nodes */
    const nodeLayer = r.states.map((s, i) => {
      const p = pos[s.id];
      const Icon = s.icon ? ICONS[s.icon] : undefined;
      const iconRoom = Icon ? (g.compact ? 20 : 23) : 0;
      const { lines, fs } = nodeLines(s.label, g.bw, !!Icon, g.compact);
      const isCur = r.mode === "trace" ? trace.cur === s.id : runnerAt === s.id;
      const cls = ["sm-node", s.kind ? `is-${s.kind}` : "",
        isCur ? "is-current" : "", runFailedAt === s.id ? "is-issue" : "",
        check?.ok && runDone && r.goals.has(s.id) ? "is-verified" : ""].filter(Boolean).join(" ");
      const tx = -g.bw / 2 + 8 + iconRoom;
      const lh = fs + 2;
      return <g id={id(`n${i}`)} transform={translate(p.x, p.y)} className={cls} data-sm-state={s.id}>
        <rect x={-g.bw / 2} y={-g.bh / 2} width={g.bw} height={g.bh} rx={11} className="sm-node-face" />
        {s.kind === "goal" && <rect x={-g.bw / 2 + 3.5} y={-g.bh / 2 + 3.5} width={g.bw - 7} height={g.bh - 7} rx={8} className="sm-node-inner" />}
        {Icon && <Icon x={-g.bw / 2 + 7} y={-8} width={g.compact ? 15 : 17} height={g.compact ? 15 : 17} strokeWidth={1.9} className="sm-node-icon" />}
        {lines.map((line, li) => <text dragologyKey={`line${li}`} className="sm-node-text" x={tx} y={(li - (lines.length - 1) / 2) * lh} dominantBaseline="central" fontSize={fs}>{line}</text>)}
        {s.kind && s.kind !== "goal" ? <text dragologyKey="kind" className="sm-node-kind" x={-g.bw / 2 + 2} y={-g.bh / 2 - 7}>{s.kind}</text>
          : s.kind === "goal" ? <text dragologyKey="kind" className="sm-node-kind" x={-g.bw / 2 + 2} y={-g.bh / 2 - 7}>goal</text> : null}
        {s.kind === "start" && (g.compact
          ? <path d={`M ${-g.bw / 2 - 16} 0 L ${-g.bw / 2 - 3} 0 M ${-g.bw / 2 - 8} -4 L ${-g.bw / 2 - 3} 0 L ${-g.bw / 2 - 8} 4`} className="sm-start-stub" />
          : <path d={`M ${-g.bw / 2 - 20} 0 L ${-g.bw / 2 - 3} 0 M ${-g.bw / 2 - 9} -5 L ${-g.bw / 2 - 3} 0 L ${-g.bw / 2 - 9} 5`} className="sm-start-stub" />)}
        {check?.ok && runDone && r.goals.has(s.id) && <g dragologyKey="badge-ok" transform={translate(g.bw / 2 - 3, -g.bh / 2)} className="sm-badge is-ok"><circle r={8} /><path d="M -3.5 0 L -1 2.6 L 3.8 -2.6" /></g>}
        {runFailedAt === s.id && <g dragologyKey="badge-issue" transform={translate(g.bw / 2 - 3, -g.bh / 2)} className="sm-badge is-issue"><circle r={8} /><path d="M -3 -3 L 3 3 M 3 -3 L -3 3" /></g>}
      </g>;
    });

    /* Grab layers: drag a state onto another to draw an arrow, into space to move it. */
    const grabLayer = r.states.map((s, i) => {
      const gid = id(`grab${i}`);
      let at = pos[s.id];
      if (intent?.kind === "arrow" && intent.from === s.id) at = intent.to === s.id ? loopAim(s.id) : pos[intent.to];
      const move = d.vary(base, [param<DState>("pos", s.id, "x"), param<DState>("pos", s.id, "y")], {
        constraint: (st: DState) => [g.min.x - st.pos[s.id].x, st.pos[s.id].x - g.max.x, g.min.y - st.pos[s.id].y, st.pos[s.id].y - g.max.y],
      });
      return <g id={gid} transform={translate(at.x, at.y)} className={`sm-grab${editable ? " is-wire" : ""}`} data-sm-grab={s.id}
        dragologyZIndex={draggedId === gid ? "/1" : false}
        dragologyOnDrag={() => editable
          ? d.closest(r.states.map(t => ({ pos, intent: { kind: "arrow" as const, from: s.id, to: t.id } }))).withFloating().whenFar(move, { gap }).withDropTransition(false)
          : move}>
        <rect x={-g.bw / 2} y={-g.bh / 2} width={g.bw} height={g.bh} rx={11} />
      </g>;
    });

    /* Event chips on the arrows */
    const chipLayer = groups.flatMap(gr => chipSpots(gr, labels.get(gr.key)!, g, labelOf).map(({ t, x, y, w }) => {
      const cid = id(`c${t.id}`);
      let at: P = { x, y };
      if (intent && "tid" in intent && intent.tid === t.id) {
        if (intent.kind === "chipArrow") at = labelAim(intent.key);
        else if (intent.kind === "chipState") at = pos[intent.to];
        else if (intent.kind === "chipShelf") { const it = shelf.items.find(i => i.id === t.event) ?? shelf.items[0]; at = { x: it.x, y: it.y }; }
      }
      const movable = editable && !t.locked;
      const tone = t.event === null ? "none" : String(r.ei.get(t.event)! % 8);
      const stepNo = activeRun ? replaySteps.findIndex(st => st.tid === t.id) + 1 : 0;
      const cls = `sm-chip sm-etone-${tone}${t.event === null ? " is-empty" : ""}${t.locked && r.mode === "build" ? " is-given" : ""}${movable ? " is-grab" : ""}${badIds.has(t.id) ? " is-bad" : ""}${activeRun ? (stepNo ? " is-visited" : badIds.has(t.id) ? "" : " is-dim") : ""}`;
      const h = g.chipH;
      return <g id={cid} transform={translate(at.x, at.y)} className={cls} data-sm-chip={trByKey(t)}
        dragologyZIndex={draggedId === cid ? "/2" : 1}
        {...(movable ? {
          dragologyOnDrag: () => d.closest([
            ...groups.filter(o => o.key !== gr.key).map(o => ({ pos, intent: { kind: "chipArrow" as const, tid: t.id, key: o.key } })),
            ...r.states.filter(st => st.id !== t.to).map(st => ({ pos, intent: { kind: "chipState" as const, tid: t.id, to: st.id } })),
            { pos, intent: { kind: "chipShelf" as const, tid: t.id } },
          ]).withFloating().whenFar(base, { gap: gap + 4 }).withDropTransition(false),
        } : {})}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} className="sm-chip-face" />
        <text className="sm-chip-text" textAnchor="middle" dominantBaseline="central" y={0.5} fontSize={g.fs}>{t.event === null ? "?" : E(t.event)}</text>
        {stepNo > 0 && <g transform={translate(-w / 2, -h / 2 + 1)} className="sm-step"><circle r={7.5} /><text textAnchor="middle" dominantBaseline="central" y={0.5}>{stepNo}</text></g>}
      </g>;
    }));

    /* Shelf (build/fix) or input tape (trace) at the top of the canvas */
    let top: ReactElement;
    if (r.mode === "trace") {
      const cells = traceInput.map((ev, i) => ({ ev, w: chipW(E(ev), g) }));
      let x = 10;
      top = <g id={id("tape")}>
        <text className="sm-shelf-caption" x={10} y={11}>{`Input ${trace.ti + 1} of ${r.traces.length}`}</text>
        {cells.map((c, i) => {
          const cx = x + c.w / 2; x += c.w + 5;
          const state = i < trace.si ? " is-read" : i === trace.si && !traceDone ? " is-now" : "";
          return <g id={id(`tape${i}`)} transform={translate(cx, 31)} className={`sm-chip sm-etone-${r.ei.get(c.ev)! % 8} sm-tape${state}`}>
            <rect x={-c.w / 2} y={-g.chipH / 2} width={c.w} height={g.chipH} rx={g.chipH / 2} className="sm-chip-face" />
            <text className="sm-chip-text" textAnchor="middle" dominantBaseline="central" y={0.5} fontSize={g.fs}>{E(c.ev)}</text>
          </g>;
        })}
        <path d={`M 8 ${shelf.h - 2} H ${g.W - 8}`} className="sm-shelf-line" />
      </g>;
    } else {
      top = <g id={id("shelf")}>
        <path d={`M 8 ${shelf.h - 4} H ${g.W - 8}`} className="sm-shelf-line" />
        {shelf.items.map((it, i) => {
          const kid = id(`k${i}`);
          const at = intent?.kind === "label" && intent.event === it.id ? labelAim(intent.key) : { x: it.x, y: it.y };
          return <g id={kid} transform={translate(at.x, at.y)} className={`sm-token sm-chip sm-etone-${i % 8}`} data-sm-token={it.id}
            dragologyZIndex={draggedId === kid ? "/2" : 1}
            dragologyOnDrag={() => groups.length
              ? d.closest(groups.map(gr => ({ pos, intent: { kind: "label" as const, event: it.id, key: gr.key } }))).withFloating().whenFar(base, { gap: gap + 4 }).withDropTransition(false)
              : d.fixed(base)}>
            <rect x={-it.w / 2} y={-shelf.chipH / 2} width={it.w} height={shelf.chipH} rx={shelf.chipH / 2} className="sm-chip-face" />
            <text className="sm-chip-text" textAnchor="middle" dominantBaseline="central" y={0.5} fontSize={g.fs + 0.5}>{it.id && E(it.id)}</text>
          </g>;
        })}
      </g>;
    }

    /* Trace marker / run replay dot */
    let marker: ReactElement | null = null;
    if (r.mode === "trace" && !traceDone) {
      const mid = id("marker");
      const at = intent?.kind === "step" ? pos[intent.to] : markerSpot(trace.cur);
      marker = <g id={mid} transform={translate(at.x, at.y)} className="sm-marker" data-sm-marker="1"
        dragologyZIndex={draggedId === mid ? "/3" : 2}
        dragologyOnDrag={() => d.closest(r.states.map(s => ({ pos, intent: { kind: "step" as const, to: s.id } }))).withFloating().whenFar(base, { gap }).withDropTransition(false)}>
        <circle r={16} className="sm-marker-hit" />
        <circle r={10.5} className="sm-marker-dot" />
        <circle r={4} className="sm-marker-core" />
      </g>;
    } else if (activeRun && runnerAt) {
      const at = markerSpot(runnerAt);
      marker = <g id={id("runner")} transform={translate(at.x, at.y)} className="sm-marker is-runner" pointerEvents="none">
        <circle r={8.5} className="sm-marker-dot" /><circle r={3.4} className="sm-marker-core" />
      </g>;
    }

    return <g>
      {top}
      <g id={id("edges")}>{edgeLayer}</g>
      <g id={id("nodes")}>{nodeLayer}</g>
      {overlay}
      <g id={id("grabs")}>{grabLayer}</g>
      <g id={id("chips")}>{chipLayer}</g>
      {marker}
    </g>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, g, groups, shelf, labelOf, badIds, replay, check, focusRun, trace, model.trs, r, editable, runFailedAt, runnerAt]);

  /* ---------- Words ---------- */
  const ansWhy = (from: string, ev: string) => r.answer.find(a => a.from === from && a.event === ev)?.why;
  const evWhy = (ev: string) => { const all = r.answer.filter(a => a.event === ev); return all.length === 1 ? all[0].why : undefined; };
  const describeIssue = (diff: Diff): string | undefined => {
    if (diff.unlabeled.length) { const t = diff.unlabeled[0]; return `The arrow from ${L(t.from)} to ${L(t.to)} has no event yet. Drop one on it, or drag its “?” back to the shelf.`; }
    if (diff.wrongTo.length) { const { t, want } = diff.wrongTo[0]; return `${E(t.event)} out of ${L(t.from)} is right, but it should lead to ${L(want.to)}, not ${L(t.to)}.${want.why ? ` ${want.why}` : ""}`; }
    if (diff.extra.length) {
      const t = diff.extra[0];
      const home = r.answer.filter(a => a.event === t.event!);
      return home.length ? `${E(t.event)} doesn’t happen at ${L(t.from)}.${evWhy(t.event!) ? ` ${evWhy(t.event!)}` : ` It belongs to ${listJoin(home.map(a => L(a.from)))}.`}` : `${L(t.from)} doesn’t respond to ${E(t.event)} in this machine.`;
    }
    if (diff.missing.length) { const a = diff.missing[0]; return `Nothing yet says what ${E(a.event)} does at ${L(a.from)}.${a.why ? ` ${a.why}` : ""}`; }
    return undefined;
  };
  const runWords = (x: Run, i: number) => {
    const tr = r.traces[i];
    const path = [L(r.start), ...x.steps.filter(s => s.to).map(s => L(s.to!))].join(" → ");
    const ok = endOf(x) === tr.expect;
    const where = x.stuck ? `stuck at ${L(x.end)} on ${E(x.steps[x.steps.length - 1].event)}` : `ends at ${L(x.end)}`;
    return { path, ok, where, expect: tr.expect === "stuck" ? "should get stuck" : `should end at ${L(tr.expect)}` };
  };
  /* Where a run first leaves the answer machine. */
  const divergence = (x: Run): { step: Step; want?: MachineTransition } | undefined => {
    const ans = r.answer;
    for (const s of x.steps) {
      const a = ans.find(t => t.from === s.from && t.event === s.event);
      if (!a && s.to) return { step: s };
      if (a && s.to !== a.to) return { step: s, want: a };
    }
    return undefined;
  };

  let instruction = "";
  let tone: "plain" | "good" | "warn" = "plain";
  if (r.mode === "build") {
    instruction = model.trs.filter(t => !t.locked).length === 0
      ? (g.compact ? "Drag a state onto the state it leads to, then drop an event from the shelf onto the arrow." : "Drag a state onto the state it leads to: that draws an arrow. Then drop an event from the shelf onto the arrow. Drag a state into open space to tidy.")
      : "Drag event chips between arrows, onto a state to re-aim them, or back to the shelf to remove them.";
  } else if (r.mode === "fix") {
    instruction = "One transition is wrong. Run the inputs to see where they go astray, then drag the wrong event chip onto the state it should lead to.";
  } else if (!traceDone) {
    const ev = traceInput[trace.si];
    instruction = `Step ${trace.si + 1} of ${traceInput.length}: read “${E(ev)}”. Drag the marker from ${L(trace.cur)} along the ${E(ev)} arrow.`;
  } else {
    instruction = trace.ends.filter(e => e !== undefined).length < r.traces.length ? "Done. Try the next input." : "All inputs done.";
  }
  if (note) { instruction = note.text; tone = note.tone; }
  let checkLines: string[] = [];
  if (check && runDone) {
    const issue = describeIssue(check.diff);
    if (check.ok) { tone = "good"; instruction = `The machine works: ${r.mode === "build" ? `all ${check.diff.total} transitions are right` : "every input ends where it should"}.${r.takeaway ? ` ${r.takeaway}` : ""}`; }
    else {
      tone = "warn";
      const fail = check.runs.findIndex((x, i) => endOf(x) !== r.traces[i].expect);
      if (r.mode === "fix" && fail >= 0) {
        const w = runWords(check.runs[fail], fail);
        const dv = divergence(check.runs[fail]);
        instruction = `“${r.traces[fail].label}” ${w.where} but ${w.expect}.${dv ? ` It goes astray at ${E(dv.step.event)} out of ${L(dv.step.from)}, which leads to ${dv.step.to ? L(dv.step.to) : "nowhere"}.` : ""}`;
      } else if (r.mode === "fix") {
        instruction = `Every input ends where it should, but ${issue ? issue.charAt(0).toLowerCase() + issue.slice(1) : "the machine still differs."}`;
      } else {
        instruction = `${check.diff.right} of ${check.diff.total} transitions are right. ${issue ?? ""}`;
      }
    }
    checkLines = check.runs.map((x, i) => { const w = runWords(x, i); return `${w.ok ? "✓" : "✗"} “${r.traces[i].label}”: ${w.where}${w.ok ? "" : `, ${w.expect}`}`; });
  } else if (check && !runDone) {
    instruction = `Running “${r.traces[focusRun]?.label}”…`;
  }

  /* Mid-drag readout */
  let dragLine = "";
  if (dragging && preview) {
    const it = preview.intent;
    if (!it) { const m = Object.keys(preview.pos).find(k => preview.pos[k].x !== model.pos[k].x || preview.pos[k].y !== model.pos[k].y); dragLine = m ? `Drop to place ${L(m)} here.` : ""; }
    else if (it.kind === "arrow") dragLine = model.trs.some(t => t.from === it.from && t.to === it.to) ? `${L(it.from)} already has an arrow to ${L(it.to)}.` : it.from === it.to ? `Drop to draw a loop on ${L(it.from)}.` : `Drop to draw an arrow ${L(it.from)} → ${L(it.to)}.`;
    else if (it.kind === "label") { const gr = groups.find(x => x.key === it.key)!; const clash = model.trs.find(t => t.from === gr.from && t.event === it.event && t.to !== gr.to); dragLine = `Drop to label ${L(gr.from)} → ${L(gr.to)} with ${E(it.event)}${clash ? ` (moves it off ${L(clash.from)} → ${L(clash.to)})` : ""}.`; }
    else if (it.kind === "chipArrow") { const gr = groups.find(x => x.key === it.key)!; const t = model.trs.find(x => x.id === it.tid)!; dragLine = `Drop to move ${E(t.event)} onto ${L(gr.from)} → ${L(gr.to)}.`; }
    else if (it.kind === "chipState") { const t = model.trs.find(x => x.id === it.tid)!; dragLine = it.to === t.from ? `Drop to make ${E(t.event)} loop on ${L(t.from)}.` : `Drop to send ${E(t.event)} from ${L(t.from)} to ${L(it.to)}.`; }
    else if (it.kind === "chipShelf") { const t = model.trs.find(x => x.id === it.tid)!; dragLine = `Drop to remove ${E(t.event)} from ${L(t.from)} → ${L(t.to)}.`; }
    else if (it.kind === "step") dragLine = `Drop to move the marker to ${L(it.to)}.`;
  }

  /* ---------- Share ---------- */
  const transitionText = (trs: Tr[]) => trs.filter(t => t.event).map(t => `${L(t.from)} -${E(t.event)}→ ${L(t.to)}`).join("; ") || "none";
  let share: ShareSummary | undefined;
  if (r.mode === "build" && edits > 0) {
    const diff = check?.diff ?? diffMachine(model.trs, r.answer);
    const ok = diffOk(diff);
    const issue = describeIssue(diff);
    const wrongNames = [...diff.wrongTo.map(w => `${E(w.t.event)} out of ${L(w.t.from)}`), ...diff.extra.map(t => `${E(t.event)} at ${L(t.from)}`)];
    share = {
      learner: ok ? `My machine works: all ${diff.total} transitions are right, and it reaches ${listJoin([...r.goals].map(L))}.`
        : `I have ${diff.right} of ${diff.total} transitions right so far${wrongNames.length ? `; I’m not sure about ${listJoin(wrongNames)}` : ""}.`,
      data: `transitions: ${transitionText(model.trs)}; right ${diff.right}/${diff.total}; wrong ${wrongNames.join(", ") || "none"}; missing ${diff.missing.map(a => `${E(a.event)} at ${L(a.from)}`).join(", ") || "none"}${check ? `; runs ${check.runs.map((x, i) => `${r.traces[i].label} → ${endOf(x) === "stuck" ? "stuck" : L(x.end)}`).join(", ")}` : ""}`,
      reply: ok ? `Yes, that’s the machine. ${r.takeaway ?? ""}`.trim()
        : `${diff.right ? `Good start: ${plural(diff.right, "transition")} ${diff.right === 1 ? "is" : "are"} right.` : "Let’s look at one transition at a time."} ${issue ?? ""} ${diff.missing.length > 1 ? `After that, ${plural(diff.missing.length - (diff.missing.length && !diff.wrongTo.length && !diff.extra.length && !diff.unlabeled.length ? 1 : 0), "transition")} still to draw.` : ""}`.replace(/\s+/g, " ").trim(),
    };
  } else if (r.mode === "fix" && edits > 0) {
    const initial = seed(r.given, false, "g");
    const key = (t: Tr) => `${t.from} ${t.event} ${t.to}`;
    const nowKeys = new Set(model.trs.filter(t => t.event).map(key));
    const before = new Set(initial.map(key));
    const removed = initial.filter(t => !nowKeys.has(key(t)));
    const added = model.trs.filter(t => t.event && !before.has(key(t)));
    const diff = diffMachine(model.trs, r.answer);
    const runs = r.traces.map(t => runInput(model.trs, r.start, t.input));
    const passing = runs.filter((x, i) => endOf(x) === r.traces[i].expect).length;
    const changes = [...added.map(t => `${E(t.event)} out of ${L(t.from)} now goes to ${L(t.to)}`), ...removed.filter(t => !added.some(a => a.from === t.from && a.event === t.event)).map(t => `removed ${E(t.event)} out of ${L(t.from)}`)];
    const ok = diffOk(diff);
    const fixedWrong = r.given.filter(gv => !r.answer.some(a => a.from === gv.from && a.event === gv.event && a.to === gv.to));
    const firstWrong = fixedWrong[0];
    share = {
      learner: changes.length ? `I changed it so ${listJoin(changes)}. ${passing} of ${runs.length} inputs now end where they should.` : `I haven’t changed anything yet; ${passing} of ${runs.length} inputs end where they should.`,
      data: `changes: ${changes.join("; ") || "none"}; machine: ${transitionText(model.trs)}; runs ${runs.map((x, i) => `${r.traces[i].label} → ${endOf(x) === "stuck" ? "stuck" : L(x.end)} (${endOf(x) === r.traces[i].expect ? "ok" : "wrong"})`).join(", ")}`,
      reply: ok ? `That’s the fix. ${firstWrong ? `${E(firstWrong.event)} out of ${L(firstWrong.from)} was going to ${L(firstWrong.to)}. ${ansWhy(firstWrong.from, firstWrong.event) ?? ""}` : ""} ${r.takeaway ?? ""}`.replace(/\s+/g, " ").trim()
        : `${passing === runs.length ? "Every input now ends where it should, but the machine isn’t quite the intended one." : `Not yet: ${runs.length - passing} of ${runs.length} inputs still go wrong.`} ${describeIssue(diff) ?? ""}`.replace(/\s+/g, " ").trim(),
    };
  } else if (r.mode === "trace" && edits > 0) {
    const doneIdx = r.traces.map((_, i) => i).filter(i => trace.ends[i] !== undefined);
    const ms = trace.mistakes;
    const firstM = ms[0];
    const cur = r.traces[trace.ti];
    share = {
      learner: doneIdx.length
        ? `I stepped ${listJoin(doneIdx.map(i => `“${r.traces[i].label}”`))} through the machine: ${listJoin(doneIdx.map(i => `${r.traces[i].label} ${trace.ends[i] === "stuck" ? "got stuck" : `ended at ${L(trace.ends[i]!)}`}`))}${ms.length ? `, with ${plural(ms.length, "wrong move")}` : ""}.`
        : `I’m ${trace.si} steps into “${cur.label}”, at ${L(trace.cur)}${ms.length ? `, after ${plural(ms.length, "wrong move")}` : ""}.`,
      data: `traces: ${r.traces.map((t, i) => `${t.label} → ${trace.ends[i] === undefined ? (i === trace.ti ? `at ${L(trace.cur)} after ${trace.si}` : "not tried") : trace.ends[i] === "stuck" ? "stuck" : L(trace.ends[i]!)}`).join(", ")}; mistakes: ${ms.map(m => `“${r.traces[m.ti].label}” step ${m.si + 1}: chose ${m.chose === "stuck" ? "stuck" : L(m.chose)} for ${E(m.event)} at ${L(m.from)} (right: ${m.want === "stuck" ? "stuck" : L(m.want)})`).join("; ") || "none"}`,
      reply: firstM
        ? `Look again at step ${firstM.si + 1} of “${r.traces[firstM.ti].label}”: you were at ${L(firstM.from)} and read ${E(firstM.event)}. ${firstM.want === "stuck" ? `There’s no ${E(firstM.event)} arrow there, so the machine is stuck.` : `The ${E(firstM.event)} arrow from ${L(firstM.from)} goes to ${L(firstM.want)}${firstM.chose !== "stuck" ? `, not ${L(firstM.chose)}` : ""}.`} ${ansWhy(firstM.from, firstM.event) ?? ""} ${r.traces[firstM.ti].note ?? ""}`.replace(/\s+/g, " ").trim()
        : `Every step right. ${doneIdx.map(i => r.traces[i].note).filter(Boolean).join(" ")} ${r.takeaway ?? ""}`.replace(/\s+/g, " ").trim(),
    };
  }

  /* ---------- Test hook ---------- */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingStateMachine?: unknown };
    host.keatingStateMachine = Object.freeze({
      snapshot: () => ({
        mode: r.mode, transitions: model.trs.map(t => ({ event: t.event, from: t.from, to: t.to, locked: !!t.locked })),
        pos: model.pos, width: g.W, height: g.H, compact: g.compact,
        check: check ? { ok: check.ok, right: check.diff.right, total: check.diff.total, runs: check.runs.map(endOf), replay, steps: activeRun?.steps.length ?? 0 } : null,
        trace: { ...trace }, share: share ?? null,
      }),
      handles: () => {
        const box = wrap.current!.querySelector("svg")!.getBoundingClientRect();
        const at = (p: P) => ({ x: box.x + p.x, y: box.y + p.y });
        const routes = routeAll(groups, model.pos, g);
        const labels = placeLabels(groups, routes, model.pos, g, labelOf, captioned);
        const chips: Record<string, P> = {};
        for (const gr of groups) for (const s of chipSpots(gr, labels.get(gr.key)!, g, labelOf)) chips[trByKey(s.t)] = at({ x: s.x, y: s.y });
        return {
          state: Object.fromEntries(Object.entries(model.pos).map(([k, p]) => [k, at(p)])),
          loop: Object.fromEntries(Object.keys(model.pos).map(k => [k, at(loopAimAt(k, model.pos, g, groups))])),
          label: Object.fromEntries(groups.map(gr => { const l = labels.get(gr.key)!; return [`${gr.from}>${gr.to}`, at({ x: l.p.x + l.w / 2 + 14, y: l.p.y })]; })),
          token: Object.fromEntries(shelf.items.map(i => [i.id, at(i)])),
          chips,
          marker: at({ x: model.pos[trace.cur].x - g.bw / 2 + 2, y: model.pos[trace.cur].y + g.bh / 2 - 1 }),
          canvas: { x: box.x, y: box.y, w: box.width, h: box.height },
        };
      },
    });
    return () => { delete host.keatingStateMachine; };
  });

  /* ---------- Render ---------- */
  const learnerTrs = model.trs;
  const done = r.mode === "trace" ? trace.ends.filter(e => e !== undefined).length : 0;
  const count = r.mode === "build" ? `${model.trs.filter(t => t.event).length} of ${r.answer.length} transitions placed`
    : r.mode === "fix" ? `${r.traces.length} inputs to check` : `${done} of ${r.traces.length} inputs`;
  const stuckPossible = r.mode === "trace" && r.traces.some(t => t.expect === "stuck");
  return <section className={`activity sm-lab is-${r.mode}`} data-simulation="state-machine" aria-labelledby={`sm${uid}-title`}>
    <div className="sm-header">
      <h3 id={`sm${uid}-title`}>{r.title}</h3>
      <span className="sm-count">{count}</span>
    </div>
    {r.assumes && <p className="sm-assumes">{r.assumes}</p>}
    <div className={`sm-canvas${dragging ? " is-dragging" : ""}`} ref={wrap} aria-hidden="true"
      onClick={() => { if (activeRun && !runDone) setReplay(Infinity); }}>
      {mounted ? <DraggableRenderer key={remount} draggable={draggable} state={dstate} width={g.W} height={g.H}
        onDropState={onDrop}
        onDragState={s => setPreview(s)}
        onDragStatus={st => { const on = st.type === "dragging"; setDragging(x => (x === on ? x : on)); if (!on) setPreview(p => (p ? undefined : p)); }} />
        : <svg width={g.W} height={g.H} className="sm-ssr-well" />}
      <p className="sm-dragline">{dragLine}</p>
    </div>
    <p className={`sm-instruction is-${tone}`} aria-live="polite">{instruction}</p>
    {(r.mode !== "build" || check) && r.traces.length > 0 && (r.mode === "trace" || check) && <ul className="sm-runs" aria-label="Inputs">
      {r.traces.map((t, i) => {
        if (r.mode === "trace") {
          const end = trace.ends[i];
          const ms = trace.mistakes.filter(m => m.ti === i).length;
          return <li key={i} className={i === trace.ti ? "is-now" : ""}>
            <span className="sm-run-input">{t.label}</span>
            <span className="sm-run-out">{end === undefined ? (i === trace.ti ? `at ${L(trace.cur)}` : "not yet") : end === "stuck" ? "stuck" : `ends at ${L(end)}`}{ms ? ` · ${plural(ms, "slip")}` : ""}</span>
          </li>;
        }
        if (!check || !runDone) return null;
        const w = runWords(check.runs[i], i);
        return <li key={i} className={`${w.ok ? "is-ok" : "is-bad"}${i === focusRun ? " is-now" : ""}`}>
          <button type="button" className="sm-run-btn" aria-pressed={i === focusRun} onClick={() => { setFocusRun(i); setReplay(reduced ? Infinity : 0); }}>
            <span className="sm-run-mark" aria-hidden="true">{w.ok ? "✓" : "✗"}</span>
            <span className="sm-run-input">{t.label}</span>
            <span className="sm-run-out">{w.where}{w.ok ? "" : `; ${w.expect}`}</span>
          </button>
        </li>;
      })}
    </ul>}
    <details className="receipt sm-controls">
      <summary>Use buttons instead</summary>
      {r.mode === "trace" ? <div className="sm-control-rows">
        <div className="sm-control-row">
          <label className="sm-select">Move marker to
            <select value={pickStep} onChange={e => setPickStep(e.currentTarget.value)}>{r.states.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <button type="button" className="sm-chip-btn" disabled={traceDone} onClick={() => stepTo(pickStep)}>Step</button>
        </div>
      </div> : <div className="sm-control-rows">
        <div className="sm-control-row">
          <label className="sm-select">From<select aria-label="From state" value={pickFrom} onChange={e => setPickFrom(e.currentTarget.value)}>{r.states.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="sm-select">on<select aria-label="Event" value={pickEvent} onChange={e => setPickEvent(e.currentTarget.value)}>{r.events.map(ev => <option key={ev.id} value={ev.id}>{ev.label}</option>)}</select></label>
          <label className="sm-select">to<select aria-label="To state" value={pickTo} onChange={e => setPickTo(e.currentTarget.value)}>{r.states.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <button type="button" className="sm-chip-btn" onClick={() => {
            const out = addTransition(model.trs, pickFrom, pickEvent, pickTo);
            if (typeof out === "string") { setStatus(out); setNote({ text: out, tone: "warn" }); return; }
            commit({ ...model, trs: out.trs }, out.say); setRemount(k => k + 1); setNote(undefined);
          }}>Add transition</button>
        </div>
        {learnerTrs.length > 0 && <ul className="sm-list" aria-label="Current transitions">
          {learnerTrs.map(t => <li key={t.id}>
            <span>{L(t.from)} <span aria-hidden="true">—</span><strong>{E(t.event)}</strong><span aria-hidden="true">→</span><span className="learning-lab__sr-only">to</span> {L(t.to)}{t.locked && r.mode === "build" ? <span className="sm-given"> · given</span> : null}</span>
            {!(t.locked && r.mode === "build") && <button type="button" className="quiet sm-remove" aria-label={`Remove ${E(t.event)} from ${L(t.from)} to ${L(t.to)}`} onClick={() => { commit({ ...model, trs: model.trs.filter(x => x.id !== t.id) }, `Removed ${E(t.event)} from ${L(t.from)} → ${L(t.to)}.`); setRemount(k => k + 1); }}>Remove</button>}
          </li>)}
        </ul>}
      </div>}
    </details>
    <span className="learning-lab__sr-only" role="status">{status}</span>
    <div className="actions sm-actions">
      {r.mode !== "trace" && <button type="button" className="primary" onClick={runCheck}>{r.mode === "fix" ? "Run the inputs" : "Run and check"}</button>}
      {r.mode === "trace" && traceDone && done < r.traces.length && <button type="button" className="primary" onClick={nextTrace}>Next input</button>}
      {r.mode === "trace" && stuckPossible && !traceDone && <button type="button" className="quiet" onClick={() => stepTo("stuck")}>No {E(traceInput[trace.si])} arrow</button>}
      {activeRun && !runDone && <button type="button" className="quiet" onClick={() => setReplay(Infinity)}>Skip</button>}
      {share && <button type="button" className={check?.ok || (r.mode === "trace" && done === r.traces.length) ? "primary" : "quiet"} disabled={shared} onClick={() => { setShared(true); onShare?.(share!); }}>{shared ? "Shared" : "Share with Keating"}</button>}
      {history.length > 0 && r.mode !== "trace" && <button type="button" className="quiet" onClick={undo}>Undo</button>}
      {model.moved && <button type="button" className="quiet" onClick={tidy}>Tidy layout</button>}
      {(edits > 0 || history.length > 0) && <button type="button" className="quiet" onClick={startOver}>Start over</button>}
    </div>
    {check && runDone && checkLines.length > 0 && <span className="learning-lab__sr-only">{checkLines.join(". ")}</span>}
  </section>;
}

/* ---------- Presets ---------- */
export const presets: Record<string, StateMachineConfig> = {
  https: {
    title: "Build the HTTPS page-load machine",
    mode: "build",
    states: [
      { id: "opened", label: "Link opened", kind: "start", icon: "link" },
      { id: "secure", label: "TLS established", icon: "lock" },
      { id: "resolving", label: "Waiting for DNS", icon: "search" },
      { id: "waiting", label: "Waiting for page", icon: "hourglass" },
      { id: "address", label: "Address known", icon: "pin" },
      { id: "received", label: "Page received", kind: "goal", icon: "file" },
    ],
    events: [
      { id: "request", label: "HTTP request" },
      { id: "answer", label: "DNS answer" },
      { id: "response", label: "HTTP response" },
      { id: "query", label: "DNS query" },
      { id: "tls", label: "TLS handshake" },
    ],
    answer: [
      { event: "query", from: "opened", to: "resolving", why: "The browser starts with a hostname, so it asks DNS for an address and waits for the answer." },
      { event: "answer", from: "resolving", to: "address", why: "The DNS answer supplies the server’s address. Nothing is encrypted yet." },
      { event: "tls", from: "address", to: "secure", why: "Once the address is known the browser can connect and run the TLS handshake." },
      { event: "request", from: "secure", to: "waiting", why: "The request travels over the secure connection, so it can only go after TLS is established." },
      { event: "response", from: "waiting", to: "received", why: "The server’s response is what brings the machine to Page received." },
    ],
    assumes: "Assumes a first visit over HTTP/1.1 or HTTP/2: nothing cached in DNS and no open connection to reuse.",
    takeaway: "Name first (DNS), then a private line (TLS), then the conversation (HTTP). On a fresh connection TCP opens just before TLS; this machine folds it in. A cached DNS answer or a reused connection skips steps, and HTTP/3 sets up transport and TLS together over QUIC.",
  },
  tcpHandshake: {
    title: "Build the TCP three-way handshake",
    mode: "build",
    states: [
      { id: "closed", label: "Closed", kind: "start", icon: "power" },
      { id: "synSent", label: "SYN sent", icon: "send" },
      { id: "listen", label: "Listening", icon: "inbox" },
      { id: "synRcvd", label: "SYN received", icon: "hourglass" },
      { id: "established", label: "Established", kind: "goal", icon: "handshake" },
    ],
    events: [
      { id: "open", label: "connect()" },
      { id: "passive", label: "listen()" },
      { id: "syn", label: "SYN arrives" },
      { id: "synack", label: "SYN+ACK arrives" },
      { id: "ack", label: "ACK arrives" },
    ],
    given: [{ event: "passive", from: "closed", to: "listen" }],
    answer: [
      { event: "passive", from: "closed", to: "listen", why: "A server calls listen() and waits for someone to connect." },
      { event: "open", from: "closed", to: "synSent", why: "A client calls connect(): it sends a SYN and waits for the reply." },
      { event: "syn", from: "listen", to: "synRcvd", why: "A listening server that gets a SYN answers with SYN+ACK and waits for the final ACK." },
      { event: "synack", from: "synSent", to: "established", why: "The client gets SYN+ACK, sends the last ACK, and its side is open." },
      { event: "ack", from: "synRcvd", to: "established", why: "The server gets that last ACK: three messages, both sides established." },
      { event: "syn", from: "synSent", to: "synRcvd", why: "If both sides connect at once, a SYN arrives while yours is in flight: the simultaneous open in RFC 793." },
    ],
    traces: [
      { input: ["open", "synack"], expect: "established", label: "client: connect, SYN+ACK" },
      { input: ["passive", "syn", "ack"], expect: "established", label: "server: listen, SYN, ACK" },
      { input: ["open", "syn", "ack"], expect: "established", label: "both connect at once" },
    ],
    takeaway: "Three messages because each side has to hear the other acknowledge its SYN: SYN, SYN+ACK, ACK. The same event (SYN arrives) means different things in different states.",
  },
  vendingMachine: {
    title: "Step coins through a 75¢ vending machine",
    mode: "trace",
    states: [
      { id: "none", label: "No credit", kind: "start", icon: "power" },
      { id: "c25", label: "25¢ in", icon: "coin" },
      { id: "c50", label: "50¢ in", icon: "coin" },
      { id: "ready", label: "Drink ready", kind: "goal", icon: "cup" },
    ],
    events: [
      { id: "q", label: "25¢" },
      { id: "refund", label: "Refund" },
      { id: "take", label: "Take drink" },
    ],
    answer: [
      { event: "q", from: "none", to: "c25" },
      { event: "q", from: "c25", to: "c50" },
      { event: "q", from: "c50", to: "ready", why: "The third quarter makes 75¢, so the drink drops." },
      { event: "q", from: "ready", to: "ready", why: "With a drink waiting, an extra coin is returned: the machine has no state for more credit." },
      { event: "refund", from: "none", to: "none", why: "With no credit there is nothing to refund." },
      { event: "refund", from: "c25", to: "none", why: "Refund returns all the credit, not just the last coin." },
      { event: "refund", from: "c50", to: "none", why: "Refund returns all the credit, not just the last coin, so it goes straight back to No credit." },
      { event: "take", from: "ready", to: "none" },
    ],
    traces: [
      { input: ["q", "q", "q", "take"], expect: "none", label: "25¢ 25¢ 25¢ Take drink", note: "Three quarters buy the drink; taking it resets the machine." },
      { input: ["q", "q", "refund", "q"], expect: "c25", label: "25¢ 25¢ Refund 25¢", note: "The refund gave back both quarters, so the last coin starts again from zero." },
      { input: ["q", "q", "q", "q"], expect: "ready", label: "25¢ ×4", note: "The fourth quarter is returned. The machine only remembers what its states can hold." },
    ],
    takeaway: "A state is all the machine remembers. It never counts coins; being in “50¢ in” is the count.",
  },
  regexAbc: {
    title: "Fix the machine for ab*c",
    mode: "fix",
    states: [
      { id: "q0", label: "Start", kind: "start", icon: "play" },
      { id: "q1", label: "Seen a", icon: "dot" },
      { id: "q2", label: "Seen c (accept)", kind: "goal", icon: "check" },
    ],
    events: [
      { id: "a", label: "a" },
      { id: "b", label: "b" },
      { id: "c", label: "c" },
    ],
    given: [
      { event: "a", from: "q0", to: "q1" },
      { event: "b", from: "q1", to: "q0" },
      { event: "c", from: "q1", to: "q2" },
    ],
    answer: [
      { event: "a", from: "q0", to: "q1" },
      { event: "b", from: "q1", to: "q1", why: "In ab*c the b’s repeat after the a, so b keeps the machine in Seen a: a loop, not a way back to the start." },
      { event: "c", from: "q1", to: "q2" },
    ],
    traces: [
      { input: ["a", "c"], expect: "q2", label: "ac", note: "Zero b’s is fine: b* allows none." },
      { input: ["a", "b", "c"], expect: "q2", label: "abc" },
      { input: ["a", "b", "b", "c"], expect: "q2", label: "abbc" },
      { input: ["a", "b", "c", "b"], expect: "stuck", label: "abcb", note: "Nothing may follow the c, so there is no arrow out of the accept state." },
      { input: ["b", "c"], expect: "stuck", label: "bc", note: "Every match starts with a." },
    ],
    takeaway: "A star becomes a loop on the state the starred letter returns to. Going back to the start would mean (ab)*c instead.",
  },
};

export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  https: {
    label: "HTTPS machine",
    prompt: "What actually happens, in order, when I open an HTTPS link?",
    intro: "Think of the browser as a machine that can only be in one situation at a time, and each event moves it on. Wire it up: drag each state onto the one it leads to, then drop the event that causes it onto the arrow.",
    receiptLabel: "State machine",
    receiptText: "The learner asked what happens when an HTTPS page loads. The machine checks each transition against DNS → TLS → HTTP and runs the page load on the learner’s own wiring.",
  },
  tcpHandshake: {
    label: "TCP handshake",
    prompt: "Why does TCP need three messages to connect? Wouldn’t two do?",
    intro: "Each side needs to hear the other acknowledge its SYN. Build both sides’ machine (the listen() arrow is drawn for you) and run the three openings to see that every path ends Established.",
    receiptLabel: "State machine",
    receiptText: "The learner asked why TCP uses a three-way handshake. The machine follows the RFC 793 state diagram, simplified to the opening states.",
  },
  vendingMachine: {
    label: "Vending machine",
    prompt: "How does a vending machine keep track of the money without counting?",
    intro: "Its states are the count. Here is a 75¢ machine that takes quarters. Step each sequence of coins through it by dragging the marker along the arrows.",
    receiptLabel: "Tracing a machine",
    receiptText: "The learner asked how a vending machine tracks credit. The learner steps three inputs through a given machine; wrong moves get a hint, then the answer.",
  },
  regexAbc: {
    label: "Regex ab*c",
    prompt: "My DFA for ab*c rejects abbc. What’s wrong with it?",
    intro: "Run your inputs through it and watch where abbc goes astray. Then drag the wrong event chip onto the state it should lead to (a missing arrow means the input is rejected).",
    receiptLabel: "Repairing a machine",
    receiptText: "The learner asked why their DFA rejects a string it should accept. The given machine has one wrong transition; inputs are run on the learner’s current machine.",
  },
};

export const scenario = {
  tab: "HTTPS machine",
  prompt: variants.https.prompt,
  intro: variants.https.intro,
  receiptLabel: variants.https.receiptLabel!,
  receiptText: variants.https.receiptText!,
  preset: "https",
};
