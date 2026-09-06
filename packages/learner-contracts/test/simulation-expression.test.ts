import { describe, expect, test } from "bun:test";
import {
  evaluateSimulationExpression,
  isValidSimulationExpression,
  parseSimulationExpression,
} from "../src/index.js";

const PARAMS = ["a", "b", "base-rate"];

function run(source: string, values: Record<string, number>): number | undefined {
  const parsed = parseSimulationExpression(source, Object.keys(values));
  if (!parsed.ok) throw new Error(`expected a parse: ${JSON.stringify(parsed.error)}`);
  return evaluateSimulationExpression(parsed.node, values);
}

describe("simulation expressions", () => {
  test("evaluates arithmetic with correct precedence and associativity", () => {
    expect(run("1 + 2 * 3", {})).toBe(7);
    expect(run("(1 + 2) * 3", {})).toBe(9);
    expect(run("10 - 3 - 2", {})).toBe(5);
    expect(run("2 ^ 3 ^ 2", {})).toBe(512);
    expect(run("-a + 4", { a: 1 })).toBe(3);
    expect(run("a % b", { a: 7, b: 4 })).toBe(3);
  });

  test("resolves declared parameters, including hyphenated ids", () => {
    expect(run("base-rate * 2", { "base-rate": 21 })).toBe(42);
  });

  test("computes the worked base-rate case", () => {
    const expr = "100 * (prevalence/100000 * sensitivity/100) / (prevalence/100000 * sensitivity/100 + (1 - prevalence/100000) * (1 - specificity/100))";
    const ppv = run(expr, { prevalence: 10, sensitivity: 99, specificity: 99 });
    expect(ppv).toBeCloseTo(0.98, 2);
    // One decimal place of specificity is worth roughly a 9x swing.
    const better = run(expr, { prevalence: 10, sensitivity: 99, specificity: 99.9 });
    expect(better).toBeCloseTo(9.0, 1);
  });

  test("rejects every identifier the node did not declare", () => {
    for (const source of ["globalThis", "window.x", "alert(1)", "a + secret", "constructor"]) {
      expect(isValidSimulationExpression(source, PARAMS)).toBe(false);
    }
  });

  test("rejects calls, assignment, and property access outright", () => {
    for (const source of ["a(1)", "a = 2", "a.b", "a[0]", "a && b", "a ? b : 1", "`${a}`"]) {
      expect(isValidSimulationExpression(source, PARAMS)).toBe(false);
    }
  });

  test("is total: undecidable arithmetic yields no value instead of throwing", () => {
    expect(run("1 / 0", {})).toBeUndefined();
    expect(run("a % 0", { a: 5 })).toBeUndefined();
    expect(run("(0 - 8) ^ 0.5", {})).toBeUndefined();
    expect(run("10 ^ 100000", {})).toBeUndefined();
    expect(run("10 ^ 400 * 10 ^ 400", {})).toBeUndefined();
  });

  test("treats a missing or non-finite parameter value as no value", () => {
    const parsed = parseSimulationExpression("a + 1", ["a"]);
    if (!parsed.ok) throw new Error("expected a parse");
    expect(evaluateSimulationExpression(parsed.node, {})).toBeUndefined();
    expect(evaluateSimulationExpression(parsed.node, { a: Number.NaN })).toBeUndefined();
    expect(evaluateSimulationExpression(parsed.node, { a: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  test("rejects malformed input rather than guessing at it", () => {
    for (const source of ["", "1 +", "(1 + 2", "1 2", ")", "* 3"]) {
      expect(isValidSimulationExpression(source, PARAMS)).toBe(false);
    }
  });

  test("bounds source length and nesting depth", () => {
    expect(isValidSimulationExpression(`${"(".repeat(400)}1${")".repeat(400)}`, PARAMS)).toBe(false);
    expect(parseSimulationExpression("1".repeat(600), PARAMS)).toMatchObject({ ok: false, error: { kind: "too-long" } });
  });

  test("reports which declared parameters an expression actually uses", () => {
    const parsed = parseSimulationExpression("a * 2 + a", PARAMS);
    expect(parsed.ok && parsed.parameters).toEqual(["a"]);
  });
});
