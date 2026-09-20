import { isDue, validatePortableLearnerData, validateUiDocument, type PortableLearnerData, type UiDocument, type UiStudyPlanItem } from "@keating/learner-contracts";
import { benchmarkTopics } from "../../../../src/core/topics";
import { reviewStudyCandidates, type ReadinessReview, type StudyCandidate } from "../../../../shared/pedagogy/readiness-review";
import { buildLearnerProgress } from "../learner-progress";
import { buildComingUp } from "../learner-study";
import type { MobileJudgementRuntime } from "./runtime";

export interface MobileReadinessSnapshot { data: PortableLearnerData; nowIso: string; hostedEnabled: boolean; localEnabled?: boolean; calibrationRevision?: number; localCalibrationRevision?: number }
export interface MobileReadinessResult { sourceKey: string | null; candidates: StudyCandidate[]; review: ReadinessReview }
interface Graph { requirements: string[]; prerequisites: string[] }
const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
const definitions = benchmarkTopics();
const aliases = new Map(definitions.flatMap(topic => [[normalized(topic.slug), topic.slug], [normalized(topic.title), topic.slug]]));
const canonicalTopic = (value: string) => aliases.get(normalized(value)) ?? normalized(value);
const EMPTY: ReadinessReview = { schemaVersion: 1, source: "proxy", status: "unavailable", selectedId: null, blocked: [], estimates: [], attempts: [], questionDigests: {} };

/** Local comparison key only: the full portable snapshot is never sent to inference. */
export function mobileReadinessSourceKey(snapshot: MobileReadinessSnapshot): string | null {
  // Bound traversal before serialization or cloning. The key stays transient and local.
  let nodes = 0, text = 0;
  const seen = new Set<object>();
  function bounded(value: unknown, depth = 0): boolean {
    if (++nodes > 30_000 || depth > 32) return false;
    if (typeof value === "string") { text += value.length; return text <= 250_000; }
    if (!value || typeof value !== "object") return true;
    if (seen.has(value)) return false; seen.add(value);
    try {
      if (Array.isArray(value)) return value.length <= 1000 && value.every(child => bounded(child, depth + 1));
      const keys = Object.keys(value); return keys.length <= 1000 && keys.every(key => bounded(key, depth + 1) && bounded((value as Record<string, unknown>)[key], depth + 1));
    } finally { seen.delete(value); }
  }
  try { if (!bounded(snapshot)) return null; const serialized = JSON.stringify(snapshot); return new TextEncoder().encode(serialized).byteLength <= 2_000_000 ? serialized : null; }
  catch { return null; }
}

function savedPlans(data: PortableLearnerData): UiStudyPlanItem[][] {
  const documents = new Map<string, UiDocument>();
  const conflicts = new Map<string, number>();
  for (const session of data.sessions) for (const message of session.messages) for (const event of message.agentEvents ?? []) {
    if (event.type !== "ui-document") continue;
    const key = `${session.id}:${event.document.id}`;
    const conflictRevision = conflicts.get(key);
    if (conflictRevision !== undefined && event.document.revision <= conflictRevision) continue;
    if (conflictRevision !== undefined) conflicts.delete(key);
    const prior = documents.get(key);
    if (!prior || prior.revision < event.document.revision) documents.set(key, event.document);
    // Divergent equal revisions are ambiguous source data, not a graph to choose between.
    else if (prior.revision === event.document.revision && JSON.stringify(prior) !== JSON.stringify(event.document)) { documents.delete(key); conflicts.set(key, prior.revision); }
  }
  for (const artifact of data.artifacts) {
    if (artifact.kind !== "study-plan" || artifact.format !== "json" || !artifact.content || artifact.content.length > 200_000) continue;
    try { const document: unknown = JSON.parse(artifact.content); if (validateUiDocument(document)) documents.set(`artifact:${artifact.id}`, document); } catch { /* Plain saved Markdown is not a dependency graph. */ }
  }
  return [...documents.values()].filter(document => ["ready", "submitted", "completed"].includes(document.lifecycle))
    .flatMap(document => document.nodes.flatMap(node => node.type === "study-plan" && node.items ? [node.items] : []));
}

function planGraph(items: UiStudyPlanItem[], topic: string): Graph | null | undefined {
  const all: UiStudyPlanItem[] = [];
  function flatten(values: UiStudyPlanItem[], depth = 0) { if (depth > 32) return; for (const item of values) { all.push(item); if (item.children) flatten(item.children, depth + 1); } }
  flatten(items);
  const matches = all.filter(item => normalized(item.title) === normalized(topic));
  if (!matches.length) return undefined;
  if (matches.length !== 1 || new Set(all.map(item => item.id)).size !== all.length) return null;
  const byId = new Map(all.map(item => [item.id, item])), dependencies = new Set<string>(), visited = new Set<string>();
  function walk(item: UiStudyPlanItem, path: Set<string>): boolean {
    if (path.size > 32 || path.has(item.id)) return false;
    if (visited.has(item.id)) return true;
    const next = new Set([...path, item.id]);
    // Canonical UiStudyPlanItem defines omitted dependsOn as no edges.
    for (const id of item.dependsOn ?? []) {
      const dependency = byId.get(id);
      if (!dependency || !walk(dependency, next)) return false;
      dependencies.add(dependency.title);
    }
    visited.add(item.id);
    return true;
  }
  const item = matches[0];
  return walk(item, new Set()) ? { requirements: [item.title, ...(item.detail ? [item.detail] : []), ...(item.outcomes ?? [])], prerequisites: [...dependencies] } : null;
}

