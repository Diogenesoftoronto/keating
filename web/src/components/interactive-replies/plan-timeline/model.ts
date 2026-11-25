/* ============================================================================
   PlanTimeline model: pure scheduling logic, no React.
   - Days are integers 0..horizon-1. A task occupies days [start, start+duration).
   - "Push, don't pull": moving or lengthening a task pushes its downstream tasks
     later just enough to keep every prerequisite before its dependent. Moving a
     task earlier never drags its dependents with it (they keep their slot and
     gain slack). Fixed tasks and exams never move; a push that reaches one
     becomes a visible conflict instead.
   - A pushed task skips the lost day (it lands on the day after). The task
     the learner drags can still be put on it; that shows as a conflict.
   - Pushes do not level hours: a push can overload a day, which shows amber.
   - Critical path method on the plan as it stands: a backward pass from the
     anchor (fixed tasks, the hard deadline, else the horizon) gives each task's
     latest start, skipping the lost day. Float = latest start - current start.
     The critical path is the chain(s) of least float joined by the dependency
     edges that bind them, ending at a fixed task or the deadline.
   - Slack (what the bars show) is stricter: how many days a task can move
     later, pushing its dependents, before anything new goes wrong (a day over
     capacity, the lost day, a fixed task or the deadline).
   ========================================================================== */

export type TaskKind = "study" | "review" | "practice" | "exam" | "fixed";

export type PlanTask = {
  id: string;
  title: string;
  /** Day index (0 = first day shown) or an ISO date when the plan has a startDate. */
  start: number | string;
  /** Whole days, 1 or more. */
  duration: number;
  /** Ids of tasks that must finish before this one starts. */
  dependsOn?: string[];
  kind: TaskKind;
  /** Hours per day this task takes. Defaults by kind (study 2, review 1, practice 2, exam 2, fixed 1). */
  hours?: number;
};

export type PlanMove = { task: string; start?: number | string; duration?: number; hours?: number; why?: string };

export type PlanTimelineConfig = {
  title: string;
  /** ISO date (YYYY-MM-DD) of day 0. Optional; without it days are numbered. */
  startDate?: string;
  /** Days shown, 5 to 21. */
  horizon: number;
  /** Hours available per day. */
  capacityPerDay: number;
  /** Today (day index or ISO date). Earlier days are shaded; tasks that have started are locked and nothing moves before today. */
  today?: number | string;
  /** Everything must be finished before this day starts (day index or ISO date). Optional. */
  deadline?: number | string;
  /** What the deadline is called ("hand-in", "exam"). */
  deadlineLabel?: string;
  tasks: PlanTask[];
  /** Keating's suggested change: a set of moves plus one short rationale. */
  proposal?: { rationale: string; moves: PlanMove[] };
  /** A day that is no longer available. */
  disruption?: { day: number | string; label: string };
  /** Rename the kinds in the legend for non-study plans, e.g. { study: "research" }. */
  kindNames?: Partial<Record<TaskKind, string>>;
};

export type ShareSummary = { learner: string; data: string; reply: string };

/* ---------- Validated, index-based plan ---------- */
export type Ready = {
  ok: true;
  title: string;
  H: number;
  cap: number;
  startDate?: Date;
  deadline?: number;
  deadlineLabel: string;
  today: number;
  locked: boolean[];
  ids: string[];
  titles: string[];
  kinds: TaskKind[];
  hours: number[];
  preds: number[][];
  succs: number[][];
  topo: number[];
  fixed: boolean[];
  base: Plan;
  proposal?: { rationale: string; moves: { task: number; start?: number; duration?: number; hours?: number; why: string }[] };
  blocked?: { day: number; label: string };
  kindNames: Record<TaskKind, string>;
};
export type Checked = Ready | { ok: false; reason: string };

/** Dragology state. s/d are starts and durations (fractional mid-drag), h hours per day.
    push: index of the task whose move pushes its downstream (-1 none).
    lead/leadEnd: a left-edge resize in progress (end held fixed). */
export type Plan = { s: number[]; d: number[]; h: number[]; push: number; lead: number; leadEnd: number };

const KINDS: TaskKind[] = ["study", "review", "practice", "exam", "fixed"];
const DEFAULT_HOURS: Record<TaskKind, number> = { study: 2, review: 1, practice: 2, exam: 2, fixed: 1 };
const DAY_MS = 86400000;

export function parseISO(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  const y = +m[1], mo = +m[2], da = +m[3];
  const d = new Date(Date.UTC(y, mo - 1, da));
  // Round-trip: 2026-02-31 would otherwise roll over to March 3. Reject any date the calendar doesn't have.
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return undefined;
  return d;
}

