import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { validateUiActionCorrelation, validateUiDocument, type UiDocument } from "@keating/learner-contracts";
import { dispatchSharedUiAction, loadSharedUiActionState } from "../keating/openui/shared-actions";
import { KeatingStorage } from "../keating/storage";
import saved from "../../../test/fixtures/tui-future-document.json";

const captured: unknown = saved.document;
if (!validateUiDocument(captured)) throw new Error("Invalid captured activity fixture");
const document: UiDocument = captured;
const at = saved.retryableJournal.receipts[0]!.createdAt;
const cases = [
  { name: "the captured document ahead of the local clock", createdAt: document.createdAt, updatedAt: document.updatedAt, now: at, expected: document.updatedAt },
  { name: "an earlier creation with a future update", createdAt: "2026-09-14T23:09:00.000Z", updatedAt: document.updatedAt, now: at, expected: document.updatedAt },
  { name: "a later clock with mixed timestamp precision", createdAt: "2026-09-14T23:09:20Z", updatedAt: "2026-09-14T23:09:20Z", now: "2026-09-14T23:09:20.001Z", expected: "2026-09-14T23:09:20.001Z" },
];
const intent = { type: "choose-option" as const, nodeId: "compare-slices", optionIds: ["3-piece-bigger"] };

beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

test.each(cases)("local storage submits and replays $name", ({ createdAt, updatedAt, now, expected }) => {
  const source = { ...document, createdAt, updatedAt };
  const values = new Map<string, string>();
  let writes = 0;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes++; values.set(key, value); } };
  const result = dispatchSharedUiAction(storage, source, intent, now, { sessionId: "clock-test", humanFriendlyMessage: "My choice" });
  expect(validateUiActionCorrelation(result.action, result.result, source)).toBe(true);
  expect(result.document).toMatchObject({ revision: 1, createdAt, updatedAt: expected });
  expect(result.receipt).toMatchObject({ state: "completed", createdAt: now, updatedAt: now });
  expect(result.deliveries[0]?.createdAt).toBe(now);
  expect(loadSharedUiActionState(storage, source).document).toEqual(result.document);
  const replay = dispatchSharedUiAction(storage, source, intent, "2026-09-14T23:09:21.000Z");
  expect(replay.replayed).toBe(true);
  expect(replay.receipt).toEqual(result.receipt);
  expect(replay.deliveries).toEqual(result.deliveries);
  expect(writes).toBe(1);
  expect(source.updatedAt).toBe(updatedAt);
  expect(source.revision).toBe(0);
});

test.each(cases)("IndexedDB persists one answer for $name", async ({ createdAt, updatedAt, now, expected }) => {
  const source = { ...document, createdAt, updatedAt };
  const action = { schemaVersion: 1 as const, documentId: source.id, documentRevision: 0, idempotencyKey: "clock-test", ...intent };
  const storage = new KeatingStorage();
  const result = await storage.materializeCanonicalOpenUiAction(action, source, now);
  expect(validateUiActionCorrelation(action, result.result, source)).toBe(true);
  expect(result.result.resultingDocument).toMatchObject({ revision: 1, createdAt, updatedAt: expected });
  expect(result.receipt).toMatchObject({ state: "completed", createdAt: now, updatedAt: now });
  const reopened = new KeatingStorage();
  const replay = await reopened.materializeCanonicalOpenUiAction(action, source, "2026-09-14T23:09:21.000Z");
  expect(replay.replayed).toBe(true);
  expect(replay.receipt).toEqual(result.receipt);
  const answers = await reopened.getQuestionChecks();
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ createdAt: Date.parse(now), grading: "pending" });
  expect(answers[0]?.answer).toContain("3-piece bar");
  expect(source.updatedAt).toBe(updatedAt);
  expect(source.revision).toBe(0);
});
