import { expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarnessEpisode, type HarnessTapeResponse, type HarnessV3Request } from "./benchmark_harness_v3.js";
import { runNativeEpisode, type NativeScenario } from "./native_episode.js";
import { assertResearchMaxThinking, assertResearchThinkingPayload, projectResearchTurn, loadResearchServices,
  validateResearchCapture, withNativeDraftReview, RESEARCH_JUDGEMENT_RETRY, type NativeResearchCapture } from "./native_draft_review.js";
import { createCliJudgementBackend } from "../../src/judgement/transport.js";
import * as judgementTransport from "../../src/judgement/transport.js";

const path = fileURLToPath(new URL("./test_native_research_services.fixture.ts", import.meta.url));
const capture = (services_config: unknown = {}): NativeResearchCapture => ({ max_attempts: 10, thinking: "max", deadline_ms: 30_000,
  services_module: { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }, services_config,
  require_shadow: true, require_extraction: true });
const tape = (responses: HarnessTapeResponse[]): HarnessV3Request["transport"] => ({ kind: "tape", responses,
  modelMetadata: { reasoning: true, thinkingLevelMap: { max: "max" } } });

test("research projection retains original system/profile facts and actual read evidence", () => {
  const turn = projectResearchTurn({ systemPrompt: "Runtime learner profile: prefers concrete examples; mastery unknown.", messages: [
    { role: "user", content: "Explain the supplied lesson", timestamp: 1 },
    { role: "toolResult", toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "ACTUAL SOURCE" }],
      isError: false, timestamp: 2 },
  ] });
  expect(turn.learnerEvidence[0]!.content).toContain("mastery unknown");
  expect(turn.sources[0]).toMatchObject({ id: "native-read:read-1:1", text: "ACTUAL SOURCE" });
  expect(turn.toolResults[0]!.content).toBe("ACTUAL SOURCE");
});

test("literal max requires model support and actual payload evidence, never a high/xhigh alias", () => {
  expect(() => assertResearchMaxThinking({ reasoning: true, thinkingLevelMap: { max: "high" } } as any)).toThrow("harness_research_max_unsupported");
  expect(() => assertResearchMaxThinking({ reasoning: true } as any)).toThrow("harness_research_max_unsupported");
  expect(() => assertResearchMaxThinking({ reasoning: true, thinkingLevelMap: { max: "max" } } as any)).not.toThrow();
  expect(assertResearchThinkingPayload("openai-completions", { reasoning_effort: "max" }).value).toBe("max");
  expect(() => assertResearchThinkingPayload("openai-completions", { reasoning_effort: "high" })).toThrow("harness_research_max_payload_missing");
  expect(() => assertResearchThinkingPayload("openai-responses", {})).toThrow("harness_research_max_payload_missing");
});

test("research CLI Jev sends only one actual request after a retryable response", async () => {
  let calls = 0, sleeps = 0;
  const backend = createCliJudgementBackend({ env: { KEATING_JUDGEMENT_ENDPOINT: "https://fixture.invalid/judgement" },
    retry: RESEARCH_JUDGEMENT_RETRY, sleep: async () => { sleeps++; },
    fetch: async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; } });
  expect(backend).not.toBeNull();
  const outcome = await backend!.call({ state: { text: "fixture" }, questions: { safe: { type: "noul", instructions: "Safe?" } } });
  expect(outcome.ok).toBe(false);
  expect(calls).toBe(1);
  expect(sleeps).toBe(0);
});

test("research binds the exact absolute judgement workspace and preserves the normal cwd default", () => {
  const observed: unknown[] = [];
  const factory = spyOn(judgementTransport, "createCliJudgementBackend").mockImplementation(options => {
    observed.push(options);
    return { key: { backend: "fixture", model: "offline-config-fixture", calibrationSha256: null },
      call: async () => { throw new Error("configuration-check-must-not-dispatch"); } };
  });
  try {
    const raw = () => { throw new Error("configuration-check-must-not-generate"); };
    const services = { reserve: async () => { throw new Error("configuration-check-must-not-reserve"); } };
    const input = { cwd: "/tmp/disposable-harness", request: { research_capture: capture() }, services, log() {} };
    expect(() => withNativeDraftReview(raw, input)).not.toThrow();
    expect(() => withNativeDraftReview(raw, { ...input, request: { research_capture: { ...capture(), judgement_workspace: "/tmp/existing-judgement-workspace" } } })).not.toThrow();
    expect(observed).toEqual([
      { cwd: "/tmp/disposable-harness", retry: RESEARCH_JUDGEMENT_RETRY },
      { cwd: "/tmp/existing-judgement-workspace", retry: RESEARCH_JUDGEMENT_RETRY },
    ]);
    expect(() => validateResearchCapture({ ...capture(), judgement_workspace: "relative-workspace" })).toThrow("harness_invalid_research_judgement_workspace");
  } finally { factory.mockRestore(); }
});

