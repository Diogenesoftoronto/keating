import { createError } from "h3";
import { isLocalOrPrivateHostname } from "./proxy-target";

// Exact public provider hosts from the installed Pi model catalogue. Tenant-specific
// gateways and custom providers require an operator-configured exact origin.
const HOSTS = new Set([
  "api.anthropic.com", "api.ant-ling.com", "inference.baseten.co",
  "api.cerebras.ai", "api.deepseek.com", "api.fireworks.ai",
  "api.individual.githubcopilot.com", "api.business.githubcopilot.com", "api.enterprise.githubcopilot.com",
  "generativelanguage.googleapis.com", "api.groq.com", "router.huggingface.co",
  "api.kimi.com", "api.minimax.io", "api.minimaxi.com", "api.mistral.ai",
  "api.moonshot.ai", "api.moonshot.cn", "integrate.api.nvidia.com",
  "api.openai.com", "opencode.ai", "openrouter.ai", "api.together.ai",
  "token-plan.ap-southeast-1.maas.aliyuncs.com", "token-plan.cn-beijing.maas.aliyuncs.com",
  "ai-gateway.vercel.sh", "api.x.ai", "api.xiaomimimo.com",
  "token-plan-ams.xiaomimimo.com", "token-plan-cn.xiaomimimo.com", "token-plan-sgp.xiaomimimo.com",
  "api.z.ai", "open.bigmodel.cn",
]);
const API_PATH = /^\/(?:v1(?:beta)?\/|openai\/v1\/|inference\/(?:v1\/)?|api\/v1\/|coding\/(?:v1\/)?|anthropic\/(?:v1\/)?|zen\/(?:go\/)?(?:v1\/)?|compatible-mode\/v1\/|api\/(?:coding\/)?paas\/v4\/)?(?:chat\/completions|completions|responses|messages|models|images\/generations|audio\/(?:speech|transcriptions)|systemone)$/;

export function assertChatProxyTarget(url: URL, development = false, extraOrigins = process.env.KEATING_CHAT_PROXY_EXTRA_ORIGINS ?? ""): void {
  if (development && isLocalOrPrivateHostname(url.hostname)) return;
  const configured = extraOrigins.split(",").map(value => value.trim()).filter(Boolean);
  if (configured.some(value => { try { const origin = new URL(value); return origin.protocol === "https:" && origin.href === `${origin.origin}/` && origin.origin === url.origin; } catch { return false; } })) return;
  const ordinary = url.protocol === "https:" && !url.port && HOSTS.has(url.hostname) && API_PATH.test(url.pathname);
  const codex = url.origin === "https://chatgpt.com" && url.pathname === "/backend-api/codex/responses";
  const google = url.origin === "https://generativelanguage.googleapis.com" && /^\/v1(?:beta)?\/models\/[a-zA-Z0-9._-]+:(?:streamGenerateContent|generateContent)$/.test(url.pathname);
  if (!ordinary && !codex && !google) throw createError({ statusCode: 403, statusMessage: "This provider endpoint is not enabled on this host" });
}

export const CHAT_PROXY_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_PROXY_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const CHAT_PROXY_CONNECT_MS = 60_000;
export const CHAT_PROXY_STREAM_MS = 10 * 60_000;

/** Preserve backpressure and release admission leases on every stream exit. */
export function guardedProxyBody(body: ReadableStream<Uint8Array>, controller: AbortController, release: () => Promise<void>, durationMs = CHAT_PROXY_STREAM_MS, maxBytes = CHAT_PROXY_MAX_RESPONSE_BYTES): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  let receivedBytes = 0;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const finish = async () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    await release();
  };
  const timer = setTimeout(() => {
    controller.abort();
    output.error(new Error("Provider stream timed out"));
    void finish();
    void reader.cancel().catch(() => undefined);
  }, durationMs);
  timer.unref?.();
  return new ReadableStream<Uint8Array>({
    start(value) { output = value; },
    async pull(value) {
      try {
        const chunk = await reader.read();
        if (finished) return;
        if (chunk.done) { await finish(); value.close(); }
        else {
          receivedBytes += chunk.value.byteLength;
          if (receivedBytes > maxBytes) {
            controller.abort();
            value.error(new Error("Provider response is too large"));
            await finish();
            void reader.cancel().catch(() => undefined);
          } else value.enqueue(chunk.value);
        }
      } catch (error) { await finish(); if (!finished || !controller.signal.aborted) value.error(error); }
    },
    async cancel(reason) { controller.abort(); await finish(); await reader.cancel(reason); },
  });
}
