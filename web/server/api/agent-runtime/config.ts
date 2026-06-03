import { defineEventHandler } from "h3";

type Mode = "browser-only" | "remote" | "cloud";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function modeFromEnv(): Mode {
  const mode = env("KEATING_WEB_AGENT_MODE");
  return mode === "remote" || mode === "cloud" || mode === "browser-only" ? mode : "browser-only";
}

export default defineEventHandler(() => {
  const mode = modeFromEnv();

  if (mode === "browser-only") {
    return {
      mode,
      label: "Browser-only agent",
      executionEndpoint: null,
      cloudEndpoint: null,
      remote: null,
      capabilities: {
        browserLocal: true,
        remoteSandbox: false,
        secureIsolation: false,
        nativeBinaries: false,
        serverBrokeredSecrets: false,
        durableCompute: false,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: false,
        message: "Run supported agent work in the browser. Surface a fallback error for secure isolation, native binaries, brokered secrets, durable compute, or public inbound networking.",
      },
    };
  }

  if (mode === "remote") {
    return {
      mode,
      label: "Remote microVM agent",
      executionEndpoint: "/api/agent-runtime/remote",
      cloudEndpoint: null,
      remote: {
        provider: env("KEATING_WEB_REMOTE_PROVIDER") ?? "microsandbox",
        endpoint: env("KEATING_WEB_REMOTE_ENDPOINT"),
        region: env("KEATING_WEB_REMOTE_REGION"),
        snapshot: env("KEATING_WEB_REMOTE_SNAPSHOT"),
        cpu: env("KEATING_WEB_REMOTE_CPU"),
        memory: env("KEATING_WEB_REMOTE_MEMORY"),
        disk: env("KEATING_WEB_REMOTE_DISK"),
      },
      capabilities: {
        browserLocal: true,
        remoteSandbox: true,
        secureIsolation: true,
        nativeBinaries: true,
        serverBrokeredSecrets: true,
        durableCompute: true,
      },
      fallback: {
        localFirst: true,
        remoteAvailable: true,
        message: "Run browser-compatible work locally first. Route secure isolation, native binaries, brokered secrets, durable compute, and public networking to the configured remote sandbox.",
      },
    };
  }

  return {
    mode,
    label: "Keating Cloud agent",
    executionEndpoint: "/api/agent-runtime/remote",
    cloudEndpoint: env("KEATING_WEB_CLOUD_ENDPOINT") ?? "https://keating.help",
    remote: null,
    capabilities: {
      browserLocal: true,
      remoteSandbox: true,
      secureIsolation: true,
      nativeBinaries: true,
      serverBrokeredSecrets: true,
      durableCompute: true,
    },
    fallback: {
      localFirst: true,
      remoteAvailable: true,
      message: "Run browser-compatible work locally first. Route remote-only work through the canonical Keating Cloud backend.",
    },
  };
});
