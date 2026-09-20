/** Device-only evidence. Portable exports and learner grades never contain this store. */
import { canonicalUiAction, joinPerformanceObservation, receiptForUiAction, validateUiActionJournal,
  type PerformancePredictionReceipt, type PerformanceObservedOutcome, type UiAction, type UiActionJournal } from "@keating/learner-contracts";
import { withExclusiveTransaction, type AsyncSqlDatabase, type AsyncSqlExecutor } from "./database";

const DATA_KEY = "quiz_performance_evidence_v1";
const GENERATION_KEY = "quiz_performance_generation_v1";
const MAX_ROWS = 500;
const MAX_BYTES = 2_000_000;
export interface MobileQuizPredictionEnvelope {
  documentId: string; documentRevision: number; nodeId: string;
  sourceSha256: string; questionSha256: string; source: unknown; prediction: PerformancePredictionReceipt;
}
export interface MobileQuizObservation { predictionId: string; outcome: PerformanceObservedOutcome; observed: 0 | 1 }
interface Evidence { schemaVersion: 1; predictions: MobileQuizPredictionEnvelope[]; observations: MobileQuizObservation[] }
export interface MobileQuizPerformanceExport extends Evidence { scope: "device-local"; hintMeaning: string }

async function generation(transaction: AsyncSqlExecutor): Promise<number> {
  const row = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = ?;", GENERATION_KEY);
  const value = row ? Number(row.value) : 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid quiz evidence generation");
  return value;
}
/** Run inside the import/clear transaction so stale writers cannot resurrect removed data. */
export async function invalidateMobileQuizPerformance(transaction: AsyncSqlExecutor, clear = false): Promise<void> {
  const next = (await generation(transaction)) + 1;
  if (!Number.isSafeInteger(next)) throw new Error("Quiz evidence generation exhausted");
  await transaction.runAsync("INSERT INTO repository_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;", GENERATION_KEY, String(next));
  if (clear) await transaction.runAsync("DELETE FROM repository_meta WHERE key = ?;", DATA_KEY);
}
async function read(transaction: AsyncSqlExecutor): Promise<Evidence> {
  const row = await transaction.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = ?;", DATA_KEY);
  if (!row) return { schemaVersion: 1, predictions: [], observations: [] };
  if (new TextEncoder().encode(row.value).byteLength > MAX_BYTES) throw new Error("Quiz evidence is too large");
  const data = JSON.parse(row.value) as Evidence;
  if (data.schemaVersion !== 1 || !Array.isArray(data.predictions) || !Array.isArray(data.observations)
    || data.predictions.length > MAX_ROWS || data.observations.length > MAX_ROWS
    || data.predictions.some(row => !row || typeof row.documentId !== "string" || typeof row.nodeId !== "string" || !row.prediction || typeof row.prediction.id !== "string")
    || data.observations.some(row => !row || typeof row.predictionId !== "string")) throw new Error("Invalid quiz evidence");
  return data;
}
async function write(transaction: AsyncSqlExecutor, data: Evidence): Promise<void> {
  const text = JSON.stringify(data);
  if (data.predictions.length > MAX_ROWS || data.observations.length > MAX_ROWS || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("Quiz evidence storage is full; export it before clearing learning data");
  await transaction.runAsync("INSERT INTO repository_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;", DATA_KEY, text);
}
const assertActive = (active: () => boolean) => { if (!active()) throw new Error("Quiz evidence operation cancelled"); };

export class MobileQuizPerformanceStore {
  constructor(private readonly database: AsyncSqlDatabase) {}
  generation(): Promise<number> { return withExclusiveTransaction(this.database, generation); }
  async savePredictions(expectedGeneration: number, rows: MobileQuizPredictionEnvelope[], active: () => boolean): Promise<void> {
    const copy = structuredClone(rows);
    await withExclusiveTransaction(this.database, async transaction => {
      assertActive(active);
      if (await generation(transaction) !== expectedGeneration) throw new Error("Quiz evidence source was replaced");
      const data = await read(transaction);
      if (copy.some(row => data.predictions.some(saved => saved.prediction.id === row.prediction.id))) throw new Error("Duplicate prediction identity");
      data.predictions.push(...copy);
      assertActive(active); await write(transaction, data); assertActive(active);
    });
  }
  async linkCommitted(expectedGeneration: number, action: UiAction, predictions: MobileQuizPredictionEnvelope[], outcomes: PerformanceObservedOutcome[], active: () => boolean): Promise<number> {
    const submitted = structuredClone(action);
    return withExclusiveTransaction(this.database, async transaction => {
      assertActive(active);
      if (await generation(transaction) !== expectedGeneration) throw new Error("Quiz evidence source was replaced");
      const journalRow = await transaction.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM ui_action_journals WHERE document_id = ?;", submitted.documentId);
      if (!journalRow) return 0;
      const journal: UiActionJournal = JSON.parse(journalRow.payload_json);
      if (!validateUiActionJournal(journal)) throw new Error("Invalid quiz action journal");
      const receipt = receiptForUiAction(journal, submitted);
      if (!receipt || receipt.state !== "completed" || receipt.result?.status !== "completed" || canonicalUiAction(receipt.action) !== canonicalUiAction(submitted)) return 0;
      const committedAt = Date.parse(receipt.createdAt);
      const data = await read(transaction);
      let count = 0;
      for (const outcome of outcomes) {
        if (committedAt < outcome.submittedAt) continue;
        const prediction = predictions.find(row => row.prediction.id === outcome.predictionId);
        if (!prediction || !data.predictions.some(saved => JSON.stringify(saved) === JSON.stringify(prediction))) continue;
        const joined = joinPerformanceObservation(prediction.prediction, outcome);
        if (joined.status !== "accepted") continue;
        const existing = data.observations.find(row => row.predictionId === outcome.predictionId);
        if (existing && JSON.stringify(existing.outcome) !== JSON.stringify(joined.outcome)) throw new Error("Conflicting observed outcome");
        if (!existing) data.observations.push({ predictionId: outcome.predictionId, outcome: joined.outcome, observed: joined.observed });
        count++;
      }
      assertActive(active); await write(transaction, data); assertActive(active);
      return count;
    });
  }
  async export(documentId: string, nodeId: string): Promise<MobileQuizPerformanceExport> {
    return withExclusiveTransaction(this.database, async transaction => {
      const data = await read(transaction);
      const predictions = data.predictions.filter(row => row.documentId === documentId && row.nodeId === nodeId);
      const ids = new Set(predictions.map(row => row.prediction.id));
      const observations = data.observations.filter(row => ids.has(row.predictionId)).map(row => {
        const prediction = predictions.find(item => item.prediction.id === row.predictionId)!;
        const joined = joinPerformanceObservation(prediction.prediction, row.outcome);
        if (joined.status !== "accepted") throw new Error("Invalid stored quiz observation");
        return { predictionId: row.predictionId, outcome: joined.outcome, observed: joined.observed };
      });
      return { schemaVersion: 1, scope: "device-local", hintMeaning: "In-app hint usage only; outside help is unobserved", predictions, observations };
    });
  }
}
