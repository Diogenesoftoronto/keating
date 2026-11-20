import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { stateCharacterCount, type JudgementRequest } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { estimatedRequestTokens, estimatedStateQuestionTokens } from "../../packages/learner-contracts/src/judgement/state-metrics.js";
import { DEFAULT_SYSTEM_ONE_MODEL, encodeSystemOneRequest, SYSTEM_ONE_ENDPOINT } from "../../packages/learner-contracts/src/judgement/wire.js";
import { JEV_REQUEST_TOKEN_LIMIT, JEV_STATE_QUESTION_TOKEN_LIMIT } from "../../packages/runtime-config/src/budgets.js";

const MAX_CALLS = 42;
const RESERVE_MICROUSD = 2_800;
const MAX_MICROUSD = 120_000;
const INPUT_MICROUSD_PER_THOUSAND = 42;
const FIXTURE = "synthetic-checksum-manifest-v1";
type Axis = "state-question" | "request";
type Group = "all" | "first-half" | "second-half";
type Observation = { result: "accepted" | "max_tokens_exceeded"; inputTokens: number | null; recall: boolean | null };
type Sample = (axis: Axis, chars: number, group: Group) => Promise<Observation>;

// Two independent bookends make the closed-choice answer check more than the presence of one word.
const ask = "Which pair gives the opening and closing shelf colors in the state, in that order?";
const choices = { "blue-olive": null, "olive-blue": null, "amber-blue": null, "olive-amber": null };
const answer = "olive-blue";

function manifest(chars: number, salt: string): string {
  return Array.from({ length: Math.ceil(chars / 44) }, (_, i) =>
    createHash("sha256").update(`${FIXTURE}/${salt}/${i}`).digest("base64url") + "\n"
  ).join("").slice(0, chars);
}

export function boundaryRequest(axis: Axis, chars: number, group: Group = "all"): JudgementRequest {
  const state = {
    openingShelfColor: "olive",
    ...(axis === "state-question" ? { checksumManifest: manifest(chars, "state") } : {}),
    closingShelfColor: "blue",
  };
  const indices = axis === "state-question" ? [0] : group === "all" ? [0, 1, 2, 3] : group === "first-half" ? [0, 1] : [2, 3];
  const questions = Object.fromEntries(indices.map(i => [
    `bookends_${i}`,
    { type: "choice" as const, instructions: axis === "state-question" ? ask : `Inventory checksum manifest:\n${manifest(chars, `question-${i}`)}\n${ask}`, criteria: choices },
  ]));
  return { state, questions };
}

