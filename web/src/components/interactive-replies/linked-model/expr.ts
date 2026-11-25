/* A tiny, safe arithmetic evaluator for model-authored formulas.
   No eval, no new Function: formulas are tokenised, parsed by precedence climbing into a
   small tree, and compiled into closures over a numeric context. Only whitelisted functions
   and constants exist; every free name must be declared. */

export type Ctx = Record<string, number>;
export type Fn = (ctx: Ctx) => number;
export type Compiled = { fn: Fn; names: string[]; source: string };
export type Funcs = Record<string, (...args: number[]) => number>;

const MAX_LEN = 240, MAX_DEPTH = 40;

const BUILTIN_TABLE: Funcs = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
  log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, atan: Math.atan, atan2: Math.atan2, tanh: Math.tanh,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), pow: (a, b) => Math.pow(a, b),
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
};
/* Registries are Maps, so inherited Object.prototype names ("constructor", "toString", "__proto__")
   never count as functions, constants or variables. */
const BUILTINS = new Map(Object.entries(BUILTIN_TABLE));
const CONSTANTS = new Map<string, number>([["pi", Math.PI], ["e", Math.E]]);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** A user-supplied function registry, own properties only. */
const userFunc = (funcs: Funcs, name: string) => (own(funcs, name) && typeof funcs[name] === "function" ? funcs[name] : undefined);
/** Every intermediate is a number; anything else (a function's odd return) becomes NaN. */
const numeric = (v: unknown): number => (typeof v === "number" ? v : NaN);

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };
type Node =
  | { t: "num"; v: number } | { t: "var"; n: string }
  | { t: "un"; op: string; a: Node } | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "call"; f: string; args: Node[] } | { t: "cond"; c: Node; a: Node; b: Node };

export class ExprError extends Error {}

function tokenize(src: string): Tok[] {
  const s = src.replace(/[·×]/g, "*").replace(/[−–]/g, "-").replace(/÷/g, "/");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { out.push({ k: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ k: "id", v: id[0] }); i += id[0].length; continue; }
    const two = s.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||", "**"].includes(two)) { out.push({ k: "op", v: two === "**" ? "^" : two }); i += 2; continue; }
    if ("+-*/^(),<>!?:%".includes(c)) { out.push({ k: "op", v: c }); i++; continue; }
    throw new ExprError(`unexpected “${c}”`);
  }
  if (out.length > 160) throw new ExprError("formula is too long");
  return out;
}

function parse(src: string, funcs: Funcs): Node {
  if (typeof src !== "string" || !src.trim()) throw new ExprError("empty formula");
  if (src.length > MAX_LEN) throw new ExprError("formula is too long");
  const toks = tokenize(src);
  let pos = 0, depth = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
  const take = (v: string) => { if (!isOp(v)) throw new ExprError(`expected “${v}”`); pos++; };
  const deeper = <T,>(f: () => T): T => { if (++depth > MAX_DEPTH) throw new ExprError("formula nests too deeply"); const r = f(); depth--; return r; };

  const ternary = (): Node => deeper(() => {
    const c = or();
    if (isOp("?")) { pos++; const a = ternary(); take(":"); const b = ternary(); return { t: "cond", c, a, b }; }
    return c;
  });
  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    while (peek()?.k === "op" && ops.includes(peek()!.v as string)) { const op = (toks[pos++] as Tok).v as string; a = { t: "bin", op, a, b: next() }; }
    return a;
  };
  const unary = (): Node => deeper(() => {
    if (isOp("-") || isOp("+") || isOp("!")) { const op = (toks[pos++] as Tok).v as string; return { t: "un", op, a: unary() }; }
    return power();
  });
  const power = (): Node => {
    const base = primary();
    if (isOp("^")) { pos++; return { t: "bin", op: "^", a: base, b: unary() }; }
    return base;
  };
  const mul = binary(["*", "/", "%"], unary);
  const add = binary(["+", "-"], mul);
  const cmp = binary(["<", ">", "<=", ">=", "==", "!="], add);
  const and = binary(["&&"], cmp);
  const or = binary(["||"], and);
  function primary(): Node {
    const tok = toks[pos++];
    if (!tok) throw new ExprError("formula ends too early");
    if (tok.k === "num") return { t: "num", v: tok.v };
    if (tok.k === "op" && tok.v === "(") { const n = ternary(); take(")"); return n; }
    if (tok.k === "id") {
      if (isOp("(")) {
        pos++;
        if (!BUILTINS.has(tok.v) && !userFunc(funcs, tok.v)) throw new ExprError(`unknown function “${tok.v}”`);
        const args: Node[] = [];
        if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { pos++; args.push(ternary()); } }
        take(")");
        return { t: "call", f: tok.v, args };
      }
      return { t: "var", n: tok.v };
    }
    throw new ExprError(`unexpected “${tok.v}”`);
  }
  const node = ternary();
  if (pos < toks.length) throw new ExprError(`unexpected “${(toks[pos] as Tok).v}”`);
  return node;
}

