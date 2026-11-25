import {
  DraggableRenderer, Modifier, modifier, translate,
  type DragFrame, type DragInitContext, type DragSpec, type DragSpecBuilder, type DragSpecData, type Draggable, type Svgx, type Vec2,
} from "dragology";
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  candidates, eqCanon, eqExact, evalExpr, exprCanon, factorPreview, termKeys, fmtNum, goalReached, nodeList, parseEquation, pointWhereDifferent, samePolynomial, settleAsk, shortestRoute, solveLinearExact,
  txt, txtEq, varsOf, type Cand, type Eq, type Expr, type Goal, type MoveInfo, type Side, type Slip, type Term,
} from "./model";
import "./component.css";

/* ---------- Public contract ---------- */
export type ShareSummary = { learner: string; data: string; reply: string };
export type EquationWorkbenchConfig = {
  /** The starting line: an equation ("3x - 5 = x + 7") or, for expand/simplify/factor, an expression ("(a + b)^2"). */
  expression: string;
  /** isolate: get `variable` alone. equivalent: make both sides read the same. expand / simplify: no brackets or like terms left. factor: pull out the common factor. */
  goal: Goal;
  /** For isolate. Default "x". */
  variable?: string;
  /** Worked-example fading: after this many automatic sign changes, the learner chooses the sign of a term moved across the =. Omit to always flip it for them. */
  fadeAfter?: number;
  /** For expand / simplify: what the learner suspects the expression equals ("a^2 + b^2"). The finished reply answers yes or no and says what differs. */
  compareWith?: string;
  /** Optional heading. */
  title?: string;
};
const KEYS = ["expression", "goal", "variable", "fadeAfter", "compareWith", "title"];
const GOALS: Goal[] = ["isolate", "equivalent", "simplify", "expand", "factor"];

export const presets: Record<string, EquationWorkbenchConfig> = {
  bothSides: { expression: "3x - 5 = x + 7", goal: "isolate", fadeAfter: 1 },
  brackets: { expression: "2(x + 1) = 10", goal: "isolate", fadeAfter: 0 },
  fraction: { expression: "(x + 6)/3 = 2x - 3", goal: "isolate", fadeAfter: 2 },
  expandSquare: { expression: "(a + b)^2", goal: "expand", compareWith: "a^2 + b^2", title: "Expand (a + b)²" },
  factor: { expression: "6x + 9", goal: "factor" },
  sameOrNot: { expression: "2(x + 3) - x = x + 6", goal: "equivalent", title: "Are these the same expression?" },
};
export const scenario = {
  tab: "Algebra",
  prompt: "How do I solve 3x − 5 = x + 7?",
  intro: "Get x on its own, one balanced move at a time: whatever you do to one side you do to the other. Move the terms themselves. Drag one across the = and its sign changes, drop it on a like term and they combine, and drag a number across the = and drop it under the other side to divide.",
  receiptLabel: "Equation workbench",
  receiptText: "The learner asked how to solve a linear equation. Each drag is checked by an expression model: legal moves keep both sides equal, and common slips (sign, dividing one term, combining unlike terms) can be tried and are explained rather than applied.",
  preset: "bothSides",
};
export const variants: Record<string, { label: string; prompt: string; intro: string; receiptLabel?: string; receiptText?: string }> = {
  bothSides: { label: "Both sides", prompt: scenario.prompt, intro: scenario.intro },
  brackets: { label: "Brackets", prompt: "How do I solve 2(x + 1) = 10?", intro: "There are two good first moves here: multiply the 2 into the bracket, or divide both sides by 2. Try one, then rewind and try the other." },
  fraction: { label: "Fraction", prompt: "How do I get rid of the fraction in (x + 6)/3 = 2x − 3?", intro: "Multiply both sides by 3 and the fraction is gone. Drag the 3 across the =, then keep going until x is alone." },
  expandSquare: { label: "Expand a square", prompt: "Is (a + b)² the same as a² + b²?", intro: "Build it and see. Drag the little 2 down under its bracket to write the square out, then multiply the brackets term by term yourself.",
    receiptText: "The learner asked whether (a + b)² equals a² + b². The workbench lets them expand it by hand; squaring each term can be tried and is explained instead of applied." },
  factor: { label: "Factor", prompt: "How do I factor 6x + 9?", intro: "Find a number that goes into every term and pull it out in front. Drag a number out past the left edge, then choose what to take out.",
    receiptText: "The learner asked how to factor 6x + 9. They choose the factor themselves; numbers that don't divide every term are explained instead of applied." },
  sameOrNot: { label: "Same or not", prompt: "Is 2(x + 3) − x the same as x + 6?", intro: "Simplify the left side and see if it turns into the right side." },
};

