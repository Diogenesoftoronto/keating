import { describe, expect, test } from "bun:test";
import { buildSessionTreeRows, createForkedSession, parentSessionTitle } from "../src/lib/session-lineage";
import type { ChatSession } from "../src/lib/types";

function sourceSession(): ChatSession {
  return {
    id: "source",
    title: "Calculus",
    createdAt: 1,
    updatedAt: 5,
    messages: [
      { id: "u1", role: "user", content: "Explain limits", createdAt: 2 },
      { id: "a1", role: "assistant", content: "Start with approach.", createdAt: 3, feedback: "helpful" },
      { id: "u2", role: "user", content: "Go on", createdAt: 4 },
      { id: "a2", role: "assistant", content: "Now formalize.", createdAt: 5 },
    ],
  };
}

describe("mobile session forking", () => {
  test("forks through a selected response and gives every copied message a new identity", () => {
    let messageNumber = 0;
    const fork = createForkedSession(sourceSession(), {
      throughMessageId: "a1",
      now: 10,
      createSessionId: () => "fork",
      createMessageId: () => `copy-${++messageNumber}`,
    });
    expect(fork).toMatchObject({
      id: "fork",
      title: "Branch · Calculus",
      parentSessionId: "source",
      forkedFromMessageId: "a1",
      forkedAt: 10,
    });
    expect(fork.messages.map((message) => message.id)).toEqual(["copy-1", "copy-2"]);
    expect(fork.messages.every((message) => message.feedback === undefined)).toBe(true);
    expect(fork.messages.map((message) => message.content)).toEqual(["Explain limits", "Start with approach."]);
  });

  test("whole-session forks copy the complete transcript and reject stale fork points", () => {
    const fork = createForkedSession(sourceSession(), { createMessageId: () => crypto.randomUUID() });
    expect(fork.messages).toHaveLength(4);
    expect(fork.forkedFromMessageId).toBeUndefined();
    expect(() => createForkedSession(sourceSession(), { throughMessageId: "missing" })).toThrow("no longer in this lesson");
  });

  test("renders parents before descendants and preserves deleted-parent lineage", () => {
    const source = sourceSession();
    const child = { ...createForkedSession(source, { now: 8, createSessionId: () => "child" }), updatedAt: 8 };
    const grandchild = { ...createForkedSession(child, { now: 9, createSessionId: () => "grandchild" }), updatedAt: 9 };
    expect(buildSessionTreeRows([grandchild, child, source]).map((row) => [row.session.id, row.depth])).toEqual([
      ["source", 0],
      ["child", 1],
      ["grandchild", 2],
    ]);
    expect(parentSessionTitle(child, [source, child])).toBe("Calculus");
    expect(parentSessionTitle(child, [child])).toBe("Deleted original");
  });
});
