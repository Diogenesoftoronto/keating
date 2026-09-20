import { reviewStudyCandidates, type ReadinessReview, type StudyCandidate } from "../../../../shared/pedagogy/readiness-review";
import { validateUiActionJournal, validateUiDocument, type UiStudyPlanItem, type UiStudyPlanNode } from "@keating/learner-contracts";
import { benchmarkTopics } from "../core";
import { buildComingUpQueue, type ComingUpItem } from "../coming-up";
import type { CardReviewRecord, FlashcardDeck, LearnerState, LessonPlan, QuestionCheckRecord, Verification } from "../storage";
import { sharedUiActionStateKey } from "../openui/shared-actions";
import type { JudgementModelSettings } from "../judgement-model";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./runtime";
import { createJudgementOperationCaller } from "./operation";

export const READINESS_HISTORY_SCOPE = "Up to 12 recent saved question answers per due deck and its prerequisites. Recorded exposure is not mastery.";
export interface ComingUpReadinessSource {
  getDecks(): Promise<FlashcardDeck[]>;
  getVerifications(): Promise<Verification[]>;
  getLearnerState(): Promise<LearnerState>;
  getQuestionChecks(): Promise<QuestionCheckRecord[]>;
  getCardReviews(): Promise<CardReviewRecord[]>;
  getLessonPlans(): Promise<LessonPlan[]>;
  /** Existing durable canonical action state, addressed only through a saved plan's document ID. */
  readStudyPlanState?: (documentId: string) => string | null;
}
export interface ComingUpReadinessInput {
  key: string;
  candidates: StudyCandidate[];
  items: Pick<ComingUpItem, "id" | "targetId" | "title">[];
  unavailable: "input-budget" | null;
  graphBindings?: Record<string, { artifactIds: string[]; documentId: string; revision: number; nodeId: string; itemId: string }>;
}
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Readiness operation cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
async function digest(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}

interface BoundPlanGraph {
  requirements: string[];
  prerequisites: { id: string; covered: boolean }[];
  workTopics: string[];
  binding: NonNullable<ComingUpReadinessInput["graphBindings"]>[string];
}
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",") + "}"
    : JSON.stringify(value);

