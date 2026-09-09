import { expect, test } from "bun:test";
import { runHarnessEpisode, validateHarnessRequest, type HarnessV3Request } from "./benchmark_harness_v3.js";
import { OPENUI_JSON_PARITY_FIXTURE, type UiAction } from "../../src/tui/learner-contracts.js";
import { limitHarnessPayload } from "./benchmark_harness_v3_limits.js";
import { localizeHarnessDependency } from "./benchmark_harness_v3_provenance.js";

test("actual Pi RPC executes feedback, continues, persists and restores the same session", async () => {
  const result = await runHarnessEpisode({
    id: "offline-persistence-proof", transport: { kind: "tape", responses: [
      { tool_calls: [{ id: "feedback-1", name: "feedback", arguments: { signal: "confused", topic: "closures" } }] },
      { text: "Here is a worked counter example." },
      { tool_calls: [{ id: "state-1", name: "learner_state", arguments: {} }] },
      { text: "The prior confusion is still recorded; let us use a new example." },
    ] }, steps: [{ kind: "message", text: "I am confused about closures. Record that and show a worked example." },
      { kind: "reopen" }, { kind: "message", text: "Read my saved learner state and continue." }],
    limits: { turn_timeout_ms: 20_000 },
  });
  expect(result.status).toBe("completed");
  expect(result.measurement).toBe("offline_integration");
  expect(result.configuration.allowed_tools).not.toContain("quiz");
  expect((result.receipts.find((receipt: any) => receipt.kind === "session_start") as any).data.active_tools).not.toContain("quiz");
  expect(result.requests).toHaveLength(4);
  expect(result.steps).toHaveLength(3);
  expect(result.steps[0]!.messages.some((message: any) => message.role === "toolResult" && message.toolName === "feedback" && !message.isError)).toBe(true);
  const learner = JSON.parse(result.files.find((file) => file.path === ".keating/state/learner.json")!.content);
  expect(learner.feedback).toHaveLength(1);
  expect(learner.feedback[0].topic).toBe("closures");
  expect(result.steps[1]!.state.sessionId).toBe(result.steps[0]!.state.sessionId);
  expect(result.session_files).toHaveLength(1);
  expect(JSON.stringify(result.requests[1])).toContain('Recorded confused feedback');
  const stateResult: any = result.steps[2]!.messages.find((message: any) => message.role === "toolResult" && message.toolName === "learner_state");
  expect(stateResult.content[0].text).toContain('"signal":"confused"');
  expect(JSON.stringify(result.requests[0])).toContain('Keating');
  expect(JSON.stringify(result.requests[0])).not.toContain('Read my saved learner state and continue.');
  expect(JSON.stringify(result.requests[2])).toContain('Read my saved learner state and continue.');
  expect(result.source_hashes["dist/src/pi/hyper-teacher/tools/feedback.js"]).toMatch(/^[a-f0-9]{64}$/);
  expect(result.source_hashes["dist/src/core/learner-state.js"]).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.keys(result.source_hashes).some((path) => path.startsWith("pi/skills/"))).toBe(true);
  expect(result.source_provenance.unchanged_at_end).toBe(true);
  expect((result.receipts.find((receipt: any) => receipt.kind === "resources_verified") as any).data.context_files).toEqual([]);
  expect(result.steps[2]!.message_start_index).toBe(result.steps[1]!.messages.length);
}, 90_000);

