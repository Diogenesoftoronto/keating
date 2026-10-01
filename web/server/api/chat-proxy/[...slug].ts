import { defineEventHandler, getHeader, getRequestURL, createError, setHeader } from "h3";
import { readBoundedBody } from "../../utils/bounded-body";
import { consumePublicRateLimit, acquirePublicConcurrency, publicClientIdentity } from "../../utils/public-abuse";
import { assertChatProxyTarget, CHAT_PROXY_MAX_BYTES, CHAT_PROXY_CONNECT_MS, CHAT_PROXY_MAX_RESPONSE_BYTES, guardedProxyBody } from "../../utils/chat-proxy-policy";
import { buildValidatedProxyUrl } from "../../utils/proxy-target";

// The optional development flag is absent from plain Node's Process type.
const development = (process as typeof process & { dev?: boolean }).dev || import.meta.env?.DEV;

export default defineEventHandler(async (event) => {
  try {
    setHeader(event, "Cache-Control", "no-store");
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

    assertChatProxyTarget(new URL(fullTargetUrl), Boolean(development));
    if (!["GET", "POST", "OPTIONS"].includes(event.method)) {
      throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
    }
    const client = publicClientIdentity(event);
    await consumePublicRateLimit(event, { bucket: "chat-proxy-global", key: "global", limit: 600, windowSeconds: 60 });
    await consumePublicRateLimit(event, { bucket: "chat-proxy-client", key: client, limit: 120, windowSeconds: 60 });
    const releaseClient = await acquirePublicConcurrency(event, { bucket: "chat-proxy-client", key: client, limit: 8, leaseSeconds: 720 });
    let releaseGlobal: (() => Promise<void>) | undefined;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await Promise.all([releaseClient(), releaseGlobal?.()]);
    };
    try {
      releaseGlobal = await acquirePublicConcurrency(event, { bucket: "chat-proxy-global", key: "global", limit: 64, leaseSeconds: 720 });
    } catch (error) { await release(); throw error; }

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
      "cookie2", "content-length", "connection", "keep-alive", "transfer-encoding",
      "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
      "proxy-authorization", "proxy-authenticate", "upgrade", "te", "trailer",
    ];

    if (development) {
      const hasAuth = !!getHeader(event, "authorization");
      const hasApiKey = !!getHeader(event, "x-api-key");
      console.log(`[chat-proxy] ${event.method} ${proxyPath} -> ${new URL(fullTargetUrl).hostname} (auth=${hasAuth}, xApiKey=${hasApiKey})`);
    }

    const controller = new AbortController();
    let response: Response;
    const connectionTimer = setTimeout(() => controller.abort(), CHAT_PROXY_CONNECT_MS);
    connectionTimer.unref?.();
    try {
      const body = event.method === "POST" ? await readBoundedBody(event.req, CHAT_PROXY_MAX_BYTES) : undefined;
      const headers = new Headers(event.req.headers);
      const connectionNames = headers.get("connection")?.split(",").map(name => name.trim()).filter(Boolean) ?? [];
      for (const name of [...forbiddenHeaders, ...connectionNames]) headers.delete(name);
      response = await fetch(fullTargetUrl, {
        method: event.method, headers, body: body ? new Uint8Array(body) : undefined, redirect: "manual", signal: controller.signal,
      });
      const upstreamLength = response.headers.get("content-length");
      if (upstreamLength && Number(upstreamLength) > CHAT_PROXY_MAX_RESPONSE_BYTES) {
        controller.abort();
        void response.body?.cancel().catch(() => undefined);
        // This is a size rejection, not an upstream connection timeout.
        await release();
        throw createError({ statusCode: 502, statusMessage: "Provider response is too large" });
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw createError({ statusCode: 502, statusMessage: "Provider redirects are not supported" });
      }
    } catch (error) {
      await release();
      if (controller.signal.aborted && (error as { statusCode?: number }).statusCode !== 502) throw createError({ statusCode: 504, statusMessage: "Provider timed out" });
      throw error;
    } finally { clearTimeout(connectionTimer); }
    response = new Response(response.body ? guardedProxyBody(response.body, controller, release) : null, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
    if (!response.body) await release();
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
      "te", "trailer", "transfer-encoding", "upgrade", "content-length", "content-encoding",
    ]) response.headers.delete(name);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const failure = error as { status?: number; statusCode?: number; statusText?: string; statusMessage?: string; headers?: HeadersInit };
    const headers = new Headers(failure.headers);
    headers.set("Cache-Control", "no-store");
    throw createError({ statusCode: failure.status ?? failure.statusCode ?? 502,
      statusMessage: failure.statusText ?? failure.statusMessage ?? "Provider request failed", headers });
  }
});
