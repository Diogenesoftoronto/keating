import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createPortableLearnerEnvelope, projectActivityObservations, type JudgementCaller, type JudgementAnswer,
  type PortableLearnerData, type TeachingPolicyTurn, type UiDocument, type UiAction } from "@keating/learner-contracts";
import { activitySourcesFromDocuments, descriptor, selectActivityCandidate, type ActivityExposure } from "../../packages/learner-contracts/src/judgement/activity-learning";
import { MobileActivityLearningStore } from "../src/lib/learner-repository/activity-learning";
import { initializeRepositorySchema, LearnerRecordStore, UiActionStore, type AsyncSqlDatabase, type AsyncSqlExecutor, type SqlBindValue } from "../src/lib/learner-repository";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";
import { mobileActivityBoundaries, mobileActivityOutcomes, mobileUnansweredActivityDocument } from "../src/lib/judgement/activity-learning";
import { applyLocalUiAction } from "../src/lib/ui-action-mutations";
import { runMobileToolLoop } from "../src/lib/provider-tool-loop";
import { MOBILE_TOOL_DEFINITIONS } from "../src/lib/mobile-tools";
import { TEACHING_POLICY_RULES } from "../../packages/learner-contracts/src/judgement/teaching-policy-catalog";
import type { ChatMessage, ChatSession } from "../src/lib/types";
import { ACTIVITY_QUESTION_FINGERPRINT, activityObservationFeatures } from "../../packages/learner-contracts/src/judgement/activity-observations";
import { validateBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../packages/learner-contracts/src/judgement/background-activity-policy";

const time = Date.parse("2026-10-01T10:00:00Z");
const empty = (): PortableLearnerData => ({ generatedAt: new Date(time).toISOString(), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [], learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } });
const turn: TeachingPolicyTurn = { learnerMessage: "Explain division", conversation: [], learnerEvidence: [], availableTools: [], toolResults: [], sources: [], assessment: "unknown", improvementRuns: null, domain: "unknown" };
const hash = async (value: string) => createHash("sha256").update(value).digest("hex");
const judge = (noMatch = false): JudgementCaller => async request => ({ ok: true, response: {
  backend: { backend: "fixture", model: "fixture-v1", calibrationSha256: null },
  answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]): [string, JudgementAnswer] => {
    if (q.type === "choice") {
      const choice = id === "draft_standard" ? "concise" : noMatch && id === "draft_choice" ? "no_match" : Object.keys(q.criteria)[0]!;
      return [id, { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === choice)])) }];
    }
    const rejected = JSON.stringify(request.state).includes("PRIVATE_REJECTED");
    return [id, { type: "noul", noul: id.startsWith("quality_") ? .99 : id === "retention_overclaimed" && rejected ? .99 : .01 }];
  })),
} });
const noPrediction = (input: Parameters<typeof selectActivityCandidate>[0]) => selectActivityCandidate(input, { exposures: [], transport: async () => { throw Error("must not call"); } });

