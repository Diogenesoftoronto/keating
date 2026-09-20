/** Source-reconstructible decision features. None of these targets measures latent mastery or causal review benefit. */
import { parsePortableLearnerEnvelope, validatePortableLearnerData, type PortableLearnerData } from "../portable.js";
import type { CardReviewRecord } from "../learning.js";

export const DECISION_POLICY_TARGETS = ["mastery", "retention", "urgency"] as const;
export type DecisionPolicyTarget = typeof DECISION_POLICY_TARGETS[number];
export const DECISION_POLICY_FEATURE_SCHEMAS = {
  mastery: "prior-objective-assessment-v1", retention: "prior-delayed-card-recall-v1", urgency: "prior-due-deck-lapse-v1",
} as const;
export const DECISION_POLICY_DOMAINS = {
  mastery: "next-unique-auto-graded-question-correctness",
  retention: "next-delayed-same-card-self-reported-recall",
  urgency: "next-observed-due-deck-self-reported-lapse-risk",
} as const;
export const DECISION_POLICY_FEATURES: Readonly<Record<DecisionPolicyTarget, readonly string[]>> = {
  mastery: ["objectiveCount", "objectiveMean", "objectiveLast", "assessmentAgeDays"],
  retention: ["objectiveCount", "objectiveMean", "priorReviewCount", "recallRate", "lapseRate", "lastRating", "reviewAgeDays", "intervalDays"],
  urgency: ["priorReviewCount", "recallRate", "lapseRate", "reviewAgeDays", "dueCount", "overdueCount", "knownCardCount", "oldestDueDays"],
};
export const DECISION_POLICY_DAY_MS = 86_400_000;
export const DECISION_POLICY_SYNTHETIC_RUBRICS = {
  mastery: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner correctly answer a new independent objective question on this topic without hints? Judge a synthetic prediction, not demonstrated human mastery.",
  retention: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner recall the selected card correctly without seeing its answer after the stated delay? Judge a synthetic recall prediction, not observed delayed human retention.",
  urgency: "Given only this source-grounded learner context and explicitly simulated or trajectory-derived prior state, would the learner fail to recall a currently due card from the selected deck without help if reviewed now? Judge synthetic lapse risk, not causal benefit from prioritizing a review.",
} as const;
export const normalizeDecisionPolicyTopic = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export const normalizeDecisionPolicyQuestion = normalizeDecisionPolicyTopic;
const time = (value: string) => Date.parse(value);
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
interface ReviewHistory {
  priorReviewCount: number; recallRate: number; lapseRate: number; lastRating: number;
  reviewAgeDays: number; intervalDays: number; lastReviewedAt: number; evidenceIds: string[];
}
export interface DecisionPolicyCardSnapshot extends ReviewHistory { deckId: string; cardId: string; nextDueAt: number }
export interface DecisionPolicyDeckSnapshot extends ReviewHistory {
  deckId: string; title: string; cardCount: number; knownCardCount: number; scheduleComplete: boolean;
  dueCount: number; overdueCount: number; oldestDueDays: number; nextDueAt: number | null;
}
export interface DecisionPolicySnapshot {
  topic: string; asOf: number;
  objective: { count: number; mean: number; last: number; ageDays: number; evidenceIds: string[] } | null;
  progress: { mastery: number | null; retention: number | null; confidence: number; status: "insufficient" | "needs-review" | "developing" | "strong" };
  cards: DecisionPolicyCardSnapshot[];
  decks: DecisionPolicyDeckSnapshot[];
  /** Exports do not contain old roster or topic/title revisions. These are conditional historical reconstructions. */
  reconstruction: "current-deck-metadata-with-prior-canonical-review-schedules" | "explicit-simulated-harness-state" | "source-trajectory-derived-state";
}
function reviewHistory(rows: readonly CardReviewRecord[], asOf: number, allowTies = false): ReviewHistory | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  const last = sorted.at(-1)!;
  // Same-instant records cannot establish a unique prior schedule or last response.
  if (!allowTies && sorted.length > 1 && time(sorted.at(-2)!.createdAt) === time(last.createdAt)) return null;
  return { priorReviewCount: rows.length, recallRate: mean(rows.map(row => Number(row.rating >= 2))),
    lapseRate: mean(rows.map(row => Number(row.rating === 0))), lastRating: last.rating / 3,
    reviewAgeDays: (asOf - time(last.createdAt)) / DECISION_POLICY_DAY_MS, intervalDays: last.appliedIntervalDays,
    lastReviewedAt: time(last.createdAt), evidenceIds: sorted.map(row => row.id) };
}

