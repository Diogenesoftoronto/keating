import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const audit = "web/src/keating/openui/examples/november-audit.json";
function run(args: string[]) {
  return spawnSync(process.execPath, ["src/cli/main.ts", "openui-diagnostics", audit, ...args], { cwd: root, encoding: "utf8" });
}

test("offline CLI returns two of four MiniMax losses in the recorded November audit", () => {
  const result = run(["--model", "MiniMax-M2.7-highspeed", "--cue", "implicit-action", "--view", "draft-loss", "--limit", "2"]);
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ schemaVersion: 1, view: "draft-loss", matchingTurns: 4 });
  expect(report.turns).toHaveLength(2);
  expect(report.turns.map((row: { model: string }) => row.model)).toEqual(["MiniMax-M2.7-highspeed", "MiniMax-M2.7-highspeed"]);
});

test("CLI excludes rows outside the requested experiment and rejects invalid bounds", () => {
  const scoped = run(["--view=draft-loss", "--experiment", "different-experiment"]);
  expect(scoped.status).toBe(0);
  expect(JSON.parse(scoped.stdout)).toEqual({ schemaVersion: 1, view: "draft-loss", matchingTurns: 0, turns: [] });
  const invalid = run(["--view=render-loss", "--limit=1.5"]);
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain("Limit must be 1–50.");
});

test("CLI publishes the optional native-page evidence field and older stdin exports remain unknown", () => {
  const command = ["src/cli/main.ts", "openui-diagnostics"];
  const schema = spawnSync(process.execPath, [...command, "schema"], { cwd: root, encoding: "utf8" });
  expect(schema.status).toBe(0);
  const turnSchema = JSON.parse(schema.stdout).$defs.turn;
  expect(turnSchema.properties.nativePageRequested.type).toEqual(["boolean", "null"]);
  expect(turnSchema.required).not.toContain("nativePageRequested");
  const legacy = { schemaVersion: 1, conversationId: "archive", turnId: "turn-0", turnIndex: 0, model: "tutor",
    mode: "unknown", cue: { kind: "none", targets: [] }, reply: "released", attempted: false, compiled: [], selected: [], rendered: null, guidance: null };
  const result = spawnSync(process.execPath, [...command, "-"], { cwd: root, encoding: "utf8", input: JSON.stringify([legacy]) });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).overall.nativePageRequested).toEqual({ numerator: 0, denominator: 0, unknown: 1, rate: null });
});

test("a model can find both withheld Gemini Decision text-control turns without reading tutor prose", () => {
  const path = "web/src/keating/openui/examples/decision-models.json";
  const result = spawnSync(process.execPath, ["src/cli/main.ts", "openui-diagnostics", path,
    "--decision-model", "gemini-decision-1", "--view", "withheld", "--cue", "direct-text"], { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.matchingTurns).toBe(2);
  expect(report.turns.map((t: { model: string }) => t.model).sort()).toEqual(["MiniMax-M2.7-highspeed", "gemini-3.1-flash-lite"]);
  expect(report.turns.every((t: { decisionModel: string; gateIssues: string[] }) =>
    t.decisionModel === "gemini-decision-1" && t.gateIssues.includes("checkpoint_answer_leaked"))).toBe(true);
});

test("lists the saved irrigation replies that pressed a learner who declined a quiz", () => {
  const file = resolve(root, "docs/benchmarks/openui-audit-2026-11-18/final-review/assessment-opt-out/turns.json");
  const result = spawnSync(process.execPath, ["src/cli/main.ts", "openui-diagnostics", file, "--view", "assessment-opt-out"], { cwd: root, encoding: "utf8" });
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ view: "assessment-opt-out", matchingTurns: 2, observedOptOuts: 4, unknownOptOuts: 0, unobservedTurns: 0 });
  expect(report.turns.map((t: { mode: string }) => t.mode)).toEqual(["baseline", "baseline"]);
  const summary = spawnSync(process.execPath, ["src/cli/main.ts", "openui-diagnostics", file], { cwd: root, encoding: "utf8" });
  expect(JSON.parse(summary.stdout).assessmentOptOut.checkpointAfterOptOut).toMatchObject({ numerator: 2, denominator: 4, unknown: 0 });
});
