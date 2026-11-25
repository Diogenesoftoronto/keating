/* Straightedge-and-compass engine. Pure geometry, no React.
   World units: the construction's given length is 1 (shown as `length` cm). y grows downwards (SVG).
   One engine serves every construction: points (given or found where objects cross), arcs swept by
   the compass, and straightedge lines between points. Each construction only supplies a layout and a
   checker that reads the drawn geometry; nothing is scripted per step. */

export type V = { x: number; y: number };
export const v = (x: number, y: number): V => ({ x, y });
export const add = (a: V, b: V) => v(a.x + b.x, a.y + b.y);
export const sub = (a: V, b: V) => v(a.x - b.x, a.y - b.y);
export const mul = (a: V, k: number) => v(a.x * k, a.y * k);
export const len = (a: V) => Math.hypot(a.x, a.y);
export const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: V) => { const l = len(a) || 1; return v(a.x / l, a.y / l); };
export const lerp = (a: V, b: V, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const deg = (a: V) => Math.atan2(a.y, a.x) * 180 / Math.PI;
export const dir = (d: number) => v(Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180));
const cross = (a: V, b: V) => a.x * b.y - a.y * b.x;
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;

export const CONSTRUCTIONS = ["equilateralTriangle", "perpendicularBisector", "angleBisector", "copySegment", "copyAngle", "hexagon"] as const;
export type ConstructionKind = typeof CONSTRUCTIONS[number];
export type Hints = "full" | "light" | "none";

export type CompassConstructionConfig = {
  construction: ConstructionKind;
  title?: string;
  goal?: string;
  points?: string[];
  length?: number;
  angle?: number;
  segmentDrawn?: boolean;
  showSteps?: boolean;
  hints?: Hints;
};

export const MIN_R = 0.12;
export const MAX_R = 1.75;
export const LEG = 0.92;
const EPS = 0.006; // world distance at which two points are the same point
export const same = (a: number, b: number) => Math.abs(a - b) <= 0.012 * Math.max(Math.abs(a), Math.abs(b), 0.2);

/* ---------- Layouts ---------- */
export type GivenPoint = { id: string; name: string; at: V; label: V };
export type GivenSeg = { id: string; a: V; b: V; cutsArcs: boolean; ray?: boolean };
export type GivenCircle = { id: string; c: V; r: number };
export type Layout = { points: GivenPoint[]; segs: GivenSeg[]; circles: GivenCircle[]; bounds: [number, number, number, number] };

export const pointCount: Record<ConstructionKind, number> = {
  equilateralTriangle: 2, perpendicularBisector: 2, angleBisector: 3, copySegment: 3, copyAngle: 4, hexagon: 2,
};
export const defaultNames: Record<ConstructionKind, string[]> = {
  equilateralTriangle: ["A", "B"], perpendicularBisector: ["A", "B"], angleBisector: ["O", "A", "B"],
  copySegment: ["A", "B", "C"], copyAngle: ["O", "A", "B", "P"], hexagon: ["O", "P"],
};

export function layoutFor(c: Resolved, compact: boolean): Layout {
  const n = c.names;
  const P = (i: number, at: V, label: V): GivenPoint => ({ id: `g${i}`, name: n[i], at, label });
  switch (c.construction) {
    case "equilateralTriangle": return {
      points: [P(0, v(0, 0), v(-0.11, 0.1)), P(1, v(1, 0), v(0.11, 0.1))],
      segs: c.segmentDrawn ? [{ id: "s-ab", a: v(0, 0), b: v(1, 0), cutsArcs: false }] : [],
      circles: [], bounds: [-0.18, -1.02, 1.18, 0.2],
    };
    case "perpendicularBisector": return {
      points: [P(0, v(0, 0), v(-0.12, 0.02)), P(1, v(1, 0), v(0.12, 0.02))],
      segs: [{ id: "s-ab", a: v(0, 0), b: v(1, 0), cutsArcs: false }],
      circles: [], bounds: [-0.2, -0.86, 1.2, 0.86],
    };
    case "angleBisector": {
      const arm = 1.45, O = v(0, 0), A = v(arm, 0), B = mul(dir(-c.angle), arm);
      return {
        points: [P(0, O, v(-0.1, 0.08)), P(1, A, v(0.1, 0.06)), P(2, B, add(mul(dir(-c.angle), 0.11), v(0, -0.02)))],
        segs: [{ id: "s-oa", a: O, b: A, cutsArcs: true, ray: true }, { id: "s-ob", a: O, b: B, cutsArcs: true, ray: true }],
        circles: [], bounds: [Math.min(0, B.x) - 0.12, Math.min(B.y, -0.25) - 0.08, arm + 0.12, 0.18],
      };
    }
    case "copySegment": {
      const C = compact ? v(-0.05, 0.75) : v(1.35, 0.55);
      const X = add(C, v(compact ? 1.45 : 1.5, 0));
      return {
        points: [P(0, v(0, 0), v(-0.09, 0.09)), P(1, v(1, 0), v(0.09, 0.09)), P(2, C, v(-0.09, 0.09))],
        segs: [{ id: "s-ab", a: v(0, 0), b: v(1, 0), cutsArcs: false }, { id: "s-ray", a: C, b: X, cutsArcs: true, ray: true }],
        circles: [], bounds: [-0.18, -0.35, X.x + 0.05, C.y + 0.2],
      };
    }
    case "copyAngle": {
      const arm = 1.05, O = v(0, 0), A = v(arm, 0), B = mul(dir(-c.angle), arm);
      const Pp = compact ? v(Math.max(0, -B.x) * 0 + 0, 1.05) : v(arm + 0.45 + Math.max(0, -B.x), 0);
      const X = add(Pp, v(1.3, 0));
      return {
        points: [P(0, O, v(-0.09, 0.08)), P(1, A, v(0.09, 0.07)), P(2, B, add(mul(dir(-c.angle), 0.1), v(0, -0.02))), P(3, Pp, v(-0.09, 0.08))],
        segs: [{ id: "s-oa", a: O, b: A, cutsArcs: true, ray: true }, { id: "s-ob", a: O, b: B, cutsArcs: true, ray: true },
          { id: "s-ray", a: Pp, b: X, cutsArcs: true, ray: true }],
        circles: [], bounds: [Math.min(0, B.x) - 0.12, Math.min(B.y, -0.9) - 0.1, X.x + 0.05, Pp.y + 0.18],
      };
    }
    case "hexagon": return {
      points: [P(0, v(0, 0), v(-0.07, 0.09)), P(1, v(1, 0), v(0.1, 0.06))],
      segs: [], circles: [{ id: "c-o", c: v(0, 0), r: 1 }], bounds: [-1.14, -1.12, 1.16, 1.12],
    };
  }
}

/* ---------- Validation ---------- */
export type Resolved = {
  construction: ConstructionKind; title: string; goal: string; names: string[]; length: number;
  angle: number; segmentDrawn: boolean; showSteps: boolean; hints: Hints;
};
const KEYS = ["construction", "title", "goal", "points", "length", "angle", "segmentDrawn", "showSteps", "hints"];
const titles: Record<ConstructionKind, (n: string[]) => string> = {
  equilateralTriangle: n => "Construct an equilateral triangle",
  perpendicularBisector: n => `Bisect ${n[0]}${n[1]} at right angles`,
  angleBisector: n => `Bisect the angle ${n[1]}${n[0]}${n[2]}`,
  copySegment: n => `Copy ${n[0]}${n[1]} onto the line from ${n[2]}`,
  copyAngle: n => `Copy the angle ${n[1]}${n[0]}${n[2]} at ${n[3]}`,
  hexagon: () => "Construct a regular hexagon",
};
const goals: Record<ConstructionKind, (n: string[]) => string> = {
  equilateralTriangle: n => `Build a triangle on ${n[0]}${n[1]} with all three sides equal.`,
  perpendicularBisector: n => `Find the line that cuts ${n[0]}${n[1]} in half at a right angle.`,
  angleBisector: n => `Draw the ray from ${n[0]} that splits the angle into two equal angles.`,
  copySegment: n => `Mark a point on the line from ${n[2]} exactly ${n[0]}${n[1]} away, without measuring.`,
  copyAngle: n => `Build an angle at ${n[3]} equal to angle ${n[1]}${n[0]}${n[2]}, without a protractor.`,
  hexagon: n => `Inscribe a regular hexagon in the circle, starting from ${n[1]}.`,
};

