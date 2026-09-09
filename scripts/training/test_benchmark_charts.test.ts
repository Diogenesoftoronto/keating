import { expect, test } from "bun:test";
import { commonCaseIds, comparisonPoints, modelProvider, paretoFrontier, summarizeRows, validateChartData } from "../../web/public/reports/learning-to-teach/benchmark-charts.js";

test("provider colors identify the model developer without relabeling the serving transport", () => {
  const qwen = modelProvider({id:'qwen3.6-35b',provider:'neuralwatt'});
  const newer = modelProvider({id:'Qwen/Qwen3.8-27B',provider:'tinker-bridge'});
  expect(qwen.name).toBe('Qwen'); expect(newer.color).toBe(qwen.color);
  expect(newer.transport).toBe('tinker-bridge');
  expect(modelProvider({id:'gemma-4-31b',provider:'neuralwatt'}).name).toBe('Google');
  expect(modelProvider({id:'unknown'}).name).toBe('Other');
});

const row = (case_id: string, quality: number | null, cost_usd: number | null, extra = {}) => ({
  case_id, category: "diagnosis", quality, cost_usd, output_tokens: 100, latency_seconds: 2,
  contract_passed: true, ...extra,
});

test("unknown measurements remain unknown and zero remains measured", () => {
  const summary = summarizeRows([
    row("a", null, 0, { output_tokens: 0, latency_seconds: null, contract_passed: null }),
    row("b", 101, null, { output_tokens: 1.5, latency_seconds: Infinity, contract_passed: false }),
    row("c", -1, NaN, { output_tokens: -1, latency_seconds: true, contract_passed: "true" }),
  ], 4);
  expect(summary.quality).toEqual({ value: null, count: 0, total: 4 });
  expect(summary.cost_usd).toEqual({ value: 0, count: 1, total: 4 });
  expect(summary.output_tokens).toEqual({ value: 0, count: 1, total: 4 });
  expect(summary.latency_seconds).toEqual({ value: null, count: 0, total: 4 });
  expect(summary.contracts).toEqual({ value: 0, count: 1, total: 4 });
});

test("Pareto averages exactly the same complete cases, preventing coverage bias", () => {
  const models = [
    { id: "a", label: "First", rows: [row("shared", 20, 2), row("only-a", 100, 0)] },
    { id: "b", label: "Second", rows: [row("shared", 40, 1), row("only-b", 0, 20)] },
  ];
  const result = comparisonPoints(models, "cost_usd");
  expect(result.case_ids).toEqual(["shared"]);
  expect(result.points.map(({ x, y }) => [x, y])).toEqual([[2, 20], [1, 40]]);
  expect(result.frontier.map(({ id }) => id)).toEqual(["b"]);
  expect(summarizeRows(models[0].rows).quality.value).toBe(60);
});

test("cohorts depend on metric availability and consistent categories", () => {
  const models = [
    { id: "a", rows: [row("a", 30, 1), row("b", 40, 2, { latency_seconds: null }), row("c", 50, 3, { category: "transfer" })] },
    { id: "b", rows: [row("a", 30, null), row("b", 40, 2), row("c", 50, 3)] },
  ];
  expect(commonCaseIds(models, ["quality", "cost_usd"])).toEqual(["b"]);
  expect(commonCaseIds(models, ["quality", "latency_seconds"])).toEqual(["a"]);
  expect(commonCaseIds(models, ["quality"], "transfer")).toEqual([]);
  expect(commonCaseIds(models, ["quality"], "diagnosis")).toEqual(["a", "b"]);
});

test("strict dominance preserves equal ties and genuine cost-quality tradeoffs", () => {
  const points = [
    { id: "cheap", x: 1, y: 50 }, { id: "tie", x: 1, y: 50 },
    { id: "quality", x: 2, y: 90 }, { id: "dominated", x: 2, y: 60 },
    { id: "same-cost-worse", x: 1, y: 40 }, { id: "same-quality-costlier", x: 3, y: 90 },
    { id: "missing", x: null, y: 100 }, { id: "invalid", x: 0, y: 101 },
  ];
  expect(paretoFrontier(points).map(({ id }) => id)).toEqual(["cheap", "tie", "quality"]);
  expect(points[0].id).toBe("cheap");
});

test("empty coverage does not produce zero-quality or zero-cost points", () => {
  expect(comparisonPoints([{ id: "a", rows: [row("a", null, 0)] }, { id: "b", rows: [] }], "cost_usd"))
    .toEqual({ case_ids: [], points: [], frontier: [] });
  expect(commonCaseIds([], ["quality"])).toEqual([]);
  expect(() => comparisonPoints([], "quality")).toThrow("Unknown comparison metric");
});

test("case order does not change comparison values or mutate source rows", () => {
  const rows = [row("z", 20, 2), row("a", 80, 4)];
  const forward = comparisonPoints([{ id: "a", rows }, { id: "b", rows: [...rows].reverse() }], "cost_usd");
  expect(forward.case_ids).toEqual(["a", "z"]);
  expect(forward.points.map(({ x, y }) => [x, y])).toEqual([[3, 50], [3, 50]]);
  expect(rows.map(({ case_id }) => case_id)).toEqual(["z", "a"]);
});

test("ambiguous IDs or malformed display labels fail before rendering", () => {
  expect(() => validateChartData({ models: [{ id: "a", rows: [] }, { id: "a", rows: [] }] })).toThrow();
  expect(() => validateChartData({ models: [{ id: "a", rows: [row("same", 1, 1), row("same", 2, 2)] }] })).toThrow();
  expect(() => validateChartData({ models: [{ id: "a", label: {}, rows: [] }] })).toThrow();
  expect(() => validateChartData({ models: [null] })).toThrow();
  expect(validateChartData({ models: [] })).toEqual({ models: [] });
});

test("mechanical Pareto requires explicit selection and never fills semantic scores", () => {
  const models = [
    { id: "a", rows: [row("one", null, 1, { contract_passed: true }), row("two", 90, 3, { contract_passed: false })] },
    { id: "b", rows: [row("one", 80, 2, { contract_passed: false }), row("two", 70, 4, { contract_passed: true })] },
  ];
  const semantic = comparisonPoints(models, "cost_usd");
  expect(semantic.case_ids).toEqual(["two"]);
  expect(semantic.points.map(({ y }) => y)).toEqual([90, 70]);
  const mechanical = comparisonPoints(models, "cost_usd", "all", "contracts");
  expect(mechanical.case_ids).toEqual(["one", "two"]);
  expect(mechanical.points.map(({ x, y }) => [x, y])).toEqual([[2, 50], [3, 50]]);
  expect(models[0].rows[0].quality).toBeNull();
  expect(models[0].rows[1].quality).toBe(90);
});

test("unknown and nonboolean contracts stay outside the mechanical cohort", () => {
  const models = [
    { id: "a", rows: [row("unknown", 100, 1, { contract_passed: null }), row("fake", 100, 1, { contract_passed: "false" }), row("failed", 100, 1, { contract_passed: false })] },
    { id: "b", rows: [row("unknown", 100, 1), row("fake", 100, 1), row("failed", 100, 1, { contract_passed: false })] },
  ];
  const result = comparisonPoints(models, "latency_seconds", "all", "contracts");
  expect(result.case_ids).toEqual(["failed"]);
  expect(result.points.map(({ y }) => y)).toEqual([0, 0]);
  expect(() => comparisonPoints(models, "cost_usd", "all", "implicit_fallback")).toThrow("Unknown vertical metric");
});
