import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UiAction, UiDocument } from "../src/tui/learner-contracts.js";
import { registerPiUiActionCommand, encodeUiActionEnvelope, decodeUiActionResultNotification } from "../src/tui/ui/rpc-action-transport.js";
import { FileUiActionJournalStorage } from "../src/tui/ui/filesystem-journal.js";

const document: UiDocument = { schemaVersion: 1, id: "feedback-test", revision: 0, lifecycle: "ready", supportedSurfaces: ["terminal"],
  createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z",
  nodes: [{ type: "question", id: "why", prompt: "Why is this causal claim unsupported?", kind: "short_answer", correctAnswer: "Confounding" }] };
const action: UiAction = { schemaVersion: 1, documentId: document.id, documentRevision: 0, nodeId: "why", type: "submit-answer",
  answer: "The groups self-selected, so prior differences could explain the result.", idempotencyKey: "explanation-1" };

test("saved learner work enters the tutor loop once and survives receiver restart", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-feedback-regression-"));
  try {
    let handler: any;
    const branch: any[] = [];
    const sent: any[] = [];
    const notifications: string[] = [];
    const pi = {
      registerCommand(_name: string, command: any) { handler = command.handler; },
      sendMessage(message: any, options: any) { sent.push({ message, options }); branch.push({ type: "custom_message", ...message }); },
    };
    const ctx = { cwd, sessionManager: { getSessionId: () => "session", getBranch: () => branch }, ui: { notify(message: string) { notifications.push(message); } } };
    registerPiUiActionCommand(pi);
    const envelope = encodeUiActionEnvelope(action, document);
    await handler(envelope, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0].options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
    expect(sent[0].message.content).toContain(action.answer);
    expect(sent[0].message.content).toContain("Why is this causal claim unsupported?");
    expect(sent[0].message.details.document.revision).toBe(1);
    expect(sent[0].message.details.learnerSummary).toContain(action.answer);
    const journal = await new FileUiActionJournalStorage(cwd, "receiver").load(document.id);
    expect(journal?.receipts[0]?.state).toBe("completed");
    const result = decodeUiActionResultNotification(notifications[0]!);
    expect(JSON.stringify(result?.resultingDocument)).not.toContain("check this");
    expect(JSON.stringify(result?.resultingDocument)).toContain("requires tutor review");
    await handler(envelope, ctx);
    registerPiUiActionCommand(pi); // New extension instance; de-duplicate using persisted session entries.
    await handler(envelope, ctx);
    expect(sent).toHaveLength(1);
    expect(decodeUiActionResultNotification(notifications[2]!)).toEqual(result);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("missing tutor transport returns retryable after preserving work, not a false teaching success", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-feedback-unavailable-"));
  try {
    let handler: any;
    const notifications: string[] = [];
    registerPiUiActionCommand({ registerCommand(_name, command) { handler = command.handler; } });
    await handler(encodeUiActionEnvelope(action, document), { cwd, ui: { notify(message: string) { notifications.push(message); } } });
    expect(decodeUiActionResultNotification(notifications[0]!)?.status).toBe("retryable");
    expect((await new FileUiActionJournalStorage(cwd, "receiver").load(document.id))?.receipts).toHaveLength(1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a failed tutor handoff retries the saved action without duplicating its state change", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "keating-feedback-retry-"));
  try {
    let handler: any;
    let attempts = 0;
    const sent: any[] = [];
    const notifications: string[] = [];
    registerPiUiActionCommand({
      registerCommand(_name, command) { handler = command.handler; },
      sendMessage(message) { attempts++; if (attempts === 1) throw new Error("Disconnected"); sent.push(message); },
    });
    const ctx = { cwd, ui: { notify(message: string) { notifications.push(message); } } };
    await handler(encodeUiActionEnvelope(action, document), ctx);
    expect(decodeUiActionResultNotification(notifications[0]!)?.status).toBe("retryable");
    await handler(encodeUiActionEnvelope(action, document), ctx);
    expect(decodeUiActionResultNotification(notifications[1]!)?.status).toBe("completed");
    expect(sent).toHaveLength(1);
    const journal = await new FileUiActionJournalStorage(cwd, "receiver").load(document.id);
    expect(journal?.receipts).toHaveLength(1);
    expect(journal?.receipts[0]?.result?.resultingDocument?.revision).toBe(1);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
