import { describe, expect, test } from "bun:test";
import { createSessionLibraryRefresh } from "../hooks/session-library-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("session library refresh", () => {
  test("coalesces a save burst and never publishes a superseded library", async () => {
    const reads = [deferred<string[]>(), deferred<string[]>()];
    let count = 0;
    const visible: string[][] = [];
    const refresh = createSessionLibraryRefresh({
      read: () => reads[count++].promise,
      receive: (value) => visible.push(value),
      fail: (error) => {
        throw error;
      },
    });
    const first = refresh.request();
    for (let i = 0; i < 10; i++) refresh.request();
    await Promise.resolve();
    expect(count).toBe(1);
    for (let i = 0; i < 10; i++) refresh.request();
    reads[0].resolve(["old title"]);
    await Promise.resolve();
    expect(visible).toEqual([]);
    expect(count).toBe(2);
    reads[1].resolve(["new title", "new fork"]);
    await first;
    expect(visible).toEqual([["new title", "new fork"]]);
  });

  test("retains previously visible sessions on a failed refresh and can retry", async () => {
    let visible = ["current"];
    let failing = true;
    const errors: unknown[] = [];
    const refresh = createSessionLibraryRefresh({
      read: async () => {
        if (failing) throw new Error("storage unavailable");
        return ["updated"];
      },
      receive: (value) => {
        visible = value;
      },
      fail: (error) => {
        errors.push(error);
      },
    });
    await refresh.request();
    expect(visible).toEqual(["current"]);
    expect(errors).toHaveLength(1);
    failing = false;
    await refresh.request();
    expect(visible).toEqual(["updated"]);
  });

  test("disposal prevents pending data or errors reaching an unmounted panel", async () => {
    for (const failure of [false, true]) {
      const read = deferred<string[]>();
      const notifications: unknown[] = [];
      const refresh = createSessionLibraryRefresh({
        read: () => read.promise,
        receive: (value) => notifications.push(value),
        fail: (error) => notifications.push(error),
      });
      const pending = refresh.request();
      await Promise.resolve();
      refresh.dispose();
      if (failure) read.reject(new Error("late error"));
      else read.resolve(["late session"]);
      await pending;
      await refresh.request();
      expect(notifications).toEqual([]);
    }
  });
});
