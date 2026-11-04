import { afterEach, beforeEach, expect, test } from "bun:test";
import type { MemoryAdmissionDecision, TeachingDraftSnapshot } from "@keating/learner-contracts";
import { configureJudgementDiagnostics } from "../keating/judgement/diagnostics";
import { beginTurn, clearTurnLedger, finishTurn, getTurnLedger, noteTurnDraft, noteTurnExtraction, noteTurnMemoryDecisions, noteTurnReceipt,
  noteTurnReplyReview, setTurnJudgementSavingEnabled, setTurnJudgementSink } from "../keating/judgement/turn-ledger";
import type { TurnJudgementRecord } from "../keating/judgement/turn-records";

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
let saved: TurnJudgementRecord[] = [];
let previousWindow: PropertyDescriptor | undefined, previousStorage: PropertyDescriptor | undefined;
beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  values.clear(); saved = [];
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: Object.assign(new EventTarget(), { CustomEvent }) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
  setTurnJudgementSink(async record => { saved.push(record); });
});
afterEach(() => {
  configureJudgementDiagnostics({ enabled: false, details: false });
  setTurnJudgementSavingEnabled(false); clearTurnLedger(); setTurnJudgementSink(null);
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage); else Reflect.deleteProperty(globalThis, "localStorage");
});

const snapshot = { phase: "released", attempt: 1, maxAttempts: 2, reasoning: "low", standard: "supported", elapsedMs: 900, judgeModel: "jev",
  selectedAttempt: 1, reason: null, attempts: [{ attempt: 1, reasoning: "low", standard: "supported", generationMs: 1, judgementMs: 1, status: "pass", variant: "default",
    checks: [{ id: "mastery_overclaimed", status: "fail", source: "jev", severity: "critical", probability: 0.4 }] }] } as unknown as TeachingDraftSnapshot;
const messages = [{ role: "user", timestamp: 10, content: "I like orbits." }, { role: "assistant", timestamp: 20, content: "Great." }];
const decision = { candidate: { id: "c1", evidence: "I like orbits.", sessionId: "s", messageId: "m", message: "I like orbits.", start: 0, end: 14 },
  accepted: true, reason: "accepted", category: "interest", probability: 0.95, backend: { backend: "system-one", model: "jev", calibrationSha256: "a".repeat(64) },
  thresholds: { worth: { deferBelow: 0.7, actAtOrAbove: 0.9 }, category: null } } as unknown as MemoryAdmissionDecision;
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

function runTurn() {
  beginTurn("s", messages.slice(0, 1));
  noteTurnDraft("s", { ...snapshot, phase: "checking" } as TeachingDraftSnapshot);
  noteTurnReceipt("s", 20, snapshot);
  finishTurn("s", messages);
  noteTurnReplyReview("s", 20, { backend: { backend: "system-one", model: "jev", calibrationSha256: null },
    answers: { move: { type: "choice", choice: "explain", confidence: 0.8, probabilities: { explain: 0.8, question: 0.2 } } } }, false);
  noteTurnExtraction("s", 10, { role: "learner", status: "completed", items: [{ kind: "memory", messageId: "m", start: 0, end: 14, quote: "I like orbits." }], reasons: [] });
  noteTurnMemoryDecisions("s", [decision], "account-a", true);
}

test("every judgement of one turn lands on the same entry, in memory only, while capture is on", async () => {
  configureJudgementDiagnostics({ enabled: true });
  runTurn();
  const [turn] = getTurnLedger();
  expect(getTurnLedger()).toHaveLength(1);
  expect(turn).toMatchObject({ status: "completed", learnerTimestamp: 10, assistantTimestamp: 20 });
  expect(turn!.draft?.phase).toBe("released");
  expect(turn!.replyReview?.answers[0]).toMatchObject({ id: "move", choice: "explain" });
  expect(turn!.memory[0]).toMatchObject({ accepted: true, threshold: 0.9, scope: "account-a" });
  // Without saving or redacted details, exact passages are not kept.
  expect(turn!.extraction[0]!.items[0]!.quote).toBeUndefined();
  expect(turn!.memory[0]!.candidate.evidence).toBe("");
  await settle();
  expect(saved).toEqual([]);
});

test("saving for review persists the turn record with passages and without drafts", async () => {
  setTurnJudgementSavingEnabled(true);
  runTurn();
  await settle();
  const record = saved.at(-1)!;
  expect(record.id).toBe("s:20");
  expect(record.extraction[0]!.items[0]!.quote).toBe("I like orbits.");
  expect(record.memory[0]!.candidate.evidence).toBe("I like orbits.");
  expect(record).not.toHaveProperty("draft");
});

test("nothing is recorded while capture and saving are both off", () => {
  runTurn();
  expect(getTurnLedger()).toEqual([]);
});

test("a new turn before the reply ends marks the unanswered one cancelled", () => {
  configureJudgementDiagnostics({ enabled: true });
  beginTurn("s", messages.slice(0, 1));
  beginTurn("s", [...messages, { role: "user", timestamp: 30, content: "Next" }]);
  expect(getTurnLedger().map(turn => turn.status)).toEqual(["cancelled", "running"]);
});
