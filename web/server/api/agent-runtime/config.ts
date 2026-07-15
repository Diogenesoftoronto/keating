import { defineEventHandler } from "h3";
import {
  buildAgentRuntimeConfig,
  type ServerAgentRuntimeMode,
} from "../../../src/keating/agent-runtime-config";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function modeFromEnv(): ServerAgentRuntimeMode {
  const mode = env("KEATING_WEB_AGENT_MODE");
  return mode === "host" || mode === "remote" || mode === "cloud" || mode === "browser-only"
    ? mode
    : "browser-only";
}

export default defineEventHandler(() => {
  const mode = modeFromEnv();
  const projectRoot = env("KEATING_WEB_PROJECT_ROOT");
  const localExecEnabled =
    !!projectRoot &&
    (process.env.KEATING_WEB_LOCAL_EXEC === "1" || process.env.KEATING_WEB_LOCAL_EXEC === "true");

  return buildAgentRuntimeConfig({
    mode,
    projectRoot,
    localExecEnabled,
    remote: mode === "remote"
      ? {
          provider: env("KEATING_WEB_REMOTE_PROVIDER") ?? "microsandbox",
          endpoint: env("KEATING_WEB_REMOTE_ENDPOINT"),
          region: env("KEATING_WEB_REMOTE_REGION"),
          snapshot: env("KEATING_WEB_REMOTE_SNAPSHOT"),
          cpu: env("KEATING_WEB_REMOTE_CPU"),
          memory: env("KEATING_WEB_REMOTE_MEMORY"),
          disk: env("KEATING_WEB_REMOTE_DISK"),
        }
      : null,
    cloudEndpoint: env("KEATING_WEB_CLOUD_ENDPOINT"),
  });
});
