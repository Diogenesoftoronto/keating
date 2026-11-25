/* Expression model for the EquationWorkbench.
   The algebra (normal forms, combining, distributing, dividing across, cancelling) is adapted from
   Dragology's graspable-math demo (MIT, declarative-dragging/dragology). Added here: an error-reporting
   parser, a pure move generator shared by drags, keyboard and search, "slip" moves that let a learner
   try a common misconception, goal checks, numeric evaluation and a breadth-first shortest path. */

export type Num = { kind: "num"; id: string; value: number };
export type Var = { kind: "var"; id: string; name: string };
/** `ask`: the sign is the learner's to choose (worked-example fading). */
export type Term = { sign: 1 | -1; expr: Expr; ask?: true };
export type Sum = { kind: "sum"; id: string; terms: Term[] };
export type Prod = { kind: "prod"; id: string; factors: Expr[] };
export type Frac = { kind: "frac"; id: string; num: Expr; den: Expr };
export type Pow = { kind: "pow"; id: string; base: Expr; exp: Expr };
/** Numbers are never negative: signs live on the terms of sums. */
export type Expr = Num | Var | Sum | Prod | Frac | Pow;
export type Side = "lhs" | "rhs";
/** An equation, or (rhs null) a lone expression to simplify, expand or factor. */
export type Eq = { lhs: Expr; rhs: Expr | null };
export type Goal = "isolate" | "equivalent" | "simplify" | "expand" | "factor";
export type Slip = "unlike" | "divide-one" | "power" | "sign" | "not-common";

export type MoveKind = "stay" | "reorder" | "cross" | "combine" | "divide" | "multiply" | "distribute"
  | "merge" | "cancel" | "power" | "factor" | "slip";
export type MoveInfo = {
  kind: MoveKind;
  /** Short words for the move, for menus, history and the share. */
  label: string;
  /** What the drop does to the equation, shown under the canvas while dragging. */
  does: string;
  slip?: Slip;
  /** Dividing or multiplying by a sum: legal, but never part of a sensible route. */
  wild?: boolean;
  /** Moves that share one drop (taking out a common factor): the learner then picks `choice`. */
  group?: string;
  choice?: string;
  /** For a grouped drop: the node that was dragged (its divisors are the choices). */
  from?: string;
  /** A crossing whose sign the learner must choose. */
  ask?: { termId: string; text: string; correct: 1 | -1; side: Side };
  /** For slips: the parts involved, used in the explanation. */
  parts?: string[];
};
export type How =
  | { type: "merge"; target: string; puff: { expr: Expr; sign: 1 | -1 | null }; penalty?: number }
  | { type: "place" }
  | { type: "reorder"; pass: string[]; dir: -1 | 1 }
  | { type: "left-of"; edge: string }
  /** Wins while the pointer is over the target's glyphs (not its leading sign). */
  | { type: "on-content"; target: string; puff: { expr: Expr; sign: 1 | -1 | null } }
  /** Wins while the pointer is in a zone around `target`: under it, before or after it on its row, or (bracket) on its parentheses or under it. */
  | { type: "zone"; target: string; zone: "below" | "before" | "after" | "below-or-parens" };
export type Cand = { subject: string; how: How; state: Eq; info: MoveInfo };

let seq = 0;
const salt = Math.random().toString(36).slice(2, 6);
export const newId = () => `al${salt}${(seq++).toString(36)}`;
export const num = (value: number, id = newId()): Num => ({ kind: "num", id, value });
const isNum = (e: Expr, value: number) => e.kind === "num" && e.value === value;
export const otherSide = (side: Side): Side => (side === "lhs" ? "rhs" : "lhs");
export const termsOf = (e: Expr): Term[] => (e.kind === "sum" ? e.terms : [{ sign: 1, expr: e }]);
export const factorsOf = (e: Expr): Expr[] => (e.kind === "prod" ? e.factors : [e]);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
function insertAt<X>(xs: X[], i: number, x: X): X[] { return [...xs.slice(0, i), x, ...xs.slice(i)]; }
export function gcd(a: number, b: number): number { return b === 0 ? Math.abs(a) : gcd(b, a % b); }

/* ---------- Normal-form constructors ---------- */
export function mkSum(terms: Term[], id: string): Expr {
  const flat = terms.flatMap((t): Term[] => t.expr.kind === "sum"
    ? t.expr.terms.map(u => ({ sign: (t.sign * u.sign) as 1 | -1, expr: u.expr })) : [t]);
  if (flat.length === 0) return num(0);
  if (flat.length === 1 && flat[0].sign === 1 && !flat[0].ask) return flat[0].expr;
  return { kind: "sum", id, terms: flat };
}
export function mkProd(factors: Expr[], id: string): Expr {
  const flat = factors.flatMap(factorsOf);
  if (flat.length === 0) return num(1);
  if (flat.length === 1) return flat[0];
  return { kind: "prod", id, factors: flat };
}
function mkFrac(n: Expr, den: Expr, id: string): Expr { return isNum(den, 1) ? n : { kind: "frac", id, num: n, den }; }
function mkPow(base: Expr, exp: Expr, id: string): Expr { return isNum(exp, 1) ? base : { kind: "pow", id, base, exp }; }

function normalize(e: Expr): Expr {
  switch (e.kind) {
    case "num": case "var": return e;
    case "sum": return mkSum(e.terms.map(t => ({ ...t, expr: normalize(t.expr) })), e.id);
    case "prod": return mkProd(e.factors.map(normalize), e.id);
    case "frac": return mkFrac(normalize(e.num), normalize(e.den), e.id);
    case "pow": return mkPow(normalize(e.base), normalize(e.exp), e.id);
  }
}
function mapExpr(e: Expr, id: string, f: (e: Expr) => Expr): Expr {
  if (e.id === id) return f(e);
  switch (e.kind) {
    case "num": case "var": return e;
    case "sum": return { ...e, terms: e.terms.map(t => ({ ...t, expr: mapExpr(t.expr, id, f) })) };
    case "prod": return { ...e, factors: e.factors.map(x => mapExpr(x, id, f)) };
    case "frac": return { ...e, num: mapExpr(e.num, id, f), den: mapExpr(e.den, id, f) };
    case "pow": return { ...e, base: mapExpr(e.base, id, f), exp: mapExpr(e.exp, id, f) };
  }
}
function replaceNode(eq: Eq, id: string, r: Expr): Eq {
  return { lhs: normalize(mapExpr(eq.lhs, id, () => r)), rhs: eq.rhs && normalize(mapExpr(eq.rhs, id, () => r)) };
}
function setSide(eq: Eq, side: Side, e: Expr): Eq { return { ...eq, [side]: normalize(e) }; }
function cloneFresh(e: Expr): Expr {
  switch (e.kind) {
    case "num": case "var": return { ...e, id: newId() };
    case "sum": return { ...e, id: newId(), terms: e.terms.map(t => ({ ...t, expr: cloneFresh(t.expr) })) };
    case "prod": return { ...e, id: newId(), factors: e.factors.map(cloneFresh) };
    case "frac": return { ...e, id: newId(), num: cloneFresh(e.num), den: cloneFresh(e.den) };
    case "pow": return { ...e, id: newId(), base: cloneFresh(e.base), exp: cloneFresh(e.exp) };
  }
}
/** Equal for expressions equal up to ids and factor order. */
function exprKey(e: Expr): string {
  switch (e.kind) {
    case "num": return String(e.value);
    case "var": return e.name;
    case "sum": return `(${e.terms.map(t => (t.sign < 0 ? "-" : "+") + exprKey(t.expr)).join("")})`;
    case "prod": return `[${e.factors.map(exprKey).sort().join("*")}]`;
    case "frac": return `{${exprKey(e.num)}/${exprKey(e.den)}}`;
    case "pow": return `<${exprKey(e.base)}^${exprKey(e.exp)}>`;
  }
}
/** Equal up to ids and the order of terms and factors: "the same line, maybe rearranged". */
function canon(e: Expr): string {
  switch (e.kind) {
    case "num": return String(e.value);
    case "var": return e.name;
    case "sum": return `(${e.terms.map(t => (t.sign < 0 ? "-" : "+") + canon(t.expr)).sort().join("")})`;
    case "prod": return `[${e.factors.map(canon).sort().join("*")}]`;
    case "frac": return `{${canon(e.num)}/${canon(e.den)}}`;
    case "pow": return `<${canon(e.base)}^${canon(e.exp)}>`;
  }
}
export const eqCanon = (eq: Eq) => canon(eq.lhs) + "=" + (eq.rhs ? canon(eq.rhs) : "");
export const eqExact = (eq: Eq) => exprKey(eq.lhs) + "=" + (eq.rhs ? exprKey(eq.rhs) : "") + txtEq(eq);