test("tape exhaustion is unavailable evidence and never invokes a fallback provider", async () => {
  const result = await runHarnessEpisode({ id: "empty-tape", transport: { kind: "tape", responses: [] },
    steps: [{ kind: "message", text: "Explain a closure." }], limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("failed");
  expect(result.error_code).toBe("harness_tape_exhausted");
  expect(result.requests).toHaveLength(1);
}, 60_000);

test("learner inputs cannot invoke unguarded slash commands or plant an extension", () => {
  const base: HarnessV3Request = { id: "invalid", transport: { kind: "tape", responses: [] }, steps: [{ kind: "message", text: "Hello" }] };
  expect(() => validateHarnessRequest({ ...base, steps: [{ kind: "message", text: "/auto-improve" }] })).toThrow("harness_invalid_learner_message");
  expect(() => validateHarnessRequest({ ...base, seed_files: { ".pi/extensions/unsafe.ts": "" } })).toThrow("harness_invalid_seed_path");
  expect(() => validateHarnessRequest({ ...base, seed_files: { "fixtures/../secret": "" } })).toThrow("harness_invalid_seed_path");
  expect(() => validateHarnessRequest({ ...base, allowed_tools: ["bash"] })).toThrow("harness_unsupported_tool_profile");
});

test("real goal handlers survive a new session and the provider sees the persisted result", async () => {
  const result = await runHarnessEpisode({ id: "goal-next-session", transport: { kind: "tape", responses: [
    { tool_calls: [{ id: "goal-1", name: "set_learner_goal", arguments: { title: "Accessible recipe page",
      steps: [{ title: "Test keyboard navigation", kind: "practice" }] } }] },
    { text: "The goal is saved; the keyboard test still needs evidence." },
    { tool_calls: [{ id: "goals-2", name: "list_learner_goals", arguments: {} }] },
    { text: "Your recipe goal has one unfinished step." },
  ] }, steps: [{ kind: "message", text: "Save my goal: make an accessible recipe page." },
    { kind: "new_session" }, { kind: "message", text: "What goal have I saved?" }], limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  expect(result.steps[1]!.state.sessionId).not.toBe(result.steps[0]!.state.sessionId);
  expect(result.session_files).toHaveLength(2);
  const state = JSON.parse(result.files.find((file) => file.path === ".keating/state/goals.json")!.content);
  expect(JSON.stringify(state)).toContain("Accessible recipe page");
  expect(JSON.stringify(result.requests[3])).toContain("Accessible recipe page");
  expect(result.steps[2]!.messages.filter((message: any) => message.role === "user")).toHaveLength(1);
}, 90_000);

test("canonical terminal actions use the production receiver and replay one persisted receipt", async () => {
  const sourceDocument = structuredClone(OPENUI_JSON_PARITY_FIXTURE);
  const action: UiAction = { schemaVersion: 1, type: "update-notes", documentId: sourceDocument.id,
    documentRevision: sourceDocument.revision, nodeId: "notes", value: "An interpretation, not a durable profile claim.", idempotencyKey: "notes-once" };
  const result = await runHarnessEpisode({ id: "terminal-action-replay", transport: { kind: "tape", responses: [{ text: "The session is ready." }] },
    steps: [{ kind: "message", text: "Let us edit the notes fixture." },
      { kind: "ui_action", sourceDocument, action }, { kind: "reopen" }, { kind: "ui_action", sourceDocument, action }],
    limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  expect(result.requests).toHaveLength(1); // The terminal action receiver does not fabricate a tutor continuation.
  const first: any = result.steps[1]!.action_result;
  expect(first.status).toBe("completed");
  expect(result.steps[3]!.action_result).toEqual(first);
  const journal = result.files.find((file) => file.path.includes("tui-ui-receiver-actions") && file.path.endsWith(".json"));
  expect(journal).toBeDefined();
  expect(JSON.parse(journal!.content).receipts).toHaveLength(1);
  expect(first.resultingDocument.nodes.find((node: any) => node.id === "notes").value).toBe(action.value);
}, 90_000);

test("tool containment returns a real error and the model can continue after it", async () => {
  const result = await runHarnessEpisode({ id: "read-containment", transport: { kind: "tape", responses: [
    { tool_calls: [{ id: "read-outside", name: "read", arguments: { path: "/etc/passwd" } }] },
    { text: "That file is outside this lesson workspace." },
  ] }, steps: [{ kind: "message", text: "Read the outside fixture, then explain whether it worked." }], limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  const tool: any = result.steps[0]!.messages.find((message: any) => message.role === "toolResult");
  expect(tool.isError).toBe(true);
  expect(JSON.stringify(tool)).toContain("harness_read_outside_allowed_workspace");
  expect(JSON.stringify(tool)).not.toContain("root:x:");
  expect(JSON.stringify(result.requests[1])).toContain("harness_read_outside_allowed_workspace");
}, 60_000);

test("provider call ceiling persists across learner turns and prevents the next transport attempt", async () => {
  const result = await runHarnessEpisode({ id: "call-limit", transport: { kind: "tape", responses: [{ text: "First answer." }, { text: "Must not run." }] },
    steps: [{ kind: "message", text: "First question." }, { kind: "message", text: "Second question." }],
    limits: { max_provider_calls: 1, turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("failed");
  expect(result.error_code).toBe("harness_provider_call_limit");
  expect(result.requests).toHaveLength(1);
  expect(JSON.stringify(result.steps.at(-1)!.messages)).not.toContain("Must not run");
}, 90_000);

test("legacy interactive quiz is blocked without fabricating a learner attempt and the tutor continues", async () => {
  const result = await runHarnessEpisode({ id: "interactive-quiz-unavailable", allowed_tools: ["quiz"],
    transport: { kind: "tape", responses: [
      { tool_calls: [{ id: "quiz-without-learner", name: "quiz", arguments: { topic: "fractions" } }] },
      { text: "That interactive form requires learner input. I can present a canonical activity and wait for your submission." },
    ] }, steps: [{ kind: "message", text: "Give me a fractions activity; I have not answered it yet." }],
    limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  expect(result.requests).toHaveLength(2);
  const tool: any = result.steps[0]!.messages.find((message: any) => message.role === "toolResult" && message.toolName === "quiz");
  expect(tool?.isError).toBe(true);
  expect(JSON.stringify(tool)).toContain("harness_interactive_quiz_requires_learner_input");
  expect(JSON.stringify(tool)).not.toContain("Objective score");
  expect(JSON.stringify(result.requests[1])).toContain("harness_interactive_quiz_requires_learner_input");
  const initial = JSON.parse(result.initial_files.find((file) => file.path === ".keating/state/learner.json")?.content ?? '{"quizResults":[]}');
  const final = JSON.parse(result.files.find((file) => file.path === ".keating/state/learner.json")?.content ?? '{"quizResults":[]}');
  expect(initial.quizResults).toEqual([]);
  expect(final.quizResults).toEqual(initial.quizResults);
  expect(result.steps[0]!.events.some((event: any) => event.type === "extension_ui_request"
    && ["select", "confirm", "input", "editor"].includes(event.method))).toBe(false);
  expect(result.steps[0]!.messages.some((message: any) => message.role === "assistant"
    && JSON.stringify(message.content).includes("wait for your submission"))).toBe(true);
}, 60_000);

test("native payload limits preserve API semantics and reject ambiguous or unsupported controls", () => {
  const original = { messages: [], max_tokens: 9000, temperature: 0.2 };
  expect(limitHarnessPayload("openai-completions", original, 300).payload).toEqual({ ...original, max_tokens: 300 });
  expect(original.max_tokens).toBe(9000);
  expect(limitHarnessPayload("openai-completions", { messages: [], max_completion_tokens: 9000 }, 300).field).toBe("max_completion_tokens");
  expect(limitHarnessPayload("openai-responses", { input: [], max_output_tokens: 9000 }, 300).payload.max_output_tokens).toBe(300);
  expect(limitHarnessPayload("google-generative-ai", { contents: [], config: { temperature: 0.1, maxOutputTokens: 9000 } }, 300).payload.config).toEqual({ temperature: 0.1, maxOutputTokens: 300 });
  expect(() => limitHarnessPayload("openai-completions", { messages: [], max_tokens: 3, max_completion_tokens: 4 }, 2)).toThrow("harness_ambiguous_output_limit");
  expect(() => limitHarnessPayload("anthropic-messages", { messages: [], thinking: { type: "enabled", budget_tokens: 1000 } }, 300)).toThrow("harness_thinking_budget_exceeds_output_limit");
  expect(() => limitHarnessPayload("unknown", {}, 300)).toThrow("harness_unsupported_provider_api");
});

test("custom OpenAI-compatible models accept environment references and reject credentials in endpoint", () => {
  const request: HarnessV3Request = { id: "custom-provider", transport: { kind: "provider", provider: "example", model: "tutor",
    endpoint: "https://models.example.test/v1", apiKeyEnv: "EXAMPLE_API_KEY", modelMetadata: { contextWindow: 32000, maxTokens: 4000 } },
    steps: [{ kind: "message", text: "Explain closures." }] };
  expect(() => validateHarnessRequest(request)).not.toThrow();
  expect(() => validateHarnessRequest({ ...request, transport: { ...request.transport as any, endpoint: "https://secret@models.example.test/v1" } })).toThrow("harness_invalid_custom_provider");
  expect(() => validateHarnessRequest({ ...request, transport: { ...request.transport as any, apiKeyEnv: "!read-a-secret" } })).toThrow("harness_invalid_custom_provider");
});

test("runtime snapshots map only their shared dependency installation into local provenance", () => {
  expect(localizeHarnessDependency("/snapshot", "/snapshot/src/runtime/pi.ts", "/installation/node_modules")).toBe("/snapshot/src/runtime/pi.ts");
  expect(localizeHarnessDependency("/snapshot", "/installation/node_modules/pi/index.js", "/installation/node_modules")).toBe("/snapshot/node_modules/pi/index.js");
  expect(() => localizeHarnessDependency("/snapshot", "/installation/src/runtime/pi.ts", "/installation/node_modules")).toThrow("harness_dependency_outside_installation");
  expect(() => localizeHarnessDependency("/snapshot", "/installation/node_modules-other/secret", "/installation/node_modules")).toThrow("harness_dependency_outside_installation");
});

test("actual terminal quiz submission waits for the persisted tutor continuation", async () => {
  const sourceDocument = { ...structuredClone(OPENUI_JSON_PARITY_FIXTURE), id: "harness-quiz-submission", nodes: [
    { type: "quiz" as const, id: "quiz", title: "Energy", questions: [
      { id: "objective", kind: "multiple_choice" as const, prompt: "2 times 3?", choices: [{ id: "six", label: "6" }, { id: "five", label: "5" }], correctAnswer: "six" },
      { id: "reason", kind: "short_answer" as const, prompt: "Why does doubling mass double heating energy?" },
    ] },
  ] };
  const action: UiAction = { schemaVersion: 1, type: "complete-quiz", documentId: sourceDocument.id,
    documentRevision: sourceDocument.revision, nodeId: "quiz", resultId: "energy-result", idempotencyKey: "energy-once",
    answers: [{ questionId: "objective", answer: "six" }, { questionId: "reason", answer: "Twice as much material needs twice the energy for the same rise." }],
    score: 1, partialCreditPoints: 1, partialCredits: { objective: 1 }, timing: { totalMs: 1000, perQuestionMs: { objective: 400, reason: 600 } },
    flaggedQuestionIds: [], pendingGradeQuestionIds: ["reason"], skippedQuestionIds: [] };
  const result = await runHarnessEpisode({ id: "quiz-tutor-continuation", transport: { kind: "tape", responses: [
    { text: "Submit the energy activity." }, { text: "Your explanation holds material and temperature rise fixed, which supports the factor of two." },
  ] }, steps: [{ kind: "message", text: "Let us complete the energy quiz." }, { kind: "ui_action", sourceDocument, action }],
    limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  expect(result.steps[1]!.action_followup).toBe("completed");
  expect(result.requests).toHaveLength(2);
  expect(JSON.stringify(result.requests[1])).toContain("Twice as much material needs twice the energy");
  expect(result.steps[1]!.messages.slice(result.steps[1]!.message_start_index).some((message: any) =>
    message.role === "assistant" && JSON.stringify(message.content).includes("holds material and temperature rise fixed"))).toBe(true);
}, 90_000);
