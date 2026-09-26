import { INTERACTION_AFFORDANCES, TEACHING_INTERACTION_FEATURES, TEACHING_POLICY_DETERMINISTIC_RULES, TEACHING_POLICY_RULES, type PlanReview, type TeachingDraftInteraction, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import { recordDiagnostic } from "../../lib/diagnostics";
import { STATE_SECTION_KEYS, type StateComposition, type TeachingDraftPhase } from "@keating/learner-contracts";

export type TeachingDraftFeedbackKind = "helpful" | "too-strict" | "missed-problem";
export interface TeachingDraftStatus {
  readonly id: number;
  readonly snapshot: TeachingDraftSnapshot;
  readonly feedback: TeachingDraftFeedbackKind | null;
}

const states = new Map<string, TeachingDraftStatus>();
const listeners = new Set<() => void>();
const checkIds = new Set<string>([...TEACHING_POLICY_RULES.map(rule => rule.id), ...TEACHING_POLICY_DETERMINISTIC_RULES,
  "quality_progress", "quality_scope", "runtime_tool_schema"]);
const featureIds = new Set<string>(TEACHING_INTERACTION_FEATURES.map(feature => feature.id));
const componentNames = new Set<string>(INTERACTION_AFFORDANCES.flatMap(row => row.components));
const planTriggers = new Set<string>(["graded-attempt", "stalled-focus", "progression-requested", "goal-requested"]);
const planActions = new Set<string>(["continue", "suggest-advance", "insert-prerequisite", "expand-item", "propose-new-plan"]);
let nextId = 0;
const emit = () => { for (const listener of listeners) listener(); };

export function subscribeTeachingDraftStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getTeachingDraftStatus(sessionId: string | null | undefined): TeachingDraftStatus | null {
  return sessionId ? states.get(sessionId) ?? null : null;
}

function projectInteraction(interaction: TeachingDraftInteraction): TeachingDraftInteraction {
  return {
    action: interaction.action, paired: interaction.paired,
    families: interaction.families.map(({ family, components }) => ({ family, components: components.filter(name => componentNames.has(name)) })),
    features: interaction.features.filter(id => featureIds.has(id)),
    ...(interaction.continueNodeId ? { continueNodeId: interaction.continueNodeId } : {}),
    ...(interaction.lead ? { lead: interaction.lead } : {}),
  };
}

function projectPlanReview(review: PlanReview | undefined): { planReview?: PlanReview } {
  return review && planTriggers.has(review.trigger) && planActions.has(review.action) ? { planReview: { trigger: review.trigger, action: review.action } } : {};
}

const nonnegative = (value: number): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const phases = new Set<string>(["planning", "drafting", "checking", "revising", "selecting", "released", "withheld", "cancelled"]);
const safePhase = (phase: TeachingDraftPhase): TeachingDraftPhase => phases.has(phase) ? phase : "withheld";
/** Reconstruct every nested field so extra content cannot enter a saved receipt. */
function projectState(state: StateComposition): StateComposition {
  return {
    sections: Object.fromEntries(STATE_SECTION_KEYS.map(key => [key, { bytes: nonnegative(state.sections?.[key]?.bytes), entries: nonnegative(state.sections?.[key]?.entries) }])) as unknown as StateComposition["sections"],
    totalBytes: nonnegative(state.totalBytes), estimatedStateTokens: nonnegative(state.estimatedStateTokens), estimatedRequestTokens: nonnegative(state.estimatedRequestTokens), estimatedStateQuestionTokens: nonnegative(state.estimatedStateQuestionTokens),
    budgetTokens: state.budgetTokens === null ? null : nonnegative(state.budgetTokens), fillRatio: state.fillRatio === null ? null : nonnegative(state.fillRatio),
    pinned: { activeWork: state.pinned?.activeWork === true, plan: state.pinned?.plan === true, focus: state.pinned?.focus === true, openInteractions: state.pinned?.openInteractions === true, pendingSubmissions: state.pinned?.pendingSubmissions === true },
  };
}

/** Content-free projection shared by the live status and the persisted review receipt. */
export function projectTeachingDraftSnapshot(snapshot: TeachingDraftSnapshot): TeachingDraftSnapshot {
  return {
    phase: snapshot.phase, attempt: snapshot.attempt, maxAttempts: snapshot.maxAttempts,
    reasoning: snapshot.reasoning, standard: snapshot.standard, elapsedMs: snapshot.elapsedMs,
    judgeModel: snapshot.judgeModel, selectedAttempt: snapshot.selectedAttempt, reason: snapshot.reason,
    ...(snapshot.planningMs === undefined ? {} : { planningMs: snapshot.planningMs }),
    ...(snapshot.interaction ? { interaction: projectInteraction(snapshot.interaction) } : {}),
    ...projectPlanReview(snapshot.planReview),
    ...(snapshot.state ? { state: projectState(snapshot.state) } : {}),
    ...(snapshot.slides ? { slides: snapshot.slides.slice(-64).map(slide => ({ phase: safePhase(slide.phase), attempt: nonnegative(slide.attempt), elapsedMs: nonnegative(slide.elapsedMs), turnsDropped: nonnegative(slide.turnsDropped), before: projectState(slide.before), after: slide.after ? projectState(slide.after) : null })) } : {}),
    ...(snapshot.stateHistory ? { stateHistory: snapshot.stateHistory.slice(-64).map(sample => ({ phase: safePhase(sample.phase), attempt: nonnegative(sample.attempt), elapsedMs: nonnegative(sample.elapsedMs), requestIndex: nonnegative(sample.requestIndex), state: projectState(sample.state) })) } : {}),
    attempts: snapshot.attempts.map(attempt => ({ attempt: attempt.attempt, reasoning: attempt.reasoning, standard: attempt.standard, variant: attempt.variant ?? "default",
      generationMs: attempt.generationMs, judgementMs: attempt.judgementMs, status: attempt.status,
      checks: attempt.checks.filter(check => checkIds.has(check.id)).map(check => ({
        id: check.id, source: check.source, severity: check.severity, status: check.status, probability: check.probability,
      })),
    })),
  };
}

/** Ephemeral, bounded, explicitly projected. No draft or learner content is retained. */
export function publishTeachingDraftStatus(sessionId: string, snapshot: TeachingDraftSnapshot): void {
  const previous = states.get(sessionId);
  const isNew = !previous || snapshot.phase === "planning" && previous.snapshot.phase !== "planning";
  const safe = projectTeachingDraftSnapshot(snapshot);
  states.delete(sessionId);
  const id = isNew ? ++nextId : previous.id;
  if (terminal(safe) && !(previous && previous.id === id && terminal(previous.snapshot))) tallyTerminalTurn(safe);
  states.set(sessionId, { id, snapshot: safe, feedback: isNew ? null : previous.feedback });
  while (states.size > 20) states.delete(states.keys().next().value!);
  emit();
}

/**
 * Session-local, content-free counts over finished draft turns: which
 * interaction the planner recommended, whether a paired turn released its
 * interactive draft, whether OpenUI released on an activity turn was valid, and which plan
 * proposal was requested. Counts only; never ids from the conversation.
 */
export interface TeachingDraftTally {
  readonly turns: number;
  readonly released: number;
  readonly interactionActions: Readonly<Record<string, number>>;
  readonly paired: number;
  readonly pairedInteractiveSelected: number;
  readonly openuiChecked: number;
  readonly openuiValid: number;
  readonly planActions: Readonly<Record<string, number>>;
}

const emptyTally = (): TeachingDraftTally => ({ turns: 0, released: 0, interactionActions: {}, paired: 0, pairedInteractiveSelected: 0,
  openuiChecked: 0, openuiValid: 0, planActions: {} });
let tally = emptyTally();
const terminal = (snapshot: TeachingDraftSnapshot) => snapshot.phase === "released" || snapshot.phase === "withheld";
const bump = (counts: Readonly<Record<string, number>>, key: string) => ({ ...counts, [key]: (counts[key] ?? 0) + 1 });

function tallyTerminalTurn(snapshot: TeachingDraftSnapshot): void {
  const released = snapshot.phase === "released";
  const selected = released ? snapshot.attempts.find(attempt => attempt.attempt === snapshot.selectedAttempt) : undefined;
  // Render validity only means something on turns that recommended an activity.
  const offered = snapshot.interaction?.action === "create" || snapshot.interaction?.action === "continue";
  const openui = offered ? selected?.checks.find(check => check.id === "openui_valid") : undefined;
  const paired = snapshot.interaction?.paired === true;
  const interactiveSelected = paired && selected?.variant === "interactive";
  tally = {
    turns: tally.turns + 1,
    released: tally.released + (released ? 1 : 0),
    interactionActions: snapshot.interaction ? bump(tally.interactionActions, snapshot.interaction.action) : tally.interactionActions,
    paired: tally.paired + (paired ? 1 : 0),
    pairedInteractiveSelected: tally.pairedInteractiveSelected + (interactiveSelected ? 1 : 0),
    openuiChecked: tally.openuiChecked + (openui ? 1 : 0),
    openuiValid: tally.openuiValid + (openui?.status === "pass" ? 1 : 0),
    planActions: snapshot.planReview ? bump(tally.planActions, snapshot.planReview.action) : tally.planActions,
  };
  recordDiagnostic("info", "teaching-drafts", `Draft turn ${snapshot.phase}`, {
    interactionAction: snapshot.interaction?.action ?? "unplanned",
    paired,
    interactiveSelected,
    openuiValid: openui ? openui.status === "pass" : "unchecked",
    planAction: snapshot.planReview?.action ?? "none",
  });
}

export function getTeachingDraftTally(): TeachingDraftTally { return tally; }
export function clearTeachingDraftTally(): void { tally = emptyTally(); }

/** Feedback is attached to the exact reviewed turn, never a later response. */
export function recordTeachingDraftFeedback(sessionId: string, id: number, feedback: TeachingDraftFeedbackKind): boolean {
  const current = states.get(sessionId);
  if (!current || current.id !== id || !["released", "withheld"].includes(current.snapshot.phase)) return false;
  states.set(sessionId, { ...current, feedback });
  emit();
  return true;
}

export function clearTeachingDraftStatuses(): void { states.clear(); emit(); }
export function clearTeachingDraftStatus(sessionId: string): void { if (states.delete(sessionId)) emit(); }

export function teachingDraftIsActive(status: TeachingDraftStatus | null): boolean {
  return !!status && !["released", "withheld", "cancelled"].includes(status.snapshot.phase);
}
