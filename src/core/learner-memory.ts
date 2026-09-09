import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { learnerMemoryPath } from "./paths.js";

// Matches the browser's existing four categories, with a narrow category for current study context.
export const LEARNER_MEMORY_CATEGORIES = ["motivation", "communication-preference", "learning-preference", "interest", "study-context"] as const;
export type LearnerMemoryCategory = typeof LEARNER_MEMORY_CATEGORIES[number];
export interface LearnerMemoryFact {
  id: string;
  category: LearnerMemoryCategory;
  value: string;
  source: "explicit" | "observed";
  evidence: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  supersedesId?: string;
  provenance: { sessionId: string; messageId: string; quoteSha256: string };
}
export interface LearnerMemoryInput {
  category: LearnerMemoryCategory;
  value: string;
  source: "explicit" | "observed";
  evidence: string;
  confidence?: number;
  supersedes_id?: string;
}
export interface LearnerMemorySession {
  getSessionId(): string;
  getBranch(): readonly unknown[];
}

function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`learner_memory_invalid_${label}`);
  return value.trim();
}

/** Ground a quoted span in actual user text, never in assistant replies, tool results or a supplied session ID. */
export function groundLearnerMemoryEvidence(session: LearnerMemorySession, evidence: string): LearnerMemoryFact["provenance"] {
  if (!session || typeof session.getSessionId !== "function" || typeof session.getBranch !== "function") throw new Error("learner_memory_session_required");
  const sessionId = boundedText(session.getSessionId(), 200, "session");
  for (const entry of [...session.getBranch()].reverse() as any[]) {
    if (entry?.type !== "message" || entry.message?.role !== "user" || typeof entry.id !== "string") continue;
    const content = entry.message.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n") : "";
    if (text.includes(evidence)) return { sessionId, messageId: entry.id, quoteSha256: createHash("sha256").update(evidence).digest("hex") };
  }
  throw new Error("learner_memory_evidence_not_in_learner_message");
}

export async function loadLearnerMemory(cwd: string): Promise<LearnerMemoryFact[]> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(learnerMemoryPath(cwd), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const record = raw as { schemaVersion?: unknown; facts?: unknown } | null;
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.facts) || record.facts.length > 128) throw new Error("learner_memory_invalid_file");
  for (const fact of record.facts) {
    if (!fact || typeof fact !== "object" || !/^lm-[a-f0-9-]{36}$/.test(fact.id)
      || !LEARNER_MEMORY_CATEGORIES.includes(fact.category) || !["explicit", "observed"].includes(fact.source)
      || typeof fact.value !== "string" || !fact.value.trim() || fact.value.length > 240
      || typeof fact.evidence !== "string" || !fact.evidence.trim() || fact.evidence.length > 500
      || !Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > (fact.source === "observed" ? 0.65 : 1)
      || !Number.isFinite(fact.createdAt) || !Number.isFinite(fact.updatedAt)
      || typeof fact.provenance?.sessionId !== "string" || typeof fact.provenance?.messageId !== "string"
      || !/^[a-f0-9]{64}$/.test(fact.provenance?.quoteSha256)) throw new Error("learner_memory_invalid_file");
  }
  if (new Set(record.facts.map((fact) => fact.id)).size !== record.facts.length) throw new Error("learner_memory_duplicate_ids");
  return record.facts;
}

async function mutate<T>(cwd: string, operation: (facts: LearnerMemoryFact[]) => T): Promise<T> {
  const target = learnerMemoryPath(cwd);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const lock = await open(`${target}.lock`, "wx", 0o600).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("learner_memory_busy_retry_later");
    throw error;
  });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const facts = await loadLearnerMemory(cwd);
    const result = operation(facts);
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify({ schemaVersion: 1, facts }, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, target);
    return result;
  } finally { await lock.close(); await rm(`${target}.lock`, { force: true }); await rm(temporary, { force: true }); }
}

export async function rememberLearnerMemory(cwd: string, input: LearnerMemoryInput, session: LearnerMemorySession): Promise<LearnerMemoryFact> {
  if (!LEARNER_MEMORY_CATEGORIES.includes(input.category) || !["explicit", "observed"].includes(input.source)) throw new Error("learner_memory_invalid_category_or_source");
  const value = boundedText(input.value, 240, "value");
  const evidence = boundedText(input.evidence, 500, "evidence");
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) throw new Error("learner_memory_invalid_confidence");
  const provenance = groundLearnerMemoryEvidence(session, evidence);
  return mutate(cwd, (facts) => {
    const previous = input.supersedes_id === undefined ? undefined : facts.find((fact) => fact.id === input.supersedes_id);
    if (input.supersedes_id !== undefined && !previous) throw new Error("learner_memory_unknown_superseded_id");
    if (previous?.source === "explicit" && input.source !== "explicit") throw new Error("learner_memory_explicit_correction_required");
    const existing = facts.find((fact) => fact.category === input.category && fact.value.toLocaleLowerCase() === value.toLocaleLowerCase());
    if (existing && existing.id !== previous?.id) {
      if (previous) throw new Error("learner_memory_correction_duplicates_active_fact");
      if (existing.source === "explicit" && input.source === "observed") return { ...existing };
      existing.source = input.source;
      existing.confidence = input.source === "explicit" ? 1 : Math.min(0.65, input.confidence ?? 0.45);
      existing.evidence = evidence;
      existing.provenance = provenance;
      existing.updatedAt = Date.now();
      return { ...existing };
    }
    if (!previous && facts.length >= 128) throw new Error("learner_memory_capacity_reached");
    const now = Date.now();
    const fact: LearnerMemoryFact = { id: `lm-${randomUUID()}`, category: input.category, value, source: input.source, evidence,
      confidence: input.source === "explicit" ? 1 : Math.min(0.65, input.confidence ?? 0.45), createdAt: now, updatedAt: now, provenance,
      ...(previous ? { supersedesId: previous.id } : {}) };
    if (previous) facts.splice(facts.indexOf(previous), 1);
    facts.push(fact);
    return fact;
  });
}

/** Remove the active fact and its evidence, without promising erasure of historical chat transcripts. */
export async function forgetLearnerMemory(cwd: string, id: string): Promise<{ forgottenId: string }> {
  return mutate(cwd, (facts) => {
    const index = facts.findIndex((fact) => fact.id === id);
    if (index < 0) throw new Error("learner_memory_unknown_id");
    facts.splice(index, 1);
    return { forgottenId: id };
  });
}
