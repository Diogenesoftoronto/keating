import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCliLearnerEvent, captureCliFeedback, captureCliLearnerMessages, cliEventDirectory, cliSourceHash, loadCliLearnerEvents } from "../src/core/learner-events.js";
import { withLearnerProfile } from "../src/core/learner-profile-selection.js";
import hyperteacher from "../src/pi/hyper-teacher/index.js";
import { runHarnessEpisode } from "../scripts/training/benchmark_harness_v3.js";
import { ensureProjectScaffold } from "../src/core/project.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { sessionsDir } from "../src/core/paths.js";
import { exportFineTuneDataset } from "../src/core/export.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const cwd = await mkdtemp(join(tmpdir(), "learner-events-test-")); dirs.push(cwd); return cwd; }
const T = 1_786_000_000_000;
const entries = [
  { type: "message", id: "user-1", message: { role: "user", timestamp: T, content: "Private learner text sk-example-secret-value" } },
  { type: "message", id: "assistant-1", message: { role: "assistant", timestamp: T + 1000, content: [{ type: "text", text: "A fraction is an equal part." }, { type: "thinking", text: "PRIVATE_THINKING" }, { type: "toolCall", arguments: { secret: "PRIVATE_ARGUMENT" } }] } },
  { type: "message", id: "tool-1", message: { role: "toolResult", timestamp: T + 1500, content: "PRIVATE_TOOL_BODY" } },
];
const session = { getSessionId: () => "session-1", getBranch: () => entries };

test("event capture persists only source references and replays idempotently across concurrent writers", async () => {
  const cwd = await workspace();
  await Promise.all([captureCliLearnerMessages(cwd, session), captureCliLearnerMessages(cwd, session)]);
  const events = await loadCliLearnerEvents(cwd, "session-1");
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ messageId: "assistant-1", role: "assistant", contentSha256: cliSourceHash("A fraction is an equal part.") });
  const directory = cliEventDirectory(cwd, "session-1");
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const raw = await readFile(path, "utf8");
    for (const forbidden of ["Private learner text", "sk-example", "PRIVATE_THINKING", "PRIVATE_ARGUMENT", "PRIVATE_TOOL_BODY"]) expect(raw).not.toContain(forbidden);
  }
  await expect(appendCliLearnerEvent(cwd, { ...events[0], timestamp: T + 1 })).rejects.toThrow("learner_event_conflict");
  expect(await loadCliLearnerEvents(cwd, "session-1")).toEqual(events);
});

test("feedback references the host's last visible assistant and named learners remain isolated", async () => {
  const cwd = await workspace();
  await withLearnerProfile(cwd, "ada", async () => {
    const input = { signal: "thumbs-down" as const, topic: "fractions", timestamp: new Date(T + 2000).toISOString() };
    await captureCliFeedback(cwd, session, input);
    await captureCliFeedback(cwd, session, input);
    const events = await loadCliLearnerEvents(cwd, "session-1");
    expect(events.filter(event => event.kind === "feedback")).toEqual([expect.objectContaining({ messageId: "assistant-1", signal: "thumbs-down", sessionId: "session-1" })]);
  });
  await withLearnerProfile(cwd, "bob", async () => { expect(await loadCliLearnerEvents(cwd, "session-1")).toEqual([]); });
  expect(await loadCliLearnerEvents(cwd, "other-session")).toEqual([]);
});

test("real Pi extension completion hook records the persisted branch without consuming streamed or tool bodies", async () => {
  const cwd = await workspace();
  const hooks = new Map<string, (event: any, ctx: any) => Promise<void>>();
  hyperteacher({ registerCommand() {}, registerTool() {}, on(name: string, callback: any) { hooks.set(name, callback); } });
  const ctx = { cwd, sessionManager: session, ui: { notify() {} } };
  await hooks.get("agent_end")!({ messages: [{ role: "user", content: "WRONG_TRANSIENT" }] }, ctx);
  await hooks.get("agent_end")!({}, ctx);
  await hooks.get("tool_result")!({ toolName: "bash", details: { resultId: "quiz-malicious" }, content: "PRIVATE_TOOL_BODY" }, ctx);
  expect(await loadCliLearnerEvents(cwd, "session-1")).toHaveLength(2);
});

test("actual offline Pi persists message events and production export consumes their source-bound next turn", async () => {
  const cwd = await workspace(); await ensureProjectScaffold(cwd);
  const result = await runHarnessEpisode({ id: "durable-learner-event-export",
    transport: { kind: "tape", responses: [{ text: "A fraction names an equal part of a whole." }, { text: "Let us try another example." }] },
    steps: [{ kind: "message", text: "Please explain fractions." }, { kind: "message", text: "Got it, that makes sense now!" }],
    limits: { turn_timeout_ms: 20_000 } }, error => console.error("Offline learner-event harness diagnostic:", error));
  expect({ status: result.status, error: result.error_code }).toEqual({ status: "completed", error: null });
  // The harness isolates and removes its workspace; replay its exact durable
  // receipts in this temporary export workspace, not reconstructed events.
  for (const receipt of [...result.session_files, ...result.files.filter(file => file.path.startsWith(".keating/state/learner-events/"))]) {
    const path = join(cwd, receipt.path);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, receipt.content);
  }
  const sessionFiles = result.session_files.filter(file => file.path.endsWith(".jsonl"));
  expect(sessionFiles).toHaveLength(1);
  // SessionManager.list filters by the original header cwd; copied receipts
  // intentionally preserve that header, so open the recorded file directly.
  const session = SessionManager.open(join(cwd, sessionFiles[0].path));
  const events = await loadCliLearnerEvents(cwd, session.getSessionId());
  expect(events.filter(event => event.kind === "message")).toHaveLength(4);
  const exported = await exportFineTuneDataset(cwd, { mode: "finetune", source: "sessions", format: "chatml", redact: true, minAssistantChars: 1 });
  const rows = (await readFile(join(exported.outDir, "rewarded-turns.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(rows[0]).toMatchObject({ scored: true, evidenceSource: "proxy", signals: { inferred: { joinedBy: "nextTurn", signal: "thumbs-up" } } });
  expect(rows[1]).toMatchObject({ scored: false, reward: 0.5 });
}, 30_000);
