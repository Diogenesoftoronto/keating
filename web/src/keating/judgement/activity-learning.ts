import type { ActiveWork, ActivitySelection, ActivitySelectionInput, ReleasedActivitySelection } from "@keating/learner-contracts";
import { ACTIVITY_LEARNING_POLICY, describeActivityCandidate, linkActivityOutcomes, selectActivityCandidate, validateActivityExposure,
  type ActivityBoundary, type ActivityExposure, type ActivityObjectiveOutcome, type ActivitySource } from "../../../../packages/learner-contracts/src/judgement/activity-learning";
import type { OpenUIDocumentScope } from "../openui/types";
import { LEARNING_EVIDENCE_CHANGED_EVENT, LEARNING_HISTORY_REPLACEMENT_EVENT, type OpenUiPresentationRecord, type QuestionCheckRecord } from "../storage";
import { presentationsFromAssistantText } from "./active-work-host";
import { learnBackgroundActivityPolicy, validateBackgroundActivityPolicy, type BackgroundActivityPolicy } from "../../../../packages/learner-contracts/src/judgement/background-activity-policy";
import { ONLINE_LEARNING_CHANGED, onlineLearningAccount, onlineLearningChatMode, onlineLearningEnabled, requestOnlinePredictions, type ActivityLearningMode } from "./tabular-account";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../model-prefs";

const STORE_PREFIX = "keating.activity-learning.v1:";
const MAX_BOUNDARIES = 1_000;
const MAX_STORE_CHARS = 2_000_000;
const PENDING_AGE_MS = 10 * 60_000;
const POLICY_PREFIX = "keating.activity-policy.v1:";
const RESEARCH_PREFIX = "keating.activity-research.v1:";
const RESEARCH_COOLDOWN_MS = 60_000;
const RESEARCH_TIMEOUT_MS = 30_000;
type History = { version: 1; exposures: ActivityExposure[]; boundaries: ActivityBoundary[] };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface ActivityRecordSource {
  getQuestionChecks(): Promise<QuestionCheckRecord[]>;
  getOpenUiPresentations(sessionId?: string): Promise<OpenUiPresentationRecord[]>;
}
interface HostOptions {
  sessionId: string;
  source: ActivityRecordSource;
  current(): boolean;
  storage?: () => Store | null;
  account?: typeof onlineLearningAccount;
  enabled?: typeof onlineLearningEnabled;
  mode?: typeof onlineLearningChatMode;
  transport?: typeof requestOnlinePredictions;
  select?: typeof selectActivityCandidate;
  learn?: typeof learnBackgroundActivityPolicy;
  now?: () => number;
}
interface PendingPresentation {
  scope: string;
  generation: number;
  publishedAt: number;
  textKey: string;
  selection: ReleasedActivitySelection;
  sources: ActivitySource[];
  host: WebActivityLearning;
  ready?: Promise<void>;
}
interface PublicationContext { scope: string; generation: number }
interface ResearchState {
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  running?: Promise<void>;
  nextHost?: WebActivityLearning;
  lastAttemptAt: number;
  evidenceKey: string | null;
}
const research = new Map<string, ResearchState>();
const policies = new Map<string, BackgroundActivityPolicy | null>();
const hosts = new Map<string, WebActivityLearning>();
const authorities = new Map<string, string>();
const evidenceVersions = new Map<string, number>();
let historyReplacementDepth = 0;
const pendingPresentations = new Map<string, PendingPresentation>();
const generations = new Map<string, number>();
// A failed boundary write makes the persisted attribution windows untrustworthy.
const quarantinedHistories = new Set<string>();
const generationFor = (scope: string) => generations.get(scope) ?? 0;
let observedWindow: Window | undefined;
function invalidateHistory(scope: string): void {
  generations.set(scope, generationFor(scope) + 1);
  const job = research.get(scope);
  if (job?.timer) clearTimeout(job.timer);
  job?.controller?.abort();
  research.delete(scope); policies.delete(scope);
  for (const [key, pending] of pendingPresentations) if (pending.scope === scope) pendingPresentations.delete(key);
}
function observeStorage(): void {
  if (typeof window === "undefined" || observedWindow === window) return;
  observedWindow = window;
  window.addEventListener("storage", event => {
    if (event.key?.startsWith(STORE_PREFIX) && event.newValue === null) invalidateHistory(event.key.slice(STORE_PREFIX.length));
    if (event.key?.startsWith(POLICY_PREFIX)) policies.delete(event.key.slice(POLICY_PREFIX.length));
    if (event.key === null) {
      for (const scope of generations.keys()) invalidateHistory(scope);
      pendingPresentations.clear();
    }
  });
  const changed = () => {
    for (const [scope, host] of hosts) { host.refreshAuthorization(scope); host.schedule(); }
  };
  for (const event of [ONLINE_LEARNING_CHANGED, PROVIDER_CREDENTIALS_CHANGED_EVENT, "storage", "focus"]) window.addEventListener(event, changed);
  window.addEventListener(LEARNING_EVIDENCE_CHANGED_EVENT, () => {
    for (const [scope, host] of hosts) {
      evidenceVersions.set(scope, (evidenceVersions.get(scope) ?? 0) + 1);
      research.get(scope)?.controller?.abort();
      host.schedule();
    }
  });
  window.addEventListener(LEARNING_HISTORY_REPLACEMENT_EVENT, event => {
    if ((event as CustomEvent<{ phase: string }>).detail?.phase === "begin") {
      historyReplacementDepth++;
      for (const [scope, host] of hosts) host.discardHistory(scope);
    } else if ((event as CustomEvent<{ phase: string }>).detail?.phase === "end") {
      historyReplacementDepth = Math.max(0, historyReplacementDepth - 1);
      if (!historyReplacementDepth) for (const host of hosts.values()) host.schedule();
    }
  });
}
const publicationKey = (sessionId: string, timestamp: number) => JSON.stringify([sessionId, timestamp]);

function browserStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
/** Local join key only. Neither identifiers nor question/reply text enter an inference request. */
function fingerprint(text: string): string {
  let left = 2166136261, right = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); left = Math.imul(left ^ code, 16777619); right = Math.imul(right ^ code, 2246822519);
  }
  return `${(left >>> 0).toString(16)}-${(right >>> 0).toString(16)}`;
}
const emptyHistory = (): History => ({ version: 1, exposures: [], boundaries: [] });
const validBoundary = (value: unknown): value is ActivityBoundary => !!value && typeof value === "object"
  && typeof (value as ActivityBoundary).sessionId === "string" && (value as ActivityBoundary).sessionId.length <= 256
  && Number.isSafeInteger((value as ActivityBoundary).createdAt) && (value as ActivityBoundary).createdAt > 0;

function readHistory(store: Store | null, scope: string): History {
  if (quarantinedHistories.has(scope)) return emptyHistory();
  try {
    const raw = store?.getItem(STORE_PREFIX + scope);
    if (!raw || raw.length > MAX_STORE_CHARS) return emptyHistory();
    const value = JSON.parse(raw) as History;
    if (value.version !== 1 || !Array.isArray(value.exposures) || value.exposures.length > ACTIVITY_LEARNING_POLICY.maxExposures
      || !value.exposures.every(validateActivityExposure) || !Array.isArray(value.boundaries)
      || value.boundaries.length > MAX_BOUNDARIES || !value.boundaries.every(validBoundary)) return emptyHistory();
    return value;
  } catch { return emptyHistory(); }
}
function writeHistory(store: Store | null, scope: string, history: History): void {
  if (quarantinedHistories.has(scope)) throw new Error("activity-history-unavailable");
  const ordered = [...history.boundaries].sort((a, b) => a.createdAt - b.createdAt);
  const boundaries = ordered.slice(-MAX_BOUNDARIES);
  // If old publication boundaries were dropped, remove the exposures they could have censored.
  const boundaryFloor = ordered.length > MAX_BOUNDARIES ? boundaries[0]!.createdAt : 0;
  const exposures = history.exposures.filter(value => value.createdAt >= boundaryFloor && validateActivityExposure(value))
    .sort((a, b) => a.createdAt - b.createdAt).slice(-ACTIVITY_LEARNING_POLICY.maxExposures);
  const raw = JSON.stringify({ version: 1, exposures, boundaries });
  try {
    if (!store) throw new Error("activity-history-unavailable");
    if (raw.length > MAX_STORE_CHARS) throw new Error("activity-history-too-large");
    store.setItem(STORE_PREFIX + scope, raw);
  } catch (error) {
    // Losing a publication boundary would let later answers label an earlier reply.
    // Drop this optional ledger rather than keep an incomplete attribution window.
    quarantinedHistories.add(scope);
    invalidateHistory(scope);
    try { store?.removeItem(STORE_PREFIX + scope); } catch { /* Quarantine persists when removal also fails. */ }
    throw error;
  }
}

