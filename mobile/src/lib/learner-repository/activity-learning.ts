import { canonicalUiAction, receiptForUiAction, validateUiActionJournal, validateUiDocument,
  type PortableLearnerData, type UiAction, type UiActionJournal, type UiDocument } from "@keating/learner-contracts";
import { ACTIVITY_LEARNING_POLICY, activitySourcesFromDocuments, linkActivityOutcomes, validateActivityExposure,
  type ActivityBoundary, type ActivityExposure, type ActivityObjectiveOutcome } from "../../../../packages/learner-contracts/src/judgement/activity-learning";
import { mobileActivityOutcomes } from "../judgement/activity-learning";
import { validateBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../../../packages/learner-contracts/src/judgement/background-activity-policy";
import { withExclusiveTransaction, type AsyncSqlDatabase, type AsyncSqlExecutor } from "./database";

const PREFIX = "activity_learning_v1:";
const GENERATION = "activity_learning_generation_v1";
const MAX_BYTES = 2_000_000;
interface SavedExposure { exposure: ActivityExposure; documents: UiDocument[] }
interface Evidence { version: 1; rows: SavedExposure[]; outcomes: ActivityObjectiveOutcome[]; policy?: BackgroundActivityPolicy }
async function generation(tx: AsyncSqlExecutor): Promise<number> {
  const row = await tx.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = ?;", GENERATION);
  const value = row ? Number(row.value) : 0;
  if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid activity evidence generation.");
  return value;
}
export async function invalidateMobileActivityLearning(tx: AsyncSqlExecutor): Promise<void> {
  const next = await generation(tx) + 1;
  if (!Number.isSafeInteger(next)) throw Error("Activity evidence generation exhausted.");
  await tx.runAsync("INSERT INTO repository_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;", GENERATION, String(next));
  // Imported histories cannot establish the local publication/source chronology of old observations.
  await tx.runAsync("DELETE FROM repository_meta WHERE substr(key, 1, ?) = ?;", PREFIX.length, PREFIX);
}
async function read(tx: AsyncSqlExecutor, key: string): Promise<Evidence> {
  const saved = await tx.getFirstAsync<{ value: string }>("SELECT value FROM repository_meta WHERE key = ?;", key);
  if (!saved) return { version: 1, rows: [], outcomes: [] };
  if (saved.value.length > MAX_BYTES) throw Error("Activity evidence is too large.");
  const data = JSON.parse(saved.value) as Evidence;
  if (data.version !== 1 || !Array.isArray(data.rows) || data.rows.length > ACTIVITY_LEARNING_POLICY.maxExposures
    || data.rows.some(row => !row || !validateActivityExposure(row.exposure) || !Array.isArray(row.documents) || row.documents.some(document => !validateUiDocument(document)))
    || !Array.isArray(data.outcomes) || data.outcomes.length > 5000) throw Error("Invalid activity evidence.");
  // A policy from older question definitions is unusable, but its separately
  // validated observations and source history remain valid local evidence.
  if (data.policy !== undefined && !validateBackgroundActivityPolicy(data.policy)) delete data.policy;
  return data;
}
async function write(tx: AsyncSqlExecutor, key: string, evidence: Evidence): Promise<void> {
  const value = JSON.stringify(evidence);
  if (new TextEncoder().encode(value).byteLength > MAX_BYTES) throw Error("Activity evidence storage is full.");
  await tx.runAsync("INSERT INTO repository_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;", key, value);
}

/** Private local records, separately scoped to issuer+account; no source content enters model requests. */
export class MobileActivityLearningStore {
  private readonly key: string;
  constructor(private readonly database: AsyncSqlDatabase, scope: string) {
    if (!scope || scope.length > 2048) throw Error("Activity account scope is missing.");
    this.key = `${PREFIX}${scope}`;
  }
  generation(): Promise<number> { return withExclusiveTransaction(this.database, generation); }
  async policy(expected: number, active: () => boolean, now = Date.now()): Promise<BackgroundActivityPolicy | null> {
    return withExclusiveTransaction(this.database, async tx => {
      await this.assertCurrent(tx, expected, active);
      const { policy } = await read(tx, this.key);
      await this.assertCurrent(tx, expected, active);
      return policy && policy.createdAt <= now && policy.expiresAt > now ? structuredClone(policy) : null;
    });
  }
  async savePolicy(expected: number, policy: BackgroundActivityPolicy, active: () => boolean): Promise<void> {
    if (!validateBackgroundActivityPolicy(policy)) throw Error("Invalid background teaching policy.");
    const snapshot = structuredClone(policy);
    await withExclusiveTransaction(this.database, async tx => {
      await this.assertCurrent(tx, expected, active);
      const data = await read(tx, this.key);
      if (data.policy && data.policy.createdAt > snapshot.createdAt) return;
      data.policy = snapshot;
      await write(tx, this.key, data);
      await this.assertCurrent(tx, expected, active);
    });
  }
  private async assertCurrent(tx: AsyncSqlExecutor, expected: number, active: () => boolean) {
    if (!active()) throw Error("Activity evidence changed.");
    const actual = await generation(tx);
    if (!active() || actual !== expected) throw Error("Activity evidence changed.");
  }
  async history(expected: number, boundaries: readonly ActivityBoundary[], asOf: number, active: () => boolean): Promise<ActivityExposure[]> {
    return withExclusiveTransaction(this.database, async tx => {
      await this.assertCurrent(tx, expected, active);
      const data = await read(tx, this.key);
      const joined = linkActivityOutcomes(data.rows.map(row => row.exposure), data.outcomes, asOf, boundaries);
      await this.assertCurrent(tx, expected, active);
      return joined;
    });
  }
  async publish(expected: number, exposure: ActivityExposure, documents: readonly UiDocument[], active: () => boolean): Promise<void> {
    if (!validateActivityExposure(exposure) || exposure.outcome || documents.some(document => !validateUiDocument(document))
      || JSON.stringify(exposure.sources) !== JSON.stringify(activitySourcesFromDocuments(documents))) throw Error("Invalid published activity.");
    const row = structuredClone({ exposure, documents: [...documents] });
    await withExclusiveTransaction(this.database, async tx => {
      await this.assertCurrent(tx, expected, active);
      const data = await read(tx, this.key);
      if (data.rows.some(saved => saved.exposure.id === row.exposure.id)) return;
      data.rows = [...data.rows, row].slice(-ACTIVITY_LEARNING_POLICY.maxExposures);
      await write(tx, this.key, data);
      await this.assertCurrent(tx, expected, active);
    });
  }
  async linkCommitted(expected: number, action: UiAction, document: UiDocument, sessionId: string,
    prior: Pick<PortableLearnerData, "questionChecks" | "quizResults">, active: () => boolean,
    sha256?: (value: string) => Promise<string>): Promise<void> {
    await withExclusiveTransaction(this.database, async tx => {
      await this.assertCurrent(tx, expected, active);
      const record = await tx.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM ui_action_journals WHERE document_id = ?;", action.documentId);
      if (!record) return;
      const journal: UiActionJournal = JSON.parse(record.payload_json);
      if (!validateUiActionJournal(journal)) throw Error("Invalid activity action journal.");
      const receipt = receiptForUiAction(journal, action);
      if (receipt?.state !== "completed" || receipt.result?.status !== "completed" || canonicalUiAction(receipt.action) !== canonicalUiAction(action)) return;
      const data = await read(tx, this.key);
      // Source content must be the exact published document, not just a matching ID supplied by an action.
      if (!data.rows.some(row => row.exposure.sessionId === sessionId && row.documents.some(saved => JSON.stringify(saved) === JSON.stringify(document)))) return;
      const outcomes = await mobileActivityOutcomes(action, document, sessionId, Date.parse(receipt.createdAt), prior, sha256);
      for (const outcome of outcomes) {
        if (data.outcomes.some(saved => saved.id === outcome.id)) continue;
        if (data.outcomes.length >= 5000) break;
        if (data.outcomes.some(saved => saved.questionKey === outcome.questionKey)) outcome.attemptStatus = "repeat";
        data.outcomes.push(outcome);
      }
      await this.assertCurrent(tx, expected, active);
      await write(tx, this.key, data);
      await this.assertCurrent(tx, expected, active);
    });
  }
}