export function check(config: unknown): Checked {
  const c = config as Partial<PlanTimelineConfig> | null;
  if (!c || typeof c !== "object") return { ok: false, reason: "No plan was given." };
  if (c.title !== undefined && typeof c.title !== "string") return { ok: false, reason: "The title must be text." };
  if (c.deadlineLabel !== undefined && typeof c.deadlineLabel !== "string") return { ok: false, reason: "The deadline label must be text." };
  if (c.kindNames !== undefined) {
    const kn = c.kindNames as unknown;
    if (!kn || typeof kn !== "object" || Array.isArray(kn)) return { ok: false, reason: "kindNames must map task kinds to short names." };
    for (const [k, v] of Object.entries(kn)) {
      if (!KINDS.includes(k as TaskKind)) return { ok: false, reason: `kindNames has an unknown kind “${k.slice(0, 20)}”; use ${KINDS.join(", ")}.` };
      if (typeof v !== "string" || !v.trim() || v.length > 24) return { ok: false, reason: `kindNames.${k} must be a short name (1 to 24 characters).` };
    }
  }
  const H = c.horizon;
  if (typeof H !== "number" || !Number.isInteger(H) || H < 5 || H > 21) return { ok: false, reason: "The horizon must be 5 to 21 days." };
  const cap = c.capacityPerDay;
  if (typeof cap !== "number" || !(cap > 0) || cap > 16) return { ok: false, reason: "Hours per day must be between 0 and 16." };
  let startDate: Date | undefined;
  if (c.startDate !== undefined) {
    if (typeof c.startDate !== "string" || !(startDate = parseISO(c.startDate))) return { ok: false, reason: "The start date must look like 2026-11-23." };
  }
  const day = (v: unknown, what: string): number | string => {
    if (typeof v === "number" && Number.isInteger(v)) return v;
    if (typeof v === "string") {
      if (!startDate) return `${what} is a date, but the plan has no startDate.`;
      const d = parseISO(v);
      if (!d) return `${what} is not a date like 2026-11-23.`;
      return Math.round((d.getTime() - startDate.getTime()) / DAY_MS);
    }
    return `${what} needs a day.`;
  };
  const tasks = c.tasks;
  if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 16) return { ok: false, reason: "A plan needs 2 to 16 tasks." };
  const ids: string[] = [], titles: string[] = [], kinds: TaskKind[] = [], hours: number[] = [], s: number[] = [], d: number[] = [];
  for (const t of tasks) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id.trim()) return { ok: false, reason: "Every task needs an id." };
    if (ids.includes(t.id)) return { ok: false, reason: `Two tasks share the id “${t.id}”.` };
    if (typeof t.title !== "string" || !t.title.trim() || t.title.length > 40) return { ok: false, reason: `Task “${t.id}” needs a short title.` };
    if (!KINDS.includes(t.kind)) return { ok: false, reason: `Task “${t.id}” has an unknown kind.` };
    if (typeof t.duration !== "number" || !Number.isInteger(t.duration) || t.duration < 1) return { ok: false, reason: `Task “${t.id}” needs a whole number of days.` };
    const st = day(t.start, `The start of “${t.id}”`);
    if (typeof st === "string") return { ok: false, reason: st };
    if (st < 0 || st + t.duration > H) return { ok: false, reason: `Task “${t.id}” does not fit in the ${H} days shown.` };
    const h = t.hours ?? DEFAULT_HOURS[t.kind];
    if (typeof h !== "number" || !(h > 0) || h > 16) return { ok: false, reason: `Task “${t.id}” has odd hours.` };
    ids.push(t.id); titles.push(t.title.trim()); kinds.push(t.kind); hours.push(h); s.push(st); d.push(t.duration);
  }
  const n = ids.length;
  const preds: number[][] = [];
  for (const t of tasks) {
    const deps = t.dependsOn ?? [];
    if (!Array.isArray(deps)) return { ok: false, reason: `dependsOn of “${t.id}” must be a list.` };
    const p: number[] = [];
    for (const dep of deps) {
      const i = ids.indexOf(dep);
      if (i < 0) return { ok: false, reason: `“${t.id}” depends on “${dep}”, which is not in the plan.` };
      if (dep === t.id) return { ok: false, reason: `“${t.id}” depends on itself.` };
      if (!p.includes(i)) p.push(i);
    }
    preds.push(p);
  }
  const succs: number[][] = ids.map(() => []);
  preds.forEach((p, i) => p.forEach(j => succs[j].push(i)));
  /* Kahn's algorithm; leftovers mean a cycle. */
  const indeg = preds.map(p => p.length);
  const queue = ids.map((_, i) => i).filter(i => indeg[i] === 0);
  const topo: number[] = [];
  while (queue.length) {
    const i = queue.shift()!; topo.push(i);
    for (const j of succs[i]) if (--indeg[j] === 0) queue.push(j);
  }
  if (topo.length !== n) return { ok: false, reason: "The dependencies go round in a circle." };
  let today = 0;
  if (c.today !== undefined) {
    const td = day(c.today, "Today");
    if (typeof td === "string") return { ok: false, reason: td };
    if (td < 0 || td >= H) return { ok: false, reason: "Today is outside the days shown." };
    today = td;
  }
  /* Started or finished tasks are locked in place, like fixed ones. */
  const locked = s.map((x, i) => x < today && kinds[i] !== "exam" && kinds[i] !== "fixed");
  const fixed = kinds.map((k, i) => k === "exam" || k === "fixed" || locked[i]);

  let deadline: number | undefined;
  if (c.deadline !== undefined) {
    const dl = day(c.deadline, "The deadline");
    if (typeof dl === "string") return { ok: false, reason: dl };
    if (dl < 1 || dl > H) return { ok: false, reason: "The deadline is outside the days shown." };
    deadline = dl;
  }
  let blocked: Ready["blocked"];
  if (c.disruption !== undefined) {
    const b = c.disruption;
    const bd = b && typeof b === "object" ? day(b.day, "The lost day") : "The disruption needs a day.";
    if (typeof bd === "string") return { ok: false, reason: bd };
    if (bd < 0 || bd >= H) return { ok: false, reason: "The lost day is outside the days shown." };
    blocked = { day: bd, label: typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 24) : "unavailable" };
  }
  let proposal: Ready["proposal"];
  if (c.proposal !== undefined) {
    const p = c.proposal;
    if (!p || typeof p !== "object" || !Array.isArray(p.moves) || p.moves.length < 1) return { ok: false, reason: "The suggestion needs at least one move." };
    const moves: NonNullable<Ready["proposal"]>["moves"] = [];
    for (const m of p.moves) {
      const i = ids.indexOf(m?.task);
      if (i < 0) return { ok: false, reason: `The suggestion moves “${m?.task}”, which is not in the plan.` };
      if (fixed[i]) return { ok: false, reason: `The suggestion moves “${ids[i]}”, which is fixed.` };
      let st: number | undefined;
      if (m.start !== undefined) { const v = day(m.start, `The suggested start of “${ids[i]}”`); if (typeof v === "string") return { ok: false, reason: v }; st = v; }
      if (m.duration !== undefined && (!Number.isInteger(m.duration) || m.duration < 1)) return { ok: false, reason: `The suggested length of “${ids[i]}” must be whole days.` };
      if (m.hours !== undefined && (typeof m.hours !== "number" || !(m.hours > 0) || m.hours > 16)) return { ok: false, reason: `The suggested hours for “${ids[i]}” must be between 0 and 16.` };
      const ns = st ?? s[i], nd = m.duration ?? d[i];
      if (ns < today || ns + nd > H) return { ok: false, reason: `The suggested slot for “${ids[i]}” is outside the days shown.` };
      moves.push({ task: i, start: st, duration: m.duration, hours: m.hours, why: typeof m.why === "string" ? m.why.trim().slice(0, 120) : "" });
    }
    proposal = { rationale: typeof p.rationale === "string" ? p.rationale.trim().slice(0, 280) : "", moves };
  }
  const kindNames = { study: "study", review: "review", practice: "practice", exam: "exam", fixed: "fixed", ...(c.kindNames ?? {}) } as Record<TaskKind, string>;
  return {
    ok: true, title: typeof c.title === "string" && c.title.trim() ? c.title.trim() : "Study plan",
    H, cap, startDate, deadline, today, locked, deadlineLabel: typeof c.deadlineLabel === "string" && c.deadlineLabel.trim() ? c.deadlineLabel.trim() : "deadline",
    ids, titles, kinds, hours, preds, succs, topo, fixed,
    base: { s, d, h: hours.slice(), push: -1, lead: -1, leadEnd: 0 }, proposal, blocked, kindNames,
  };
}

