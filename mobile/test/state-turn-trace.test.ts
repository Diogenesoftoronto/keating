import { describe, expect, test } from "bun:test";
import { contractId, createTurnTrace, toolResultStatus, toolResultText } from "../src/state/turn-trace";

function fixture() {
  let n = 0;
  const trace = createTurnTrace("turn-1", { id: () => `e${++n}`, now: () => `2026-01-01T00:00:0${n}.000Z` });
  return trace;
}

const committed = (ok: boolean, retryable = false) => ({
  idempotencyKey: "key 1",
  execution: ok
    ? { ok: true, output: { done: 1 } }
    : { ok: false, code: "boom", message: "bad", retryable },
}) as never;

describe("contractId", () => {
  test("replaces unsafe characters and caps the length", () => {
    expect(contractId("call:1/2", "p")).toBe("call-1-2");
    expect(contractId("a".repeat(200), "p")).toHaveLength(128);
  });

  test("falls back to a fresh prefixed id when the cleaned id does not start alphanumeric", () => {
    expect(contractId("-lead", "tool-key")).toMatch(/^tool-key-/);
    expect(contractId("", "call")).toMatch(/^call-/);
  });
});

describe("tool result encoding", () => {
  test("maps success, retryable and fatal executions", () => {
    expect(toolResultStatus((committed(true) as any).execution)).toBe("success");
    expect(toolResultStatus((committed(false, true) as any).execution)).toBe("retryable");
    expect(toolResultStatus((committed(false) as any).execution)).toBe("error");
  });

  test("serialises output on success and the error envelope otherwise", () => {
    expect(toolResultText((committed(true) as any).execution)).toBe('{"done":1}');
    expect(JSON.parse(toolResultText((committed(false, true) as any).execution))).toEqual({ code: "boom", message: "bad", retryable: true });
  });
});

describe("turn trace", () => {
  test("merges adjacent same-type text deltas and keeps sequence numbers dense", () => {
    const trace = fixture();
    trace.appendText("text-delta", "he");
    trace.appendText("text-delta", "llo");
    trace.appendText("reasoning-delta", "think");
    trace.appendText("text-delta", "");
    const events = trace.events();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "text-delta", text: "hello", sequence: 0, turnId: "turn-1" });
    expect(events[1]).toMatchObject({ type: "reasoning-delta", text: "think", sequence: 1 });
  });

  test("starts a new text event once the merged text would exceed 65,536 characters", () => {
    const trace = fixture();
    trace.appendText("text-delta", "x".repeat(65_536));
    trace.appendText("text-delta", "y");
    expect(trace.events()).toHaveLength(2);
  });

  test("tracks dirtiness once per change", () => {
    const trace = fixture();
    expect(trace.takeDirty()).toBe(false);
    trace.appendText("text-delta", "a");
    expect(trace.takeDirty()).toBe(true);
    expect(trace.takeDirty()).toBe(false);
    trace.appendText("text-delta", "b");
    expect(trace.takeDirty()).toBe(true);
  });

  test("tool call keeps a stable semantic id and caps the name", () => {
    const trace = fixture();
    trace.appendToolCall({ id: "native", name: "n".repeat(200), arguments: { q: 1 } }, "round 1:call");
    const call = trace.events()[0];
    expect(call.type).toBe("tool-call");
    if (call.type !== "tool-call") return;
    expect(call.call.id).toBe("call-round-1-call");
    expect(call.call.idempotencyKey).toBe("round-1-call");
    expect(call.call.name).toHaveLength(128);
    const unnamed = fixture();
    unnamed.appendToolCall({ id: "x", name: "", arguments: {} }, "k");
    const event = unnamed.events()[0];
    if (event.type === "tool-call") expect(event.call.name).toBe("unknown");
  });

  test("tool result links back to its call id and reports status", () => {
    const trace = fixture();
    trace.appendToolResult(committed(false, true));
    const event = trace.events()[0];
    expect(event.type).toBe("tool-result");
    if (event.type !== "tool-result") return;
    expect(event.result).toMatchObject({ toolCallId: "call-key-1", idempotencyKey: "key-1", status: "retryable" });
    expect(trace.hasToolResult()).toBe(true);
  });

  test("restore rolls back to an earlier snapshot and marks the trace dirty", () => {
    const trace = fixture();
    trace.appendText("text-delta", "a");
    const before = trace.events();
    trace.takeDirty();
    trace.appendToolResult(committed(true));
    trace.restore(before);
    expect(trace.events()).toBe(before);
    expect(trace.hasToolResult()).toBe(false);
    expect(trace.takeDirty()).toBe(true);
  });

  test("errors are capped, terminals recorded, documents deep-copied", () => {
    const trace = fixture();
    trace.appendError("e".repeat(70_000), true);
    trace.appendTerminal("completed");
    const [error, done] = trace.events();
    if (error.type === "error") { expect(error.message).toHaveLength(65_536); expect(error.retryable).toBe(true); }
    expect(done.type).toBe("completed");
    expect(trace.lastOccurredAt()).toBe(done.occurredAt);
    const document = { id: "d", title: "t", nodes: [] } as never;
    trace.appendUiDocument(document);
    const ui = trace.events().at(-1)!;
    if (ui.type === "ui-document") expect(ui.document).not.toBe(document);
  });

  test("cloneEvents never aliases the live list", () => {
    const trace = fixture();
    trace.appendText("text-delta", "a");
    const cloned = trace.cloneEvents();
    expect(cloned).toEqual(trace.events());
    expect(cloned[0]).not.toBe(trace.events()[0]);
  });
});