test("explicit CLI direct mode still configures locally without readiness dispatch", () => {
  let calls = 0;
  const backend = createCliJudgementBackend({ cwd: "/tmp/offline-direct-mode-fixture", loadCredential: () => null,
    env: { KEATING_JUDGEMENT_DIRECT: "1", TYPESAFE_API_KEY: "offline-fixture-not-a-credential" },
    retry: RESEARCH_JUDGEMENT_RETRY, fetch: async () => { calls++; throw new Error("must-not-dispatch"); } });
  expect(backend).not.toBeNull();
  expect(calls).toBe(0);
});

test("custom judge injection is limited to explicitly offline tape fixtures", async () => {
  await expect(loadResearchServices({ cwd: process.cwd(), request: { research_capture: capture(), transport: { kind: "provider" } },
    log() {} })).rejects.toThrow("harness_research_judge_injection_requires_tape");
});

test("actual native episode reviews thirty drafts, dispatches only selected tools, submits canonical UI and retains private capture", async () => {
  const document = { schemaVersion: 1, id: "research-question", revision: 0, lifecycle: "ready", retention: "ephemeral",
    createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", supportedSurfaces: ["terminal"],
    nodes: [{ type: "question", id: "question", kind: "choice", prompt: "Two groups of four?",
      choices: [{ id: "eight", label: "8" }, { id: "four", label: "4" }], correctAnswer: "eight" }] };
  const toolDrafts: HarnessTapeResponse[] = Array.from({ length: 10 }, (_, i) => ({ tool_calls: [{ id: `draft-tool-${i + 1}`,
    name: i === 0 ? "bash" : "feedback", arguments: i === 0 ? { command: "never execute" } : { signal: "confused", topic: `selected-topic-${i + 1}` } }] }));
  const uiDrafts = Array.from({ length: 10 }, (_, i) => ({ text: `Practice candidate ${i + 1}.\n\`\`\`keating-ui\n${JSON.stringify(document)}\n\`\`\`` }));
  const feedbackDrafts = Array.from({ length: 10 }, (_, i) => ({ text: `Feedback candidate ${i + 1}: two groups of four make eight.` }));
  const scenario: NativeScenario = { schema_version: 1, id: "research-runtime-smoke", family: "synthetic-fixture",
    source: { synthetic: true }, actor: { opening_message: "Record that I am confused, then give me a multiplication activity." },
    learner: { profile_evidence: [], assumptions: [] }, evaluation_only: {} };
  let submissions = 0;
  const result = await runNativeEpisode(scenario, tape([...toolDrafts, ...uiDrafts, ...feedbackDrafts]), {
    provenance: { kind: "authored_policy", model: "fixture-learner", revision: "1" },
    async next(observation) {
      if (submissions++) return { kind: "stop" };
      const action = observation.availableActions.find(item => item.type === "choose-option");
      expect(action).toBeDefined();
      return { kind: "ui_action", actionId: action!.actionId, payload: { optionIds: ["eight"] } };
    },
  }, { allowed_tools: ["feedback"], surface: "interactive", max_decisions: 2,
    limits: { max_provider_calls: 30, max_tool_calls: 2, turn_timeout_ms: 60_000 }, research_capture: capture() });
  const runtime = (result as any).runtime;
  expect(runtime.status).toBe("completed");
  expect(runtime.requests).toHaveLength(30);
  const logs = runtime.receipts as any[];
  expect(logs.filter(item => item.kind === "research_candidate")).toHaveLength(30);
  expect(logs.filter(item => item.kind === "research_draft_receipt").every(item => item.data.completed_candidates === 10)).toBe(true);
  expect(logs.filter(item => item.kind === "research_judgement" && item.data.phase === "checking" && item.data.request.questions.quality_progress)).toHaveLength(30);
  expect(logs.filter(item => item.kind === "tool_call")).toHaveLength(1);
  expect(logs.find(item => item.kind === "tool_call").data.arguments.topic).toBe("selected-topic-2");
  expect(runtime.steps[1].action_result.status).toBe("completed");
  expect(runtime.steps[1].action_followup).toBe("completed");
  expect(logs.filter(item => item.kind === "fixture_shadow_context")).toHaveLength(3);
  const shadows = logs.filter(item => item.kind === "research_shadow");
  expect(shadows).toHaveLength(3);
  expect(logs.filter(item => item.kind === "research_shadow_review")).toHaveLength(30);
  for (const [index, shadow] of shadows.entries()) {
    expect(shadow.data.result).toMatchObject({ schema_version: "ampersand-hindsight/v1", status: "completed",
      hindsight_only: true, learner_visible: false, tools_executed: false, provenance: { synthetic: true, actual_model_calls: 0 } });
    expect(shadow.data.result.drafts).toHaveLength(10);
    expect(shadow.data.result.original_context_sha256).toBe(logs.filter(item => item.kind === "research_decision")[index].data.context_sha256);
    expect(shadow.data.result.drafts.every((draft: any, i: number) => draft.attempt === i + 1 && draft.judgement.judgementAvailable
      && draft.proposal.model === "synthetic-shadow-fixture-v1" && draft.proposal.session_id === null
      && draft.proposal.cleanup === "not_applicable_offline_fixture")).toBe(true);
  }
  expect(logs.filter(item => item.kind === "research_capture_status").every(item => item.data.complete && item.data.training_ready === false)).toBe(true);
  expect(logs.filter(item => item.kind === "research_extraction").map(item => item.data.status)).toEqual([
    "not_applicable_tool_only", "completed", "completed",
  ]);
  expect(logs.find(item => item.kind === "research_capture_status").data).toMatchObject({ extraction_deferred: true, requires_visible_settlement: true });
  const extractions = logs.filter(item => item.kind === "research_extraction" && item.data.status === "completed");
  expect(extractions).toHaveLength(2);
  expect(logs.filter(item => item.kind === "fixture_extraction_transport")).toHaveLength(4);
  for (const entry of extractions) {
    const receipt = entry.data.result;
    expect(receipt).toMatchObject({ schemaVersion: 1, status: "abstained", proofBoundary: "native-extraction-receipt-only",
      extractedState: { learner: [], tutor: [], memoryCandidates: [], persisted: false }, provenance: { synthetic: true, actual_model_calls: 0 } });
    expect(receipt.sources.map((source: any) => source.role)).toEqual(["learner", "tutor"]);
    expect(receipt.sources.every((source: any) => source.status === "abstained" && source.source.text.trim()
      && source.model === "extraction-clairic/clairic-synthetic-fixture-v1" && source.rawRequest && source.rawResponse.complete)).toBe(true);
    for (const [source, hash] of Object.entries(receipt.contract.sourceHashes)) {
      expect(hash).toBe(createHash("sha256").update(readFileSync(new URL(`../../${source}`, import.meta.url))).digest("hex"));
    }
  }
  const publicMessages = JSON.stringify(runtime.steps.flatMap((step: any) => step.messages));
  expect(publicMessages).not.toContain("PRIVATE_SHADOW_ANSWER");
  expect(publicMessages).not.toContain("SHADOW_MUTATION_MUST_STAY_PRIVATE");
  expect(runtime.private_capture.content).toContain("PRIVATE_SHADOW_ANSWER");
  expect(runtime.private_capture.sha256).toBe(createHash("sha256").update(runtime.private_capture.content).digest("hex"));
  expect(runtime.source_provenance.external_sources[path]).toBe(capture().services_module.sha256);
  expect(runtime.source_provenance.unchanged_at_end).toBe(true);
  expect(runtime.source_provenance.changed_paths).toEqual([]);
  if (process.env.KEATING_NATIVE_RESEARCH_SMOKE_ARTIFACT) {
    writeFileSync(process.env.KEATING_NATIVE_RESEARCH_SMOKE_ARTIFACT, JSON.stringify({ ...result,
      fixture_provenance: { synthetic: true, kind: "real_rpc_structural_fixture", actual_model_calls: 0,
        observed_at_eastern: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", dateStyle: "full", timeStyle: "long" }).format(new Date()),
        claim: "Native RPC and structural capture only; no live Jev, Clairic, Ampersand, max reasoning or browser parity evidence." },
    }), { mode: 0o600, flag: "wx" });
  }
}, 120_000);

