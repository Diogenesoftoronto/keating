import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { exportFineTuneDataset } from "../src/core/export.js";
import { captureCliFeedback, captureCliLearnerMessages, captureCliQuiz } from "../src/core/learner-events.js";
import { sessionsDir } from "../src/core/paths.js";
import { cliQuizRecordPath } from "../src/core/quiz-grading.js";

const dirs: string[] = [];
const T = 1_786_000_000_000;
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const cwd = await mkdtemp(join(tmpdir(), "export-rewards-test-")); dirs.push(cwd); await mkdir(sessionsDir(cwd), { recursive: true }); return cwd; }
const message = (id: string, role: string, content: string, timestamp: number) => ({ type: "message", id, message: { role, content, timestamp } });
const initial = () => [message("user-1", "user", "Please explain fractions.", T), message("assistant-1", "assistant", "A half is one of two equal parts.", T + 1000)];
async function saved(cwd: string, entries: any[], id = "session-1") {
  await writeFile(join(sessionsDir(cwd), `${id}.json`), JSON.stringify({ id, messages: entries.map(entry => ({ ...entry.message, id: entry.id })) }));
  return { getSessionId: () => id, getBranch: () => entries };
}
async function exported(cwd: string) {
  const result = await exportFineTuneDataset(cwd, { mode: "finetune", source: "sessions", format: "both", redact: true, minAssistantChars: 1 });
  const raw = await readFile(join(result.outDir, "rewarded-turns.jsonl"), "utf8");
  return { result, rows: raw.trim() ? raw.trim().split("\n").map(line => JSON.parse(line)) : [], raw };
}

test("production export joins durable explicit feedback ahead of inferred next-turn feedback", async () => {
  const cwd = await workspace(); const entries = initial();
  const session = await saved(cwd, entries);
  await captureCliFeedback(cwd, session, { topic: "fractions", signal: "thumbs-down", timestamp: new Date(T + 2000).toISOString() });
  entries.push(message("user-2", "user", "Got it, that makes sense now!", T + 3000));
  await saved(cwd, entries); await captureCliLearnerMessages(cwd, session);
  const { result, rows } = await exported(cwd);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sessionId: "session-1", messageId: "assistant-1", reward: 0.15, scored: true, evidenceSource: "proxy" });
  expect(rows[0].signals.explicit).toMatchObject({ joinedBy: "messageId", signal: "thumbs-down" });
  expect(rows[0].signals.inferred).toBeUndefined();
  expect(result.manifest.counts).toMatchObject({ rewardedTurns: 1, scoredTurns: 1 });
  expect(await readFile(join(result.outDir, "train.chatml.jsonl"), "utf8")).toContain("A half");
  expect(await readFile(join(result.outDir, "train.alpaca.jsonl"), "utf8")).toContain("A half");
});

test("same timestamps in another session and changed transcript text cannot inherit rewards", async () => {
  const cwd = await workspace(); const entries = initial();
  const first = await saved(cwd, entries);
  await captureCliFeedback(cwd, first, { topic: "fractions", signal: "thumbs-up", timestamp: new Date(T + 2000).toISOString() });
  await saved(cwd, entries, "other-session");
  entries[1].message.content = "An edited explanation has no matching evidence.";
  await saved(cwd, entries);
  const { rows } = await exported(cwd);
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).toMatchObject({ scored: false, reward: 0.5, signals: {} });
});

test("numeric timing and exact quiz scores are read from the referenced durable submission only", async () => {
  const cwd = await workspace(); const entries = initial(); const session = await saved(cwd, entries);
  const id = "quiz-12345678-abcd";
  const path = cliQuizRecordPath(cwd, id);
  await mkdir(join(path, ".."), { recursive: true });
  const submission = { schemaVersion: 1, id, createdAt: new Date(T + 2000).toISOString(),
    quiz: { slug: "fractions", questions: [{ id: "q1" }, { id: "q2" }] }, answers: { q1: "one", q2: "two" },
    objectiveResults: { q1: true, q2: false }, pendingMathIds: [], timing: { perQuestionMs: { q1: 5000, q2: 15000, invented: 0 } } };
  await writeFile(path, JSON.stringify(submission)); await captureCliQuiz(cwd, session, id);
  const { rows } = await exported(cwd);
  expect(rows[0].signals.quiz).toMatchObject({ score: 0.5, joinedBy: "messageId", timing: { answeredCount: 2 } });
  expect(rows[0].signals.quiz.sourceId).toContain("@sha256:");
  // A pending semantic answer cannot inherit the previous complete score or a model proposal.
  delete (submission.objectiveResults as Record<string, boolean>).q2;
  await writeFile(path, JSON.stringify(submission));
  await writeFile(`${path}.proposal.json`, JSON.stringify({ proposals: [{ proposal: { credit: 1 } }] }));
  expect((await exported(cwd)).rows[0]).toMatchObject({ scored: false, signals: {} });
});

test("Pi JSONL exports the active branch and consumes its actual host entry identities", async () => {
  const cwd = await workspace();
  const session = SessionManager.create(cwd, sessionsDir(cwd));
  const userId = session.appendMessage({ role: "user", content: "Teach fractions.", timestamp: T });
  const assistant = (text: string, timestamp: number) => ({ role: "assistant", content: [{ type: "text", text }], timestamp, api: "openai-responses", provider: "test", model: "fixture", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as any);
  session.appendMessage(assistant("Abandoned branch explanation.", T + 500));
  session.branch(userId);
  const answerId = session.appendMessage(assistant("Two equal pieces each represent a half.", T + 1000));
  await captureCliFeedback(cwd, session, { signal: "thumbs-up", topic: "fractions", timestamp: new Date(T + 2000).toISOString() });
  const { rows, result } = await exported(cwd);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ messageId: answerId, scored: true, evidenceSource: "proxy" });
  expect(await readFile(join(result.outDir, "train.chatml.jsonl"), "utf8")).not.toContain("Abandoned branch");
});

test("legacy sessions stay unscored; rewarded output redacts text and excludes tool/hidden blocks", async () => {
  const cwd = await workspace();
  await writeFile(join(sessionsDir(cwd), "legacy.json"), JSON.stringify({ id: "legacy", messages: [
    { role: "user", content: "My key is sk-secret-example-1234567890", timestamp: T },
    { role: "assistant", content: [{ type: "text", text: "Let's work with fractions." }, { type: "thinking", text: "HIDDEN_REASONING" }], timestamp: T + 1000 },
    { role: "toolResult", content: "PRIVATE_TOOL_BODY", timestamp: T + 2000 },
    { role: "user", content: "Got it!", timestamp: T + 3000 },
  ] }));
  const { rows, raw } = await exported(cwd);
  expect(rows[0]).toMatchObject({ scored: false, reward: 0.5 });
  expect(raw).toContain("[REDACTED]");
  for (const forbidden of ["sk-secret", "PRIVATE_TOOL_BODY", "HIDDEN_REASONING"]) expect(raw).not.toContain(forbidden);
});