/** House contract: [] when the config is valid, else the reasons it is not. */
export function validatePlanTimeline(config: unknown): string[] {
  const c = check(config);
  return c.ok ? [] : [c.reason];
}

/* ---------- Scheduling ---------- */
/** Does a task at [s, s+d) cover the lost day? (rounded, so a mid-drag push agrees with the drop) */
export function onLostDay(r: Ready, s: number, d: number): boolean {
  if (!r.blocked) return false;
  const rs = Math.round(s), b = r.blocked.day;
  return rs <= b && b < rs + Math.max(1, Math.round(d));
}
export function descendants(r: Ready, i: number): Set<number> {
  const seen = new Set<number>(); const stack = [i];
  while (stack.length) for (const j of r.succs[stack.pop()!]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
  return seen;
}

/** Effective starts/durations: apply a left-edge resize and the push cascade. */
export function effective(r: Ready, p: Plan): { s: number[]; d: number[] } {
  const s = p.s.slice(), d = p.d.slice();
  if (p.lead >= 0) d[p.lead] = Math.max(0.2, p.leadEnd - s[p.lead]);
  if (p.push >= 0) {
    const down = descendants(r, p.push);
    for (const t of r.topo) {
      if (!down.has(t) || r.fixed[t]) continue;
      let need = s[t];
      for (const q of r.preds[t]) need = Math.max(need, s[q] + d[q]);
      if (need <= s[t] + 1e-9) continue;
      /* Pushed: skip the lost day, and never off the end of the days shown. */
      if (r.blocked && onLostDay(r, need, d[t])) need = r.blocked.day + 1;
      s[t] = Math.min(need, r.H - d[t]);
    }
  }
  return { s, d };
}

/** Drop normaliser: whole days, cascade baked in, no resize marker. */
export function settle(r: Ready, p: Plan): Plan {
  const s = p.s.map(Math.round), d = p.d.map(x => Math.max(1, Math.round(x)));
  if (p.lead >= 0) { const end = Math.round(p.leadEnd); s[p.lead] = Math.min(Math.max(0, s[p.lead]), end - 1); d[p.lead] = end - s[p.lead]; }
  const e = effective(r, { s, d, h: p.h, push: p.push, lead: -1, leadEnd: 0 });
  /* Keep everything inside the horizon and nothing movable before today. */
  const S = e.s.map((x, i) => (r.fixed[i] ? Math.round(x) : Math.max(r.today, Math.min(Math.round(x), r.H - e.d[i]))));
  /* push is kept so the drop handler knows which task moved; on a settled plan the cascade is a no-op. */
  return { s: S, d: e.d.map(Math.round), h: p.h, push: p.push, lead: -1, leadEnd: 0 };
}

/** Move or resize one task (keyboard path and proposals), with the push cascade. */
export function shift(r: Ready, p: Plan, i: number, ds: number, dd: number): Plan {
  const s = p.s.slice(), d = p.d.slice();
  s[i] = Math.max(r.today, Math.min(r.H - Math.max(1, d[i] + dd), s[i] + ds));
  d[i] = Math.max(1, Math.min(r.H - s[i], d[i] + dd));
  return settle(r, { s, d, h: p.h, push: i, lead: -1, leadEnd: 0 });
}

export function applyProposal(r: Ready, base: Plan): Plan {
  let p = base;
  for (const m of r.proposal?.moves ?? []) {
    const s = p.s.slice(), d = p.d.slice(), h = p.h.slice();
    if (m.start !== undefined) s[m.task] = m.start;
    if (m.duration !== undefined) d[m.task] = m.duration;
    if (m.hours !== undefined) h[m.task] = m.hours;
    p = settle(r, { s, d, h, push: m.task, lead: -1, leadEnd: 0 });
  }
  return p;
}

export const samePlan = (a: Plan, b: Plan) => a.s.every((x, i) => x === b.s[i] && a.d[i] === b.d[i] && a.h[i] === b.h[i]);

/* ---------- Analysis ---------- */
export type Conflict =
  | { kind: "blocked"; task: number; day: number }
  | { kind: "order"; task: number; pred: number }
  | { kind: "deadline"; task: number; late: number }
  | { kind: "capacity"; day: number; load: number };
export type Note =
  | { kind: "bunched"; task: number; prev: number }
  | { kind: "eve"; day: number; load: number }
  | { kind: "eveTaken"; day: number; tasks: number[]; exam: number }
  | { kind: "examDay"; task: number; exam: number };

/** A critical chain: task indices in dependency order. `end` is a fixed task it runs into, -1 for the deadline, undefined for the horizon. */
export type Chain = { tasks: number[]; end?: number; days: number };
export type Critical = {
  /** Least float of any movable task, whole days. <= 0 means some chain is critical. */
  float: number;
  /** Chains of least float, longest first (the first is "the" critical path). */
  chains: Chain[];
  /** Tasks and edges ("a-b") on those chains, fixed ends included. Empty when nothing is critical (float > 0). */
  nodes: Set<number>;
  edges: Set<string>;
};

export type Analysis = {
  s: number[]; d: number[]; h: number[];  // whole-day effective schedule
  load: number[];                    // hours per day
  latestStart: number[];
  /** CPM float (calendar days, lost day skipped). */
  float: number[];
  /** Usable slack: days the task can move later before anything new goes wrong. */
  slack: number[];
  critical: boolean[]; criticalEdge: (a: number, b: number) => boolean;
  crit: Critical;
  conflicts: Conflict[]; notes: Note[];
  end: number;                        // last day used + 1
};

export const conflictKey = (c: Conflict) => `${c.kind}:${"task" in c ? c.task : ""}:${"day" in c ? c.day : ""}:${"pred" in c ? c.pred : ""}`;

function loadOf(r: Ready, s: number[], d: number[], h: number[]): number[] {
  const load = Array.from({ length: r.H }, () => 0);
  for (let i = 0; i < s.length; i++) for (let k = s[i]; k < s[i] + d[i]; k++) if (k >= 0 && k < r.H) load[k] += h[i];
  return load;
}

function conflictsOf(r: Ready, s: number[], d: number[], load: number[]): Conflict[] {
  const n = s.length;
  const out: Conflict[] = [];
  for (let i = 0; i < n; i++) for (const q of r.preds[i]) if (s[q] + d[q] > s[i]) out.push({ kind: "order", task: i, pred: q });
  if (r.blocked) for (let i = 0; i < n; i++) if (s[i] <= r.blocked.day && r.blocked.day < s[i] + d[i]) out.push({ kind: "blocked", task: i, day: r.blocked.day });
  if (r.deadline !== undefined) for (let i = 0; i < n; i++) if (!r.fixed[i] && s[i] + d[i] > r.deadline) out.push({ kind: "deadline", task: i, late: s[i] + d[i] - r.deadline });
  for (let k = r.today; k < r.H; k++) if (k !== r.blocked?.day && load[k] > r.cap + 1e-9) out.push({ kind: "capacity", day: k, load: load[k] });
  return out;
}

/** CPM backward pass that skips the lost day, then the least-float chains along binding edges. */
function criticalPath(r: Ready, s: number[], d: number[]): { LS: number[]; float: number[]; crit: Critical } {
  const n = s.length;
  const anchor = r.deadline ?? r.H;
  const LS: number[] = Array(n).fill(0);
  const bind: number[][] = ids(n).map(() => []);          // successors (or -1 = anchor) that set each task's latest finish
  for (const t of [...r.topo].reverse()) {
    if (r.fixed[t]) { LS[t] = s[t]; continue; }
    let lf = anchor, b: number[] = [-1];
    for (const q of r.succs[t]) {
      const v = LS[q];
      if (v < lf - 1e-9) { lf = v; b = [q]; } else if (Math.abs(v - lf) < 1e-9) b.push(q);
    }
    let ls = lf - d[t];
    if (r.blocked && ls <= r.blocked.day && r.blocked.day < ls + d[t]) ls = r.blocked.day - d[t];
    LS[t] = ls; bind[t] = b;
  }
  const float = LS.map((ls, i) => ls - s[i]);
  const movable = ids(n).filter(i => !r.fixed[i]);
  const minF = movable.length ? Math.min(...movable.map(i => float[i])) : 0;
  /* Critical: no float (or, when everything has some, the least float). */
  const onLevel = (i: number) => !r.fixed[i] && (minF <= 1e-9 ? float[i] <= 1e-9 : Math.abs(float[i] - minF) < 1e-9);
  /* Tight link: no free day between the two (the lost day doesn't count as free; an overlap is tight too). */
  const tight = (t: number, q: number) => {
    const gap = s[q] - (s[t] + d[t]);
    return gap <= 0 || (gap === 1 && r.blocked?.day === s[t] + d[t]);
  };
  const next = (t: number) => bind[t].filter(q => q >= 0 && onLevel(q) && tight(t, q) && (minF <= 1e-9 || Math.abs(float[q] - float[t]) < 1e-9));
  const hasIn = new Set<number>();
  for (const t of movable) if (onLevel(t)) for (const q of next(t)) hasIn.add(q);
  const chains: Chain[] = [];
  const walk = (path: number[]) => {
    if (chains.length >= 8) return;
    const t = path[path.length - 1];
    const nx = next(t);
    if (nx.length) { for (const q of nx) walk([...path, q]); return; }
    /* A chain must run into something that cannot move: a fixed task, the deadline, or the end of the plan. */
    const fixedEnd = bind[t].find(q => q >= 0 && r.fixed[q] && (minF > 1e-9 || tight(t, q)));
    if (fixedEnd !== undefined) { chains.push({ tasks: path, end: fixedEnd, days: path.reduce((a, i) => a + d[i], 0) }); return; }
    if (bind[t].includes(-1)) chains.push({ tasks: path, end: r.deadline !== undefined ? -1 : undefined, days: path.reduce((a, i) => a + d[i], 0) });
  };
  for (const t of r.topo) if (onLevel(t) && !hasIn.has(t)) walk([t]);
  chains.sort((a, b) => b.days - a.days || b.tasks.length - a.tasks.length);
  const nodes = new Set<number>(), edges = new Set<string>();
  if (minF <= 1e-9) for (const c of chains) {
    c.tasks.forEach((t, k) => { nodes.add(t); if (k > 0) edges.add(`${c.tasks[k - 1]}-${t}`); });
    if (c.end !== undefined && c.end >= 0) { nodes.add(c.end); edges.add(`${c.tasks[c.tasks.length - 1]}-${c.end}`); }
  }
  return { LS, float, crit: { float: Math.round(minF), chains, nodes, edges } };
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Days task i can move later (pushing dependents) before a new conflict appears or it hits the edge. */
function usableSlack(r: Ready, s: number[], d: number[], h: number[], i: number, baseKeys: Set<string>, baseLoad: number[]): number {
  if (r.fixed[i]) return 0;
  let good = 0;
  for (let k = 1; k <= r.H; k++) {
    if (s[i] + k + d[i] > r.H) return good;
    const p = settle(r, { s: s.map((x, j) => (j === i ? x + k : x)), d, h, push: i, lead: -1, leadEnd: 0 });
    if (p.s[i] !== s[i] + k) return good;
    const load = loadOf(r, p.s, p.d, h);
    const fresh = conflictsOf(r, p.s, p.d, load).filter(c => (c.kind === "capacity" ? load[c.day] > baseLoad[c.day] + 1e-9 : !baseKeys.has(conflictKey(c))));
    /* Landing on the lost day is hopped over, like a push would: keep looking past it. */
    if (fresh.length && fresh.every(c => c.kind === "blocked" && c.task === i)) continue;
    if (fresh.length) return good;
    good = k;
  }
  return good;
}

const cache = new WeakMap<Ready, Map<string, Analysis>>();
/** Analyse a plan (memoised on its whole-day shape; drags call this many times a frame). */
export function analyse(r: Ready, p: Plan): Analysis {
  const e = effective(r, p);
  const s = e.s.map(Math.round), d = e.d.map(x => Math.max(1, Math.round(x))), h = p.h;
  const key = `${s.join(",")}|${d.join(",")}|${h.join(",")}`;
  let m = cache.get(r); if (!m) cache.set(r, (m = new Map()));
  const hit = m.get(key); if (hit) return hit;
  if (m.size > 400) m.clear();
  const a = analyseRaw(r, s, d, h);
  m.set(key, a);
  return a;
}

function analyseRaw(r: Ready, s: number[], d: number[], h: number[]): Analysis {
  const n = s.length;
  const load = loadOf(r, s, d, h);
  const { LS, float, crit } = criticalPath(r, s, d);
  const critical = ids(n).map(i => crit.nodes.has(i));
  const criticalEdge = (a: number, b: number) => crit.edges.has(`${a}-${b}`);
  const conflicts = conflictsOf(r, s, d, load);
  const keys = new Set(conflicts.map(conflictKey));
  const slack = ids(n).map(i => usableSlack(r, s, d, h, i, keys, load));

  /* Study craft: spaced, not crammed, and a protected exam. */
  const notes: Note[] = [];
  for (let i = 0; i < n; i++) {
    if (r.kinds[i] !== "review") continue;
    for (const q of r.preds[i]) if (r.kinds[q] === "review" && s[i] === s[q] + d[q]) notes.push({ kind: "bunched", task: i, prev: q });
  }
  for (let x = 0; x < n; x++) {
    if (r.kinds[x] !== "exam") continue;
    const eve = s[x] - 1;
    if (eve >= 0 && load[eve] > r.cap * 0.67 + 1e-9) notes.push({ kind: "eve", day: eve, load: load[eve] });
    else if (eve >= 0 && load[eve] > 0) {
      /* The eve was protected (free) in the original plan and a push has put work on it. */
      const wasFree = r.ids.every((_, i) => !(r.base.s[i] <= eve && eve < r.base.s[i] + r.base.d[i]));
      const on = ids(n).filter(i => i !== x && s[i] <= eve && eve < s[i] + d[i]);
      if (wasFree && on.length) notes.push({ kind: "eveTaken", day: eve, tasks: on, exam: x });
    }
    for (let i = 0; i < n; i++) if (i !== x && !r.fixed[i] && s[i] <= s[x] && s[x] < s[i] + d[i]) notes.push({ kind: "examDay", task: i, exam: x });
  }
  return { s, d, h, load, latestStart: LS, float, slack, critical, criticalEdge, crit, conflicts, notes, end: Math.max(...s.map((x, i) => x + d[i])) };
}

/* ---------- Words ---------- */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function dayParts(r: Ready, k: number) {
  if (!r.startDate) return { short: String(k + 1), top: "", num: String(k + 1), long: `day ${k + 1}`, weekday: -1 };
  const dt = new Date(r.startDate.getTime() + k * DAY_MS);
  const wd = dt.getUTCDay();
  return { short: `${WEEKDAYS[wd]} ${dt.getUTCDate()}`, top: WEEKDAYS[wd], num: String(dt.getUTCDate()), long: WEEKDAYS_LONG[wd], weekday: wd };
}
/** "Thu" when the plan has dates and the day is within a week of start, else "Thu 3" / "day 4". */
export function dayName(r: Ready, k: number) {
  const p = dayParts(r, k);
  if (!r.startDate) return p.long;
  return k < 7 ? p.long : `${p.top} ${p.num}`;
}
export const hoursText = (h: number) => `${Math.round(h * 10) / 10}h`;
export const plural = (k: number, w: string, many = `${w}s`) => `${k} ${k === 1 ? w : many}`;
export const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The review intervals as scheduled, in days. Describes dates only: the plan cannot measure retention or trade it against hours. */
export function spacingText(r: Ready, p: Plan): string {
  const e = effective(r, p);
  const end = (i: number) => Math.round(e.s[i] + e.d[i]);
  const reviews = r.ids.map((_, i) => i).filter(i => r.kinds[i] === "review").sort((a, b) => e.s[a] - e.s[b]);
  // Each review's interval is measured from the session it builds on (its latest-ending prerequisite), so
  // reviews of different topics are never compared with each other.
  const parts: string[] = [];
  for (const i of reviews) {
    if (!r.preds[i].length) continue;
    const q = r.preds[i].reduce((a, b) => (end(b) > end(a) ? b : a));
    const gap = Math.round(e.s[i]) - end(q);
    parts.push(`${r.titles[i]} ${gap <= 0 ? "comes straight after" : `comes ${plural(gap, "free day")} after`} ${r.titles[q]}`);
  }
  if (!parts.length) return "";
  const shown = parts.length > 3 ? [...parts.slice(0, 3), `${plural(parts.length - 3, "more review", "more reviews")} after that`] : parts;
  const exam = r.kinds.indexOf("exam");
  const last = reviews[reviews.length - 1];
  const toExam = exam >= 0 ? Math.round(e.s[exam]) - end(last) : -1;
  let t = `As scheduled, ${listJoin(shown)}`;
  if (toExam >= 0) t += `, and the last review ends ${toExam === 0 ? "the day before" : `${plural(toExam, "free day")} before`} the ${r.titles[exam].toLowerCase()}`;
  return `${t}.`;
}
const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export function conflictText(r: Ready, c: Conflict): string { return capFirst(conflictRaw(r, c)); }
function conflictRaw(r: Ready, c: Conflict): string {
  const T = (i: number) => r.titles[i];
  switch (c.kind) {
    case "blocked": return `${T(c.task)} falls on ${dayName(r, c.day)}, which you lost (${r.blocked?.label}).`;
    case "order": return r.fixed[c.task] ? `${T(c.pred)} now runs into ${T(c.task)}, which cannot move.` : `${T(c.task)} now starts before ${T(c.pred)} is finished.`;
    case "deadline": return `${T(c.task)} ends ${plural(c.late, "day")} after the ${r.deadlineLabel}.`;
    case "capacity": return `${dayName(r, c.day)} needs ${hoursText(c.load)} but you have ${hoursText(r.cap)}.`;
  }
}
export function noteText(r: Ready, n: Note): string { return capFirst(noteRaw(r, n)); }
function noteRaw(r: Ready, n: Note): string {
  const T = (i: number) => r.titles[i];
  switch (n.kind) {
    case "bunched": return `${T(n.task)} comes straight after ${T(n.prev)}. Leave a day between reviews; the gap is what makes them stick.`;
    case "eve": return `The day before the ${r.titles[r.kinds.indexOf("exam")]?.toLowerCase() ?? "exam"} is ${hoursText(n.load)} of ${hoursText(r.cap)}. Keep the eve light.`;
    case "eveTaken": return `The day before ${T(n.exam)} was free; now ${listJoin(n.tasks.map(T))} ${n.tasks.length === 1 ? "is" : "are"} on it, so there is no buffer left before the ${T(n.exam).toLowerCase().includes("test") ? "test" : "exam"}.`;
    case "examDay": return `${T(n.task)} overlaps ${T(n.exam)}.`;
  }
}

/** "A, B, C and 2 more": every item is counted, only the first `max` are named. */
export function listSome(xs: string[], max = 3): string {
  if (xs.length <= max) return listJoin(xs);
  return `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;
}

const chainEndName = (r: Ready, c: Chain) => (c.end === undefined ? undefined : c.end >= 0 ? r.titles[c.end] : `the ${r.deadlineLabel}`);
const chainWords = (r: Ready, c: Chain) => [...c.tasks.map(i => r.titles[i]), ...(chainEndName(r, c) ? [chainEndName(r, c)!] : [])].join(" → ");

/** The critical path in words: the longest least-float chain, then how any tied chains join it. */
export function criticalText(r: Ready, a: Analysis): string {
  const { chains, float } = a.crit;
  if (!chains.length) return "";
  const main = chains[0];
  if (float > 0) return main.tasks.length === 1 && main.end === undefined
    ? `Nothing is critical yet: the tightest task, ${r.titles[main.tasks[0]]}, has ${plural(float, "day")} to spare.`
    : `Nothing is critical yet: the tightest chain, ${chainWords(r, main)}, has ${plural(float, "day")} to spare.`;
  const head = main.tasks.length === 1 && main.end === undefined
    ? `The critical path is ${r.titles[main.tasks[0]]} on its own: it has no slack before the end of the plan.`
    : `The critical path is ${chainWords(r, main)}.`;
  const extra = chains.slice(1, 3).map(c => {
    const j = c.tasks.findIndex(t => main.tasks.includes(t));
    if (j > 0) return `${c.tasks.slice(0, j).map(i => r.titles[i]).join(" → ")} joins it at ${r.titles[c.tasks[j]]} with no slack either`;
    if (j === 0) return "";
    const endJoin = c.end !== undefined && c.end === main.end && c.end >= 0;
    return endJoin ? `${c.tasks.map(i => r.titles[i]).join(" → ")} also runs into ${r.titles[c.end!]} with no slack` : `a second chain, ${chainWords(r, c)}, has no slack either`;
  }).filter(Boolean);
  const more = chains.length > 3 ? ` (${plural(chains.length - 3, "more chain")} tied.)` : "";
  return `${head}${extra.length ? ` ${capFirst(listJoin(extra))}.` : ""}${more}`;
}
/** The critical chains as data (for the share record). */
export const criticalData = (r: Ready, a: Analysis) => (a.crit.float > 0 ? [] : a.crit.chains.map(c => chainWords(r, c)));

/** Where the plan can give if something comes up, with study sense: not by learning new material later. */
export function giveText(r: Ready, p: Plan, a: Analysis): string {
  const cands = r.ids.map((_, i) => i).filter(i => !r.fixed[i] && a.slack[i] >= 1 && a.s[i] >= r.today);
  const studyPlan = r.kinds.includes("exam") || r.kinds.includes("review");
  const T = (i: number) => r.titles[i];
  const days = (i: number) => plural(a.slack[i], "day");
  if (!cands.length) return "Nothing has a spare day, so if something comes up, shorten a task rather than move one.";
  if (!studyPlan) {
    const best = cands.sort((x, y) => a.slack[y] - a.slack[x])[0];
    return `${T(best)} has ${days(best)} of slack, so that is where the plan can give.`;
  }
  /* Rank: reviews first (a later review still does its job), then practice, then new material last.
     Penalise a one-day slip that would bunch reviews or crowd the exam eve. */
  const rank: Record<TaskKind, number> = { review: 0, practice: 1, study: 2, exam: 9, fixed: 9 };
  const noteKeys = (an: Analysis) => new Set(an.notes.map(x => `${x.kind}:${"task" in x ? x.task : ""}:${"day" in x ? x.day : ""}`));
  const now = noteKeys(a);
  const harm = (i: number) => { const b = analyse(r, shift(r, { ...p, s: a.s, d: a.d }, i, 1, 0)); return [...noteKeys(b)].filter(k => !now.has(k)).length; };
  const scored = cands.map(i => ({ i, harm: harm(i), rank: rank[r.kinds[i]] })).sort((x, y) => x.harm - y.harm || x.rank - y.rank || a.slack[y.i] - a.slack[x.i]);
  const best = scored[0];
  const exam = r.kinds.indexOf("exam");
  const examWord = exam >= 0 ? T(exam).toLowerCase().includes("test") ? "test" : r.kindNames.exam : "end";
  let out: string;
  if (best.harm > 0) out = `Every task with slack would crowd your reviews or the ${examWord} eve if it slipped, so if something comes up, shorten a task rather than move one.`;
  else if (r.kinds[best.i] === "review") out = `If something comes up, give from ${T(best.i)}: it has ${days(best.i)} of slack, and a review a day later still does its job.`;
  else if (r.kinds[best.i] === "practice") out = `If something comes up, ${T(best.i)} can slide: it has ${days(best.i)} of slack and still comes before what depends on it.`;
  else return `Only ${T(best.i)} has slack (${days(best.i)}). Learning new material later leaves less time to review it before the ${examWord}, so use that slack only if you have to.`;
  const bigStudy = cands.filter(i => r.kinds[i] === "study" && a.slack[i] > a.slack[best.i]).sort((x, y) => a.slack[y] - a.slack[x])[0];
  if (bigStudy !== undefined) out += ` ${T(bigStudy)} shows more slack (${days(bigStudy)}), but learning it later leaves less time to review it.`;
  return out;
}
