import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { learnerMemoryPath } from "./paths.js";
import { isAcceptedMemoryAdmissionDecision, isConsistentMemoryAdmissionDecision, type MemoryAdmissionDecision } from "../../packages/learner-contracts/src/judgement/memory-admission.js";
import type { CalibrationTable } from "../../packages/learner-contracts/src/judgement/projections.js";

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
  /** Model admission remains proxy evidence, even though the legacy source enum is observed. */
  judgement?: MemoryAdmissionDecision;
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

function canonical(value: unknown): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, sort(value)])) : value;
  return JSON.stringify(sort(value));
}
/** Snapshot identity used to reject a review of facts that changed before admission. */
export function learnerMemoryDigest(facts: readonly LearnerMemoryFact[]): string {
  return createHash("sha256").update(canonical(facts)).digest("hex");
}

function savedJudgementValid(fact: LearnerMemoryFact): boolean {
  const decision = fact.judgement;
  if (decision === undefined) return true;
  return isConsistentMemoryAdmissionDecision(decision) && fact.source === "observed"
    && fact.category === decision.category && fact.value === decision.candidate.evidence && fact.evidence === decision.candidate.evidence
    && fact.confidence === Math.min(0.65, decision.probability!)
    && fact.provenance.sessionId === decision.candidate.sessionId && fact.provenance.messageId === decision.candidate.messageId
    && fact.provenance.quoteSha256 === createHash("sha256").update(fact.evidence).digest("hex");
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

const MAX_MEMORY_BYTES = 2 * 1024 * 1024;
function assertOwned(metadata: { uid: number; nlink?: number }): void {
  if ((process.getuid && metadata.uid !== process.getuid()) || (metadata.nlink !== undefined && metadata.nlink !== 1)) {
    throw new Error("learner_memory_private_storage_required");
  }
}
async function memoryDirectory(cwd: string, target: string, create: boolean): Promise<boolean> {
  const root = resolve(cwd); const parts = relative(root, dirname(target)).split(sep);
  if (parts.some(part => !part || part === "..")) throw new Error("learner_memory_invalid_path");
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const metadata = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!metadata) return false;
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("learner_memory_invalid_path");
    assertOwned({ uid: metadata.uid });
  }
  if (create && process.platform !== "win32") await chmod(dirname(target), 0o700);
  return true;
}
async function loadMemoryFile(target: string): Promise<LearnerMemoryFact[]> {
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(error => {
    if (error.code === "ENOENT") return null; throw error;
  });
  if (!file) return [];
  let raw: unknown;
  try {
    const metadata = await file.stat(); assertOwned(metadata);
    if (!metadata.isFile() || metadata.size > MAX_MEMORY_BYTES) throw new Error("learner_memory_invalid_file");
    if (process.platform !== "win32") await file.chmod(0o600);
    const text = await file.readFile("utf8");
    if (Buffer.byteLength(text) > MAX_MEMORY_BYTES) throw new Error("learner_memory_invalid_file");
    raw = JSON.parse(text);
  } finally { await file.close(); }
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
    if (!savedJudgementValid(fact)) throw new Error("learner_memory_invalid_judgement");
  }
  if (new Set(record.facts.map((fact) => fact.id)).size !== record.facts.length) throw new Error("learner_memory_duplicate_ids");
  return record.facts;
}

export interface LearnerMemoryAdmissionOptions {
  /** Must come from the host's verified calibration artifact, never from a model response. */
  calibration: CalibrationTable;
  expectedMemorySha256?: string;
  isCurrent: () => boolean;
  now?: () => number;
}

function exactAdmissionSource(decision: MemoryAdmissionDecision, session: LearnerMemorySession): void {
  const source = decision.candidate;
  if (session.getSessionId() !== source.sessionId) throw new Error("learner_memory_source_changed");
  const entries = session.getBranch().filter((entry: any) => entry?.id === source.messageId) as any[];
  const entry = entries[0];
  if (entries.length !== 1 || entry?.type !== "message" || entry.message?.role !== "user") throw new Error("learner_memory_source_changed");
  const content = entry.message.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n") : "";
  if (text !== source.message || text.slice(source.start, source.end) !== source.evidence) throw new Error("learner_memory_source_changed");
}
function comparable(left: MemoryAdmissionDecision, right: MemoryAdmissionDecision): boolean {
  return canonical(left.backend) === canonical(right.backend) && canonical(left.questions) === canonical(right.questions);
}

