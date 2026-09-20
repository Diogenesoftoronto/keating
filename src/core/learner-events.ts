/** Private, immutable source references. Chat text, tool bodies and credentials stay out of this log. */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./paths.js";
import type { LearnerMemorySession } from "./learner-memory.js";
import { loadCliQuizRecord } from "./quiz-grading.js";

interface EventBase { schemaVersion: 1; id: string; sessionId: string; messageId: string; timestamp: number }
export type CliLearnerEvent = EventBase & (
  | { kind: "message"; role: "user" | "assistant"; contentSha256: string }
  | { kind: "feedback"; signal: "thumbs-up" | "thumbs-down" | "confused"; topic: string }
  | { kind: "quiz"; quizId: string }
);
export interface CliSourceMessage { id: string; role: "user" | "assistant"; content: string; timestamp?: number }
export function cliSourceHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
export function cliEventDirectory(cwd: string, sessionId: string): string {
  return join(stateDir(cwd), "learner-events", cliSourceHash(sessionId));
}
function normalizeEvent(input: CliLearnerEvent): CliLearnerEvent {
  if (input.schemaVersion !== 1 || !identifier(input.id) || !identifier(input.sessionId) || !identifier(input.messageId)
    || !Number.isFinite(input.timestamp) || input.timestamp < 0) throw Error("learner_event_invalid");
  const base: EventBase = { schemaVersion: 1, id: input.id, sessionId: input.sessionId, messageId: input.messageId, timestamp: input.timestamp };
  if (input.kind === "message" && ["user", "assistant"].includes(input.role) && /^[a-f0-9]{64}$/.test(input.contentSha256))
    return { ...base, kind: "message", role: input.role, contentSha256: input.contentSha256 };
  if (input.kind === "feedback" && ["thumbs-up", "thumbs-down", "confused"].includes(input.signal)
    && typeof input.topic === "string" && input.topic.length > 0 && input.topic.length <= 200)
    return { ...base, kind: "feedback", signal: input.signal, topic: input.topic };
  if (input.kind === "quiz" && /^quiz-[a-z0-9-]{8,90}$/.test(input.quizId)) return { ...base, kind: "quiz", quizId: input.quizId };
  throw Error("learner_event_invalid");
}

/** Atomic publish plus exclusive link gives durable replay protection across processes. */
export async function appendCliLearnerEvent(cwd: string, input: CliLearnerEvent): Promise<void> {
  const event = normalizeEvent(input);
  const directory = cliEventDirectory(cwd, event.sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${cliSourceHash(event.id)}.json`);
  const temporary = join(directory, `${randomUUID()}.tmp`);
  const encoded = JSON.stringify(event) + "\n";
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await readFile(path, "utf8") !== encoded) throw Error("learner_event_conflict");
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function loadCliLearnerEvents(cwd: string, sessionId: string): Promise<CliLearnerEvent[]> {
  const directory = cliEventDirectory(cwd, sessionId);
  const names = await readdir(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const events: CliLearnerEvent[] = [];
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
    const path = join(directory, name);
    if ((await stat(path)).size > 4096) throw Error("learner_event_invalid");
    const event = normalizeEvent(JSON.parse(await readFile(path, "utf8")));
    if (event.sessionId !== sessionId || name !== `${cliSourceHash(event.id)}.json`) throw Error("learner_event_source_mismatch");
    events.push(event);
  }
  return events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** Explicit text blocks only: no tool results, tool arguments, thinking, images or attachments. */
export function cliSourceMessages(entries: readonly unknown[]): CliSourceMessage[] {
  return entries.flatMap((value): CliSourceMessage[] => {
    const entry = value as any;
    const message = entry?.message;
    if (entry?.type !== "message" || !identifier(entry.id) || !["user", "assistant"].includes(message?.role)
      || (message.role === "assistant" && ["error", "aborted"].includes(message.stopReason))) return [];
    const content = typeof message.content === "string" ? message.content : Array.isArray(message.content)
      ? message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n") : "";
    if (!content.trim()) return [];
    const time = typeof message.timestamp === "number" ? message.timestamp : Date.parse(entry.timestamp);
    return [{ id: entry.id, role: message.role, content, ...(Number.isFinite(time) && time >= 0 ? { timestamp: time } : {}) }];
  });
}

export async function captureCliLearnerMessages(cwd: string, session?: LearnerMemorySession): Promise<void> {
  if (typeof session?.getSessionId !== "function" || typeof session?.getBranch !== "function") return;
  const sessionId = session.getSessionId();
  if (!identifier(sessionId)) return;
  for (const message of cliSourceMessages(session.getBranch())) {
    if (message.timestamp === undefined) continue;
    await appendCliLearnerEvent(cwd, { schemaVersion: 1, id: `message-${message.id}`, kind: "message", sessionId,
      messageId: message.id, timestamp: message.timestamp, role: message.role, contentSha256: cliSourceHash(message.content) });
  }
}

export async function captureCliFeedback(cwd: string, session: LearnerMemorySession | undefined, input: {
  signal: "thumbs-up" | "thumbs-down" | "confused"; topic: string; timestamp: string;
}): Promise<void> {
  if (typeof session?.getSessionId !== "function" || typeof session?.getBranch !== "function") return;
  await captureCliLearnerMessages(cwd, session);
  const message = cliSourceMessages(session.getBranch()).reverse().find(message => message.role === "assistant");
  const timestamp = Date.parse(input.timestamp);
  if (!message || !Number.isFinite(timestamp)) return;
  const sessionId = session.getSessionId();
  await appendCliLearnerEvent(cwd, { schemaVersion: 1, id: `feedback-${cliSourceHash(JSON.stringify([sessionId, message.id, input.signal, timestamp]))}`,
    kind: "feedback", sessionId, messageId: message.id, timestamp, signal: input.signal, topic: input.topic });
}

/** Only a durable quiz ID is copied from the quiz tool's typed metadata. Never trust its text or model proposal as a score. */
export async function captureCliQuiz(cwd: string, session: LearnerMemorySession | undefined, quizId: unknown): Promise<void> {
  if (typeof session?.getSessionId !== "function" || typeof session?.getBranch !== "function"
    || typeof quizId !== "string" || !/^quiz-[a-z0-9-]{8,90}$/.test(quizId)) return;
  const record = await loadCliQuizRecord(cwd, quizId);
  if (!record) return;
  await captureCliLearnerMessages(cwd, session);
  const timestamp = Date.parse(record.submission.createdAt);
  const message = cliSourceMessages(session.getBranch()).reverse().find(message => message.role === "assistant"
    && message.timestamp !== undefined && message.timestamp <= timestamp);
  if (!message || !Number.isFinite(timestamp)) return;
  await appendCliLearnerEvent(cwd, { schemaVersion: 1, id: `quiz-${quizId}`, kind: "quiz", sessionId: session.getSessionId(),
    messageId: message.id, timestamp, quizId });
}