export function resolve(config: unknown): { ok: true; c: Resolved } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return { ok: false, errors: ["No construction settings were given."] };
  const c = config as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!KEYS.includes(k)) errors.push(`Unknown field "${k}".`);
  const kind = c.construction as ConstructionKind;
  if (!CONSTRUCTIONS.includes(kind)) return { ok: false, errors: [`construction must be one of ${CONSTRUCTIONS.join(", ")}.`, ...errors] };
  const text = (k: string, max: number) => {
    if (c[k] === undefined) return undefined;
    if (typeof c[k] !== "string" || !(c[k] as string).trim() || (c[k] as string).length > max) { errors.push(`${k} must be text of 1 to ${max} characters.`); return undefined; }
    return (c[k] as string).trim();
  };
  const title = text("title", 60), goal = text("goal", 160);
  let names = defaultNames[kind];
  if (c.points !== undefined) {
    const p = c.points;
    if (!Array.isArray(p) || p.length !== pointCount[kind]) errors.push(`points must list ${pointCount[kind]} labels for ${kind} (${defaultNames[kind].join(", ")}).`);
    else if (!p.every(s => typeof s === "string" && /^[A-Z][0-9′']?$/.test(s))) errors.push("Each point label is one capital letter, optionally followed by a digit or prime (A, B, P1, A′).");
    else if (new Set(p).size !== p.length) errors.push("Point labels must be different from each other.");
    else names = p as string[];
  }
  let length = 6;
  if (c.length !== undefined) {
    if (typeof c.length !== "number" || !Number.isFinite(c.length) || c.length < 1 || c.length > 30) errors.push("length is the given length in cm, a number from 1 to 30.");
    else length = c.length;
  }
  let angle = kind === "angleBisector" ? 64 : 50;
  if (c.angle !== undefined) {
    if (kind !== "angleBisector" && kind !== "copyAngle") errors.push("angle only applies to angleBisector and copyAngle.");
    else if (typeof c.angle !== "number" || !Number.isFinite(c.angle) || c.angle < 25 || c.angle > (kind === "copyAngle" ? 120 : 150)) errors.push(`angle is in degrees, from 25 to ${kind === "copyAngle" ? 120 : 150}.`);
    else angle = c.angle;
  }
  const bool = (k: string, d: boolean) => {
    if (c[k] === undefined) return d;
    if (typeof c[k] !== "boolean") { errors.push(`${k} must be true or false.`); return d; }
    return c[k] as boolean;
  };
  const segmentDrawn = bool("segmentDrawn", false);
  if (c.segmentDrawn !== undefined && kind !== "equilateralTriangle") errors.push("segmentDrawn only applies to equilateralTriangle (other constructions start with their lines drawn).");
  const showSteps = bool("showSteps", true);
  let hints: Hints = "full";
  if (c.hints !== undefined) {
    if (c.hints !== "full" && c.hints !== "light" && c.hints !== "none") errors.push('hints must be "full", "light" or "none".');
    else hints = c.hints;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, c: { construction: kind, title: title ?? titles[kind](names), goal: goal ?? goals[kind](names), names, length, angle, segmentDrawn, showSteps, hints } };
}

/* ---------- Construction state ---------- */
export type Arc = { id: string; center: string; r: number; lo: number; hi: number };
export type Line = { id: string; a: string; b: string };
export type DPoint = { id: string; name: string; x: number; y: number };
export type Model = {
  arcs: Arc[]; lines: Line[]; points: DPoint[]; nextId: number;
  needle: string; // a point id, "free" or "park"
  fx: number; fy: number; r: number; angle: number; hand: 1 | -1;
  sweepFrom: number | null; draftFrom: string | null; draftTo: string | null; dx: number; dy: number;
};
export const startModel = (): Model => ({
  arcs: [], lines: [], points: [], nextId: 1, needle: "park", fx: 0, fy: 0, r: 0.5, angle: 0, hand: 1,
  sweepFrom: null, draftFrom: null, draftTo: null, dx: 0, dy: 0,
});

export type Pt = { id: string; name: string; at: V; given: boolean; label: V };
export function allPoints(m: Model, L: Layout): Pt[] {
  return [...L.points.map(p => ({ id: p.id, name: p.name, at: p.at, given: true, label: p.label })),
    ...m.points.map(p => ({ id: p.id, name: p.name, at: v(p.x, p.y), given: false, label: v(0, -0.1) }))];
}

export function mergeArc(arcs: Arc[], next: Arc): Arc[] {
  const i = arcs.findIndex(a => a.center === next.center && Math.abs(a.r - next.r) < 0.002);
  if (i < 0) return [...arcs, clampArc(next)];
  const a = arcs[i];
  const merged = clampArc({ ...a, lo: Math.min(a.lo, next.lo), hi: Math.max(a.hi, next.hi) });
  return arcs.map((x, j) => j === i ? merged : x);
}
const clampArc = (a: Arc): Arc => a.hi - a.lo > 360 ? { ...a, hi: a.lo + 360 } : a;
export function covers(a: { lo: number; hi: number }, d: number) {
  if (a.hi - a.lo >= 359.5) return true;
  const k = Math.ceil((a.lo - 0.6 - d) / 360);
  return d + k * 360 <= a.hi + 0.6;
}

/* ---------- Intersections ---------- */
type Obj = { kind: "circle"; id: string; c: V; r: number; arc?: { lo: number; hi: number }; given: boolean }
  | { kind: "seg"; id: string; a: V; b: V; given: boolean; cutsArcs: boolean; learner: boolean };

export function circleCircle(c1: V, r1: number, c2: V, r2: number): V[] {
  const d = dist(c1, c2);
  if (d < 1e-9 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = norm(sub(c2, c1)), m = add(c1, mul(u, a)), n = v(-u.y, u.x);
  return h < 1e-7 ? [m] : [add(m, mul(n, h)), sub(m, mul(n, h))];
}
function segCircle(a: V, b: V, c: V, r: number): V[] {
  const d = sub(b, a), f = sub(a, c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter(t => t >= -1e-6 && t <= 1 + 1e-6).map(t => add(a, mul(d, t)));
}
function segSeg(a: V, b: V, c: V, d: V): V[] {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-9) return [];
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? [add(a, mul(r, t))] : [];
}

function objects(m: Model, L: Layout): Obj[] {
  const pos = new Map(allPoints(m, L).map(p => [p.id, p.at]));
  const out: Obj[] = [];
  for (const a of m.arcs) { const c = pos.get(a.center); if (c) out.push({ kind: "circle", id: a.id, c, r: a.r, arc: a, given: false }); }
  for (const l of m.lines) { const a = pos.get(l.a), b = pos.get(l.b); if (a && b) out.push({ kind: "seg", id: l.id, a, b, given: false, cutsArcs: false, learner: true }); }
  for (const s of L.segs) out.push({ kind: "seg", id: s.id, a: s.a, b: s.b, given: true, cutsArcs: s.cutsArcs, learner: false });
  for (const c of L.circles) out.push({ kind: "circle", id: c.id, c: c.c, r: c.r, given: true });
  return out;
}

/* Every place two drawn things cross. Arcs only cut given lines that are there to be cut (angle arms,
   rays); arcs never cut the learner's own straightedge lines, which keeps stray points off the figure. */
export function intersections(m: Model, L: Layout): V[] {
  const objs = objects(m, L);
  const found: V[] = [];
  const onArc = (o: Obj, p: V) => o.kind !== "circle" || !o.arc || covers(o.arc, deg(sub(p, o.c)));
  for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
    const a = objs[i], b = objs[j];
    if (a.given && b.given) continue;
    let pts: V[] = [];
    if (a.kind === "circle" && b.kind === "circle") pts = circleCircle(a.c, a.r, b.c, b.r);
    else if (a.kind === "seg" && b.kind === "seg") pts = segSeg(a.a, a.b, b.a, b.b);
    else {
      const s = (a.kind === "seg" ? a : b) as Extract<Obj, { kind: "seg" }>, c = (a.kind === "circle" ? a : b) as Extract<Obj, { kind: "circle" }>;
      if (s.learner || (!s.cutsArcs && !c.given)) continue;
      pts = segCircle(s.a, s.b, c.c, c.r);
    }
    for (const p of pts) if (onArc(a, p) && onArc(b, p)) found.push(p);
  }
  return found;
}

const LETTERS = "ABCDEFGHIJKLMNPQRSTUVWXYZ";
function nextName(used: Set<string>, after: string[]) {
  const start = Math.max(...after.map(n => LETTERS.indexOf(n[0])), -1) + 1;
  for (let k = 0; k < LETTERS.length * 2; k++) {
    const name = LETTERS[(start + k) % LETTERS.length] + (k >= LETTERS.length ? "′" : "");
    if (!used.has(name)) return name;
  }
  return "?";
}

/* Find, keep and name the points where things cross. Arcs and lines never move once drawn, so a
   found point keeps its name until Undo or Start over takes away what made it. */
export function normalize(m: Model, L: Layout, box: [number, number, number, number]): Model {
  let cur = { ...m, sweepFrom: null, draftFrom: null, draftTo: null };
  for (let pass = 0; pass < 4; pass++) {
    const raw = intersections(cur, L);
    const given = L.points.map(p => p.at);
    const kept = new Set<string>();
    const fresh: DPoint[] = [];
    let nextId = cur.nextId;
    for (const p of raw) {
      if (p.x < box[0] - 0.05 || p.x > box[2] + 0.05 || p.y < box[1] - 0.05 || p.y > box[3] + 0.05) continue;
      if (given.some(g => dist(g, p) < EPS)) continue;
      const old = cur.points.find(q => dist(v(q.x, q.y), p) < EPS);
      if (old) { kept.add(old.id); continue; }
      if (fresh.some(q => dist(v(q.x, q.y), p) < EPS)) continue;
      fresh.push({ id: `p${nextId++}`, name: "", x: p.x, y: p.y });
    }
    const points = [...cur.points.filter(p => kept.has(p.id)), ...fresh];
    const gone = new Set(cur.points.filter(p => !kept.has(p.id)).map(p => p.id));
    cur = { ...cur, points, nextId };
    if (!gone.size) break;
    cur = { ...cur, arcs: cur.arcs.filter(a => !gone.has(a.center)), lines: cur.lines.filter(l => !gone.has(l.a) && !gone.has(l.b)),
      needle: gone.has(cur.needle) ? "park" : cur.needle };
  }
  return cur;
}

/* Found points get a letter only once they matter (a role in the construction, a line end, an arc
   centre, the needle), so stray crossings don't use up letters or crowd the figure. */
export function nameVisible(m: Model, L: Layout, keep: Iterable<string>): Model {
  const want = new Set([...keep, ...m.lines.flatMap(l => [l.a, l.b]), ...m.arcs.map(a => a.center), m.needle]);
  if (!m.points.some(p => !p.name && want.has(p.id))) return m;
  const used = new Set([...L.points.map(p => p.name), ...m.points.map(p => p.name).filter(Boolean)]);
  return { ...m, points: m.points.map(p => {
    if (p.name || !want.has(p.id)) return p;
    const name = nextName(used, L.points.map(q => q.name));
    used.add(name);
    return { ...p, name };
  }) };
}

export const lineId = (a: string, b: string) => `l-${[a, b].sort().join("-")}`;
export function addLine(m: Model, a: string, b: string): Model {
  if (a === b || m.lines.some(l => l.id === lineId(a, b))) return m;
  return { ...m, lines: [...m.lines, { id: lineId(a, b), a, b }] };
}
export const arcId = (center: string, r: number) => `a-${center}-${Math.round(r * 10000)}`;

/* ---------- Reading the drawing ---------- */
export type Status = "done" | "todo" | "off";
export type Step = { title: string; how: string; status: Status; partial?: string };
const quiet = (steps: Step[]) => steps.map(s => s.partial && /^0 of/.test(s.partial) ? { ...s, partial: undefined } : s);
export type Mark =
  | { kind: "length"; a: V; b: V; text: string; tone: "ok" | "off" | "plain"; ticks: number; side?: V }
  | { kind: "angle"; at: V; from: number; to: number; text: string; tone: "ok" | "off" | "plain"; r?: number }
  | { kind: "right"; at: V; u: V; w: V };
export type Cue = { nib?: string; needle?: string; pencil?: string; knob?: boolean };
export type Reading = {
  steps: Step[]; next: string; issue: string; finished: boolean; success: boolean;
  marks: Mark[]; fill?: { pts: V[]; tone: "ok" | "off" }; roles: string[]; cue: Cue;
  summary: { learner: string; data: string; reply: string }; measures: Record<string, number | string | boolean | null>;
};

export type Ctx = ReturnType<typeof context>;
export function context(m: Model, L: Layout, c: Resolved) {
  const pts = allPoints(m, L);
  const byId = new Map(pts.map(p => [p.id, p]));
  const P = (id: string) => byId.get(id)!.at;
  const nm = (id: string) => byId.get(id)?.name ?? "?";
  const cm = (d: number) => (d * c.length).toFixed(1);
  const g = (i: number) => `g${i}`;
  const arcsAt = (id: string) => m.arcs.filter(a => a.center === id);
  const onArc = (p: string, a: Arc) => { const q = P(p), cc = P(a.center); return Math.abs(dist(q, cc) - a.r) < EPS && covers(a, deg(sub(q, cc))); };
  const onSeg = (p: string, a: V, b: V) => { const q = P(p); const t = dot(sub(q, a), sub(b, a)) / dot(sub(b, a), sub(b, a)); return t > -0.01 && t < 1.01 && dist(q, lerp(a, b, t)) < EPS; };
  const hasLine = (a: string, b: string) => m.lines.some(l => l.id === lineId(a, b));
  const derived = m.points.map(p => p.id);
  const needleAt = m.needle !== "free" && m.needle !== "park" ? m.needle : null;
  const angleAt = (o: V, a: V, b: V) => { let d = Math.abs(deg(sub(a, o)) - deg(sub(b, o))); if (d > 180) d = 360 - d; return d; };
  return { m, L, c, pts, P, nm, cm, g, arcsAt, onArc, onSeg, hasLine, derived, needleAt, angleAt, dist, sub, deg, cross, norm, v };
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
const fmtDeg = (d: number) => `${d.toFixed(Math.abs(d - Math.round(d)) < 0.05 ? 0 : 1)}°`;

/* Picks the needle step: where to put the needle, then the opening, then sweep. */
function compassMove(x: Ctx, center: string, radius: number | null, radiusLabel: string, toward: string, extra = ""): { text: string; cue: Cue } {
  const name = x.nm(center);
  if (x.needleAt !== center) return { text: `Pick up the compass by a leg and drop its needle on ${name}${extra}.`, cue: { needle: center } };
  if (radius !== null && !same(x.m.r, radius)) return { text: `Drag the pencil leg onto ${radiusLabel} so the opening matches.`, cue: { pencil: center } };
  return { text: `Twist the compass by its handle to sweep an arc ${toward}.`, cue: { knob: true } };
}

/* ---------- The vetted constructions ---------- */
export function read(m: Model, L: Layout, c: Resolved): Reading {
  const r = readRaw(m, L, c);
  return { ...r, steps: quiet(r.steps) };
}
function readRaw(m: Model, L: Layout, c: Resolved): Reading {
  const x = context(m, L, c);
  switch (c.construction) {
    case "equilateralTriangle": return readEquilateral(x);
    case "perpendicularBisector": return readPerpendicular(x);
    case "angleBisector": return readAngleBisector(x);
    case "copySegment": return readCopySegment(x);
    case "copyAngle": return readCopyAngle(x);
    case "hexagon": return readHexagon(x);
  }
}

function readEquilateral(x: Ctx): Reading {
  const { m, nm, cm, P, hasLine, arcsAt, onArc, c } = x;
  const A = x.g(0), B = x.g(1), a = nm(A), b = nm(B), AB = 1;
  const segDone = c.segmentDrawn || hasLine(A, B);
  const arcsA = arcsAt(A), arcsB = arcsAt(B), arcs = [...arcsA, ...arcsB];
  const crossings = x.derived.filter(p => arcsA.some(q => onArc(p, q)) && arcsB.some(q => onArc(p, q)));
  const C = crossings.find(p => hasLine(p, A) && hasLine(p, B)) ?? crossings.find(p => hasLine(p, A) || hasLine(p, B))
    ?? [...crossings].sort((p, q) => P(p).y - P(q).y)[0];
  const cn = C ? nm(C) : "C";
  const closed = !!C && segDone && hasLine(C, A) && hasLine(C, B);
  const ac = C ? x.dist(P(C), P(A)) : 0, bc = C ? x.dist(P(C), P(B)) : 0;
  const success = closed && same(ac, AB) && same(bc, AB);
  const wrongArcs = arcs.filter(q => !same(q.r, AB));
  const joins = C ? [A, B].filter(e => hasLine(C, e)).length : 0;
  const steps: Step[] = [
    { title: "Draw a line segment", how: `Drag from ${a} to ${b} with the straightedge.`, status: segDone ? "done" : "todo" },
    { title: "Set the compass to its length", how: `Needle on ${a}, pencil leg onto ${b}.`, status: arcs.length ? (wrongArcs.length ? "off" : "done") : same(m.r, AB) ? "done" : "todo" },
    { title: "Draw an arc from each end", how: `Twist the handle to sweep, then repeat from ${b}.`, status: C ? "done" : arcsA.length && arcsB.length ? "off" : "todo", partial: C ? undefined : `${Number(arcsA.length > 0) + Number(arcsB.length > 0)} of 2` },
    { title: "Join the crossing to both ends", how: `Drag from ${cn} to ${a} and to ${b}.`, status: closed ? "done" : "todo", partial: C && !closed ? `${joins} of 2` : undefined },
  ];
  /* What is wrong, if anything, always beats the next routine step. */
  let issue = "";
  const radiusText = (q: typeof arcs[number]) => `${cm(q.r)} cm from ${nm(q.center)}`;
  if (arcsA.length && arcsB.length && !C) {
    const rA = Math.max(...arcsA.map(q => q.r)), rB = Math.max(...arcsB.map(q => q.r));
    issue = rA + rB < AB
      ? `These arcs can’t meet: ${cm(rA)} cm from ${a} and ${cm(rB)} cm from ${b} add up to less than ${a}${b} (${cm(AB)} cm). Undo them, rest the pencil on ${b} to set the opening to ${a}${b}, and sweep again.`
      : wrongArcs.length
        ? `Your arcs were drawn at ${radiusText({ ...arcsA[0], r: rA })} and ${radiusText({ ...arcsB[0], r: rB })}, but ${a}${b} is ${cm(AB)} cm, so even where they cross the triangle can’t be equilateral. Undo them, rest the pencil on ${b} to set the opening to ${a}${b}, and sweep again.`
        : `The arcs haven’t crossed yet. Keep twisting the handle so each arc sweeps further above ${a}${b}.`;
  } else if (wrongArcs.length && !success) {
    const ra = (C ? arcsA.find(q => onArc(C, q)) : undefined)?.r ?? arcsA[0]?.r, rb = (C ? arcsB.find(q => onArc(C, q)) : undefined)?.r ?? arcsB[0]?.r;
    const used = C ? arcs.filter(q => onArc(C, q)) : arcs;
    issue = ra !== undefined && rb !== undefined && same(ra, rb)
      ? `Both arcs were drawn at ${cm(ra)} cm, but ${a}${b} is ${cm(AB)} cm. Where they cross is the same distance from ${a} and ${b}, but not ${cm(AB)} cm, so the triangle won’t be equilateral.`
      : `Your arcs were drawn at ${used.map(radiusText).join(" and ")}, but ${a}${b} is ${cm(AB)} cm. A compass carries one length: every arc needs the opening ${a}${b}. Undo the ${wrongArcs.length > 1 ? "arcs" : "odd arc"} and redraw with the pencil resting on ${wrongArcs[0].center === A ? b : a}.`;
  }
  let next = "", cue: Cue = {};
  if (closed) next = success ? `Equilateral. Every side is ${cm(AB)} cm because every arc used ${a}${b} as its radius.` : "";
  else if (!segDone) { next = `Drag from ${a} to ${b}. The straightedge draws the segment you’ll copy.`; cue = { nib: A }; }
  else if (C) { const to = hasLine(C, A) ? B : A; next = `Drag from ${cn}, where the arcs cross, to ${nm(to)}${joins ? " to close the triangle" : ""}.`; cue = { nib: C }; }
  else if (!arcsA.length && !arcsB.length) ({ text: next, cue } = compassMove(x, x.needleAt === B ? B : A, AB, x.needleAt === B ? a : b, `above ${a}${b}`));
  else if (!arcsA.length || !arcsB.length) {
    const other = arcsA.length ? B : A;
    ({ text: next, cue } = compassMove(x, other, AB, nm(other === A ? B : A), `from ${nm(other)} so it crosses the first`, " without changing the opening"));
  } else next = "";
  if (issue && !closed) cue = {};

  const marks: Mark[] = [];
  if (segDone) marks.push({ kind: "length", a: P(A), b: P(B), text: `${cm(AB)} cm`, tone: success ? "ok" : "plain", ticks: success ? 1 : 0 });
  for (const e of [A, B]) if (C && hasLine(C, e)) {
    const d = x.dist(P(C), P(e)), off = closed && !same(d, AB);
    marks.push({ kind: "length", a: P(e), b: P(C), text: off ? `${cm(d)} ≠ ${a}${b}` : cm(d), tone: closed ? (off ? "off" : "ok") : "plain", ticks: closed ? (success ? 1 : same(ac, bc) ? 2 : 0) : 0 });
  }
  if (success && C) for (const [o, p, q] of [[A, B, C], [B, C, A], [C, A, B]] as const)
    marks.push({ kind: "angle", at: P(o), from: x.deg(x.sub(P(p), P(o))), to: x.deg(x.sub(P(q), P(o))), text: "", tone: "ok" });

  const ab = cm(AB);
  let summary;
  if (success) summary = { learner: "I built my triangle with the compass.", data: `${a}${b} = ${b}${cn} = ${cn}${a} = ${ab} cm · both arcs at radius ${a}${b}`,
    reply: `That’s an equilateral triangle, and you never measured. Each arc is every point ${ab} cm from its centre, so ${cn}, on both arcs, is ${ab} cm from ${a} and ${ab} cm from ${b}. All three sides have to match.` };
  else if (closed) {
    const ra = arcsA.find(q => onArc(C!, q))?.r ?? ac, rb = arcsB.find(q => onArc(C!, q))?.r ?? bc;
    summary = { learner: "I built my triangle, but the sides don’t all match.", data: `${a}${b} ${ab} cm · ${a}${cn} ${cm(ac)} cm · ${b}${cn} ${cm(bc)} cm · arcs at ${cm(ra)} and ${cm(rb)} cm`,
      reply: same(ra, rb)
        ? `Both your arcs were ${cm(ra)} cm, so ${cn} is ${cm(ra)} cm from ${a} and from ${b}: the two new sides match each other. But ${a}${b} is ${ab} cm, so the compass was ${ra > AB ? "wider" : "narrower"} than ${a}${b}. Rest the pencil exactly on ${b}, then redraw both arcs.`
        : `Your arc from ${a} was ${cm(ra)} cm and your arc from ${b} was ${cm(rb)} cm, so ${cn} sits ${cm(ac)} cm from ${a} and ${cm(bc)} cm from ${b}. ${same(ac, AB) ? `${a}${cn} matches ${a}${b} at ${ab} cm, but ${b}${cn} doesn’t` : same(bc, AB) ? `${b}${cn} matches ${a}${b} at ${ab} cm, but ${a}${cn} doesn’t` : `Neither matches ${a}${b} at ${ab} cm`}. Set the compass to ${a}${b} once, and keep that opening for both arcs.` };
  } else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished: closed, success, marks, fill: closed && C ? { pts: [P(A), P(B), P(C)], tone: success ? "ok" : "off" } : undefined,
    roles: C ? [C] : [], cue, summary, measures: { AB: +ab, AC: C ? +cm(ac) : null, BC: C ? +cm(bc) : null, crossing: !!C } };
}

function partialSummary(steps: Step[], issue: string, next: string) {
  const done = steps.filter(s => s.status === "done").length;
  const current = steps.find(s => s.status !== "done");
  return {
    learner: done ? `I’ve done ${plural(done, "step")} of ${steps.length}. Here’s where I am.` : "Here’s where I am so far.",
    data: steps.map((s, i) => `${i + 1}. ${s.title}: ${s.status === "done" ? "done" : s.status === "off" ? "needs a fix" : "not yet"}${s.partial ? ` (${s.partial})` : ""}`).join(" · "),
    reply: issue ? `Good to stop and look. ${issue}` : current ? `So far so good. Next: ${current.title.toLowerCase()}. ${next}` : next,
  };
}

function readPerpendicular(x: Ctx): Reading {
  const { m, nm, cm, P, hasLine, arcsAt, onArc, onSeg } = x;
  const A = x.g(0), B = x.g(1), a = nm(A), b = nm(B), AB = 1, half = 0.5;
  const arcsA = arcsAt(A), arcsB = arcsAt(B), arcs = [...arcsA, ...arcsB];
  const side = (p: string) => Math.sign(x.cross(x.sub(P(B), P(A)), x.sub(P(p), P(A))));
  const crossings = x.derived.filter(p => arcsA.some(q => onArc(p, q)) && arcsB.some(q => onArc(p, q)));
  const above = crossings.filter(p => side(p) < 0), below = crossings.filter(p => side(p) > 0);
  let pq: [string, string] | undefined;
  for (const p of above) for (const q of below) if (hasLine(p, q)) pq = [p, q];
  const M = pq ? x.derived.find(p => onSeg(p, P(A), P(B)) && onSeg(p, P(pq![0]), P(pq![1]))) : undefined;
  const narrow = arcs.filter(q => q.r <= half + 0.004);
  const rOf = (p: string, list: typeof arcs) => list.find(q => onArc(p, q))?.r ?? 0;
  const unequal = crossings.filter(p => !same(rOf(p, arcsA), rOf(p, arcsB)));
  const steps: Step[] = [
    { title: `Open the compass past half of ${a}${b}`, how: `Any opening works if it’s more than half of ${a}${b}.`, status: arcs.length ? (narrow.length ? "off" : "done") : m.r > half + 0.004 ? "done" : "todo" },
    { title: "Arcs from both ends, crossing above and below", how: `Same opening from ${a} and from ${b}. Sweep above and below ${a}${b}.`, status: above.length && below.length ? (unequal.length ? "off" : "done") : arcsA.length && arcsB.length && !crossings.length ? "off" : "todo", partial: `${Number(above.length > 0) + Number(below.length > 0)} of 2 crossings` },
    { title: "Join the two crossings", how: "Drag from the top crossing to the bottom one.", status: pq ? "done" : "todo" },
  ];
  const finished = !!(pq && M);
  const am = M ? x.dist(P(A), P(M)) : 0, mb = M ? x.dist(P(M), P(B)) : 0;
  const ang = M && pq ? x.angleAt(P(M), P(B), P(pq[0])) : 0;
  const perp = Math.abs(ang - 90) < 0.6;
  const success = finished && same(am, mb) && perp;
  let issue = "";
  /* Three different geometric situations, three explanations. With openings rA from A and rB from B:
     rA + rB < AB  → the circles never meet; rA + rB = AB → they touch once, on AB (the tangent case);
     rA + rB > AB  → two crossings, one each side, which is what the straightedge needs. */
  const reachA = Math.max(0, ...arcsA.map(q => q.r)), reachB = Math.max(0, ...arcsB.map(q => q.r));
  const sum = reachA + reachB, tol = 0.008;
  const twoSides = above.length > 0 && below.length > 0;
  if (narrow.length && arcsA.length && arcsB.length && !twoSides && sum < AB - tol)
    issue = `At ${cm(reachA)} cm from ${a} and ${cm(reachB)} cm from ${b} the arcs can’t meet: together they reach ${cm(sum)} cm, less than ${a}${b} (${cm(AB)} cm). Each opening needs to be more than half of ${a}${b} (${cm(half)} cm). Undo, open the compass wider and sweep again.`;
  else if (narrow.length && arcsA.length && arcsB.length && !twoSides && Math.abs(sum - AB) <= tol)
    issue = same(reachA, reachB)
      ? `At exactly half of ${a}${b} (${cm(half)} cm) the two circles only touch, at one point: the middle of ${a}${b}. That point is on ${a}${b} itself, so there’s no second crossing to join it to and nothing to draw the line through. Open the compass a little wider than half: then the arcs cross twice, once above and once below.`
      : `These openings add up to exactly ${a}${b} (${cm(AB)} cm), so the circles only touch, once, on ${a}${b} itself. A line needs two crossings, one on each side. Open the compass wider than half of ${a}${b} and use the same opening from both ends.`;
  else if (arcsA.length && arcsB.length && !crossings.length) issue = sum > AB + tol
    ? `The arcs haven’t crossed yet. Wider than half of ${a}${b}, arcs from both ends overlap past the middle, so they will cross twice, once above and once below. Keep sweeping each one over the middle of ${a}${b}.`
    : `The arcs haven’t crossed yet. Keep sweeping each one over the middle of ${a}${b}.`;
  else if (unequal.length) { const p = unequal[0]; issue = `The arcs that meet at ${nm(p)} were ${cm(rOf(p, arcsA))} cm from ${a} but ${cm(rOf(p, arcsB))} cm from ${b}, so ${nm(p)} is closer to one end. Points the same distance from both ends need the same opening.`; }
  let next = "", cue: Cue = {};
  const r0 = m.r > half + 0.004 ? null : 0.75;
  if (finished) next = success ? `${nm(M!)} is the midpoint: ${a}${nm(M!)} = ${nm(M!)}${b} = ${cm(am)} cm, and the line meets ${a}${b} at 90°.` : "";
  else if (pq) next = "";
  else if (above.length && below.length) { next = `Drag from ${nm(above[0])} to ${nm(below[0])} to draw the line through both crossings.`; cue = { nib: above[0] }; }
  else if (!arcs.length) {
    if (x.needleAt !== A && x.needleAt !== B) { next = `Drop the compass needle on ${a}.`; cue = { needle: A }; }
    else if (r0 !== null) { next = `Open the compass wider than half of ${a}${b}: drag the pencil leg out past the middle.`; cue = { pencil: x.needleAt! }; }
    else { next = "Twist the handle to sweep an arc above and below the segment."; cue = { knob: true }; }
  } else {
    const missingEnd = !arcsA.length ? A : !arcsB.length ? B : null;
    if (missingEnd) {
      if (x.needleAt !== missingEnd) { next = `Move the needle to ${nm(missingEnd)} without changing the opening.`; cue = { needle: missingEnd }; }
      else { next = "Twist the handle to sweep the matching arc above and below."; cue = { knob: true }; }
    } else { next = `You have the crossing ${above.length ? "above" : "below"}. Sweep both arcs ${above.length ? "below" : "above"} ${a}${b} too.`; cue = { knob: true }; }
  }
  if (issue) cue = {};
  const marks: Mark[] = [];
  if (finished && M) {
    marks.push({ kind: "length", a: P(A), b: P(M), text: cm(am), tone: same(am, mb) ? "ok" : "off", ticks: same(am, mb) ? 1 : 0, side: x.v(0, 1) });
    marks.push({ kind: "length", a: P(M), b: P(B), text: cm(mb), tone: same(am, mb) ? "ok" : "off", ticks: same(am, mb) ? 1 : 0, side: x.v(0, 1) });
    if (perp) marks.push({ kind: "right", at: P(M), u: x.norm(x.sub(P(B), P(M))), w: x.norm(x.sub(P(pq![0]), P(M))) });
    else marks.push({ kind: "angle", at: P(M), from: x.deg(x.sub(P(B), P(M))), to: x.deg(x.sub(P(pq![0]), P(M))), text: fmtDeg(ang), tone: "off" });
  }
  let summary;
  const mn = M ? nm(M) : "M";
  if (success) summary = { learner: "I bisected the segment.", data: `${a}${mn} = ${mn}${b} = ${cm(am)} cm · line meets ${a}${b} at 90°`,
    reply: `Both crossings are the same distance from ${a} as from ${b}, because each sits on two arcs with the same opening. Every such point lies on one line, the perpendicular bisector, so the line through them hits ${a}${b} at its midpoint and at a right angle.` };
  else if (finished) summary = { learner: "I drew the line, but it’s off centre.", data: `${a}${mn} ${cm(am)} cm · ${mn}${b} ${cm(mb)} cm · angle ${fmtDeg(ang)}`,
    reply: perp
      ? `Your line is still at 90° to ${a}${b}: two crossing circles always share a chord at right angles to the line joining their centres. But your openings differed, so it cuts ${a}${b} into ${cm(am)} and ${cm(mb)} cm. Keep one opening for every arc and it lands in the middle.`
      : `The line joins crossings made with different openings, so it isn’t at 90° (${fmtDeg(ang)}) and splits ${a}${b} into ${cm(am)} and ${cm(mb)} cm. Use one opening for all four arcs.` };
  else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished, success, marks, roles: [...above, ...below, ...(M ? [M] : [])], cue, summary,
    measures: { AM: M ? +cm(am) : null, MB: M ? +cm(mb) : null, angle: M ? +ang.toFixed(1) : null, crossings: crossings.length } };
}

/* Shared by angle bisector and copy angle: an arc from the vertex across both arms. */
function armCrossings(x: Ctx, O: string, A: string, B: string) {
  const { P, onSeg, onArc, arcsAt } = x;
  const arcsO = arcsAt(O);
  for (const arc of arcsO) {
    const p = x.derived.find(q => onSeg(q, P(O), P(A)) && onArc(q, arc));
    const q = x.derived.find(q2 => onSeg(q2, P(O), P(B)) && onArc(q2, arc));
    if (p && q) return { arc, p, q };
  }
  const p = x.derived.find(q => onSeg(q, P(O), P(A)) && arcsO.some(a => onArc(q, a)));
  const q = x.derived.find(q2 => onSeg(q2, P(O), P(B)) && arcsO.some(a => onArc(q2, a)));
  return { arc: undefined, p, q };
}

function readAngleBisector(x: Ctx): Reading {
  const { nm, P, hasLine, arcsAt, onArc, c } = x;
  const O = x.g(0), A = x.g(1), B = x.g(2), o = nm(O), a = nm(A), b = nm(B);
  const first = armCrossings(x, O, A, B);
  const Pp = first.arc ? first.p : undefined, Q = first.arc ? first.q : undefined;
  const arcsP = Pp ? arcsAt(Pp) : [], arcsQ = Q ? arcsAt(Q) : [];
  const theta = c.angle;
  const inside = (id: string) => { const d = -x.deg(x.sub(P(id), P(O))); return d > 0.5 && d < theta - 0.5 && x.dist(P(id), P(O)) > 0.15; };
  const crossings = x.derived.filter(p => arcsP.some(q => onArc(p, q)) && arcsQ.some(q => onArc(p, q)) && inside(p));
  const rOf = (p: string, list: Arc[]) => list.find(q => onArc(p, q))?.r ?? 0;
  const R = crossings.find(p => hasLine(O, p)) ?? crossings[0];
  const ray = !!R && hasLine(O, R);
  const aor = R ? x.angleAt(P(O), P(A), P(R)) : 0, rob = R ? x.angleAt(P(O), P(R), P(B)) : 0;
  const success = ray && Math.abs(aor - rob) < 0.6;
  const pq = Pp && Q ? x.dist(P(Pp), P(Q)) : 0;
  const unequal = R && !same(rOf(R, arcsP), rOf(R, arcsQ));
  const steps: Step[] = [
    { title: "Arc from the vertex across both arms", how: `Needle on ${o}, sweep one arc that cuts ${o}${a} and ${o}${b}.`, status: Pp && Q ? "done" : "todo", partial: Pp && Q ? undefined : `${Number(!!first.p) + Number(!!first.q)} of 2 arms` },
    { title: "Equal arcs from those two points", how: "Same opening from each point, crossing inside the angle.", status: R ? (unequal ? "off" : "done") : arcsP.length && arcsQ.length ? "off" : "todo", partial: R ? undefined : `${Number(arcsP.length > 0) + Number(arcsQ.length > 0)} of 2` },
    { title: "Draw the ray through the crossing", how: `Drag from ${o} to where the two arcs cross.`, status: ray ? "done" : "todo" },
  ];
  let issue = "";
  if (first.p && first.q && !first.arc) issue = `The points on the two arms came from different arcs, so they aren’t the same distance from ${o}. Sweep one arc, at one opening, across both arms.`;
  else if (arcsP.length && arcsQ.length && !crossings.length) {
    const rp = Math.max(...arcsP.map(q => q.r)), rq = Math.max(...arcsQ.map(q => q.r));
    issue = rp + rq < pq ? `These arcs are too short to meet (${x.cm(rp)} and ${x.cm(rq)} cm, but ${nm(Pp!)} and ${nm(Q!)} are ${x.cm(pq)} cm apart). Undo and open the compass wider.` : "The arcs haven’t crossed inside the angle yet. Keep sweeping them toward each other.";
  } else if (unequal) issue = `The arcs meeting at ${nm(R!)} were ${x.cm(rOf(R!, arcsP))} and ${x.cm(rOf(R!, arcsQ))} cm, so ${nm(R!)} leans toward one arm. Use the same opening from ${nm(Pp!)} and from ${nm(Q!)}.`;
  let next = "", cue: Cue = {};
  if (ray) next = success ? `Two equal angles of ${fmtDeg(aor)}: the ray ${o}${nm(R!)} bisects angle ${a}${o}${b}.` : "";
  else if (R) { next = `Drag from ${o} to ${nm(R)} to draw the ray.`; cue = { nib: O }; }
  else if (!(Pp && Q)) ({ text: next, cue } = compassMove(x, O, null, "", `across both arms`));
  else {
    const missing = !arcsP.length ? Pp! : !arcsQ.length ? Q! : null;
    if (missing) ({ text: next, cue } = compassMove(x, missing, null, "", "into the middle of the angle", arcsP.length || arcsQ.length ? " and keep the opening" : ""));
    else { next = "Keep sweeping until the two arcs cross inside the angle."; cue = { knob: true }; }
  }
  if (issue) cue = {};
  const marks: Mark[] = [];
  const dA = x.deg(x.sub(P(A), P(O))), dB = x.deg(x.sub(P(B), P(O)));
  if (R && ray) {
    const dR = x.deg(x.sub(P(R), P(O)));
    marks.push({ kind: "angle", at: P(O), from: dA, to: dR, text: fmtDeg(aor), tone: success ? "ok" : "off", r: 0.36 });
    marks.push({ kind: "angle", at: P(O), from: dR, to: dB, text: fmtDeg(rob), tone: success ? "ok" : "off", r: 0.5 });
  } else marks.push({ kind: "angle", at: P(O), from: dA, to: dB, text: fmtDeg(theta), tone: "plain", r: 0.3 });
  const rn = R ? nm(R) : "R";
  let summary;
  if (success) summary = { learner: "I bisected the angle.", data: `∠${a}${o}${rn} = ∠${rn}${o}${b} = ${fmtDeg(aor)} (angle ${fmtDeg(theta)})`,
    reply: `The first arc made ${nm(Pp!)} and ${nm(Q!)} the same distance from ${o}. The equal arcs made ${rn} the same distance from ${nm(Pp!)} and ${nm(Q!)}. So triangles ${o}${nm(Pp!)}${rn} and ${o}${nm(Q!)}${rn} have three equal sides, and their angles at ${o} must match: ${fmtDeg(aor)} each.` };
  else if (ray) summary = { learner: "I drew the ray, but the two angles aren’t equal.", data: `∠${a}${o}${rn} ${fmtDeg(aor)} · ∠${rn}${o}${b} ${fmtDeg(rob)}`,
    reply: `Your ray splits the ${fmtDeg(theta)} angle into ${fmtDeg(aor)} and ${fmtDeg(rob)}. The arcs from the two arm points used different openings (${x.cm(rOf(R!, arcsP))} and ${x.cm(rOf(R!, arcsQ))} cm), so ${rn} isn’t equally far from both. Redraw them with one opening.` };
  else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished: ray, success, marks, roles: [Pp, Q, R].filter(Boolean) as string[], cue, summary,
    measures: { left: R ? +aor.toFixed(1) : null, right: R ? +rob.toFixed(1) : null } };
}