/* ---------- Algebra ---------- */
function splitCoefficient(e: Expr) {
  const factors = factorsOf(e);
  if (factors.some(f => f.kind === "sum" || f.kind === "frac")) return null;
  const nums = factors.filter((f): f is Num => f.kind === "num");
  return { coef: nums.reduce((acc, f) => acc * f.value, 1), coefId: nums[0]?.id ?? null, rest: factors.filter(f => f.kind !== "num") };
}
const restKey = (rest: Expr[]) => rest.map(exprKey).sort().join();
const byName = (a: Expr, b: Expr) => exprKey(a).localeCompare(exprKey(b));

function combineTerms(t: Term, u: Term): Term[] | null {
  const a = splitCoefficient(t.expr), b = splitCoefficient(u.expr);
  if (!a || !b || restKey(a.rest) !== restKey(b.rest)) return null;
  const c = t.sign * a.coef + u.sign * b.coef;
  if (c === 0) return [];
  const coef = b.rest.length > 0 && Math.abs(c) === 1 ? [] : [num(Math.abs(c), b.coefId ?? newId())];
  const expr = mkProd([...coef, ...[...b.rest].sort(byName)], u.expr.kind === "prod" ? u.expr.id : newId());
  return [{ sign: c < 0 ? -1 : 1, expr }];
}
/** A coefficient times a single variable (3x, x), or a plain number: the shapes the 3x − 5 → −2x slip needs. */
function linearPart(e: Expr): { coef: number; v: Var | null } | null {
  if (e.kind === "num") return { coef: e.value, v: null };
  if (e.kind === "var") return { coef: 1, v: e };
  if (e.kind === "prod" && e.factors.length === 2 && e.factors[0].kind === "num" && e.factors[1].kind === "var")
    return { coef: e.factors[0].value, v: e.factors[1] };
  return null;
}
/** The misconception that 3x − 5 is −2x: a number "combined" into an x-term. */
function slipUnlike(t: Term, u: Term): Term | null {
  const a = linearPart(t.expr), b = linearPart(u.expr);
  if (!a || !b || (a.v === null) === (b.v === null)) return null;
  const v = (a.v ?? b.v)!;
  const c = t.sign * a.coef + u.sign * b.coef;
  if (c === 0) return null;
  const coefId = u.expr.kind === "prod" ? u.expr.factors[0].id : newId();
  const expr = Math.abs(c) === 1 ? { ...v, id: newId() } : mkProd([num(Math.abs(c), coefId), { ...v, id: newId() }], newId());
  return { sign: c < 0 ? -1 : 1, expr };
}
function powerOf(e: Expr): { base: Expr; n: number } | null {
  if (e.kind === "num") return null;
  if (e.kind === "pow") return e.exp.kind === "num" ? { base: e.base, n: e.exp.value } : null;
  if (e.kind === "sum") return null;
  return { base: e, n: 1 };
}
function mergeFactors(f: Expr, g: Expr): Expr | null {
  if (f.kind === "num" && g.kind === "num") return num(f.value * g.value, g.id);
  const a = powerOf(f), b = powerOf(g);
  if (!a || !b || exprKey(a.base) !== exprKey(b.base)) return null;
  const n = a.n + b.n;
  if (g.kind === "pow") return { ...g, exp: num(n, g.exp.id) };
  return { kind: "pow", id: newId(), base: g, exp: num(n) };
}
function multiplyInto(f: Expr, e: Expr): Expr {
  if (e.kind === "frac") return mkFrac(multiplyInto(f, e.num), e.den, e.id);
  if (e.kind === "sum") return mkProd([f, e], newId());
  return factorsOf(f).reduce((acc, g) => multiplyFactor(g, acc), e);
}
function multiplyFactor(f: Expr, e: Expr): Expr {
  if (isNum(f, 1)) return e;
  if (isNum(e, 1)) return f;
  const factors = factorsOf(e);
  const prodId = e.kind === "prod" ? e.id : newId();
  for (let k = 0; k < factors.length; k++) {
    const merged = mergeFactors(f, factors[k]);
    if (merged) return mkProd(factors.map((h, i) => (i === k ? merged : h)), prodId);
  }
  /* Numbers first, then letters in alphabetical order, so a·b and b·a read the same. */
  let at = 0;
  while (at < factors.length && factors[at].kind === "num") at++;
  if (f.kind !== "num") while (at < factors.length && byName(factors[at], f) < 0) at++;
  return mkProd(insertAt(factors, at, f), prodId);
}
function distribute(f: Expr, g: Sum): Expr {
  return mkSum(termsOf(f).flatMap((t, i) => g.terms.map((u): Term => ({
    sign: (t.sign * u.sign) as 1 | -1,
    expr: multiplyInto(cloneFresh(t.expr), i === 0 ? u.expr : cloneFresh(u.expr)),
  }))), g.id);
}
function cancel(f: Expr, g: Expr): { f: Expr | null; g: Expr | null } | null {
  if (f.kind === "num" && g.kind === "num") {
    const k = gcd(f.value, g.value);
    if (k <= 1) return null;
    const left = (n: Num, id: string) => (n.value === k ? null : num(n.value / k, id));
    return { f: left(f, newId()), g: left(g, g.id) };
  }
  const a = powerOf(f), b = powerOf(g);
  if (!a || !b || exprKey(a.base) !== exprKey(b.base)) return null;
  const k = Math.min(a.n, b.n);
  if (k === 0) return null;
  const lower = (e: Expr, n: number) => (n === 0 ? null : e.kind === "pow" ? mkPow(e.base, num(n, e.exp.id), e.id) : e);
  const left = lower(f, a.n - k);
  return { f: left && cloneFresh(left), g: lower(g, b.n - k) };
}
function evalPow(base: Expr, exp: Expr): number | null {
  if (base.kind !== "num" || exp.kind !== "num") return null;
  const v = base.value ** exp.value;
  return v <= 1e6 ? v : null;
}
function dividedBy(e: Expr, f: Expr): Expr[] {
  if (e.kind === "sum" && e.terms.length === 1)
    return dividedBy(e.terms[0].expr, f).map(x => mkSum([{ sign: -1, expr: x }], e.id));
  if (e.kind === "frac") {
    const den = factorsOf(e.den), denId = e.den.kind === "prod" ? e.den.id : newId();
    return range(den.length + 1).map(j => mkFrac(e.num, mkProd(insertAt(den, j, f), denId), e.id));
  }
  return [mkFrac(e, f, newId())];
}
function multipliedBy(e: Expr, f: Expr): Expr[] {
  if (e.kind === "sum" && e.terms.length === 1)
    return multipliedBy(e.terms[0].expr, f).map(x => mkSum([{ sign: -1, expr: x }], e.id));
  if (e.kind === "frac") {
    const n = factorsOf(e.num), numId = e.num.kind === "prod" ? e.num.id : newId();
    return range(n.length + 1).map(j => mkFrac(mkProd(insertAt(n, j, f), numId), e.den, e.id));
  }
  const prodId = newId();
  if (e.kind === "sum") return [mkProd([f, e], prodId), mkProd([e, f], prodId)];
  const factors = factorsOf(e), id = e.kind === "prod" ? e.id : prodId;
  return range(factors.length + 1).map(j => mkProd(insertAt(factors, j, f), id));
}
/** The integer coefficients of a sum's terms, if every term is a plain monomial. */
function coefficients(s: Sum): number[] | null {
  const out: number[] = [];
  for (const t of s.terms) {
    const sc = splitCoefficient(t.expr);
    if (!sc) return null;
    out.push(sc.coef);
  }
  return out;
}
/** (a + b) split over (c + d): a(c + d) + b(c + d). */
function splitOver(f: Sum, g: Sum): Expr {
  /* Fresh ids throughout: the dragged bracket is redrawn as the merge cloud, so none of its ids may survive. */
  return { kind: "sum", id: newId(), terms: f.terms.map((t): Term => ({ sign: t.sign, expr: mkProd([cloneFresh(t.expr), cloneFresh(g)], newId()) })) };
}
function factorOutBy(s: Sum, g: number, outerId: string): Expr {
  const terms = s.terms.map((t): Term => {
    const sc = splitCoefficient(t.expr)!;
    const c = sc.coef / g;
    const coef = c === 1 && sc.rest.length ? [] : [num(c, sc.coefId === outerId ? newId() : sc.coefId ?? newId())];
    void outerId;
    return { sign: t.sign, expr: mkProd([...coef, ...sc.rest], t.expr.kind === "prod" ? t.expr.id : newId()) };
  });
  return mkProd([num(g, newId()), { kind: "sum", id: s.id, terms }], newId());
}

