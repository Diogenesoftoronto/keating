/** Rebuild labelled fitting rows from private prediction records and completed actions. */
import { canonicalUiAction, objectiveCredit, quizItemSuccessQuestion, validateUiActionAgainstDocument,
  validateUiActionCorrelation, validateUiActionJournal, type JudgementBackendKey } from "../../packages/learner-contracts/src/index.js";
import { extractQuizBoostingFeatures, QUIZ_BOOSTING_FEATURES, QUIZ_BOOSTING_FEATURE_SCHEMA, QUIZ_BOOSTING_TARGET } from "../../packages/learner-contracts/src/judgement/quiz-boosting-features.js";
import { MAX_BOOSTING_BYTES, validateBoostingDataset, type BoostingDataset, type BoostingObservation } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
import { stateDir } from "../core/paths.js";
import { FileUiActionJournalStorage } from "../tui/ui/filesystem-journal.js";
import { CliQuizPerformanceStore, cliQuizPerformanceCanonical as canonical, cliQuizPerformanceDigest as digest } from "./quiz-performance-store.js";

export interface QuizBoostingSelection {
  schemaVersion: 1;
  documents: Array<{ documentId: string; predictions: Array<{ predictionId: string; groupId: string; split: "fit" | "validation" }> }>;
}
const invalid = (): never => { throw new Error("quiz_boosting_source_invalid"); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(v);

/** Assignments are explicit declarations of independence, never inferred from row position. */
export function validateQuizBoostingSelection(value: unknown): QuizBoostingSelection {
  if (!keys(value, ["schemaVersion", "documents"]) || value.schemaVersion !== 1 || !Array.isArray(value.documents)
    || !value.documents.length || value.documents.length > 128) return invalid();
  const documents: QuizBoostingSelection["documents"] = [];
  const docs = new Set<string>(), ids = new Set<string>();
  for (const d of value.documents) {
    if (!keys(d, ["documentId", "predictions"]) || !text(d.documentId) || docs.has(d.documentId)
      || !Array.isArray(d.predictions) || !d.predictions.length || d.predictions.length > 500) return invalid();
    docs.add(d.documentId);
    const predictions: QuizBoostingSelection["documents"][number]["predictions"] = [];
    for (const row of d.predictions) {
      if (!keys(row, ["predictionId", "groupId", "split"]) || !text(row.predictionId) || !text(row.groupId)
        || (row.split !== "fit" && row.split !== "validation") || ids.has(row.predictionId)) return invalid();
      ids.add(row.predictionId); if (ids.size > 20_000) return invalid();
      predictions.push({ predictionId: row.predictionId, groupId: row.groupId, split: row.split });
    }
    documents.push({ documentId: d.documentId, predictions: predictions.sort((a, b) => a.predictionId < b.predictionId ? -1 : a.predictionId > b.predictionId ? 1 : 0) });
  }
  documents.sort((a, b) => a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0);
  return { schemaVersion: 1, documents };
}

export async function buildCliQuizBoostingDataset(cwd: string, input: unknown, options: { now?: () => number } = {}) {
  const selection = validateQuizBoostingSelection(input), now = options.now ?? Date.now;
  const asOf = now(), directory = stateDir(cwd);
  if (!Number.isSafeInteger(asOf) || asOf < 0) return invalid();
  const journalStorage = new FileUiActionJournalStorage(cwd);
  const store = new CliQuizPerformanceStore(cwd, journalStorage, () => asOf);
  const observations: BoostingObservation[] = [];
  const provenance: Array<{ rowId: string; documentId: string; attemptId: string; itemSha256: string; taskContentSha256: string;
    sourceSha256: string; questionSha256: string; predictionSha256: string; outcomeSha256: string; receiptSha256: string }> = [];
  const snapshots: Array<{ documentId: string; dataSha256: string; journalSha256: string }> = [];
  const groups = new Map<string, string>(), repeats = new Map<string, string>(), sourceIds = new Set<string>();
  let sourceBackend: JudgementBackendKey | undefined;
  for (const selected of selection.documents) {
    const data = await store.read(selected.documentId), journal = await journalStorage.load(selected.documentId);
    if (!journal || !validateUiActionJournal(journal) || journal.documentId !== selected.documentId) return invalid();
    snapshots.push({ documentId: selected.documentId, dataSha256: digest(data), journalSha256: digest(journal) });
    for (const assigned of selected.predictions) {
      const envelope = data.predictions.find(row => row.prediction.id === assigned.predictionId);
      const observation = data.observations.find(row => row.predictionId === assigned.predictionId);
      if (!envelope || !observation) return invalid();
      const p = envelope.prediction, outcome = observation.outcome, doc = envelope.source.document;
      const node = doc.nodes.find(n => n.id === envelope.nodeId);
      if (node?.type !== "quiz") return invalid();
      const item = node.questions.find(q => q.id === p.itemId);
      if (!item || canonical(p.question) !== canonical(quizItemSuccessQuestion(item.id))) return invalid();
      const features = extractQuizBoostingFeatures(item, p.probability);
      if (!features) return invalid();
      // Regenerated question identities must not make identical task content
      // independent. This detects exact copies, not paraphrase equivalence.
      const { id: _itemId, ...taskContent } = item;
      const taskContentSha256 = digest(taskContent);
      const receipts = journal.receipts.filter(r => r.action.type === "complete-quiz"
        && `${digest(r.action)}:${p.itemId}` === outcome.sourceId);
      if (receipts.length !== 1) return invalid();
      const receipt = receipts[0]!, action = receipt.action;
      if (action.type !== "complete-quiz" || receipt.state !== "completed" || receipt.result?.status !== "completed"
        || receipt.actionFingerprint !== canonicalUiAction(action) || action.nodeId !== node.id
        || !validateUiActionAgainstDocument(action, doc) || !validateUiActionCorrelation(action, receipt.result, doc)
        || p.createdAt >= outcome.submittedAt || Date.parse(receipt.createdAt) < outcome.submittedAt
        || Date.parse(receipt.updatedAt) < Date.parse(receipt.createdAt) || Date.parse(receipt.updatedAt) > asOf) return invalid();
      const answers = action.answers.filter(a => a.questionId === p.itemId);
      if (answers.length !== 1 || !answers[0]!.answer.trim() || action.skippedQuestionIds.includes(p.itemId)
        || action.pendingGradeQuestionIds.includes(p.itemId) || outcome.grading !== "deterministic" || typeof outcome.hintUsed !== "boolean") return invalid();
      const credit = objectiveCredit(item, answers[0]!.answer);
      if (credit === undefined || !Number.isFinite(credit) || outcome.correct !== (credit === 1)
        || observation.observed !== (credit === 1 && !outcome.hintUsed ? 1 : 0) || sourceIds.has(outcome.sourceId)) return invalid();
      sourceIds.add(outcome.sourceId);
      if (sourceBackend && canonical(sourceBackend) !== canonical(p.backend)) return invalid();
      sourceBackend ??= structuredClone(p.backend);
      if (groups.has(assigned.groupId) && groups.get(assigned.groupId) !== assigned.split) return invalid();
      groups.set(assigned.groupId, assigned.split);
      const group = canonical([assigned.groupId, assigned.split]);
      for (const key of [`attempt:${p.attemptId}`, `item:${p.itemSha256}`, `task:${taskContentSha256}`]) {
        if (repeats.has(key) && repeats.get(key) !== group) return invalid();
        repeats.set(key, group);
      }
      observations.push({ rowId: p.id, groupId: assigned.groupId, split: assigned.split,
        label: observation.observed, features, baseline: p.probability });
      provenance.push({ rowId: p.id, documentId: doc.id, attemptId: p.attemptId, itemSha256: p.itemSha256, taskContentSha256,
        sourceSha256: envelope.sourceSha256, questionSha256: envelope.questionSha256,
        predictionSha256: digest(envelope), outcomeSha256: digest(observation), receiptSha256: digest(receipt) });
    }
  }
  const dataset: BoostingDataset = validateBoostingDataset({ schemaVersion: 1,
    features: [...QUIZ_BOOSTING_FEATURES], policy: { minFitRows: 40, minFitGroups: 8, minValidationRows: 20,
      minValidationGroups: 6, maxValidationEce: 0.15, maxTreeDepth: 3 }, observations });
  const binding = { schemaVersion: 1 as const, target: QUIZ_BOOSTING_TARGET, featureSchema: QUIZ_BOOSTING_FEATURE_SCHEMA,
    sourceBackend: sourceBackend!, questionFamilySha256: digest(quizItemSuccessQuestion("__item__")),
    datasetSha256: digest(dataset), selection, provenance,
    hintEvidence: "Recorded in-app hint flag; the completion journal does not independently reconstruct hint events or outside help." };
  if (Buffer.byteLength(canonical({ dataset, binding })) > MAX_BOOSTING_BYTES) return invalid();
  for (const snapshot of snapshots) {
    const data = await store.read(snapshot.documentId), journal = await journalStorage.load(snapshot.documentId);
    if (!journal || digest(data) !== snapshot.dataSha256 || digest(journal) !== snapshot.journalSha256 || stateDir(cwd) !== directory) return invalid();
  }
  return { dataset, binding: { ...binding, bindingSha256: digest(binding) } };
}
