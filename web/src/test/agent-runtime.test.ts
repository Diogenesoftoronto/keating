import { describe, expect, it } from "bun:test";

import {
  applyNodePodRuntimeOverlay,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  nodePodControlAction,
  shouldAutoBootNodePod,
  shouldRouteExecutionToNodePod,
} from "../keating/agent-runtime";

describe("agent runtime config", () => {
  it("defaults to browser-only for missing or invalid config", () => {
    expect(normalizeAgentRuntimeConfig(null)).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
    expect(normalizeAgentRuntimeConfig({ mode: "free" })).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
  });

  it("preserves project file access in browser-only mode", () => {
    const config = normalizeAgentRuntimeConfig({
      mode: "browser-only",
      projectRoot: "/repo",
      projectFilesEndpoint: "/api/project-files",
    });

    expect(config.mode).toBe("browser-only");
    expect(config.executionEndpoint).toBeNull();
    expect(config.projectRoot).toBe("/repo");
    expect(config.projectFilesEndpoint).toBe("/api/project-files");
    expect(config.capabilities.hostProjectAccess).toBe(true);
  });

  it("preserves opt-in local exec access in browser-only mode", () => {
    const config = normalizeAgentRuntimeConfig({
      mode: "browser-only",
      projectRoot: "/repo",
      projectFilesEndpoint: "/api/project-files",
      localExecEndpoint: "/api/local-exec",
    });

    expect(config.mode).toBe("browser-only");
    expect(config.localExecEndpoint).toBe("/api/local-exec");
    expect(config.capabilities.localCommandExecution).toBe(true);
  });

  it("normalizes remote microVM config", () => {
    const config = normalizeAgentRuntimeConfig({
      mode: "remote",
      remote: {
        provider: "daytona",
        endpoint: "http://127.0.0.1:3929",
        region: "local",
      },
    });

    expect(config.mode).toBe("remote");
    expect(config.executionEndpoint).toBe("/api/agent-runtime/remote");
    expect(config.remote?.provider).toBe("daytona");
    expect(config.remote?.endpoint).toBe("http://127.0.0.1:3929");
    expect(config.capabilities.secureIsolation).toBe(true);
    expect(config.fallback.remoteAvailable).toBe(true);
  });

	it("does not advertise remote execution without an external endpoint", () => {
		const config = normalizeAgentRuntimeConfig({ mode: "remote" });

		expect(config.executionEndpoint).toBeNull();
		expect(config.capabilities.remoteSandbox).toBe(false);
		expect(config.fallback.remoteAvailable).toBe(false);
		expect(config.fallback.message).toContain("not configured");
	});

	it("models direct host execution without claiming sandbox isolation", () => {
		const config = normalizeAgentRuntimeConfig({
			mode: "host",
			projectRoot: "/repo",
			executionEndpoint: "/api/agent-runtime/host",
		});

		expect(config.mode).toBe("host");
		expect(config.label).toBe("Host execution agent");
		expect(config.remote).toBeNull();
		expect(config.capabilities.remoteSandbox).toBe(false);
		expect(config.capabilities.nativeBinaries).toBe(true);
		expect(config.capabilities.secureIsolation).toBe(false);
		expect(config.capabilities.serverBrokeredSecrets).toBe(false);
		expect(config.fallback.message).toContain("not a security sandbox");
	});

	it("maps legacy remote-provider host configs onto explicit host mode", () => {
		const config = normalizeAgentRuntimeConfig({
			mode: "remote",
			projectRoot: "/repo",
			executionEndpoint: "/api/agent-runtime/host",
			remote: { provider: "host", endpoint: "host://local" },
		});

		expect(config.mode).toBe("host");
		expect(config.remote).toBeNull();
		expect(config.capabilities.secureIsolation).toBe(false);
	});

  it("normalizes cloud config with canonical default endpoint", () => {
    const config = normalizeAgentRuntimeConfig({ mode: "cloud" });

    expect(config.mode).toBe("cloud");
    expect(config.executionEndpoint).toBe("/api/agent-runtime/remote");
    expect(config.cloudEndpoint).toBe("https://keating.help");
    expect(config.capabilities.serverBrokeredSecrets).toBe(true);
  });

  it("keeps an explicit remote sandbox authoritative when NodePod is active", () => {
    const remote = normalizeAgentRuntimeConfig({
      mode: "remote",
      remote: { provider: "daytona", endpoint: "https://sandbox.example" },
    });

    expect(applyNodePodRuntimeOverlay(remote, true)).toBe(remote);
    expect(shouldAutoBootNodePod(remote)).toBe(false);
    expect(shouldRouteExecutionToNodePod(remote)).toBe(false);
  });

  it("uses NodePod as the automatic sandbox only in browser-only mode", () => {
    const nodepod = applyNodePodRuntimeOverlay(DEFAULT_AGENT_RUNTIME_CONFIG, true);

    expect(nodepod.mode).toBe("browser-nodepod");
    expect(nodepod.executionEndpoint).toBe("nodepod://local");
    expect(shouldAutoBootNodePod(DEFAULT_AGENT_RUNTIME_CONFIG)).toBe(true);
    expect(shouldRouteExecutionToNodePod(nodepod)).toBe(true);
  });

  it("keeps the Stop action available when runtime config changes around an active NodePod", () => {
    const remote = normalizeAgentRuntimeConfig({
      mode: "remote",
      remote: { provider: "daytona", endpoint: "https://sandbox.example" },
    });

    expect(nodePodControlAction(remote, true)).toBe("stop");
    expect(nodePodControlAction(remote, false)).toBeNull();
    expect(nodePodControlAction(DEFAULT_AGENT_RUNTIME_CONFIG, false)).toBe("boot");
  });
});