/** Bracket the change in actual provider acceptance along one reproducible, growing input. */
export async function probeProviderBoundary(axis: Axis, sample: Sample) {
  const nominal = axis === "state-question" ? JEV_STATE_QUESTION_TOKEN_LIMIT : JEV_REQUEST_TOKEN_LIMIT;
  const ceiling = axis === "state-question" ? 94_000 : 48_000;
  let chars = axis === "state-question" ? 8_000 : 2_000;
  let accepted: { chars: number; inputTokens: number; recall: boolean } | null = null;
  let rejected: number | null = null;
  for (let iteration = 0; iteration < 17; iteration++) {
    const row = await sample(axis, chars, "all");
    if (row.result === "max_tokens_exceeded") {
      rejected = chars;
    } else {
      if (row.inputTokens === null || row.inputTokens <= 0 || row.recall === null) throw Error("missing_usage_or_answer");
      accepted = { chars, inputTokens: row.inputTokens, recall: row.recall };
    }
    if (accepted && rejected !== null) {
      // The closest tested success is within 0.5% of the first tested rejected filler length.
      if (rejected - accepted.chars <= Math.max(2, accepted.chars * .005)) break;
      chars = Math.floor((rejected + accepted.chars) / 2);
    } else if (accepted) {
      const estimatedNearLimit = Math.round(chars * nominal * .99 / accepted.inputTokens);
      chars = Math.min(ceiling, Math.max(chars + 1, Math.ceil(chars * 1.06), estimatedNearLimit));
      if (chars === accepted.chars) throw Error(`${axis}:fixture_did_not_cross_limit`);
    } else {
      chars = Math.floor(chars / 2);
      if (!chars) throw Error(`${axis}:empty_fixture_exceeds_limit`);
    }
  }
  if (!accepted || rejected === null || rejected - accepted.chars > Math.max(2, accepted.chars * .005)) {
    throw Error(`${axis}:boundary_not_resolved`);
  }
  // The identical questions must all fit individually. Accepting both exact halves rules
  // out an oversized state + question as the cause of rejection of the whole request.
  if (axis === "request") {
    for (const group of ["first-half", "second-half"] as const) {
      if ((await sample(axis, rejected, group)).result !== "accepted") throw Error("request:individual_question_limit_not_excluded");
    }
  }
  return { axis, nominalTokens: nominal, closestAccepted: accepted, closestRejectedChars: rejected,
    fillerGapFraction: (rejected - accepted.chars) / accepted.chars, rejectedQuestionHalvesAccepted: axis === "request" };
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Keep the documented reason and numeric context fields, never the raw error or echoed input. */
export function boundaryError(body: unknown) {
  const numericFields: Record<string, number> = {};
  const contextExceeded = record(record(body).detail).error_type === "max_tokens_exceeded";
  const scan = (value: unknown, path: string[], depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 24)) scan(item, path, depth + 1);
      return;
    }
    for (const [name, child] of Object.entries(record(value))) {
      if (["input", "body", "state", "questions", "instructions", "criteria"].includes(name)) continue;
      if (!/^[a-z][a-z_]{0,48}$/i.test(name)) continue;
      const next = [...path, name];
      if (count(child) !== null && /token|limit|context|actual|observed|maximum|length|requested/i.test(next.join("."))) {
        numericFields[next.join(".")] = child as number;
      }
      scan(child, next, depth + 1);
    }
  };
  scan(body, [], 0);
  return { contextExceeded, numericFields };
}

function apiKey(): string {
  if (process.env.TYPESAFE_API_KEY?.trim()) return process.env.TYPESAFE_API_KEY.trim();
  const secret = Bun.spawnSync(["rtk", "proxy", "skate", "get", "typesafe_api_key@secrets"], { stdout: "pipe", stderr: "pipe" });
  if (secret.exitCode !== 0 || !secret.stdout.toString().trim()) throw Error("typesafe_api_key_unavailable");
  return secret.stdout.toString().trim();
}

