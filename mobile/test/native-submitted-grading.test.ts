import { expect, test } from "bun:test";
import type { JudgementCaller, UiAction, UiDocument } from "@keating/learner-contracts";
import { teachingDraftAnswers } from "../../packages/learner-contracts/test/fixtures/teaching-drafts";
import { webSyncCrypto } from "../../shared/account-sync/crypto";
import { saveNativeState } from "../src/lib/account-sync/local-save";
import { initializeRepositorySchema, LearnerRecordStore, UiActionStore } from "../src/lib/learner-repository";
import { convertLegacyPersistedState } from "../src/lib/learner-repository/legacy-migration";
import { createMobileTeachingDraftRound } from "../src/lib/judgement/teaching-drafts";
import { nativeGradeFeedback, nativeQuestionGrade, nativeQuestionTurnId, nativeReviewedGradeResult, NATIVE_GRADE_TOOL, submittedNativeQuestion, type NativeQuestionGrade } from "../src/lib/judgement/submitted-question";
import { runMobileToolLoop } from "../src/lib/provider-tool-loop";
import { settingsForProvider } from "../src/lib/provider-config";
import type { ChatMessage, PersistedAppState } from "../src/lib/types";
import { applyLocalUiAction, uiActionLearnerMessage } from "../src/lib/ui-action-mutations";
import { createTurnTrace } from "../src/state/turn-trace";
import { SqliteTestDatabase } from "./helpers/sqlite";

const time = "2026-11-17T12:00:00.000Z";
const sessionId = "native-lesson";
const colors = ["red", "green"];
const settings = settingsForProvider("openai");

async function fixture(stem = "In a bag with one red tile and three green, which colour is more likely?", selection = "green") {
  const db = new SqliteTestDatabase();
  await initializeRepositorySchema(db);
  const records = new LearnerRecordStore(db);
  const actions = new UiActionStore(db, () => time);
  const document: UiDocument = { schemaVersion: 1, id: "tile-store", revision: 0, lifecycle: "ready",
    supportedSurfaces: ["mobile"], createdAt: time, updatedAt: time, nodes: [{ type: "question-group", id: "checkpoint",
      topic: "Tiles", questions: [{ id: "tile", prompt: stem, kind: "choice", choices: colors.map(id => ({ id, label: id })) }] }] };
  const action: UiAction = { schemaVersion: 1, type: "submit-question-group", documentId: document.id, documentRevision: 0,
    nodeId: "checkpoint", idempotencyKey: "submitted-tiles", responses: [{ questionId: "tile", type: "choice", optionIds: [selection] }] };
  const published = createTurnTrace("question");
  published.appendUiDocument(document); published.appendTerminal("completed");
  const messages: ChatMessage[] = [
    { id: "first", role: "user", createdAt: 1, content: "I'd like to guess first." },
    { id: "question", role: "assistant", createdAt: 2, content: "Choose a colour.", agentEvents: published.cloneEvents() },
    { id: nativeQuestionTurnId(sessionId, action)!, role: "user", createdAt: Date.parse(time) + 1, content: uiActionLearnerMessage(action, document)! },
  ];
  const state: PersistedAppState = { schemaVersion: 4, activeSessionId: sessionId, providerSettings: settings, artifacts: [],
    learnerFeedback: { helpful: 0, missed: 0 }, sessions: [{ id: sessionId, title: "Tiles", messages: [...messages], createdAt: 1, updatedAt: Date.now() }] };
  await records.replace(convertLegacyPersistedState(state).data);
  const receipt = await actions.dispatch(action, document, (data, now) => applyLocalUiAction(data, action, document, now, sessionId));
  expect(receipt.status).toBe("completed");
  return { db, records, actions, document, action, messages, state, stem };
}

function judge(preference: number): JudgementCaller {
  return async request => {
    const pair = request.questions.draft_pair_choice;
    const scores = pair?.type === "choice" ? { draft_pair_choice: Object.keys(pair.criteria)[1]! }
      : request.questions.learning_task ? { learning_task: .99 } : { preference_graded: preference };
    return { ok: true, response: { backend: { backend: "system-one", model: "jev-fixture", calibrationSha256: null },
      answers: teachingDraftAnswers(request, scores) } };
  };
}

