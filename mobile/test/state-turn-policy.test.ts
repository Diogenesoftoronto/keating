import { describe, expect, test } from "bun:test";
import type { UiDocument } from "@keating/learner-contracts";
import { DEFAULT_TEACHER_PERSONA } from "../src/lib/persona";
import { composeSystemPrompt } from "../src/lib/system-prompt";
import {
  INTERRUPTED_TURN_MESSAGE,
  accountPolicyPrompt,
  boundSourceDocuments,
  buildTurnSystemPrompt,
  cancelledTurnEnding,
  continuedSourceDocument,
  credentialFailure,
  evolvedSystemPrompt,
  failedTurnEnding,
  generationErrorMessage,
  isAbortedTurn,
  teacherSystemPrompt,
  turnErrorMessage,
} from "../src/state/turn-policy";

const pedagogy = { systemPrompt: "EVOLVED", teacherPolicy: "POLICY", revisionId: "rev-9" };
const parts = (overrides = {}) => ({ persona: DEFAULT_TEACHER_PERSONA, learnerContext: "ctx", showToolUi: true, accountPedagogy: null, ...overrides });
const doc = (title: string, nodes: unknown[] = []): UiDocument => ({ id: title, title, nodes } as never);

describe("system prompt", () => {
  test("uses the local composition without an account pedagogy", () => {
    expect(evolvedSystemPrompt(parts())).toBe(composeSystemPrompt(DEFAULT_TEACHER_PERSONA, "ctx", true));
  });

  test("account prompt replaces only the untouched default persona", () => {
    expect(evolvedSystemPrompt(parts({ accountPedagogy: pedagogy }))).toBe("EVOLVED");
    const custom = parts({ persona: "My own persona", accountPedagogy: pedagogy });
    expect(evolvedSystemPrompt(custom)).toBe(composeSystemPrompt("My own persona", "ctx", true));
  });

  test("an account without a system prompt keeps the local one", () => {
    const empty = { ...pedagogy, systemPrompt: "" };
    expect(evolvedSystemPrompt(parts({ accountPedagogy: empty }))).toBe(composeSystemPrompt(DEFAULT_TEACHER_PERSONA, "ctx", true));
  });

  test("policy suffix names the verified revision and is empty without a policy", () => {
    expect(accountPolicyPrompt(pedagogy)).toBe("\n\nAccount pedagogy policy (verified revision rev-9):\nPOLICY");
    expect(accountPolicyPrompt({ ...pedagogy, teacherPolicy: null })).toBe("");
    expect(accountPolicyPrompt(null)).toBe("");
  });

  test("tool UI flag selects the interaction protocol", () => {
    expect(evolvedSystemPrompt(parts({ showToolUi: false }))).toBe(composeSystemPrompt(DEFAULT_TEACHER_PERSONA, "ctx", false));
  });

  test("assembles teacher prompt, recall, saved memory, knowledge guidance and capability limits in order", () => {
    const teacher = teacherSystemPrompt(parts({ accountPedagogy: pedagogy }));
    expect(teacher).toBe("EVOLVED\n\nAccount pedagogy policy (verified revision rev-9):\nPOLICY");
    const prompt = buildTurnSystemPrompt({ teacherPrompt: teacher, localRecall: "[recall]", savedMemory: "[memory]", unavailableCapabilities: "- camera" });
    expect(prompt.startsWith(`${teacher}[recall][memory]\n\nKnowledge: list selected sources`)).toBe(true);
    expect(prompt.endsWith("\n\nNative capability limits (do not claim these as available):\n- camera")).toBe(true);
    expect(prompt).toContain("Failed remote calls must not be retried.");
  });
});

describe("credential check", () => {
  test("keyless providers always pass", () => {
    expect(credentialFailure({ requiresKey: false, label: "Offline" }, null)).toBeNull();
  });

  test("a missing key names the provider", () => {
    expect(credentialFailure({ requiresKey: true, label: "OpenAI" }, null)).toBe("Add your OpenAI API key in Settings before sending a message.");
    expect(credentialFailure({ requiresKey: true, label: "OpenAI" }, "")).not.toBeNull();
    expect(credentialFailure({ requiresKey: true, label: "OpenAI" }, "sk-1")).toBeNull();
  });
});

describe("turn endings", () => {
  test("a stopped reply keeps streamed text or committed tool work and drops nothing else", () => {
    expect(cancelledTurnEnding("partial", false)).toBe("keep-partial");
    expect(cancelledTurnEnding("   ", true)).toBe("keep-partial");
    expect(cancelledTurnEnding("  \n", false)).toBe("drop-placeholder");
  });

  test("a failed reply records a retryable trace only after tool work or billed usage", () => {
    expect(failedTurnEnding(true, false)).toBe("record-failure");
    expect(failedTurnEnding(false, true)).toBe("record-failure");
    expect(failedTurnEnding(false, false)).toBe("drop-placeholder");
  });

  test("cancellation is an AbortError or an aborted signal, not any failure", () => {
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect(isAbortedTurn(abort, false)).toBe(true);
    expect(isAbortedTurn(new Error("boom"), true)).toBe(true);
    expect(isAbortedTurn(new Error("boom"), false)).toBe(false);
    expect(isAbortedTurn("string", true)).toBe(false);
  });

  test("error text falls back to a generic provider failure", () => {
    expect(turnErrorMessage(new Error("429 slow down"))).toBe("429 slow down");
    expect(turnErrorMessage(42)).toBe("The model request failed.");
  });
});

describe("released-activity source documents", () => {
  test("binds only published documents whose content is the selected reply's and unique in the turn", () => {
    const a = doc("A", [1]), b = doc("B", [2]), dupe1 = doc("D", [3]), dupe2 = doc("D", [3]);
    const published = [doc("A-scoped"), doc("B-scoped"), doc("D1-scoped"), doc("D2-scoped")];
    const bound = boundSourceDocuments(published, [a, b, dupe1, dupe2], [a, dupe1]);
    expect(bound.map((entry) => entry.title)).toEqual(["A-scoped"]);
  });

  test("returns nothing when the selected reply carries no document", () => {
    expect(boundSourceDocuments([doc("A")], [doc("A")], [])).toEqual([]);
  });

  test("a continued document counts only while it is still the latest unanswered one", () => {
    const latest = doc("A", [1]);
    expect(continuedSourceDocument(latest, doc("A", [1]))).toBe(latest);
    expect(continuedSourceDocument(latest, doc("A", [2]))).toBeNull();
    expect(continuedSourceDocument(null, doc("A"))).toBeNull();
    expect(continuedSourceDocument(latest, null)).toBeNull();
  });
});

describe("generation error banner", () => {
  test("a live error wins over the interrupted notice", () => {
    expect(generationErrorMessage("429 rate limit", true, true)).toBe("429 rate limit");
  });

  test("an interrupted turn explains how to retry", () => {
    expect(generationErrorMessage(null, true, true)).toBe(INTERRUPTED_TURN_MESSAGE);
  });

  test("friendly text unless raw errors are shown; null when nothing failed", () => {
    expect(generationErrorMessage("401 unauthorized", false, false)).toBe("The provider rejected your API key. Check it in Settings.");
    expect(generationErrorMessage(null, false, false)).toBeNull();
  });
});
