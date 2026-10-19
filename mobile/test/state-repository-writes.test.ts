import { describe, expect, test } from "bun:test";
import { drainRepositoryWrites, enqueueRepositoryWrite, type WriteTail } from "../src/state/repository-writes";

const tail = (): WriteTail => ({ current: Promise.resolve() });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("repository write queue", () => {
  test("runs writes strictly in order", async () => {
    const t = tail();
    const order: string[] = [];
    const gate = deferred();
    const first = enqueueRepositoryWrite(t, async () => { await gate.promise; order.push("first"); });
    const second = enqueueRepositoryWrite(t, async () => { order.push("second"); });
    expect(order).toEqual([]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  test("a failed write rejects its own caller but does not block later writes", async () => {
    const t = tail();
    const failing = enqueueRepositoryWrite(t, async () => { throw new Error("boom"); });
    const later = enqueueRepositoryWrite(t, async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    expect(await later).toBe("ok");
  });

  test("the newest write becomes the tail", async () => {
    const t = tail();
    const write = enqueueRepositoryWrite(t, async () => 1);
    expect(t.current).toBe(write);
    await write;
  });

  test("drain waits for pending writes and swallows their failures", async () => {
    const t = tail();
    const gate = deferred();
    let done = false;
    void enqueueRepositoryWrite(t, async () => { await gate.promise; done = true; throw new Error("late"); }).catch(() => undefined);
    const drained = drainRepositoryWrites(t).then(() => done);
    gate.resolve();
    expect(await drained).toBe(true);
  });
});
