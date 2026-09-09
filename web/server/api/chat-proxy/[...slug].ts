import { defineEventHandler, proxyRequest, getHeader, getRequestURL, createError } from "h3";
import { buildValidatedProxyUrl } from "../../utils/proxy-target";

// The optional development flag is absent from plain Node's Process type.
const development = (process as typeof process & { dev?: boolean }).dev || import.meta.env?.DEV;

export default defineEventHandler(async (event) => {
  const targetBaseUrl = getHeader(event, "x-target-url");

  if (!targetBaseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing x-target-url header",
    });
  }

  const reqUrl = getRequestURL(event);
  const proxyPath = reqUrl.pathname.replace(/^\/api\/chat-proxy\/?/, "") + reqUrl.search;
  let fullTargetUrl: string;
  try {
    fullTargetUrl = buildValidatedProxyUrl(targetBaseUrl, proxyPath, {
      allowHttp: development,
      allowLocal: development,
    });
  } catch (err) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : "Invalid proxy target",
    });
  }

  const forbiddenHeaders = [
    "x-stainless-os",
    "x-stainless-lang",
    "x-stainless-package-version",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-arch",
    "x-stainless-os-version",
    "origin",
    "host",
    "referer",
    "x-target-url",
    // App sessions and analytics cookies belong to Keating, never the provider.
    "cookie",
    "cookie2",
  ];

  if (development) {
    const hasAuth = !!getHeader(event, "authorization");
    const hasApiKey = !!getHeader(event, "x-api-key");
    console.log(`[chat-proxy] ${event.method} ${proxyPath} -> ${new URL(fullTargetUrl).hostname} (auth=${hasAuth}, xApiKey=${hasApiKey})`);
  }

  const response = await proxyRequest(event, fullTargetUrl, {
    // h3 merges `headers` with the incoming request, so removing keys from a
    // copied headers object does not remove them from the upstream request.
    filterHeaders: forbiddenHeaders,
    // h3 omits Accept by default, but Codex explicitly requests an SSE stream.
    forwardHeaders: ["accept"],
  });
  // Provider/Cloudflare cookies cannot apply to the Keating origin. Preserve
  // the streaming body and status, but do not relay upstream cookie writes.
  response.headers.delete("set-cookie");
  // These describe the upstream socket, not Nitro's connection to its caller.
  // Forwarding them corrupts connection reuse in the dev proxy: a streamed
  // Codex response is followed by an empty 400 on the next local request.
  const connectionHeaders = response.headers.get("connection")?.split(",") ?? [];
  for (const name of [
    ...connectionHeaders.map((value) => value.trim()).filter(Boolean),
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
  ]) response.headers.delete(name);
  return response;
});
