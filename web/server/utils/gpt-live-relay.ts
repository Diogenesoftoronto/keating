import { createRequire } from "node:module";
import type { ClientRequest, IncomingMessage } from "node:http";
import { getNotOrganicServerConfig, type NotOrganicServerConfig } from "../../src/notorganic-provider/server";

export const GPT_LIVE_FRAME_BYTES = 131072;
export const GPT_LIVE_BUFFER_BYTES = 524288;
const HANDSHAKE_MS = 10000;
const ERROR_BYTES = 8192;
export interface GptLiveClient {
  send(text: string): unknown;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}
export interface GptLiveUpstream {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(text: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "open", callback: () => void): unknown;
  on(event: "message", callback: (data: unknown, binary: boolean) => void): unknown;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "close", callback: (code: number) => void): unknown;
  on(event: "unexpected-response", callback: (request: ClientRequest, response: IncomingMessage) => void): unknown;
}
export interface GptLiveUpstreamOptions {
  headers: Record<string, string>;
  handshakeTimeout: number;
  maxPayload: number;
  perMessageDeflate: false;
  followRedirects: false;
}
export type GptLiveConnect = (url: string, options: GptLiveUpstreamOptions) => GptLiveUpstream;
// ws is an existing server dependency. Keep its untyped module behind one explicit interface.
const NodeWebSocket = createRequire(import.meta.url)("ws") as new (url: string, options: GptLiveUpstreamOptions) => GptLiveUpstream;
const connect: GptLiveConnect = (url, options) => new NodeWebSocket(url, options);
export class GptLiveRelayError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Origin includes the exact desktop loopback port; null and cross-origin upgrades never reach auth. */
export function validateGptLiveOrigin(requestUrl: string, origin: string | null | undefined): void {
  try {
    const url = new URL(requestUrl), supplied = new URL(origin ?? "");
    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";
    const secure = url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!secure || url.pathname !== "/api/live" || url.search || url.hash || url.username || url.password || !origin || origin.length > 2048
      || supplied.origin !== url.origin || supplied.origin !== origin || supplied.username || supplied.password) throw Error();
  } catch { throw new GptLiveRelayError("live_origin_rejected", 403, "Open Live from the same Keating app origin."); }
}
export function gptLiveServerConfig(env?: NodeJS.ProcessEnv): NotOrganicServerConfig {
  try {
    const config = getNotOrganicServerConfig(env);
    if (!config.enabled) throw Error();
    return config;
  } catch { throw new GptLiveRelayError("live_relay_unavailable", 503, "Live is not configured on this Keating deployment."); }
}
function handshake(value: unknown, config: NotOrganicServerConfig) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "authorization,dpop,idempotencyKey,maxCostMicrousd,type"
    || value.type !== "keating.live.connect" || typeof value.authorization !== "string" || value.authorization.length > 16384
    || !/^DPoP [A-Za-z0-9._~+/=-]+$/u.test(value.authorization) || typeof value.dpop !== "string" || value.dpop.length > 16384
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value.dpop)
    || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/u.test(value.idempotencyKey)
    || !Number.isSafeInteger(value.maxCostMicrousd) || (value.maxCostMicrousd as number) <= 0) {
    throw new GptLiveRelayError("live_auth_invalid", 401, "Reconnect your Not Organic account with Live access.");
  }
  const url = new URL("/v1/live/sessions", config.gatewayBaseUrl);
  if (!config.enabled || url.protocol !== "https:" || url.username || url.password || !Number.isSafeInteger(config.maxCostMicrousd) || config.maxCostMicrousd <= 0) {
    throw new GptLiveRelayError("live_relay_unavailable", 503, "Live is not configured on this Keating deployment.");
  }
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(value.dpop.split(".")[1]!, "base64url").toString("utf8")); } catch { /* reject below */ }
  if (!object(claims) || claims.htm !== "GET" || claims.htu !== url.href) {
    throw new GptLiveRelayError("live_proof_target_invalid", 401, "Create a fresh Live proof for the Not Organic HTTPS session endpoint.");
  }
  const maxCostMicrousd = Math.min(value.maxCostMicrousd as number, config.maxCostMicrousd);
  url.protocol = "wss:";
  return { url: url.href, maxCostMicrousd, headers: { Authorization: value.authorization, DPoP: value.dpop,
    "Idempotency-Key": value.idempotencyKey, "x-notorganic-max-cost-microusd": String(maxCostMicrousd) } };
}
const recovery: Record<string, string> = {
  live_unavailable: "GPT Live is not configured on Not Organic. Contact the service operator.",
  realtime_consent_required: "Enable realtime content-logging consent in your Not Organic account before starting Live.",
  model_not_enabled: "Realtime access is disabled for this deployment.",
  live_budget_too_small: "The Live spending ceiling must cover at least 31 seconds at the configured rate.",
  insufficient_funds: "Add funds to your Not Organic wallet before starting Live.",
  outstanding_balance: "Resolve the outstanding Not Organic balance before starting Live.",
  budget_exceeded: "The Live request exceeds an account or capability spending limit.",
  insufficient_scope: "Reconnect your Not Organic account with realtime:connect access.",
  invalid_capability_grant: "Renew your Not Organic Live capability grant.",
  missing_dpop_proof: "Reconnect your Not Organic account to create a fresh Live proof.",
  invalid_dpop_proof: "Reconnect your Not Organic account to create a fresh Live proof.",
  idempotency_conflict: "Start a new Live connection attempt with a fresh idempotency key.",
  invalid_idempotency_key: "Start a new Live connection attempt with a fresh idempotency key.",
};
/** Never reflect upstream messages, URLs, response headers, or credential-bearing error details. */
export function safeGptLiveUpgradeError(status: number, text: string): GptLiveRelayError {
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
  let code = "";
  try {
    const value: unknown = JSON.parse(text);
    if (object(value)) { const nested = object(value.error) ? value.error : value; if (typeof nested.code === "string" && Object.hasOwn(recovery, nested.code)) code = nested.code; }
  } catch { /* Only known codes are reflected. */ }
  if (code) return new GptLiveRelayError(code, safeStatus, recovery[code]!);
  const message = safeStatus === 401 ? "Reconnect your Not Organic account with Live access."
    : safeStatus === 402 ? "Check your Not Organic wallet balance and spending limits."
    : safeStatus === 403 ? "Check your Not Organic Live permission and realtime consent."
    : safeStatus === 409 ? "Start a new Live connection attempt."
    : safeStatus === 429 ? "Live is temporarily busy. Try again shortly."
    : safeStatus === 503 ? "GPT Live is not configured or is temporarily unavailable."
    : "Not Organic could not open this Live connection.";
  return new GptLiveRelayError("live_upstream_rejected", safeStatus, message);
}