function readCopySegment(x: Ctx): Reading {
  const { m, nm, cm, P, hasLine, arcsAt, onArc, onSeg, L } = x;
  const A = x.g(0), B = x.g(1), C = x.g(2), a = nm(A), b = nm(B), cc = nm(C), AB = 1;
  const ray = L.segs.find(s => s.id === "s-ray")!;
  const arcsC = arcsAt(C);
  const Ds = x.derived.filter(p => onSeg(p, ray.a, ray.b) && arcsC.some(q => onArc(p, q)));
  const D = Ds.find(p => hasLine(C, p)) ?? Ds[0];
  const rD = D ? arcsC.find(q => onArc(D, q))!.r : 0;
  const drawn = !!D && hasLine(C, D);
  const success = drawn && same(rD, AB);
  const steps: Step[] = [
    { title: `Set the compass to ${a}${b}`, how: `Needle on ${a}, pencil leg onto ${b}.`, status: arcsC.length ? (arcsC.every(q => same(q.r, AB)) ? "done" : "off") : same(m.r, AB) ? "done" : "todo" },
    { title: `Move the needle to ${cc}`, how: "Carry the compass without changing its opening.", status: x.needleAt === C || arcsC.length ? "done" : "todo" },
    { title: "Sweep an arc across the line", how: "Twist the handle until the arc cuts the line.", status: D ? "done" : "todo" },
    { title: `Draw the copy from ${cc}`, how: "Drag from the start of the line to where the arc cut it.", status: drawn ? "done" : "todo" },
  ];
  let issue = "";
  if (arcsC.length && arcsC.some(q => !same(q.r, AB))) { const q = arcsC.find(q2 => !same(q2.r, AB))!; issue = `That arc from ${cc} was drawn at ${cm(q.r)} cm, but ${a}${b} is ${cm(AB)} cm. The opening changed on the way. Undo it, reset the compass on ${a}${b}, and carry it over again.`; }
  let next = "", cue: Cue = {};
  const dn = D ? nm(D) : "D";
  if (drawn) next = success ? `${cc}${dn} is ${cm(rD)} cm, exactly ${a}${b}. The compass carried the length for you.` : "";
  else if (D) { next = `Drag from ${cc} to ${dn} to draw the copy.`; cue = { nib: C }; }
  else if (!same(m.r, AB) && !arcsC.length) ({ text: next, cue } = compassMove(x, A, AB, b, ""));
  else if (x.needleAt !== C) { next = `Now carry the compass to ${cc}: pick it up by a leg and drop the needle on ${cc}. The opening stays at ${a}${b}.`; cue = { needle: C }; }
  else { next = "Twist the handle to sweep an arc across the line."; cue = { knob: true }; }
  if (issue) cue = {};
  const marks: Mark[] = [{ kind: "length", a: P(A), b: P(B), text: `${cm(AB)} cm`, tone: success ? "ok" : "plain", ticks: success ? 1 : 0 }];
  if (D && drawn) marks.push({ kind: "length", a: P(C), b: P(D), text: success ? `${cm(rD)} cm` : `${cm(rD)} ≠ ${a}${b}`, tone: success ? "ok" : "off", ticks: success ? 1 : 0, side: x.v(0, 1) });
  let summary;
  if (success) summary = { learner: "I copied the segment.", data: `${a}${b} = ${cc}${dn} = ${cm(AB)} cm`,
    reply: `The compass held ${a}${b}’s length while you moved it, so every point on the arc from ${cc} is ${cm(AB)} cm away, and ${dn} is the one on the line. That’s Euclid’s trick: compasses copy lengths so you never need a ruler.` };
  else if (drawn) summary = { learner: "I copied the segment, but it came out a different length.", data: `${a}${b} ${cm(AB)} cm · ${cc}${dn} ${cm(rD)} cm`,
    reply: `Your copy is ${cm(rD)} cm but ${a}${b} is ${cm(AB)} cm: the opening changed between setting it on ${a}${b} and sweeping from ${cc}. Set it on ${a}${b}, then only move it by picking it up, not by the pencil leg.` };
  else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished: drawn, success, marks, roles: D ? [D] : [], cue, summary, measures: { AB: +cm(AB), CD: D ? +cm(rD) : null } };
}

