import { describe, expect, it } from "bun:test";

import { DEFAULT_AGENT_RUNTIME_CONFIG, normalizeAgentRuntimeConfig } from "../keating/agent-runtime";

describe("agent runtime config", () => {
  it("defaults to browser-only for missing or invalid config", () => {
    expect(normalizeAgentRuntimeConfig(null)).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
    expect(normalizeAgentRuntimeConfig({ mode: "free" })).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
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

  it("normalizes cloud config with canonical default endpoint", () => {
    const config = normalizeAgentRuntimeConfig({ mode: "cloud" });

    expect(config.mode).toBe("cloud");
    expect(config.executionEndpoint).toBe("/api/agent-runtime/remote");
    expect(config.cloudEndpoint).toBe("https://keating.help");
    expect(config.capabilities.serverBrokeredSecrets).toBe(true);
  });
});