function freeNames(n: Node, out: Set<string>) {
  if (n.t === "var") out.add(n.n);
  else if (n.t === "un") freeNames(n.a, out);
  else if (n.t === "bin") { freeNames(n.a, out); freeNames(n.b, out); }
  else if (n.t === "call") n.args.forEach(a => freeNames(a, out));
  else if (n.t === "cond") { freeNames(n.c, out); freeNames(n.a, out); freeNames(n.b, out); }
}

function build(n: Node, funcs: Funcs): Fn {
  switch (n.t) {
    case "num": { const v = n.v; return () => v; }
    case "var": {
      const name = n.n;
      const k = CONSTANTS.get(name);
      return ctx => (own(ctx, name) ? numeric(ctx[name]) : k ?? NaN);
    }
    case "un": {
      const a = build(n.a, funcs);
      return n.op === "-" ? c => -a(c) : n.op === "!" ? c => (a(c) ? 0 : 1) : a;
    }
    case "cond": { const c = build(n.c, funcs), a = build(n.a, funcs), b = build(n.b, funcs); return x => (c(x) ? a(x) : b(x)); }
    case "call": {
      const f = userFunc(funcs, n.f) ?? BUILTINS.get(n.f);
      if (!f) throw new ExprError(`unknown function “${n.f}”`);
      const args = n.args.map(a => build(a, funcs));
      return c => numeric(f(...args.map(a => a(c))));
    }
    case "bin": {
      const a = build(n.a, funcs), b = build(n.b, funcs);
      switch (n.op) {
        case "+": return c => a(c) + b(c);
        case "-": return c => a(c) - b(c);
        case "*": return c => a(c) * b(c);
        case "/": return c => a(c) / b(c);
        case "%": return c => a(c) % b(c);
        case "^": return c => Math.pow(a(c), b(c));
        case "<": return c => +(a(c) < b(c));
        case ">": return c => +(a(c) > b(c));
        case "<=": return c => +(a(c) <= b(c));
        case ">=": return c => +(a(c) >= b(c));
        case "==": return c => +(a(c) === b(c));
        case "!=": return c => +(a(c) !== b(c));
        case "&&": return c => +(!!a(c) && !!b(c));
        case "||": return c => +(!!a(c) || !!b(c));
      }
    }
  }
  throw new ExprError("bad formula");
}

/** Compile a formula. `allowed` lists every name the formula may use (constants pi and e are implicit). */
export function compile(source: string, allowed: Iterable<string>, funcs: Funcs = {}): Compiled {
  const node = parse(source, funcs);
  const names = new Set<string>();
  freeNames(node, names);
  const ok = new Set(allowed);
  for (const name of names) if (!ok.has(name) && !CONSTANTS.has(name)) throw new ExprError(`unknown name “${name}”`);
  return { fn: build(node, funcs), names: [...names], source };
}

export const builtinNames = [...BUILTINS.keys()];
/** The formula's value when it is a finite number, else null (for consumers that need a usable number). */
export function finiteOr<T>(fn: Fn, ctx: Ctx, fallback: T): number | T { const v = fn(ctx); return Number.isFinite(v) ? v : fallback; }
