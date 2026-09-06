import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  createLearningCheck, parseLearningCheckRecord, presentLearningCheck, submitLearningCheckResponse,
  type LearningCheckRecord, type LearningCheckSubmission, type LearningCheckTopic, type LearningCheckView,
} from "../../shared/evolution/learning-checks.js";

export type { LearningCheckSubmission, LearningCheckTopic, LearningCheckView } from "../../shared/evolution/learning-checks.js";
export interface LearningCheckClock { now?: () => Date }
const validId = /^lc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function root(cwd: string): string { return join(cwd, ".keating", "state", "learning-checks"); }
function recordPath(cwd: string, id: string): string {
  if (!validId.test(id)) throw new Error("Invalid learning-check id.");
  return join(root(cwd), `${id}.json`);
}
function now(clock: LearningCheckClock): string { return (clock.now?.() ?? new Date()).toISOString(); }
function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
async function readRecord(cwd: string, id: string): Promise<LearningCheckRecord> {
  const record = parseLearningCheckRecord(JSON.parse(await readFile(recordPath(cwd, id), "utf8")));
  if (record.id !== id) throw new Error("Learning-check record id does not match its filename.");
  return record;
}
async function persist(cwd: string, record: LearningCheckRecord): Promise<void> {
  const target = recordPath(cwd, record.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await file.sync();
    await file.close();
    await rename(temporary, target);
  } finally {
    await file.close().catch(() => {});
    await rm(temporary, { force: true });
  }
}
async function locked<T>(cwd: string, id: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${recordPath(cwd, id)}.lock`;
  await mkdir(root(cwd), { recursive: true, mode: 0o700 });
  let lock;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { lock = await open(lockPath, "wx", 0o600); break; }
    catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      await pause(25);
    }
  }
  if (!lock) throw new Error("Learning check is locked by another update; retry later.");
  try { return await action(); }
  finally { await lock.close(); await rm(lockPath, { force: true }); }
}

export async function startLearningCheck(
  cwd: string,
  input: { topic: LearningCheckTopic; revisionId: string; learnerId?: string },
  clock: LearningCheckClock = {},
): Promise<LearningCheckView> {
  const record = createLearningCheck({ ...input, id: `lc-${randomUUID()}`, startedAt: now(clock) });
  return locked(cwd, record.id, async () => {
    await persist(cwd, record);
    return presentLearningCheck(record, now(clock));
  });
}

export async function submitLearningCheck(
  cwd: string, id: string, submission: LearningCheckSubmission, clock: LearningCheckClock = {},
): Promise<LearningCheckView> {
  return locked(cwd, id, async () => {
    const record = await readRecord(cwd, id);
    const next = submitLearningCheckResponse(record, submission, now(clock));
    if (next !== record) await persist(cwd, next);
    return presentLearningCheck(next, now(clock));
  });
}

export async function getLearningCheck(cwd: string, id: string, clock: LearningCheckClock = {}): Promise<LearningCheckView> {
  return presentLearningCheck(await readRecord(cwd, id), now(clock));
}

export async function listLearningChecks(cwd: string, clock: LearningCheckClock = {}): Promise<LearningCheckView[]> {
  const files = await readdir(root(cwd), { withFileTypes: true }).catch((error: unknown) => {
    if (isCode(error, "ENOENT")) return [];
    throw error;
  });
  const checks = await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith(".json") && validId.test(file.name.slice(0, -5)))
    .map((file) => getLearningCheck(cwd, file.name.slice(0, -5), clock)));
  return checks.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}