/** App and training use exactly the same strict-before-time extractor. Unknown history remains null. */
export function decisionPolicySnapshot(data: PortableLearnerData, topic: string, asOf: number): DecisionPolicySnapshot {
  if (!validatePortableLearnerData(data) || !Number.isSafeInteger(asOf) || asOf < 0 || !topic.trim()) throw new Error("decision_policy_source_invalid");
  const key = normalizeDecisionPolicyTopic(topic), sameTopic = (value: string) => normalizeDecisionPolicyTopic(value) === key;
  const checks = data.questionChecks.filter(row => sameTopic(row.topic) && time(row.createdAt) < asOf);
  const seen = new Set<string>();
  const objective = [...checks].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id))
    .filter(row => { const task = normalizeDecisionPolicyQuestion(row.question);
      if (row.grading !== "auto" || row.score === undefined || !row.answer.trim() || seen.has(task)) return false;
      seen.add(task); return true;
    });
  const decks = data.decks.filter(deck => sameTopic(deck.topic) && time(deck.createdAt) < asOf);
  const deckIds = new Set(decks.map(deck => deck.id));
  const reviews = data.cardReviews.filter(row => deckIds.has(row.deckId) && time(row.createdAt) < asOf);
  const canonical = reviews.filter(row => !row.legacyScheduleUnknown && row.nextDueAt !== undefined);
  const cards: DecisionPolicyCardSnapshot[] = [], deckSnapshots: DecisionPolicyDeckSnapshot[] = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      const rows = canonical.filter(row => row.deckId === deck.id && row.cardId === card.id);
      const history = reviewHistory(rows, asOf);
      if (!history) continue;
      const last = rows.find(row => row.id === history.evidenceIds.at(-1))!;
      cards.push({ ...history, deckId: deck.id, cardId: card.id, nextDueAt: time(last.nextDueAt!) });
    }
    const known = cards.filter(card => card.deckId === deck.id), history = reviewHistory(canonical.filter(row => row.deckId === deck.id), asOf, true);
    if (!history) continue;
    const due = known.filter(card => card.nextDueAt <= asOf), future = known.filter(card => card.nextDueAt > asOf);
    deckSnapshots.push({ ...history, deckId: deck.id, title: deck.title, cardCount: deck.cards.length, knownCardCount: known.length,
      scheduleComplete: deck.cards.length > 0 && known.length === deck.cards.length,
      dueCount: due.length, overdueCount: due.filter(card => card.nextDueAt < asOf - DECISION_POLICY_DAY_MS).length,
      oldestDueDays: due.length ? Math.max(...due.map(card => (asOf - card.nextDueAt) / DECISION_POLICY_DAY_MS)) : 0,
      nextDueAt: future.length ? Math.min(...future.map(card => card.nextDueAt)) : null });
  }
  // Exact existing mobile progress weights/status rule, reconstructed from prior records only.
  const masteryRows = checks.filter(row => row.score !== undefined).map(row => ({ value: clamp(row.score!), weight: 0.8 }));
  for (const quiz of data.quizResults.filter(row => sameTopic(row.topic) && time(row.createdAt) < asOf)) {
    const pending = new Set(quiz.pendingGradeQuestionIds ?? []);
    const credits = Object.entries(quiz.partialCredits ?? {}).filter(([id]) => !pending.has(id));
    if (pending.size && !credits.length) continue;
    masteryRows.push({ value: clamp(pending.size ? mean(credits.map(([, value]) => value)) : quiz.score / quiz.totalQuestions), weight: 1.2 });
  }
  const recallRows = reviews.map(row => ({ value: row.rating / 3, weight: 0.3 + Math.min(0.7, Math.max(0, row.appliedIntervalDays) / 21) }));
  const weighted = (rows: typeof masteryRows) => rows.length ? clamp(rows.reduce((sum, row) => sum + row.value * row.weight, 0) / rows.reduce((sum, row) => sum + row.weight, 0)) : null;
  const mastery = weighted(masteryRows), retention = weighted(recallRows);
  const confidence = clamp([...masteryRows, ...recallRows].reduce((sum, row) => sum + row.weight, 0) / 5);
  const status = mastery === null ? "insufficient" : mastery < 0.45 || retention !== null && retention < 0.45 ? "needs-review"
    : confidence >= 0.35 && mastery >= 0.75 && (retention === null || retention >= 0.65) ? "strong" : "developing";
  return { topic: key, asOf, objective: objective.length ? { count: objective.length, mean: mean(objective.map(row => row.score!)),
    last: objective.at(-1)!.score!, ageDays: (asOf - time(objective.at(-1)!.createdAt)) / DECISION_POLICY_DAY_MS,
    evidenceIds: objective.map(row => row.id) } : null,
    progress: { mastery, retention, confidence, status }, cards, decks: deckSnapshots,
    reconstruction: "current-deck-metadata-with-prior-canonical-review-schedules" };
}