/* ---------- Validation ---------- */
type Checked = { ok: true; eq: Eq; goal: Goal; v: string; fadeAfter: number; title: string; solution: number | null; compare: Eq | null } | { ok: false; error: string };
function check(config: unknown): Checked {
  if (!config || typeof config !== "object") return { ok: false, error: "No workbench settings were given." };
  if (Array.isArray(config)) return { ok: false, error: "The workbench settings must be an object." };
  const unknown = Object.keys(config).filter(k => !KEYS.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown setting “${unknown[0]}”.` };
  const c = config as Partial<EquationWorkbenchConfig>;
  if (!GOALS.includes(c.goal as Goal)) return { ok: false, error: `The goal must be one of ${GOALS.join(", ")}.` };
  const goal = c.goal as Goal;
  const parsed = parseEquation(c.expression);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const eq = parsed.eq;
  if (c.variable !== undefined && !(typeof c.variable === "string" && /^[a-zA-Z]$/.test(c.variable))) return { ok: false, error: "The variable must be a single letter." };
  const v = c.variable ?? "x";
  if ((goal === "isolate" || goal === "equivalent") && !eq.rhs) return { ok: false, error: "This goal needs an equation with an = sign." };
  if (goal === "factor" && eq.rhs) return { ok: false, error: "Factoring works on an expression without an = sign." };
  let solution: number | null = null;
  if (goal === "isolate") {
    if (!varsOf(eq).includes(v) || varsOf(eq).length !== 1) return { ok: false, error: `The equation should contain only the letter ${v}.` };
    const solved = solveLinearExact(eq, v);
    if (!solved.ok) return { ok: false, error: solved.error };
    solution = solved.x;
  }
  if (goal === "equivalent") {
    const cmp = samePolynomial(eq.lhs, eq.rhs!);
    if (!cmp.ok) return { ok: false, error: cmp.error };
    if (!cmp.same) return { ok: false, error: "The two sides aren't equal, so they can never be made to read the same. To test a suspected identity, expand one side with compareWith." };
  }
  if (goalReached(eq, goal, v)) return { ok: false, error: goal === "isolate" ? `${v} is already on its own.` : "That already meets the goal, so there is nothing to do." };
  if (c.fadeAfter !== undefined && !(typeof c.fadeAfter === "number" && Number.isInteger(c.fadeAfter) && c.fadeAfter >= 0 && c.fadeAfter < 10))
    return { ok: false, error: "fadeAfter must be a whole number from 0 to 9." };
  let compare: Eq | null = null;
  if (c.compareWith !== undefined) {
    if (goal !== "expand" && goal !== "simplify") return { ok: false, error: "compareWith is only for the expand and simplify goals." };
    const cp = parseEquation(c.compareWith);
    if (!cp.ok) return { ok: false, error: `compareWith: ${cp.error}` };
    if (cp.eq.rhs || eq.rhs) return { ok: false, error: "compareWith must be an expression without =, compared with an expression without =." };
    const cmp = samePolynomial(eq.lhs, cp.eq.lhs);
    if (!cmp.ok) return { ok: false, error: `compareWith: ${cmp.error}` };
    compare = cp.eq;
  }
  if (c.title !== undefined && (typeof c.title !== "string" || c.title.length > 60)) return { ok: false, error: "The title must be text of at most 60 characters." };
  const fadeAfter = c.fadeAfter ?? Infinity;
  const title = c.title?.trim() ? c.title.trim()
    : goal === "isolate" ? `Solve ${txtEq(eq)}` : goal === "expand" ? `Expand ${txtEq(eq)}` : goal === "factor" ? `Factor ${txtEq(eq)}`
    : goal === "simplify" ? `Simplify ${txtEq(eq)}` : "Show both sides are the same";
  return { ok: true, eq, goal, v, fadeAfter, title, solution, compare };
}
/** [] when the config is usable; otherwise one plain sentence per problem (the component shows the first). */
export function validateEquationWorkbench(config: unknown): string[] {
  const r = check(config);
  return r.ok ? [] : [r.error];
}

/* ---------- Canvas state and layout (after Dragology's graspable-math demo) ---------- */
type Puff = { expr: Expr; sign: 1 | -1 | null; font: number; at: { x: number; y: number }; slip: boolean };
type Ring = { id: string; slip: boolean };
type DState = Eq & { puff?: Puff; move?: MoveInfo; rings?: Ring[]; slots?: string[] };
type Ctx = {
  state: DState; d: DragSpecBuilder<DState>; idle: boolean; hidden?: boolean;
  size: number; font: number; W: number; H: number;
  cands: Map<string, Cand[]>; goal: Goal; v: string; reduced: boolean;
  /** Nothing moved yet: draw the pick-up dots. */
  start?: boolean;
  /** Inside a node that can be dragged (so its symbols get pick-up dots). */
  grab?: boolean;
};
const FONT_FAMILY = `"STIX Two Text", "Cambria Math", Cambria, "Times New Roman", Times, serif`;
const ASC = 0.72, DESC = 0.24, DIGIT_W = 0.52, LETTER_W = 0.5, PAREN_W = 0.36, BAR_AXIS = 0.27, BAR_GAP = 0.12, BAR_OVERHANG = 0.12, SCRIPT = 0.62;
const EQ_GAP = 0.55;
const strip = (s: DState): Eq => ({ lhs: s.lhs, rhs: s.rhs });

type Lead = { text: string; w: number };
const NO_LEAD: Lead = { text: "", w: 0 };
const dotLead = (em: number): Lead => ({ text: "·", w: 0.42 * em });
function termLead(t: Term, i: number, em: number): Lead {
  if (t.ask) return { text: "?", w: (i === 0 ? 0.9 : 1.2) * em };
  if (i === 0) return t.sign < 0 ? { text: "−", w: 0.68 * em } : NO_LEAD;
  return { text: t.sign < 0 ? "−" : "+", w: 1.1 * em };
}
const leadsWithDigit = (e: Expr): boolean => e.kind === "num" || (e.kind === "pow" && leadsWithDigit(e.base));
type Place = { lead: Lead; ask?: boolean; parens?: boolean; puff?: { slip: boolean } };
type Box = { w: number; asc: number; desc: number; draw: (x: number, y: number) => Svgx };
type Inner = { w: number; asc: number; desc: number; draw: () => Svgx[] };
const visible = (ctx: Ctx, shown: boolean) => (shown && !ctx.hidden ? 1 : 0);
const textProps = (ctx: Ctx) => ({ fontSize: ctx.font * ctx.size, fontFamily: FONT_FAMILY, textAnchor: "middle", pointerEvents: "none", className: "alg-glyph" }) as const;

/** Counts the wrapped spec out of a `closest` (infinite gap) unless `when(pointer)`; `force` makes it win outright when it holds. */
const onlyWhen = modifier(class<T extends object> extends Modifier<T> {
  readonly name = "onlyWhen";
  constructor(ctx: DragInitContext<T>, inner: DragSpecData<T>, readonly when: (p: Vec2) => boolean, readonly force = false) { super(ctx, inner); }
  frame(frame: DragFrame) {
    const r = this.inner.run(frame);
    return this.when(frame.pointer) ? (this.force ? { ...r, gap: 0 } : r) : { ...r, gap: Infinity };
  }
});

type NodeBox = { x: number; y: number; left: number; right: number; top: number; bottom: number };
function findNode(svg: Svgx, id: string, x = 0, y = 0): NodeBox | null {
  for (const [, tx, ty] of String(svg.props.transform ?? "").matchAll(/translate\(([^,]+),([^)]+)\)/g)) { x += Number(tx); y += Number(ty); }
  const children = Children.toArray(svg.props.children).filter(isValidElement) as Svgx[];
  if (svg.props.id === id) {
    const r = children[0].props as { x: number; y: number; width: number; height: number };
    const left = x + Number(r.x), top = y + Number(r.y);
    return { x, y, left, right: left + Number(r.width), top, bottom: top + Number(r.height) };
  }
  for (const child of children) { const f = findNode(child, id, x, y); if (f) return f; }
  return null;
}
type Where = (id: string) => NodeBox;
function nodeFinder(ctx: Ctx): Where {
  let svg: Svgx | null = null;
  return id => {
    svg ??= drawEquation(ctx);
    const b = findNode(svg, id);
    if (!b) throw new Error(`node ${id} isn't drawn`);
    return b;
  };
}

function specFor(ctx: Ctx, subject: string): DragSpec<DState> {
  const { d, state } = ctx;
  const where = nodeFinder(ctx);
  const list = ctx.cands.get(subject) ?? [];
  /* Merge targets are ringed in every preview where they still exist, so the rings move with the line. */
  /* Only legal targets are ringed: slips are there to be tried, not advertised. */
  const rings: Ring[] = list.flatMap(c => ((c.how.type === "merge" || c.how.type === "on-content") && !c.info.slip ? [{ id: c.how.target, slip: false }] : []))
    .filter((r, i, all) => all.findIndex(q => q.id === r.id) === i);
  /* Dashed slots under the other side show where "across and down" lands. */
  const slots = list.flatMap(c => (c.how.type === "zone" && !c.info.slip && (c.how.zone === "below" || c.how.zone === "below-or-parens") ? [c.how.target] : []))
    .filter((id, i, all) => all.indexOf(id) === i);
  const marks = { rings, slots };
  const em = ctx.font * ctx.size;
  const seenGroups = new Set<string>();
  const targets = list.flatMap((c): (DState | DragSpec<DState>)[] => {
    const how = c.how;
    if (c.info.group) {
      /* All the factor choices share one drop; the learner picks the number afterwards. */
      if (seenGroups.has(c.info.group) || how.type !== "left-of") return [];
      seenGroups.add(c.info.group);
      const preview = factorPreview(strip(state), c.info.group.replace(/^factor-/, ""));
      const info: MoveInfo = { kind: "factor", group: c.info.group, from: c.subject, label: "Take out a common factor", does: "Take out a common factor. Which number? You choose after you drop." };
      const edge = where(how.edge).left;
      return [d.fixed({ ...preview, move: info, ...marks }).onDrop({ ...preview, move: info }).with(onlyWhen((p: Vec2) => p.x < edge - 0.25 * ctx.font, true))];
    }
    return [target(c)];
  });
  function target(c: Cand): DState | DragSpec<DState> {
    const drop: DState = { ...c.state, move: c.info };
    const how = c.how;
    if (how.type === "zone") {
      const b = where(how.target);
      const split = b.bottom - 0.15 * em;
      const inRow = (p: Vec2) => p.y > b.top - 0.6 * em && p.y < split;
      const below = (p: Vec2) => p.y >= split && p.x >= b.left - 0.5 * em && p.x <= b.right + 0.5 * em;
      const paren = 0.45 * em;
      const test = how.zone === "below" ? below
        : how.zone === "before" ? (p: Vec2) => inRow(p) && p.x < b.left
        : how.zone === "after" ? (p: Vec2) => inRow(p) && p.x > b.right
        : (p: Vec2) => below(p) || (inRow(p) && p.y > b.top && ((p.x >= b.left - 0.2 * em && p.x <= b.left + paren) || (p.x <= b.right + 0.2 * em && p.x >= b.right - paren)));
      /* The preview already shows the result, so the slot that invited it steps aside. */
      return d.fixed({ ...drop, rings }).onDrop(drop).with(onlyWhen(test, true));
    }
    if (how.type === "merge") {
      const b = where(how.target);
      const slip = !!c.info.slip;
      const puff: Puff = { expr: how.puff.expr, sign: how.puff.sign, font: ctx.font * ctx.size, at: { x: b.x, y: b.y }, slip };
      const spec = d.dropTarget(how.target, { ...drop, puff }, { boundsState: state }).onDrop(drop);
      return how.penalty ? spec.changeGap(g => g + how.penalty!) : spec;
    }
    if (how.type === "on-content") {
      /* The whole term, its sign included: dropping on "+b" is dropping on b. */
      const b = where(how.target);
      const puff: Puff = { expr: how.puff.expr, sign: how.puff.sign, font: ctx.font * ctx.size, at: { x: b.x, y: b.y }, slip: !!c.info.slip };
      return d.fixed({ ...drop, puff }).onDrop(drop).with(onlyWhen((p: Vec2) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom, true));
    }
    if (how.type === "reorder") {
      const boxes = how.pass.map(where);
      const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right));
      return d.fixed({ ...drop, ...marks }).onDrop(drop).with(onlyWhen((p: Vec2) => (how.dir < 0 ? p.x < left : p.x > right)));
    }
    if (how.type === "left-of") {
      const edge = where(how.edge).left;
      return d.fixed({ ...drop, ...marks }).onDrop(drop).with(onlyWhen((p: Vec2) => p.x < edge - 0.25 * ctx.font, true));
    }
    return d.fixed({ ...drop, ...marks }).onDrop(drop);
  }
  let spec = d.closest(targets).whenFar({ ...state, ...marks }).withFloating();
  if (ctx.reduced) spec = spec.withDropTransition(1);
  return spec;
}