test("native synthesis sends source text privately and releases only the newly reviewed answer", async () => {
  const seen: ChatMessage[][] = [], prompts: string[] = [], visible: string[] = [], reviewed: string[] = [];
  const original: ChatMessage[] = [{ id: "user", role: "user", content: "Explain division", createdAt: time }];
  const before = structuredClone(original);
  const baseJudge = judge();
  const synthesisJudge: JudgementCaller = async (request, signal) => {
    const result = await baseJudge(request, signal);
    if (!result.ok) return result;
    const answers = { ...result.response.answers };
    const reply = (request.state as { reply?: { text: string } }).reply?.text;
    if (reply && result.ok && request.questions.quality_progress) {
      reviewed.push(reply);
      if (reply === "PRIVATE SOURCE A") answers.quality_scope = { type: "noul", noul: .1 };
      if (reply === "PRIVATE SOURCE B") answers.quality_progress = { type: "noul", noul: .1 };
    }
    if (result.ok && request.questions.draft_choice?.type === "choice") {
      answers.draft_choice = { type: "choice", choice: "draft_3", confidence: 1,
        probabilities: Object.fromEntries(Object.keys(request.questions.draft_choice.criteria).map(key => [key, Number(key === "draft_3")])) };
    }
    return { ...result, response: { ...result.response, answers } };
  };
  const request = createMobileTeachingDraftRound({ judge: synthesisJudge, current: () => true, evidence: async () => empty(), onReleased: () => {},
    request: async (_settings, _key, messages, options) => {
      seen.push(structuredClone(messages)); prompts.push(options?.systemPrompt ?? "");
      expect(options?.onTextDelta).toBeUndefined(); expect(options?.onReasoningDelta).toBeUndefined();
      expect(options?.onToolCall).toBeUndefined(); expect(options?.stream).toBe(false);
      return { text: seen.length === 1 ? "PRIVATE SOURCE A" : seen.length === 2 ? "PRIVATE SOURCE B" : "Division splits a quantity into equal groups.",
        calls: [], assistantTurn: null, usage: null };
    } });
  const result = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", original, { onTextDelta: text => visible.push(text) });
  expect(seen).toHaveLength(3);
  for (const prior of seen.slice(0, 2)) expect(JSON.stringify(prior)).not.toContain("synthesisSources");
  const synthesisMessage = seen[2]!.at(-1)!;
  expect(synthesisMessage.role).toBe("user");
  expect(synthesisMessage.content).toContain("synthesisSources");
  expect(synthesisMessage.content).toContain("PRIVATE SOURCE A"); expect(synthesisMessage.content).toContain("PRIVATE SOURCE B");
  expect(synthesisMessage.content).toContain("untrusted data");
  expect(prompts.join("\n")).not.toContain("PRIVATE SOURCE");
  expect(prompts[2]).not.toContain("No rejected draft is included");
  expect(reviewed).toContain("Division splits a quantity into equal groups.");
  expect(result.text).toBe("Division splits a quantity into equal groups.");
  expect(visible.join("")).not.toContain("PRIVATE SOURCE"); expect(original).toEqual(before);
});

test("native rejected drafts stay private and only approved tools reach the existing effect loop", async () => {
  let generated = 0, effects = 0; const visible: string[] = [];
  const privateRound = createMobileTeachingDraftRound({ judge: judge(), current: () => true, evidence: async () => empty(), activityLearning: noPrediction, onReleased: () => {},
    request: async (_settings, _key, _messages, options) => {
      expect(options?.stream).toBe(false); expect(options?.onTextDelta).toBeUndefined(); expect(options?.onToolCall).toBeUndefined();
      generated++;
      return { text: generated === 1 ? "PRIVATE_REJECTED: you will retain this forever." : generated === 2 ? "Here is a practice quiz." : "Try the first item.",
        calls: generated <= 2 ? [{ id: `call-${generated}`, name: "generate_practice_quiz", arguments: { topic: "Division" } }] : [],
        assistantTurn: generated <= 2 ? { provider: "openai", previousResponseId: `response-${generated}` } : null,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    } });
  const result = await runMobileToolLoop({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Explain division", createdAt: time }], {
    sessionId: "session", triggeringMessageId: "user", createdAt: time, requestRound: privateRound,
    onTextDelta: text => visible.push(text), executeTool: async (name, _args, context) => {
      effects++; return { ok: true, toolName: name, idempotencyKey: context.idempotencyKey, output: {}, effects: [] };
    }, commitToolCall: async () => {},
  });
  expect(generated).toBe(3); expect(effects).toBe(1);
  expect(result.text).not.toContain("PRIVATE_REJECTED"); expect(visible.join("")).not.toContain("PRIVATE_REJECTED");
  expect(result.usage?.totalTokens).toBe(6);
});

test("native no_match retains the reviewed baseline without invoking the outcome predictor", async () => {
  let selected = 0;
  const request = createMobileTeachingDraftRound({ judge: judge(true), current: () => true, evidence: async () => empty(),
    activityLearning: async input => { selected++; return noPrediction(input); }, onReleased: selection => expect(selection?.candidate.attempt).toBe(1),
    request: async () => ({ text: "Private unchosen answer", calls: [], assistantTurn: null, usage: null }) });
  const result = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Explain division", createdAt: time }]);
  expect(result.text).toBe("Private unchosen answer"); expect(result.calls).toEqual([]); expect(selected).toBe(0);
});

test("the usual native reply records observations without waiting for an unresolved tabular selector", async () => {
  let selected = 0, recorded = false;
  const request = createMobileTeachingDraftRound({ judge: judge(), current: () => true, evidence: async () => empty(),
    activityLearning: async () => { selected++; return new Promise(() => {}); },
    onReleased: selection => { recorded = !!selection; },
    request: async () => ({ text: "A checked explanation.", calls: [], assistantTurn: null, usage: null }) });
  const result = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "Explain division", createdAt: time }]);
  expect(result.text).toBe("A checked explanation."); expect(recorded).toBe(true); expect(selected).toBe(0);
});