/** Topic metadata binds the document; a unique authored item identifies the candidate, never invents edges. */
function boundPlanGraph(topic: string, plans: LessonPlan[], states: Record<string, string | null>, now: number): BoundPlanGraph | null | undefined {
  const bound = plans.filter(plan => normalize(plan.topic) === normalize(topic) && plan.metadata?.source === "openui");
  if (!bound.length) return undefined;
  const documentIds = new Set(bound.map(plan => plan.metadata?.documentId));
  if (documentIds.size !== 1) return null;
  const documentId = bound[0]!.metadata?.documentId;
  if (typeof documentId !== "string" || !documentId || documentId.length > 512) return null;
  const raw = states[documentId];
  if (!raw || raw.length > 200_000) return null;
  try {
    const saved = JSON.parse(raw) as { version?: unknown; document?: unknown; journal?: unknown };
    if (saved.version !== 1 || !validateUiDocument(saved.document) || !validateUiActionJournal(saved.journal)) return null;
    const document = saved.document, journal = saved.journal;
    if (document.id !== documentId || journal.documentId !== documentId || normalize(document.title ?? "") !== normalize(topic)
      || !["ready", "submitted", "completed"].includes(document.lifecycle)
      || bound.some(plan => !Number.isSafeInteger(plan.metadata?.documentRevision) || Number(plan.metadata?.documentRevision) < 0
        || Number(plan.metadata?.documentRevision) > document.revision)) return null;
    // Never choose one of two competing current revisions, or use an older document than its own journal.
    const resulting = journal.receipts.flatMap(receipt => receipt.result?.resultingDocument ? [receipt.result.resultingDocument] : []);
    if (resulting.some(other => other.id !== document.id || other.revision > document.revision
      || (other.revision === document.revision && stable(other) !== stable(document)))) return null;
    const matches: { node: UiStudyPlanNode; item: UiStudyPlanItem; all: UiStudyPlanItem[] }[] = [];
    for (const node of document.nodes) {
      if (node.type !== "study-plan" || !node.items) continue;
      const all: UiStudyPlanItem[] = [];
      const visit = (items: UiStudyPlanItem[], depth: number) => {
        if (depth > 16 || all.length + items.length > 256) throw new Error("Plan graph limit");
        for (const item of items) { all.push(item); if (item.children) visit(item.children, depth + 1); }
      };
      visit(node.items, 0);
      for (const item of all) if (normalize(item.title) === normalize(topic)) matches.push({ node, item, all });
    }
    if (matches.length !== 1) return null;
    const { node, item, all } = matches[0]!;
    if (node.relatedPlans?.some(link => link.relation === "prerequisite") || new Set(all.map(value => value.id)).size !== all.length) return null;
    const byId = new Map(all.map(value => [value.id, value]));
    const dependencies = new Map<string, UiStudyPlanItem>();
    const visited = new Set<string>();
    const walk = (value: UiStudyPlanItem, path: Set<string>): boolean => {
      if (path.has(value.id) || path.size > 16) return false;
      if (visited.has(value.id)) return true;
      const next = new Set([...path, value.id]);
      // Canonical UiStudyPlanItem explicitly defines omitted dependsOn as no edges.
      for (const id of value.dependsOn ?? []) {
        const dependency = byId.get(id);
        if (!dependency || !walk(dependency, next)) return false;
        dependencies.set(id, dependency);
      }
      visited.add(value.id); return true;
    };
    if (!walk(item, new Set())) return null;
    const authored = (value: UiStudyPlanItem): unknown => {
      const { status: _status, children, ...fields } = value;
      return { ...fields, ...(children ? { children: children.map(authored) } : {}) };
    };
    const findItem = (items: UiStudyPlanItem[], id: string): UiStudyPlanItem | undefined => {
      for (const candidate of items) {
        if (candidate.id === id) return candidate;
        const nested = candidate.children && findItem(candidate.children, id); if (nested) return nested;
      }
      return undefined;
    };
    const prerequisites = [...dependencies.values()].map(dependency => {
      const completion = journal.receipts.filter(receipt => receipt.state === "completed" && receipt.action.type === "complete-plan-item"
        && receipt.action.nodeId === node.id && receipt.action.itemId === dependency.id)
        .sort((a, b) => b.action.documentRevision - a.action.documentRevision)[0];
      const completedNode = completion?.result?.resultingDocument?.nodes.find(value => value.id === node.id);
      const completedItem = completedNode?.type === "study-plan" && completedNode.items ? findItem(completedNode.items, dependency.id) : undefined;
      const completed = dependency.status === "done" && completion?.action.type === "complete-plan-item" && completion.action.completed
        && Number.isFinite(Date.parse(completion.updatedAt)) && Date.parse(completion.updatedAt) <= now
        && completedItem && stable(authored(completedItem)) === stable(authored(dependency));
      return { id: `plan:${document.id}:${node.id}:${dependency.id}`, covered: !!completed };
    });
    return { requirements: [item.title, ...(item.detail ? [item.detail] : []), ...(item.outcomes ?? []),
      "Prerequisite flags below represent recorded plan-item completion, not demonstrated mastery.",
      ...prerequisites.map(prerequisite => `${prerequisite.id}: ${prerequisite.covered ? "recorded complete" : "no current completion receipt"}.`)],
      prerequisites, workTopics: [...dependencies.values()].map(dependency => dependency.title),
      binding: { artifactIds: bound.map(plan => plan.id).sort(), documentId, revision: document.revision, nodeId: node.id, itemId: item.id } };
  } catch { return null; }
}

