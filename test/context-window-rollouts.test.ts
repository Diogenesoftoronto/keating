import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeachingPolicyTurn } from "../packages/learner-contracts/src/judgement/teaching-policy-types.js";
const emptyTurn = (): TeachingPolicyTurn => ({ learnerMessage: "", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "none", improvementRuns: null, domain: "general" });
import { importRolloutCases } from "../scripts/context-window/rollouts.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function runDir(mode = "execute") {
  const dir = await mkdtemp(join(tmpdir(), "keating-rollout-import-")); directories.push(dir);
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ mode })); return dir;
}
function receipt(text: string, overrides: Record<string, unknown> = {}) {
  return { caseId: "direct-explanation", family: "responsive-help", split: "holdout", arm: "private-arm-identity", model: { id: "private-actor-model" },
    generation: { reply: { text, toolCalls: [] }, error: null, finishReason: "stop" },
    postJudge: { request: { state: { turn: { ...emptyTurn(), learnerMessage: "Explain the example directly." } } }, outcome: { leakedVerdict: "private-prior-verdict" } },
    assessment: { checks: [{ id: "nonempty_reply", source: "jev", status: "fail" }] }, ...overrides };
}
async function put(dir: string, n: number, value: unknown) { await writeFile(join(dir, `trial-${n}.json`), JSON.stringify(value)); }

describe("saved rollout deterministic verification", () => {
  test("recomputes labels from actual replies and never copies existing judge verdicts or actor metadata", async () => {
    const dir = await runDir();
    await put(dir, 0, receipt("A clear explanation."));
    await put(dir, 1, receipt(""));
    const imported = await importRolloutCases(dir), fixture = imported.cases.find(x => x.id.endsWith("nonempty_reply"))!;
    expect(imported.excluded).toEqual([]);
    expect(Object.values(fixture.expected).sort()).toEqual([false, true]);
    expect(fixture.labelSource).toBe("deterministic-gate");
    expect(fixture.split).toBe("holdout");
    const request = JSON.stringify(fixture.request);
    expect(request).not.toContain("private-arm-identity"); expect(request).not.toContain("private-actor-model"); expect(request).not.toContain("private-prior-verdict");
    expect(request).not.toContain('"expected"');
    expect(fixture.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await importRolloutCases(dir)).cases).toEqual(imported.cases);
  });
  test("rejects smoke, provider failure and missing observed turns instead of inventing examples", async () => {
    const dir = await runDir();
    await put(dir, 0, receipt("", { generation: { reply: { text: "", toolCalls: [] }, error: "timeout", finishReason: "error" } }));
    await put(dir, 1, receipt("Answer", { postJudge: null }));
    await put(dir, 2, receipt("Answer", { generation: { reply: { text: "Answer", toolCalls: [] }, error: null, finishReason: "length" } }));
    const result = await importRolloutCases(dir);
    expect(result.cases).toEqual([]);
    expect(result.excluded.map(x => x.reason)).toEqual(["generation_failed_or_incomplete", "recorded_turn_unavailable", "generation_failed_or_incomplete"]);
    const smoke = await runDir("smoke"); await put(smoke, 0, receipt("Offline canned response"));
    expect((await importRolloutCases(smoke)).excluded[0]?.reason).toBe("not_a_live_generation_run");
  });
  test("malformed UI yields a grammar failure without converting unknown structural gates into passes", async () => {
    const dir = await runDir();
    await put(dir, 0, receipt("```keating-ui\n{broken json\n```"));
    const result = await importRolloutCases(dir);
    expect(Object.values(result.cases.find(x => x.id.endsWith("openui_valid"))!.expected)).toEqual([true]);
    expect(result.cases.find(x => x.id.endsWith("one_activity"))).toBeUndefined();
    expect(result.cases.find(x => x.id.endsWith("stop_after_checkpoint"))).toBeUndefined();
  });
  test("tool gates use recorded available tools and pending submissions, and different turns never share candidates", async () => {
    const dir = await runDir();
    const generation = { reply: { text: "", toolCalls: [{ name: "grade_quiz", arguments: { result_id: "r1", grades: [{ question_id: "q1", correct: true }] } }] }, error: null, finishReason: "tool_calls" };
    await put(dir, 0, receipt("", { generation }));
    await put(dir, 1, receipt("", { generation, postJudge: { request: { state: { turn: { ...emptyTurn(), learnerMessage: "Explain the example directly.", availableTools: ["grade_quiz"], pendingSubmissions: [{ kind: "quiz", id: "r1", questionIds: ["q1"] }] } } } } }));
    const rows = (await importRolloutCases(dir)).cases.filter(x => x.id.endsWith("grading_requires_submission"));
    expect(rows).toHaveLength(2);
    expect(rows.flatMap(x => Object.values(x.expected)).sort()).toEqual([false, true]);
    expect(rows.every(x => Object.keys(x.expected).length === 1)).toBe(true);
  });
  test("supports a parent containing run directories and falls back only to a captured pre-judge turn", async () => {
    const parent = await mkdtemp(join(tmpdir(), "keating-rollout-parent-")); directories.push(parent);
    const run = join(parent, "run"); await mkdir(run); await writeFile(join(run, "manifest.json"), JSON.stringify({ mode: "execute" }));
    await put(run, 0, receipt("Explanation", { postJudge: null, preJudge: { request: { state: { turn: emptyTurn() } } } }));
    expect((await importRolloutCases(parent)).cases).toHaveLength(1);
  });
});