/** First-recorded is an observation about this history, never a claim that the answer was unaided. */
export function activityOutcomesFromChecks(checks: readonly QuestionCheckRecord[]): ActivityObjectiveOutcome[] {
  const key = (check: QuestionCheckRecord) => fingerprint(JSON.stringify([check.topic.trim().toLowerCase(), check.question.trim().toLowerCase()]));
  const earliest = new Map<string, { timestamp: number; count: number }>();
  for (const check of checks) {
    const id = key(check), previous = earliest.get(id);
    if (!previous || check.createdAt < previous.timestamp) earliest.set(id, { timestamp: check.createdAt, count: 1 });
    else if (check.createdAt === previous.timestamp) previous.count++;
  }
  return checks.flatMap(check => {
    // Semantic empty answers can be stored as auto/0. Match the canonical
    // objective policy, retaining those rows above when detecting earlier attempts.
    if (!check.sessionId || !check.source || check.grading !== "auto" || check.score === undefined || !check.answer.trim()) return [];
    const questionKey = key(check), first = earliest.get(questionKey)!;
    return [{ id: check.id, sessionId: check.sessionId, createdAt: check.createdAt, grading: check.grading,
      ...(check.score === undefined ? {} : { score: check.score }), source: { ...check.source }, questionKey,
      attemptStatus: check.createdAt > first.timestamp ? "repeat" as const : first.count === 1 ? "first-recorded" as const : "unknown" as const }];
  });
}

