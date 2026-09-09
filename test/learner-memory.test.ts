import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { learnerMemoryTools } from "../src/pi/hyper-teacher/tools/learner-memory.js";
import { loadLearnerMemory } from "../src/core/learner-memory.js";
import { loadLearnerContext } from "../src/core/learner-context.js";
import { learnerMemoryPath } from "../src/core/paths.js";
import { withLearnerProfile } from "../src/core/learner-profile-selection.js";
import { runHarnessEpisode } from "../scripts/training/benchmark_harness_v3.js";

function session(text: string, extra: unknown[] = []) {
  return { getSessionId: () => "actual-session-1", getBranch: () => [...extra,
    { id: "actual-learner-message-1", type: "message", message: { role: "user", content: [{ type: "text", text }] } }] };
}
const question = "Why does the gear ratio change when I switch to a larger front chainring?";
const observed = { category: "study-context", value: "Currently exploring bicycle gear ratios.", source: "observed", evidence: question, confidence: 0.99 };
async function invoke(name: string, cwd: string, params: Record<string, unknown>, text = question, extra: unknown[] = []) {
  return learnerMemoryTools.find((tool) => tool.name === name)!.execute("actual-call", params, undefined, undefined,
    { cwd, sessionManager: session(text, extra) });
}

test("normal learner questions support tentative memory with host provenance, deduplication and grounded evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-memory-"));
  try {
    await invoke("remember_learner_profile", cwd, observed);
    await invoke("remember_learner_profile", cwd, observed);
    const facts = await loadLearnerMemory(cwd);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.source).toBe("observed");
    expect(facts[0]!.confidence).toBe(0.65);
    expect(facts[0]!.provenance.sessionId).toBe("actual-session-1");
    expect(facts[0]!.provenance.messageId).toBe("actual-learner-message-1");
    const context = await loadLearnerContext(cwd);
    expect(context).toContain(facts[0]!.id);
    expect(context).toContain(observed.value);
    expect(context).toContain("observed facts are tentative");
    const before = await readFile(learnerMemoryPath(cwd), "utf8");
    await expect(invoke("remember_learner_profile", cwd, { ...observed, evidence: "I am a bicycle mechanic." }, question,
      [{ id: "assistant-1", type: "message", message: { role: "assistant", content: "I am a bicycle mechanic." } }]))
      .rejects.toThrow("learner_memory_evidence_not_in_learner_message");
    expect(await readFile(learnerMemoryPath(cwd), "utf8")).toBe(before);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("correction replaces the exact active fact and forgetting removes its value and evidence", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-memory-correction-"));
  try {
    await invoke("remember_learner_profile", cwd, observed);
    const prior = (await loadLearnerMemory(cwd))[0]!;
    const correction = "I am studying motor speed ratios now, rather than bicycle gear ratios.";
    await invoke("remember_learner_profile", cwd, { category: "study-context", value: "Studying motor speed ratios.", source: "explicit",
      evidence: correction, supersedes_id: prior.id }, correction);
    const corrected = await loadLearnerMemory(cwd);
    expect(corrected).toHaveLength(1);
    expect(corrected[0]!.id).not.toBe(prior.id);
    expect(corrected[0]!.supersedesId).toBe(prior.id);
    expect(corrected[0]!.source).toBe("explicit");
    expect(await loadLearnerContext(cwd)).not.toContain(observed.value);
    await expect(invoke("remember_learner_profile", cwd, { ...observed, supersedes_id: corrected[0]!.id }))
      .rejects.toThrow("learner_memory_explicit_correction_required");
    await expect(invoke("remember_learner_profile", cwd, { ...observed, supersedes_id: "missing" }))
      .rejects.toThrow("learner_memory_unknown_superseded_id");
    await invoke("forget_learner_profile", cwd, { belief_id: corrected[0]!.id }, "Please forget that study context.");
    expect(await loadLearnerMemory(cwd)).toEqual([]);
    const stored = await readFile(learnerMemoryPath(cwd), "utf8");
    expect(stored).not.toContain(correction);
    expect(stored).not.toContain("Studying motor speed ratios.");
    await expect(invoke("forget_learner_profile", cwd, { belief_id: corrected[0]!.id }))
      .rejects.toThrow("learner_memory_unknown_id");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("memory tools and startup context remain inside the selected learner namespace", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-memory-profiles-"));
  try {
    await withLearnerProfile(cwd, "sam", () => invoke("remember_learner_profile", cwd, observed));
    const sam = await withLearnerProfile(cwd, "sam", () => loadLearnerMemory(cwd));
    expect(sam).toHaveLength(1);
    expect(await withLearnerProfile(cwd, "alex", () => loadLearnerMemory(cwd))).toEqual([]);
    expect(await loadLearnerMemory(cwd)).toEqual([]);
    expect(await withLearnerProfile(cwd, "alex", () => loadLearnerContext(cwd))).not.toContain(observed.value);
    await expect(withLearnerProfile(cwd, "alex", () => invoke("forget_learner_profile", cwd, { belief_id: sam[0]!.id })))
      .rejects.toThrow("learner_memory_unknown_id");
    expect(await withLearnerProfile(cwd, "sam", () => loadLearnerMemory(cwd))).toHaveLength(1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("actual offline Pi learns from a normal question and includes the fact in the next session context", async () => {
  const biography = "I study engineering and enjoy repairing my bicycle.";
  const result = await runHarnessEpisode({ id: "ordinary-question-memory", profile_name: "rider", learner_profile: biography,
    transport: { kind: "tape", responses: [
    { tool_calls: [{ id: "remember-topic", name: "remember_learner_profile", arguments: observed }] },
    { text: "A larger front chainring moves more chain per pedal turn." }, { text: "Let us continue with ratios." },
  ] }, steps: [{ kind: "message", text: question }, { kind: "new_session" }, { kind: "message", text: "What shall we explore next?" }],
    limits: { turn_timeout_ms: 20_000 } });
  expect(result.status).toBe("completed");
  expect(result.requests).toHaveLength(3);
  expect(result.configuration.profile_name).toBe("rider");
  expect((result.requests[0] as any).data.context.systemPrompt).toContain(biography);
  const tool: any = result.steps[0]!.messages.find((message: any) => message.role === "toolResult" && message.toolName === "remember_learner_profile");
  expect(tool?.isError).not.toBe(true);
  const saved = JSON.parse(tool.content[0].text).fact;
  expect(saved.provenance.sessionId).toBe(result.steps[0]!.state.sessionId);
  expect(saved.provenance.messageId).toBeTruthy();
  expect(saved.source).toBe("observed");
  const next: any = result.requests[2];
  expect(next.data.context.systemPrompt).toContain(observed.value);
  expect(next.data.context.systemPrompt).toContain(saved.id);
  expect(next.data.context.systemPrompt).toContain('"confidence":0.65');
  const memoryFiles = result.files.filter((file) => file.path.endsWith("/learner-memory.json"));
  expect(memoryFiles).toHaveLength(1);
  expect(memoryFiles[0]!.path).toBe(".keating/profiles/rider/state/learner-memory.json");
}, 90_000);