/** One atomic ranked admission. Unknown ranks and learner-stated facts are protected. */
export async function admitJudgedLearnerMemory(cwd: string, decisions: readonly MemoryAdmissionDecision[], session: LearnerMemorySession,
  options: LearnerMemoryAdmissionOptions): Promise<{ saved: LearnerMemoryFact[]; evictedIds: string[]; skipped: number }> {
  if (!Array.isArray(decisions) || decisions.length > 32 || typeof options.isCurrent !== "function") throw new Error("learner_memory_invalid_admission");
  const snapshot = structuredClone(decisions);
  const calibration = structuredClone(options.calibration);
  const isCurrent = options.isCurrent;
  const expectedMemorySha256 = options.expectedMemorySha256;
  const clock = options.now ?? Date.now;
  const accepted = snapshot.filter(decision => decision.accepted);
  if (accepted.some(decision => !isAcceptedMemoryAdmissionDecision(decision, calibration))) throw new Error("learner_memory_invalid_admission");
  if (new Set(accepted.map(decision => decision.candidate.id)).size !== accepted.length) throw new Error("learner_memory_invalid_admission");
  const guard = () => {
    if (!isCurrent()) throw new Error("learner_memory_source_changed");
    for (const decision of accepted) exactAdmissionSource(decision, session);
  };
  guard();
  return mutate(cwd, facts => {
    if (expectedMemorySha256 !== undefined && expectedMemorySha256 !== learnerMemoryDigest(facts)) throw new Error("learner_memory_source_changed");
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("learner_memory_invalid_timestamp");
    const result = { saved: [] as LearnerMemoryFact[], evictedIds: [] as string[], skipped: snapshot.length - accepted.length };
    for (const decision of [...accepted].sort((a, b) => b.probability! - a.probability! || a.candidate.id.localeCompare(b.candidate.id))) {
      const category = decision.category as LearnerMemoryCategory;
      const value = decision.candidate.evidence;
      const existing = facts.find(fact => fact.category === category && fact.value.toLocaleLowerCase() === value.toLocaleLowerCase());
      if (existing && (existing.source === "explicit" || !existing.judgement || !comparable(existing.judgement, decision)
        || existing.judgement.probability! >= decision.probability!)) { result.skipped++; continue; }
      if (existing && now < existing.updatedAt) throw new Error("learner_memory_invalid_timestamp");
      if (!existing && facts.length >= 128) {
        const removable = facts.filter(fact => fact.source === "observed" && fact.judgement && comparable(fact.judgement, decision)
          && fact.judgement.probability! < decision.probability!)
          .sort((a, b) => a.judgement!.probability! - b.judgement!.probability! || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
        const remove = removable[0];
        if (!remove) { result.skipped++; continue; }
        facts.splice(facts.indexOf(remove), 1); result.evictedIds.push(remove.id);
      }
      const fact: LearnerMemoryFact = { id: existing?.id ?? `lm-${randomUUID()}`, category, value, source: "observed", evidence: value,
        confidence: Math.min(0.65, decision.probability!), createdAt: existing?.createdAt ?? now, updatedAt: now,
        provenance: { sessionId: decision.candidate.sessionId, messageId: decision.candidate.messageId,
          quoteSha256: createHash("sha256").update(value).digest("hex") }, judgement: structuredClone(decision),
        ...(existing?.supersedesId ? { supersedesId: existing.supersedesId } : {}) };
      if (existing) facts.splice(facts.indexOf(existing), 1, fact); else facts.push(fact);
      result.saved.push(structuredClone(fact));
    }
    return result;
  }, guard);
}

export async function loadLearnerMemory(cwd: string): Promise<LearnerMemoryFact[]> {
  const target = resolve(learnerMemoryPath(cwd));
  if (!await memoryDirectory(cwd, target, false)) return [];
  const facts = await loadMemoryFile(target);
  if (resolve(learnerMemoryPath(cwd)) !== target) throw new Error("learner_memory_source_changed");
  return facts;
}

async function mutate<T>(cwd: string, operation: (facts: LearnerMemoryFact[]) => T, guard?: () => void): Promise<T> {
  const target = resolve(learnerMemoryPath(cwd));
  const current = () => {
    if (resolve(learnerMemoryPath(cwd)) !== target) throw new Error("learner_memory_source_changed");
    guard?.();
  };
  current(); await memoryDirectory(cwd, target, true); current();
  const lock = await open(`${target}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("learner_memory_busy_retry_later");
    throw error;
  });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const facts = await loadMemoryFile(target); current();
    const before = JSON.stringify(facts);
    const result = operation(facts);
    current();
    if (before === JSON.stringify(facts)) return result;
    const payload = `${JSON.stringify({ schemaVersion: 1, facts }, null, 2)}\n`;
    if (Buffer.byteLength(payload) > MAX_MEMORY_BYTES || facts.length > 128) throw new Error("learner_memory_capacity_reached");
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await file.writeFile(payload); await file.sync(); }
    finally { await file.close(); }
    await memoryDirectory(cwd, target, false); current();
    await rename(temporary, target);
    const directory = await open(dirname(target), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    return result;
  } finally { await lock.close(); await rm(`${target}.lock`, { force: true }); await rm(temporary, { force: true }); }
}

export async function rememberLearnerMemory(cwd: string, input: LearnerMemoryInput, session: LearnerMemorySession): Promise<LearnerMemoryFact> {
  input = structuredClone(input);
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
      delete existing.judgement;
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
  }, () => {
    if (canonical(groundLearnerMemoryEvidence(session, evidence)) !== canonical(provenance)) throw new Error("learner_memory_source_changed");
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
