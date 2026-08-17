import { describe, expect, it } from "bun:test";
import {
  MOBILE_TOOL_DEFINITIONS,
  UNAVAILABLE_MOBILE_CAPABILITIES,
  executeMobileTool,
  mobileToolIdempotencyKey,
} from "../src/lib/mobile-tools";

const context = {
  idempotencyKey: "session-1:user-1:generate:recursion",
  createdAt: Date.parse("2026-08-10T12:00:00.000Z"),
  sessionId: "session-1",
  messageId: "assistant-1",
};

describe("mobile trusted tool registry", () => {
  it("publishes exact closed JSON schemas for only local deterministic tools", () => {
    expect(MOBILE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "generate_study_plan",
      "generate_concept_map",
      "generate_practice_quiz",
      "inspect_mobile_workspace",
      "propose_mobile_workspace_change",
    ]);
    for (const tool of MOBILE_TOOL_DEFINITIONS.slice(0, 3)) {
      expect(tool.inputSchema).toEqual({
        type: "object",
        properties: { topic: { type: "string", minLength: 1, maxLength: 240 } },
        required: ["topic"],
        additionalProperties: false,
      });
    }
    expect(MOBILE_TOOL_DEFINITIONS.find((tool) => tool.name === "inspect_mobile_workspace")?.inputSchema).toEqual({
      type: "object", properties: {}, additionalProperties: false,
    });
    expect(MOBILE_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_mobile_workspace_change")?.inputSchema).toMatchObject({
      type: "object", required: ["intent", "path", "source"], additionalProperties: false,
    });
  });

  it.each([
    ["generate_study_plan", "study-plan", "Study plan: Recursion"],
    ["generate_concept_map", "concept-map", "Concept map: Recursion"],
    ["generate_practice_quiz", "quiz", "Practice quiz: Recursion"],
  ])("proposes a %s artifact without mutating application state", (name, kind, title) => {
    const result = executeMobileTool(name, { topic: " recursion " }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]?.artifact).toMatchObject({
      id: expect.stringMatching(/^tool-artifact-[a-z0-9]{28}$/),
      sessionId: "session-1",
      messageId: "assistant-1",
      kind,
      source: "keating-core",
      title,
      createdAt: context.createdAt,
    });
    if (kind === "quiz") {
      expect(result.effects[0]?.artifact.content).toContain("> Generated: 2026-08-10T12:00:00.000Z");
    }
  });

  it("returns the identical proposed effect when the semantic key is retried", () => {
    const first = executeMobileTool("generate_practice_quiz", JSON.stringify({ topic: "entropy" }), context);
    const second = executeMobileTool("generate_practice_quiz", JSON.stringify({ topic: "entropy" }), context);
    expect(second).toEqual(first);
  });

  it("derives the same semantic key despite object key ordering or provider call ids", () => {
    const first = mobileToolIdempotencyKey("session-1", "user-1", "example", { topic: "x", nested: { b: 2, a: 1 } });
    const second = mobileToolIdempotencyKey("session-1", "user-1", "example", { nested: { a: 1, b: 2 }, topic: "x" });
    expect(second).toBe(first);
    expect(first).toMatch(/^tool-[a-z0-9]+$/);
    expect(mobileToolIdempotencyKey("session-1", "user-1", "generate_study_plan", { topic: " recursion " }))
      .toBe(mobileToolIdempotencyKey("session-1", "user-1", "generate_study_plan", { topic: "recursion" }));
  });

  it.each([
    ["generate_study_plan", "{", "malformed_json"],
    ["generate_study_plan", JSON.stringify({ topic: "ok", extra: true }), "invalid_arguments"],
    ["generate_study_plan", JSON.stringify({ topic: "   " }), "invalid_arguments"],
    ["remote_workspace_edit", JSON.stringify({ topic: "x" }), "unknown_tool"],
  ])("rejects invalid invocation %# truthfully", (name, args, code) => {
    const result = executeMobileTool(name, args, context);
    expect(result).toMatchObject({ ok: false, code, retryable: false, effects: [] });
  });

  it("represents cancellation and deadlines as retryable failures", () => {
    const controller = new AbortController();
    controller.abort();
    expect(executeMobileTool("generate_study_plan", { topic: "x" }, { ...context, signal: controller.signal }))
      .toMatchObject({ ok: false, code: "aborted", retryable: true });
    expect(executeMobileTool("generate_study_plan", { topic: "x" }, { ...context, deadlineAt: 10, now: () => 10 }))
      .toMatchObject({ ok: false, code: "timeout", retryable: true });
  });

  it("converts unexpected executor errors into truthful retryable failures", () => {
    const result = executeMobileTool("generate_study_plan", { topic: "recursion" }, { ...context, createdAt: Number.NaN });
    expect(result).toMatchObject({ ok: false, code: "execution_failed", retryable: true, effects: [] });
  });

  it("keeps unavailable capabilities out of provider advertisements and gives recovery", () => {
    expect(UNAVAILABLE_MOBILE_CAPABILITIES.map((entry) => entry.category)).toEqual([
      "animation", "image", "voice", "course", "improvement",
    ]);
    expect(UNAVAILABLE_MOBILE_CAPABILITIES.every((entry) => entry.reason.length > 0 && entry.recovery.length > 0)).toBe(true);
  });
});