test("the separate experimental live mode still invokes the approved-reply selector", async () => {
  let selected = 0;
  const request = createMobileTeachingDraftRound({ judge: judge(), current: () => true, evidence: async () => empty(),
    activityLearningMode: "live", activityLearning: async input => { selected++; return noPrediction(input); }, onReleased: () => {},
    request: async () => ({ text: "A checked explanation.", calls: [], assistantTurn: null, usage: null }) });
  const result = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key",
    [{ id: "user", role: "user", content: "Explain division", createdAt: time }]);
  expect(result.text).toBe("A checked explanation."); expect(selected).toBe(1);
});

test("native revision receives code-owned repair instructions without the rejected draft", async () => {
  const prompts: string[] = [];
  const instruction = TEACHING_POLICY_RULES.find(rule => rule.id === "retention_overclaimed")!.question.instructions;
  const request = createMobileTeachingDraftRound({ judge: judge(), current: () => true, evidence: async () => empty(),
    activityLearning: noPrediction, onReleased: () => {}, request: async (_settings, _key, messages, options) => {
      prompts.push(options?.systemPrompt ?? "");
      expect(JSON.stringify(messages)).not.toContain("PRIVATE_REJECTED");
      const repaired = prompts.length > 1 && prompts.at(-1)!.includes(instruction);
      return { text: repaired ? "This example shows equal groups; try one yourself." : "PRIVATE_REJECTED: you will remember this forever.", calls: [], assistantTurn: null, usage: null };
    } });
  const response = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Explain division", createdAt: time }]);
  expect(prompts).toHaveLength(2); expect(prompts[1]).toContain('"revisionChecks"');
  expect(prompts[1]).toContain('"id":"retention_overclaimed"');
  expect(prompts.join("\n")).not.toContain("PRIVATE_REJECTED");
  expect(response.text).toBe("This example shows equal groups; try one yourself.");
});

test("every advertised native tool schema remains usable and pending submissions are session-bound", async () => {
  const data = empty();
  for (const sessionId of ["this-session", "another-session", undefined]) data.questionChecks.push({
    id: sessionId ?? "unknown-session", ...(sessionId ? { sessionId } : {}), topic: "Division", question: "Explain why?", answer: "Because", grading: "pending", createdAt: new Date(time).toISOString(),
  });
  const toolArguments: Record<string, Record<string, unknown>> = {
    generate_study_plan: { topic: "Division" }, generate_concept_map: { topic: "Division" }, generate_practice_quiz: { topic: "Division" },
    inspect_mobile_workspace: {}, propose_mobile_workspace_change: { intent: "Clarify the heading", path: "screens/home.json", source: "{}" },
    list_knowledge_sources: {}, list_knowledge_resources: { source_id: "source" },
    read_knowledge_resource: { source_id: "source", uri: "notes://division" },
    call_knowledge_tool: { source_id: "source", tool: "search", arguments: { query: "division" } },
  };
  const calls = MOBILE_TOOL_DEFINITIONS.map((tool, index) => ({ id: `native-${index}`, name: tool.name, arguments: toolArguments[tool.name]! }));
  let planningObserved = false;
  for (const batch of [calls.slice(0, 8), calls.slice(8)]) {
  const request = createMobileTeachingDraftRound({ judge: async (request, signal) => {
    const state = request.state as { turn: TeachingPolicyTurn };
    expect(state.turn.pendingSubmissions?.map(row => row.id)).toEqual(["this-session"]);
    planningObserved = true; return judge()(request, signal);
  }, sessionId: "this-session", current: () => true, evidence: async () => data, activityLearning: noPrediction, onReleased: () => {},
    request: async () => ({ text: "I will prepare these study materials.", calls: batch, assistantTurn: { provider: "openai", previousResponseId: "selected" }, usage: null }) });
  const response = await request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Prepare study materials", createdAt: time }],
    { tools: MOBILE_TOOL_DEFINITIONS.map(tool => ({ name: tool.name, description: tool.description, parameters: { ...tool.inputSchema } })) });
  expect(planningObserved).toBe(true); expect(response.calls).toEqual(batch);
  }
});

