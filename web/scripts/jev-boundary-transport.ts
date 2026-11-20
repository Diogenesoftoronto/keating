import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { createSystemOneCaller, type JudgementBackendKey, type JudgementCaller } from "@keating/learner-contracts";
import { JEV_REQUEST_TOKEN_LIMIT } from "@keating/runtime-config";
import { CUSTOM_JUDGEMENT_ENDPOINT, createCustomJudgementBackend } from "../src/keating/judgement/custom-backend";
import { answerDraftGateReview } from "../src/test/helpers/teaching-draft-judge";
import { digest, REVIEW_MODEL, TUTOR_MODEL, sha, type BoundaryCase } from "./jev-boundary-cases";

export const MAX_MICROUSD = 800_000;
export const MAX_CALLS = 64;
export const MAX_INPUT_TOKENS = 4_000_000;
export const MAX_TOTAL_TOKENS = 4_100_000;
export const MAX_TUTOR_OUTPUT = 384;
const google = getModel("google", TUTOR_MODEL);
const openAiGoogle = "https://generativelanguage.googleapis.com/v1beta/openai";
const gemini: Model<"openai-completions"> = { ...google, api: "openai-completions", baseUrl: openAiGoogle,
  reasoning: false, compat: { maxTokensField: "max_tokens", supportsStore: false, supportsReasoningEffort: false,
    supportsDeveloperRole: false, supportsUsageInStreaming: true } };
export type Usage = { input: number; output: number; cached?: number };
export type WireRow = {
  id: number; case: BoundaryCase; role: "tutor" | "reviewer"; reservedInput: number; reservedOutput: number; reservedMicrousd: number;
  requestSha256: string; startedAt: string; status: number | null; requestId: string | null;
  semanticRequestHash: string | null; endpoint: string | null; method: "POST"; sentMs: number | null;
  headersAt: string | null; receivedMs: number | null; responseSha256: string | null; completedAt: string | null;
  requestUtf8Bytes: number; reservationBasis: "text-wire-bytes-plus-4096" | "jev-request-limit";
  reportedModel: string | null; usage: Usage | null; usageMicrousd: number | null; accountedMicrousd: number; reservationExceeded: boolean; completed: boolean;
};

const textRequestFields = new Set(["model", "messages", "stream", "stream_options", "max_tokens"]);
function sealedTutorInput(body: string, bytes: number): number {
  let payload;
  try { payload = JSON.parse(body); } catch { throw new Error("unexpected-tutor-payload"); }
  if (payload?.model !== TUTOR_MODEL || payload.max_tokens !== MAX_TUTOR_OUTPUT || payload.stream !== true
      || Object.keys(payload).some(key => !textRequestFields.has(key))
      || payload.stream_options?.include_usage !== true || Object.keys(payload.stream_options).length !== 1
      || !Array.isArray(payload.messages) || !payload.messages.length) throw new Error("unexpected-tutor-payload");
  for (const message of payload.messages) {
    if (!["user", "assistant", "system"].includes(message?.role) || Object.keys(message).some(key => key !== "role" && key !== "content")) {
      throw new Error("text-only-tutor-required");
    }
    if (typeof message.content === "string") continue;
    if (!Array.isArray(message.content) || !message.content.every((part: { type?: string; text?: unknown } | null) =>
      part?.type === "text" && typeof part.text === "string" && Object.keys(part).length === 2)) throw new Error("text-only-tutor-required");
  }
  return Math.min(google.contextWindow, bytes + 4_096);
}

