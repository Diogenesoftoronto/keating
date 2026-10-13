import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { validateUiAction, validateUiActionAgainstDocument, type UiDocument } from "@keating/learner-contracts";
import { TWO_SUM_CHALLENGE } from "../components/labs/examples";
import { createOpenUIActionLearnerResponse, parseLearnerResponse, serializeLearnerResponse } from "../keating/learner-response";
import { dispatchSharedUiAction, loadSharedUiActionState, type SharedUiActionIntent } from "../keating/openui/shared-actions";
import { KeatingStorage } from "../keating/storage";

const at = "2026-10-12T12:00:00.000Z";
const document: UiDocument = { schemaVersion: 1, id: "coding-result", revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: at, updatedAt: at, nodes: [TWO_SUM_CHALLENGE] };
const intent: Extract<SharedUiActionIntent, { type: "run-coding-challenge" }> = {
  type: "run-coding-challenge", nodeId: TWO_SUM_CHALLENGE.id, runId: "attempt-1", code: "function twoSum() { return [0, 1]; }",
  cases: TWO_SUM_CHALLENGE.tests.map((item, index) => ({ testId: item.id, passed: index !== 1, actual: "[0,1]" })), durationMs: 17,
};
function storageFixture() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

test("coding runs preserve submitted code and failures in a durable, replayable tutor delivery", async () => {
  const storage = storageFixture();
  const first = dispatchSharedUiAction(storage, document, intent, at, { sessionId: "coding-session", humanFriendlyMessage: "Ran Two sum: 2/3 sample tests passed." });
  expect(loadSharedUiActionState(storage, document).journal.receipts[0]?.action).toEqual(first.action);
  const replay = dispatchSharedUiAction(storage, document, intent, at);
  expect(replay.replayed).toBe(true);
  expect(replay.journal.receipts).toHaveLength(1);
  expect(replay.deliveries).toHaveLength(1);
  const response = createOpenUIActionLearnerResponse({ kind: "canonical", type: first.action.type, params: { ...intent }, humanFriendlyMessage: first.deliveries[0]!.humanFriendlyMessage,
    document: { id: document.id, revision: 0, lifecycle: "workspace" }, action: first.action, sourceDocument: document, receipt: first.receipt });
  const serialized = serializeLearnerResponse(response);
  expect(parseLearnerResponse(serialized)).toEqual(response);
  expect(serialized).toContain(intent.code);
  expect(serialized).toContain('"passed":false');
  expect(response.agentInstruction).toContain("not a formal grade");
  expect(response.review.items).toContainEqual({ label: "Sample tests", value: "2 of 3 passed" });
  const database = new KeatingStorage();
  await database.materializeCanonicalOpenUiAction(first.action, document, at);
  expect((await database.materializeCanonicalOpenUiAction(first.action, document, at)).replayed).toBe(true);
  expect(await database.getQuizResults()).toEqual([]);
});

test("coding action validation binds every result to the authored sample tests", () => {
  const action = dispatchSharedUiAction(storageFixture(), document, intent, at).action;
  expect(validateUiActionAgainstDocument(action, document)).toBe(true);
  expect(validateUiActionAgainstDocument({ ...action, cases: intent.cases.slice(1) }, document)).toBe(false);
  expect(validateUiActionAgainstDocument({ ...action, cases: [...intent.cases].reverse() }, document)).toBe(false);
  expect(validateUiAction({ ...action, cases: [intent.cases[0], intent.cases[0]] })).toBe(false);
  expect(validateUiAction({ ...action, code: "x".repeat(32769) })).toBe(false);
  expect(validateUiAction({ ...action, durationMs: -1 })).toBe(false);
  expect(validateUiAction({ ...action, cases: [{ ...intent.cases[0], passed: true, error: "failure" }] })).toBe(false);
});

test("work timing survives delivery and replay independently of test execution time", () => {
  const timed = { ...intent, timing: { workingMs: 65_432, sinceLastRunMs: 20_125, runNumber: 3 } };
  const storage = storageFixture();
  const dispatched = dispatchSharedUiAction(storage, document, timed, at);
  expect(loadSharedUiActionState(storage, document).journal.receipts[0]?.action).toMatchObject(timed);
  expect(dispatchSharedUiAction(storage, document, timed, at).replayed).toBe(true);
  const response = createOpenUIActionLearnerResponse({ kind: "canonical", type: dispatched.action.type, params: { ...timed }, humanFriendlyMessage: "Ran the sample tests.",
    document: { id: document.id, revision: 0, lifecycle: "workspace" }, action: dispatched.action, sourceDocument: document, receipt: dispatched.receipt });
  const restored = parseLearnerResponse(serializeLearnerResponse(response));
  expect(restored).toEqual(response);
  expect(response.review.items).toContainEqual({ label: "Work time", value: "1:05.432" });
  expect(response.review.items).toContainEqual({ label: "Since previous run", value: "20.125s" });
  expect(response.review.items).toContainEqual({ label: "Attempt", value: "3" });
  expect(response.agentInstruction).toContain("durationMs is test execution time");
  expect(response.agentInstruction).toContain("never as proof of mastery");
  expect(validateUiAction({ ...dispatched.action, timing: { ...timed.timing, sinceLastRunMs: 65_433 } })).toBe(false);
  expect(validateUiAction({ ...dispatched.action, timing: { ...timed.timing, runNumber: 0 } })).toBe(false);
  expect(validateUiAction({ ...dispatched.action, timing: { ...timed.timing, workingMs: -1 } })).toBe(false);
  expect(validateUiAction({ ...dispatched.action, timing: { ...timed.timing, sinceLastRunMs: 1.5 } })).toBe(false);
  expect(validateUiAction({ ...dispatched.action, timing: { ...timed.timing, hiddenTime: 100 } })).toBe(false);
});
