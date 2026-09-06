import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getLearningCheck, listLearningChecks, startLearningCheck, submitLearningCheck,
  type LearningCheckView,
} from "../src/core/learning-checks.js";
import { parseLearningCheckRecord, type LearningCheckStage } from "../shared/evolution/learning-checks.js";

const directories: string[] = [];
const START = Date.parse("2026-09-06T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
async function setup(topic: "fractions" | "loop-bounds" = "fractions") {
  const cwd = await mkdtemp(join(tmpdir(), "keating-learning-checks-"));
  directories.push(cwd);
  let time = START;
  const clock = { now: () => new Date(time) };
  const check = await startLearningCheck(cwd, { topic, revisionId: "rev-experiment-1", learnerId: "learner-1" }, clock);
  return { cwd, clock, check, setTime: (next: number) => { time = next; } };
}
function stage(view: LearningCheckView, key: LearningCheckStage) { return view.stages.find((item) => item.stage === key)!; }
function answers(view: LearningCheckView, key: LearningCheckStage, values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((value, index) => [`${view.topic}-${key}-${index + 1}`, value]));
}
afterEach(async () => { await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true }))); });

describe("durable observed learning checks", () => {
  test("new checks preserve missingness and reveal only current prompts without answer keys", async () => {
    const { cwd, clock, check } = await setup();
    expect(check.revisionId).toBe("rev-experiment-1");
    expect(check.learnerId).toBe("learner-1");
    expect(check.evidenceKind).toBe("observed-learner-assessment");
    expect(stage(check, "precheck").status).toBe("ready");
    expect(stage(check, "precheck").items).toHaveLength(3);
    for (const key of ["immediate", "delayed", "transfer"] as const) {
      expect(stage(check, key)).toMatchObject({ status: "pending-prerequisite", result: null, items: [] });
    }
    expect(check.measurements).toMatchObject({ immediateGain: null, retentionScore: null, transferScore: null, establishesEffectiveness: false });
    expect(JSON.stringify(check)).not.toMatch(/"expected"|"answerKey"|"correctAnswer"/);
    const stored = await readFile(join(cwd, ".keating", "state", "learning-checks", `${check.id}.json`), "utf8");
    expect(stored).not.toMatch(/"expected"|"answerKey"|"prompt"/);
    expect(await getLearningCheck(cwd, check.id, clock)).toEqual(check);
    expect(await listLearningChecks(cwd, clock)).toEqual([check]);
  });

  test("grades correct and incorrect answers independently and schedules checks from post-assessment", async () => {
    const { cwd, clock, check, setTime } = await setup();
    const pre = await submitLearningCheck(cwd, check.id, { stage: "precheck", answers: answers(check, "precheck", ["1/8", "0", "0"]), assistance: "none" }, clock);
    expect(stage(pre, "precheck").result?.score).toBe(0);
    setTime(START + 30 * 60 * 1000);
    const post = await submitLearningCheck(cwd, check.id, { stage: "immediate", answers: answers(check, "immediate", ["2/8", "12", ".625"]), assistance: "none" }, clock);
    expect(stage(post, "immediate").result?.score).toBe(1);
    expect(post.measurements.immediateGain).toBe(1);
    expect(stage(post, "delayed").availableAt).toBe(new Date(START + 30 * 60 * 1000 + DAY).toISOString());
    expect(stage(post, "transfer").availableAt).toBe(new Date(START + 30 * 60 * 1000 + 7 * DAY).toISOString());
    expect(stage(post, "delayed")).toMatchObject({ status: "scheduled", result: null, items: [] });
  });

  test("rejects premature or out-of-order submissions and accepts the exact due instant", async () => {
    const { cwd, clock, check, setTime } = await setup();
    const immediate = { stage: "immediate" as const, answers: answers(check, "immediate", ["1/4", "12", "5/8"]), assistance: "none" as const };
    await expect(submitLearningCheck(cwd, check.id, immediate, clock)).rejects.toThrow("prerequisite");
    await submitLearningCheck(cwd, check.id, { stage: "precheck", answers: answers(check, "precheck", ["1/5", "12", "0.75"]), assistance: "none" }, clock);
    await submitLearningCheck(cwd, check.id, immediate, clock);
    const delayed = { stage: "delayed" as const, answers: answers(check, "delayed", ["1/6", "6", ".6"]), assistance: "none" as const };
    setTime(START + DAY - 1);
    await expect(submitLearningCheck(cwd, check.id, delayed, clock)).rejects.toThrow("not available until");
    expect(stage(await getLearningCheck(cwd, check.id, clock), "delayed").result).toBeNull();
    setTime(START + DAY);
    const completed = await submitLearningCheck(cwd, check.id, delayed, clock);
    expect(completed.measurements.retentionScore).toBe(1);
    expect(completed.measurements.transferScore).toBeNull();
  });

  test("a missed one-day check remains missing while the seven-day transfer check can be answered", async () => {
    const { cwd, clock, check, setTime } = await setup();
    await submitLearningCheck(cwd, check.id, { stage: "precheck", answers: answers(check, "precheck", ["1/5", "12", "3/4"]), assistance: "none" }, clock);
    await submitLearningCheck(cwd, check.id, { stage: "immediate", answers: answers(check, "immediate", ["1/4", "12", "5/8"]), assistance: "none" }, clock);
    const transfer = { stage: "transfer" as const, answers: answers(check, "transfer", ["1/8", "21", "3/8"]), assistance: "none" as const };
    setTime(START + 7 * DAY - 1);
    await expect(submitLearningCheck(cwd, check.id, transfer, clock)).rejects.toThrow("not available until");
    setTime(START + 7 * DAY);
    const completed = await submitLearningCheck(cwd, check.id, transfer, clock);
    expect(completed.measurements.retentionScore).toBeNull();
    expect(completed.measurements.transferScore).toBe(1);
    expect(stage(completed, "delayed").status).toBe("ready");
  });

  test("assisted or unknown-assistance answers are recorded without claiming unaided gains", async () => {
    const { cwd, clock, check, setTime } = await setup();
    await submitLearningCheck(cwd, check.id, { stage: "precheck", answers: answers(check, "precheck", ["0", "0", "0"]), assistance: "none" }, clock);
    const post = await submitLearningCheck(cwd, check.id, { stage: "immediate", answers: answers(check, "immediate", ["1/4", "12", "5/8"]), assistance: "assisted" }, clock);
    expect(stage(post, "immediate").result?.score).toBe(1);
    expect(post.measurements.immediateGain).toBeNull();
    setTime(START + DAY);
    const delayed = await submitLearningCheck(cwd, check.id, { stage: "delayed", answers: answers(check, "delayed", ["1/6", "6", ".6"]), assistance: "unknown" }, clock);
    expect(stage(delayed, "delayed").result?.score).toBe(1);
    expect(delayed.measurements.retentionScore).toBeNull();
  });

  test("submissions are durable, idempotent, and immutable under concurrent replay or conflicts", async () => {
    const { cwd, clock, check, setTime } = await setup();
    const submission = { stage: "precheck" as const, answers: answers(check, "precheck", ["1/5", "12", "3/4"]), assistance: "none" as const };
    const [first, replay] = await Promise.all([
      submitLearningCheck(cwd, check.id, submission, clock), submitLearningCheck(cwd, check.id, submission, clock),
    ]);
    expect(first).toEqual(replay);
    setTime(START + 1000);
    expect(stage(await submitLearningCheck(cwd, check.id, submission, clock), "precheck").result).toEqual(stage(first, "precheck").result);
    await expect(submitLearningCheck(cwd, check.id, { ...submission, assistance: "assisted" }, clock)).rejects.toThrow("conflict");
    await expect(submitLearningCheck(cwd, check.id, { ...submission, answers: answers(check, "precheck", ["0", "0", "0"]) }, clock)).rejects.toThrow("conflict");
    const saved = await getLearningCheck(cwd, check.id, clock);
    expect(saved.revisionId).toBe("rev-experiment-1");
    expect(stage(saved, "precheck").result?.revisionId).toBe("rev-experiment-1");
    const files = await readdir(join(cwd, ".keating", "state", "learning-checks"));
    expect(files).toEqual([`${check.id}.json`]);
  });

  test("loop-bound output checks grade all four stages with independent numeric answers", async () => {
    const { cwd, clock, check, setTime } = await setup("loop-bounds");
    for (const [key, values, elapsed] of [
      ["precheck", ["6", "4", "3"], 0], ["immediate", ["10", "4", "4"], 0],
      ["delayed", ["10", "5", "5"], DAY], ["transfer", ["15", "5", "7"], 7 * DAY],
    ] as const) {
      setTime(START + elapsed);
      const result = await submitLearningCheck(cwd, check.id, { stage: key, answers: answers(check, key, [...values]), assistance: "none" }, clock);
      expect(stage(result, key).result?.score).toBe(1);
    }
  });

  test("rejects unsafe IDs, incomplete answers, and persisted grade/revision tampering", async () => {
    const { cwd, clock, check } = await setup();
    await expect(getLearningCheck(cwd, "../../learner", clock)).rejects.toThrow("Invalid learning-check id");
    await expect(startLearningCheck(cwd, { topic: "fractions", revisionId: "../candidate" }, clock)).rejects.toThrow("revision id");
    await expect(submitLearningCheck(cwd, check.id, { stage: "precheck", answers: {}, assistance: "none" }, clock)).rejects.toThrow("every stage item");
    await submitLearningCheck(cwd, check.id, { stage: "precheck", answers: answers(check, "precheck", ["1/5", "12", "3/4"]), assistance: "none" }, clock);
    const stored = JSON.parse(await readFile(join(cwd, ".keating", "state", "learning-checks", `${check.id}.json`), "utf8"));
    expect(() => parseLearningCheckRecord({ ...stored, revisionId: "rev-changed" })).toThrow("recorded revision");
    stored.responses.precheck.score = 0;
    expect(() => parseLearningCheckRecord(stored)).toThrow("assessment grade");
  });
});