async function main() {
  const { values } = parseArgs({ options: { execute: { type: "boolean" }, out: { type: "string" },
    "max-calls": { type: "string", default: String(MAX_CALLS) }, model: { type: "string", default: DEFAULT_SYSTEM_ONE_MODEL },
    help: { type: "boolean" } }, strict: true });
  if (values.help) {
    console.log("bun scripts/context-window/jev-provider-boundary.ts [--execute --out NEW.jsonl] [--model jev-latest] [--max-calls 42]");
    return;
  }
  const maxCalls = Number(values["max-calls"]);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > MAX_CALLS) throw Error("max_calls_out_of_range");
  if (!/^jev-(latest|\d+\.\d+\.\d+)$/.test(values.model!)) throw Error("unsupported_jev_model");
  const plan = { fixture: FIXTURE, requestedModel: values.model!, endpoint: SYSTEM_ONE_ENDPOINT, longContext: false,
    axes: ["state-question", "request"], maxCalls, reservePerCallMicrousd: RESERVE_MICROUSD,
    maximumReservedMicrousd: Math.min(MAX_MICROUSD, maxCalls * RESERVE_MICROUSD), priceUsdPerMillionInputTokens: .042 };
  if (!values.execute) { console.log(JSON.stringify({ mode: "dry-run", ...plan })); return; }
  if (!values.out) throw Error("execute_requires_new_output_path");
  const key = apiKey();
  await mkdir(dirname(values.out), { recursive: true });
  const file = await open(values.out, "wx", 0o600);
  const write = async (row: object) => { await file.writeFile(JSON.stringify(row) + "\n"); await file.sync(); };
  let calls = 0;
  let reportedInputTokens = 0;
  let unmetered = 0;
  let model = values.model!;
  const meter = () => ({ dispatched: calls, reservedMicrousd: calls * RESERVE_MICROUSD, reportedInputTokens,
    priceFromReportedUsageMicrousd: reportedInputTokens * INPUT_MICROUSD_PER_THOUSAND / 1_000, unmeteredDispatches: unmetered });
  const sample: Sample = async (axis, chars, group) => {
    if (calls >= maxCalls || (calls + 1) * RESERVE_MICROUSD > MAX_MICROUSD) throw Error("dispatch_budget_reached");
    const request = boundaryRequest(axis, chars, group);
    const body = JSON.stringify(encodeSystemOneRequest(request, model));
    const id = ++calls;
    unmetered++;
    await write({ event: "dispatch", id, axis, group, fillerCharsPerSection: chars, model, questions: Object.keys(request.questions),
      stateUtf16Chars: stateCharacterCount(request.state), questionsJsonChars: JSON.stringify(request.questions).length,
      wireBytes: Buffer.byteLength(body), wireSha256: createHash("sha256").update(body).digest("hex"),
      hostEstimatedStateQuestionTokens: estimatedStateQuestionTokens(request), hostEstimatedRequestTokens: estimatedRequestTokens(request),
      reservedMicrousd: calls * RESERVE_MICROUSD });
    const start = performance.now();
    const response = await fetch(SYSTEM_ONE_ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body });
    let raw: unknown = null;
    try { raw = await response.json(); } catch { /* Retain status even for an unparseable response. */ }
    const result = record(raw);
    const meta = { event: "response", id, status: response.status, elapsedMs: Math.round(performance.now() - start),
      requestId: response.headers.get("x-typesafe-request-id") };
    if (!response.ok) {
      const detail = boundaryError(raw);
      const reason = response.status === 400 && detail.contextExceeded ? "max_tokens_exceeded" : "other_http_error";
      unmetered--; // TypeSafe does not charge failed HTTP requests.
      await write({ ...meta, reason, providerNumericFields: detail.numericFields });
      if (reason !== "max_tokens_exceeded") throw Error(`upstream_http_${response.status}`);
      return { result: reason, inputTokens: null, recall: null };
    }
    const usage = record(result.usage);
    const inputTokens = count(usage.input_tokens);
    const outputTokens = count(usage.output_tokens);
    if (inputTokens !== null) { reportedInputTokens += inputTokens; unmetered--; }
    const returnedModel = typeof result.model === "string" && /^jev-[a-zA-Z0-9.-]+$/.test(result.model) ? result.model : null;
    const answers = Object.keys(request.questions).map(k => record(record(result.answers)[k]).choice);
    const recall = answers.every(v => typeof v === "string" && Object.hasOwn(choices, v)) ? answers.every(v => v === answer) : null;
    await write({ ...meta, result: "accepted", returnedModel, inputTokens, outputTokens, recall });
    if (!returnedModel || (model !== "jev-latest" && returnedModel !== model)) throw Error("unresolved_or_changed_provider_model");
    model = returnedModel;
    if (inputTokens === null || inputTokens <= 0 || recall === null) throw Error("missing_usage_or_answer");
    if (inputTokens * INPUT_MICROUSD_PER_THOUSAND / 1_000 > RESERVE_MICROUSD) throw Error("provider_usage_exceeded_reservation");
    return { result: "accepted", inputTokens, recall };
  };
  try {
    await write({ event: "start", timestamp: new Date().toISOString(), ...plan });
    for (const axis of ["state-question", "request"] as const) {
      await write({ event: "boundary", ...await probeProviderBoundary(axis, sample) });
    }
    await write({ event: "complete", ...meter() });
    console.log(JSON.stringify({ out: values.out, ...meter() }));
  } catch (error) {
    // Transport exceptions may contain upstream or request details. Only known local codes are logged.
    const message = error instanceof Error && /^[a-z0-9_:-]+$/.test(error.message) ? error.message : "transport_or_io_error";
    await write({ event: "stopped", reason: message, ...meter() });
    throw Error(message);
  } finally {
    await file.close();
  }
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : "boundary_probe_failed"); process.exitCode = 1; });
