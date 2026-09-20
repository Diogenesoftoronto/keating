#!/usr/bin/env bun
/** Responses API benchmark bridge. stdout contains only a verified raw response. */
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
  createNotOrganicDpopProof, notOrganicAuthPath, NOTORGANIC_AUTH_ENV,
  NOTORGANIC_DEFAULT_MAX_COST_MICROUSD, NOTORGANIC_PROVIDER_ID,
  parseNotOrganicLoginScope, parseNotOrganicPrivateJwk, resolveNotOrganicIssuer,
} from "../../src/core/notorganic-auth.js";

export const MAX_INPUT_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 4_000_000;
const TIMEOUT_MS = 30_000;
const ALIASES = new Set(["balanced", "fast", "reasoning", "vision", "embedding", "image", "audio", "realtime", "persona", "judgement"]);
type FailureCode = "invalid-request" | "route-model-required" | "capability-unavailable" | "request-failed" | "invalid-response" | "model-mismatch" | "timeout";

class DispatchFailure extends Error {
  constructor(readonly code: FailureCode) { super(`notorganic-incumbent-${code}`); }
}

export interface IncumbentCredential {
  accessToken: string;
  env: Record<string, string | undefined>;
}
export interface IncumbentDispatchOptions {
  routeModel?: string;
  cwd?: string;
  loadCredential?: (cwd: string) => IncumbentCredential | null;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}

function storedCredential(cwd: string): IncumbentCredential | null {
  const value = AuthStorage.create(notOrganicAuthPath(cwd)).get(NOTORGANIC_PROVIDER_ID);
  return value?.type === "api_key" && value.key ? { accessToken: value.key, env: value.env ?? {} } : null;
}

async function boundedText(stream: ReadableStream<Uint8Array>, limit: number, code: FailureCode, signal?: AbortSignal): Promise<string> {
  const reader = stream.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new DispatchFailure(code);
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    signal?.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) throw new DispatchFailure("invalid-request");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DispatchFailure("timeout"));
      controller.abort();
    }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); controller.abort(); }
}

/** Public capabilities select a provider alias, but benchmark identity stays concrete. */
export async function dispatchIncumbentNotOrganic(text: string, options: IncumbentDispatchOptions): Promise<string> {
  try {
    if (options.routeModel !== "balanced") throw new DispatchFailure("route-model-required");
    if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new DispatchFailure("invalid-request");
    let request: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      request = value as Record<string, unknown>;
    } catch { throw new DispatchFailure("invalid-request"); }
    const incumbent = request.model;
    if (typeof incumbent !== "string" || !incumbent.trim() || incumbent !== incumbent.trim()
      || ALIASES.has(incumbent) || incumbent.endsWith("-latest") || incumbent.length > 256
      || request.stream === true || (request.stream !== undefined && request.stream !== false)
      || (typeof request.input !== "string" && !Array.isArray(request.input))) {
      throw new DispatchFailure("invalid-request");
    }
    let credential: IncumbentCredential;
    let endpoint: string;
    let budget: number;
    try {
      const saved = (options.loadCredential ?? storedCredential)(options.cwd ?? process.cwd());
      if (!saved?.accessToken || !parseNotOrganicLoginScope(saved.env[NOTORGANIC_AUTH_ENV.scope])
        || saved.env[NOTORGANIC_AUTH_ENV.tokenType] !== "DPoP") throw new Error();
      const expiresAt = Number(saved.env[NOTORGANIC_AUTH_ENV.expiresAt]);
      if (!Number.isFinite(expiresAt) || expiresAt <= (options.now ?? Date.now)()) throw new Error();
      budget = Number(saved.env[NOTORGANIC_AUTH_ENV.maxCostMicrousd] ?? NOTORGANIC_DEFAULT_MAX_COST_MICROUSD);
      if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error();
      parseNotOrganicPrivateJwk(saved.env[NOTORGANIC_AUTH_ENV.privateJwk] ?? "");
      // A missing issuer must not send a stored credential to an assumed host.
      const issuer = saved.env[NOTORGANIC_AUTH_ENV.issuer];
      if (!issuer) throw new Error();
      endpoint = `${resolveNotOrganicIssuer(issuer)}/v1/responses`;
      credential = saved;
    } catch { throw new DispatchFailure("capability-unavailable"); }

    return await withDeadline(async (signal) => {
      const dpop = await createNotOrganicDpopProof({
        privateJwk: credential.env[NOTORGANIC_AUTH_ENV.privateJwk]!, accessToken: credential.accessToken,
        method: "POST", url: endpoint, now: options.now,
      });
      const response = await (options.fetch ?? fetch)(endpoint, {
        method: "POST", redirect: "error", signal,
        headers: {
          "content-type": "application/json", authorization: `DPoP ${credential.accessToken}`, dpop,
          "idempotency-key": `keating-incumbent-${crypto.randomUUID()}`,
          "x-notorganic-max-cost-microusd": String(budget),
        },
        body: JSON.stringify({ ...request, model: options.routeModel }),
      });
      if (!response.ok || response.redirected || !response.body) throw new DispatchFailure("request-failed");
      const raw = await boundedText(response.body, MAX_RESPONSE_BYTES, "invalid-response", signal);
      let result: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        result = value as Record<string, unknown>;
      } catch { throw new DispatchFailure("invalid-response"); }
      if (result.model !== incumbent) throw new DispatchFailure("model-mismatch");
      if (result.status !== "completed" || !Array.isArray(result.output) || result.error) throw new DispatchFailure("invalid-response");
      return raw;
    }, options.timeoutMs ?? TIMEOUT_MS);
  } catch (error) {
    throw error instanceof DispatchFailure ? error : new DispatchFailure("request-failed");
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
      process.stdout.write("Usage: bun scripts/training/incumbent_notorganic_dispatch.ts --route-model balanced < request.json\nUses project account auth; succeeds only when response.model equals the requested concrete incumbent.\n");
    } else {
      if (args.length !== 2 || args[0] !== "--route-model" || args[1] !== "balanced") throw new DispatchFailure("route-model-required");
      const input = await withDeadline((signal) => boundedText(Bun.stdin.stream(), MAX_INPUT_BYTES, "invalid-request", signal), TIMEOUT_MS);
      process.stdout.write(await dispatchIncumbentNotOrganic(input, { routeModel: args[1] }));
    }
  } catch (error) {
    process.stderr.write(`${error instanceof DispatchFailure ? error.message : "notorganic-incumbent-request-failed"}\n`);
    process.exitCode = 1;
  }
}