/** A node is grabbable only if dragging it can do something (not just "stay"). */
const movable = (ctx: Ctx, id: string) => !!ctx.cands.get(id)?.some(c => c.info.kind !== "stay");
function layout(e: Expr, p: Place, ctx: Ctx): Box {
  const inner = layoutInner(e, p, !ctx.grab && !ctx.hidden && movable(ctx, e.id) ? { ...ctx, grab: true } : ctx);
  const em = ctx.font * ctx.size;
  const w = p.lead.w + inner.w;
  const asc = Math.max(ASC * em, inner.asc), desc = Math.max(DESC * em, inner.desc);
  const draggable = !ctx.hidden && movable(ctx, e.id);
  const chipW = Math.max(p.lead.w - 0.3 * em, 0.55 * em);
  return {
    w, asc, desc,
    draw: (x, y) => (
      <g id={e.id} data-node={e.id} transform={translate(x + p.lead.w, y)} dragologyOnDrag={draggable ? () => specFor(ctx, e.id) : undefined}>
        <rect className="alg-hit" x={-p.lead.w} y={-asc} width={w} height={asc + desc} rx={6} pointerEvents={draggable ? "all" : "none"} />
        <rect className="alg-ask" transform={translate(-p.lead.w / 2 - chipW / 2, -0.78 * em)} width={chipW} height={1.02 * em} rx={0.18 * em} opacity={visible(ctx, !!p.ask)} pointerEvents="none" />
        <text transform={translate(-p.lead.w / 2, 0)} {...textProps(ctx)} opacity={visible(ctx, !!p.lead.text && !p.ask)}>{p.ask ? "+" : p.lead.text || "+"}</text>
        <text transform={translate(-p.lead.w / 2, 0)} {...textProps(ctx)} className="alg-ask-glyph" opacity={visible(ctx, !!p.ask)}>?</text>
        {inner.draw()}
        {p.puff && <g id={`${e.id}-${p.puff.slip ? "slip" : "puff"}`} dragologyZIndex={-1}>{drawPoof(inner.w / 2, -1.12 * em, em * 0.85, p.puff.slip)}</g>}
      </g>
    ),
  };
}
const POOF_BUMPS = [[-0.2, 0.04, 0.16], [-0.04, -0.11, 0.2], [0.17, -0.03, 0.17], [0.09, 0.13, 0.13], [-0.09, 0.13, 0.11]];
const POOF_WISPS = [[0.47, -0.26, 0.09], [-0.47, -0.2, 0.065], [0.39, 0.24, 0.055]];
function drawPoof(cx: number, cy: number, em: number, slip: boolean): Svgx {
  const line = slip ? "alg-poof-line alg-poof-slip" : "alg-poof-line";
  const circle = ([x, y, r]: number[], className: string, sw: number) => <circle transform={translate(x * em, y * em)} r={r * em} className={className} strokeWidth={sw} />;
  return (
    <g transform={translate(cx, cy)} opacity={0.8}>
      {POOF_BUMPS.map(b => circle(b, line, 3))}
      {POOF_BUMPS.map(b => circle(b, "alg-poof-fill", 0))}
      {POOF_WISPS.map(b => circle(b, `${line} alg-poof-wisp`, 2))}
    </g>
  );
}
function layoutInner(e: Expr, p: Place, ctx: Ctx): Inner {
  const em = ctx.font * ctx.size;
  const text = textProps(ctx);
  switch (e.kind) {
    case "num": case "var": {
      const label = e.kind === "num" ? String(e.value) : e.name;
      const w = (e.kind === "num" ? label.length * DIGIT_W : LETTER_W) * em;
      return { w, asc: ASC * em, desc: DESC * em, draw: () => [
        <text transform={translate(w / 2, 0)} {...text} fontStyle={e.kind === "var" ? "italic" : "normal"} opacity={visible(ctx, true)}>{label}</text>,
        /* Pick-up dots under every symbol at the start: everything here can be moved, without saying which move is right. */
        <line className="alg-grip" x1={0.1 * em} x2={Math.max(w - 0.1 * em, 0.12 * em)} y1={0.2 * em} y2={0.2 * em} opacity={visible(ctx, !!ctx.start && !!ctx.grab)} pointerEvents="none" />,
      ] };
    }
    case "sum": {
      const kids = e.terms.map((t, i) => layout(t.expr, { lead: termLead(t, i, em), ask: !!t.ask, parens: t.expr.kind === "sum" }, ctx));
      const pw = p.parens ? PAREN_W * em : 0;
      const xs = kids.reduce<number[]>((acc, k) => [...acc, acc[acc.length - 1] + k.w], [pw]);
      const w = xs[xs.length - 1] + pw;
      return { w, asc: Math.max(...kids.map(k => k.asc)), desc: Math.max(...kids.map(k => k.desc)), draw: () => [
        <text transform={translate((PAREN_W * em) / 2, 0)} {...text} opacity={visible(ctx, !!p.parens)}>(</text>,
        <text transform={translate(w - (PAREN_W * em) / 2, 0)} {...text} opacity={visible(ctx, !!p.parens)}>)</text>,
        ...kids.map((k, i) => k.draw(xs[i], 0)),
      ] };
    }
    case "prod": {
      const kids = e.factors.map((f, i) => layout(f, { lead: i > 0 && leadsWithDigit(f) ? dotLead(em) : NO_LEAD, parens: f.kind === "sum" }, ctx));
      const xs = kids.reduce<number[]>((acc, k) => [...acc, acc[acc.length - 1] + k.w], [0]);
      return { w: xs[xs.length - 1], asc: Math.max(...kids.map(k => k.asc)), desc: Math.max(...kids.map(k => k.desc)), draw: () => kids.map((k, i) => k.draw(xs[i], 0)) };
    }
    case "frac": {
      const top = layout(e.num, { lead: NO_LEAD }, ctx), bottom = layout(e.den, { lead: NO_LEAD }, ctx);
      const barW = Math.max(top.w, bottom.w) + 2 * BAR_OVERHANG * em;
      const barY = -BAR_AXIS * em;
      const topY = barY - BAR_GAP * em - top.desc, bottomY = barY + BAR_GAP * em + bottom.asc;
      const pad = 0.08 * em;
      return { w: barW + 2 * pad, asc: -topY + top.asc, desc: bottomY + bottom.desc, draw: () => [
        <rect className="alg-bar" transform={translate(pad, barY - 0.045 * em)} width={barW} height={0.09 * em} opacity={visible(ctx, true)} pointerEvents="none" />,
        top.draw(pad + (barW - top.w) / 2, topY),
        bottom.draw(pad + (barW - bottom.w) / 2, bottomY),
      ] };
    }
    case "pow": {
      const script = { ...ctx, size: ctx.size * SCRIPT };
      const wrap = !["num", "var", "sum"].includes(e.base.kind);
      const pw = wrap ? PAREN_W * em : 0;
      const base = layout(e.base, { lead: NO_LEAD, parens: e.base.kind === "sum" }, ctx);
      const exp = layout(e.exp, { lead: NO_LEAD }, script);
      const expX = 2 * pw + base.w + 0.04 * em;
      const expY = -Math.max(0.42 * em, base.asc - 0.3 * em, exp.desc + 0.2 * em);
      return { w: expX + exp.w, asc: Math.max(base.asc, exp.asc - expY), desc: Math.max(base.desc, exp.desc + expY), draw: () => [
        <text transform={translate((PAREN_W * em) / 2, 0)} {...text} opacity={visible(ctx, wrap)}>(</text>,
        <text transform={translate(pw + base.w + (PAREN_W * em) / 2, 0)} {...text} opacity={visible(ctx, wrap)}>)</text>,
        base.draw(pw, 0),
        exp.draw(expX, expY),
      ] };
    }
  }
}
function drawPuff(ctx: Ctx, { expr, sign, font, at, slip }: Puff): Svgx {
  const c2 = { ...ctx, hidden: true, font, size: 1 };
  const lead = sign === null ? NO_LEAD : { text: sign < 0 ? "−" : "+", w: 0.68 * font };
  return layout(expr, { lead, parens: expr.kind === "sum", puff: { slip } }, c2).draw(at.x - lead.w, at.y);
}
function measure(eq: Eq, ctx: Ctx) {
  const l = layout(eq.lhs, { lead: NO_LEAD }, ctx);
  const r = eq.rhs ? layout(eq.rhs, { lead: NO_LEAD }, ctx) : null;
  const gap = EQ_GAP * ctx.font;
  return { l, r, total: l.w + (r ? 2 * gap + r.w : 0), gap };
}
function drawEquation(ctx0: Ctx): Svgx {
  let ctx = { ...ctx0, size: 1 };
  const { state, W, H } = ctx;
  let m = measure(state, ctx);
  const room = W - 0.6 * ctx.font;
  if (m.total > room) { ctx = { ...ctx, font: ctx.font * room / m.total }; m = measure(state, ctx); }
  const baseline = Math.round(H * 0.56);
  /* Keep the = at the centre (as Graspable Math does) unless a side would run off the edge. */
  const edge = 0.3 * ctx.font;
  const x0 = !m.r ? (W - m.total) / 2
    : Math.min(Math.max(W / 2 - m.gap - m.l.w, edge), W - edge - m.total);
  const asc = Math.max(m.l.asc, m.r?.asc ?? 0), desc = Math.max(m.l.desc, m.r?.desc ?? 0);
  const pad = 0.42 * ctx.font;
  const solved = goalReached(state, ctx.goal, ctx.v) && ctx.idle;
  const body = (
    <g>
      <rect className="alg-glow" transform={translate(x0 - pad, baseline - asc - pad / 2)} width={m.total + 2 * pad} height={asc + desc + pad} rx={(asc + desc + pad) / 2} opacity={solved ? 1 : 0} pointerEvents="none" />
      {m.l.draw(x0, baseline)}
      <text transform={translate(x0 + m.l.w + m.gap, baseline)} {...textProps(ctx)} opacity={state.rhs ? 1 : 0}>=</text>
      {m.r ? m.r.draw(x0 + m.l.w + 2 * m.gap, baseline) : <g />}
      {/* The equation as a balance: a beam under both sides resting on the =. */}
      <rect className="alg-beam" transform={translate(x0 - 0.2 * ctx.font, baseline + desc + 0.18 * ctx.font)} width={m.total + 0.4 * ctx.font} height={1.5} opacity={state.rhs && ctx.idle ? 1 : 0} pointerEvents="none" />
      <path className="alg-fulcrum" transform={translate(x0 + m.l.w + m.gap, baseline + desc + 0.18 * ctx.font + 1.5)} d={`M0 0 L${0.22 * ctx.font} ${0.3 * ctx.font} L${-0.22 * ctx.font} ${0.3 * ctx.font} Z`} opacity={state.rhs && ctx.idle ? 1 : 0} pointerEvents="none" />
      {state.puff ? drawPuff(ctx, state.puff) : <g />}
    </g>
  );
  const pad2 = 0.08 * ctx.font;
  return (
    <g>
      {body}
      {(state.rings ?? []).map(r => {
        const b = findNode(body, r.id);
        return b ? <rect id={`${r.id}-ring`} className={r.slip ? "alg-ring alg-ring-slip" : "alg-ring"} transform={translate(b.left - pad2, b.top - pad2)}
          width={b.right - b.left + 2 * pad2} height={b.bottom - b.top + 2 * pad2} rx={7} pointerEvents="none" /> : null;
      }).filter((x): x is Svgx => x !== null)}
      {(state.slots ?? []).map(id => {
        const b = findNode(body, id);
        const w = Math.max(b ? b.right - b.left : 0, 0.9 * ctx.font);
        return b ? <rect id={`${id}-slot`} className="alg-slot" transform={translate((b.left + b.right) / 2 - w / 2, b.bottom + 0.2 * ctx.font)}
          width={w} height={0.95 * ctx.font} rx={6} pointerEvents="none" /> : null;
      }).filter((x): x is Svgx => x !== null)}
    </g>
  );
}

