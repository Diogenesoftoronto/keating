/** Rendered learner proof. Dry-run submits through the real composer with all inference blocked. */
import { chromium, type Route } from "../../spikes/flue-host/node_modules/playwright-core/index.js";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { calibratedCase, REVIEW_MODEL, TUTOR_MODEL } from "./jev-boundary-cases";
import { CHECKPOINT_FEEDBACK_ISSUE, TEACHING_POLICY_DETERMINISTIC_RULES, TEACHING_POLICY_RULES } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog";
import { TEACHING_DEBUGGING_ISSUES } from "../../packages/learner-contracts/src/judgement/debugging-issue-ids";
import type { TeachingDraftAttempt, TeachingPolicyCheck } from "@keating/learner-contracts";

const { values } = parseArgs({ options: { execute: { type: "boolean" }, origin: { type: "string", default: "http://127.0.0.1:45861" },
  out: { type: "string", default: ".keating/benchmarks/jev-window-live-20261120/browser" } }, strict: true });
const origin = new URL(values.origin!);
if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:" || origin.href !== origin.origin + "/") throw Error("loopback_candidate_required");
const out = resolve(values.out!), live = values.execute === true;
const directory = join(out, (live ? "live-" : "dry-") + new Date().toISOString().replace(/[:.]/g, "-"));
const model = getModel("google", TUTOR_MODEL);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const prompt = "Using our earlier workshop code, give the perimeter of a rectangle with sides 7 and 5. Include the code and numeric result in one sentence. Use only our conversation.";
const id = randomUUID();
const code = "SAGE-" + digest(id).slice(0, 8).toUpperCase();
const ledgerPath = join(out, "spend.json");
const cap = 140_000, maxReviews = 36, maxTutor = 7, maxOutput = 384;
type Charge = { id: number; kind: "review" | "tutor"; reserved: number; charged: number; run: string; status: number | null;
  input: number | null; output: number | null; complete: boolean };
type Evidence = { id: number | null; kind: Charge["kind"]; bytes: number; wireHash: string; questions?: number;
  historyMessages?: number; oldestPresent?: boolean; retainedCode?: boolean; historyHash?: string; currentPresent?: boolean;
  nativeToolGroupsRemoved?: number; outputLimit?: number; estimatedInputCeiling?: number; status?: number;
  matchedCode?: string | null; responseModel?: string | null; input?: number | null; output?: number | null;
  reviewedReplySha256?: string; candidateReplyHashes?: Record<string, string>; selectedDraft?: string | null;
  selectedDraftSha256?: string | null; proposedTools?: number };
const calls: Evidence[] = [];
const denied: string[] = [];
const receipt: Record<string, unknown> = { sessionId: id, uniqueCode: code, question: prompt, origin: origin.origin,
  mode: live ? "live" : "dry-run", calls, denied, caps: { microUsd: cap, maxReviews, maxTutor, maxOutput }, passed: false };
const proofHashes = { questionSha256: digest(prompt), expectedPartsSha256: digest(JSON.stringify([code, "24"])),
  selectorSelectedDraftSha256: null as string | null, checkedPersistedReplySha256: null as string | null,
  persistedReplySha256: null as string | null, renderedBubbleSha256: null as string | null,
  offlinePersistedReplySha256: null as string | null, offlineRenderedBubbleSha256: null as string | null };
receipt.proofHashes = proofHashes;
// The durable app receipt already filters policy checks. Use the catalog again at the export boundary.
export const browserProofCheckIds = [...new Set<string>([...TEACHING_POLICY_DETERMINISTIC_RULES, ...TEACHING_POLICY_RULES.map(rule => rule.id),
  ...TEACHING_DEBUGGING_ISSUES, CHECKPOINT_FEEDBACK_ISSUE, "quality_progress", "quality_scope", "requested_part_missing", "runtime_tool_schema"])];