/** Wall-clock overlap of two completed HTTP response bodies, identified by the actual private tutor contexts. */
export function openingWireOverlap(rows: readonly WireRow[], contexts: readonly string[]): number | null {
  if (contexts.length !== 2) return null;
  const available = rows.filter(row => row.role === "tutor" && row.status !== null && row.status >= 200 && row.status < 300 &&
    row.completed && row.reportedModel?.replace(/^models\//, "") === TUTOR_MODEL && row.responseSha256 && row.sentMs !== null && row.receivedMs !== null);
  const matched: WireRow[] = [];
  for (const hash of contexts) {
    const index = available.findIndex(row => row.semanticRequestHash === hash);
    if (index < 0) return null;
    matched.push(available.splice(index, 1)[0]!);
  }
  return Math.max(0, Math.min(...matched.map(row => row.receivedMs!)) - Math.max(...matched.map(row => row.sentMs!)));
}

// Published standard text prices, USD per million (equivalently micro-USD per token).
// https://ai.google.dev/gemini-api/docs/pricing and https://docs.typesafe.ai/models
const amount = (role: WireRow["role"], usage: Usage) => Math.ceil(role === "reviewer" ? usage.input * .042
  : usage.input * .25 + (usage.cached ?? 0) * .025 + usage.output * 1.50);
export class ProofLedger {
  readonly rows: WireRow[] = [];
  denied = 0;
  constructor(readonly cap = MAX_MICROUSD, private readonly changed: () => void = () => {}) {
    if (!Number.isSafeInteger(cap) || cap < 0 || cap > MAX_MICROUSD) throw new Error("invalid-cost-cap");
  }
  reserve(kind: BoundaryCase, role: WireRow["role"], body: string, target?: { url: string; semanticHash: string }) {
    // No tools, media or external input can enter the sealed Gemini payload. Count every outgoing UTF-8
    // byte and allow 4,096 more tokens for provider framing. Jev retains its full provider-window reservation.
    const requestUtf8Bytes = Buffer.byteLength(body, "utf8");
    const reservedInput = role === "reviewer" ? JEV_REQUEST_TOKEN_LIMIT : sealedTutorInput(body, requestUtf8Bytes);
    // Review responses are typed scores (free output). Hold the full native request window for their token accounting too.
    const reservedOutput = role === "reviewer" ? JEV_REQUEST_TOKEN_LIMIT : MAX_TUTOR_OUTPUT;
    const reservedMicrousd = amount(role, { input: reservedInput, output: reservedOutput });
    const spent = this.rows.reduce((sum, row) => sum + row.accountedMicrousd, 0);
    const tokens = this.rows.reduce((sum, row) => sum + (row.usage ? row.usage.input + (row.usage.cached ?? 0) : row.reservedInput), 0);
    const outputs = this.rows.reduce((sum, row) => sum + (row.usage?.output ?? row.reservedOutput), 0);
    if (this.rows.some(row => row.reservationExceeded) || this.rows.length >= MAX_CALLS || reservedInput + tokens > MAX_INPUT_TOKENS ||
        reservedInput + reservedOutput + tokens + outputs > MAX_TOTAL_TOKENS || reservedMicrousd + spent > this.cap) {
      this.denied++; this.changed(); throw new Error("proof-reservation-denied");
    }
    const row: WireRow = { id: this.rows.length + 1, case: kind, role, reservedInput, reservedOutput, reservedMicrousd,
      requestSha256: sha(body), startedAt: new Date().toISOString(), status: null, requestId: null,
      requestUtf8Bytes, reservationBasis: role === "tutor" ? "text-wire-bytes-plus-4096" : "jev-request-limit",
      reportedModel: null, usage: null, usageMicrousd: null, accountedMicrousd: reservedMicrousd, reservationExceeded: false, completed: false,
      endpoint: target?.url ?? null, semanticRequestHash: target?.semanticHash ?? null, method: "POST", sentMs: null,
      headersAt: null, receivedMs: null, responseSha256: null, completedAt: null };
    this.rows.push(row); this.changed();
    return row;
  }
  headers(row: WireRow, response: Response) {
    row.status = response.status;
    row.headersAt = new Date().toISOString();
    const id = response.headers.get("x-railway-request-id") ?? response.headers.get("x-request-id");
    row.requestId = id && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id) ? id : null;
    this.changed();
  }
  received(row: WireRow, body: string) {
    row.receivedMs = performance.now();
    row.responseSha256 = sha(body);
    this.changed();
  }
  finish(row: WireRow, model: string | null, usage?: Usage) {
    row.reportedModel = model && /^[\w.:/-]{1,160}$/.test(model) ? model : null;
    row.completed = true;
    row.completedAt = new Date().toISOString();
    if (usage && Object.values(usage).every(n => Number.isSafeInteger(n) && n >= 0) && usage.input + (usage.cached ?? 0) > 0) {
      row.usage = { ...usage };
      row.usageMicrousd = amount(row.role, usage);
      row.reservationExceeded = usage.input + (usage.cached ?? 0) > row.reservedInput || usage.output > row.reservedOutput
        || row.usageMicrousd > row.reservedMicrousd;
      row.accountedMicrousd = row.reservationExceeded ? Math.max(row.usageMicrousd, row.reservedMicrousd) : row.usageMicrousd;
    }
    this.changed();
    if (row.reservationExceeded) throw new Error("provider-reported-usage-above-reservation");
  }
}
type Tutor = (context: Context, options?: SimpleStreamOptions) => Promise<AssistantMessage>;
export type ProofModels = { mode: "preflight" | "live"; model: Model<Api>; tutor: Tutor; judge: JudgementCaller; reviewerKey?: JudgementBackendKey };
const emptyUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function assistant(text: string, model: Model<Api> = gemini, timestamp = 1): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: model.api, provider: model.provider,
    model: model.id, usage: structuredClone(emptyUsage), stopReason: "stop", timestamp };
}
export function completedStream(value: AssistantMessage) {
  const events = createAssistantMessageEventStream();
  if (value.stopReason === "error" || value.stopReason === "aborted") events.push({ type: "error", reason: value.stopReason, error: value });
  else events.push({ type: "done", reason: value.stopReason === "toolUse" ? "toolUse" : value.stopReason === "length" ? "length" : "stop", message: value });
  events.end(value);
  return events;
}
export function offlineModels(rejectFullState?: string): ProofModels {
  let alternative = false;
  const model = { ...gemini, provider: "fixture", id: "offline-tutor" };
  // Exercise hosted Jev's actual window rules, while the fixture backend and absent wire calls identify preflight.
  const reviewerKey = { backend: "fixture" as const, model: REVIEW_MODEL, calibrationSha256: null };
  return { mode: "preflight", model, reviewerKey,
    tutor: async () => assistant((alternative = !alternative) ? "AMBER-42: the perimeter is 24." : "The perimeter for AMBER-42 is 24 units.", model),
    judge: async request => {
      const state = request.state as { turn: unknown };
      if (rejectFullState && digest({ turn: state.turn }) === rejectFullState) {
        return { ok: false, error: { code: "context-limit-exceeded", retryable: false } };
      }
      const answer = answerDraftGateReview(request, { standard: "supported" });
      return answer.ok ? { ...answer, response: { ...answer.response, backend: reviewerKey } } : answer;
    } };
}