async function run(f: Awaited<ReturnType<typeof fixture>>, verdict: "correct" | "incorrect", preference: number,
  betweenSnapshotAndGrade?: () => Promise<void>) {
  const toolsSeen: string[][] = [];
  const continuationResults: unknown[] = [];
  const feedbackWires: { prompt: string; tools: string[] }[] = [];
  let grade: NativeQuestionGrade | undefined;
  let committed: NativeQuestionGrade | undefined;
  let executions = 0;
  const trace = createTurnTrace("after-form");
  const round = createMobileTeachingDraftRound({ breadth: "broad",
    sessionId, current: () => true, evidence: () => f.records.snapshot(), questionJournal: id => f.actions.getJournal(id),
    judge: judge(preference), onReleased() {}, onReviewedGrade(value) { grade = value; },
    request: async (_settings, _key, _messages, opts) => {
      const tools = (opts?.tools ?? []).map(t => t.name);
      if (opts?.continuation) {
        feedbackWires.push({ prompt: opts.systemPrompt ?? "", tools });
        expect(tools).not.toContain(NATIVE_GRADE_TOOL);
        if (opts.continuation.provider === "openai") continuationResults.push(...opts.continuation.results.map(r => r.output));
      } else toolsSeen.push(tools);
      const proposing = tools.includes(NATIVE_GRADE_TOOL);
      return { text: proposing ? "" : "We can compare the number of tiles.",
        calls: proposing ? [{ id: "grade", name: NATIVE_GRADE_TOOL,
          arguments: { topic: "Tiles", results: [{ question: f.stem, verdict }] } }] : [],
        assistantTurn: proposing ? { provider: "openai", previousResponseId: "r-1" } : null, usage: null };
    },
  });
  const triggering = f.messages.at(-1)!;
  const result = await runMobileToolLoop(settings, "fixture", f.messages, {
    sessionId, triggeringMessageId: triggering.id, createdAt: triggering.createdAt, requestRound: round,
    reviewedGrade: () => grade, onToolCall: (call, key) => trace.appendToolCall(call, key),
    commitToolCall: async call => {
      expect(call.execution.ok).toBe(true); executions++;
      trace.appendToolResult(call);
      const state = { ...f.state, sessions: [{ ...f.state.sessions[0]!, messages: [...f.messages,
        { id: "after-form", role: "assistant" as const, createdAt: Date.now(), content: "", agentEvents: trace.cloneEvents() }] }] };
      committed = grade;
      await saveNativeState({ records: f.records, state, reviewedGrade: grade, account: () => betweenSnapshotAndGrade ? "did:plc:grade-test" : undefined,
        crypto: { ...webSyncCrypto, sha256: async bytes => { await betweenSnapshotAndGrade?.(); return webSyncCrypto.sha256(bytes); } },
        enqueue: task => task(), beforeWrite: () => true, saved() {} });
    },
  });
  return { result, toolsSeen, continuationResults, feedbackWires, executions, committed };
}

test.each([["green", "correct", 1], ["red", "incorrect", 0]] as const)(
  "stock native paired gate and tool loop persist an exact submitted %s answer with its selected tool receipt", async (answer, verdict, score) => {
    const f = await fixture(undefined, answer);
    try {
      const outcome = await run(f, verdict, .01);
      expect(outcome.toolsSeen.map(list => list.length === 1 && list[0] === NATIVE_GRADE_TOOL)).toEqual([false, true, false, true]);
      expect(outcome.executions).toBe(1);
      const data = await f.records.snapshot();
      expect(data.questionChecks).toHaveLength(1);
      expect(data.questionChecks[0]).toMatchObject({ sessionId, question: f.stem, answer, grading: "model", score });
      expect(outcome.continuationResults[0]).toMatchObject({ ok: true, questionCheckId: data.questionChecks[0]!.id, verdict, score });
      expect(outcome.feedbackWires.map(w => w.prompt.includes("Explain the grade just recorded for this answer."))).toEqual([false, true, false, true]);
      expect(outcome.feedbackWires[1]!.tools).toEqual([]);
      expect(outcome.feedbackWires[3]!.tools).toEqual([]);
      expect(outcome.feedbackWires[1]!.prompt).toContain(JSON.stringify({ topic: "Tiles", question: f.stem, answer, verdict, score }));
      const committed = outcome.committed!;
      const result = { callId: "grade", name: NATIVE_GRADE_TOOL, output: { ok: true, questionCheckId: committed.check.id, topic: "Tiles", question: f.stem, verdict, score } };
      expect(nativeGradeFeedback(committed, "grade", sessionId, committed.turnId, [result], data.questionChecks)?.score).toBe(score);
      for (const bad of [{ ...result, isError: true }, { ...result, callId: "foreign-call" },
        { ...result, output: { ...result.output, questionCheckId: "other-question" } }]) {
        expect(nativeGradeFeedback(committed, "grade", sessionId, committed.turnId, [bad], data.questionChecks)).toBeUndefined();
      }
      expect(nativeGradeFeedback(committed, "grade", sessionId, "later-learner-turn", [result], data.questionChecks)).toBeUndefined();
      expect(nativeGradeFeedback(committed, "grade", sessionId, committed.turnId, [result], [{ ...data.questionChecks[0]!, answer: "replaced answer" }])).toBeUndefined();
      const stored = data.sessions[0]!.messages.at(-1)!;
      expect(stored.agentEvents?.some(event => event.type === "tool-result" && event.result.status === "success")).toBe(true);
      const duplicate = saveNativeState({ records: f.records, state: f.state, reviewedGrade: outcome.committed, account: () => undefined,
        crypto: webSyncCrypto, enqueue: task => task(), beforeWrite: () => true, saved() {} });
      await expect(duplicate).rejects.toThrow("changed");
      expect((await f.records.snapshot()).questionChecks).toEqual(data.questionChecks);
    } finally { await f.db.closeAsync(); }
  });