/* ---------- Text ---------- */
const SUP: Record<string, string> = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const leadsWithDigit = (e: Expr): boolean => e.kind === "num" || (e.kind === "pow" && leadsWithDigit(e.base)) || (e.kind === "prod" && leadsWithDigit(e.factors[0]));
export function txt(e: Expr): string {
  switch (e.kind) {
    case "num": return String(e.value);
    case "var": return e.name;
    case "sum": return e.terms.map((t, i) => {
      const s = t.ask ? (i === 0 ? "? " : " ? ") : i === 0 ? (t.sign < 0 ? "−" : "") : t.sign < 0 ? " − " : " + ";
      return s + txt(t.expr);
    }).join("");
    case "prod": return e.factors.map((f, i) => {
      const body = f.kind === "sum" || f.kind === "frac" ? `(${txt(f)})` : txt(f);
      return i > 0 && leadsWithDigit(f) ? "·" + body : body;
    }).join("");
    case "frac": {
      const w = (x: Expr) => (x.kind === "sum" || x.kind === "prod" || x.kind === "frac" ? `(${txt(x)})` : txt(x));
      return `${w(e.num)}/${w(e.den)}`;
    }
    case "pow": {
      const b = e.base.kind === "num" || e.base.kind === "var" ? txt(e.base) : `(${txt(e.base)})`;
      const ex = e.exp.kind === "num" ? String(e.exp.value).split("").map(c => SUP[c]).join("") : `^(${txt(e.exp)})`;
      return b + ex;
    }
  }
}
export const txtEq = (eq: Eq) => (eq.rhs ? `${txt(eq.lhs)} = ${txt(eq.rhs)}` : txt(eq.lhs));
const signed = (t: Term) => (t.sign < 0 ? "−" : "") + (t.expr.kind === "sum" ? `(${txt(t.expr)})` : txt(t.expr));
const sideName = (s: Side) => (s === "lhs" ? "left" : "right");