/** The browser's BYOK adapter with its actual production path, or the same shared codec direct to TypeSafe. */
export function relayOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.origin === "https://chat.keating.help" || ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) && /^https?:$/.test(url.protocol))) {
    throw new Error("unsupported-relay-origin");
  }
  return url.origin;
}
export function liveModels(kind: BoundaryCase, ledger: ProofLedger, reviewer: "relay" | "direct", relay = "https://chat.keating.help",
  transport: { fetch: typeof fetch; keys: Record<string, string | undefined> } = { fetch, keys: process.env }): ProofModels {
  const tutorKey = transport.keys.GEMINI_API_KEY, reviewKey = transport.keys.TYPESAFE_API_KEY;
  if (!tutorKey || !reviewKey) throw new Error("missing-GEMINI_API_KEY-or-TYPESAFE_API_KEY");
  return { mode: "live", model: gemini,
    judge: async (request, signal) => {
      let dispatched: WireRow | undefined;
      const measuredFetch = async (url: string, init: RequestInit) => {
        const endpoint = reviewer === "relay" ? relayOrigin(relay) + CUSTOM_JUDGEMENT_ENDPOINT : "https://api.typesafe.ai/v1/systemone";
        if (url !== (reviewer === "relay" ? CUSTOM_JUDGEMENT_ENDPOINT : endpoint) || typeof init.body !== "string") throw new Error("unexpected-review-route");
        dispatched = ledger.reserve(kind, "reviewer", init.body, { url: endpoint, semanticHash: digest(request) });
        dispatched.sentMs = performance.now();
        const response = await transport.fetch(endpoint, { ...init, redirect: "error" });
        ledger.headers(dispatched, response);
        ledger.received(dispatched, await response.clone().text());
        return response;
      };
      const caller = reviewer === "relay" ? createCustomJudgementBackend({ model: REVIEW_MODEL, apiKey: reviewKey, timeoutMs: 65_000, fetch: measuredFetch })!.call
        : createSystemOneCaller({ model: REVIEW_MODEL, apiKey: reviewKey, fetch: measuredFetch, requireResolvedModel: true,
          retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 } });
      const result = await caller(request, signal);
      if (dispatched) {
        const usage = result.ok && result.response.usage;
        ledger.finish(dispatched, result.ok ? result.response.backend.model : null, usage ? { input: usage.inputTokens, output: usage.outputTokens } : undefined);
      }
      return result;
    },
    tutor: async (context, options) => {
      let dispatched: WireRow | undefined, responseModel: string | null = null;
      let metadata: Promise<void> | undefined;
      const guardedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const wire = new Request(input, init);
        if (wire.url !== openAiGoogle + "/chat/completions" || wire.method !== "POST") throw new Error("unexpected-tutor-route");
        const body = await wire.clone().text();
        dispatched = ledger.reserve(kind, "tutor", body, { url: wire.url, semanticHash: digest(context) });
        const row = dispatched;
        row.sentMs = performance.now();
        const response = await transport.fetch(wire, { redirect: "error" });
        ledger.headers(dispatched, response);
        metadata = response.clone().text().then(text => {
          ledger.received(row, text);
          if (!response.ok) return;
          // The SDK omits responseModel when the provider confirms the requested id. Read only the wire model field.
          for (const line of text.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try { const chunk = JSON.parse(line.slice(5)); if (typeof chunk.model === "string") { responseModel = chunk.model; break; } } catch {}
          }
        }).catch(() => {});
        return response;
      }) as typeof fetch;
      try {
        const message = await streamSimple(gemini, context, { ...options, apiKey: tutorKey, fetch: guardedFetch,
          maxTokens: MAX_TUTOR_OUTPUT, maxRetries: 0, maxRetryDelayMs: 0, timeoutMs: 65_000, cacheRetention: "none" }).result();
        await metadata;
        const usage = message.usage;
        if (dispatched) ledger.finish(dispatched, responseModel, usage.totalTokens > 0 ? { input: usage.input, output: usage.output, cached: usage.cacheRead } : undefined);
        return message;
      } finally { if (dispatched && !dispatched.completed) ledger.finish(dispatched, null); }
    },
  };
}
