import { expect, test, spyOn } from "bun:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as piRuntime from "../../src/runtime/pi.js";
import * as provenance from "./benchmark_harness_v3_provenance.js";
import { RpcUiActionDispatcher } from "../../src/tui/ui/rpc-action-transport.js";
import { withNativeDraftReview, RESEARCH_SHADOW_CLEANUP_GRACE_MS, type NativeResearchCapture,
  type ResearchServices } from "./native_draft_review.js";
import { cancelResearchRpcTurn, harnessTurnTimeout, runHarnessEpisode, RESEARCH_RPC_STARTUP_MARGIN_MS,
  type HarnessV3Step } from "./benchmark_harness_v3.js";
import { createResearchServices } from "./test_native_research_services.fixture.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const unavailable = () => ({ ok: false as const, error: { code: "backend-unavailable" as const, retryable: false } });
const capture = (deadline_ms = 80_000): NativeResearchCapture => ({ max_attempts: 1, thinking: "max", deadline_ms,
  services_module: { path: "/offline/cleanup-fixture.ts", sha256: "a".repeat(64) }, require_shadow: true, require_extraction: false });
const model: any = { id: "offline-cleanup-fixture", api: "openai-completions", provider: "fixture",
  reasoning: true, thinkingLevelMap: { max: "max" }, maxTokens: 128 };
const context = { systemPrompt: "Offline cleanup ordering fixture", messages: [{ role: "user" as const, content: "Explain the idea.", timestamp: 1 }] };

function fixture(mode: "early-failure" | "abort") {
  const started = deferred(), cleaning = deferred(), release = deferred(), cleaned = deferred();
  const events: string[] = [], logs: Array<{ kind: string; data: any }> = [];
  let generated = 0;
  const services: ResearchServices = {
    reserve: async () => {},
    judge: async (_request, signal) => {
      await started.promise;
      if (mode === "early-failure" || signal?.aborted) return unavailable();
      return new Promise(resolve => signal!.addEventListener("abort", () => resolve(unavailable()), { once: true }));
    },
    async shadow(_context, signal) {
      try {
        await new Promise<never>((_resolve, reject) => {
          const cancelled = () => { events.push("shadow_aborted"); reject(new Error("shadow_fixture_aborted")); };
          signal.addEventListener("abort", cancelled, { once: true });
          started.resolve();
          if (signal.aborted) cancelled();
        });
      } finally {
        events.push("cleanup_started"); cleaning.resolve();
        await release.promise;
        events.push("cleanup_finished"); cleaned.resolve();
      }
    },
  };
  const caller = new AbortController();
  const wrapped = withNativeDraftReview(() => { generated++; throw new Error("must-not-generate"); }, {
    cwd: "/offline", request: { research_capture: capture(), transport: { kind: "tape" } }, services,
    log(kind, data) { logs.push({ kind, data }); },
  });
  const result = wrapped(model, context, { signal: caller.signal }).result().then(message => {
    events.push("stream_end"); return message;
  });
  return { started, cleaning, release, cleaned, events, logs, result, caller, generated: () => generated };
}

test("early tutor failure cancels shadow and joins its real finally before ending the stream", async () => {
  const f = fixture("early-failure");
  await f.cleaning.promise;
  expect(f.events).toEqual(["shadow_aborted", "cleanup_started"]);
  expect(f.generated()).toBe(0);
  f.release.resolve();
  const message = await f.result;
  expect(message.stopReason).toBe("error");
  expect(f.events).toEqual(["shadow_aborted", "cleanup_started", "cleanup_finished", "stream_end"]);
  expect(f.logs.find(row => row.kind === "research_shadow_cleanup")?.data).toMatchObject({
    status: "settled", task_outcome: "rejected", grace_ms: 30_000, requires_reconciliation: false,
    remote_cleanup_verified_by_interceptor: false,
  });
});