export interface DecisionPolicySelection { deckId?: string; cardId?: string }
export function decisionPolicyFeatures(snapshot: DecisionPolicySnapshot, target: DecisionPolicyTarget, selection: DecisionPolicySelection = {}): Record<string, number> | null {
  const objective = snapshot.objective;
  if (target === "mastery") return objective ? { objectiveCount: objective.count, objectiveMean: objective.mean, objectiveLast: objective.last, assessmentAgeDays: objective.ageDays } : null;
  if (target === "retention") {
    const card = snapshot.cards.find(row => row.deckId === selection.deckId && row.cardId === selection.cardId);
    if (!card || card.reviewAgeDays < 1) return null;
    return { ...(objective ? { objectiveCount: objective.count, objectiveMean: objective.mean } : {}), priorReviewCount: card.priorReviewCount,
      recallRate: card.recallRate, lapseRate: card.lapseRate, lastRating: card.lastRating, reviewAgeDays: card.reviewAgeDays, intervalDays: card.intervalDays };
  }
  const deck = snapshot.decks.find(row => row.deckId === selection.deckId);
  return deck?.scheduleComplete && deck.dueCount > 0 ? { priorReviewCount: deck.priorReviewCount, recallRate: deck.recallRate,
    lapseRate: deck.lapseRate, reviewAgeDays: deck.reviewAgeDays, dueCount: deck.dueCount, overdueCount: deck.overdueCount,
    knownCardCount: deck.knownCardCount, oldestDueDays: deck.oldestDueDays } : null;
}
export type DecisionPolicyBaseline =
  | { kind: "classification"; predicted: 0 | 1; status: DecisionPolicySnapshot["progress"]["status"]; mastery: number | null; retention: number | null; confidence: number; policy: "progress-thresholds-v1" }
  | { kind: "probability"; value: number; mastery: number; days: number; halfLifeDays: 7; input: "prior-objective-mean" | "prior-card-recall-rate"; policy: "exponential-retention-reconstruction-v1" }
  | { kind: "ordering"; overdueCount: number; dueCount: number; nextDueAt: number | null; webNextDueAt: number | null; title: string; id: string; policy: "coming-up-lexicographic-v1" };
