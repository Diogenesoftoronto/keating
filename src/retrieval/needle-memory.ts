import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { stateDir } from "../core/paths.js";
import { LEARNER_MEMORY_CATEGORIES, type LearnerMemoryFact, type LearnerMemorySession } from "../core/learner-memory.js";
import { createNeedleCaller, loadNeedleConfig, needleModelIdentity, needleTextHash, type NeedleCaller } from "./needle-runtime.js";

interface SourceSpan {
  id: string;
  kind: "memory" | "session";
  text: string;
  quoteSha256: string;
  provenance: { sessionId: string; messageId: string; start: number; end: number };
  fact?: LearnerMemoryFact;
}
interface IndexEntry { id: string; hash: string; vector: number[]; selection?: { category: string; quote: string } }
interface LocalIndex { schemaVersion: 1; model: string; entries: IndexEntry[] }
export interface NeedleMemoryResult {
  facts: LearnerMemoryFact[];
  sourceSpans: Array<{ quote: string; quoteSha256: string; provenance: SourceSpan["provenance"]; relativeScore: number }>;
  proposals: Array<{ category: string; evidence: string; quoteSha256: string; source: "observed"; status: "tentative-not-saved"; provenance: SourceSpan["provenance"] }>;
  model: string;
}
export interface NeedleMemoryOptions {
  /** Optional background observer; loadLearnerContext supplies a detached pre-budget snapshot. */
  onRetrieved?: (result: NeedleMemoryResult) => void;
  query?: string;
  session?: LearnerMemorySession;
  /** Explicit deterministic test boundary. Production resolves the local runtime config. */
  runtime?: { model: string; call: NeedleCaller };
}

/** Only genuine user-message text enters extraction; assistant/tool text is excluded. */
export function needleLearnerSpans(session?: LearnerMemorySession): SourceSpan[] {
  if (!session) return [];
  const sessionId = session.getSessionId();
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200) return [];
  const spans: SourceSpan[] = [];
  for (const entry of [...session.getBranch()].slice(-64) as any[]) {
    if (entry?.type !== "message" || entry.message?.role !== "user" || typeof entry.id !== "string" || entry.id.length > 200) continue;
    const content = entry.message.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n") : "";
    // Bound work without inventing clipped text. Every window retains its exact offsets.
    for (let start = 0; start < Math.min(text.length, 2000); start += 500) {
      const quote = text.slice(start, Math.min(start + 500, text.length));
      if (!quote.trim()) continue;
      const hash = needleTextHash(quote);
      spans.push({ id: `session:${sessionId}:${entry.id}:${start}`, kind: "session", text: quote, quoteSha256: hash,
        provenance: { sessionId, messageId: entry.id, start, end: start + quote.length } });
    }
  }
  return spans.slice(-24);
}

/** Corpus-relative scores rank only; they are neither probabilities nor recall thresholds. */
export function needleRelativeScores(vectors: readonly number[][], query: readonly number[]): number[] {
  if (!vectors.length) return [];
  const norm = (vector: readonly number[]) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const queryNorm = norm(query);
  const scores = vectors.map(vector => {
    const denominator = norm(vector) * queryNorm;
    return denominator ? vector.reduce((sum, value, index) => sum + value * query[index], 0) / denominator : 0;
  });
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length);
  return scores.map(score => sd > 1e-12 ? (score - mean) / sd : 0);
}

async function loadIndex(path: string, model: string): Promise<IndexEntry[]> {
  try {
    if ((await stat(path)).size > 12_000_000) return [];
    const value = JSON.parse(await readFile(path, "utf8")) as LocalIndex;
    if (value.schemaVersion !== 1 || value.model !== model || !Array.isArray(value.entries) || value.entries.length > 152) return [];
    const dimension = value.entries[0]?.vector.length;
    if (value.entries.some(entry => typeof entry.id !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash)
      || !Array.isArray(entry.vector) || !entry.vector.length || entry.vector.length > 8192 || entry.vector.length !== dimension
      || entry.vector.some(value => !Number.isFinite(value)))) return [];
    return value.entries;
  } catch { return []; }
}

