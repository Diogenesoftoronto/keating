import { describe, expect, it } from "bun:test";
import {
  buildExamCompletion,
  examTiming,
  moveExamClock,
  startExamClock,
} from "./attempt";
import { EXAM_FIXTURE_NODE as node } from "./fixtures";

describe("exam timing and final submission", () => {
  it("records exact repeated question visits and excludes review time from questions", () => {
    let clock = startExamClock(1_000, 60, "a");
    clock = moveExamClock(clock, "b", 5_238);
    clock = moveExamClock(clock, "a", 8_401);
    clock = moveExamClock(clock, undefined, 9_702);
    expect(examTiming(clock, 10_013)).toEqual({
      totalMs: 9_013,
      perQuestionMs: { a: 5_539, b: 3_163 },
    });
  });
  it("stops exact timing at the deadline even when the browser resumes late", () => {
    const clock = startExamClock(1_000, 2, "a");
    expect(examTiming(clock, 80_000)).toEqual({
      totalMs: 2_000,
      perQuestionMs: { a: 2_000 },
    });
  });
  it("keeps a persisted clock's original deadline and elapsed time", () => {
    const clock = JSON.parse(
      JSON.stringify(moveExamClock(startExamClock(1_000, 60, "a"), "b", 5_238)),
    );
    expect(clock.deadlineAt).toBe(61_000);
    expect(examTiming(clock, 9_999)).toEqual({
      totalMs: 8_999,
      perQuestionMs: { a: 4_238, b: 4_761 },
    });
  });
  it("holds open answers for teacher grading and records an overall timeout", () => {
    const completion = buildExamCompletion({
      node,
      answers: { "exam-ttl": node.questions[0]!.correctAnswer!, "exam-explain": "My own explanation" },
      flagged: ["exam-explain"],
      ready: { "exam-ttl": true, "exam-explain": true },
      timing: { totalMs: 30_123, perQuestionMs: { "exam-ttl": 4_238, "exam-explain": 20_561 } },
      timedOut: true,
    });
    expect(completion.score).toBe(1);
    expect(completion.pendingGradeQuestionIds).toEqual(["exam-explain"]);
    expect(completion.skippedQuestionIds).toEqual(node.questions.slice(2).map((question) => question.id));
    expect(completion.timedOutQuestionIds).toEqual(node.questions.slice(2).map((question) => question.id));
    expect(completion.examTimedOut).toBe(true);
    expect(completion.timing.totalMs).toBe(30_123);
    expect(completion.answers.map((answer) => answer.questionId)).toEqual([
      "exam-ttl",
      "exam-explain",
    ]);
  });
});