/** Due work and exposure are deterministic gates; semantic readiness is reviewed separately. */
export function buildMobileReadinessCandidates(data: PortableLearnerData, nowIso: string): StudyCandidate[] {
  if (mobileReadinessSourceKey({ data, nowIso, hostedEnabled: false }) === null || !validatePortableLearnerData(data) || !Number.isFinite(Date.parse(nowIso))) throw new Error("Readiness source unavailable");
  const now = Date.parse(nowIso), plans = savedPlans(data);
  const progress = buildLearnerProgress(data, now), comingUp = buildComingUp(data, progress, nowIso);
  const covered = new Set(data.questionChecks.filter(check => Date.parse(check.createdAt) <= now && check.answer.trim()).map(check => canonicalTopic(check.topic)));
  // These records establish exposure only; they never establish mastery or readiness.
  for (const entry of data.topicEvidence) if (entry.provenance !== "learner-declared" && Date.parse(entry.createdAt) <= now) covered.add(canonicalTopic(entry.topic));
  for (const review of data.cardReviews) if (Date.parse(review.createdAt) <= now) {
    const deck = data.decks.find(item => item.id === review.deckId); if (deck) covered.add(canonicalTopic(deck.topic));
  }
  return comingUp.items.filter(item => item.targetType === "deck" ? item.dueCount > 0 : item.targetType === "topic").map(item => {
    const authored = plans.map(plan => planGraph(plan, item.topic)).filter(graph => graph !== undefined);
    const distinct = new Map(authored.map(graph => [JSON.stringify(graph), graph]));
    const definition = definitions.find(topic => normalized(topic.slug) === normalized(item.topic) || normalized(topic.title) === normalized(item.topic));
    const graph: Graph | null = authored.length ? distinct.size === 1 ? authored[0]! : null
      : definition ? { requirements: [definition.summary, ...definition.formalCore], prerequisites: definition.prerequisites } : null;
    const dueCards = item.targetType === "deck" ? data.decks.find(deck => deck.id === item.targetId)!.cards.filter(card => isDue(card.srs, nowIso)) : [];
    if (dueCards.length > 100) throw new Error("Readiness source unavailable");
    const workTopics = new Set([canonicalTopic(item.topic), ...(graph?.prerequisites ?? []).map(canonicalTopic)]);
    const work = data.questionChecks.filter(check => workTopics.has(canonicalTopic(check.topic)) && Date.parse(check.createdAt) <= now && check.question.trim() && check.answer.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 12)
      .map(check => ({ question: check.question, answer: check.answer,
        result: check.grading !== "auto" || check.score === undefined ? "pending" as const : check.score === 1 ? "correct" as const : check.score === 0 ? "incorrect" as const : "pending" as const }));
    return { id: item.id, title: item.title, requirements: [...(graph?.requirements ?? []), ...dueCards.map(card => card.front)],
      due: item.targetType === "deck" ? item.dueCount > 0 : item.targetType === "topic",
      covered: covered.has(canonicalTopic(item.topic)), prerequisiteGraphKnown: graph !== null,
      prerequisites: (graph?.prerequisites ?? []).map(topic => ({ id: topic, covered: covered.has(canonicalTopic(topic)) })), work };
  });
}

export async function reviewMobileStudyReadiness(snapshot: MobileReadinessSnapshot, options: {
  current: () => MobileReadinessSnapshot | null;
  runtime?: MobileJudgementRuntime;
  runtimeFactory?: () => Promise<MobileJudgementRuntime>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<MobileReadinessResult> {
  const sourceKey = mobileReadinessSourceKey(snapshot);
  if (sourceKey === null) return { sourceKey, candidates: [], review: { ...EMPTY } };
  const source = structuredClone(snapshot);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 30_000);
  const current = () => { const next = options.current(); return !controller.signal.aborted && next !== null && mobileReadinessSourceKey(next) === sourceKey; };
  let candidates: StudyCandidate[] = [];
  try {
    candidates = buildMobileReadinessCandidates(source.data, source.nowIso);
    if (!current()) return { sourceKey, candidates, review: { ...EMPTY, status: "cancelled" } };
    // Deterministic gating and disabled settings never need account access.
    const baseline = await reviewStudyCandidates(candidates, null, undefined, controller.signal);
    if (!(source.hostedEnabled || source.localEnabled) || baseline.status === "no-ready-candidate" || candidates.length > 20) return { sourceKey, candidates, review: baseline };
    let abandon: (() => void) | undefined;
    const abandoned = new Promise<null>(resolve => { abandon = () => resolve(null); controller.signal.addEventListener("abort", abandon, { once: true }); if (controller.signal.aborted) abandon(); });
    let runtime: MobileJudgementRuntime | null;
    try { runtime = options.runtime ?? await Promise.race([(options.runtimeFactory ?? (async () => (await import("./runtime")).configuredMobileJudgementRuntime()))(), abandoned]); }
    finally { if (abandon) controller.signal.removeEventListener("abort", abandon); }
    if (!runtime) return { sourceKey, candidates, review: { ...EMPTY, status: "cancelled" } };
    if (!current()) return { sourceKey, candidates, review: { ...EMPTY, status: "cancelled" } };
    const call: MobileJudgementRuntime["call"] | null = (runtime.enabled ?? runtime.hostedEnabled) ? (request, signal) => {
      if (!current()) { controller.abort(); return Promise.resolve({ ok: false, error: { code: "cancelled", retryable: false } }); }
      return runtime.call(request, signal);
    } : null;
    const review = await reviewStudyCandidates(candidates, call, runtime.policy.calibration, controller.signal);
    return { sourceKey, candidates, review: current() ? review : { ...EMPTY, status: "cancelled" } };
  } catch { return { sourceKey, candidates, review: { ...EMPTY, status: controller.signal.aborted ? "cancelled" : "unavailable" } }; }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
