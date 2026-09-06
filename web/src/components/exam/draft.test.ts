import { afterEach, describe, expect, it } from "bun:test";
import {
  examDraftKey,
  readExamDraft,
  saveExamDraft,
  type ExamDraft,
} from "./draft";
import { startExamClock } from "./attempt";
import { EXAM_FIXTURE_NODE as node } from "./fixtures";

const previous = globalThis.localStorage;
afterEach(() =>
  Object.defineProperty(globalThis, "localStorage", {
    value: previous,
    writable: true,
    configurable: true,
  }),
);

describe("scoped resumable exam drafts", () => {
  it("retains the original deadline, partial response, visits and flags across reload", () => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
      },
    });
    const key = examDraftKey("conversation-a", node.id);
    const draft: ExamDraft = {
      version: 1,
      signature: JSON.stringify(node),
      clock: startExamClock(1_000, 60, "exam-explain"),
      index: 1,
      reviewing: false,
      responses: {
        "exam-explain": { questionId: "exam-explain", type: "text", answer: "A partial explanation" },
      },
      ready: { "exam-explain": true },
      flagged: ["exam-explain"],
    };
    expect(saveExamDraft(key, draft)).toBe(true);
    expect(readExamDraft(key, node)).toEqual(draft);
    expect(
      readExamDraft(examDraftKey("conversation-b", node.id), node),
    ).toBeUndefined();
    expect(
      readExamDraft(key, { ...node, title: "Changed assessment" }),
    ).toBeUndefined();
  });
  it("reports unavailable persistence without preventing the live exam", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Unavailable");
      },
    });
    expect(saveExamDraft("exam", {} as ExamDraft)).toBe(false);
    expect(readExamDraft("exam", node)).toBeUndefined();
  });
});