/** One host per chat runtime; private choices stay in memory until their exact public message renders. */
export class WebActivityLearning {
  private contexts = new Map<string, { scope: string; generation: number; sources: ActivitySource[] }>();
  private readonly account: typeof onlineLearningAccount;
  private readonly enabled: typeof onlineLearningEnabled;
  private readonly mode: typeof onlineLearningChatMode;
  private readonly storage: () => Store | null;
  private readonly now: () => number;
  constructor(private readonly options: HostOptions) {
    observeStorage();
    this.account = options.account ?? onlineLearningAccount;
    this.enabled = options.enabled ?? onlineLearningEnabled;
    this.mode = options.mode ?? onlineLearningChatMode;
    this.storage = options.storage ?? browserStore;
    this.now = options.now ?? Date.now;
  }
  private authorized(scope: string, requireEnabled = true): boolean {
    return this.options.current() && this.accountAuthorized(scope, requireEnabled);
  }
  private accountAuthorized(scope: string, requireEnabled = true): boolean {
    const account = this.account();
    return account.authorized && account.scope === scope && (!requireEnabled || this.enabled(scope));
  }
  /** Preference/account transitions invalidate work even if the setting is changed back before it finishes. */
  refreshAuthorization(scope: string): void {
    const account = this.account();
    const signature = JSON.stringify([account.scope, account.authorized, this.enabled(scope), this.mode(scope)]);
    const previous = authorities.get(scope);
    if (previous !== undefined && previous !== signature) invalidateHistory(scope);
    authorities.set(scope, signature);
  }
  discardHistory(scope: string): void {
    try { clearWebActivityLearningHistory(scope, this.storage()); } catch { /* The quarantined ledger stays disabled. */ }
  }
  private selectionKey(selection: ReleasedActivitySelection): string {
    return fingerprint(JSON.stringify(selection));
  }
  /** Account-bound local snapshot only. Research scheduled here never inherits a turn's abort signal. */
  readonly turnSettings = () => {
    const scope = this.account().scope;
    if (!scope || !this.authorized(scope, false)) return { mode: "background" as const, policy: null, recordActivity: false };
    this.refreshAuthorization(scope); hosts.set(scope, this);
    const generation = generationFor(scope); generations.set(scope, generation);
    const enabled = this.authorized(scope) && !historyReplacementDepth, mode = this.mode(scope);
    if (!policies.has(scope)) {
      try {
        const raw = this.storage()?.getItem(POLICY_PREFIX + scope);
        const value: unknown = raw && raw.length < MAX_STORE_CHARS ? JSON.parse(raw) : null;
        policies.set(scope, validateBackgroundActivityPolicy(value) ? value : null);
      } catch { policies.set(scope, null); }
    }
    const saved = policies.get(scope);
    const policy = enabled && mode === "background" && saved && saved.expiresAt > this.now() ? structuredClone(saved) : null;
    if (enabled && mode === "background") this.schedule();
    return { mode, policy, recordActivity: enabled, publicationContext: { scope, generation } satisfies PublicationContext };
  };
  /** Coalesces this account's work across chat runtimes; never awaited by a reply. */
  readonly schedule = (): void => {
    const scope = this.account().scope;
    if (!scope || !this.accountAuthorized(scope) || this.mode(scope) !== "background" || quarantinedHistories.has(scope) || historyReplacementDepth) return;
    this.refreshAuthorization(scope); hosts.set(scope, this);
    let state = research.get(scope);
    if (!state) {
      state = { lastAttemptAt: 0, evidenceKey: null };
      try {
        const saved = JSON.parse(this.storage()?.getItem(RESEARCH_PREFIX + scope) ?? "null") as { lastAttemptAt?: unknown; evidenceKey?: unknown } | null;
        if (saved && typeof saved.lastAttemptAt === "number" && Number.isFinite(saved.lastAttemptAt) && saved.lastAttemptAt <= this.now()
          && (saved.evidenceKey === null || typeof saved.evidenceKey === "string" && saved.evidenceKey.length < 100)) {
          state.lastAttemptAt = saved.lastAttemptAt; state.evidenceKey = saved.evidenceKey;
        }
      } catch { /* A missing cooldown does not authorize an invalid history. */ }
      research.set(scope, state);
    }
    state.nextHost = this;
    if (state.timer || state.running) return;
    const wait = Math.max(25, state.lastAttemptAt ? state.lastAttemptAt + RESEARCH_COOLDOWN_MS - this.now() : 0);
    const job = state;
    job.timer = setTimeout(() => {
      job.timer = undefined;
      const host = job.nextHost; job.nextHost = undefined;
      if (!host || research.get(scope) !== job) return;
      job.running = host.runResearch(scope, job).catch(() => { /* Preserve the tested policy on any optional failure. */ })
        .finally(() => {
          job.running = undefined; job.controller = undefined;
          const next = job.nextHost;
          if (next && research.get(scope) === job) next.schedule();
        });
    }, wait);
  };
  private async runResearch(scope: string, state: ResearchState): Promise<void> {
    const generation = generationFor(scope), evidenceVersion = evidenceVersions.get(scope) ?? 0, controller = new AbortController();
    state.controller = controller;
    const current = () => this.accountAuthorized(scope) && this.mode(scope) === "background"
      && generationFor(scope) === generation && (evidenceVersions.get(scope) ?? 0) === evidenceVersion
      && research.get(scope) === state && !controller.signal.aborted && !historyReplacementDepth;
    if (!current()) return;
    const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
    let rejectAbort: (() => void) | undefined;
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("activity-research-interrupted"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    })]);
    try {
      await bounded((async () => {
        const checks = await this.options.source.getQuestionChecks();
        if (!current()) return;
        const asOf = this.now(), history = readHistory(this.storage(), scope);
        const exposures = linkActivityOutcomes(history.exposures, activityOutcomesFromChecks(checks), asOf, history.boundaries);
        writeHistory(this.storage(), scope, { ...history, exposures });
        // Unanswered replies alone do not buy another batch. Label corrections/removals do change this key.
        const evidenceKey = fingerprint(JSON.stringify(exposures.filter(value => value.outcome)));
        if (state.evidenceKey === evidenceKey) return;
        const judgeModel = [...exposures].reverse().find(value => value.outcome)?.observations.judgeModel;
        if (!judgeModel) return;
        const result = await (this.options.learn ?? learnBackgroundActivityPolicy)({ exposures, judgeModel, asOf,
          signal: controller.signal, transport: (request, signal) => {
            if (!current() || signal?.aborted) throw new Error("activity-research-stale");
            // Retain the cooldown across reloads, but mark evidence complete only after a usable response.
            state.lastAttemptAt = this.now();
            this.storage()?.setItem(RESEARCH_PREFIX + scope, JSON.stringify({ lastAttemptAt: state.lastAttemptAt, evidenceKey: state.evidenceKey }));
            return (this.options.transport ?? requestOnlinePredictions)(request, scope, signal ?? controller.signal,
              () => current() && !signal?.aborted);
          } });
        if (!current()) return;
        if (["failed", "cancelled", "invalid-response"].includes(result.receipt.status)) return;
        const latestChecks = await this.options.source.getQuestionChecks();
        if (!current()) return;
        const latest = readHistory(this.storage(), scope);
        const linked = linkActivityOutcomes(latest.exposures, activityOutcomesFromChecks(latestChecks), asOf, latest.boundaries);
        if (fingerprint(JSON.stringify(linked.filter(value => value.outcome))) !== evidenceKey) { this.schedule(); return; }
        state.evidenceKey = evidenceKey;
        this.storage()?.setItem(RESEARCH_PREFIX + scope, JSON.stringify({ lastAttemptAt: state.lastAttemptAt, evidenceKey }));
        if (!result.policy || !validateBackgroundActivityPolicy(result.policy) || result.policy.expiresAt <= this.now()) return;
        this.storage()?.setItem(POLICY_PREFIX + scope, JSON.stringify(result.policy));
        if (current()) policies.set(scope, structuredClone(result.policy));
      })());
    } finally {
      clearTimeout(timer);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
  readonly select = async (input: ActivitySelectionInput): Promise<ActivitySelection> => {
    const scope = this.account().scope;
    if (!scope || !this.authorized(scope) || this.mode(scope) !== "live" || input.signal.aborted || historyReplacementDepth) throw new Error("activity-learning-disabled");
    this.refreshAuthorization(scope); hosts.set(scope, this);
    const generation = generationFor(scope); generations.set(scope, generation);
    const evidenceVersion = evidenceVersions.get(scope) ?? 0;
    const current = () => this.authorized(scope) && this.mode(scope) === "live" && generationFor(scope) === generation
      && (evidenceVersions.get(scope) ?? 0) === evidenceVersion && !input.signal.aborted && !historyReplacementDepth;
    const [checks, presentations] = await Promise.all([this.options.source.getQuestionChecks(), this.options.source.getOpenUiPresentations(this.options.sessionId)]);
    if (!current()) throw new Error("activity-learning-stale");
    const originalOutcomes = activityOutcomesFromChecks(checks);
    const evidenceKey = fingerprint(JSON.stringify(originalOutcomes));
    const history = readHistory(this.storage(), scope);
    const exposures = linkActivityOutcomes(history.exposures, originalOutcomes, this.now(), history.boundaries);
    writeHistory(this.storage(), scope, { ...history, exposures });
    const result = await (this.options.select ?? selectActivityCandidate)(input, { exposures, asOf: this.now(),
      transport: (request, signal) => {
        if (!current() || signal?.aborted) throw new Error("activity-learning-stale");
        return (this.options.transport ?? requestOnlinePredictions)(request, scope, signal ?? input.signal,
          () => current() && !signal?.aborted);
      } });
    const latestChecks = await this.options.source.getQuestionChecks();
    if (fingerprint(JSON.stringify(activityOutcomesFromChecks(latestChecks))) !== evidenceKey) {
      throw new Error("activity-learning-evidence-changed");
    }
    if (!current()) throw new Error("activity-learning-stale");
    const candidate = input.candidates.find(value => value.attempt === result.attempt);
    if (!candidate) throw new Error("activity-learning-invalid-selection");
    const open = input.turn.activeWork?.openInteractions.filter(value => value.state === "awaiting"
      && ["question", "question-group", "quiz"].includes(value.component)
      && value.itemId === (input.turn.activeWork?.focus?.itemId ?? null)) ?? [];
    const match = open.length === 1 ? presentations.find(value => value.documentId === open[0]!.documentId && value.nodeId === open[0]!.nodeId) : null;
    this.contexts.set(this.selectionKey({ observations: input.observations, candidate, receipt: result.receipt }), {
      scope, generation, sources: match ? [{ documentId: match.documentId, revision: match.revision, nodeId: match.nodeId }] : [],
    });
    while (this.contexts.size > 8) this.contexts.delete(this.contexts.keys().next().value!);
    return result;
  };
  readonly published = (publication: { messageTimestamp: number; publishedAt: number; activitySelection?: ReleasedActivitySelection;
    activeWork?: ActiveWork; publicationContext?: unknown }): void => {
    if (publication.publicationContext) {
      const captured = publication.publicationContext as PublicationContext;
      if (typeof captured.scope !== "string" || !Number.isInteger(captured.generation)
        || !this.authorized(captured.scope, false) || generationFor(captured.scope) !== captured.generation) return;
      // Register in memory before the renderer can run; all storage and source reads happen after release.
      const selection = publication.activitySelection;
      const context = selection ? this.contexts.get(this.selectionKey(selection)) : undefined;
      if (selection) this.contexts.delete(this.selectionKey(selection));
      const pending: PendingPresentation | null = selection && this.authorized(captured.scope) ? {
        scope: captured.scope, generation: captured.generation, publishedAt: publication.publishedAt,
        textKey: fingerprint(selection.candidate.reply.text), selection: structuredClone(selection), sources: context?.sources ?? [], host: this,
      } : null;
      const ready = new Promise<void>(resolve => setTimeout(resolve, 0)).then(async () => {
        if (!this.authorized(captured.scope, false) || generationFor(captured.scope) !== captured.generation) return;
        const history = readHistory(this.storage(), captured.scope);
        if (!history.boundaries.some(value => value.sessionId === this.options.sessionId && value.createdAt === publication.publishedAt)) {
          history.boundaries.push({ sessionId: this.options.sessionId, createdAt: publication.publishedAt });
          writeHistory(this.storage(), captured.scope, history);
        }
        if (pending && !context && describeActivityCandidate(pending.selection.candidate.reply)?.kind === "prose") {
          const open = publication.activeWork?.openInteractions.filter(value => value.state === "awaiting"
            && ["question", "question-group", "quiz"].includes(value.component)
            && value.itemId === (publication.activeWork?.focus?.itemId ?? null)) ?? [];
          if (open.length === 1) {
            const records = await this.options.source.getOpenUiPresentations(this.options.sessionId);
            if (!this.authorized(captured.scope) || generationFor(captured.scope) !== captured.generation) return;
            const match = records.find(value => value.documentId === open[0]!.documentId && value.nodeId === open[0]!.nodeId
              && value.createdAt === open[0]!.presentedAt && value.createdAt <= publication.publishedAt);
            if (match) pending.sources = [{ documentId: match.documentId, revision: match.revision, nodeId: match.nodeId }];
          }
        }
        this.schedule();
      });
      // A failed write quarantines the history; a failed read leaves the optional exposure unrecorded.
      void ready.catch(() => {});
      if (pending) {
        pending.ready = ready;
        pendingPresentations.set(publicationKey(this.options.sessionId, publication.messageTimestamp), pending);
        while (pendingPresentations.size > 32) pendingPresentations.delete(pendingPresentations.keys().next().value!);
      }
      return;
    }
    const scope = this.account().scope;
    if (!scope || !this.authorized(scope, false)) return;
    const history = readHistory(this.storage(), scope);
    if (!history.boundaries.some(value => value.sessionId === this.options.sessionId && value.createdAt === publication.publishedAt)) {
      history.boundaries.push({ sessionId: this.options.sessionId, createdAt: publication.publishedAt });
      writeHistory(this.storage(), scope, history);
    }
    const selection = publication.activitySelection;
    if (!selection) return;
    const key = this.selectionKey(selection), context = this.contexts.get(key);
    this.contexts.delete(key);
    if (!context || context.scope !== scope || context.generation !== generationFor(scope) || !this.authorized(scope)) return;
    for (const [id, value] of pendingPresentations) if (this.now() - value.publishedAt > PENDING_AGE_MS) pendingPresentations.delete(id);
    pendingPresentations.set(publicationKey(this.options.sessionId, publication.messageTimestamp), {
      scope, generation: context.generation, publishedAt: publication.publishedAt, textKey: fingerprint(selection.candidate.reply.text),
      selection, sources: context.sources, host: this,
    });
    while (pendingPresentations.size > 32) pendingPresentations.delete(pendingPresentations.keys().next().value!);
  };
  presented(pending: PendingPresentation, text: string, scope: OpenUIDocumentScope, presentationText = text): void {
    if (!this.authorized(pending.scope) || pending.generation !== generationFor(pending.scope)
      || this.now() - pending.publishedAt > PENDING_AGE_MS || fingerprint(text) !== pending.textKey) return;
    const candidate = describeActivityCandidate(pending.selection.candidate.reply);
    if (!candidate) return;
    const records = presentationsFromAssistantText(presentationText, scope, null, pending.publishedAt);
    const sources = records.filter(value => ["question", "question-group", "quiz"].includes(value.component))
      .map(value => ({ documentId: value.documentId, revision: value.revision, nodeId: value.nodeId }));
    const exposure: ActivityExposure = {
      id: JSON.stringify([scope.sessionId, scope.messageId]), sessionId: scope.sessionId, createdAt: pending.publishedAt,
      observations: pending.selection.observations, candidate,
      sources: sources.length ? sources : candidate.kind === "prose" ? pending.sources : [], receipt: pending.selection.receipt,
    };
    const history = readHistory(this.storage(), pending.scope);
    if (!history.exposures.some(value => value.id === exposure.id)) {
      history.exposures.push(exposure); writeHistory(this.storage(), pending.scope, history);
    }
    this.schedule();
  }
}
export function createWebActivityLearning(options: HostOptions): WebActivityLearning { return new WebActivityLearning(options); }
/** Explicitly delete this account's recorded chat-prediction history and invalidate in-flight learning. */
export function clearWebActivityLearningHistory(scope: string, storage: Store | null = browserStore()): void {
  quarantinedHistories.add(scope);
  invalidateHistory(scope);
  if (!storage) throw new Error("activity-history-unavailable");
  storage.removeItem(STORE_PREFIX + scope);
  storage.removeItem(POLICY_PREFIX + scope);
  storage.removeItem(RESEARCH_PREFIX + scope);
  quarantinedHistories.delete(scope);
}

/** Called only for a newly completed live assistant message, with the renderer's exact document scope. */
export function recordWebActivityPresentation(text: string, scope: OpenUIDocumentScope, messageTimestamp: number, presentationText = text): void {
  const key = publicationKey(scope.sessionId, messageTimestamp), pending = pendingPresentations.get(key);
  if (!pending) return;
  pendingPresentations.delete(key);
  // Recording optional feedback must not interrupt an already released reply.
  if (pending.ready) {
    void pending.ready.then(() => pending.host.presented(pending, text, scope, presentationText)).catch(() => {});
  } else {
    try { pending.host.presented(pending, text, scope, presentationText); } catch { /* Storage can be full or unavailable. */ }
  }
}
