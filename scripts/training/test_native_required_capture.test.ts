/** Actual Pi Agent tool loop, injected deterministic generation/judgements; no provider or filesystem tool effects. */
import { expect, test } from "bun:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { withNativeDraftReview, type NativeResearchCapture, type ResearchServices } from "./native_draft_review.js";
import { createResearchServices } from "./test_native_research_services.fixture.js";

type Options = { shadow?: "failed" | "partial" | "absent" | "pending"; extraction?: "failed" | "partial" | "absent" | "abstained";
  output?: "tool" | "mixed" | "visible" | "tool_then_visible"; requireShadow?: boolean; requireExtraction?: boolean };
function fixture(options: Options = {}) {
  const config: NativeResearchCapture = { max_attempts: 10, thinking: "max", deadline_ms: 30_000,
    services_module: { path: "/offline/required-capture.ts", sha256: "a".repeat(64) },
    require_shadow: options.requireShadow ?? true, require_extraction: options.requireExtraction ?? true };
  const judge = createResearchServices({ cwd: "/offline", request: { research_capture: config }, log() {} }).judge!;
  const logs: Array<{ kind: string; data: any }> = [];
  let decisions = 0, generated = 0, executed = 0, extractions = 0, cleanupStarted = 0, cleanupFinished = 0;
  const services: ResearchServices = { reserve: async () => {}, judge };
  if (options.shadow !== "absent") services.shadow = async (_context, signal) => {
    if (options.shadow === "failed") throw new Error("shadow_no_candidate_failed");
    if (options.shadow === "partial") return { status: "partial", synthetic: true, complete_drafts: 3 };
    if (options.shadow === "pending") {
      try {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("shadow_fixture_aborted")), { once: true });
          if (signal.aborted) reject(new Error("shadow_fixture_aborted"));
        });
      } finally { cleanupStarted++; await Promise.resolve(); cleanupFinished++; }
    }
    return { status: "completed", synthetic: true };
  };
  if (options.extraction !== "absent") services.extract = async () => {
    extractions++;
    if (options.extraction === "failed") throw new Error("synthetic extraction failure");
    return { status: options.extraction ?? "completed", synthetic: true };
  };
  const model: any = { id: "required-capture-fixture", provider: "fixture", api: "openai-completions",
    reasoning: true, thinkingLevelMap: { max: "max" }, maxTokens: 128, contextWindow: 8192 };
  const wrapped = withNativeDraftReview(() => {
    generated++;
    if (decisions > 2) throw new Error("finite fixture decision bound");
    const kind = options.output === "tool_then_visible" ? decisions === 1 ? "tool" : "visible" : options.output ?? "mixed";
    const content: AssistantMessage["content"] = [
      ...(kind !== "tool" ? [{ type: "text" as const, text: "The supplied note is ready." }] : []),
      ...(kind !== "visible" ? [{ type: "toolCall" as const, id: `read-${generated}`, name: "read", arguments: { path: "fixture.txt" } }] : []),
    ];
    const message: AssistantMessage = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
      stopReason: kind === "visible" ? "stop" : "toolUse", timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(message);
    return stream;
  }, { cwd: "/offline", request: { research_capture: config, transport: { kind: "tape" } }, services,
    log(kind, data) { logs.push({ kind, data }); if (kind === "research_decision") decisions++; } });
  const agent = new Agent({ initialState: { systemPrompt: "Offline required capture protocol fixture.", model, tools: [{
    name: "read", label: "Read", description: "Read the supplied synthetic fixture.", parameters: Type.Object({ path: Type.String() }),
    async execute() { executed++; return { content: [{ type: "text" as const, text: "Synthetic tool result." }], details: { synthetic: true } }; },
  }] }, streamFn: wrapped as any, getApiKey: () => undefined });
  return { agent, logs, run: () => agent.prompt("Read the supplied fixture and explain it."),
    counts: () => ({ decisions, generated, executed, extractions, cleanupStarted, cleanupFinished }) };
}