test("native account/evidence changes reject even noncooperative finished drafts", async () => {
  for (const changed of ["account", "evidence"]) {
    let current = true; const data = empty();
    const request = createMobileTeachingDraftRound({ judge: judge(), current: () => current, evidence: async () => structuredClone(data), activityLearning: noPrediction, onReleased: () => { throw Error("must not release"); },
      request: async () => { if (changed === "account") current = false; else data.questionChecks.push({ id: "new", topic: "Division", question: "New?", answer: "yes", createdAt: new Date(time + 1).toISOString(), grading: "auto", score: 1 });
        return { text: "Stale private answer", calls: [], assistantTurn: null, usage: null }; } });
    await expect(request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Explain division", createdAt: time }])).rejects.toThrow();
  }
});

test("account invalidation during the final evidence read cannot release a stale native reply", async () => {
  let reads = 0;
  const run = async (invalidateAt?: number) => {
    let current = true, released = false; reads = 0;
    const request = createMobileTeachingDraftRound({ judge: judge(), current: () => current,
      evidence: async () => { reads++; await Promise.resolve(); if (reads === invalidateAt) current = false; return empty(); },
      activityLearning: noPrediction, onReleased: () => { released = true; },
      request: async () => ({ text: "A checked explanation.", calls: [], assistantTurn: null, usage: null }) });
    const work = request({ provider: "openai", model: "fixture", customBaseUrl: "" }, "key", [{ id: "user", role: "user", content: "Explain division", createdAt: time }]);
    if (invalidateAt) { await expect(work).rejects.toThrow("changed"); expect(released).toBe(false); }
    else { await work; expect(released).toBe(true); }
  };
  await run(); const finalRead = reads;
  await run(finalRead);
});

class Sqlite implements AsyncSqlDatabase {
  db = new Database(":memory:"); tail: Promise<void> = Promise.resolve();
  async execAsync(sql: string) { this.db.exec(sql); }
  async runAsync(sql: string, ...params: SqlBindValue[]) { const result = this.db.query(sql).run(...params); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }; }
  async getFirstAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).get(...params) as T | null; }
  async getAllAsync<T>(sql: string, ...params: SqlBindValue[]) { return this.db.query(sql).all(...params) as T[]; }
  withExclusiveTransactionAsync(work: (transaction: AsyncSqlExecutor) => Promise<void>) {
    const task = this.tail.catch(() => undefined).then(async () => { this.db.exec("BEGIN IMMEDIATE"); try { await work(this); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } });
    this.tail = task.catch(() => undefined); return task;
  }
  async closeAsync() { await this.tail; this.db.close(); }
}
async function fixture() {
  const db = new Sqlite(); await initializeRepositorySchema(db);
  const records = new LearnerRecordStore(db, () => new Date(time + 100).toISOString());
  const data = empty(), at = new Date(time).toISOString();
  data.sessions.push({ id: "session", title: "Division", createdAt: at, updatedAt: at, activeBranchId: "branch",
    branches: [{ id: "branch", sessionId: "session", createdAt: at, updatedAt: at }], messages: [] });
  await records.replace(data);
  const actions = new UiActionStore(db, () => new Date(time + 100).toISOString());
  const store = new MobileActivityLearningStore(db, "account-a");
  const document: UiDocument = { schemaVersion: 1, id: "document", revision: 0, lifecycle: "ready", supportedSurfaces: ["mobile"], createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString(), nodes: [{ type: "question", id: "q", kind: "choice", prompt: "Which number is half of four?", choices: [{ id: "two", label: "2" }, { id: "three", label: "3" }], correctAnswer: "two" }] };
  const action: UiAction = { schemaVersion: 1, type: "choose-option", documentId: "document", documentRevision: 0, nodeId: "q", idempotencyKey: "answer", optionIds: ["two"] };
  const observations = { ...projectActivityObservations(turn, null), judgeModel: "fixture-v1" };
  const exposure: ActivityExposure = { id: "published", sessionId: "session", createdAt: time, observations,
    candidate: descriptor({ text: "Question", toolCalls: [] })!, sources: activitySourcesFromDocuments([document]) };
  await store.publish(0, exposure, [document], () => true);
  return { db, records, actions, store, document, action, exposure,
    commit: () => actions.dispatch(action, document, (current, now) => applyLocalUiAction(current, action, document, now, "session")),
    history: (boundaries: { sessionId: string; createdAt: number }[] = []) => store.history(0, boundaries, time + 1000, () => true) };
}