test("caller abort keeps the stream open until independent shadow cleanup settles", async () => {
  const f = fixture("abort");
  await f.started.promise;
  f.caller.abort();
  await f.cleaning.promise;
  expect(f.events).not.toContain("stream_end");
  f.release.resolve();
  await f.result;
  expect(f.events.indexOf("cleanup_finished")).toBeLessThan(f.events.indexOf("stream_end"));
  expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data.complete).toBe(false);
});

test("whole-decision deadline also joins actual cleanup, with the same bounded grace", async () => {
  const original = globalThis.setTimeout;
  let expireDecision: (() => void) | undefined;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 80_000 && !expireDecision) expireDecision = () => (handler as () => void)();
    return original(handler, delay, ...args);
  });
  try {
    const f = fixture("abort");
    await f.started.promise;
    expect(expireDecision).toBeFunction();
    expireDecision!();
    await f.cleaning.promise;
    expect(f.events).not.toContain("stream_end");
    f.release.resolve();
    await f.result;
    expect(f.events.at(-2)).toBe("cleanup_finished");
    expect(f.events.at(-1)).toBe("stream_end");
  } finally { timer.mockRestore(); }
});

test("exhausted cleanup grace fails explicitly and a late task cannot reopen capture", async () => {
  const original = globalThis.setTimeout;
  const graceInstalled = deferred<() => void>();
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === RESEARCH_SHADOW_CLEANUP_GRACE_MS) graceInstalled.resolve(() => (handler as () => void)());
    return original(handler, delay, ...args);
  });
  try {
    const f = fixture("early-failure");
    await f.cleaning.promise;
    const expireCleanup = await graceInstalled.promise;
    expect(f.events).not.toContain("stream_end");
    expireCleanup();
    const message = await f.result;
    expect(message.errorMessage).toBe("harness_research_shadow_cleanup_timeout");
    expect(f.events).not.toContain("cleanup_finished");
    expect(f.logs.find(row => row.kind === "research_shadow_cleanup")?.data).toMatchObject({
      status: "timeout", task_outcome: "pending", requires_reconciliation: true, grace_ms: 30_000,
    });
    expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data).toMatchObject({
      complete: false, shadow: "cleanup_timeout", shadow_cleanup: "timeout", requires_reconciliation: true,
    });
    const logCount = f.logs.length;
    f.release.resolve();
    await f.cleaned.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.logs).toHaveLength(logCount);
    expect(f.events.filter(value => value === "stream_end")).toHaveLength(1);
  } finally { timer.mockRestore(); }
});

test("a service-reported unconfirmed DELETE stays explicitly unreconciled", async () => {
  const f = fixture("early-failure");
  await f.cleaning.promise;
  f.release.reject(new Error("shadow_cleanup_unconfirmed"));
  await f.result;
  expect(f.logs.find(row => row.kind === "research_shadow_cleanup")?.data).toMatchObject({
    status: "settled", task_outcome: "rejected", task_error_code: "shadow_cleanup_unconfirmed", requires_reconciliation: true,
  });
  expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data.complete).toBe(false);
});

test("normal research completion retains the selected answer after shadow settlement", async () => {
  const logs: Array<{ kind: string; data: any }> = [];
  const judge = createResearchServices({ cwd: "/offline", request: { research_capture: capture() }, log() {} }).judge!;
  const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "Two groups of four make eight." }],
    api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const wrapped = withNativeDraftReview(() => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message }); stream.end(message); return stream;
  }, { cwd: "/offline", request: { research_capture: capture(), transport: { kind: "tape" } },
    services: { reserve: async () => {}, judge, shadow: async () => ({ status: "completed", synthetic: true }) },
    log(kind, data) { logs.push({ kind, data }); } });
  const result = await wrapped(model, context).result();
  expect(result.errorMessage).toBeUndefined();
  expect(result.stopReason).toBe("stop");
  expect(result.content).toEqual(message.content);
  expect(logs.find(row => row.kind === "research_shadow_cleanup")?.data).toMatchObject({ status: "settled", task_outcome: "fulfilled" });
  expect(logs.find(row => row.kind === "research_capture_status")?.data.complete).toBe(true);
});