/* ---------- Parser ---------- */
export type ParseResult = { ok: true; eq: Eq } | { ok: false; error: string };
export function parseEquation(src: unknown): ParseResult {
  if (typeof src !== "string" || !src.trim()) return { ok: false, error: "No expression was given." };
  if (src.length > 80) return { ok: false, error: "That expression is too long for the workbench." };
  const clean = src.replace(/[−–—]/g, "-").replace(/[·×]/g, "*").replace(/÷/g, "/").replace(/²/g, "^2").replace(/³/g, "^3");
  const toks: string[] = [];
  const re = /\s*(\d+|[a-zA-Z]|[-+*/()=^])/y;
  let at = 0;
  while (at < clean.length) {
    if (/^\s*$/.test(clean.slice(at))) break;
    re.lastIndex = at;
    const m = re.exec(clean);
    if (!m) {
      const ch = clean.slice(at).trim()[0];
      return { ok: false, error: ch === "." ? "Decimals aren't supported; write them as fractions." : `Unexpected “${ch}”.` };
    }
    toks.push(m[1]);
    at = re.lastIndex;
  }
  if (toks.filter(t => t === "=").length > 1) return { ok: false, error: "Use at most one = sign." };
  let i = 0;
  const peek = () => toks[i];
  const fail = (msg: string): never => { throw new Error(msg); };
  function sum(): Expr {
    const terms: Term[] = [];
    let sign: 1 | -1 = 1;
    if (peek() === "-") { i++; sign = -1; }
    terms.push({ sign, expr: term() });
    while (peek() === "+" || peek() === "-") { sign = toks[i++] === "-" ? -1 : 1; terms.push({ sign, expr: term() }); }
    return mkSum(terms, newId());
  }
  function term(): Expr {
    const factors = [factor()];
    while (peek() !== undefined && /^(\d+|[a-zA-Z]|\(|\*)$/.test(peek())) {
      if (peek() === "*") i++;
      factors.push(factor());
    }
    let e = mkProd(factors, newId());
    while (peek() === "/") {
      i++;
      const d = factor();
      if (isNum(d, 0)) fail("That divides by zero.");
      e = mkFrac(e, d, newId());
    }
    return e;
  }
  function factor(): Expr {
    const base = atom();
    if (peek() !== "^") return base;
    i++;
    const exp = atom();
    if (exp.kind !== "num") fail("Only whole-number powers are supported.");
    return mkPow(base, exp, newId());
  }
  function atom(): Expr {
    const t = toks[i++];
    if (t === undefined) return fail("The expression ends too early.");
    if (t === "(") {
      const e = sum();
      if (toks[i++] !== ")") fail("A bracket isn't closed.");
      return e;
    }
    if (/^\d+$/.test(t)) {
      const v = Number(t);
      if (v > 9999) fail("Numbers above 9999 aren't supported.");
      return num(v);
    }
    if (/^[a-zA-Z]$/.test(t)) return { kind: "var", id: newId(), name: t };
    return fail(`Unexpected “${t}”.`);
  }
  try {
    const lhs = sum();
    let rhs: Expr | null = null;
    if (peek() === "=") { i++; rhs = sum(); }
    if (i < toks.length) fail(`Unexpected “${toks[i]}”.`);
    return { ok: true, eq: { lhs, rhs } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ---------- Moves ---------- */
type Place = { inert: boolean; atomic: boolean; sideLevel: boolean; inParenFactor?: boolean; factorList?: FactorList };
type FactorList = {
  factors: Expr[]; set: (fs: Expr[]) => Eq;
  across: { side: Side; part: "num" | "den" } | null;
  opposite: { factors: Expr[]; setBoth: (mine: Expr[], theirs: Expr[]) => Eq } | null;
};
export type MoveOptions = { askSigns?: boolean };

const hasAsk = (e: Expr): boolean => e.kind === "sum" ? e.terms.some(t => t.ask || hasAsk(t.expr))
  : e.kind === "prod" ? e.factors.some(hasAsk) : e.kind === "frac" ? hasAsk(e.num) || hasAsk(e.den)
  : e.kind === "pow" ? hasAsk(e.base) : e.kind === "var" ? e.name === "?" : false;
export const eqHasAsk = (eq: Eq) => hasAsk(eq.lhs) || (!!eq.rhs && hasAsk(eq.rhs));

/** Every move available from `eq`, grouped by the node you drag. */
export function candidates(eq: Eq, opts: MoveOptions = {}): Map<string, Cand[]> {
  const out = new Map<string, Cand[]>();
  if (eqHasAsk(eq)) return out;
  const add = (c: Cand) => { const list = out.get(c.subject) ?? []; list.push(c); out.set(c.subject, list); };

  function termCands(subject: string, terms: Term[], idx: number, setTerms: (ts: Term[]) => Eq, across: Side | null, sum: Sum | null, sideLevelSum: boolean) {
    const t = terms[idx];
    const without = terms.filter((_t, i) => i !== idx);
    const mergeable = new Set<number>();
    terms.forEach((u, k) => {
      if (k === idx) return;
      const combined = combineTerms(t, u);
      if (combined) {
        mergeable.add(k);
        const next = terms.flatMap((v, i) => (i === idx ? [] : i === k ? combined : [v]));
        const res = combined.length ? signed(combined[0]) : "0";
        add({ subject, how: { type: "merge", target: u.expr.id, puff: { expr: t.expr, sign: t.sign } }, state: setTerms(next),
          info: { kind: "combine", label: `Combine ${signed(t)} and ${signed(u)}`, does: `Combine like terms: ${res}` } });
        return;
      }
      const wrong = slipUnlike(t, u);
      if (wrong) {
        mergeable.add(k);
        const next = terms.flatMap((v, i) => (i === idx ? [] : i === k ? [wrong] : [v]));
        add({ subject, how: { type: "merge", target: u.expr.id, puff: { expr: t.expr, sign: t.sign } }, state: setTerms(next),
          info: { kind: "slip", slip: "unlike", label: `Combine ${signed(t)} and ${signed(u)} into ${signed(wrong)}`,
            does: `Combine ${signed(t)} and ${signed(u)} into ${signed(wrong)}?`, parts: [signed(k < idx ? u : t), signed(k < idx ? t : u), signed(wrong)] } });
      }
    });
    terms.forEach((_u, j) => {
      const passed = (j < idx ? range(idx - j).map(n => j + n) : range(j - idx).map(n => idx + 1 + n)).filter(k => mergeable.has(k));
      const state = setTerms(insertAt(without, j, t));
      const info: MoveInfo = j === idx ? { kind: "stay", label: "", does: "" }
        : { kind: "reorder", label: j === 0 ? `Put ${signed(t)} first` : j === terms.length - 1 ? `Put ${signed(t)} last` : `Shift ${signed(t)} ${j < idx ? "left" : "right"}`, does: "Reorder: same value, new order" };
      add({ subject, how: passed.length ? { type: "reorder", pass: passed.map(k => terms[k].expr.id), dir: j < idx ? -1 : 1 } : { type: "place" }, state, info });
    });
    if (sum && sideLevelSum && t.expr.kind === "num") factorChoices(subject, sum, t.expr.value);
    if (across && eq.rhs) {
      const o = otherSide(across);
      const there = eq[o]!;
      const thereTerms = isNum(there, 0) ? [] : termsOf(there);
      const sumId = there.kind === "sum" ? there.id : newId();
      const flipped = (t.sign === 1 ? -1 : 1) as 1 | -1;
      const ask = !!opts.askSigns;
      const moved: Term = ask ? { sign: flipped, expr: t.expr, ask: true } : { sign: flipped, expr: t.expr };
      const base = setTerms(without);
      const X = t.expr.kind === "sum" ? `(${txt(t.expr)})` : txt(t.expr);
      const info: MoveInfo = ask
        ? { kind: "cross", label: `Move ${signed(t)} to the ${sideName(o)} side`, does: `${signed(t)} crosses the =. Which sign will it take?`,
            ask: { termId: t.expr.id, text: X, correct: flipped, side: o }, parts: [signed(t), o] }
        : { kind: "cross", label: `Move ${signed(t)} to the ${sideName(o)} side`, does: t.sign === 1 ? `Subtract ${X} from both sides` : `Add ${X} to both sides`, parts: [signed(t), o] };
      for (let j = 0; j <= thereTerms.length; j++)
        add({ subject, how: { type: "place" }, state: setSide(base, o, mkSum(insertAt(thereTerms, j, moved), sumId)), info });
      /* Dropped anywhere past the far end of the other side: it goes on that end. */
      const j = o === "lhs" ? 0 : thereTerms.length;
      add({ subject, how: { type: "zone", target: there.id, zone: o === "lhs" ? "before" : "after" }, state: setSide(base, o, mkSum(insertAt(thereTerms, j, moved), sumId)), info });
    }
  }

  function factorCands(list: FactorList, idx: number) {
    const { factors } = list;
    const f = factors[idx];
    const subject = f.id;
    const without = factors.filter((_f, i) => i !== idx);
    const mergeable = new Set<number>();
    const F = f.kind === "sum" ? `(${txt(f)})` : txt(f);
    factors.forEach((g, k) => {
      if (k === idx) return;
      /* Bracket on bracket only splits the first over the second, so the cross terms are built by hand. */
      const merged = f.kind === "sum" && g.kind === "sum" ? splitOver(k < idx ? g : f, k < idx ? f : g)
        : g.kind === "sum" ? distribute(f, g) : f.kind === "sum" ? distribute(g, cloneFresh(f) as Sum) : mergeFactors(f, g);
      if (!merged) return;
      mergeable.add(k);
      const next = factors.flatMap((h, i) => (i === idx ? [] : i === k ? [merged] : [h]));
      const G = g.kind === "sum" ? `(${txt(g)})` : txt(g);
      const isDist = g.kind === "sum" || f.kind === "sum";
      add({ subject, how: { type: "merge", target: g.id, puff: { expr: f, sign: null } }, state: list.set(next),
        info: f.kind === "sum" && g.kind === "sum"
          ? { kind: "distribute", label: `Split ${k < idx ? G + F : F + G} term by term`, does: `Each term of the first bracket times the second: ${txt(merged)}` }
          : isDist ? { kind: "distribute", label: `Multiply out ${k < idx ? G + F : F + G}`, does: `Multiply out: ${txt(merged)}` }
          : { kind: "merge", label: `Multiply ${F} by ${G}`, does: `Multiply: ${txt(merged)}` } });
    });
    if (list.opposite) {
      const opp = list.opposite;
      opp.factors.forEach((g, k) => {
        const c = cancel(f, g);
        if (!c) return;
        const mine = factors.flatMap((h, i) => (i === idx ? (c.f ? [c.f] : []) : [h]));
        const theirs = opp.factors.flatMap((h, i) => (i === k ? (c.g ? [c.g] : []) : [h]));
        const state = opp.setBoth(mine, theirs);
        add({ subject, how: { type: "merge", target: g.id, puff: { expr: f, sign: null } }, state,
          info: { kind: "cancel", label: `Cancel ${F} against ${txt(g)}`, does: `Cancel a common factor` } });
      });
    }
    factors.forEach((_g, j) => {
      const passed = (j < idx ? range(idx - j).map(n => j + n) : range(j - idx).map(n => idx + 1 + n)).filter(k => mergeable.has(k));
      add({ subject, how: passed.length ? { type: "reorder", pass: passed.map(k => factors[k].id), dir: j < idx ? -1 : 1 } : { type: "place" },
        state: list.set(insertAt(without, j, f)),
        info: j === idx ? { kind: "stay", label: "", does: "" } : { kind: "reorder", label: j === 0 ? `Put ${F} first` : j === factors.length - 1 ? `Put ${F} last` : `Shift ${F} ${j < idx ? "left" : "right"}`, does: "Reorder: same value, new order" } });
    });
    if (list.across && !isNum(f, 0) && eq.rhs) {
      const { side, part } = list.across;
      const o = otherSide(side);
      const base = list.set(without);
      const options = part === "num" ? dividedBy(eq[o]!, f) : multipliedBy(eq[o]!, f);
      const info: MoveInfo = part === "num"
        ? { kind: "divide", label: `Divide both sides by ${F}`, does: `Divide both sides by ${F}`, wild: f.kind === "sum" || f.kind === "frac" }
        : { kind: "multiply", label: `Multiply both sides by ${F}`, does: `Multiply both sides by ${F}`, wild: f.kind === "sum" || f.kind === "frac" };
      for (const there of options) add({ subject, how: { type: "place" }, state: setSide(base, o, there), info });
      /* "Across and down": anywhere under the other side divides it (from a denominator, multiplies). */
      add({ subject, how: { type: "zone", target: eq[o]!.id, zone: "below" }, state: setSide(base, o, options[0]), info });
    }
  }

  /** Taking out a common factor: one drop, then the learner picks which number (each divisor of the one dragged). */
  function factorChoices(subject: string, sum: Sum, value: number) {
    const cs = coefficients(sum);
    /* Only when the terms really share a factor: otherwise the drop would be a trap with no right answer. */
    if (!cs || value < 2 || cs.reduce((a, c) => gcd(a, c), 0) < 2) return;
    const divisors = range(Math.min(value, 9999)).map(i => i + 1).filter(d => d > 1 && value % d === 0).slice(0, 8);
    for (const d of divisors) {
      const offender = sum.terms.find((_t, i) => cs[i] % d !== 0);
      if (!offender) {
        const f = factorOutBy(sum, d, subject);
        add({ subject, how: { type: "left-of", edge: sum.id }, state: replaceNode(eq, sum.id, f),
          info: { kind: "factor", group: `factor-${sum.id}`, choice: String(d), label: `Take out the common factor ${d}`, does: `Take out ${d}: ${txt(f)}` } });
      } else {
        const oc = splitCoefficient(offender.expr)!.coef;
        add({ subject, how: { type: "left-of", edge: sum.id }, state: eq,
          info: { kind: "slip", slip: "not-common", group: `factor-${sum.id}`, choice: String(d), label: `Take out ${d}`, does: `Take out ${d}?`,
            parts: [String(d), signed(offender), String(oc), txt(sum)] } });
      }
    }
  }

  /* A number in front of a term inside a longer sum. It drags with its term, but it can also be pulled
     across the = on its own: the slip of dividing only one term. */
  function coefCands(sum: Sum, idx: number, setTerms: (ts: Term[]) => Eq, across: Side | null, sideLevelSum: boolean) {
    const t = sum.terms[idx];
    const prod = t.expr as Prod;
    const c = prod.factors[0] as Num;
    termCands(c.id, sum.terms, idx, setTerms, across, sum, sideLevelSum);
    /* 2(x + 3) − x: the 2 can still be multiplied into its own bracket. */
    prod.factors.forEach((g, k) => {
      if (k === 0 || g.kind !== "sum") return;
      const merged = distribute(c, g);
      const expr = mkProd(prod.factors.flatMap((h, i) => (i === 0 ? [] : i === k ? [merged] : [h])), prod.id);
      add({ subject: c.id, how: { type: "merge", target: g.id, puff: { expr: c, sign: null } },
        state: setTerms(sum.terms.map((u, i) => (i === idx ? { ...u, expr } : u))),
        info: { kind: "distribute", label: `Multiply out ${txt(prod)}`, does: `Multiply out: ${txt(merged)}` } });
    });
    if (sum && sideLevelSum) factorChoices(c.id, sum, c.value);
    if (across && eq.rhs && c.value > 1) {
      const o = otherSide(across);
      const rest = mkProd(prod.factors.slice(1), prod.id);
      const nextTerms = sum.terms.map((u, i) => (i === idx ? { ...u, expr: rest } : u));
      const base = setTerms(nextTerms);
      const there = dividedBy(eq[o]!, { ...c, id: c.id })[0];
      const wrongSide = mkSum(nextTerms, sum.id);
      const info: MoveInfo = { kind: "slip", slip: "divide-one", label: `Divide by ${c.value}, but only the ${signed(t)} term`,
        does: `Divide by ${c.value}, but only ${signed(t)} on the ${sideName(across)}?`, parts: [String(c.value), txt(sum), txt(wrongSide)] };
      add({ subject: c.id, how: { type: "place" }, state: setSide(base, o, there), info });
      add({ subject: c.id, how: { type: "zone", target: eq[o]!.id, zone: "below" }, state: setSide(base, o, there), info });
    }
  }

  /* a(a + b) + b(a + b): any factor of a term can be multiplied into a bracket in the same term,
     and grabbing it still moves the whole term. */
  function innerCands(sum: Sum, idx: number, k: number, setTerms: (ts: Term[]) => Eq, across: Side | null) {
    const prod = sum.terms[idx].expr as Prod;
    const f = prod.factors[k];
    termCands(f.id, sum.terms, idx, setTerms, across, sum, false);
    prod.factors.forEach((g, j) => {
      if (j === k || (f.kind === "sum") === (g.kind === "sum")) return;
      const merged = g.kind === "sum" ? distribute(f, g) : distribute(g, cloneFresh(f) as Sum);
      const expr = mkProd(prod.factors.flatMap((h, i) => (i === k ? [] : i === j ? [merged] : [h])), prod.id);
      add({ subject: f.id, how: { type: "merge", target: g.id, puff: { expr: f, sign: null } },
        state: setTerms(sum.terms.map((u, i) => (i === idx ? { ...u, expr } : u))),
        info: { kind: "distribute", label: `Multiply out ${txt(prod)}`, does: `Multiply out: ${txt(merged)}` } });
    });
  }

  function expCands(pow: Pow) {
    const { base, exp } = pow;
    const n = exp.kind === "num" ? exp.value : null;
    const v = evalPow(base, exp);
    const worked = v !== null ? num(v, base.id)
      : n !== null && n >= 2 && n <= 4 ? mkProd([base, ...range(n - 1).map(() => cloneFresh(base))], newId()) : null;
    if (worked) add({ subject: exp.id, how: base.kind === "sum" ? { type: "zone", target: base.id, zone: "below-or-parens" } : { type: "merge", target: base.id, puff: { expr: exp, sign: null } },
      state: replaceNode(eq, pow.id, worked),
      info: { kind: "power", label: `Write ${txt(pow)} out in full`, does: `${txt(pow)} means ${txt(worked)}` } });
    if (base.kind === "sum" && n !== null && n >= 2) {
      const wrong = mkSum(base.terms.map(t => ({ sign: (n % 2 === 0 ? 1 : t.sign) as 1 | -1, expr: mkPow(t.expr, num(n), newId()) })), newId());
      for (const t of base.terms) add({ subject: exp.id, how: { type: "on-content", target: t.expr.id, puff: { expr: exp, sign: null } },
        state: replaceNode(eq, pow.id, wrong),
        info: { kind: "slip", slip: "power", label: `Square each term: ${txt(wrong)}`, does: `Square each term: ${txt(wrong)}?`, parts: [txt(pow), txt(wrong)] } });
    }
  }

  function walk(e: Expr, p: Place, side: Side) {
    const childInert = p.inert || p.atomic;
    switch (e.kind) {
      case "num": case "var": return;
      case "sum": {
        const multi = e.terms.length >= 2;
        const setTerms = (ts: Term[]) => replaceNode(eq, e.id, mkSum(ts, e.id));
        const across = p.sideLevel ? side : null;
        /* A bracketed sum that is one factor of a product moves as a whole: grab anywhere in (x + 1). */
        const termsInert = childInert || !!p.inParenFactor;
        e.terms.forEach((t, i) => {
          if (!termsInert) {
            termCands(t.expr.id, e.terms, i, setTerms, across, e, p.sideLevel);
            if (multi && t.expr.kind === "prod" && t.expr.factors.length >= 2) {
              const prod = t.expr;
              prod.factors.forEach((f, k) => {
                if (k === 0 && f.kind === "num") coefCands(e, i, setTerms, across, p.sideLevel);
                else if (prod.factors.some(g => g.kind === "sum")) innerCands(e, i, k, setTerms, across);
              });
            }
          }
          walk(t.expr, { inert: termsInert, atomic: multi, sideLevel: p.sideLevel && !multi }, side);
        });
        return;
      }
      case "prod": {
        const list: FactorList = p.factorList ?? {
          factors: e.factors, set: fs => replaceNode(eq, e.id, mkProd(fs, e.id)),
          across: p.sideLevel ? { side, part: "num" } : null, opposite: null,
        };
        e.factors.forEach((f, i) => {
          if (!childInert) factorCands(list, i);
          walk(f, { inert: childInert, atomic: false, sideLevel: false, inParenFactor: f.kind === "sum" }, side);
        });
        return;
      }
      case "frac": {
        const numId = () => (e.num.kind === "prod" ? e.num.id : newId());
        const denId = () => (e.den.kind === "prod" ? e.den.id : newId());
        const across = (part: "num" | "den") => (p.sideLevel ? { side, part } : null);
        const numList: FactorList = {
          factors: factorsOf(e.num), set: fs => replaceNode(eq, e.id, mkFrac(mkProd(fs, numId()), e.den, e.id)), across: across("num"),
          opposite: { factors: factorsOf(e.den), setBoth: (mine, theirs) => replaceNode(eq, e.id, mkFrac(mkProd(mine, numId()), mkProd(theirs, denId()), e.id)) },
        };
        const denList: FactorList = {
          factors: factorsOf(e.den), set: fs => replaceNode(eq, e.id, mkFrac(e.num, mkProd(fs, denId()), e.id)), across: across("den"),
          opposite: { factors: factorsOf(e.num), setBoth: (mine, theirs) => replaceNode(eq, e.id, mkFrac(mkProd(theirs, numId()), mkProd(mine, denId()), e.id)) },
        };
        for (const [x, list] of [[e.num, numList], [e.den, denList]] as const) {
          if (x.kind === "prod") walk(x, { inert: childInert, atomic: false, sideLevel: false, factorList: list }, side);
          else {
            if (!childInert) factorCands(list, 0);
            walk(x, { inert: childInert, atomic: false, sideLevel: false }, side);
          }
        }
        return;
      }
      case "pow": {
        if (!childInert) expCands(e);
        walk(e.base, { inert: childInert, atomic: false, sideLevel: false, inParenFactor: e.base.kind === "sum" }, side);
        return;
      }
    }
  }

  for (const side of (eq.rhs ? ["lhs", "rhs"] : ["lhs"]) as Side[]) {
    const e = eq[side]!;
    if (e.kind !== "sum") termCands(e.id, [{ sign: 1, expr: e }], 0, ts => setSide(eq, side, mkSum(ts, newId())), side, null, false);
    walk(e, { inert: false, atomic: false, sideLevel: true }, side);
  }
  return out;
}

/** Drop an `ask` flag, giving the term the chosen sign. */
export function settleAsk(eq: Eq, sign: 1 | -1): Eq {
  const fix = (e: Expr): Expr => e.kind === "sum" ? { ...e, terms: e.terms.map(t => (t.ask ? { sign, expr: fix(t.expr) } : { ...t, expr: fix(t.expr) })) }
    : e.kind === "prod" ? { ...e, factors: e.factors.map(fix) } : e.kind === "frac" ? { ...e, num: fix(e.num), den: fix(e.den) }
    : e.kind === "pow" ? { ...e, base: fix(e.base) } : e;
  return { lhs: normalize(fix(eq.lhs)), rhs: eq.rhs && normalize(fix(eq.rhs)) };
}

/* ---------- Evaluation, goals, search ---------- */
export function evalExpr(e: Expr, env: Record<string, number>): number {
  switch (e.kind) {
    case "num": return e.value;
    case "var": return env[e.name] ?? NaN;
    case "sum": return e.terms.reduce((a, t) => a + t.sign * evalExpr(t.expr, env), 0);
    case "prod": return e.factors.reduce((a, f) => a * evalExpr(f, env), 1);
    case "frac": return evalExpr(e.num, env) / evalExpr(e.den, env);
    case "pow": return evalExpr(e.base, env) ** evalExpr(e.exp, env);
  }
}
export function varsOf(eq: Eq): string[] {
  const s = new Set<string>();
  const go = (e: Expr) => { if (e.kind === "var") s.add(e.name); else if (e.kind === "sum") e.terms.forEach(t => go(t.expr)); else if (e.kind === "prod") e.factors.forEach(go); else if (e.kind === "frac") { go(e.num); go(e.den); } else if (e.kind === "pow") { go(e.base); go(e.exp); } };
  go(eq.lhs); if (eq.rhs) go(eq.rhs);
  return [...s].sort();
}
/** The solution of a linear equation in `v`, if it has exactly one (exact; see solveLinearExact). */
export function solveLinear(eq: Eq, v: string): number | null {
  const r = solveLinearExact(eq, v);
  return r.ok ? r.x : null;
}
export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return "undefined";
  const neg = x < 0 ? "−" : "";
  const a = Math.abs(x);
  if (Math.abs(a - Math.round(a)) < 1e-9) return neg + Math.round(a);
  for (let d = 2; d <= 60; d++) { const n = a * d; if (Math.abs(n - Math.round(n)) < 1e-9) return `${neg}${Math.round(n)}/${d}`; }
  return neg + a.toFixed(2);
}
function isNumber(e: Expr): boolean {
  if (e.kind === "num") return true;
  if (e.kind === "sum") return e.terms.length === 1 && isNumber(e.terms[0].expr);
  if (e.kind === "frac") return e.num.kind === "num" && e.den.kind === "num" && gcd(e.num.value, e.den.value) === 1;
  return false;
}
/** A sum of monomials with no like terms and nothing left to multiply out. */
function isSimplified(e: Expr): boolean {
  const mono = (m: Expr): string | null => {
    const fs = factorsOf(m);
    let nums = 0;
    const keys: string[] = [];
    for (const f of fs) {
      if (f.kind === "num") { if (++nums > 1 || (fs.length > 1 && f !== fs[0])) return null; }
      else if (f.kind === "var") keys.push(f.name);
      else if (f.kind === "pow" && f.base.kind === "var" && f.exp.kind === "num") keys.push(f.base.name);
      else return null;
    }
    if (new Set(keys).size !== keys.length) return null;
    if (nums && fs.length > 1 && isNum(fs[0], 1)) return null;
    return restKey(fs.filter(f => f.kind !== "num"));
  };
  const keys = termsOf(e).map(t => mono(t.expr));
  if (keys.some(k => k === null)) return false;
  return new Set(keys).size === keys.length;
}
function isFactored(e: Expr): boolean {
  if (e.kind !== "prod") return false;
  const sums = e.factors.filter((f): f is Sum => f.kind === "sum");
  if (sums.length !== 1) return false;
  const cs = coefficients(sums[0]);
  return !!cs && cs.reduce((a, c) => gcd(a, c), 0) === 1 && e.factors.every(f => f.kind !== "frac") && e.factors.filter(f => f.kind === "num").length <= 1;
}
export function goalReached(eq: Eq, goal: Goal, v = "x"): boolean {
  if (eqHasAsk(eq)) return false;
  switch (goal) {
    case "isolate":
      return !!eq.rhs && ((eq.lhs.kind === "var" && eq.lhs.name === v && isNumber(eq.rhs)) || (eq.rhs.kind === "var" && eq.rhs.name === v && isNumber(eq.lhs)));
    case "equivalent": return !!eq.rhs && canon(eq.lhs) === canon(eq.rhs);
    case "simplify": case "expand": return isSimplified(eq.lhs) && (!eq.rhs || isSimplified(eq.rhs));
    case "factor": return !eq.rhs && isFactored(eq.lhs);
  }
}
function size(e: Expr): number {
  switch (e.kind) {
    case "num": case "var": return 1;
    case "sum": return 1 + e.terms.reduce((a, t) => a + size(t.expr), 0);
    case "prod": return 1 + e.factors.reduce((a, f) => a + size(f), 0);
    case "frac": return 1 + size(e.num) + size(e.den);
    case "pow": return 1 + size(e.base) + size(e.exp);
  }
}
const eqSize = (eq: Eq) => size(eq.lhs) + (eq.rhs ? size(eq.rhs) : 0);
/** Moves that change the line (not reorders, not slips), each result once. */
export function realMoves(eq: Eq, opts: MoveOptions = {}): Cand[] {
  const seen = new Set<string>();
  const out: Cand[] = [];
  const here = eqCanon(eq);
  for (const list of candidates(eq, opts).values()) for (const c of list) {
    if (c.info.kind === "stay" || c.info.kind === "reorder" || c.info.slip) continue;
    const key = eqCanon(c.state);
    if (key === here || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
export type Route = { dist: number; first: Cand | null; path: string[] };
/** Breadth-first search for the fewest moves to the goal (reorders are free and not counted). */
export function shortestRoute(eq: Eq, goal: Goal, v = "x", limit = 6000): Route | null {
  if (goalReached(eq, goal, v)) return { dist: 0, first: null, path: [] };
  const cap = eqSize(eq) + 12;
  type Node = { eq: Eq; first: Cand; path: string[] };
  const seen = new Set([eqCanon(eq)]);
  let frontier: Node[] = [];
  for (const c of realMoves(eq)) if (!c.info.wild) {
    const k = eqCanon(c.state);
    if (seen.has(k)) continue;
    seen.add(k);
    if (goalReached(c.state, goal, v)) return { dist: 1, first: c, path: [c.info.label] };
    frontier.push({ eq: c.state, first: c, path: [c.info.label] });
  }
  for (let depth = 2; depth <= 12 && frontier.length; depth++) {
    const next: Node[] = [];
    for (const n of frontier) {
      for (const c of realMoves(n.eq)) {
        if (c.info.wild || eqSize(c.state) > cap) continue;
        const k = eqCanon(c.state);
        if (seen.has(k)) continue;
        seen.add(k);
        const path = [...n.path, c.info.label];
        if (goalReached(c.state, goal, v)) return { dist: depth, first: n.first, path };
        next.push({ eq: c.state, first: n.first, path });
        if (seen.size > limit) return null;
      }
    }
    frontier = next;
  }
  return null;
}
/** Every node with the text it shows, for tests and screen readers. */
export function nodeList(eq: Eq): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const go = (e: Expr, lead = "") => {
    out.push({ id: e.id, text: lead + txt(e) });
    if (e.kind === "sum") e.terms.forEach((t, i) => go(t.expr, t.sign < 0 ? "−" : i ? "+" : ""));
    else if (e.kind === "prod") e.factors.forEach(f => go(f));
    else if (e.kind === "frac") { go(e.num); go(e.den); }
    else if (e.kind === "pow") { go(e.base); go(e.exp); }
  };
  go(eq.lhs); if (eq.rhs) go(eq.rhs);
  return out;
}

/** The line while the learner picks a common factor: ?(6x + 9). */
export function factorPreview(eq: Eq, sumId: string): Eq {
  const target = findById(eq, sumId);
  if (!target) return eq;
  return replaceNode(eq, sumId, mkProd([{ kind: "var", id: `${sumId}-q`, name: "?" }, target], `${sumId}-qp`));
}
function findById(eq: Eq, id: string): Expr | null {
  let hit: Expr | null = null;
  const go = (e: Expr) => { if (hit) return; if (e.id === id) { hit = e; return; }
    if (e.kind === "sum") e.terms.forEach(t => go(t.expr)); else if (e.kind === "prod") e.factors.forEach(go); else if (e.kind === "frac") { go(e.num); go(e.den); } else if (e.kind === "pow") { go(e.base); go(e.exp); } };
  go(eq.lhs); if (eq.rhs) go(eq.rhs);
  return hit;
}
/** Canonical key of an expression string, or null if it doesn't parse (for compareWith). */
export function exprCanon(e: Expr): string { return canon(e); }
export function termKeys(e: Expr): { key: string; text: string }[] {
  return termsOf(e).map(t => ({ key: (t.sign < 0 ? "-" : "+") + canon(t.expr), text: signed(t) }));
}

/* ---------- Exact polynomial arithmetic (Astra fix wave) ----------
   Identities and solutions are decided symbolically, never by sampling: sampling certified
   (x − 2)(x − 7)(x − 3) = 0 because every sample point was a root. Each side is reduced to a quotient of
   polynomials with exact rational coefficients (BigInt). A polynomial is a map from a monomial key
   ("a^2*b^1", "" for the constant) to its coefficient. */
type Q = { n: bigint; d: bigint };
const bgcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const q = (n: bigint, d = 1n): Q => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const qadd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
export type Poly = Map<string, Q>;
const MAX_TERMS = 400, MAX_POWER = 12;
class Unsupported extends Error {}
function monoParse(k: string): Map<string, number> { const m = new Map<string, number>(); if (k) for (const p of k.split("*")) { const [v, e] = p.split("^"); m.set(v, Number(e)); } return m; }
function monoKey(m: Map<string, number>): string { return [...m].filter(([, e]) => e > 0).sort(([a], [b]) => a.localeCompare(b)).map(([v, e]) => `${v}^${e}`).join("*"); }
function padd(a: Poly, b: Poly, sign: 1n | -1n = 1n): Poly {
  const out: Poly = new Map(a);
  for (const [k, c] of b) { const s = qadd(out.get(k) ?? q(0n), q(sign * c.n, c.d)); if (s.n === 0n) out.delete(k); else out.set(k, s); }
  if (out.size > MAX_TERMS) throw new Unsupported("That expression grows too large to compare exactly.");
  return out;
}
function pmul(a: Poly, b: Poly): Poly {
  let out: Poly = new Map();
  for (const [ka, ca] of a) for (const [kb, cb] of b) {
    const m = monoParse(ka); for (const [v, e] of monoParse(kb)) m.set(v, (m.get(v) ?? 0) + e);
    out = padd(out, new Map([[monoKey(m), qmul(ca, cb)]]));
  }
  return out;
}
const pconst = (n: bigint, d = 1n): Poly => (n === 0n ? new Map() : new Map([["", q(n, d)]]));
const isConstPoly = (p: Poly) => [...p.keys()].every(k => k === "");
/** A rational function num/den in lowest form only up to constants (den is never the zero polynomial). */
type Rat = { num: Poly; den: Poly };
function ratOf(e: Expr): Rat {
  switch (e.kind) {
    case "num": return { num: pconst(BigInt(e.value)), den: pconst(1n) };
    case "var": return { num: new Map([[`${e.name}^1`, q(1n)]]), den: pconst(1n) };
    case "sum": return e.terms.reduce<Rat>((acc, t) => {
      const r = ratOf(t.expr);
      return { num: padd(pmul(acc.num, r.den), pmul(r.num, acc.den), t.sign < 0 ? -1n : 1n), den: pmul(acc.den, r.den) };
    }, { num: new Map(), den: pconst(1n) });
    case "prod": return e.factors.reduce<Rat>((acc, f) => { const r = ratOf(f); return { num: pmul(acc.num, r.num), den: pmul(acc.den, r.den) }; }, { num: pconst(1n), den: pconst(1n) });
    case "frac": {
      const a = ratOf(e.num), b = ratOf(e.den);
      if (b.num.size === 0) throw new Unsupported("That divides by zero.");
      return { num: pmul(a.num, b.den), den: pmul(a.den, b.num) };
    }
    case "pow": {
      const ex = ratOf(e.exp);
      if (!isConstPoly(ex.num) || !isConstPoly(ex.den)) throw new Unsupported("Only whole-number powers are supported.");
      const nq = qmul(ex.num.get("") ?? q(0n), { n: (ex.den.get("") ?? q(1n)).d, d: (ex.den.get("") ?? q(1n)).n });
      const qq = q(nq.n, nq.d);
      if (qq.d !== 1n || qq.n < 0n) throw new Unsupported("Only whole-number powers are supported.");
      if (qq.n > BigInt(MAX_POWER)) throw new Unsupported(`Powers above ${MAX_POWER} are too large to compare exactly.`);
      const b = ratOf(e.base);
      let r: Rat = { num: pconst(1n), den: pconst(1n) };
      for (let i = 0n; i < qq.n; i++) r = { num: pmul(r.num, b.num), den: pmul(r.den, b.den) };
      return r;
    }
  }
}
const hasVarDen = (r: Rat) => !isConstPoly(r.den);
function scaleByConstDen(r: Rat): Poly {
  const c = r.den.get("")!; // constant, non-zero
  return pmul(r.num, pconst(c.d, c.n));
}
export type Comparison = { ok: true; same: boolean } | { ok: false; error: string };
/** Whether two expressions are the same polynomial. Only polynomials are certified: an expression with a
 *  letter in a denominator is equal to another only where the denominator isn't 0, so it is rejected. */
export function samePolynomial(a: Expr, b: Expr): Comparison {
  try {
    const ra = ratOf(a), rb = ratOf(b);
    if (hasVarDen(ra) || hasVarDen(rb)) return { ok: false, error: "The workbench can only compare expressions without a letter in a denominator; such an identity would hold only where the denominator isn't 0." };
    return { ok: true, same: padd(scaleByConstDen(ra), scaleByConstDen(rb), -1n).size === 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Unsupported ? e.message : "That expression can't be compared exactly." };
  }
}
/** The value of a polynomial (exact) at an integer point, as a number. */
function pevalExact(p: Poly, env: Record<string, number>): Q {
  let s = q(0n);
  for (const [k, c] of p) { let t = c; for (const [v, e] of monoParse(k)) t = qmul(t, q(BigInt(env[v] ?? 0) ** BigInt(e))); s = qadd(s, t); }
  return s;
}
/** Small whole-number values at which a and b differ (for the "No" numeric check), or null. */
export function pointWhereDifferent(a: Expr, b: Expr, names: string[]): Record<string, number> | null {
  let diff: Poly;
  try { const ra = ratOf(a), rb = ratOf(b); if (hasVarDen(ra) || hasVarDen(rb)) return null; diff = padd(scaleByConstDen(ra), scaleByConstDen(rb), -1n); }
  catch { return null; }
  if (diff.size === 0) return null;
  const tries = [[2, 3, 5], [3, 2, 7], [1, 4, 2], [5, 7, 3], [4, 1, 6], [6, 5, 1], [7, 6, 4], [1, 1, 1], [8, 9, 11], [10, 3, 13]];
  for (const t of tries) { const env = Object.fromEntries(names.map((n, i) => [n, t[i % 3] + Math.floor(i / 3)])); if (pevalExact(diff, env).n !== 0n) return env; }
  for (let x = 1; x < 40; x++) { const env = Object.fromEntries(names.map((n, i) => [n, x + i * 13])); if (pevalExact(diff, env).n !== 0n) return env; }
  return null;
}
export type LinearSolve = { ok: true; x: number } | { ok: false; error: string };
/** Solves lhs = rhs in `v` exactly. The equation is brought to N/D = 0; N must have degree exactly 1 in v
 *  (degree read from the expression tree, not guessed from samples), and the root must not make D zero. */
export function solveLinearExact(eq: Eq, v: string): LinearSolve {
  if (!eq.rhs) return { ok: false, error: "This goal needs an equation with an = sign." };
  try {
    const l = ratOf(eq.lhs), r = ratOf(eq.rhs);
    const num = padd(pmul(l.num, r.den), pmul(r.num, l.den), -1n);
    const den = pmul(l.den, r.den);
    let c1 = q(0n), c0 = q(0n), deg = 0;
    for (const [k, c] of num) {
      const m = monoParse(k);
      for (const name of m.keys()) if (name !== v) return { ok: false, error: `The equation should contain only the letter ${v}.` };
      const e = m.get(v) ?? 0;
      deg = Math.max(deg, e);
      if (e === 1) c1 = c; else if (e === 0) c0 = c;
    }
    if (num.size === 0) return { ok: false, error: `That equation is true for every value of ${v}, so there is no single solution.` };
    if (deg === 0) return { ok: false, error: "That equation has no solution." };
    if (deg > 1) return { ok: false, error: `That equation isn't linear in ${v} (it has ${v}${[...String(deg)].map(d => SUP[d]).join("")} once everything is gathered), so it may have more than one solution.` };
    const root = q(-c0.n * c1.d, c0.d * c1.n);
    if (!isConstPoly(den)) {
      const at = pevalAtQ(den, v, root);
      if (at.n === 0n) return { ok: false, error: `The only candidate, ${v} = ${fmtNum(Number(root.n) / Number(root.d))}, makes a denominator 0, so the equation has no solution.` };
    }
    return { ok: true, x: Number(root.n) / Number(root.d) };
  } catch (e) {
    return { ok: false, error: e instanceof Unsupported ? e.message : "That equation can't be solved exactly here." };
  }
}
function pevalAtQ(p: Poly, v: string, x: Q): Q {
  let s = q(0n);
  for (const [k, c] of p) { const e = monoParse(k).get(v) ?? 0; let t = c; for (let i = 0; i < e; i++) t = qmul(t, x); s = qadd(s, t); }
  return s;
}
