import { describe, expect, test } from "bun:test";
import { createInMemoryBrowserSandbox } from "@keating/browser-agent-runtime";
import { createFlueSandboxFactory } from "../src/sandbox-adapter.js";

describe("Flue sandbox adapter", () => {
  test("maps Keating browser-local filesystem and process capabilities", async () => {
    const factory = createFlueSandboxFactory(async ({ id }) =>
      createInMemoryBrowserSandbox({
        id,
        files: { "/workspace/lesson.md": "hello learner" },
      })
    );
    const sandbox = await factory.createSandbox({ id: "browser-agent-1" });

    expect(await sandbox.readFile("lesson.md")).toBe("hello learner");
    await sandbox.writeFile("state/evolution.json", "{\"revision\":0}");
    expect(await sandbox.exists("state/evolution.json")).toBe(true);
    expect(await sandbox.readdir("state")).toEqual(["evolution.json"]);
    expect((await sandbox.stat("state/evolution.json")).isFile).toBe(true);
    expect((await sandbox.exec("pwd")).stdout).toBe("/workspace\n");
  });

  test("translates millisecond timeouts without rounding down", async () => {
    let observedTimeout: number | undefined;
    const base = createInMemoryBrowserSandbox();
    const factory = createFlueSandboxFactory(async () => ({
      ...base,
      process: {
        async executeCommand(_command, options) {
          observedTimeout = options?.timeoutSeconds;
          return { exitCode: 0, stdout: "", stderr: "", result: "" };
        },
      },
    }));
    const sandbox = await factory.createSandbox({ id: "timeout" });
    await sandbox.exec("anything", { timeoutMs: 1001 });
    expect(observedTimeout).toBe(2);
  });
});
