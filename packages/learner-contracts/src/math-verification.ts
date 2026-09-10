/** Deliberately bounded exact math, not a general CAS or a model-authored proof. */
export type MathProblem =
  | { kind: 'arithmetic'; expression: string }
  | { kind: 'linear-equation'; left: string; right: string; variable: 'x' };

export type MathVerification = {
  status: 'verified' | 'rejected' | 'unsupported';
  reason: string;
  prompt: string;
  expectedAnswer?: string;
  actualAnswer?: string;
};

type Rational = { n: bigint; d: bigint };
type Linear = { a: Rational; b: Rational };
type Node = { type: 'number'; value: string } | { type: 'variable' }
  | { type: 'negate'; child: Node }
  | { type: 'binary'; op: string; left: Node; right: Node };
const LIMIT = 512;
const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };
function fail(reason: string): never { throw new Error(reason); }
function bounded(n: bigint): bigint {
  if (n.toString(2).length > 4096) fail('Exact calculation exceeds the size limit.');
  return n;
}
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) fail('Division by zero is undefined.');
  bounded(n); bounded(d);
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) { const r = a % b; a = b; b = r; }
  return { n: n / a, d: d / a };
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function neg(a: Rational): Rational { return { n: -a.n, d: a.d }; }
function mul(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function div(a: Rational, b: Rational): Rational { return rational(a.n * b.d, a.d * b.n); }
function format(a: Rational): string { return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`; }
function number(value: string): Rational {
  const [whole, fraction = ''] = value.split('.');
  if (whole.length + fraction.length > 64) fail('A numeric literal exceeds 64 digits.');
  return rational(BigInt((whole || '0') + fraction), 10n ** BigInt(fraction.length));
}

function parse(source: string, variable: boolean): Node {
  if (source.length === 0 || source.length > LIMIT) fail('An expression must contain 1 to 512 characters.');
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) { cursor++; continue; }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+|[x()+*/-])/.exec(source.slice(cursor));
    if (!match) fail('Only decimal numbers, x, parentheses, and + - * / are supported.');
    tokens.push(match[0]); cursor += match[0].length;
    if (tokens.length > 256) fail('An expression exceeds 256 tokens.');
  }
  let index = 0;
  function primary(depth: number): Node {
    if (depth > 32) fail('An expression exceeds the nesting limit.');
    const token = tokens[index++];
    if (token === '+' || token === '-') {
      const child = primary(depth + 1);
      return token === '-' ? { type: 'negate', child } : child;
    }
    if (token === '(') {
      const node = expression(depth + 1);
      if (tokens[index++] !== ')') fail('Unmatched parentheses.');
      return node;
    }
    if (token === 'x' && variable) return { type: 'variable' };
    if (token && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      number(token); // Validate literal bounds before admitting the problem.
      return { type: 'number', value: token };
    }
    fail('Expected a numeric expression.');
  }
  function product(depth: number): Node {
    let node = primary(depth);
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++];
      node = { type: 'binary', op, left: node, right: primary(depth) };
    }
    return node;
  }
  function expression(depth: number): Node {
    let node = product(depth);
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++];
      node = { type: 'binary', op, left: node, right: product(depth) };
    }
    return node;
  }
  const node = expression(0);
  if (index !== tokens.length) fail('Unexpected trailing input; multiplication must use *.');
  return node;
}

function evaluate(node: Node): Linear {
  if (node.type === 'number') return { a: ZERO, b: number(node.value) };
  if (node.type === 'variable') return { a: ONE, b: ZERO };
  if (node.type === 'negate') { const v = evaluate(node.child); return { a: neg(v.a), b: neg(v.b) }; }
  const l = evaluate(node.left), r = evaluate(node.right);
  switch (node.op) {
    case '+': return { a: add(l.a, r.a), b: add(l.b, r.b) };
    case '-': return { a: add(l.a, neg(r.a)), b: add(l.b, neg(r.b)) };
    case '*':
      if (l.a.n !== 0n && r.a.n !== 0n) fail('Nonlinear expressions require another verifier.');
      return { a: add(mul(l.a, r.b), mul(l.b, r.a)), b: mul(l.b, r.b) };
    case '/':
      // Reject any syntactic variable denominator, including x - x + 1:
      // cancellation must never silently erase an original domain restriction.
      if (containsVariable(node.right)) fail('Variable denominators require domain-aware verification.');
      return { a: div(l.a, r.b), b: div(l.b, r.b) };
    default: return fail('Unsupported operator.');
  }
}
function containsVariable(node: Node): boolean {
  if (node.type === 'variable') return true;
  if (node.type === 'negate') return containsVariable(node.child);
  if (node.type === 'binary') return containsVariable(node.left) || containsVariable(node.right);
  return false;
}

/** Parse untrusted structured input. A valid shape can still be mathematically unsupported. */
export function validateMathProblem(input: unknown): MathProblem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  try {
    if (p.kind === 'arithmetic' && typeof p.expression === 'string') {
      parse(p.expression, false);
      return { kind: 'arithmetic', expression: p.expression.trim() };
    }
    if (p.kind === 'linear-equation' && p.variable === 'x' && typeof p.left === 'string' && typeof p.right === 'string') {
      parse(p.left, true); parse(p.right, true);
      return { kind: 'linear-equation', left: p.left.trim(), right: p.right.trim(), variable: 'x' };
    }
  } catch { return null; }
  return null;
}

/** Render this exact prompt in place of model prose when displaying a verified problem. */
export function mathProblemPrompt(problem: MathProblem): string {
  return problem.kind === 'arithmetic'
    ? `Calculate: ${problem.expression}`
    : `Solve for x: ${problem.left} = ${problem.right}`;
}

/** Use identically for the author key before display and the learner answer at grading. */
export function verifyMathAnswer(problem: MathProblem, answer: string): MathVerification {
  const valid = validateMathProblem(problem);
  const prompt = valid ? mathProblemPrompt(valid) : '';
  if (!valid) return { status: 'unsupported', reason: 'Invalid or out-of-bounds structured math problem.', prompt };
  let expected: Rational;
  try {
    if (valid.kind === 'arithmetic') expected = evaluate(parse(valid.expression, false)).b;
    else {
      const l = evaluate(parse(valid.left, true)), r = evaluate(parse(valid.right, true));
      const coefficient = add(l.a, neg(r.a));
      const constant = add(r.b, neg(l.b));
      if (coefficient.n === 0n) fail(constant.n === 0n
        ? 'The equation has infinitely many solutions; a single numeric answer cannot verify it.'
        : 'The equation has no solution; a single numeric answer cannot verify it.');
      expected = div(constant, coefficient);
    }
  } catch (error) {
    return { status: 'unsupported', reason: error instanceof Error ? error.message : 'Exact verification failed.', prompt };
  }
  const expectedAnswer = format(expected);
  let actual: Rational;
  try {
    if (typeof answer !== 'string') fail('Answer must be a numeric expression string.');
    actual = evaluate(parse(answer, false)).b;
  } catch {
    // An unparseable answer is not evidence that the learner is mathematically wrong.
    return { status: 'unsupported', reason: 'Answer needs review: enter a supported numeric expression.', prompt, expectedAnswer };
  }
  const actualAnswer = format(actual);
  const equal = expected.n === actual.n && expected.d === actual.d;
  return { status: equal ? 'verified' : 'rejected', reason: equal
    ? 'Answer matches an independently computed exact rational result.'
    : 'Answer differs from the independently computed exact rational result.', prompt, expectedAnswer, actualAnswer };
}
