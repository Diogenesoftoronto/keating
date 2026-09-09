import { afterEach, describe, expect, it } from "bun:test";
import { desktopNativeBridge, desktopNativeResponse, executeDesktopNative, loadDesktopNativeRuntime, type DesktopNativeBridge } from "../lib/desktop-native";
import { applyNodePodRuntimeOverlay, shouldAutoBootNodePod } from "../keating/agent-runtime";
import { availableWorkspaceTools } from "../keating/capabilities";
import { createWorkspaceTools, createWorkspaceCapabilityTools } from "../keating/browser-tools/workspace";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function install(execute: DesktopNativeBridge["executeNative"]): DesktopNativeBridge {
  const bridge = { getNativeRuntime: async () => ({ projectRoot: "/desktop/workspace" }), executeNative: execute };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { keatingDesktop: bridge } });
  return bridge;
}

describe("desktop native workspace routing", () => {
  it("advertises native tools and never boots or overlays NodePod", async () => {
    const bridge = install(async () => ({}));
    const runtime = await loadDesktopNativeRuntime(bridge);
    expect(runtime.mode).toBe("host");
    expect(runtime.capabilities.nativeBinaries).toBe(true);
    expect(runtime.capabilities.secureIsolation).toBe(false);
    expect(shouldAutoBootNodePod(runtime)).toBe(false);
    expect(applyNodePodRuntimeOverlay(runtime, true)).toBe(runtime);
    expect(availableWorkspaceTools({ runtime })).toEqual(["workspace_inspect", "workspace_exec", "workspace_change"]);
  });

  it("does not infer native access from the OAuth-only desktop bridge", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { keatingDesktop: { onOAuthCallback() {} } } });
    expect(desktopNativeBridge()).toBeNull();
    await expect(executeDesktopNative("shell.exec", {})).rejects.toThrow("Desktop execution is unavailable");
  });

  it("routes model reads, writes, edits and commands to the same native workspace", async () => {
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const bridge = install(async (operation, payload) => {
      calls.push({ operation, payload });
      if (operation === "fs.read") return { path: "hello.txt", content: "hello" };
      if (operation === "fs.list") return [{ path: "hello.txt", isDir: false }];
      if (operation === "shell.exec") return { command: "python3", args: ["--version"], stdout: "Python", stderr: "", exitCode: 0, durationMs: 1 };
      return { ok: true, path: "hello.txt", bytes: 5 };
    });
    const tools = createWorkspaceTools({ agentRuntime: await loadDesktopNativeRuntime(bridge) });
    const invoke = async (name: string, params: Record<string, unknown>) => {
      const result = await tools.find(tool => tool.name === name)!.execute("test", params);
      return JSON.stringify(result);
    };
    expect(await invoke("read_project_file", { path: "hello.txt" })).toContain("hello");
    expect(await invoke("list_project_files", {})).toContain("hello.txt");
    await invoke("write_project_file", { path: "hello.txt", content: "hello" });
    await invoke("edit_project_file", { path: "hello.txt", search: "hello", replace: "hi" });
    expect(await invoke("bash", { command: "python3", args: ["--version"] })).toContain("Python");
    await invoke("remote_execute", { operation: "fs.read", payload: { path: "hello.txt" } });
    expect(calls.map(call => call.operation)).toEqual(["fs.read", "fs.list", "fs.write", "fs.edit", "shell.exec", "fs.read"]);
  });

  it("stops the native process when the model run is cancelled", async () => {
    const controller = new AbortController();
    const operations: string[] = [];
    install(async operation => {
      operations.push(operation);
      if (operation === "process.start") return { processId: "job-1" };
      if (operation === "process.poll") { controller.abort(); return { running: true }; }
      return { running: false };
    });
    await expect(desktopNativeResponse("shell.exec", { command: "python3" }, controller.signal)).rejects.toThrow();
    expect(operations).toEqual(["process.start", "process.poll", "process.stop"]);
  });

  it("does not execute later commands after a killed or timed-out command", async () => {
    let invocations = 0;
    const tool = createWorkspaceCapabilityTools({
      has: () => true,
      invoke: async () => { invocations++; return "# $ python3\n- exit code: -1\n- duration: 1000ms (timed out)"; },
    }).find(tool => tool.name === "workspace_exec")!;
    await tool.execute("test", { commands: [{ command: "python3" }, { command: "git", args: ["commit"] }] });
    expect(invocations).toBe(1);
  });

  it("surfaces server failures without trying another workspace", async () => {
    install(async () => { throw new Error("Native server is closed"); });
    const response = await desktopNativeResponse("fs.write", { path: "file", content: "data" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Native server is closed" });
  });
});