test("real harness blocks missing max support before any generation or reservation", async () => {
  const result = await runHarnessEpisode({ id: "research-missing-max", transport: { kind: "tape", responses: [{ text: "Never delivered" }] },
    research_capture: capture(), steps: [{ kind: "message", text: "Explain multiplication." }], limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("failed");
  expect(result.error_code).toBe("harness_research_max_unsupported");
  expect(result.requests).toHaveLength(0);
  expect(result.receipts.some((item: any) => item.kind === "fixture_reservation")).toBe(false);
}, 60_000);

test("real harness withholds drafts whose Jev judgement is unavailable", async () => {
  const result = await runHarnessEpisode({ id: "research-missing-jev", transport: tape(Array.from({ length: 10 }, (_, i) => ({ text: `Private candidate ${i}.` }))),
    research_capture: capture({ missingJudge: true }), steps: [{ kind: "message", text: "Explain multiplication." }], limits: { turn_timeout_ms: 30_000 } });
  expect(result.status).toBe("failed");
  expect(result.error_code).toBe("harness_research_judgement_unavailable");
  expect(JSON.stringify(result.steps.flatMap(step => step.messages))).not.toContain("Private candidate");
  expect(result.private_capture?.content).toContain("backend-unavailable");
}, 60_000);

test("real harness rejects locally missing Jev before every provider call or reservation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "keating-empty-judgement-fixture-"));
  try {
    const result = await runHarnessEpisode({ id: "research-unconfigured-jev", transport: tape([{ text: "Never generated" }]),
      research_capture: { ...capture({ unconfiguredJudge: true }), judgement_workspace: workspace },
      steps: [{ kind: "message", text: "Explain multiplication." }], limits: { turn_timeout_ms: 20_000 } });
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("harness_research_judgement_unavailable");
    expect(result.requests).toHaveLength(0);
    expect(result.receipts.some((item: any) => ["fixture_reservation", "research_generation", "research_candidate", "fixture_shadow_context"].includes(item.kind))).toBe(false);
    expect(result.source_provenance.unchanged_at_end).toBe(true);
  } finally { await rm(workspace, { recursive: true, force: true }); }
}, 60_000);

test("real harness never generates when the required private budget reservation is denied", async () => {
  const result = await runHarnessEpisode({ id: "research-budget-denied", transport: tape([{ text: "Never generated" }]),
    research_capture: capture({ denyBudget: true }), steps: [{ kind: "message", text: "Explain multiplication." }], limits: { turn_timeout_ms: 30_000 } });
  expect(result.status).toBe("failed");
  expect(result.requests).toHaveLength(0);
  expect(result.receipts.some((item: any) => item.kind === "research_candidate")).toBe(false);
  expect(result.receipts.some((item: any) => item.kind === "research_capture_status" && !item.data.complete)).toBe(true);
}, 60_000);

test("required shadow failure blocks selected tools and stops before a later native provider decision", async () => {
  const result = await runHarnessEpisode({ id: "research-shadow-failed", transport: tape([
    ...Array.from({ length: 10 }, (_, i) => ({ tool_calls: [{ id: `private-read-${i}`, name: "read", arguments: { path: "fixtures/blocked.txt" } }] })),
    ...Array.from({ length: 10 }, () => ({ text: "Later candidate must never be generated." })),
  ]), seed_files: { "fixtures/blocked.txt": "Must not be read by a selected action." },
    research_capture: capture({ failedShadow: true }), steps: [{ kind: "message", text: "Read the supplied fixture." }], limits: { turn_timeout_ms: 30_000 } });
  expect(result.error_code).toBe("harness_research_required_shadow_unavailable");
  expect(result.status).toBe("failed");
  expect(result.requests).toHaveLength(10);
  expect(result.receipts.filter((item: any) => item.kind === "research_decision")).toHaveLength(1);
  expect(result.receipts.filter((item: any) => item.kind === "research_selected")).toHaveLength(0);
  expect(result.steps[0]!.messages.filter((message: any) => message.role === "toolResult")).toHaveLength(0);
  expect(result.steps[0]!.messages.some((message: any) => message.role === "assistant"
    && message.content?.some((part: any) => part.type === "toolCall"))).toBe(false);
  expect(result.receipts.filter((item: any) => item.kind === "research_capture_status")).toMatchObject([
    { data: { training_ready: false, complete: false, shadow: "failed", required_shadow: true } },
  ]);
  expect(result.receipts.filter((item: any) => item.kind === "research_shadow_cleanup")).toMatchObject([
    { data: { status: "settled", task_outcome: "rejected" } },
  ]);
}, 60_000);