/** Known authored catalog or explicitly bound canonical plan; synthetic fallback topics are never graphs. */
export async function loadComingUpReadiness(source: ComingUpReadinessSource, now = Date.now()): Promise<ComingUpReadinessInput> {
  const [decks, verifications, learnerState, checks, reviews, plans] = await Promise.all([
    source.getDecks(), source.getVerifications(), source.getLearnerState(), source.getQuestionChecks(), source.getCardReviews(),
    source.getLessonPlans(),
  ]);
  const planStates: Record<string, string | null> = Object.create(null);
  if (plans.length <= 200) for (const plan of plans) {
    const id = plan.metadata?.source === "openui" ? plan.metadata.documentId : null;
    if (typeof id !== "string" || id.length > 512 || Object.hasOwn(planStates, id)) continue;
    try { planStates[id] = source.readStudyPlanState ? source.readStudyPlanState(id)
      : typeof localStorage === "undefined" ? null : localStorage.getItem(sharedUiActionStateKey(id)); }
    catch { planStates[id] = null; }
  }
  const raw = { decks, verifications, learnerState, checks, reviews, plans, planStates };
  if (decks.length > 200 || checks.length > 2_000 || reviews.length > 10_000 || plans.length > 200 || bytes(raw).length > 2_000_000) {
    return { key: "input-budget", candidates: [], items: [], unavailable: "input-budget" };
  }
  const queue = buildComingUpQueue({ decks, verifications, learnerState, now });
  const items = queue.items.filter(item => item.targetType === "deck" && item.dueCount > 0);
  const catalog = benchmarkTopics();
  const known = new Map(catalog.flatMap(topic => [[normalize(topic.slug), topic], [normalize(topic.title), topic]] as const));
  const canonical = (topic: string) => known.get(normalize(topic))?.slug ?? normalize(topic);
  const observed = new Set<string>();
  const inPast = (at: number) => Number.isFinite(at) && at > 0 && at <= now;
  // topicsExplored and derived topic profiles include inferred labels, not completed exposure.
  for (const session of learnerState.sessions) if (session.endedAt && inPast(session.endedAt) && session.endedAt >= session.startedAt) {
    for (const topic of session.topicsCovered) observed.add(canonical(topic));
  }
  for (const review of reviews) if (inPast(review.createdAt)) observed.add(canonical(review.topic));
  const answers = checks.filter(check => inPast(check.createdAt) && check.question.trim() && check.answer.trim())
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  for (const check of answers) observed.add(canonical(check.topic));
  let overBudget = items.length > 20;
  const graphBindings: NonNullable<ComingUpReadinessInput["graphBindings"]> = {};
  const candidates: StudyCandidate[] = items.map(item => {
    const definition = known.get(normalize(item.topic));
    const plan = boundPlanGraph(item.topic, plans, planStates, now);
    if (plan) graphBindings[item.id] = plan.binding;
    const topic = canonical(item.topic);
    const prerequisites = plan ? plan.prerequisites : plan === null ? []
      : (definition?.prerequisites ?? []).map(name => ({ id: canonical(name), covered: observed.has(canonical(name)) }));
    const relevant = new Set([topic, ...(plan ? plan.workTopics.map(canonical) : prerequisites.map(prerequisite => prerequisite.id))]);
    const selected = answers.filter(check => relevant.has(canonical(check.topic))).slice(0, 12);
    const dueCards = decks.find(deck => deck.id === item.targetId)!.cards.filter(card => card.srs.dueAt <= now);
    if (dueCards.length > 100) overBudget = true;
    return { id: item.id, title: item.title, due: true, covered: observed.has(topic), prerequisiteGraphKnown: plan !== undefined ? plan !== null : !!definition,
      prerequisites, requirements: [...(plan?.requirements ?? (plan === null ? [] : definition?.formalCore ?? [])), ...dueCards.map(card => card.front)],
      work: selected.map(check => ({ question: check.question, answer: check.answer,
        result: check.grading === "auto" && check.score === 1 ? "correct" as const
          : check.grading === "auto" && check.score === 0 ? "incorrect" as const : "pending" as const })) };
  });
  if (bytes(candidates).length > 55_000) overBudget = true;
  // Bind to the full local source/profile and due queue, but never send the profile to the model.
  const key = await digest({ raw, queue, candidates });
  return { key, candidates, graphBindings, items: items.map(({ id, targetId, title }) => ({ id, targetId, title })), unavailable: overBudget ? "input-budget" : null };
}

export interface ComingUpReadinessResult {
  input: ComingUpReadinessInput;
  review: ReadinessReview | null;
  reason: "input-budget" | "stale" | "cancelled" | "unavailable" | null;
}
/** Both model stages recheck current source before dispatch; no stale result becomes a suggestion. */
export async function reviewComingUpReadiness(input: ComingUpReadinessInput, runtime: WebJudgementRuntime,
  options: { signal?: AbortSignal; current: () => Promise<boolean> }): Promise<ComingUpReadinessResult> {
  const result = (reason: ComingUpReadinessResult["reason"], review: ReadinessReview | null = null) => ({ input, reason, review });
  if (input.unavailable) return result("input-budget");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 30_000);
  let stale = false;
  const call = createJudgementOperationCaller({ runtime, timeoutMs: 30_000, accept: () => true,
    diagnostics: { origin: "coming-up-readiness", application: "Optional review suggestion; schedules, priorities and learner records unchanged" } });
  try {
    const current = async () => {
      if (controller.signal.aborted) return false;
      if (!await abortable(options.current(), controller.signal)) { stale = true; controller.abort(); return false; }
      return !controller.signal.aborted;
    };
    if (!await current()) return result(stale ? "stale" : "cancelled");
    const review = await reviewStudyCandidates(input.candidates, runtime.settings.backend === "off" ? null : async (request, signal) => {
      if (!await current()) return { ok: false, error: { code: "cancelled", retryable: false } };
      if (bytes(request).length > 85_000) return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      return call(request, signal);
    }, runtime.policy.calibration, controller.signal);
    if (!await current()) return result(stale ? "stale" : "cancelled");
    return result(null, review);
  } catch { return result(controller.signal.aborted ? "cancelled" : "unavailable"); }
  finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