/** One connection owns one gateway socket. The gateway retains responsibility for final usage settlement. */
export function createGptLiveRelay(client: GptLiveClient, options: {
  requestUrl: string; origin: string | null | undefined; config: NotOrganicServerConfig;
  connect?: GptLiveConnect; handshakeMs?: number;
}) {
  validateGptLiveOrigin(options.requestUrl, options.origin);
  let phase: "auth" | "connecting" | "open" | "closed" = "auth", upstream: GptLiveUpstream | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const timeout = Math.max(1, Math.min(options.handshakeMs ?? HANDSHAKE_MS, HANDSHAKE_MS));
  const buffered = () => { try { const value = client.bufferedAmount(); return Number.isFinite(value) && value >= 0 ? value : Infinity; } catch { return Infinity; } };
  const close = (code: number, reason: string, clientGone = false) => {
    if (phase === "closed") return;
    phase = "closed"; clearTimeout(deadline); clearTimeout(lifetime);
    if (upstream) { try { if (upstream.readyState === 0) upstream.terminate(); else upstream.close(1000, "Product connection closed"); } catch { try { upstream.terminate(); } catch { /* already closed */ } } }
    if (!clientGone) { try { client.close(code, reason); } catch { /* already closed */ } }
  };
  const fail = (error: GptLiveRelayError, code = 1008) => {
    if (phase === "closed") return;
    const text = JSON.stringify({ type: "keating.live.error", code: error.code, status: error.status, message: error.message });
    if (buffered() + Buffer.byteLength(text) <= GPT_LIVE_BUFFER_BYTES) { try { client.send(text); } catch { /* close below */ } }
    close(code, "Live connection closed");
  };
  const sendClient = (text: string) => {
    if (phase === "closed") return;
    if (buffered() + Buffer.byteLength(text) > GPT_LIVE_BUFFER_BYTES) return fail(new GptLiveRelayError("live_backpressure", 429, "Live audio could not keep up. Reconnect and try again."), 1013);
    try { client.send(text); } catch { close(1011, "Live client unavailable"); }
  };
  const arm = () => { clearTimeout(deadline); deadline = setTimeout(() => fail(new GptLiveRelayError("live_handshake_timeout", 504, "Live authentication timed out. Start a new connection.")), timeout); deadline.unref?.(); };
  arm();
  return {
    message(data: unknown) {
      if (phase === "closed") return;
      if (typeof data !== "string") return fail(new GptLiveRelayError("live_text_required", 400, "Live accepts JSON text events only."), 1003);
      if (Buffer.byteLength(data) > GPT_LIVE_FRAME_BYTES) return fail(new GptLiveRelayError("live_frame_too_large", 413, "The Live event exceeds the frame limit."), 1009);
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { return fail(new GptLiveRelayError("live_event_invalid", 400, "Send a valid Live JSON event.")); }
      if (phase === "auth") {
        let auth: ReturnType<typeof handshake>;
        try { auth = handshake(parsed, options.config); } catch (error) { return fail(error instanceof GptLiveRelayError ? error : new GptLiveRelayError("live_auth_invalid", 401, "Reconnect your Not Organic account.")); }
        phase = "connecting"; arm();
        try { upstream = (options.connect ?? connect)(auth.url, { headers: auth.headers, handshakeTimeout: timeout, maxPayload: GPT_LIVE_FRAME_BYTES, perMessageDeflate: false, followRedirects: false }); }
        catch { return fail(new GptLiveRelayError("live_upstream_unavailable", 502, "Not Organic Live could not be reached."), 1011); }
        upstream.on("open", () => {
          if (phase === "closed") { upstream?.close(1000, "Product disconnected"); return; }
          if (phase !== "connecting") return;
          phase = "open"; clearTimeout(deadline);
          lifetime = setTimeout(() => fail(new GptLiveRelayError("live_session_timeout", 504, "This Live session reached its time limit.")), 26 * 60 * 1000); lifetime.unref?.();
          sendClient(JSON.stringify({ type: "keating.live.ready", maxCostMicrousd: auth.maxCostMicrousd }));
        });
        upstream.on("message", (raw, binary) => {
          if (phase !== "open") return;
          if (binary) return fail(new GptLiveRelayError("live_upstream_protocol", 502, "Not Organic returned an unsupported Live frame."), 1003);
          let text: string;
          if (typeof raw === "string") text = raw;
          else if (Buffer.isBuffer(raw) && raw.byteLength <= GPT_LIVE_FRAME_BYTES) text = raw.toString("utf8");
          else return fail(new GptLiveRelayError("live_upstream_protocol", 502, "Not Organic returned an unsupported Live frame."), 1009);
          if (Buffer.byteLength(text) > GPT_LIVE_FRAME_BYTES) return fail(new GptLiveRelayError("live_frame_too_large", 413, "The Live event exceeds the frame limit."), 1009);
          sendClient(text);
        });
        upstream.on("error", () => fail(new GptLiveRelayError("live_upstream_unavailable", 502, "The Not Organic Live connection failed."), 1011));
        upstream.on("close", code => {
          if (phase === "connecting") return fail(new GptLiveRelayError("live_upstream_unavailable", 502, "Not Organic closed the Live connection before it was ready."), 1011);
          close(code === 1000 ? 1000 : 1011, "Live upstream closed");
        });
        upstream.on("unexpected-response", (request, response) => {
          let length = 0, parts: Buffer[] = [], complete = false;
          const finish = () => { if (complete) return; complete = true;
            fail(safeGptLiveUpgradeError(response.statusCode ?? 502, Buffer.concat(parts).toString("utf8"))); parts = [];
            response.destroy(); request.destroy(); };
          response.on("data", (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += bytes.byteLength;
            if (length > ERROR_BYTES) { parts = []; finish(); return; } parts.push(bytes);
          });
          response.on("end", finish); response.on("error", finish);
        });
        return;
      }
      if (!object(parsed) || typeof parsed.type !== "string" || !parsed.type.startsWith("session.") || parsed.type.length > 128
        || ["authorization", "dpop", "idempotencyKey"].some(key => Object.hasOwn(parsed, key))) {
        return fail(new GptLiveRelayError("live_event_invalid", 400, "Authenticate once, then send GPT Live session events."));
      }
      if (phase !== "open" || !upstream || upstream.readyState !== 1) return fail(new GptLiveRelayError("live_not_ready", 409, "Wait for Live to become ready before sending session events."));
      if (!Number.isFinite(upstream.bufferedAmount) || upstream.bufferedAmount < 0 || upstream.bufferedAmount + Buffer.byteLength(data) > GPT_LIVE_BUFFER_BYTES) {
        return fail(new GptLiveRelayError("live_backpressure", 429, "Live audio could not keep up. Reconnect and try again."), 1013);
      }
      try { upstream.send(data, error => { if (error) fail(new GptLiveRelayError("live_upstream_unavailable", 502, "The Live event could not be delivered."), 1011); }); }
      catch { fail(new GptLiveRelayError("live_upstream_unavailable", 502, "The Live event could not be delivered."), 1011); }
    },
    close() { close(1000, "Client disconnected", true); },
    error() { close(1011, "Client connection failed", true); },
  };
}
