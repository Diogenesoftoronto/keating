import { afterEach, expect, test } from "bun:test";
import { clearLearningDiagnostics, discardLearningDiagnosticAnchor, getLearningDiagnostics, recordLearningDiagnostic } from "../keating/learning-intelligence/diagnostics";
import { configureJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { learningSourceHash } from "@keating/learner-contracts";

afterEach(() => { configureJudgementDiagnostics({ enabled: false, details: false }); clearLearningDiagnostics(); });
const evidence = [{ sessionId: "source", messageId: "user-0-42", quote: "private words", start: 0, end: 13, sourceHash: learningSourceHash("private words") }];
test("extraction capture defaults off; details off never retain original quote text", () => {
  recordLearningDiagnostic({ kind: "extraction", status: "completed", sessionId: "source", reasons: [], evidence });
  expect(getLearningDiagnostics()).toEqual([]);
  configureJudgementDiagnostics({ enabled: true, details: false });
  recordLearningDiagnostic({ kind: "extraction", status: "completed", sessionId: "source", reasons: [], evidence });
  expect(getLearningDiagnostics()[0]?.evidence).toBeUndefined();
  expect(JSON.stringify(getLearningDiagnostics())).not.toContain("private words");
});
test("revoking details and capture erase exact passage history", async () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  recordLearningDiagnostic({ kind: "memory", status: "completed", sessionId: "source", reasons: [], evidence });
  expect(getLearningDiagnostics()[0]?.evidence?.[0]?.quote).toBe("private words");
  configureJudgementDiagnostics({ details: false });
  await Promise.resolve();
  expect(getLearningDiagnostics()).toEqual([]);
});
test("forecast diagnostics are bounded and retain interval evidence without invented probabilities", () => {
  configureJudgementDiagnostics({ enabled: true, details: false });
  for (let index = 0; index < 45; index++) recordLearningDiagnostic({ kind: "forecast", status: "completed", sessionId: "source", reasons: ["exponential baseline"], forecast: [{ target: "recall", p10: .2, median: .5, p90: .8, observedCount: 6 }] });
  expect(getLearningDiagnostics().length).toBe(40);
  expect(getLearningDiagnostics()[0]?.forecast?.[0]).toMatchObject({ p10: .2, median: .5, p90: .8, observedCount: 6 });
  expect(getLearningDiagnostics()[0]?.forecast?.[0]?.probability).toBeUndefined();
});
test("stale source clicks erase matching captured anchors and keep an explicit explanation", () => {
  configureJudgementDiagnostics({ enabled: true, details: true });
  recordLearningDiagnostic({ kind: "extraction", status: "completed", sessionId: "source", reasons: [], evidence });
  discardLearningDiagnosticAnchor(evidence[0]!);
  expect(getLearningDiagnostics()[0]?.evidence).toEqual([]);
  expect(getLearningDiagnostics()[0]?.reasons.join(" ")).toContain("changed or was removed");
  expect(JSON.stringify(getLearningDiagnostics())).not.toContain("private words");
});