function readCopyAngle(x: Ctx): Reading {
  const { m, nm, P, hasLine, arcsAt, onArc, onSeg, L, c } = x;
  const O = x.g(0), A = x.g(1), B = x.g(2), Pp = x.g(3), o = nm(O), a = nm(A), b = nm(B), p = nm(Pp);
  const ray = L.segs.find(s => s.id === "s-ray")!;
  const first = armCrossings(x, O, A, B);
  const S = first.arc ? first.p : undefined, T = first.arc ? first.q : undefined;
  const r1 = first.arc?.r ?? 0;
  const arcsP = arcsAt(Pp);
  const Us = x.derived.filter(q => onSeg(q, ray.a, ray.b) && arcsP.some(z => onArc(q, z)));
  const U = Us.find(q => S && same(arcsP.find(z => onArc(q, z))!.r, r1)) ?? Us[0];
  const rU = U ? arcsP.find(z => onArc(U, z))!.r : 0;
  const st = S && T ? x.dist(P(S), P(T)) : 0;
  const arcsU = U ? arcsAt(U) : [];
  const Vs = U ? x.derived.filter(q => arcsU.some(z => onArc(q, z)) && arcsP.some(z => onArc(q, z)) && P(q).y < P(Pp).y - 0.02) : [];
  const V = Vs.find(q => hasLine(Pp, q)) ?? Vs[0];
  const drawn = !!V && hasLine(Pp, V);
  const copied = V ? x.angleAt(P(Pp), ray.b, P(V)) : 0;
  const success = drawn && Math.abs(copied - c.angle) < 0.6;
  const rV = V ? arcsU.find(z => onArc(V, z))!.r : 0;
  const steps: Step[] = [
    { title: "Arc from the vertex across both arms", how: `Needle on ${o}, one arc cutting ${o}${a} and ${o}${b}.`, status: S && T ? "done" : "todo" },
    { title: `Same arc from ${p} across the line`, how: `Keep the opening, needle on ${p}.`, status: U ? (S && same(rU, r1) ? "done" : "off") : "todo" },
    { title: "Measure the opening between the arms", how: S && T ? `Needle on ${nm(S)}, pencil onto ${nm(T)}.` : "Needle on one arm’s point, pencil on the other.", status: arcsU.length ? (arcsU.every(z => same(z.r, st)) ? "done" : "off") : st && same(m.r, st) ? "done" : "todo" },
    { title: "Mark it off on the new arc", how: U ? `Needle on ${nm(U)}, sweep across the arc from ${p}.` : "Needle on the new point, sweep across the arc.", status: V ? "done" : "todo" },
    { title: "Draw the new arm", how: `Drag from ${p} through the crossing.`, status: drawn ? "done" : "todo" },
  ];
  let issue = "";
  if (U && S && !same(rU, r1)) issue = `The arc from ${p} was ${x.cm(rU)} cm, but the arc at ${o} was ${x.cm(r1)} cm. The two arcs must match so the same chord fits both angles. Undo it and redraw at the first opening.`;
  else if (arcsU.length && st && arcsU.some(z => !same(z.r, st))) issue = `The arc from ${nm(U!)} was ${x.cm(arcsU[0].r)} cm, but ${nm(S!)}${nm(T!)} is ${x.cm(st)} cm. Set the compass on ${nm(S!)} and ${nm(T!)} again.`;
  let next = "", cue: Cue = {};
  if (drawn) next = success ? `The new angle is ${fmtDeg(copied)}, the same as angle ${a}${o}${b}.` : "";
  else if (V) { next = `Drag from ${p} to ${nm(V)} to draw the new arm.`; cue = { nib: Pp }; }
  else if (!(S && T)) ({ text: next, cue } = compassMove(x, O, null, "", "across both arms"));
  else if (!U) ({ text: next, cue } = compassMove(x, Pp, r1, `the same opening (${x.cm(r1)} cm)`, "across the line", " without changing the opening"));
  else if (!(arcsU.length) && !same(m.r, st)) {
    if (x.needleAt !== S && x.needleAt !== T) { next = `Measure the opening: drop the needle on ${nm(S)}.`; cue = { needle: S }; }
    else { next = `Drag the pencil leg onto ${nm(x.needleAt === S ? T : S)}.`; cue = { pencil: x.needleAt! }; }
  } else ({ text: next, cue } = compassMove(x, U, st, nm(T), `across the arc from ${p}`, " keeping that opening"));
  if (issue) cue = {};
  const marks: Mark[] = [{ kind: "angle", at: P(O), from: x.deg(x.sub(P(A), P(O))), to: x.deg(x.sub(P(B), P(O))), text: fmtDeg(c.angle), tone: success ? "ok" : "plain", r: 0.3 }];
  if (V && drawn) marks.push({ kind: "angle", at: P(Pp), from: 0, to: x.deg(x.sub(P(V), P(Pp))), text: fmtDeg(copied), tone: success ? "ok" : "off", r: 0.3 });
  let summary;
  if (success) summary = { learner: "I copied the angle.", data: `angle at ${o} ${fmtDeg(c.angle)} · angle at ${p} ${fmtDeg(copied)}`,
    reply: `Both arcs share one radius and the chord ${nm(S!)}${nm(T!)} fits both, so the two triangles have three equal sides and the same angle at the vertex. You copied ${fmtDeg(c.angle)} without a protractor.` };
  else if (drawn) summary = { learner: "I copied the angle, but it came out different.", data: `angle at ${o} ${fmtDeg(c.angle)} · copy ${fmtDeg(copied)} · arcs ${x.cm(r1)}/${x.cm(rU)} cm, chord ${x.cm(st)}/${x.cm(rV)} cm`,
    reply: `Your copy is ${fmtDeg(copied)} instead of ${fmtDeg(c.angle)}. ${!same(rU, r1) ? `The arc at ${p} (${x.cm(rU)} cm) didn’t match the arc at ${o} (${x.cm(r1)} cm).` : `The chord you marked off was ${x.cm(rV)} cm, but ${nm(S!)}${nm(T!)} is ${x.cm(st)} cm.`} Matching both is what makes the angles equal.` };
  else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished: drawn, success, marks, roles: [S, T, U, V].filter(Boolean) as string[], cue, summary,
    measures: { copied: V ? +copied.toFixed(1) : null, angle: c.angle } };
}

