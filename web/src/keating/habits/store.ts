import type { StorageBackend, StorageTransaction } from "../../types";
import { preferenceKey as companionPreference, readMode } from "../../components/companion/CompanionSetting";
import { getAppStorage } from "../app-storage";
import { learningIntelligenceAccount } from "../learning-intelligence/account";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../model-prefs";
import { DECLARED_PROFILE_CHANGED_EVENT, DECLARED_PROFILE_STORAGE_KEY, loadDeclaredProfile } from "../learner-profile-store";
import type { HabitsCommand, HabitsDispatchResult, HabitsMode, HabitsSnapshot } from "./contracts";
import { collectQuestionEvidence, HABIT_EVIDENCE_EVENTS } from "./evidence";
import { admitPrivateStudy, applyHabitsCommand, createHabitsState, habitsCommandId, habitsSnapshot, reconcileHabits, type HabitsState, type PrivateStudyEvidence } from "./engine";

const STORE = "settings";
const PREFIX = "keating:habits:v1:";
const HABITS_CHANGED = "keating:habits-changed";
const COMPANION_CHANGED = "keating:companion-mode-changed";
const SCOPE_ERROR = "The learner account changed. Open Habits again.";

interface HabitsDependencies {
  backend: () => StorageBackend;
  scope: () => string;
  now: () => number;
  seed: () => string;
  zone?: () => string;
  mode?: () => HabitsMode;
  gentleOnly?: () => boolean;
  evidence: (sessionId: string, since: number, now: number) => Promise<PrivateStudyEvidence[]>;
}

function safeId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value);
}

function habitState(value: unknown): HabitsState {
  if (!value || typeof value !== "object") throw new Error("Saved Habits data is unavailable.");
  const state = value as HabitsState;
  if (state.version !== 1 || !Number.isSafeInteger(state.startedAt) || !Number.isSafeInteger(state.checkedAt)
      || !Number.isSafeInteger(state.activityFloor) || typeof state.zone !== "string" || typeof state.seed !== "string"
      || !state.actual || !state.condition || !state.inventory || !state.quests || !state.pity
      || !Array.isArray(state.crates) || !Array.isArray(state.keepsakes) || !Array.isArray(state.bridges)
      || !Array.isArray(state.ownedKit) || !Array.isArray(state.rescued) || !Array.isArray(state.rest)) {
    throw new Error("Saved Habits data is unavailable.");
  }
  return state;
}

/** Writes settle their receipt in the same transaction as their rewards. */
export class HabitsRepository {
  constructor(private readonly options: HabitsDependencies) {}

  private requireScope(scope: string) {
    if (scope !== this.options.scope()) throw new Error(SCOPE_ERROR);
  }

  private view(state: HabitsState, scope: string) {
    return habitsSnapshot(state, scope, this.options.gentleOnly?.());
  }

  private async update<T>(
    scope: string,
    mode: HabitsMode,
    operation: (state: HabitsState, tx: StorageTransaction, key: string) => Promise<T>,
  ): Promise<T> {
    const key = PREFIX + encodeURIComponent(scope);
    const result = await this.options.backend().transaction([STORE], "readwrite", async tx => {
      this.requireScope(scope);
      const saved = await tx.get<unknown>(STORE, key);
      this.requireScope(scope);
      const now = this.options.now();
      const currentMode = this.options.mode?.() ?? mode;
      const state = saved === null ? createHabitsState(now, currentMode, this.options.seed(), this.options.zone?.()) : habitState(saved);
      reconcileHabits(state, now, currentMode);
      const result = await operation(state, tx, key);
      this.requireScope(scope);
      await tx.set(STORE, key, state);
      return result;
    });
    this.requireScope(scope);
    return result;
  }

  async read(mode: HabitsMode, sessionId?: string): Promise<HabitsSnapshot> {
    const scope = this.options.scope();
    const seed = await this.update(scope, mode, async state => ({
      view: this.view(state, scope), since: state.activityFloor, to: state.checkedAt, mode: state.mode,
    }));
    if (!sessionId || seed.mode === "off") return seed.view;
    const rows = await this.options.evidence(sessionId, seed.since, seed.to);
    this.requireScope(scope);
    if (!rows.length) return seed.view;
    return this.update(scope, mode, async (state, tx, key) => {
      for (const row of rows) {
        if (!safeId(row.id)) continue;
        const receiptKey = `${key}:receipt:${encodeURIComponent(row.id)}`;
        if (await tx.get(STORE, receiptKey) === null && admitPrivateStudy(state, row)) {
          await tx.set(STORE, receiptKey, { accepted: true });
        }
      }
      return this.view(state, scope);
    });
  }

