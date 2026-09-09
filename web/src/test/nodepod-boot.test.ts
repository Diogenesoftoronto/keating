import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Nodepod } from "@scelar/nodepod";
import { bootNodePod, getNodePod, isNodePodActive, nodePodGetAllFileContents, teardownNodePod } from "../keating/nodepod-runtime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
function fixture() {
  const files = new Map<string, string>();
  const teardown = mock(() => {});
  const writeFile = mock(async (path: string, value: string) => { files.set(path, value); });
  const pod = { instanceId: "fixture", teardown, fs: {
    mkdir: async () => {}, writeFile, readFile: async (path: string) => files.get(path),
  } } as unknown as Nodepod;
  const dependencies = {
    Nodepod: { boot: mock(async () => pod) },
    NODEPOD_BOOT_FILES: { "src/example.ts": "export const ready = true;" },
    openSandboxRepo: mock(async () => {}),
    closeSandboxRepo: mock(() => {}),
  };
  return { pod, teardown, writeFile, dependencies };
}
let warning: ReturnType<typeof spyOn>;
let logging: ReturnType<typeof spyOn>;
beforeEach(() => { warning = spyOn(console, "warn").mockImplementation(() => {}); logging = spyOn(console, "log").mockImplementation(() => {}); });
afterEach(async () => { await teardownNodePod(); warning.mockRestore(); logging.mockRestore(); });

describe("NodePod boot lifecycle", () => {
  it("retries after module loading fails without requiring a page reload and preserves the stack", async () => {
    const failure = new TypeError("undefined has no properties");
    expect(await bootNodePod(async () => { throw failure; })).toBeNull();
    expect(warning).toHaveBeenCalledWith("[nodepod] Boot failed during loading modules:", failure);
    const { pod, dependencies } = fixture();
    expect(await bootNodePod(async () => dependencies)).toBe(pod);
    expect(isNodePodActive()).toBe(true);
  });

  it("shares concurrent startup and exposes only fully initialized instances", async () => {
    const { pod, dependencies } = fixture();
    const gate = deferred<typeof dependencies>();
    const loader = mock(() => gate.promise);
    const first = bootNodePod(loader);
    const second = bootNodePod(loader);
    const getter = getNodePod();
    expect(isNodePodActive()).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
    gate.resolve(dependencies);
    expect(await Promise.all([first, second, getter])).toEqual([pod, pod, pod]);
    expect(dependencies.Nodepod.boot).toHaveBeenCalledTimes(1);
    expect(dependencies.Nodepod.boot).toHaveBeenCalledWith({ files: {}, workdir: "/workspace", swUrl: "/__sw__.js" });
  });

  it("tears down a partially initialized sandbox and discards its partial baseline", async () => {
    const failed = fixture();
    const failure = new Error("write failed");
    failed.writeFile.mockImplementationOnce(async () => { throw failure; });
    expect(await bootNodePod(async () => failed.dependencies)).toBeNull();
    expect(failed.teardown).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[nodepod] Boot failed during populating workspace:", failure);
    const next = fixture();
    next.dependencies.NODEPOD_BOOT_FILES = { "src/second.ts": "fresh" } as any;
    await bootNodePod(async () => next.dependencies);
    expect(await nodePodGetAllFileContents()).toEqual([{ path: "/workspace/src/second.ts", content: "fresh" }]);
  });

  it("closes sandbox history and the pod if repository initialization fails", async () => {
    const { dependencies, teardown } = fixture();
    const failure = new Error("IndexedDB unavailable");
    dependencies.openSandboxRepo.mockImplementation(async () => { throw failure; });
    expect(await bootNodePod(async () => dependencies)).toBeNull();
    expect(dependencies.closeSandboxRepo).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[nodepod] Boot failed during opening sandbox history:", failure);
  });

  it("teardown during startup prevents a late pod from becoming active and allows a fresh retry", async () => {
    const { pod, dependencies, teardown } = fixture();
    const gate = deferred<Nodepod>();
    const entered = deferred<void>();
    dependencies.Nodepod.boot.mockImplementation(() => { entered.resolve(); return gate.promise; });
    const booting = bootNodePod(async () => dependencies);
    await entered.promise;
    const stopping = teardownNodePod();
    const fresh = fixture();
    const retry = bootNodePod(async () => fresh.dependencies);
    expect(fresh.dependencies.Nodepod.boot).not.toHaveBeenCalled();
    gate.resolve(pod);
    expect(await booting).toBeNull();
    await stopping;
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(await retry).toBe(fresh.pod);
    expect(await getNodePod()).toBe(fresh.pod);
  });
});
