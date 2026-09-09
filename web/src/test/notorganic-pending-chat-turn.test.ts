import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authorizePendingChatTurn, claimPendingChatTurn, clearPendingChatTurn, pendingChatTurn, rememberChatTurn } from "../notorganic-provider/pending-chat-turn";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const user = (timestamp = 42) => ({ role: "user" as const, content: "Teach me derivatives", timestamp });
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
});
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

describe("chat send across Not Organic sign-in", () => {
  it("waits for successful authorization and claims the preserved turn only once", () => {
    rememberChatTurn("original-chat", [user()]);
    expect(claimPendingChatTurn("original-chat", [user()])).toBeNull();
    expect(pendingChatTurn()?.ready).toBe(false);
    authorizePendingChatTurn();
    expect(claimPendingChatTurn("another-chat", [user()])).toBeNull();
    expect(claimPendingChatTurn("original-chat", [user()])).toEqual([user()]);
    expect(claimPendingChatTurn("original-chat", [user()])).toBeNull();
  });
  it("does not resend a turn that was answered or superseded", () => {
    rememberChatTurn("chat", [user()]);
    authorizePendingChatTurn();
    expect(claimPendingChatTurn("chat", [user(), { role: "assistant", stopReason: "stop" } as any])).toBeNull();
    rememberChatTurn("chat", [user()]);
    authorizePendingChatTurn();
    expect(claimPendingChatTurn("chat", [user(), user(43)])).toBeNull();
  });
  it("resumes the same user message after an authentication error", () => {
    const messages = [user(), { role: "assistant", stopReason: "error", errorMessage: "Authentication required" } as any];
    rememberChatTurn("chat", messages);
    authorizePendingChatTurn();
    expect(claimPendingChatTurn("chat", messages)).toEqual([user()]);
  });
  it("never auto-sends after cancellation", () => {
    rememberChatTurn("chat", [user()]);
    clearPendingChatTurn("chat");
    authorizePendingChatTurn();
    expect(claimPendingChatTurn("chat", [user()])).toBeNull();
  });
});