function assertBlocked(f: ReturnType<typeof fixture>, error: string) {
  expect(f.counts()).toMatchObject({ decisions: 1, generated: 10, executed: 0 });
  expect(f.logs.filter(row => row.kind === "research_selected")).toHaveLength(0);
  expect(f.agent.state.messages.filter((m: any) => m.role === "toolResult")).toHaveLength(0);
  const assistants = f.agent.state.messages.filter((m: any) => m.role === "assistant") as AssistantMessage[];
  expect(assistants).toHaveLength(1);
  expect(assistants[0]).toMatchObject({ content: [], stopReason: "error", errorMessage: error });
  expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data).toMatchObject({
    training_ready: false, complete: false, reason: error,
  });
}

for (const shadow of ["failed", "partial", "absent"] as const) {
  test(`required ${shadow} shadow blocks tool-only selected output and Pi never executes or advances`, async () => {
    const f = fixture({ shadow, output: "tool" });
    await f.run();
    assertBlocked(f, "harness_research_required_shadow_unavailable");
    expect(f.counts().extractions).toBe(0);
    expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data.required_shadow).toBe(true);
  });
}

for (const extraction of ["failed", "partial", "absent"] as const) {
  test(`required visible ${extraction} extraction blocks both text and proposed tools`, async () => {
    const f = fixture({ extraction, output: "mixed" });
    await f.run();
    assertBlocked(f, "harness_research_required_extraction_unavailable");
    expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data).toMatchObject({
      required_extraction: true, extraction_deferred: false,
    });
  });
}

test("required visible extraction failure cancels and joins still-running shadow cleanup before Pi settles", async () => {
  const f = fixture({ extraction: "failed", shadow: "pending", output: "mixed" });
  await f.run();
  assertBlocked(f, "harness_research_required_extraction_unavailable");
  expect(f.counts()).toMatchObject({ cleanupStarted: 1, cleanupFinished: 1 });
  expect(f.logs.find(row => row.kind === "research_shadow_cleanup")?.data).toMatchObject({ status: "settled", task_outcome: "rejected" });
});

test("tool-only capture defers extraction; the next visible decision settles it without losing the ten-draft gates", async () => {
  const f = fixture({ output: "tool_then_visible" });
  await f.run();
  expect(f.counts()).toMatchObject({ decisions: 2, generated: 20, executed: 1, extractions: 1 });
  expect(f.logs.filter(row => row.kind === "research_selected")).toHaveLength(2);
  const statuses = f.logs.filter(row => row.kind === "research_capture_status").map(row => row.data);
  expect(statuses).toHaveLength(2);
  expect(statuses[0]).toMatchObject({ complete: true, extraction: "not_applicable_tool_only",
    extraction_deferred: true, requires_visible_settlement: true });
  expect(statuses[1]).toMatchObject({ complete: true, extraction: "completed",
    extraction_deferred: false, requires_visible_settlement: false });
});

test("completed visible capture and explicit completed abstention still release exactly once", async () => {
  for (const extraction of [undefined, "abstained"] as const) {
    const f = fixture({ output: "visible", extraction });
    await f.run();
    expect(f.counts()).toMatchObject({ decisions: 1, generated: 10, executed: 0, extractions: 1 });
    expect(f.logs.filter(row => row.kind === "research_selected")).toHaveLength(1);
    expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data.complete).toBe(true);
  }
});

test("optional failed evidence is reported honestly without changing the opt-out release policy", async () => {
  const f = fixture({ output: "visible", shadow: "failed", extraction: "failed", requireShadow: false, requireExtraction: false });
  await f.run();
  expect(f.counts()).toMatchObject({ decisions: 1, generated: 10, executed: 0 });
  expect(f.logs.filter(row => row.kind === "research_selected")).toHaveLength(1);
  expect(f.logs.filter(row => row.kind === "research_capture_status").at(-1)?.data).toMatchObject({
    shadow: "failed", extraction: "failed", required_shadow: false, required_extraction: false,
  });
});
