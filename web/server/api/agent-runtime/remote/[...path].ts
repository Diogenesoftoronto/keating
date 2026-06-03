import { createError, defineEventHandler, getHeaders, getRequestURL, proxyRequest } from "h3";

type Mode = "browser-only" | "remote" | "cloud";

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function modeFromEnv(): Mode {
  const mode = env("KEATING_WEB_AGENT_MODE");
  return mode === "remote" || mode === "cloud" || mode === "browser-only" ? mode : "browser-only";
}

function targetBaseUrl(mode: Mode): string | null {
  if (mode === "browser-only") return null;
  if (mode === "remote") return env("KEATING_WEB_REMOTE_ENDPOINT");
  return env("KEATING_WEB_CLOUD_ENDPOINT") ?? "https://keating.help";
}

export default defineEventHandler(async (event) => {
  const mode = modeFromEnv();
  const targetBase = targetBaseUrl(mode);
  if (!targetBase) {
    throw createError({
      statusCode: mode === "browser-only" ? 403 : 503,
      statusMessage: mode === "browser-only"
        ? "Remote agent runtime is disabled in browser-only mode."
        : "Remote agent runtime endpoint is not configured.",
    });
  }

  const requestUrl = getRequestURL(event);
  const proxyPath = requestUrl.pathname.replace(/^\/api\/agent-runtime\/remote\/?/, "") + requestUrl.search;
  const fullTargetUrl = `${targetBase.replace(/\/$/, "")}/api/agent-runtime/${proxyPath}`;
  const headers: Record<string, string> = { ...getHeaders(event) };

  for (const forbidden of ["origin", "host", "referer"]) {
    delete headers[forbidden];
  }

  headers["x-keating-agent-runtime-mode"] = mode;

  return proxyRequest(event, fullTargetUrl, { headers });
});

