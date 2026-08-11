import { describe, expect, test } from "bun:test";
import type { SpawnSyncReturns } from "node:child_process";

import { handoffOpenTuiToBun } from "../src/runtime/bun-handoff.js";

function result(overrides: Partial<SpawnSyncReturns<Buffer>> = {}): SpawnSyncReturns<Buffer> {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe("standalone OpenTUI Bun handoff", () => {
  test("prefers the private release runtime and forwards the complete CLI invocation", () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const handoff = handoffOpenTuiToBun({
      packageRoot: "/opt/keating",
      entryPath: "/opt/keating/bin/keating.js",
      args: ["tui", "initial prompt"],
      platform: "linux",
      spawn(command, args) {
        calls.push({ command, args });
        return result({ status: 7 });
      },
    });

    expect(calls).toEqual([{
      command: "/opt/keating/runtime/bun",
      args: ["/opt/keating/bin/keating.js", "tui", "initial prompt"],
    }]);
    expect(handoff).toEqual({ launched: true, exitCode: 7, candidate: "/opt/keating/runtime/bun" });
  });

  test("falls back to PATH and reports a truthful unavailable result", () => {
    const calls: string[] = [];
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const unavailable = handoffOpenTuiToBun({
      packageRoot: "C:\\Keating",
      entryPath: "C:\\Keating\\bin\\keating.js",
      args: ["tui"],
      platform: "win32",
      spawn(command) {
        calls.push(command);
        return result({ error: missing, status: null });
      },
    });

    expect(calls).toEqual(["C:\\Keating/runtime/bun.exe", "bun.exe"]);
    expect(unavailable).toEqual({ launched: false, exitCode: 1 });
  });
});