test("parent turn limits stay exact; cancellation has a separate bounded 30s plus 10s allowance", () => {
  expect(RESEARCH_SHADOW_CLEANUP_GRACE_MS).toBe(30_000);
  expect(RESEARCH_RPC_STARTUP_MARGIN_MS).toBe(10_000);
  expect(harnessTurnTimeout({})).toBe(60_000);
  expect(harnessTurnTimeout({ limits: { turn_timeout_ms: 600_000 } })).toBe(600_000);
  expect(harnessTurnTimeout({ research_capture: capture(3_600_000), limits: { turn_timeout_ms: 3_600_000 } })).toBe(3_600_000);
  expect(harnessTurnTimeout({ research_capture: capture(3_600_000), limits: { turn_timeout_ms: 20_000 } })).toBe(20_000);
});

test("parent cancellation reaches a later provider invocation and awaits its raw cleanup before stop", async () => {
  const judge = createResearchServices({ cwd: "/offline", request: { research_capture: capture() }, log() {} }).judge!;
  const secondStarted = deferred(), cleaning = deferred(), release = deferred();
  const caller = new AbortController(), events: string[] = [];
  let invocations = 0;
  const wrapped = withNativeDraftReview(() => {
    const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "The next step is ready." }],
      api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message }); stream.end(message); return stream;
  }, { cwd: "/offline", request: { research_capture: capture(), transport: { kind: "tape" } }, log() {},
    services: { reserve: async () => {}, judge, async shadow(_context, signal) {
      if (++invocations === 1) return { status: "completed", synthetic: true };
      try {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("shadow_fixture_aborted")), { once: true });
          secondStarted.resolve();
        });
      } finally { events.push("cleanup_started"); cleaning.resolve(); await release.promise; events.push("cleanup_finished"); }
    } } });
  expect((await wrapped(model, context).result()).stopReason).toBe("stop");
  const second = wrapped(model, context, { signal: caller.signal }).result();
  await secondStarted.promise;
  let listener: ((event: unknown) => void) | undefined;
  const cancelled = cancelResearchRpcTurn({
    onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
    async abort() { events.push("rpc_abort"); caller.abort(); await second; events.push("rpc_abort_ack"); },
  }).then(receipt => { events.push("parent_settled"); return receipt; });
  await cleaning.promise;
  listener?.({ type: "agent_end" }); // A per-loop event is not confirmation of idle.
  expect(events).not.toContain("parent_settled");
  release.resolve();
  expect(await cancelled).toMatchObject({ status: "settled", settlement_evidence: "abort_ack", wait_ms: 40_000 });
  events.push("client_stop");
  expect(invocations).toBe(2);
  expect(events).toEqual(["rpc_abort", "cleanup_started", "cleanup_finished", "rpc_abort_ack", "parent_settled", "client_stop"]);
});

test("parent cleanup timeout is explicit when real abort never acknowledges idle", async () => {
  const original = globalThis.setTimeout, installed = deferred<() => void>();
  const timer = spyOn(globalThis, "setTimeout").mockImplementation((handler, delay, ...args) => {
    if (delay === 40_000) installed.resolve(() => (handler as () => void)());
    return original(handler, delay, ...args);
  });
  let aborts = 0, unsubscribed = false;
  try {
    const result = cancelResearchRpcTurn({ onEvent() { return () => { unsubscribed = true; }; },
      abort() { aborts++; return new Promise<void>(() => {}); } });
    const expire = await installed.promise;
    await Promise.resolve();
    expect(aborts).toBe(1);
    expire();
    expect(await result).toMatchObject({ status: "timeout", settlement_evidence: null,
      abort_requested: true, wait_ms: 40_000, requires_reconciliation: true });
    expect(unsubscribed).toBe(true);
  } finally { timer.mockRestore(); }
});