async function saveIndex(path: string, value: LocalIndex): Promise<void> {
  const directory = join(path, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally { await rm(temporary, { force: true }); }
}

/** Retrieval is a bounded optional addition: every failure leaves the existing context path intact. */
export async function retrieveNeedleMemory(cwd: string, memory: readonly LearnerMemoryFact[], options: NeedleMemoryOptions = {}): Promise<NeedleMemoryResult | null> {
  try {
    if (!options.query?.trim() || options.query.length > 8192) return null;
    const config = options.runtime ? null : await loadNeedleConfig(cwd);
    const runtime = options.runtime ?? (config ? { model: needleModelIdentity(config), call: createNeedleCaller(config) } : null);
    if (!runtime) return null;
    const sources: SourceSpan[] = memory.slice(0, 128).flatMap<SourceSpan>(fact => {
      if (needleTextHash(fact.evidence) !== fact.provenance.quoteSha256) return [];
      return [{ id: fact.id, kind: "memory" as const, text: fact.evidence, quoteSha256: fact.provenance.quoteSha256,
        provenance: { sessionId: fact.provenance.sessionId, messageId: fact.provenance.messageId, start: 0, end: fact.evidence.length }, fact }];
    }).concat(needleLearnerSpans(options.session));
    if (!sources.length) return null;
    const path = join(stateDir(cwd), "needle-index.json");
    const cached = new Map((await loadIndex(path, runtime.model)).map(entry => [`${entry.id}:${entry.hash}`, entry]));
    const missing = sources.filter(source => !cached.has(`${source.id}:${source.quoteSha256}`));
    const extractionSources = missing.filter(source => source.kind === "session").slice(-4);
    const response = await runtime.call({ texts: [options.query, ...missing.map(source => source.text)],
      sources: extractionSources.map(source => ({ id: source.id, text: source.text })) });
    if (!response || response.model !== runtime.model || response.vectors.length !== missing.length + 1) return null;
    const dimension = response.vectors[0]?.length;
    if (!dimension || response.vectors.some(vector => vector.length !== dimension || vector.some(value => !Number.isFinite(value)))) return null;
    const entries: IndexEntry[] = sources.map(source => {
      const previous = cached.get(`${source.id}:${source.quoteSha256}`);
      const selection = response.selections.find(item => item.sourceId === source.id);
      const valid = selection && LEARNER_MEMORY_CATEGORIES.includes(selection.category as any)
        && typeof selection.quote === "string" && selection.quote.trim().length >= 3 && selection.quote.length <= 500 && source.text.includes(selection.quote);
      return { id: source.id, hash: source.quoteSha256, vector: previous?.vector ?? response.vectors[missing.indexOf(source) + 1],
        ...(valid ? { selection: { category: selection.category, quote: selection.quote } } : previous?.selection ? { selection: previous.selection } : {}) };
    });
    if (entries.some(entry => entry.vector.length !== dimension)) return null;
    await saveIndex(path, { schemaVersion: 1, model: runtime.model, entries });
    const scores = needleRelativeScores(entries.map(entry => entry.vector), response.vectors[0]);
    const ranked = sources.map((source, index) => ({ source, entry: entries[index], score: scores[index] }))
      .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id));
    const facts = ranked.filter(item => item.source.fact).slice(0, 16).map(item => item.source.fact!);
    const sessionRows = ranked.filter(item => item.source.kind === "session").slice(0, 4);
    const sourceSpans = sessionRows.map(({ source, score }) => ({ quote: source.text, quoteSha256: source.quoteSha256, provenance: source.provenance, relativeScore: score }));
    const proposals: NeedleMemoryResult["proposals"] = sessionRows.flatMap(({ source, entry }) => {
      const selection = entry.selection;
      if (!selection || typeof selection.quote !== "string" || !source.text.includes(selection.quote)
        || !LEARNER_MEMORY_CATEGORIES.includes(selection.category as any)) return [];
      const start = source.provenance.start + source.text.indexOf(selection.quote);
      return [{ category: selection.category, evidence: selection.quote, quoteSha256: needleTextHash(selection.quote),
        source: "observed" as const, status: "tentative-not-saved" as const,
        provenance: { ...source.provenance, start, end: start + selection.quote.length } }];
    });
    return { facts, sourceSpans, proposals, model: runtime.model };
  } catch { return null; }
}
