import { describe, expect, it } from "bun:test";

if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  (globalThis as { DOMMatrix: new () => unknown }).DOMMatrix = class DOMMatrix {};
}

describe("local exec browser tools", () => {
  it("registers local shell/write/edit tools only when local exec is advertised", async () => {
    const { createKeatingTools } = await import("../keating/browser-tools");
    const baseRuntime = {
      mode: "browser-only",
      label: "Browser-only agent",
      executionEndpoint: null,
      cloudEndpoint: null,
      projectRoot: "/repo",
      projectFilesEndpoint: "/api/project-files",
      localExecEndpoint: null,
      remote: null,
      capabilities: {
        browserLocal: true,
        remoteSandbox: false,
        secureIsolation: false,
        nativeBinaries: false,
        serverBrokeredSecrets: false,
        durableCompute: false,
        hostProjectAccess: true,
        localCommandExecution: false,
      },
      fallback: { localFirst: true, remoteAvailable: false, message: "" },
    } as const;

    const withoutLocalExec = await createKeatingTools({} as any, { agentRuntime: baseRuntime });
    expect(withoutLocalExec.map((tool) => tool.name)).not.toContain("bash");

    const withLocalExec = await createKeatingTools({} as any, {
      agentRuntime: {
        ...baseRuntime,
        localExecEndpoint: "/api/local-exec",
        capabilities: { ...baseRuntime.capabilities, localCommandExecution: true },
      },
    });
    const names = withLocalExec.map((tool) => tool.name);
    expect(names).toContain("bash");
    expect(names).toContain("write_project_file");
    expect(names).toContain("edit_project_file");
  });
});