  async dispatch(mode: HabitsMode, command: HabitsCommand): Promise<HabitsDispatchResult> {
    const scope = this.options.scope();
    if ("scope" in command && command.scope !== scope) throw new Error(SCOPE_ERROR);
    return this.update(scope, mode, async (state, tx, key) => {
      const id = habitsCommandId(command);
      const receiptKey = id && safeId(id) ? `${key}:receipt:${encodeURIComponent(id)}` : null;
      if (id !== null && receiptKey === null) {
        return { ...this.view(state, scope), accepted: false, outcome: "rejected" };
      }
      const previous = receiptKey ? await tx.get<{ accepted: boolean; command: string }>(STORE, receiptKey) : null;
      if (previous) {
        const same = previous.command === JSON.stringify(command);
        return { ...this.view(state, scope), accepted: same && previous.accepted, outcome: same ? "replayed" : "rejected" };
      }
      const accepted = applyHabitsCommand(state, command);
      if (receiptKey) {
        // Store the normalized grading envelope, never the learner's answer.
        await tx.set(STORE, receiptKey, { accepted, command: JSON.stringify(command) });
      }
      return { ...this.view(state, scope), accepted, outcome: accepted ? "accepted" : "rejected" };
    });
  }
}

export function currentHabitsScope(): string {
  const scope = learningIntelligenceAccount().scope;
  return scope ? `account:${scope}` : "device";
}

const repository = new HabitsRepository({
  backend: () => getAppStorage().backend,
  scope: currentHabitsScope,
  now: Date.now,
  seed: () => crypto.randomUUID(),
  mode: readMode,
  gentleOnly: () => loadDeclaredProfile().ageBand === "under-13",
  evidence: collectQuestionEvidence,
});

export function readHabits(mode: HabitsMode, sessionId?: string): Promise<HabitsSnapshot> {
  return repository.read(mode, sessionId);
}

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HABITS_CHANGED));
}

export async function dispatchHabits(mode: HabitsMode, command: HabitsCommand, sessionId?: string): Promise<HabitsDispatchResult> {
  const scope = currentHabitsScope();
  if (sessionId) await repository.read(mode, sessionId);
  if (currentHabitsScope() !== scope) throw new Error(SCOPE_ERROR);
  const result = await repository.dispatch(mode, command);
  announce();
  return result;
}

const UPDATE_EVENTS = [COMPANION_CHANGED, PROVIDER_CREDENTIALS_CHANGED_EVENT, "focus"];
const OBSERVED_STORAGE = new Set([companionPreference, DECLARED_PROFILE_STORAGE_KEY]);

export function subscribeHabits(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [HABITS_CHANGED, DECLARED_PROFILE_CHANGED_EVENT, ...UPDATE_EVENTS];
  const storageChanged = (event: StorageEvent) => { if (!event.key || OBSERVED_STORAGE.has(event.key)) listener(); };
  for (const event of events) window.addEventListener(event, listener);
  window.addEventListener("storage", storageChanged);
  const clock = window.setInterval(listener, 30_000);
  return () => {
    window.clearInterval(clock);
    for (const event of events) window.removeEventListener(event, listener);
    window.removeEventListener("storage", storageChanged);
  };
}

/** Follow the current chat even when its Care and Habits views are closed. */
export function startHabitsEvidence(sessionId?: string): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;
  let pending = false;
  let collect = false;
  let running = false;
  const refresh = (event?: Event) => {
    if (stopped) return;
    pending = true;
    collect ||= event === undefined || HABIT_EVIDENCE_EVENTS.includes(event.type);
    if (running) return;
    running = true;
    void (async () => {
      while (pending && !stopped) {
        pending = false;
        const observeSession = collect ? sessionId : undefined;
        collect = false;
        try {
          await repository.read(readMode(), observeSession);
          if (!stopped) announce();
        } catch {
          // Storage may still be initializing, or the learner may have just
          // switched accounts. The next focus, mode or evidence change retries.
        }
      }
      running = false;
    })();
  };
  const events = [...UPDATE_EVENTS, ...HABIT_EVIDENCE_EVENTS];
  const storageChanged = (event: StorageEvent) => { if (!event.key || event.key === companionPreference) refresh(event); };
  for (const event of events) window.addEventListener(event, refresh);
  window.addEventListener("storage", storageChanged);
  refresh();
  return () => {
    stopped = true;
    for (const event of events) window.removeEventListener(event, refresh);
    window.removeEventListener("storage", storageChanged);
  };
}