const readbackInput = { id, prompt, checkIds: browserProofCheckIds };
let charges: Charge[] = [];
let lock: number | undefined;
function jsonWrite(path: string, data: unknown) {
  writeFileSync(path + ".tmp", JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
function save() {
  jsonWrite(join(directory, "receipt.json"), receipt);
  if (live) jsonWrite(ledgerPath, charges);
}
function reserve(kind: Charge["kind"], required: number): Charge {
  if (charges.filter(e => e.kind === kind).length >= (kind === "review" ? maxReviews : maxTutor)
      || charges.reduce((sum, e) => sum + e.charged, 0) + required > cap) throw Error("run-budget-denied");
  const row: Charge = { id: charges.length + 1, kind, reserved: required, charged: required, run: directory.split("/").at(-1)!,
    status: null, input: null, output: null, complete: false };
  charges.push(row); save();
  return row;
}
function key(env: string, slot: string): string {
  const fromEnv = process.env[env]?.trim();
  if (fromEnv) return fromEnv;
  const result = Bun.spawnSync(["rtk", "proxy", "skate", "get", slot], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0 || !result.stdout.toString().trim()) throw Error("missing-" + env);
  return result.stdout.toString().trim();
}
function safeCount(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }

export function reviewTargetHashes(state: { reply?: { text?: unknown }; candidates?: Record<string, { text?: unknown } | null> } | null) {
  const targets: Pick<Evidence, "reviewedReplySha256" | "candidateReplyHashes"> = {};
  if (typeof state?.reply?.text === "string") targets.reviewedReplySha256 = digest(state.reply.text);
  if (state?.candidates) {
    // The host supports at most ten attempts. Unrecognized keys and private candidate text never enter evidence.
    targets.candidateReplyHashes = {};
    for (let attempt = 1; attempt <= 10; attempt++) {
      const key = "draft_" + attempt, text = state.candidates[key]?.text;
      if (typeof text === "string") targets.candidateReplyHashes[key] = digest(text);
    }
  }
  return targets;
}

// Runs inside Chromium using the same storage records read by production session restoration.
export async function browserReadback({ id, prompt, checkIds }: { id: string; prompt: string; checkIds: readonly string[] }) {
  async function read(dbName: string, store: string, key?: string) {
    return new Promise<any>((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(store);
        const req = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error("readback-failed"));
        tx.oncomplete = () => db.close(); tx.onabort = () => { db.close(); reject(Error("readback-aborted")); };
      };
      open.onerror = () => reject(Error("readback-open-error"));
    });
  }
  const text = (m: { content: string | { type: string; text?: string }[] }) =>
    typeof m.content === "string" ? m.content : (m.content ?? []).filter(p => p.type === "text").map(p => p.text ?? "").join("");
  const thread = await read("keating", "sessions", id);
  const messages = thread?.messages ?? [];
  const questionIndex = messages.findLastIndex((m: { role: string; content: string }) => m.role === "user" && text(m) === prompt);
  const after = questionIndex < 0 ? [] : messages.slice(questionIndex + 1);
  const nextQuestion = after.findIndex((m: { role: string }) => m.role === "user");
  const turn = nextQuestion < 0 ? after : after.slice(0, nextQuestion);
  const final = turn.findLast((m: { role: string; content: string }) => m.role === "assistant" && text(m).trim());
  const assistantText = final ? text(final) : null;
  const assistantTextSha256 = assistantText === null ? null : Array.from(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(assistantText))), byte => byte.toString(16).padStart(2, "0")).join("");
  const records = await read("keating-db", "teaching-draft-receipts");
  const targetTimestamp = final?.metadata?.custom?.keatingDiagnosticTimestamps?.at(-1) ?? final?.timestamp;
  const owner = typeof targetTimestamp === "number" ? records.filter((r: { sessionId: string; messageTimestamp: number }) =>
    r.sessionId === id && r.messageTimestamp === targetTimestamp).sort((a: { createdAt: number }, b: { createdAt: number }) => b.createdAt - a.createdAt)[0] : undefined;
  const s = owner?.snapshot;
  const questionTime = messages[questionIndex]?.timestamp, nextTime = after[nextQuestion]?.timestamp ?? Infinity;
  const pending = !final && typeof questionTime === "number" ? records.filter((r: { sessionId: string; messageTimestamp: number }) =>
    r.sessionId === id && r.messageTimestamp >= questionTime && r.messageTimestamp < nextTime) : [];
  const attempts: TeachingDraftAttempt[] | null = Array.isArray(s?.attempts) ? s.attempts : null;
  const selected = attempts?.find(row => row.attempt === s?.selectedAttempt);
  const rows = Array.isArray(selected?.checks) ? selected.checks : null;
  const known = new Set(checkIds);
  const maxChecks = 96;
  const sample = rows?.slice(0, maxChecks);
  if (rows && sample && rows.length > maxChecks && !sample.some(row => row?.id === "requested_part_missing")) {
    const requestedPart = rows.find(row => row?.id === "requested_part_missing" && row.source === "jev");
    if (requestedPart) sample[maxChecks - 1] = requestedPart;
  }
  const selectedChecks = sample?.flatMap((row: TeachingPolicyCheck) => {
    if (!row || !known.has(row.id) || !["jev", "deterministic"].includes(row.source) || !["pass", "fail", "unknown"].includes(row.status)) return [];
    return [{ id: row.id, source: row.source, status: row.status,
      probability: typeof row.probability === "number" && Number.isFinite(row.probability) && row.probability >= 0 && row.probability <= 1 ? row.probability : null,
      applicability: ["standalone-direct-answer", "debugging-expected-output", "feedback-on-attempt"].includes(row.applicability ?? "") ? row.applicability! : null }];
  }) ?? null;
  const parallel = s?.parallelAttempts?.[0] === 1 && s?.parallelAttempts?.[1] === 2 ? [1, 2] : [];
  const hasSource = (row: { attempt: number; repairSourceAttempt?: number }) =>
    Number.isSafeInteger(row.repairSourceAttempt) && row.repairSourceAttempt! > 0 && row.repairSourceAttempt! < row.attempt;
  const repairs = attempts?.filter(hasSource) ?? [];
  const ambiguous = !attempts || attempts.some(row => row.attempt > 1 && !parallel.includes(row.attempt) && !hasSource(row) && !row.synthesisSourceAttempts?.length);
  const started = repairs.length > 0 || Boolean(s && hasSource(s));
  const repairAttempted = started ? true : ambiguous ? null : false;
  const reviewed = repairs.some(row => Array.isArray(row.checks) && row.checks.length > 0);
  const provenNoReview = repairs.length > 0 && repairs.every(row => row.status === "generation-error");
  const repairReviewed = reviewed ? true : repairAttempted === false || (provenNoReview && !ambiguous) ? false : null;
  return { sessionId: thread?.id ?? null, messageCount: messages.length, questionIndex, assistantText: assistantText?.slice(0, 4000) ?? null, assistantTextSha256,
    assistantTimestamp: final?.timestamp ?? null, stopReason: final?.stopReason ?? null, receiptTimestamp: owner?.messageTimestamp ?? null,
    phase: s?.phase ?? (pending.length === 1 ? pending[0].snapshot?.phase ?? null : null), selectedAttempt: s?.selectedAttempt ?? null, reason: s?.reason ?? null,
    selectedChecks, selectedCheckCount: rows?.length ?? null, selectedChecksOmitted: rows ? rows.length - selectedChecks!.length : null,
    repairAttempted, repairReviewed, attempts: (attempts ?? []).slice(0, 10).map(row =>
      ({ attempt: row.attempt, status: row.status, repairSourceAttempt: hasSource(row) ? row.repairSourceAttempt : null })),
    parallelAttempts: parallel, slides: (s?.slides ?? []).slice(-64).map((slide: { reason?: string; phase?: string; turnsDropped: number }) =>
      ({ reason: slide.reason ?? null, phase: slide.phase, turnsDropped: slide.turnsDropped })) };
}

