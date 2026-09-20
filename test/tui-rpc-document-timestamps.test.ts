import { expect, setSystemTime, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateUiActionAgainstDocument,
  validateUiActionCorrelation,
  validateUiActionJournal,
  validateUiDocument,
  type UiActionJournal,
  type UiDocument,
} from "../src/tui/learner-contracts.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";
import {
  decodeUiActionResultNotification,
  encodeUiActionEnvelope,
  registerPiUiActionCommand,
} from "../src/tui/ui/rpc-action-transport.js";
import saved from "./fixtures/tui-future-document.json";

// Exact actor document, learner intent, and receiver journal from the saved episode.
const document: unknown = saved.document;
const failedJournal: unknown = saved.retryableJournal;
if (!validateUiDocument(document) || !validateUiActionJournal(failedJournal)) throw new Error("Invalid episode fixture");
const sourceDocument: UiDocument = document;
const retryableJournal: UiActionJournal = failedJournal;
const recordedReceipt = retryableJournal.receipts[0]!;
const action = recordedReceipt.action;

test("the saved choice is valid; malformed choices and backwards document timestamps remain invalid", () => {
  expect(validateUiActionAgainstDocument(action, sourceDocument)).toBe(true);
  expect(action).toMatchObject({ type: "choose-option", optionIds: saved.intent.payload.optionIds });
  expect(saved.intent.actionId).toBe(`${action.documentId}:${action.documentRevision}:compare-slices:${action.type}`);
  expect(validateUiDocument(saved.invalidDocument)).toBe(false);
  expect(() => encodeUiActionEnvelope(action, saved.invalidDocument as UiDocument)).toThrow();
  expect(validateUiDocument({ ...sourceDocument, updatedAt: recordedReceipt.createdAt })).toBe(false);
  expect(Date.parse(sourceDocument.createdAt) - Date.parse(recordedReceipt.createdAt)).toBe(2503);
});

test.each([
  { name: "the exact saved submission", now: recordedReceipt.createdAt, seedRetry: false, createdAt: sourceDocument.createdAt, updatedAt: sourceDocument.updatedAt, expected: sourceDocument.updatedAt },
  { name: "retry of the exact saved failure", now: recordedReceipt.updatedAt, seedRetry: true, createdAt: sourceDocument.createdAt, updatedAt: sourceDocument.updatedAt, expected: sourceDocument.updatedAt },
  { name: "an existing update ahead of the receiver clock", now: recordedReceipt.createdAt, seedRetry: false, createdAt: "2026-09-14T23:09:00.000Z", updatedAt: sourceDocument.updatedAt, expected: sourceDocument.updatedAt },
  { name: "a later wall clock with mixed timestamp precision", now: "2026-09-14T23:09:20.001Z", seedRetry: false, createdAt: "2026-09-14T23:09:20Z", updatedAt: "2026-09-14T23:09:20Z", expected: "2026-09-14T23:09:20.001Z" },
])("receiver completes $name and durably replays it once", async ({ now, seedRetry, createdAt, updatedAt, expected }) => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-rpc-document-time-"));
  try {
    setSystemTime(new Date(now));
    const source = { ...sourceDocument, createdAt, updatedAt };
    const storage = new FileUiActionJournalStorage(cwd, "receiver");
    if (seedRetry) await storage.save(structuredClone(retryableJournal));
    type Registration = Parameters<Parameters<typeof registerPiUiActionCommand>[0]["registerCommand"]>[1];
    let handler!: Registration["handler"];
    const notifications: string[] = [];
    const sent: unknown[] = [];
    const branch: unknown[] = [];
    const pi: Parameters<typeof registerPiUiActionCommand>[0] = {
      registerCommand(_name, command) { handler = command.handler; },
      sendMessage(message, options) {
        sent.push({ message, options });
        branch.push({ type: "custom_message", ...message });
      },
    };
    const ctx = { cwd, sessionManager: { getSessionId: () => "saved-episode", getBranch: () => branch }, ui: { notify(message: string) { notifications.push(message); } } };
    registerPiUiActionCommand(pi);
    const envelope = encodeUiActionEnvelope(action, source);
    await handler(envelope, ctx);
    const result = decodeUiActionResultNotification(notifications[0]!);
    expect(result).toMatchObject({ status: "completed", resultingDocument: { createdAt, updatedAt: expected, revision: 1 } });
    expect(validateUiActionCorrelation(action, result!, source)).toBe(true);
    expect(result?.resultingDocument?.nodes).toEqual([expect.objectContaining({
      type: "callout", title: "Answer recorded", markdown: "Your answer: 3-piece-bigger\n\nThis response requires tutor review.",
    })]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ options: { triggerTurn: true, deliverAs: "followUp" } });
    const journal = await storage.load(source.id);
    expect(journal?.receipts).toHaveLength(1);
    expect(journal?.receipts[0]).toMatchObject({ action, state: "completed", result });

    registerPiUiActionCommand(pi); // Restart the receiver; the receipt and session prevent duplicate delivery.
    await handler(envelope, ctx);
    expect(decodeUiActionResultNotification(notifications[1]!)).toEqual(result);
    expect(sent).toHaveLength(1);
    expect(await storage.load(source.id)).toEqual(journal);
    expect(source.nodes[0]?.type).toBe("question");

    // A reused key still cannot replace the saved learner answer.
    if (action.type !== "choose-option") throw new Error("Expected saved choice action");
    await handler(encodeUiActionEnvelope({ ...action, optionIds: ["same-size"] }, source), ctx);
    expect(decodeUiActionResultNotification(notifications[2]!)).toMatchObject({
      status: "retryable", message: expect.stringContaining("different entered work"),
    });
    expect(sent).toHaveLength(1);
    expect(await storage.load(source.id)).toEqual(journal);
  } finally {
    setSystemTime();
    await rm(cwd, { recursive: true, force: true });
  }
});