test.each([.99, .5])("a personal preference score with Jev probability %f leaves the actual form pending", async probability => {
  const f = await fixture("Which tile colour do you prefer?");
  try {
    const outcome = await run(f, "correct", probability);
    expect(outcome.executions).toBe(0);
    expect((await f.records.snapshot()).questionChecks[0]).toMatchObject({ grading: "pending" });
  } finally { await f.db.closeAsync(); }
});

test("SQLite keeps a competing grade committed after the stock native save read its pending snapshot", async () => {
  const f = await fixture();
  try {
    const pending = (await f.records.snapshot()).questionChecks[0]!;
    let intervened = false;
    const saving = run(f, "correct", .01, async () => {
      intervened = true;
      await f.records.mutatePortable(data => ({ ...data, questionChecks: [{ ...pending, grading: "model", score: 0.5, misconception: "Existing feedback" }] }));
    });
    await expect(saving).rejects.toThrow("changed");
    expect(intervened).toBe(true);
    expect((await f.records.snapshot()).questionChecks[0]).toMatchObject({ score: 0.5, misconception: "Existing feedback" });
  } finally { await f.db.closeAsync(); }
});

test("the selected grade preserves an unrelated committed question and concurrent session rename", async () => {
  const f = await fixture();
  try {
    const unrelated = { ...(await f.records.snapshot()).questionChecks[0]!, id: "other-check", question: "An earlier question?", grading: "auto" as const, score: 0 };
    await run(f, "correct", .01, async () => {
      await f.records.mutatePortable(data => ({ ...data, questionChecks: [...data.questionChecks, unrelated],
        sessions: data.sessions.map(session => ({ ...session, title: "Learner's new title" })) }));
    });
    const saved = await f.records.snapshot();
    expect(saved.questionChecks.find(check => check.id === unrelated.id)).toEqual(unrelated);
    expect(saved.sessions[0]?.title).toBe("Learner's new title");
  } finally { await f.db.closeAsync(); }
});

test("a failed grade and receipt transaction leaves the question pending", async () => {
  const f = await fixture();
  try {
    const saved = await f.records.snapshot();
    f.db.beforeRun = sql => { if (sql.includes("learner_records") && sql.includes("INSERT")) throw Error("injected write failure"); };
    await expect(run(f, "correct", .01)).rejects.toThrow("injected write failure");
    const restored = await f.records.snapshot();
    expect(restored.questionChecks).toEqual(saved.questionChecks);
    expect(restored.sessions).toEqual(saved.sessions);
  } finally { await f.db.closeAsync(); }
});

test("same wording, foreign session, stale answer, mismatched target and arbitrary tool requests cannot authorize a native grade", async () => {
  const f = await fixture();
  try {
    const saved = await f.records.snapshot();
    const journal = (id: string) => f.actions.getJournal(id);
    const current = await submittedNativeQuestion(sessionId, f.messages, saved, journal);
    expect(current?.id).toBe(saved.questionChecks[0]!.id);
    // The provider requests only its recent history; an older card is resolved from the durable session.
    expect((await submittedNativeQuestion(sessionId, [f.messages.at(-1)!], saved, journal, f.messages))?.id).toBe(current!.id);
    expect(await submittedNativeQuestion("other-session", f.messages, saved, journal)).toBeUndefined();
    expect(await submittedNativeQuestion(sessionId, [...f.messages.slice(0, -1), { ...f.messages.at(-1)!, id: "typed" }], saved, journal)).toBeUndefined();
    expect(await submittedNativeQuestion(sessionId, [...f.messages.slice(0, -1), { ...f.messages.at(-1)!, content: "An unrelated request." }], saved, journal)).toBeUndefined();
    expect(await submittedNativeQuestion(sessionId, f.messages, { ...saved, questionChecks: [...saved.questionChecks, { ...current!, id: "other-submission" }] }, journal)).toBeUndefined();
    for (const changed of [{ answer: "other" }, { id: "other" }, { question: "Other?" }, { grading: "auto" as const, score: 1 }]) {
      expect(await submittedNativeQuestion(sessionId, f.messages, { ...saved, questionChecks: [{ ...current!, ...changed }] }, journal)).toBeUndefined();
    }
    const args = { topic: "Tiles", results: [{ question: f.stem, verdict: "correct" }] };
    expect(nativeQuestionGrade(current, { ...args, topic: "Elsewhere" })).toBeUndefined();
    expect(nativeQuestionGrade(current, { ...args, results: [{ question: "Other?", verdict: "correct" }] })).toBeUndefined();
    const grade = { ...nativeQuestionGrade(current, args)!, turnId: f.messages.at(-1)!.id };
    for (const [source, session, turn] of [[undefined, sessionId, grade.turnId], [grade, "wrong-session", grade.turnId], [grade, sessionId, "unrelated"]] as const) {
      expect(nativeReviewedGradeResult(source, args, { sessionId: session, messageId: turn, idempotencyKey: "call", createdAt: 1 }).ok).toBe(false);
    }
  } finally { await f.db.closeAsync(); }
});