function readHexagon(x: Ctx): Reading {
  const { m, nm, P, hasLine, arcsAt, cm } = x;
  const O = x.g(0), Pp = x.g(1), o = nm(O), p = nm(Pp), R = 1;
  const onCircle = (id: string) => Math.abs(x.dist(P(id), P(O)) - R) < 0.006;
  const ring = [Pp, ...x.derived.filter(onCircle)].sort((u, w) => ((x.deg(x.sub(P(u), P(O))) + 360) % 360) - ((x.deg(x.sub(P(w), P(O))) + 360) % 360));
  const arcs = m.arcs.filter(a => ring.includes(a.center));
  const wrong = arcs.filter(a => !same(a.r, R));
  const angles = ring.map(id => ((x.deg(x.sub(P(id), P(O))) + 360) % 360));
  const gaps = angles.map((d, i) => ((angles[(i + 1) % angles.length] - d) + 360) % 360 || 360);
  const evenSix = ring.length === 6 && gaps.every(g => Math.abs(g - 60) < 0.5);
  /* Sides: straightedge lines between ring points; closed when they form one loop. */
  const sides = m.lines.filter(l => ring.includes(l.a) && ring.includes(l.b));
  const degree = new Map<string, number>();
  for (const l of sides) for (const e of [l.a, l.b]) degree.set(e, (degree.get(e) ?? 0) + 1);
  let closed = false;
  if (sides.length >= 3 && [...degree.values()].every(d => d === 2)) {
    const seen = new Set<string>([sides[0].a]); let cur = sides[0].a, prev = "";
    for (let k = 0; k < sides.length; k++) {
      const l = sides.find(s => (s.a === cur || s.b === cur) && (s.a === prev || s.b === prev) === false) ?? sides.find(s => s.a === cur || s.b === cur);
      if (!l) break;
      const nxt = l.a === cur ? l.b : l.a; prev = cur; cur = nxt; seen.add(cur);
    }
    closed = cur === sides[0].a && seen.size === sides.length;
  }
  const sideLens = sides.map(l => x.dist(P(l.a), P(l.b)));
  const success = closed && sides.length === 6 && sideLens.every(d => same(d, R));
  const steps: Step[] = [
    { title: "Set the compass to the radius", how: `Needle on ${o}, pencil leg onto ${p}.`, status: arcs.length ? (wrong.length ? "off" : "done") : same(m.r, R) ? "done" : "todo" },
    { title: "Step the radius round the circle", how: `Needle on ${p}, arc across the circle; move to the new point and repeat.`, status: evenSix ? "done" : wrong.length ? "off" : "todo", partial: evenSix ? undefined : `${ring.length} of 6 points` },
    { title: "Join neighbouring points", how: "Drag from each point to the next one round.", status: success ? "done" : closed ? "off" : "todo", partial: closed ? undefined : `${sides.length} of 6 sides` },
  ];
  let issue = "";
  if (wrong.length) {
    const r = wrong[0].r, step = 2 * Math.asin(Math.min(1, r / 2)) * 180 / Math.PI, after = 360 - 6 * step;
    issue = `Your arcs were ${cm(r)} cm, but the radius is ${cm(R)} cm. Each step moves ${fmtDeg(step)} round the circle instead of 60°, so six steps ${after > 0 ? `fall ${fmtDeg(after)} short of ${p}` : `overshoot ${p} by ${fmtDeg(-after)}`}. Undo and set the compass on ${o}${p}.`;
  } else if (closed && !success) issue = `That loop has ${plural(sides.length, "side")}. Join each point only to its neighbours round the circle, six sides in all.`;
  let next = "", cue: Cue = {};
  const unstepped = ring.find(id => !arcsAt(id).length);
  if (closed) next = success ? `Six sides of ${cm(R)} cm: a regular hexagon. The radius fits round the circle exactly six times.` : "";
  else if (evenSix) {
    const missing = ring.find((id, i) => !hasLine(id, ring[(i + 1) % 6]));
    next = `Drag from ${nm(missing!)} to the next point round to draw a side.`; cue = { nib: missing };
  } else if (!arcs.length && !same(m.r, R)) ({ text: next, cue } = compassMove(x, O, R, p, ""));
  else if (unstepped) ({ text: next, cue } = compassMove(x, unstepped, R, `the radius (${cm(R)} cm)`, "across the circle", arcs.length ? " and keep the opening" : ""));
  else { next = "Keep stepping round: each new point gets its own arc."; cue = { knob: true }; }
  if (issue) cue = {};
  const marks: Mark[] = [];
  if (closed) sides.forEach((l, i) => marks.push({ kind: "length", a: P(l.a), b: P(l.b), text: i === 0 || !same(sideLens[i], R) ? cm(sideLens[i]) : "", tone: same(sideLens[i], R) ? (success ? "ok" : "plain") : "off", ticks: success ? 1 : 0, side: x.norm(x.sub(lerp(P(l.a), P(l.b), 0.5), P(O))) }));
  let summary;
  if (success) summary = { learner: "I built the hexagon.", data: `6 sides of ${cm(R)} cm on a circle of radius ${cm(R)} cm`,
    reply: `Each side is a radius long, so each slice from ${o} is an equilateral triangle with a 60° angle at the centre. Six of them make 360°, which is why the radius steps round exactly six times.` };
  else if (closed) summary = { learner: "I closed a shape, but it isn’t a regular hexagon.", data: `${plural(sides.length, "side")}: ${sideLens.map(d => cm(d)).join(", ")} cm`,
    reply: wrong.length ? issue : `Your loop has ${plural(sides.length, "side")} of ${sideLens.map(d => cm(d)).join(", ")} cm. A regular hexagon joins six points spaced one radius apart, each to its neighbour.` };
  else summary = partialSummary(steps, issue, next);
  return { steps, next, issue, finished: closed, success, marks, fill: closed ? { pts: ring.filter(id => degree.has(id)).map(id => P(id)), tone: success ? "ok" : "off" } : undefined,
    roles: ring.filter(id => id !== Pp), cue, summary, measures: { points: ring.length, sides: sides.length } };
}