export interface ComingUpReadinessView { pending: boolean; result: ComingUpReadinessResult | null; stale: boolean }
/** Used by Coming Up; lifecycle updates never initiate inference or restore a cached receipt. */
export function createComingUpReadinessSession(options: {
  load: () => Promise<ComingUpReadinessInput>;
  contextKey: () => string;
  settings: () => JudgementModelSettings;
  publish: (view: ComingUpReadinessView) => void;
  runtime?: (settings: JudgementModelSettings) => WebJudgementRuntime;
  timeoutMs?: number;
}) {
  let controller: AbortController | null = null;
  let epoch = 0;
  let disposed = false;
  let currentInput: ComingUpReadinessInput | null = null;
  let currentResult: ComingUpReadinessResult | null = null;
  let context = "";
  let refreshing = false;
  const settingsKey = () => JSON.stringify(options.settings());
  let settings = "";
  const invalidate = (stale = true) => {
    epoch++; controller?.abort(); controller = null; currentInput = null; currentResult = null;
    if (!disposed) options.publish({ pending: false, result: null, stale });
  };
  const fresh = async (input: ComingUpReadinessInput, key: string, setting: string, signal: AbortSignal) => {
    if (disposed || options.contextKey() !== key || settingsKey() !== setting) return false;
    const next = await abortable(options.load(), signal);
    return !disposed && next.key === input.key && options.contextKey() === key && settingsKey() === setting;
  };
  return {
    invalidate,
    activate() { disposed = false; },
    dispose() { disposed = true; invalidate(false); },
    async openSelected(deckId: string, open: (id: string) => void) {
      const result = currentResult;
      if (!currentInput || result?.review?.status !== "selected"
        || !result.input.items.some(item => item.id === result.review!.selectedId && item.targetId === deckId)) return;
      const token = epoch, controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(30_000, options.timeoutMs ?? 30_000));
      try {
        if (await fresh(currentInput, context, settings, controller.signal) && token === epoch && !disposed) open(deckId);
        else if (token === epoch) invalidate();
      } catch { if (token === epoch) invalidate(); }
      finally { clearTimeout(timer); }
    },
    async refresh() {
      if (!currentInput || refreshing || disposed) return;
      refreshing = true; const token = epoch;
      const refreshController = new AbortController();
      const timer = setTimeout(() => refreshController.abort(), Math.min(30_000, options.timeoutMs ?? 30_000));
      try { if (!await fresh(currentInput, context, settings, refreshController.signal) && token === epoch) invalidate(); }
      catch { if (token === epoch) invalidate(); }
      finally { clearTimeout(timer); refreshing = false; }
    },
    async review() {
      if (disposed) return;
      invalidate(false); const token = epoch;
      controller = new AbortController(); const signal = controller.signal;
      context = options.contextKey(); settings = settingsKey();
      const key = context, setting = settings, preference = options.settings();
      options.publish({ pending: true, result: null, stale: false });
      const timer = setTimeout(() => {
        if (token !== epoch || disposed) return;
        controller?.abort();
        options.publish({ pending: false, result: { input: currentInput ?? { key: "cancelled", candidates: [], items: [], unavailable: null }, review: null, reason: "cancelled" }, stale: false });
      }, Math.min(30_000, options.timeoutMs ?? 30_000));
      try {
        const input = await abortable(options.load(), signal);
        if (signal.aborted || token !== epoch || disposed) return;
        currentInput = input;
        const result = await reviewComingUpReadiness(input, (options.runtime ?? (value => createWebJudgementRuntime({ settings: value })))(preference),
          { signal, current: () => fresh(input, key, setting, signal) });
        if (signal.aborted || token !== epoch || disposed) return;
        currentResult = result;
        options.publish({ pending: false, result, stale: result.reason === "stale" });
      } catch {
        if (!signal.aborted && token === epoch && !disposed) options.publish({ pending: false,
          result: { input: currentInput ?? { key: "unavailable", candidates: [], items: [], unavailable: null }, review: null, reason: "unavailable" }, stale: false });
      } finally { clearTimeout(timer); }
    },
  };
}