/* ---------- Feedback text ---------- */
type Env = Record<string, number>;
function testEnv(eq: Eq, checked: { v: string; solution: number | null }): Env {
  if (checked.solution !== null) return { [checked.v]: checked.solution };
  const vals = [2, 3, 5, 7];
  return Object.fromEntries(varsOf(eq).map((n, i) => [n, vals[i % vals.length]]));
}
const envText = (env: Env) => Object.entries(env).map(([k, v]) => `${k} = ${fmtNum(v)}`).join(", ");
function sidesAt(eq: Eq, env: Env) {
  const l = evalExpr(eq.lhs, env), r = eq.rhs ? evalExpr(eq.rhs, env) : NaN;
  return { l, r, ok: eq.rhs ? Math.abs(l - r) < 1e-9 : true };
}
function balanceLine(eq: Eq, start: Eq, goal: Goal, env: Env) {
  if (goal === "isolate" || goal === "equivalent") {
    const s = sidesAt(eq, env);
    return `${goal === "isolate" ? "Still balanced" : "Still true"} at ${envText(env)}: ${fmtNum(s.l)} = ${fmtNum(s.r)}.`;
  }
  return `Same value as ${txt(start.lhs)} at ${envText(env)}: ${fmtNum(evalExpr(eq.lhs, env))}.`;
}
function slipText(slip: Slip, info: MoveInfo, wrong: Eq, before: Eq, env: Env): { head: string; why: string } {
  const p = info.parts ?? [];
  if (slip === "unlike") {
    const [a, b, res] = p;
    const v = Object.keys(env)[0];
    const ex = env[v];
    const xt = /[a-z]/i.test(a) ? a : b, ct = xt === a ? b : a;
    return { head: `${a} and ${b} aren't like terms, so they can't become ${res}.`,
      why: `${xt} changes when ${v} changes; ${ct} stays put. At ${v} = ${fmtNum(ex)}, ${joinTerms(a, b)} is ${fmtNum(termValue(a, ex) + termValue(b, ex))}, but ${res} is ${fmtNum(termValue(res, ex))}${wrong.rhs ? ", and the two sides stop matching" : ""}.` };
  }
  if (slip === "divide-one") {
    const [c, side, rest] = p;
    const s = sidesAt(wrong, env);
    return { head: `Dividing by ${c} has to reach every term on that side, not just one.`,
      why: `(${side})/${c} isn't ${rest}. With ${envText(env)} this line gives ${fmtNum(s.l)} = ${fmtNum(s.r)}, so the balance breaks. Move the other term across first, then divide.` };
  }
  if (slip === "power") {
    const [orig, res] = p;
    const a = evalExpr(before.lhs, env), b = evalExpr(wrong.lhs, env);
    return { head: `${orig} isn't ${res}.`,
      why: `Squaring a sum means multiplying it by itself, which makes cross terms. With ${envText(env)}: ${orig} = ${fmtNum(a)}, but ${res} = ${fmtNum(b)}. Drag the 2 down under the bracket to write the square out.` };
  }
  if (slip === "not-common") {
    const [d, , oc, sum] = p;
    return { head: `${d} doesn't go into ${oc}, so it isn't a common factor of ${sum}.`,
      why: `Taking ${d} out means every term has to be ${d} times a whole number, but ${oc} ÷ ${d} = ${fmtNum(Number(oc) / Number(d))}. Pick a number that goes into every number in front.` };
  }
  /* sign: parts = [the term as it was, e.g. "−5", its unsigned text "5", the side it left] */
  const [orig, X, from] = p;
  const wasNeg = orig.startsWith("−");
  const s = sidesAt(wrong, env);
  return { head: `If ${orig} kept its sign, the line would read ${txtEq(wrong)}.`,
    why: `At ${envText(env)} that's ${fmtNum(s.l)} = ${fmtNum(s.r)}: off balance. Clearing ${orig} from the ${from} means ${wasNeg ? `adding ${X} to` : `subtracting ${X} from`} both sides, so it arrives as ${wasNeg ? "+" : "−"}${X}.` };
}
/** "3x" and "−5" written as one expression: "3x − 5". */
function joinTerms(a: string, b: string) { return `${a} ${b.startsWith("−") ? "− " + b.slice(1) : "+ " + b}`; }
/** The value of a signed monomial like "−2x", "7" or "x" at the test value. */
function termValue(t: string, ex: number): number {
  const m = /^(−)?(\d*)([a-z]?)/i.exec(t)!;
  const n = m[2] ? Number(m[2]) : 1;
  return (m[1] ? -1 : 1) * n * (m[3] ? ex : 1);
}
function slipPhrase(info: MoveInfo): string {
  const p = info.parts ?? [];
  if (info.slip === "unlike") return `turning ${joinTerms(p[0], p[1])} into ${p[2]}`;
  if (info.slip === "divide-one") return `dividing only one term of ${p[1]} by ${p[0]}`;
  if (info.slip === "power") return `writing ${p[0]} as ${p[1]}`;
  if (info.slip === "not-common") return `taking out ${p[0]}, which doesn't go into ${p[2]}`;
  return `letting ${p[0]} keep its sign as it crossed`;
}
const GESTURE: Partial<Record<MoveInfo["kind"], string>> = {
  cross: "drag it across the =", combine: "drop one on the other", divide: "drag the number across the = and drop it under the other side",
  multiply: "drag it across the =", distribute: "drop it on the bracket", cancel: "drop one number on the other",
  power: "drag the exponent down under its bracket", factor: "drag a number out past the left edge, then choose", merge: "drop one on the other",
};

