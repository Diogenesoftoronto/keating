import { describe, expect, test } from 'bun:test';
import { mathProblemPrompt, validateMathProblem, verifyMathAnswer, type MathProblem } from '../src/math-verification.js';

const arithmetic = (expression: string): MathProblem => ({ kind: 'arithmetic', expression });
const equation = (left: string, right: string): MathProblem => ({ kind: 'linear-equation', variable: 'x', left, right });

describe('independent exact math verification', () => {
  test('computes author keys instead of trusting them', () => {
    const problem = equation('2*x + 3', '11');
    expect(verifyMathAnswer(problem, '5')).toMatchObject({ status: 'rejected', expectedAnswer: '4' });
    for (const answer of ['4', '4.0', '8/2', '(-8)/(-2)']) {
      expect(verifyMathAnswer(problem, answer).status).toBe('verified');
    }
  });
  test('uses exact decimal and rational equivalence without floating point tolerance', () => {
    expect(verifyMathAnswer(arithmetic('0.1 + 0.2'), '3/10').status).toBe('verified');
    expect(verifyMathAnswer(arithmetic('1/3 + 1/6'), '.500')).toMatchObject({ status: 'verified', expectedAnswer: '1/2' });
    expect(verifyMathAnswer(arithmetic('1/3'), '0.3333333333333333').status).toBe('rejected');
    expect(verifyMathAnswer(arithmetic('9007199254740993 + 1'), '9007199254740994').status).toBe('verified');
  });
  test('supports precedence, unary signs, and both sides of linear equations', () => {
    expect(verifyMathAnswer(arithmetic('-2 * (3 + 4) / +2'), '-7').status).toBe('verified');
    expect(verifyMathAnswer(equation('(x - 1)/3', '2*x + 1'), '-4/5').status).toBe('verified');
    expect(verifyMathAnswer(equation('x + x + x', '0'), '-0.0')).toMatchObject({ status: 'verified', expectedAnswer: '0' });
  });
  test('rejects nonlinear and variable-denominator problems for separate review', () => {
    expect(verifyMathAnswer(equation('x*x', '4'), '2')).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('Nonlinear') });
    for (const left of ['x/x', '1/(x-x)', '1/(x-x+1)']) {
      expect(verifyMathAnswer(equation(left, '1'), '1')).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('denominators') });
    }
  });
  test('does not confuse undefined or degenerate math with an incorrect learner answer', () => {
    expect(verifyMathAnswer(arithmetic('0/0'), '0')).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('zero') });
    expect(verifyMathAnswer(equation('x + 1', 'x + 1'), '0')).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('infinitely many') });
    expect(verifyMathAnswer(equation('x + 1', 'x + 2'), '0')).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('no solution') });
    expect(verifyMathAnswer(arithmetic('1+1'), 'two').status).toBe('unsupported');
    expect(verifyMathAnswer(arithmetic('1+1'), '1/0').status).toBe('unsupported');
  });
  test('creates the displayed prompt from the same structured problem', () => {
    const problem = validateMathProblem({ kind: 'linear-equation', variable: 'x', left: ' 2*x+3 ', right: ' 11 ', prompt: 'Solve another problem' });
    expect(problem).toEqual(equation('2*x+3', '11'));
    expect(mathProblemPrompt(problem!)).toBe('Solve for x: 2*x+3 = 11');
    expect(verifyMathAnswer(problem!, '4').prompt).toBe(mathProblemPrompt(problem!));
    expect(mathProblemPrompt(arithmetic('2+2'))).toBe('Calculate: 2+2');
  });
  test('refuses ambiguous syntax, unsupported functions, injection, and malformed shapes', () => {
    for (const expression of ['', ' ', '2x', '2(3)', '1e3', 'sqrt(4)', '1; globalThis.secret', '2**4', '(1+2', '1=1', 'Infinity']) {
      expect(validateMathProblem(arithmetic(expression))).toBeNull();
    }
    for (const input of [null, [], {}, { kind: 'arithmetic', expression: 2 }, { kind: 'linear-equation', variable: 'y', left: 'y', right: '2' }]) {
      expect(validateMathProblem(input)).toBeNull();
    }
  });
  test('bounds input length, literal size, nesting, and token count', () => {
    for (const expression of ['1'.repeat(65), ' '.repeat(512) + '1', '('.repeat(34) + '1' + ')'.repeat(34), Array(130).fill('1').join('+')]) {
      expect(validateMathProblem(arithmetic(expression))).toBeNull();
      expect(verifyMathAnswer(arithmetic(expression), '1').status).toBe('unsupported');
    }
  });
  test('all public results are JSON serializable', () => {
    const result = verifyMathAnswer(arithmetic('1/3'), '2/6');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
