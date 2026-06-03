import { describe, expect, test } from "bun:test";

import {
  SandboxCapabilityError,
  createDaytonaCompatSandbox,
  createInMemoryBrowserSandbox,
  createRpcSandboxClient,
  createSandboxRpcHandler,
  selectSandbox,
  withSandboxFallback,
  withSandboxTransaction,
} from "../src";

describe("browser agent runtime", () => {
  test("exposes a Daytona-shaped fs and process facade over a browser sandbox", async () => {
    const local = createInMemoryBrowserSandbox({ id: "local" });
    const sandbox = createDaytonaCompatSandbox(local);

    await sandbox.fs.createFolder("workspace/src");
    await sandbox.fs.uploadFile("hello", "workspace/src/message.txt");

    const files = await sandbox.fs.listFiles("workspace/src");
    expect(files.map((file) => file.name)).toEqual(["message.txt"]);

    const downloaded = await sandbox.fs.downloadFile("workspace/src/message.txt");
    expect(new TextDecoder().decode(downloaded)).toBe("hello");

    const result = await sandbox.process.executeCommand("cat workspace/src/message.txt");
    expect(result.exitCode).toBe(0);
    expect(result.artifacts.stdout).toBe("hello");
  });

  test("rolls back a failed local transaction using snapshots", async () => {
    const local = createInMemoryBrowserSandbox({
      files: { "workspace/policy.json": "{\"score\":1}" },
    });

    const result = await withSandboxTransaction(local, {
      name: "before-bad-edit",
      mutate: () => local.fs.writeFile("workspace/policy.json", "{\"score\":0}"),
      validate: async () => JSON.parse(await local.fs.readFile("workspace/policy.json", "utf8")) as { score: number },
      accept: (validation) => validation.score > 1,
    });

    expect(result.committed).toBe(false);
    expect(await local.fs.readFile("workspace/policy.json", "utf8")).toBe("{\"score\":1}");
  });

  test("selects a remote sandbox when the local browser sandbox lacks required capabilities", () => {
    const local = createInMemoryBrowserSandbox({ id: "local" });
    const remote = createInMemoryBrowserSandbox({ id: "remote" });
    remote.kind = "remote-daytona";
    remote.capabilities.browserLocal = false;
    remote.capabilities.secureIsolation = true;
    remote.capabilities.nativeBinaries = true;
    remote.capabilities.outboundNetwork = true;
    remote.capabilities.secrets = "server-broker";
    remote.capabilities.persistence = "remote-snapshot";

    const route = selectSandbox([local, remote], {
      secureIsolation: true,
      nativeBinaries: true,
      secrets: "server-broker",
    });

    expect(route.sandbox.id).toBe("remote");
  });

  test("throws a typed fallback error when no sandbox can satisfy the operation", async () => {
    const local = createInMemoryBrowserSandbox({ id: "local" });

    await expect(withSandboxFallback(
      local,
      undefined,
      { secureIsolation: true },
      async (sandbox) => sandbox.id
    )).rejects.toBeInstanceOf(SandboxCapabilityError);
  });

  test("can expose a browser sandbox through the relay protocol", async () => {
    const local = createInMemoryBrowserSandbox({ id: "hosted-browser-tab" });
    const handler = createSandboxRpcHandler(local);
    const remoteLooking = createRpcSandboxClient(handler, { id: "agent-view" });

    await remoteLooking.fs.writeFile("workspace/relay.txt", "from browser");
    const output = await remoteLooking.process.executeCommand("cat workspace/relay.txt");

    expect(output.stdout).toBe("from browser");
    expect(await local.fs.readFile("workspace/relay.txt", "utf8")).toBe("from browser");
  });
});