test("a timed-out abort RPC still waits for the actual agent_settled event", async () => {
  let listener: ((event: unknown) => void) | undefined;
  const failed = deferred();
  const result = cancelResearchRpcTurn({ onEvent(fn) { listener = fn; return () => { listener = undefined; }; },
    async abort() { failed.resolve(); throw new Error("Timeout waiting for response to abort"); } });
  await failed.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  listener?.({ type: "agent_settled" });
  expect(await result).toMatchObject({ status: "settled", settlement_evidence: "agent_settled",
    abort_request_failed: true, requires_reconciliation: false });
});

test("message and UI parent timeouts persist cleanup receipts before stopping the RPC dependency double", async () => {
  const modulePath = fileURLToPath(new URL("./test_native_research_services.fixture.ts", import.meta.url));
  const document = { schemaVersion: 1, id: "cleanup-ui", revision: 1, lifecycle: "ready", supportedSurfaces: ["terminal"],
    createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z",
    nodes: [{ type: "question", id: "q", kind: "text", prompt: "Enter a tag." }] };
  const steps: HarnessV3Step[] = [{ kind: "message", text: "Offline timeout fixture" },
    { kind: "ui_action", sourceDocument: document as any, action: { schemaVersion: 1, type: "submit-answer",
      documentId: document.id, documentRevision: 1, nodeId: "q", answer: "tag", idempotencyKey: "cleanup-ui-submit" } }];
  for (const step of steps) {
    const events: string[] = [];
    const captureSources = spyOn(provenance, "captureHarnessSources").mockResolvedValue({ hashes: { "SYSTEM.md": "a".repeat(64) },
      readonly_resources: [], external_sources: [], unresolved_optional_imports: [], scope: "offline-dependency-double" } as any);
    const changedSources = spyOn(provenance, "changedHarnessSources").mockResolvedValue([]);
    const dispatch = spyOn(RpcUiActionDispatcher.prototype, "dispatch").mockResolvedValue({ status: "completed" } as any);
    const launch = spyOn(piRuntime, "launchRpcClient").mockImplementation(async cwd => ({
      getStderr() { return ""; }, onEvent() { return () => {}; },
      async prompt() { writeFileSync(join(cwd, ".keating/benchmark-harness/events.jsonl"),
        `${JSON.stringify({ kind: "session_start", data: { synthetic: true } })}\n${JSON.stringify({ kind: "resources_verified", data: { synthetic: true } })}\n`); },
      async promptAndWait(_text: string, _images: unknown, timeout: number) {
        expect(timeout).toBe(2); throw new Error("Timeout collecting events: offline dependency double");
      },
      async setAutoRetry() {}, async setAutoCompaction() {}, async getMessages() { return []; }, async getState() { return {}; },
      async abort() { events.push("abort"); await new Promise<void>(resolve => setImmediate(resolve)); events.push("cleanup_idle_ack"); },
      async stop() { events.push("stop"); },
    } as any));
    try {
      const result = await runHarnessEpisode({ id: `cleanup-${step.kind}-dependency-double`, transport: { kind: "tape", responses: [] },
        steps: [step], limits: { turn_timeout_ms: 2 }, research_capture: { ...capture(),
          services_module: { path: modulePath, sha256: createHash("sha256").update(readFileSync(modulePath)).digest("hex") } } });
      expect(result.error_code).toBe("harness_timeout");
      expect(events).toEqual(["abort", "cleanup_idle_ack", "stop"]);
      expect(result.steps[0]?.events).toContainEqual({ type: "research_rpc_cleanup", status: "settled", abort_requested: true,
        settlement_evidence: "abort_ack", abort_request_failed: false, wait_ms: 40_000, requires_reconciliation: false });
      expect(result.receipts.find((r: any) => r.kind === "research_rpc_cleanup")).toMatchObject({
        data: { step: 0, status: "settled", abort_requested: true, wait_ms: 40_000, requires_reconciliation: false },
      });
      expect(result.private_capture?.content).toContain('"kind":"research_rpc_cleanup"');
    } finally { launch.mockRestore(); dispatch.mockRestore(); changedSources.mockRestore(); captureSources.mockRestore(); }
  }
});