/** Letters in italics, as in the canvas. */
function MathText({ s }: { s: string }) {
  return <>{s.split(/([a-zA-Z])/).map((part, i) => (/^[a-zA-Z]$/.test(part) ? <i key={i}>{part}</i> : part))}</>;
}
const GUIDE: Record<Goal, string> = {
  isolate: "Every term can be picked up. Drag one across the = · onto a like term · or a number across and under the other side",
  equivalent: "Every term can be picked up. Drop a number on a bracket to multiply it out · a term on a like term to combine",
  expand: "Every symbol can be picked up. Drag the power down under its bracket · then a bracket onto a bracket",
  simplify: "Drop a term on a like term to combine · a number on a bracket to multiply out",
  factor: "Drag a number out past the left edge, then choose what to take out",
};

/* ---------- Component ---------- */
type Step = { eq: Eq; info: MoveInfo | null };
type LogEvent = { type: "move"; info: MoveInfo; at: number } | { type: "rewind"; from: number; to: number }
  | { type: "slip"; slip: Slip; phrase: string } | { type: "sign"; right: boolean } | { type: "hint" };
type Note = { tone: "info" | "ok" | "slip" | "done" | "ask"; head: string; body?: string };
type Pending = { eq: Eq; info: MoveInfo; options?: Cand[] };
type Work = { steps: Step[]; cursor: number; pending: Pending | null; flips: number; log: LogEvent[]; note: Note | null; nonce: number };

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setR(q.matches);
    sync(); q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return r;
}

