import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createParser } from "@openuidev/react-lang";
import { compileOpenUISourceToSharedDocument, validateResponseCapture, validateUiDocument, type UiTaskNode } from "@keating/learner-contracts";
import { ResponseCapture, remainingSeconds, recordingMime } from "../components/ResponseCapture";
import { keatingOpenUILibrary } from "../keating/openui/library";
import { taskToCourseAssignment, courseAssignmentToTask } from "../courses/task-assignments";
const source = (kind: string, seconds = "20") => `root = LearningSurface([attempt], "Practice", "Replay and reflect", "resumable")\nattempt = ${kind}("attempt", "Recall", "Show what you know", ["Reflect on uncertainty"], ${seconds}, "resumable")`;
describe("recorded responses", () => {
  for (const [component, kind] of [["AudioResponse", "audio"], ["VideoResponse", "video"]] as const) {
    test(`${component} parses in both grammars and survives course saving`, () => {
      const parsed = createParser(keatingOpenUILibrary.toJSONSchema()).parse(source(component));
      expect(parsed.meta.errors).toEqual([]);
      expect(parsed.meta.unresolved).toEqual([]);
      const doc = compileOpenUISourceToSharedDocument(source(component), { documentId: "recorded" });
      expect(validateUiDocument(doc)).toBe(true);
      const task = doc.nodes[0] as UiTaskNode;
      expect(task.submission?.capture).toEqual({ kind, timeLimitSeconds: 20 });
      expect(task.criteria).toEqual(["Reflect on uncertainty"]);
      const assignment = taskToCourseAssignment(task, "recorded-assignment");
      const restored = courseAssignmentToTask({ ...assignment, updatedAt: new Date().toISOString(), updatedBy: "test" });
      expect(restored.submission?.capture).toEqual(task.submission?.capture);
    });
  }
  test("rejects invalid limits and unknown capture capabilities", () => {
    for (const seconds of [0, -1, 181, 1.5, NaN, Infinity]) expect(validateResponseCapture({ kind: "audio", timeLimitSeconds: seconds })).toBe(false);
    expect(validateResponseCapture({ kind: "video" })).toBe(true);
    expect(validateResponseCapture({ kind: "video", autoGrade: true })).toBe(false);
    expect(validateResponseCapture({ kind: "screen" })).toBe(false);
    for (const seconds of ["0", "181", "1.5"]) expect(() => compileOpenUISourceToSharedDocument(source("AudioResponse", seconds), { documentId: "bad" })).toThrow();
    const doc = compileOpenUISourceToSharedDocument(source("AudioResponse"), { documentId: "bad-format" });
    (doc.nodes[0] as UiTaskNode).submission!.format = "link";
    expect(validateUiDocument(doc)).toBe(false);
  });
  test("renders without hardware access and offers optional timing and microphone", () => {
    const html = renderToStaticMarkup(<ResponseCapture capture={{ kind: "video", timeLimitSeconds: 20 }} onAttach={() => { throw new Error("Must not attach on render"); }} />);
    expect(html).toContain("Start recording");
    expect(html).toContain("Include microphone");
    expect(html).toContain("Turn off to practise at your own pace");
    expect(html).not.toContain("<video");
    expect(html).toContain("seconds remaining");
    const disabled = renderToStaticMarkup(<ResponseCapture capture={{ kind: "audio" }} disabled onAttach={() => {}} />);
    expect(disabled).toContain("disabled");
    expect(disabled).not.toContain("Include microphone");
  });
  test("countdown respects elapsed time and cannot go negative", () => {
    expect(remainingSeconds(19999, 20)).toBe(1);
    expect(remainingSeconds(20000, 20)).toBe(0);
    expect(remainingSeconds(24000, 20)).toBe(0);
    expect(recordingMime("audio", mime => mime === "audio/mp4")).toBe("audio/mp4");
    expect(recordingMime("video", () => false)).toBeUndefined();
  });
});