export function decisionPolicyBaseline(snapshot: DecisionPolicySnapshot, target: DecisionPolicyTarget, selection: DecisionPolicySelection = {}): DecisionPolicyBaseline | null {
  if (target === "mastery") return { kind: "classification", ...snapshot.progress, predicted: snapshot.progress.status === "strong" ? 1 : 0, policy: "progress-thresholds-v1" };
  if (target === "retention") {
    const card = snapshot.cards.find(row => row.deckId === selection.deckId && row.cardId === selection.cardId);
    if (!card) return null;
    const mastery = snapshot.objective?.mean ?? card.recallRate;
    return { kind: "probability", value: clamp(mastery * Math.exp(-card.reviewAgeDays * Math.LN2 / (7 * (0.5 + mastery * 1.5)))),
      mastery, days: card.reviewAgeDays, halfLifeDays: 7, input: snapshot.objective ? "prior-objective-mean" : "prior-card-recall-rate", policy: "exponential-retention-reconstruction-v1" };
  }
  const deck = snapshot.decks.find(row => row.deckId === selection.deckId);
  const cards = snapshot.cards.filter(row => row.deckId === selection.deckId);
  return deck?.scheduleComplete ? { kind: "ordering", overdueCount: deck.overdueCount, dueCount: deck.dueCount,
    nextDueAt: deck.nextDueAt, webNextDueAt: cards.length ? Math.min(...cards.map(card => card.nextDueAt)) : null,
    title: deck.title, id: `deck:${deck.deckId}`, policy: "coming-up-lexicographic-v1" } : null;
}
/** This comparator is an ordering, not a probability estimator. */
export function compareDecisionPolicyUrgency(left: Extract<DecisionPolicyBaseline, { kind: "ordering" }>, right: Extract<DecisionPolicyBaseline, { kind: "ordering" }>): number {
  return right.overdueCount - left.overdueCount || right.dueCount - left.dueCount
    || (left.nextDueAt ?? Infinity) - (right.nextDueAt ?? Infinity) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
/** Web currently breaks due-count ties with the oldest due date, including already-due cards. */
export function compareDecisionPolicyWebUrgency(left: Extract<DecisionPolicyBaseline, { kind: "ordering" }>, right: Extract<DecisionPolicyBaseline, { kind: "ordering" }>): number {
  return right.overdueCount - left.overdueCount || right.dueCount - left.dueCount
    || (left.webNextDueAt ?? Infinity) - (right.webNextDueAt ?? Infinity) || left.title.localeCompare(right.title);
}

export interface DecisionPolicySource {
  sourceId: string; learnerId: string; groupId: string; split: "fit" | "validation"; data: PortableLearnerData;
}
export interface DecisionPolicySourceProvenance {
  origin: "local-export" | "public-human" | "synthetic-judgement"; dataset: string; revision: string;
  schedule: "observed" | "replayed-keating-srs" | "unknown" | "simulated-harness"; notes: string;
}
export interface DecisionPolicyBoundSource extends Omit<DecisionPolicySource, "data"> {
  fileSha256: string; text: string; provenance: DecisionPolicySourceProvenance;
}
export interface DecisionPolicySourceArtifact {
  schemaVersion: 1; format: "portable-decision-policy-sources-v1"; sources: DecisionPolicyBoundSource[]; reconstruction: string[];
}
export const DECISION_POLICY_RECONSTRUCTION_LIMITS = [
  "Current deck metadata/roster is used with prior canonical schedules; exports do not prove historic roster revisions.",
  "Retention labels are self-reported card ratings; the exponential baseline uses prior objective mean or explicitly tagged prior card recall rate, not unavailable historic core mastery state.",
  "Urgency compares observed reviewed decks in fixed UTC-day cohorts; unreviewed outcomes stay censored and ranking quality is not causal review benefit.",
  "Learner/group/split independence and dataset origin are explicitly declared, not authenticated by local file hashes.",
] as const;

/** Verify original bytes before regenerating all derived rows. Suitable for browsers without Node. */
export async function verifyDecisionPolicySourceArtifact(value: unknown, digest: (text: string) => Promise<string>): Promise<{
  artifact: DecisionPolicySourceArtifact; datasets: Record<DecisionPolicyTarget, DecisionPolicyDataset>;
}> {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const keys = (v: unknown, names: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === names.length && names.every(name => Object.hasOwn(v, name));
  const text = (v: unknown, limit = 256): v is string => typeof v === "string" && !!v.trim() && v.length <= limit && !/[\u0000-\u001f]/u.test(v);
  const fail = (): never => { throw new Error("decision_policy_source_invalid"); };
  if (!keys(value, ["schemaVersion", "format", "sources", "reconstruction"]) || value.schemaVersion !== 1 || value.format !== "portable-decision-policy-sources-v1"
    || !Array.isArray(value.sources) || value.sources.length > 256 || JSON.stringify(value.reconstruction) !== JSON.stringify(DECISION_POLICY_RECONSTRUCTION_LIMITS)) return fail();
  const artifact = structuredClone(value) as unknown as DecisionPolicySourceArtifact, sources: DecisionPolicySource[] = [];
  let total = 0;
  const synthetic: Array<{ source: DecisionPolicyBoundSource; payload: SyntheticDecisionPolicySource }> = [];
  for (const source of artifact.sources) {
    if (!keys(source, ["sourceId", "learnerId", "groupId", "split", "fileSha256", "text", "provenance"])
      || typeof source.text !== "string" || typeof source.fileSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.fileSha256)
      || source.sourceId !== source.fileSha256) return fail();
    const bytes = new TextEncoder().encode(source.text).byteLength; total += bytes;
    if (bytes > 16_000_000 || total > 64_000_000 || await digest(source.text) !== source.fileSha256) return fail();
    const p = source.provenance;
    if (!keys(p, ["origin", "dataset", "revision", "schedule", "notes"]) || !["local-export", "public-human", "synthetic-judgement"].includes(p.origin as string)
      || !["observed", "replayed-keating-srs", "unknown", "simulated-harness"].includes(p.schedule as string) || !text(p.dataset, 2048) || !text(p.revision, 512) || !text(p.notes, 4096)) return fail();
    const parsed: unknown = JSON.parse(source.text);
    if (p.origin === "synthetic-judgement") {
      if (p.schedule !== "simulated-harness") return fail();
      synthetic.push({ source, payload: await verifySyntheticDecisionPolicySource(parsed, source, digest) });
      continue;
    }
    if (p.schedule === "simulated-harness") return fail();
    const data = validatePortableLearnerData(parsed) ? parsed : parsePortableLearnerEnvelope(parsed).payload;
    sources.push({ sourceId: source.sourceId, learnerId: source.learnerId, groupId: source.groupId, split: source.split, data });
  }
  if (synthetic.length && sources.length) return fail();
  return { artifact, datasets: synthetic.length ? buildSyntheticDecisionPolicyDatasets(synthetic) : buildDecisionPolicyDatasets(sources) };
}
export interface DecisionPolicyRow {
  rowId: string; learnerId: string; groupId: string; split: "fit" | "validation"; asOf: number;
  label: number; features: Record<string, number>; baseline: DecisionPolicyBaseline;
  evidence: { sourceId: string; outcomeKind: "question-check" | "card-review" | "synthetic-judgement"; outcomeId: string; historyIds: string[] };
  cohortId?: string;
}
export interface DecisionPolicyDataset {
  schemaVersion: 1; target: DecisionPolicyTarget; featureSchema: string; domain: string; features: string[];
  labelKind: "observed-binary" | "judgement-probability";
  rows: DecisionPolicyRow[]; omissions: Record<string, number>;
  rankingCohorts: Array<{ id: string; learnerId: string; asOf: number; eligibleDeckIds: string[]; observedDeckIds: string[]; censoredDeckIds: string[] }>;
  audit: { status: "insufficient" | "ready-for-fitting"; fitRows: number; validationRows: number; fitGroups: number; validationGroups: number; reasons: string[] };
}

/** Fixed extraction policy; no data-dependent splitting, pseudo-labels or unreviewed negatives. */
export function buildDecisionPolicyDatasets(sources: readonly DecisionPolicySource[]): Record<DecisionPolicyTarget, DecisionPolicyDataset> {
  const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
  if (!Array.isArray(sources) || sources.length > 256 || sources.some(source => !text(source.sourceId) || !text(source.learnerId)
    || !text(source.groupId) || !["fit", "validation"].includes(source.split) || !validatePortableLearnerData(source.data))
    || new Set(sources.map(source => source.sourceId)).size !== sources.length
    || new Set(sources.map(source => source.learnerId)).size !== sources.length) throw new Error("decision_policy_source_invalid");
  // Bound replay work before any repeated history reconstruction. Reject, never truncate.
  const events = sources.map(source => source.data.questionChecks.length + source.data.cardReviews.length + source.data.quizResults.length);
  if (events.some(count => count > 2000) || events.reduce((sum, count) => sum + count, 0) > 10000
    || (sources as readonly DecisionPolicySource[]).some(source => source.data.decks.length > 256 || source.data.decks.reduce((sum, deck) => sum + deck.cards.length, 0) > 2000)) {
    throw new Error("decision_policy_source_too_large");
  }
  const groups = new Map<string, string>();
  for (const source of sources) {
    if (groups.has(source.groupId) && groups.get(source.groupId) !== source.split) throw new Error("decision_policy_group_leakage");
    groups.set(source.groupId, source.split);
  }
  const makeDataset = (target: DecisionPolicyTarget): DecisionPolicyDataset => ({ schemaVersion: 1, target,
    featureSchema: DECISION_POLICY_FEATURE_SCHEMAS[target], domain: DECISION_POLICY_DOMAINS[target], features: [...DECISION_POLICY_FEATURES[target]], labelKind: "observed-binary",
    rows: [], omissions: {}, rankingCohorts: [], audit: { status: "insufficient", fitRows: 0, validationRows: 0, fitGroups: 0, validationGroups: 0, reasons: [] } });
  const result = { mastery: makeDataset("mastery"), retention: makeDataset("retention"), urgency: makeDataset("urgency") };
  const omit = (target: DecisionPolicyTarget, reason: string) => { const values = result[target].omissions; values[reason] = (values[reason] ?? 0) + 1; };
  for (const source of [...(sources as readonly DecisionPolicySource[])].sort((a, b) => a.sourceId.localeCompare(b.sourceId))) {
    const data = source.data, generatedAt = time(data.generatedAt);
    const checks = [...data.questionChecks].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
    const tasks = new Set<string>();
    for (const outcome of checks) {
      const task = normalizeDecisionPolicyQuestion(outcome.question), asOf = time(outcome.createdAt);
      const repeated = tasks.has(task); tasks.add(task);
      if (outcome.grading !== "auto" || outcome.score === undefined || !outcome.answer.trim()) { omit("mastery", "not-objective-observed-answer"); continue; }
      if (repeated) { omit("mastery", "repeated-task"); continue; }
      if (asOf > generatedAt) { omit("mastery", "outcome-after-export"); continue; }
      if (checks.filter(row => normalizeDecisionPolicyTopic(row.topic) === normalizeDecisionPolicyTopic(outcome.topic) && time(row.createdAt) === asOf).length !== 1) { omit("mastery", "ambiguous-outcome-time"); continue; }
      const snapshot = decisionPolicySnapshot(data, outcome.topic, asOf), features = decisionPolicyFeatures(snapshot, "mastery"), baseline = decisionPolicyBaseline(snapshot, "mastery");
      if (!features || !baseline) { omit("mastery", "missing-prior-objective-history"); continue; }
      result.mastery.rows.push({ rowId: JSON.stringify([source.sourceId, "mastery", outcome.id]), learnerId: source.learnerId,
        groupId: source.groupId, split: source.split, asOf, features, baseline, label: outcome.score === 1 ? 1 : 0,
        evidence: { sourceId: source.sourceId, outcomeKind: "question-check", outcomeId: outcome.id, historyIds: snapshot.objective!.evidenceIds } });
    }
    const reviews = [...data.cardReviews].sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
    for (const outcome of reviews) {
      const asOf = time(outcome.createdAt), deck = data.decks.find(row => row.id === outcome.deckId)!;
      if (outcome.legacyScheduleUnknown || !outcome.nextDueAt) { omit("retention", "legacy-schedule-unknown"); continue; }
      if (asOf > generatedAt) { omit("retention", "outcome-after-export"); continue; }
      if (reviews.filter(row => row.deckId === outcome.deckId && row.cardId === outcome.cardId && time(row.createdAt) === asOf).length !== 1) { omit("retention", "ambiguous-outcome-time"); continue; }
      const selection = { deckId: outcome.deckId, cardId: outcome.cardId }, snapshot = decisionPolicySnapshot(data, deck.topic, asOf);
      const features = decisionPolicyFeatures(snapshot, "retention", selection), baseline = decisionPolicyBaseline(snapshot, "retention", selection);
      if (!features || !baseline) { omit("retention", "missing-delayed-card-history"); continue; }
      const card = snapshot.cards.find(row => row.deckId === outcome.deckId && row.cardId === outcome.cardId)!;
      result.retention.rows.push({ rowId: JSON.stringify([source.sourceId, "retention", outcome.id]), learnerId: source.learnerId,
        groupId: source.groupId, split: source.split, asOf, features, baseline, label: outcome.rating >= 2 ? 1 : 0,
        evidence: { sourceId: source.sourceId, outcomeKind: "card-review", outcomeId: outcome.id,
          historyIds: [...(snapshot.objective?.evidenceIds ?? []), ...card.evidenceIds] } });
    }
    // Fixed calendar cohorts are declared before looking at ratings. Outcomes not observed that day are censored.
    const days = [...new Set(reviews.filter(row => time(row.createdAt) <= generatedAt).map(row => Math.floor(time(row.createdAt) / DECISION_POLICY_DAY_MS) * DECISION_POLICY_DAY_MS))].sort((a, b) => a - b);
    for (const asOf of days) {
      const id = JSON.stringify([source.learnerId, asOf]);
      const cohort: DecisionPolicyDataset["rankingCohorts"][number] = { id, learnerId: source.learnerId, asOf, eligibleDeckIds: [], observedDeckIds: [], censoredDeckIds: [] };
      for (const deck of data.decks) {
        const snapshot = decisionPolicySnapshot(data, deck.topic, asOf), selection = { deckId: deck.id };
        const features = decisionPolicyFeatures(snapshot, "urgency", selection), baseline = decisionPolicyBaseline(snapshot, "urgency", selection);
        if (!features || !baseline) { omit("urgency", "incomplete-or-not-due-prior-schedule"); continue; }
        cohort.eligibleDeckIds.push(deck.id);
        const outcomes = reviews.filter(row => row.deckId === deck.id && time(row.createdAt) > asOf && time(row.createdAt) < asOf + DECISION_POLICY_DAY_MS && time(row.createdAt) <= generatedAt);
        const outcome = outcomes[0];
        if (!outcome) { cohort.censoredDeckIds.push(deck.id); omit("urgency", "unreviewed-deck-censored"); continue; }
        const card = snapshot.cards.find(row => row.deckId === deck.id && row.cardId === outcome.cardId);
        if (outcome.legacyScheduleUnknown || !card || card.nextDueAt > asOf || outcomes.filter(row => row.createdAt === outcome.createdAt).length !== 1) {
          cohort.censoredDeckIds.push(deck.id); omit("urgency", "first-review-not-known-due-or-ambiguous"); continue;
        }
        cohort.observedDeckIds.push(deck.id);
        result.urgency.rows.push({ rowId: JSON.stringify([source.sourceId, "urgency", outcome.id]), learnerId: source.learnerId,
          groupId: source.groupId, split: source.split, asOf, features, baseline, label: outcome.rating === 0 ? 1 : 0, cohortId: id,
          evidence: { sourceId: source.sourceId, outcomeKind: "card-review", outcomeId: outcome.id,
            historyIds: snapshot.decks.find(row => row.deckId === deck.id)!.evidenceIds } });
      }
      if (cohort.eligibleDeckIds.length) result.urgency.rankingCohorts.push(cohort);
    }
  }
  return auditDecisionPolicyDatasets(result);
}

function auditDecisionPolicyDatasets(result: Record<DecisionPolicyTarget, DecisionPolicyDataset>) {
  for (const target of DECISION_POLICY_TARGETS) {
    const dataset = result[target], fit = dataset.rows.filter(row => row.split === "fit"), validation = dataset.rows.filter(row => row.split === "validation");
    const reasons: string[] = [];
    if (fit.length < 40) reasons.push("fewer-than-40-fit-rows");
    if (validation.length < 20) reasons.push("fewer-than-20-validation-rows");
    const fitGroups = new Set(fit.map(row => row.groupId)).size, validationGroups = new Set(validation.map(row => row.groupId)).size;
    if (fitGroups < 8) reasons.push("fewer-than-8-fit-groups");
    if (validationGroups < 6) reasons.push("fewer-than-6-validation-groups");
    if (new Set(fit.map(row => row.label)).size < 2 || new Set(validation.map(row => row.label)).size < 2) reasons.push("missing-outcome-class");
    if (target === "urgency" && !validation.some(left => validation.some(right => left.cohortId === right.cohortId && left.label !== right.label))) reasons.push("no-discordant-validation-ranking-pairs");
    dataset.audit = { status: reasons.length ? "insufficient" : "ready-for-fitting", fitRows: fit.length, validationRows: validation.length, fitGroups, validationGroups, reasons };
  }
  return result;
}

export interface SyntheticDecisionPolicySource {
  schemaVersion: 1; format: "synthetic-decision-policy-source-v1"; familyId: string;
  originals: Array<{ ref: string; sha256: string; text: string }>;
  records: Array<{
    id: string; target: DecisionPolicyTarget; snapshot: DecisionPolicySnapshot; selection: DecisionPolicySelection;
    state: { kind: "simulated-harness" | "trajectory-derived"; seed: string; assumptions: string[]; evidenceRefs: string[] };
    judgement: { model: string; rubric: string; requestText: string; rawResponse: unknown; responsePath: string[]; probability: number; receivedAt: string };
  }>;
}
const policyObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const policyText = (v: unknown, limit = 4096): v is string => typeof v === "string" && !!v.trim() && v.length <= limit;
const policyProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const policyNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e15;
const policyCount = (v: unknown): v is number => policyNumber(v) && Number.isSafeInteger(v) && v <= 10000;
const policyIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 2000 && v.every(id => policyText(id, 512)) && new Set(v).size === v.length;
function policyInvalid(): never { throw new Error("decision_policy_source_invalid"); }

/** Snapshots are declared evidence, not authenticated observations; nevertheless every numeric invariant is checked. */
function validateSyntheticPolicySnapshot(value: unknown, simulated: boolean): value is DecisionPolicySnapshot {
  if (!policyObject(value) || !policyText(value.topic, 512) || !policyNumber(value.asOf) || !Number.isSafeInteger(value.asOf)
    || value.reconstruction !== (simulated ? "explicit-simulated-harness-state" : "source-trajectory-derived-state")
    || !Array.isArray(value.cards) || value.cards.length > 128 || !Array.isArray(value.decks) || value.decks.length > 128
    || !policyObject(value.progress)) return false;
  if (value.objective !== null && (!policyObject(value.objective) || !policyCount(value.objective.count) || value.objective.count < 1
    || !policyProbability(value.objective.mean) || !policyProbability(value.objective.last) || !policyNumber(value.objective.ageDays)
    || !policyIds(value.objective.evidenceIds) || value.objective.evidenceIds.length !== value.objective.count)) return false;
  const progress = value.progress;
  if (!(progress.mastery === null || policyProbability(progress.mastery)) || !(progress.retention === null || policyProbability(progress.retention)) || !policyProbability(progress.confidence)) return false;
  const status = progress.mastery === null ? "insufficient" : progress.mastery < .45 || progress.retention !== null && progress.retention < .45 ? "needs-review"
    : progress.confidence >= .35 && progress.mastery >= .75 && (progress.retention === null || progress.retention >= .65) ? "strong" : "developing";
  if (progress.status !== status) return false;
  const history = (row: unknown): row is Record<string, unknown> => policyObject(row) && policyCount(row.priorReviewCount) && row.priorReviewCount > 0
    && policyProbability(row.recallRate) && policyProbability(row.lapseRate) && row.recallRate + row.lapseRate <= 1 + 1e-9
    && policyProbability(row.lastRating) && policyNumber(row.reviewAgeDays) && row.reviewAgeDays > 0 && policyNumber(row.intervalDays)
    && policyNumber(row.lastReviewedAt) && Math.abs(row.lastReviewedAt + row.reviewAgeDays * DECISION_POLICY_DAY_MS - (value.asOf as number)) < 1
    && policyIds(row.evidenceIds) && row.evidenceIds.length === row.priorReviewCount;
  for (const card of value.cards) if (!history(card) || !policyText(card.deckId, 512) || !policyText(card.cardId, 512) || !policyNumber(card.nextDueAt)
    || Math.abs((card.lastReviewedAt as number) + (card.lastRating === 0 && card.intervalDays === 0 ? 600000 : (card.intervalDays as number) * DECISION_POLICY_DAY_MS) - card.nextDueAt) > 1) return false;
  if (new Set(value.cards.map(card => JSON.stringify([card.deckId, card.cardId]))).size !== value.cards.length) return false;
  for (const deck of value.decks) {
    if (!history(deck) || !policyText(deck.deckId, 512) || !policyText(deck.title, 512) || !policyCount(deck.cardCount) || !policyCount(deck.knownCardCount)
      || typeof deck.scheduleComplete !== "boolean" || !policyCount(deck.dueCount) || !policyCount(deck.overdueCount) || !policyNumber(deck.oldestDueDays)
      || !(deck.nextDueAt === null || policyNumber(deck.nextDueAt))) return false;
    const cards = value.cards.filter(card => card.deckId === deck.deckId), due = cards.filter(card => card.nextDueAt <= (value.asOf as number));
    const future = cards.filter(card => card.nextDueAt > (value.asOf as number));
    if (deck.knownCardCount !== cards.length || deck.knownCardCount > deck.cardCount || deck.scheduleComplete !== (cards.length > 0 && cards.length === deck.cardCount)
      || deck.dueCount !== due.length || deck.overdueCount !== due.filter(card => card.nextDueAt < (value.asOf as number) - DECISION_POLICY_DAY_MS).length
      || deck.oldestDueDays !== (due.length ? Math.max(...due.map(card => ((value.asOf as number) - card.nextDueAt) / DECISION_POLICY_DAY_MS)) : 0)
      || deck.nextDueAt !== (future.length ? Math.min(...future.map(card => card.nextDueAt)) : null)) return false;
  }
  const decks = value.decks;
  return new Set(decks.map(deck => deck.deckId)).size === decks.length && value.cards.every(card => decks.some(deck => deck.deckId === card.deckId));
}

async function verifySyntheticDecisionPolicySource(value: unknown, source: DecisionPolicyBoundSource, digest: (text: string) => Promise<string>): Promise<SyntheticDecisionPolicySource> {
  if (!policyObject(value) || value.schemaVersion !== 1 || value.format !== "synthetic-decision-policy-source-v1" || value.familyId !== source.groupId
    || !policyText(source.learnerId, 256) || !policyText(source.groupId, 256) || !["fit", "validation"].includes(source.split)
    || !Array.isArray(value.originals) || !value.originals.length || value.originals.length > 8
    || !Array.isArray(value.records) || value.records.length > 128) return policyInvalid();
  const originals = value.originals;
  for (const original of originals) {
    if (!policyObject(original) || !policyText(original.ref, 4096) || !policyText(original.text, 100000) || original.sha256 !== await digest(original.text)) return policyInvalid();
    // The allowed source packet deliberately excludes original future conversations and evaluation-only labels.
    const context: unknown = JSON.parse(original.text);
    if (!policyObject(context) || Object.keys(context).some(key => !["id", "family", "actor", "learner", "source"].includes(key))
      || context.family !== value.familyId || !policyText(context.id) || !policyObject(context.actor) || !policyObject(context.source)) return policyInvalid();
  }
  if (new Set(value.originals.map(original => original.ref)).size !== value.originals.length) return policyInvalid();
  const recordIds = new Set<string>();
  for (const record of value.records) {
    if (!policyObject(record) || !policyText(record.id, 512) || recordIds.has(record.id) || !DECISION_POLICY_TARGETS.includes(record.target as DecisionPolicyTarget)
      || !policyObject(record.state) || !["simulated-harness", "trajectory-derived"].includes(record.state.kind as string)
      || !policyText(record.state.seed, 1024) || !policyIds(record.state.assumptions) || !record.state.assumptions.length || !policyIds(record.state.evidenceRefs)
      || !record.state.evidenceRefs.length || record.state.evidenceRefs.some(ref => !originals.some(original => original.ref === ref))
      || !validateSyntheticPolicySnapshot(record.snapshot, record.state.kind === "simulated-harness") || !policyObject(record.selection)
      || Object.keys(record.selection).some(key => !["deckId", "cardId"].includes(key))
      || Object.values(record.selection).some(v => !policyText(v, 512)) || !policyObject(record.judgement)) return policyInvalid();
    recordIds.add(record.id);
    const target = record.target as DecisionPolicyTarget, receipt = record.judgement;
    if (!policyText(receipt.model, 256) || receipt.rubric !== DECISION_POLICY_SYNTHETIC_RUBRICS[target] || !policyText(receipt.requestText, 200000)
      || !policyProbability(receipt.probability) || !policyText(receipt.receivedAt, 64) || !Number.isFinite(Date.parse(receipt.receivedAt))
      || JSON.stringify(receipt.responsePath) !== JSON.stringify(["answers", target, "noul"]) || !policyObject(receipt.rawResponse)) return policyInvalid();
    const response = receipt.rawResponse;
    if (response.model !== receipt.model || !policyObject(response.answers) || !policyObject(response.answers[target])
      || response.answers[target].type !== "noul" || response.answers[target].noul !== receipt.probability) return policyInvalid();
    const request: unknown = JSON.parse(receipt.requestText);
    if (!policyObject(request) || request.model !== receipt.model || !policyObject(request.state) || !policyObject(request.questions)
      || !policyObject(request.questions[target]) || request.questions[target].type !== "noul" || request.questions[target].instructions !== receipt.rubric
      || request.state.snapshot !== JSON.stringify(record.snapshot) || request.state.simulation !== JSON.stringify(record.state)
      || JSON.stringify(request.state.selection) !== JSON.stringify(record.selection)) return policyInvalid();
    const requestState = request.state, evidenceRefs = record.state.evidenceRefs as string[];
    if (!originals.some(original => requestState.original === original.text && evidenceRefs.includes(original.ref))) return policyInvalid();
    if (!decisionPolicyFeatures(record.snapshot, target, record.selection) || !decisionPolicyBaseline(record.snapshot, target, record.selection)) return policyInvalid();
  }
  return value as unknown as SyntheticDecisionPolicySource;
}

function buildSyntheticDecisionPolicyDatasets(sources: Array<{ source: DecisionPolicyBoundSource; payload: SyntheticDecisionPolicySource }>): Record<DecisionPolicyTarget, DecisionPolicyDataset> {
  const result = buildDecisionPolicyDatasets([]), groups = new Map<string, string>(), learners = new Set<string>(), sourceIds = new Set<string>();
  if (sources.reduce((sum, row) => sum + row.payload.records.length, 0) > 2000) throw new Error("decision_policy_source_too_large");
  for (const target of DECISION_POLICY_TARGETS) { result[target].labelKind = "judgement-probability"; result[target].domain = `synthetic-judgement-${DECISION_POLICY_DOMAINS[target]}`; }
  for (const { source, payload } of sources) {
    if (learners.has(source.learnerId) || sourceIds.has(source.sourceId) || groups.has(source.groupId)) throw new Error("decision_policy_group_leakage");
    learners.add(source.learnerId); sourceIds.add(source.sourceId); groups.set(source.groupId, source.split);
    for (const record of payload.records) {
      const target = record.target, snapshot = record.snapshot, cohortId = JSON.stringify([source.groupId, snapshot.asOf]);
      result[target].rows.push({ rowId: JSON.stringify([source.sourceId, record.id]), learnerId: source.learnerId, groupId: source.groupId, split: source.split,
        asOf: snapshot.asOf, label: record.judgement.probability, features: decisionPolicyFeatures(snapshot, target, record.selection)!,
        baseline: decisionPolicyBaseline(snapshot, target, record.selection)!, evidence: { sourceId: source.sourceId, outcomeKind: "synthetic-judgement",
          outcomeId: record.id, historyIds: record.state.evidenceRefs }, ...(target === "urgency" ? { cohortId } : {}) });
      if (target === "urgency") {
        let cohort = result.urgency.rankingCohorts.find(row => row.id === cohortId);
        if (!cohort) { cohort = { id: cohortId, learnerId: source.learnerId, asOf: snapshot.asOf, eligibleDeckIds: [], observedDeckIds: [], censoredDeckIds: [] }; result.urgency.rankingCohorts.push(cohort); }
        const id = record.selection.deckId!;
        if (cohort.eligibleDeckIds.includes(id)) return policyInvalid();
        cohort.eligibleDeckIds.push(id); // "observed" here means a received judge label, explicitly identified by labelKind/domain.
        cohort.observedDeckIds.push(id);
      }
    }
  }
  return auditDecisionPolicyDatasets(result);
}