async function execute() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (live) {
    lock = openSync(join(out, "run.lock"), "wx", 0o600);
    if (existsSync(ledgerPath)) charges = JSON.parse(readFileSync(ledgerPath, "utf8"));
    if (new Set(charges.map(row => row.run)).size >= 2) throw Error("live-session-limit-reached");
  }
  const reviewKey = live ? key("TYPESAFE_API_KEY", "typesafe_api_key@secrets") : "unsent-browser-fixture";
  const tutorKey = live ? key("GEMINI_API_KEY", "gemini@secrets") : "unsent-browser-fixture";
  save();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1160, height: 850 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await context.newPage();
    const pending = new Set<Promise<void>>();
    let submitted = false;
    let offline = false;
    const staticFiles = new Map<string, { status: number; body: Buffer; headers: Record<string, string> }>();
    const caching = new Set<Promise<void>>();
    page.on("response", response => {
      const url = new URL(response.url());
      if (offline || !response.ok() || response.request().method() !== "GET" || url.origin !== origin.origin || url.pathname.startsWith("/api/")) return;
      const path = url.pathname === "/chat" ? "/chat" : url.pathname + url.search;
      const capture = response.body().then(body => {
        const headers = { ...response.headers() };
        delete headers["content-encoding"]; delete headers["content-length"]; delete headers["transfer-encoding"];
        staticFiles.set(path, { status: response.status(), body, headers });
      }).catch(() => {});
      caching.add(capture); void capture.finally(() => caching.delete(capture));
    });
    const intercept = async (route: Route) => {
      const request = route.request(), url = new URL(request.url());
      const local = url.origin === origin.origin;
      if (offline) {
        const cached = local && request.method() === "GET" ? staticFiles.get(url.pathname === "/chat" ? "/chat" : url.pathname + url.search) : undefined;
        return cached ? route.fulfill(cached) : route.abort("internetdisconnected");
      }
      const review = local && url.pathname === "/api/judgement/typesafe";
      const tutor = url.origin === "https://generativelanguage.googleapis.com" &&
        url.pathname === "/v1beta/models/" + TUTOR_MODEL + ":streamGenerateContent";
      if (request.method() === "OPTIONS" && tutor && live) return route.continue();
      if (!review && !tutor) {
        if (local && ["GET", "HEAD"].includes(request.method()) && !url.pathname.startsWith("/api/")) return route.continue();
        if (submitted && (!local || request.method() === "POST")) {
          const tag = local ? url.pathname : url.hostname;
          if (!denied.includes(tag)) denied.push(tag);
        }
        return route.abort("blockedbyclient");
      }
      if (!submitted || request.method() !== "POST") return route.abort("blockedbyclient");
      const original = request.postData() ?? "", data = JSON.parse(original);
      let wire = original;
      const entry: Evidence = { id: null, kind: review ? "review" : "tutor", bytes: 0, wireHash: "" };
      if (review) {
        if (data.model !== REVIEW_MODEL || url.search) throw Error("unexpected-review-model-or-query");
        const state = typeof data.state === "string" ? JSON.parse(data.state) : data.state;
        Object.assign(entry, reviewTargetHashes(state));
        const turn = state?.turn;
        entry.questions = Object.keys(data.questions ?? {}).length;
        entry.historyMessages = turn?.conversation?.length;
        entry.historyHash = digest(JSON.stringify(turn?.conversation ?? []));
        entry.oldestPresent = Boolean(turn?.conversation?.[0]?.content?.includes(code));
        entry.retainedCode = Boolean(turn?.earlierLearnerExcerpts?.some((e: string) => e.includes(code)));
        entry.currentPresent = turn?.learnerMessage === prompt;
      } else {
        if (url.searchParams.has("key") && url.searchParams.get("key") !== tutorKey) throw Error("unexpected-google-key");
        if (!data.contents?.length || data.contents.some((c: { parts?: object[] }) => c.parts?.some(p => !("text" in p)))) throw Error("text-only-tutor-required");
        // Only generation for this learner turn is authorized. Title and topic classification can use the same Google model.
        const conversation = JSON.stringify(data.contents);
        if (!conversation.includes(prompt) || !conversation.includes(code)) {
          if (!denied.includes("background-google-request")) denied.push("background-google-request");
          return route.abort("blockedbyclient");
        }
        // Keep the real system instruction and every message. The test's budget excludes tools and grounding.
        entry.nativeToolGroupsRemoved = Array.isArray(data.tools) ? data.tools.length : 0;
        delete data.tools; delete data.toolConfig;
        data.generationConfig ??= {};
        entry.outputLimit = data.generationConfig.maxOutputTokens = Math.min(maxOutput, data.generationConfig.maxOutputTokens ?? maxOutput);
        wire = JSON.stringify(data);
      }
      entry.bytes = Buffer.byteLength(wire);
      entry.wireHash = digest(wire);
      // Whole serialized UTF-8 request plus framing allowance; no binary/media input.
      if (tutor) entry.estimatedInputCeiling = entry.bytes + 4_096;
      calls.push(entry);
      if (!live) { save(); return route.abort("blockedbyclient"); }
      const charge = reserve(entry.kind, review ? 2_800 : Math.ceil(entry.estimatedInputCeiling! * .25 + entry.outputLimit! * 1.5));
      entry.id = charge.id; save();
      // Forward the wire to its real URL. maxRetries and maxRedirects protect the dispatch count and credential.
      const response = await route.fetch({ ...(tutor ? { postData: wire } : {}), timeout: 75_000, maxRetries: 0, maxRedirects: 0 });
      const text = await response.text();
      entry.status = charge.status = response.status();
      if (review) {
        let parsed: Record<string, any> = {}; try { parsed = JSON.parse(text); } catch { /* gateway may reject non-JSON */ }
        entry.matchedCode = parsed.error?.code === "context-limit-exceeded" ? "context-limit-exceeded" : null;
        entry.responseModel = typeof parsed.model === "string" && /^jev-[\d.]+$/.test(parsed.model) ? parsed.model : null;
        const selected = parsed.answers?.draft_choice?.choice;
        entry.selectedDraft = typeof selected === "string" && /^draft_(?:[1-9]|10)$/.test(selected) ? selected : null;
        entry.selectedDraftSha256 = entry.selectedDraft ? entry.candidateReplyHashes?.[entry.selectedDraft] ?? null : null;
        entry.input = safeCount(parsed.usage?.input_tokens); entry.output = safeCount(parsed.usage?.output_tokens);
      } else {
        let usage, resolved: string | null = null, toolCalls = 0;
        for (const line of text.split("\n").filter(line => line.startsWith("data:"))) {
          try {
            const packet = JSON.parse(line.slice(5));
            resolved = packet.modelVersion ?? resolved;
            usage = packet.usageMetadata ?? usage;
            for (const candidate of packet.candidates ?? []) for (const part of candidate.content?.parts ?? []) if (part.functionCall) toolCalls++;
          } catch { /* SSE heartbeat or terminator */ }
        }
        entry.responseModel = resolved && /^[a-zA-Z0-9._-]+$/.test(resolved) ? resolved : null;
        entry.input = safeCount(usage?.promptTokenCount);
        const total = safeCount(usage?.totalTokenCount);
        entry.output = total !== null && entry.input !== null && total >= entry.input ? total - entry.input : null;
        entry.proposedTools = toolCalls;
      }
      charge.input = entry.input; charge.output = entry.output; charge.complete = true;
      if (response.ok() && charge.input !== null && charge.output !== null) {
        const amount = Math.ceil(review ? charge.input * .042 : charge.input * .25 + charge.output * 1.5);
        if (amount > charge.reserved) throw Error("provider-reported-usage-above-reservation");
        charge.charged = amount;
      }
      save(); await route.fulfill({ response });
      await response.dispose();
    };
    await context.route("**/*", route => {
      const run = intercept(route).catch(async error => {
        const reason = error instanceof Error ? error.message : "";
        denied.push(/^[a-z][a-z-]{1,80}$/.test(reason) ? reason : "network-transport-failed");
        save(); await route.abort("blockedbyclient").catch(() => {});
      });
      pending.add(run); return run.finally(() => pending.delete(run));
    });
    const study = calibratedCase("dense");
    const timestamp = Date.now() - 120_000;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const history = study.turn.conversation.map((m, i) => {
      const text = m.content.replaceAll("AMBER-42", code);
      return m.role === "user" ? { role: "user", content: text, timestamp: timestamp + i }
        : { role: "assistant", content: [{ type: "text", text }], timestamp: timestamp + i, stopReason: "stop",
          api: model.api, provider: "google", model: model.id, usage };
    });
    const iso = new Date(timestamp).toISOString(), title = "Workshop perimeter";
    const session = { id, title, model, thinkingLevel: "off", messages: history, createdAt: iso, lastModified: iso, aiGeneratedTitle: true };
    const meta = { id, title, modelProvider: model.provider, modelId: model.id, modelName: model.name, modelApi: model.api,
      thinkingLevel: "off", usage, messageCount: history.length, preview: "Workshop perimeter", createdAt: iso, lastModified: iso, aiGeneratedTitle: true };
    await page.goto(origin.origin + "/chat", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Go straight to chat" }).click();
    await page.waitForFunction(async () => (await indexedDB.databases()).some(d => d.name === "keating"));
    await page.evaluate(async ({ session, meta, reviewKey, tutorKey, reviewModel }) => {
      localStorage.setItem("keating:judgement-model", JSON.stringify({ backend: "hosted", hostedProvider: "typesafe", customModel: reviewModel }));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keating", 2);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction(["sessions", "sessions-metadata", "provider-keys"], "readwrite");
          tx.objectStore("sessions").put(session); tx.objectStore("sessions-metadata").put(meta);
          const keys = tx.objectStore("provider-keys"); keys.put(reviewKey, "typesafe-judgement"); keys.put(tutorKey, "google");
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(Error("seed-write-error"));
        }; open.onerror = () => reject(Error("seed-open-error"));
      });
    }, { session, meta, reviewKey, tutorKey, reviewModel: REVIEW_MODEL });
    await page.goto(origin.origin + "/chat?session=" + id, { waitUntil: "domcontentloaded" });
    const sentinels = page.getByText(/My workshop code is/).filter({ hasText: code });
    await sentinels.first().waitFor({ timeout: 30_000 });
    const composer = page.getByPlaceholder("Message Keating");
    await composer.waitFor();
    if (await page.getByRole("button", { name: "Dismiss persistence warning" }).isVisible()) await page.getByRole("button", { name: "Dismiss persistence warning" }).click();
    if (await page.getByRole("button", { name: "Collapse session panel" }).isVisible()) await page.getByRole("button", { name: "Collapse session panel" }).click();
    const bubbles = page.locator('.keating-bubble[data-quote-source-label="Keating\'s reply"]');
    const initial = await bubbles.count();
    receipt.seededMessageCount = history.length; receipt.beforeAssistantRows = initial;
    await composer.fill(prompt);
    submitted = true;
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const deadline = Date.now() + (live ? 300_000 : 12_000);
    const stop = page.getByRole("button", { name: "Stop generating", exact: true });
    let stored: Awaited<ReturnType<typeof browserReadback>> | undefined;
    while (Date.now() < deadline) {
      const latest = await bubbles.last().innerText({ timeout: 2_000 }).catch(() => "");
      const correct = await bubbles.count() > initial && latest.includes(code) && /\b24\b/.test(latest);
      if (correct && !receipt.firstVisibleAnswer) {
        receipt.firstVisibleAnswer = latest;
        receipt.stopVisibleAtOpening = await stop.isVisible();
        await bubbles.last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(directory, "opening.png") });
        save();
      }
      if (live && !(await stop.isVisible())) {
        stored = await page.evaluate(browserReadback, readbackInput);
        if (stored.phase === "released" && stored.assistantText && correct) break;
        if (stored.phase === "withheld" || stored.phase === "cancelled") break;
      }
      if (!live && calls.some(c => c.kind === "review")) break;
      await page.waitForTimeout(300);
    }
    await Promise.allSettled([...pending]);
    const after = await bubbles.count();
    const renderedBubble = after > initial ? await bubbles.last().innerText() : "";
    const visible = renderedBubble.slice(0, 2000);
    stored = await page.evaluate(browserReadback, readbackInput);
    const persistedText = stored.assistantText ?? "";
    const { selectedChecks, repairAttempted, repairReviewed, ...storage } = stored;
    Object.assign(receipt, { storage, selectedChecks, repairAttempted, repairReviewed });
    receipt.persistedMessageCount = stored.messageCount; receipt.afterAssistantRows = after;
    receipt.answerFromDom = visible; receipt.answerFromStorage = persistedText;
    proofHashes.persistedReplySha256 = stored.assistantTextSha256;
    // innerText includes the turn's UI controls. Only compare raw candidate text to raw persisted text.
    proofHashes.renderedBubbleSha256 = renderedBubble ? digest(renderedBubble) : null;
    const selector = calls.filter(call => call.status === 200 && call.selectedDraft === "draft_" + stored.selectedAttempt).at(-1);
    proofHashes.selectorSelectedDraftSha256 = selector?.selectedDraftSha256 ?? null;
    proofHashes.checkedPersistedReplySha256 = calls.find(call => call.status === 200 && call.reviewedReplySha256 === stored.assistantTextSha256)?.reviewedReplySha256 ?? null;
    receipt.pageStatus = (await page.locator("body").innerText()).slice(-1400);
    if (after > initial) await bubbles.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, "conversation.png") });
    save();
    let restored = "";
    if (!live || (stored.phase === "released" && persistedText)) {
      await Promise.allSettled([...caching]);
      const dispatches = charges.length;
      offline = true; submitted = false;
      await context.setOffline(true);
      await page.goto(origin.origin + "/chat?session=" + id, { waitUntil: "domcontentloaded" });
      // All scripts, fonts and the shell come from bytes captured during the original navigation.
      const restoredBubble = live ? bubbles.filter({ hasText: code }).last() : sentinels.first();
      await restoredBubble.waitFor({ timeout: 30_000 });
      await restoredBubble.scrollIntoViewIfNeeded();
      restored = await restoredBubble.innerText();
      const { selectedChecks: restoredChecks, ...restoredStorage } = await page.evaluate(browserReadback, readbackInput);
      proofHashes.offlinePersistedReplySha256 = restoredStorage.assistantTextSha256;
      if (live) proofHashes.offlineRenderedBubbleSha256 = digest(restored);
      receipt.offlineReload = { text: restored, newDispatches: charges.length - dispatches, staticAssetCount: staticFiles.size,
        stopButtonVisible: await stop.isVisible(), stored: restoredStorage,
        selectedChecksMatch: selectedChecks && restoredChecks ? JSON.stringify(selectedChecks) === JSON.stringify(restoredChecks) : null };
      await page.screenshot({ path: join(directory, "reloaded.png") });
    }
    const normal = (s: string) => s.replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
    receipt.passed = live && calls.some(c => c.status === 400 && c.matchedCode === "context-limit-exceeded") &&
      calls.some(c => c.kind === "review" && c.status === 200 && c.currentPresent && c.retainedCode) &&
      calls.some(c => c.kind === "tutor" && c.status === 200 && c.responseModel?.startsWith(TUTOR_MODEL) && c.proposedTools === 0) &&
      visible.includes(code) && /\b24\b/.test(visible) && normal(restored).includes(normal(persistedText)) && persistedText.includes(code) && /\b24\b/.test(persistedText);
    save();
    console.log(JSON.stringify({ directory, passed: receipt.passed, review: calls.filter(c => c.kind === "review").length,
      tutor: calls.filter(c => c.kind === "tutor").length, denied, accountedMicroUsd: charges.reduce((sum, e) => sum + e.charged, 0) }));
    if (live && !receipt.passed) process.exitCode = 1;
  } finally { await browser.close(); }
}
if (import.meta.main) execute().catch(e => {
  const reason = e instanceof Error ? e.message : "";
  receipt.error = reason.includes("Timeout") ? "browser-wait-timeout" : /^[a-zA-Z0-9_:-]+$/.test(reason) ? reason : "browser-or-io-error";
  if (existsSync(directory) && (!live || lock !== undefined)) save();
  console.error(JSON.stringify({ directory, error: receipt.error })); process.exitCode = 1;
}).finally(() => { if (lock !== undefined) { closeSync(lock); unlinkSync(join(out, "run.lock")); } });
