import { describe, expect, test } from "bun:test";
import { KeatingPtyRpcClient } from "../src/runtime/pty-rpc-client.js";

function fakePtyHarness() {
  const writes: Array<Record<string, unknown>> = [];
  let dataListeners = new Set<(data: string) => void>();
  let exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  let launchedOptions: { nodePath?: string; cliPath: string; args?: string[] } | undefined;
  const launches: Array<{ nodePath?: string; cliPath: string; args?: string[]; env?: Record<string, string> }> = [];

  const emitData = (value: unknown) => {
    const line = typeof value === "string" ? value : JSON.stringify(value);
    for (const listener of dataListeners) listener(`${line}\r\n`);
  };
  const emitExit = () => {
    for (const listener of [...exitListeners]) listener({ exitCode: 0 });
  };
  const spawnTransport = (options: { nodePath?: string; cliPath: string; args?: string[]; env?: Record<string, string> }) => {
    launchedOptions = options;
    launches.push(options);
    dataListeners = new Set();
    exitListeners = new Set();
    const transport = {
      onData(listener: (data: string) => void) {
        dataListeners.add(listener);
        return { dispose: () => dataListeners.delete(listener) };
      },
      onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
        exitListeners.add(listener);
        return { dispose: () => exitListeners.delete(listener) };
      },
      write(value: string | Buffer) {
        const command = JSON.parse(value.toString().trim()) as Record<string, unknown>;
        writes.push(command);
        if (command.type === "get_commands") {
          queueMicrotask(() => emitData({
            type: "response",
            id: command.id,
            success: true,
            data: { commands: [{ name: "keating-ui-action-v1", source: "extension" }] },
          }));
        }
      },
      kill: emitExit,
    };
    setTimeout(() => emitData({ type: "keating_rpc_ready" }), 0);
    return transport;
  };

  return { emitData, launches, get launchedOptions() { return launchedOptions; }, spawnTransport, writes };
}

describe("KeatingPtyRpcClient", () => {
  test("uses Pi's public JSONL protocol inside a PTY", async () => {
    const harness = fakePtyHarness();
    const client = new KeatingPtyRpcClient({
      cliPath: "/tmp/pi-rpc-entry.js",
      relayPath: "/tmp/pi-pty-relay.js",
      cwd: "/tmp",
      args: ["--no-extensions"],
      spawnTransport: harness.spawnTransport as never,
    });

    await client.start();
    const commands = await client.getCommands();

    expect(harness.launchedOptions).toMatchObject({ cliPath: "/tmp/pi-rpc-entry.js", args: ["--no-extensions"] });
    expect(commands).toEqual([{ name: "keating-ui-action-v1", source: "extension" }]);
    expect(harness.writes[0]).toMatchObject({ type: "get_commands", id: "req_1" });
    await client.stop();
  });

  test("forwards events and preserves extension dialog request ids", async () => {
    const harness = fakePtyHarness();
    const client = new KeatingPtyRpcClient({
      cliPath: "/tmp/pi-rpc-entry.js",
      relayPath: "/tmp/pi-pty-relay.js",
      cwd: "/tmp",
      spawnTransport: harness.spawnTransport as never,
    });
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    await client.start();
    harness.emitData({ type: "extension_ui_request", id: "dialog-7", method: "input" });
    await client.respondToExtensionUI({ type: "extension_ui_response", id: "dialog-7", value: "retained" });

    expect(events).toEqual([{ type: "extension_ui_request", id: "dialog-7", method: "input" }]);
    expect(harness.writes.at(-1)).toEqual({ type: "extension_ui_response", id: "dialog-7", value: "retained" });
    await client.stop();
  });

  test("restarts the RPC process on the same session and preserves event listeners", async () => {
    const harness = fakePtyHarness();
    const client = new KeatingPtyRpcClient({
      cliPath: "/tmp/pi-rpc-entry.js",
      relayPath: "/tmp/pi-pty-relay.js",
      cwd: "/tmp",
      args: ["--session=old.jsonl", "--no-extensions", "--session", "older.jsonl"],
      env: { KEATING_AUTH_MISSING_PROVIDER: "openai" },
      spawnTransport: harness.spawnTransport as never,
    });
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    await client.start();
    await client.restart({
      sessionPath: "/tmp/current.jsonl",
      env: { KEATING_AUTH_MISSING_PROVIDER: "" },
    });
    harness.emitData({ type: "agent_start" });

    expect(harness.launches).toHaveLength(2);
    expect(harness.launches[1]?.args).toEqual(["--no-extensions", "--session", "/tmp/current.jsonl"]);
    expect(harness.launches[1]?.env?.KEATING_AUTH_MISSING_PROVIDER).toBe("");
    expect(events).toEqual([{ type: "agent_start" }]);
    await client.stop();
  });
});