test("activity ledger requires committed exact source; uses first recorded objective credit, isolates accounts, and respects later publication", async () => {
  const f = await fixture();
  await f.store.linkCommitted(0, f.action, f.document, "session", empty(), () => true, hash);
  expect((await f.history())[0]!.outcome).toBeUndefined();
  await f.commit();
  await f.store.linkCommitted(0, f.action, { ...f.document, title: "forged same ID" }, "session", empty(), () => true, hash);
  expect((await f.history())[0]!.outcome).toBeUndefined();
  await f.store.linkCommitted(0, f.action, f.document, "session", empty(), () => true, hash);
  await f.store.linkCommitted(0, f.action, f.document, "session", empty(), () => true, hash);
  expect((await f.history())[0]!.outcome).toMatchObject({ score: 1, grading: "auto", attemptStatus: "first-recorded" });
  expect((await f.history([{ sessionId: "session", createdAt: time + 50 }]))[0]!.outcome).toBeUndefined();
  expect(await new MobileActivityLearningStore(f.db, "account-b").history(0, [], time + 1000, () => true)).toEqual([]);
  await f.db.closeAsync();
});

test("activity generation invalidation on import/clear rejects stale writers without exporting local evidence", async () => {
  for (const operation of ["import", "clear"]) {
    const f = await fixture();
    expect(JSON.stringify(await f.records.exportPortable())).not.toContain("published");
    if (operation === "import") await f.records.importPortable(createPortableLearnerEnvelope(empty())); else await f.records.clear();
    await expect(f.store.publish(0, { ...f.exposure, id: "stale" }, [f.document], () => true)).rejects.toThrow("changed");
    expect(await f.store.history(await f.store.generation(), [], time + 1000, () => true)).toEqual([]);
    await f.db.closeAsync();
  }
});

test("background policy snapshots are account-bound, expire, and clear with history without changing an in-flight snapshot", async () => {
  const f = await fixture();
  const features = activityObservationFeatures(f.exposure.observations);
  const policy: BackgroundActivityPolicy = { version: 1, featureVersion: "activity-observations-v1-kind-v1", model: "v3.5_default", questionFingerprint: ACTIVITY_QUESTION_FINGERPRINT,
    judgeModel: "fixture-v1", createdAt: time, expiresAt: time + 86_400_000, kinds: ["prose", "question"],
    bounds: { min: [...features], max: [...features] }, prototypes: [{ features, scores: [.1, .9] }], trainRows: 20,
    validation: { kind: "squared-error", modelLoss: 0, localLoss: 0, baselineLoss: .5, rows: 5, coveredRows: 5, passed: true },
    target: "next-linked-objective-score", scope: "chronological-within-learner", causal: false };
  expect(validateBackgroundActivityPolicy(policy)).toBe(true);
  await f.store.savePolicy(0, policy, () => true);
  const runningTurn = await f.store.policy(0, () => true, time + 1);
  const next = structuredClone(policy); next.createdAt++; next.expiresAt++; next.prototypes[0]!.scores = [.9, .1];
  await f.store.savePolicy(0, next, () => true);
  expect(runningTurn!.prototypes[0]!.scores).toEqual([.1, .9]);
  expect((await f.store.policy(0, () => true, time + 2))!.prototypes[0]!.scores).toEqual([.9, .1]);
  expect(await f.store.policy(0, () => true, next.expiresAt)).toBeNull();
  expect(await new MobileActivityLearningStore(f.db, "account-b").policy(0, () => true, time + 2)).toBeNull();
  await f.records.clear();
  await expect(f.store.savePolicy(0, policy, () => true)).rejects.toThrow("changed");
  expect(await f.store.policy(await f.store.generation(), () => true, time + 2)).toBeNull();
  await f.db.closeAsync();
});