export function EquationWorkbench(props: { config: EquationWorkbenchConfig; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const checked = useMemo(() => check(props.config), [props.config]);
  if (!checked.ok) return (
    <section className="activity algebra" data-simulation="equation-workbench">
      <p className="alg-fallback"><strong>This workbench couldn’t start.</strong> {checked.error}</p>
    </section>
  );
  return <Workbench key={JSON.stringify(props.config)} c={checked} onChange={props.onChange} onShare={props.onShare} />;
}

function Workbench({ c, onChange, onShare }: { c: Extract<Checked, { ok: true }>; onChange?: () => void; onShare?: (s: ShareSummary) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = useReduced();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560); /* SSR-safe default; the ResizeObserver effect below measures the real width after mount. */
  const initial = (): Work => ({ steps: [{ eq: c.eq, info: null }], cursor: 0, pending: null, flips: 0, log: [], note: null, nonce: 0 });
  const [work, setWork] = useState<Work>(initial);
  const workRef = useRef(work);
  workRef.current = work;
  /* Bumping this remounts the renderer on the last committed line: an interrupted gesture discards its preview. */
  const [renderKey, setRenderKey] = useState(0);
  const draggingRef = useRef(false);
  const [ghost, setGhost] = useState<{ line: string; does: string; slip: boolean; ask: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => { draggingRef.current = false; setDragging(false); setGhost(null); setRenderKey(k => k + 1); };
    document.addEventListener("pointercancel", cancel, true);
    return () => document.removeEventListener("pointercancel", cancel, true);
  }, [dragging]);
  const [status, setStatus] = useState("");
  const [shared, setShared] = useState(false);
  const [menuPick, setMenuPick] = useState("");
  const routes = useRef(new Map<string, ReturnType<typeof shortestRoute>>());
  const route = useCallback((eq: Eq) => {
    const k = eqCanon(eq);
    if (!routes.current.has(k)) routes.current.set(k, shortestRoute(eq, c.goal, c.v));
    return routes.current.get(k)!;
  }, [c.goal, c.v]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    /* A width change mid-drag remounts the renderer on the committed line, so Dragology never
       interpolates between layouts measured at two widths. */
    const resize = () => setWidth(prev => {
      const w = el.clientWidth;
      if (prev !== w && draggingRef.current) { draggingRef.current = false; setDragging(false); setGhost(null); setRenderKey(k => k + 1); }
      return w;
    });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = work.steps[work.cursor].eq;
  const shown = work.pending?.eq ?? current;
  const done = !work.pending && goalReached(current, c.goal, c.v);
  const env = useMemo(() => testEnv(c.eq, c), [c]);
  const askSigns = work.flips >= c.fadeAfter;
  const start = work.cursor === 0 && work.log.length === 0;

  /* Font: fit the starting line with room to grow, between 19 and 34px. */
  const font = useMemo(() => {
    const probe: Ctx = { state: c.eq, d: null as never, idle: true, size: 1, font: 1, W: 1, H: 1, cands: new Map(), goal: c.goal, v: c.v, reduced };
    const em = measure(c.eq, probe).total;
    return Math.max(19, Math.min(38, (width - 24) / (em * 1.55)));
  }, [c, width, reduced]);
  const H = Math.round(Math.max(128, font * 4.1));

  const draggable: Draggable<DState> = useCallback(({ state, d, draggedId }) => {
    const idle = draggedId === null;
    const cands = idle ? candidates(strip(state), { askSigns }) : new Map<string, Cand[]>();
    return drawEquation({ state, d, idle, size: 1, font, W: width, H, cands, goal: c.goal, v: c.v, reduced, start: start && idle });
  }, [askSigns, font, width, H, c.goal, c.v, reduced, start]);

  const view: DState = useMemo(() => ({ ...shown }), [shown, work.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----- applying moves ----- */
  function commit(w: Work, eq: Eq, info: MoveInfo, viaAsk: boolean): Work {
    const steps = [...w.steps.slice(0, w.cursor + 1), { eq, info }];
    const reached = goalReached(eq, c.goal, c.v);
    const moves = steps.filter(s => s.info && s.info.kind !== "reorder").length;
    let note: Note;
    if (reached) {
      const r = route(c.eq);
      note = { tone: "done", head: doneHead(eq), body: `${moves} ${moves === 1 ? "move" : "moves"}${r ? `; the shortest route takes ${r.dist}` : ""}. ${originalCheck(eq)}` };
    } else if (info.kind === "reorder") note = { tone: "ok", head: "Reordered.", body: "Same terms, same value, new order." };
    else note = { tone: "ok", head: `${info.does}.`, body: balanceLine(eq, c.eq, c.goal, env) };
    setStatus(`${note.head} ${note.body ?? ""} Line ${steps.length}: ${txtEq(eq)}`);
    return { ...w, steps, cursor: steps.length - 1, pending: null, flips: w.flips + (info.kind === "cross" && !viaAsk ? 1 : 0),
      log: [...w.log, { type: "move", info, at: steps.length - 1 }], note, nonce: w.nonce + 1 };
  }
  function originalCheck(eq: Eq) {
    if (c.goal === "isolate" && c.solution !== null && c.eq.rhs)
      return `Check in the original: ${txt(c.eq.lhs)} = ${fmtNum(evalExpr(c.eq.lhs, env))} and ${txt(c.eq.rhs)} = ${fmtNum(evalExpr(c.eq.rhs, env))} when ${c.v} = ${fmtNum(c.solution)}.`;
    return balanceLine(eq, c.eq, c.goal, env);
  }
  function doneHead(eq: Eq) {
    if (c.goal === "isolate") return `${c.v} is on its own: ${txtEq(eq)}.`;
    if (c.goal === "equivalent") return "Both sides read the same, so the two expressions are equal for every value.";
    if (c.goal === "factor") return `Factored: ${txtEq(eq)}.`;
    return `Fully ${c.goal === "expand" ? "expanded" : "simplified"}: ${txtEq(eq)}.`;
  }
  const apply = useCallback((next: DState) => {
    const w = workRef.current;
    const info = next.move;
    const eq = strip(next);
    let out: Work;
    if (!info || info.kind === "stay" || eqExact(eq) === eqExact(w.steps[w.cursor].eq)) out = { ...w, nonce: w.nonce + 1 };
    else if (info.slip) {
      const t = slipText(info.slip, info, eq, w.steps[w.cursor].eq, env);
      setStatus(`${t.head} ${t.why} The line is unchanged.`);
      out = { ...w, note: { tone: "slip", head: t.head, body: t.why }, log: [...w.log, { type: "slip", slip: info.slip, phrase: slipPhrase(info) }], nonce: w.nonce + 1 };
    } else if (info.group) {
      const seen = new Set<string>();
      const options = [...candidates(w.steps[w.cursor].eq, { askSigns: false }).values()].flat()
        .filter(o => o.info.group === info.group && (!info.from || o.subject === info.from) && o.info.choice && !seen.has(o.info.choice) && seen.add(o.info.choice))
        .sort((x, y) => Number(x.info.choice) - Number(y.info.choice));
      const note: Note = { tone: "ask", head: "Which number goes into every term? Take it out in front." };
      setStatus(`${note.head} Choices: ${options.map(o => o.info.choice).join(", ")}.`);
      out = { ...w, pending: { eq, info, options }, note, nonce: w.nonce + 1 };
    } else if (info.ask) {
      const a = info.ask;
      const note: Note = { tone: "ask", head: `${a.correct > 0 ? "−" : ""}${a.text} crossed the =. Which sign does it take on the ${a.side === "lhs" ? "left" : "right"}?` };
      setStatus(note.head);
      out = { ...w, pending: { eq, info }, note, nonce: w.nonce + 1 };
    } else out = commit(w, eq, info, false);
    workRef.current = out;
    setWork(out);
    if (out.steps !== w.steps || out.cursor !== w.cursor) { setShared(false); onChange?.(); }
  }, [env, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(sign: 1 | -1) {
    const w = workRef.current;
    if (!w.pending?.info.ask) return;
    const a = w.pending.info.ask;
    const final = settleAsk(w.pending.eq, sign);
    let out: Work;
    if (sign === a.correct) {
      const info: MoveInfo = { ...w.pending.info, ask: undefined, does: `${sign > 0 ? "+" : "−"}${a.text}: ${sign > 0 ? "added to" : "subtracted from"} both sides` };
      out = commit({ ...w, log: [...w.log, { type: "sign", right: true }] }, final, info, true);
      out = { ...out, note: { ...out.note!, head: out.note!.tone === "done" ? out.note!.head : `Right: it lands as ${sign > 0 ? "+" : "−"}${a.text}.` } };
    } else {
      /* The term as it was before crossing: it lands with the opposite of its old sign. */
      const orig = a.correct > 0 ? `−${a.text}` : a.text;
      const signInfo: MoveInfo = { ...w.pending.info, parts: [orig, a.text, a.side === "lhs" ? "right" : "left"] };
      const t = slipText("sign", signInfo, final, w.steps[w.cursor].eq, env);
      setStatus(`${t.head} ${t.why}`);
      out = { ...w, note: { tone: "slip", head: t.head, body: t.why + " Pick again." }, log: [...w.log, { type: "sign", right: false }, { type: "slip", slip: "sign", phrase: slipPhrase({ ...signInfo, slip: "sign" }) }] };
    }
    workRef.current = out;
    setWork(out);
    if (out.steps !== w.steps) { setShared(false); onChange?.(); }
  }
  function pickFactor(o: Cand) {
    const w = workRef.current;
    if (!w.pending?.options) return;
    let out: Work;
    if (o.info.slip) {
      const t = slipText(o.info.slip, o.info, o.state, w.steps[w.cursor].eq, env);
      setStatus(`${t.head} ${t.why}`);
      out = { ...w, note: { tone: "slip", head: t.head, body: t.why + " Choose again." }, log: [...w.log, { type: "slip", slip: o.info.slip, phrase: slipPhrase(o.info) }] };
    } else {
      out = commit(w, o.state, o.info, false);
      if (!goalReached(o.state, c.goal, c.v) && c.goal === "factor") {
        const inner = txtEq(o.state).replace(/^\d+/, "");
        out = { ...out, note: { tone: "info", head: `${o.info.choice} is a common factor: ${txtEq(o.state)}.`, body: `But the numbers in ${inner} still share a factor, so it isn't fully factored. Drop the ${o.info.choice} back on the bracket, or Undo, and take out a bigger one.` } };
      }
    }
    workRef.current = out;
    setWork(out);
    if (out.steps !== w.steps) { setShared(false); onChange?.(); }
  }
  function rewind(i: number) {
    const w = workRef.current;
    if (i === w.cursor && !w.pending) return;
    const note: Note = { tone: "info", head: `Back to line ${i + 1}: ${txtEq(w.steps[i].eq)}.`, body: i < w.steps.length - 1 ? "Your later lines stay listed until you make a new move." : undefined };
    setStatus(note.head);
    const out = { ...w, cursor: i, pending: null, note, log: [...w.log, { type: "rewind" as const, from: w.cursor, to: i }], nonce: w.nonce + 1 };
    workRef.current = out;
    setWork(out);
    setShared(false);
    onChange?.();
  }
  function reset() {
    const out = { ...initial(), nonce: workRef.current.nonce + 1 };
    workRef.current = out;
    setWork(out);
    setShared(false);
    setStatus(`Started over: ${txtEq(c.eq)}`);
    onChange?.();
  }
  function hint() {
    const w = workRef.current;
    const r = route(w.steps[w.cursor].eq);
    const note: Note = r?.first?.info.group
      ? { tone: "info", head: "Try: take out a common factor.", body: `Look for the largest number that goes into every number in front. To do it, ${GESTURE.factor}.` }
      : r?.first
      ? { tone: "info", head: `Try: ${r.first.info.label.charAt(0).toLowerCase() + r.first.info.label.slice(1)}.`, body: GESTURE[r.first.info.kind] ? `To do it, ${GESTURE[r.first.info.kind]}. ${r.dist} ${r.dist === 1 ? "move" : "moves"} left on the shortest route.` : undefined }
      : { tone: "info", head: "No short route found from here.", body: "Rewind a step or start over." };
    setStatus(note.head + " " + (note.body ?? ""));
    const out = { ...w, note, log: [...w.log, { type: "hint" as const }] };
    workRef.current = out;
    setWork(out);
  }

  /* Keyboard path: every move from the current line, slips listed apart. */
  const menu = useMemo(() => {
    if (work.pending || done) return { legal: [] as Cand[], slips: [] as Cand[] };
    const seen = new Set<string>();
    const legal: Cand[] = [], slips: Cand[] = [];
    const groups = new Set<string>();
    for (const list of candidates(current, { askSigns }).values()) for (const cand of list) {
      if (cand.info.kind === "stay") continue;
      if (cand.info.group) {
        /* One entry for taking out a factor; the number is chosen afterwards, as with the drag. */
        if (groups.has(cand.info.group)) continue;
        groups.add(cand.info.group);
        const info: MoveInfo = { kind: "factor", group: cand.info.group, label: "Take out a common factor (then choose the number)", does: "Take out a common factor" };
        legal.push({ ...cand, info, state: factorPreview(current, cand.info.group.replace(/^factor-/, "")) });
        continue;
      }
      const k = cand.info.label + "|" + eqCanon(cand.state) + (cand.info.kind === "reorder" ? eqExact(cand.state) : "");
      if (seen.has(k)) continue;
      seen.add(k);
      (cand.info.slip ? slips : legal).push(cand);
    }
    const order = ["cross", "combine", "distribute", "divide", "multiply", "cancel", "merge", "power", "factor", "reorder"];
    legal.sort((a, b) => order.indexOf(a.info.kind) - order.indexOf(b.info.kind));
    return { legal, slips };
  }, [current, askSigns, work.pending, done]);
  const menuAll = [...menu.legal, ...menu.slips];
  function applyMenu() {
    const cand = menuAll[Number(menuPick)];
    if (!cand) return;
    apply({ ...cand.state, move: cand.info });
    setMenuPick("");
  }

  /* ----- share ----- */
  function share() {
    const w = workRef.current;
    const s = compose(w);
    setShared(true);
    onShare?.(s);
  }
  /** The direct answer to the learner's question, from the finished line. */
  function answerFor(end: Eq): string {
    const orig = txtEq(c.eq);
    if (c.goal === "isolate") return `${c.v} = ${fmtNum(c.solution!)}.`;
    if (c.goal === "equivalent") return `Yes: both sides become ${txt(end.lhs)}, so ${txt(c.eq.lhs)} and ${txt(c.eq.rhs!)} are equal for every value of ${varsOf(c.eq).join(" and ")}.`;
    if (c.goal === "factor") {
      const g = /^\d+/.exec(txtEq(end))?.[0] ?? "";
      const coefs = termKeys(c.eq.lhs).map(t => /^−?(\d+)/.exec(t.text)?.[1] ?? "1");
      return `${orig} = ${txtEq(end)}. ${g} is the largest number that goes into ${coefs.slice(0, -1).join(", ")} and ${coefs[coefs.length - 1]}, and multiplying back out gives ${orig} again.`;
    }
    if (c.compare) {
      const cmp = txtEq(c.compare);
      const names = varsOf(c.eq);
      const same = samePolynomial(end.lhs, c.compare.lhs);
      if (same.ok && same.same) return `Yes: ${orig} = ${txtEq(end)}, which is the same as ${cmp}.`;
      const have = termKeys(end.lhs), want = termKeys(c.compare.lhs);
      const extra = have.filter(t => !want.some(u => u.key === t.key)).map(t => t.text.replace(/^−/, "− "));
      const missing = want.filter(t => !have.some(u => u.key === t.key)).map(t => t.text.replace(/^−/, "− "));
      const e = pointWhereDifferent(c.eq.lhs, c.compare.lhs, names) ?? testEnv(c.eq, c);
      const diff = [extra.length ? `it has ${extra.join(" and ")} as well` : "", missing.length ? `it has no ${missing.join(" or ")}` : ""].filter(Boolean).join(", and ");
      return `No. ${orig} = ${txtEq(end)}. Compared with ${cmp}, ${diff || "the terms differ"}. At ${envText(e)}: ${orig} = ${fmtNum(evalExpr(c.eq.lhs, e))}, but ${cmp} = ${fmtNum(evalExpr(c.compare.lhs, e))}.`;
    }
    return `${orig} = ${txtEq(end)}.`;
  }
  function compose(w: Work): ShareSummary {
    const branch = w.steps.slice(0, w.cursor + 1);
    const moves = branch.filter(s => s.info && s.info.kind !== "reorder");
    const end = branch[branch.length - 1].eq;
    const reached = goalReached(end, c.goal, c.v);
    const best = route(c.eq);
    const dists = branch.map(s => route(s.eq)?.dist ?? null);
    const detours: string[] = [];
    let numberDetour = false;
    branch.forEach((s, i) => {
      if (i === 0 || !s.info || s.info.kind === "reorder") return;
      const a = dists[i - 1], b = dists[i];
      if (a !== null && b !== null && b >= a) {
        detours.push(`line ${i + 1} (${s.info.label.charAt(0).toLowerCase() + s.info.label.slice(1)})`);
        /* A number carried to the side where x will end up has to come back. */
        const end = branch[branch.length - 1].eq;
        const xSide = end.lhs.kind === "var" ? "lhs" : "rhs";
        if (s.info.kind === "cross" && /^−?\d+$/.test(s.info.parts?.[0] ?? "") && s.info.parts?.[1] === xSide) numberDetour = true;
      }
    });
    const slips = w.log.filter((e): e is Extract<LogEvent, { type: "slip" }> => e.type === "slip");
    const signs = w.log.filter((e): e is Extract<LogEvent, { type: "sign" }> => e.type === "sign");
    const rewinds = w.log.filter(e => e.type === "rewind").length;
    const hints = w.log.filter(e => e.type === "hint").length;
    const firstMove = moves[0]?.info?.label ?? "";
    const n = moves.length;
    const parts: string[] = [];
    const answer = reached ? answerFor(end) : "";
    if (answer) parts.push(answer);
    if (reached) {
      if (best && n <= best.dist) parts.push(`You did it in ${n} ${n === 1 ? "move" : "moves"}, as short as this one gets.`);
      else if (best) {
        parts.push(`You got there in ${n} moves; the shortest route takes ${best.dist}.`);
        if (detours.length) parts.push(`The extra ${n - best.dist === 1 ? "move" : "moves"} came at ${detours.slice(0, 2).join(" and ")}, ${numberDetour
          ? `which carried a number to the side where ${c.v} ends up, so it had to cross back later.` : `which didn't bring ${c.goal === "isolate" ? c.v + " closer to being alone" : "the goal closer"}.`}`);
        if (best.first && best.first.info.label !== firstMove) parts.push(`A quicker start: ${best.first.info.label.charAt(0).toLowerCase() + best.first.info.label.slice(1)}.`);
      }
    } else {
      const r = route(end);
      parts.push(n ? `You're at ${txtEq(end)}.`
        : branch.length > 1 ? `You've reordered the terms to ${txtEq(end)}, so the equation itself is still unchanged.`
        : `The equation is still unchanged: ${txtEq(end)}.`);
      if (r?.first) parts.push(`${r.dist} more ${r.dist === 1 ? "move" : "moves"} would finish it; next, ${r.first.info.group ? "take out a common factor" : r.first.info.label.charAt(0).toLowerCase() + r.first.info.label.slice(1)}.`);
    }
    const kinds = [...new Set(slips.map(s => s.slip))];
    const phrases = [...new Set(slips.map(s => s.phrase))];
    const principle: Record<Slip, string> = {
      unlike: "Only like terms combine: one changes with the letter and the other doesn't.",
      "divide-one": "A division has to reach every term on that side.",
      power: "A squared bracket is the bracket times itself, cross terms and all.",
      sign: "Moving a term across means doing the opposite to both sides.",
      "not-common": "A common factor has to go into every number in front, not just one of them.",
    };
    if (phrases.length) {
      const list = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
      parts.push(`Along the way you tried ${list}, and saw ${c.eq.rhs ? `${phrases.length === 1 ? "it" : "each one"} break the balance` : `why ${phrases.length === 1 ? "it doesn't" : "they don't"} work`}.`);
      if (kinds.length === 1) parts.push(principle[kinds[0]]);
    }
    if (signs.length && !kinds.includes("sign")) parts.push(`When ${signs.length === 1 ? "a term" : "terms"} crossed the =, you chose the new sign yourself.`);
    if (rewinds) parts.push(`You rewound ${rewinds === 1 ? "once" : rewinds === 2 ? "twice" : rewinds + " times"} to look back, which is a good way to test an idea.`);
    if (reached && c.goal === "isolate" && c.solution !== null) {
      const s = sidesAt(c.eq, env);
      parts.push(`Check in the original: both sides come to ${fmtNum(s.l)} when ${c.v} = ${fmtNum(c.solution)}.`);
    }
    if (!n && !phrases.length) parts.push("Pick up any term and try a move; nothing you try can break the equation without me saying why.");
    const learner = reached
      ? c.goal === "isolate" ? `I got ${txtEq(end)} in ${n} ${n === 1 ? "move" : "moves"}.`
        : c.goal === "equivalent" ? `I showed both sides are the same in ${n} moves.` : `I got ${txtEq(end)} in ${n} ${n === 1 ? "move" : "moves"}.`
      : `I got as far as ${txtEq(end)}.`;
    const data = [`goal=${c.goal}`, `start="${txtEq(c.eq)}"`, `end="${txtEq(end)}"`, `reached=${reached}`, `moves=${n}`, `shortest=${best?.dist ?? "?"}`,
      `detours=${detours.length}`, `rewinds=${rewinds}`, `slips=${kinds.join(",") || "none"}`, `signs=${signs.filter(s => s.right).length}/${signs.length}`, `hints=${hints}`,
      `path=${moves.map(m => m.info!.label).join(" > ")}`, ...(answer ? [`answer="${answer}"`] : [])].join("; ");
    return { learner, data, reply: parts.join(" ") };
  }

  /* ----- test hook ----- */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const host = window as Window & { keatingAlgebra?: unknown };
    host.keatingAlgebra = Object.freeze({
      snapshot: () => {
        const w = workRef.current;
        return { line: txtEq(w.pending?.eq ?? w.steps[w.cursor].eq), lines: w.steps.map(s => txtEq(s.eq)), cursor: w.cursor, pending: !!w.pending,
          done: !w.pending && goalReached(w.steps[w.cursor].eq, c.goal, c.v), flips: w.flips, note: w.note, log: w.log.map(e => e.type) };
      },
      nodes: () => nodeList(workRef.current.pending?.eq ?? workRef.current.steps[workRef.current.cursor].eq),
      route: () => route(c.eq)?.dist ?? null,
    });
    return () => { delete host.keatingAlgebra; };
  }, [c, route]);

  const moveCount = work.steps.slice(0, work.cursor + 1).filter(s => s.info && s.info.kind !== "reorder").length;
  const goalText = c.goal === "isolate" ? `Get ${c.v} alone. Every move keeps both sides equal.`
    : c.goal === "expand" ? "Multiply out until no brackets are left."
    : c.goal === "factor" ? "Pull the largest common factor out in front."
    : c.goal === "simplify" ? "Combine until no like terms are left."
    : "Rewrite either side until the two sides read the same.";
  const ask = work.pending?.info.ask;
  const note = work.note;

  return (
    <section className={`activity algebra${done ? " is-done" : ""}`} data-simulation="equation-workbench" aria-labelledby={`alg${uid}-t`}>
      <div className="alg-header">
        <h3 id={`alg${uid}-t`}>{c.title}</h3>
        <span className="alg-count">{done ? `Done in ${moveCount} ${moveCount === 1 ? "move" : "moves"}` : moveCount ? `${moveCount} ${moveCount === 1 ? "move" : "moves"}` : "Drag a term"}</span>
      </div>
      <p className="alg-goal">{goalText}</p>
      <div className={`alg-canvas${dragging ? " is-dragging" : ""}${ghost?.slip ? " is-slip" : ""}${ask ? " is-asking" : ""}`} ref={wrap} aria-hidden="true">
        <DraggableRenderer key={renderKey} draggable={draggable} state={view} width={width} height={H}
          onDropState={apply}
          onDragState={s => {
            const m = (s as DState).move;
            setGhost(m && m.kind !== "stay" ? { line: txtEq(s), does: m.does, slip: !!m.slip, ask: !!m.ask } : null);
          }}
          onDragStatus={st => { const on = st.type === "dragging"; draggingRef.current = on; setDragging(on); if (!on) setGhost(null); }} />
      </div>
      <p className={`alg-ghost${ghost || dragging || (moveCount === 0 && !note) ? " is-on" : ""}${ghost?.slip ? " is-slip" : ""}`} aria-hidden="true">
        {ghost ? <><span key={ghost.slip ? "slip" : "legal"} className="alg-ghost-line"><span className="alg-ghost-arrow" aria-hidden="true">→</span><MathText s={ghost.line} /></span><span className="alg-ghost-does">{ghost.slip ? `${ghost.does} Drop to see what happens.` : ghost.does}</span></>
          : dragging ? <span className="alg-ghost-does">Bring it near a spot: across the =, along its side, or onto a matching term.</span>
          : moveCount === 0 && !note ? <span className="alg-ghost-does">{GUIDE[c.goal]}</span> : null}
      </p>
      {ask && (
        <div className="alg-ask-row" role="group" aria-label="Choose the sign">
          <span className="alg-ask-q">{note?.head}</span>
          <button type="button" className="alg-chip" onClick={() => choose(1)}>+{ask.text}</button>
          <button type="button" className="alg-chip" onClick={() => choose(-1)}>−{ask.text}</button>
        </div>
      )}
      {work.pending?.options && (
        <div className="alg-ask-row" role="group" aria-label="Choose the factor">
          <span className="alg-ask-q">Which number goes into every term? Take it out in front.</span>
          {work.pending.options.map(o => <button key={o.info.choice} type="button" className="alg-chip" onClick={() => pickFactor(o)}>{o.info.choice}</button>)}
        </div>
      )}
      {note && note.tone !== "ask" && (
        <p className={`alg-note is-${note.tone}`}><strong>{note.head}</strong>{note.body ? " " + note.body : ""}</p>
      )}
      <ol className="alg-steps" aria-label="Steps so far">
        {work.steps.map((s, i) => (
          <li key={i} className={`${i === work.cursor ? "is-current" : ""}${i > work.cursor ? " is-ahead" : ""}`}>
            <button type="button" className="alg-step" onClick={() => rewind(i)} aria-current={i === work.cursor ? "step" : undefined}
              aria-label={`Line ${i + 1}: ${txtEq(s.eq)}${s.info ? `, after: ${s.info.label}` : ""}${i === work.cursor ? " (current)" : ", go back here"}`}>
              <span className="alg-step-n">{i + 1}</span>
              <span className="alg-step-eq"><MathText s={txtEq(s.eq)} /></span>
              <span className="alg-step-how">{s.info ? s.info.label : "start"}</span>
            </button>
          </li>
        ))}
      </ol>
      <details className="receipt alg-keys">
        <summary>Use buttons instead</summary>
        <div className="alg-key-row">
          <label className="alg-select">Next move
            <select value={menuPick} onChange={e => setMenuPick(e.currentTarget.value)} disabled={!menuAll.length}>
              <option value="">{work.pending ? (work.pending.options ? "Choose the number first" : "Choose the sign first") : done ? "Done" : "Pick a move…"}</option>
              <optgroup label="Moves">{menu.legal.map((m, i) => <option key={i} value={i}>{m.info.label} → {txtEq(m.state)}</option>)}</optgroup>
              {menu.slips.length > 0 && <optgroup label="Common slips (see why they break)">{menu.slips.map((m, i) => <option key={i} value={menu.legal.length + i}>{m.info.label}</option>)}</optgroup>}
            </select>
          </label>
          <button type="button" className="alg-chip" disabled={menuPick === ""} onClick={applyMenu}>Apply</button>
        </div>
      </details>
      <span className="learning-lab__sr-only" role="status">{status}</span>
      <div className="actions alg-actions">
        {(moveCount > 0 || work.log.length > 0) && <button type="button" className="primary" onClick={share} disabled={shared}>{shared ? "Shared" : "Share with Keating"}</button>}
        {!done && <button type="button" className="quiet" onClick={hint} disabled={!!work.pending}>Hint</button>}
        {work.cursor > 0 && <button type="button" className="quiet" onClick={() => rewind(work.cursor - 1)}>Undo</button>}
        {(work.steps.length > 1 || work.log.length > 0) && <button type="button" className="quiet" onClick={reset}>Start over</button>}
      </div>
    </section>
  );
}