test("repeat work and semantic answers never become first objective labels; boundaries use publication events", async () => {
  const f = await fixture();
  const prior = { ...empty(), questionChecks: [{ id: "previous", topic: "Division", question: "Which number is half of four?", answer: "three", createdAt: new Date(time - 1).toISOString(), grading: "auto" as const, score: 0 }] };
  expect((await mobileActivityOutcomes(f.action, f.document, "session", time + 100, prior, hash))[0]!.attemptStatus).toBe("repeat");
  const semantic = { ...f.document, nodes: [{ type: "question" as const, id: "q", kind: "short_answer" as const, prompt: "Explain why.", correctAnswer: "because" }] };
  const response: UiAction = { schemaVersion: 1, type: "submit-answer", documentId: "document", documentRevision: 0, nodeId: "q", idempotencyKey: "semantic", answer: "because" };
  expect((await mobileActivityOutcomes(response, semantic, "session", time + 100, empty(), hash))[0]!.grading).toBe("pending");
  const sessions = [{ id: "session", title: "Test", createdAt: time, updatedAt: time + 200,
    messages: [{ id: "reply", role: "assistant", content: "Later reply", createdAt: time - 10,
      agentEvents: [{ type: "text-delta", text: "Later reply", id: "text", turnId: "turn", sequence: 0, occurredAt: new Date(time + 50).toISOString() },
        { type: "completed", id: "end", turnId: "turn", sequence: 1, occurredAt: new Date(time + 200).toISOString() }] }] }] as ChatSession[];
  expect(mobileActivityBoundaries(sessions)).toEqual([{ sessionId: "session", createdAt: time + 50 }]);
  await f.db.closeAsync();
});

test("invalid or obsolete local policies are ignored without quarantining valid activity history", async () => {
  const f = await fixture();
  const key = "activity_learning_v1:account-a";
  const saved = await f.db.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = ?;", key);
  await f.db.runAsync("UPDATE repository_meta SET value = ? WHERE key = ?;",
    JSON.stringify({ ...JSON.parse(saved!.value), policy: { version: 1, questionFingerprint: "obsolete" } }), key);
  expect(await f.store.policy(0, () => true, time + 1)).toBeNull();
  expect((await f.history()).map(row => row.id)).toEqual(["published"]);
  await f.commit();
  await f.store.linkCommitted(0, f.action, f.document, "session", empty(), () => true, hash);
  expect((await f.history())[0]!.outcome?.score).toBe(1);
  await f.db.closeAsync();
});

test("prose may bind only one real unanswered source; prior attempts or ambiguous nodes stay unbound", async () => {
  const f = await fixture();
  const session = { id: "session", title: "Division", createdAt: time, updatedAt: time,
    messages: [{ id: "question-message", role: "assistant", content: "Try this", createdAt: time,
      agentEvents: [{ id: "document-event", type: "ui-document", turnId: "turn", sequence: 0, occurredAt: new Date(time).toISOString(), document: f.document }] }] } as ChatSession;
  expect(await mobileUnansweredActivityDocument(session, empty(), id => f.actions.getJournal(id))).toEqual(f.document);
  const ambiguous = structuredClone(session);
  const event = ambiguous.messages[0]!.agentEvents![0]!;
  if (event.type === "ui-document") event.document.nodes.push({ ...event.document.nodes[0]!, id: "another" });
  expect(await mobileUnansweredActivityDocument(ambiguous, empty(), id => f.actions.getJournal(id))).toBeNull();
  const previous = empty(); previous.questionChecks.push({ id: "old", topic: "Division", question: "Which number is half of four?", answer: "three", createdAt: new Date(time - 1).toISOString(), grading: "auto", score: 0 });
  expect(await mobileUnansweredActivityDocument(session, previous, id => f.actions.getJournal(id))).toBeNull();
  await f.commit();
  expect(await mobileUnansweredActivityDocument(session, empty(), id => f.actions.getJournal(id))).toBeNull();
  await f.db.closeAsync();
});
