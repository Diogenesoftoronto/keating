/**
 * Private activity-learning round for one teaching turn: decides whether
 * online activity selection is on, builds the draft round that may replace
 * the tutor's reply, and publishes the released selection afterwards.
 */
import type { MutableRefObject } from "react";
import { DEFAULT_MODELS } from "@keating/runtime-config";
import type { ReleasedActivitySelection, UiDocument } from "@keating/learner-contracts";
import { activitySourcesFromDocuments, descriptor, selectActivityCandidate } from "../../../packages/learner-contracts/src/judgement/activity-learning";
import { configuredMobileJudgementRuntime } from "@/lib/judgement/runtime";
import { createMobileTeachingDraftRound } from "@/lib/judgement/teaching-drafts";
import { mobileActivityBoundaries, mobileUnansweredActivityDocument } from "@/lib/judgement/activity-learning";
import { mobileOnlineLearningPreferences } from "@/lib/judgement/online-learning";
import { MobileActivityLearningStore } from "@/lib/learner-repository/activity-learning";
import { notOrganicTabularRequest } from "@/lib/notorganic-account/client";
import { extractUiDocuments } from "@/lib/ui-document-wire";
import type { ChatMessage, PersistedAppState } from "@/lib/types";
import type { KeatingUiSettings } from "@/lib/ui-settings";
import type { LearnerRepository } from "@/lib/learner-repository";
import type { ActivityAccount } from "@/state/account-scope";
import { currentCalibrationRevisions } from "@/state/calibration-revisions";
import { configuredJudgeKey, judgeEnabled } from "@/state/judge-config";
import { boundSourceDocuments, continuedSourceDocument } from "@/state/turn-policy";
import { drainRepositoryWrites } from "@/state/repository-writes";
import type { RepositoryRefs } from "@/state/use-learner-repository";

export interface ActivityEnv {
  stateRef: MutableRefObject<PersistedAppState>;
  uiSettingsRef: MutableRefObject<KeatingUiSettings>;
  learnerContextRef: MutableRefObject<string>;
  quizIdentityRef: MutableRefObject<string>;
  activityAccountRef: MutableRefObject<ActivityAccount>;
  activityControllerRef: MutableRefObject<AbortController | null>;
  repo: RepositoryRefs;
}

export interface ActivityHandle {
  store: MobileActivityLearningStore;
  generation: number;
  current: () => boolean;
}

/** Mutated while the round is prepared and released, so a failure part-way still leaves cleanup state. */
export interface ActivityRound {
  privateRound?: ReturnType<typeof createMobileTeachingDraftRound>;
  activity: ActivityHandle | null;
  released?: ReleasedActivitySelection;
  continuedDocument: UiDocument | null;
  stopPreference?: () => void;
}

export function emptyActivityRound(): ActivityRound {
  return { activity: null, continuedDocument: null };
}

/** Decision: is online activity selection on for this account and judge configuration? */
export function activityLearningEnabled(account: ActivityAccount, preference: string | null | undefined, settings: KeatingUiSettings): boolean {
  return !!account.scope && account.granted && preference === DEFAULT_MODELS.judgement.tabular && judgeEnabled(settings);
}

export interface TurnIdentity {
  controller: AbortController;
  sessionId: string;
  triggeringMessage: ChatMessage;
  recallIdentity: string;
}

/** Everything that must still hold for the activity round to be allowed to act. */
function roundIsCurrent(
  env: ActivityEnv,
  turn: TurnIdentity,
  repository: LearnerRepository,
  scope: string,
  preference: string,
  configuredJudge: string,
): () => boolean {
  const { controller, sessionId, triggeringMessage, recallIdentity } = turn;
  return () => !controller.signal.aborted && env.repo.repository.current === repository && !env.repo.clearing.current
    && !env.repo.evidenceChanging.current && env.quizIdentityRef.current === recallIdentity && env.stateRef.current.activeSessionId === sessionId
    && env.activityAccountRef.current.scope === scope && env.activityAccountRef.current.granted
    && mobileOnlineLearningPreferences.get(scope) === DEFAULT_MODELS.judgement.tabular
    && mobileOnlineLearningPreferences.epoch(scope) === preference
    && configuredJudge === configuredJudgeKey(env.uiSettingsRef.current, currentCalibrationRevisions())
    && env.stateRef.current.sessions.find(session => session.id === sessionId)?.messages.findLast(message => message.role === "user")?.id === triggeringMessage.id;
}

function activityTransport(
  store: MobileActivityLearningStore,
  generation: number | null,
  current: () => boolean,
) {
  return async (request: Parameters<typeof notOrganicTabularRequest>[0], signal?: AbortSignal) => {
    if (!current()) throw Error("The account or learning setting changed.");
    const response = await notOrganicTabularRequest(request, signal, undefined,
      async () => current() && generation !== null && await store.generation() === generation && current());
    if (!response.ok) throw Error("Online activity prediction unavailable.");
    const result: unknown = await response.json();
    if (!current()) throw Error("The account or learning setting changed.");
    return result;
  };
}

/**
 * Prepares the private teaching-draft round for a turn when online activity
 * learning is enabled; otherwise leaves `round` untouched. Throws when
 * learning data is still loading, so the turn fails instead of silently
 * skipping a setting the learner turned on.
 */
export async function prepareActivityRound(env: ActivityEnv, turn: TurnIdentity, round: ActivityRound): Promise<void> {
  const { controller, sessionId, triggeringMessage } = turn;
  const account = env.activityAccountRef.current;
  if (account.scope) await mobileOnlineLearningPreferences.load(account.scope);
  const scope = account.scope;
  const repository = env.repo.repository.current;
  const enabled = !!scope && activityLearningEnabled(account, mobileOnlineLearningPreferences.get(scope), env.uiSettingsRef.current);
  if (enabled && !repository) throw Error("Learning data is still loading. Try again shortly.");
  if (!enabled || !scope || !repository) return;

  env.activityControllerRef.current = controller;
  const configuredJudge = configuredJudgeKey(env.uiSettingsRef.current, currentCalibrationRevisions());
  const activityMode = mobileOnlineLearningPreferences.chatMode(scope);
  const preference = mobileOnlineLearningPreferences.epoch(scope);
  const current = roundIsCurrent(env, turn, repository, scope, preference, configuredJudge);
  round.stopPreference = mobileOnlineLearningPreferences.subscribe(() => { if (!current()) controller.abort(); });
  const store = new MobileActivityLearningStore(repository.database, scope);
  await drainRepositoryWrites(env.repo.writeTail);
  const generation = await store.generation().catch(() => null);
  if (generation !== null) round.activity = { store, generation, current };
  const backgroundActivityPolicy = activityMode === "background" && generation !== null
    ? await store.policy(generation, current).catch(() => null) : null;
  const judgement = await configuredMobileJudgementRuntime();
  const activeDocument = await mobileUnansweredActivityDocument(env.stateRef.current.sessions.find(session => session.id === sessionId),
    await repository.records.snapshot(), id => repository.uiActions.getJournal(id)).catch(() => null);
  round.privateRound = createMobileTeachingDraftRound({ judge: judgement.call, current, sessionId,
    activityLearningMode: activityMode, backgroundActivityPolicy,
    learnerContext: env.learnerContextRef.current,
    activeDocument,
    evidence: async () => {
      await drainRepositoryWrites(env.repo.writeTail);
      const snapshot = await repository.records.snapshot();
      if (generation !== null && await store.generation() !== generation) throw new DOMException("Learning history was replaced.", "AbortError");
      return snapshot;
    },
    activityLearning: async input => selectActivityCandidate(input, {
      exposures: generation === null ? [] : await store.history(generation, mobileActivityBoundaries(env.stateRef.current.sessions), Date.now(), current).catch(() => []),
      transport: activityTransport(store, generation, current),
    }),
    onReleased: (selection, continuesSource) => { round.released = selection; round.continuedDocument = continuesSource ? activeDocument : null; },
  });
}

export interface PublishArgs {
  sessionId: string;
  assistantId: string;
  publishedAt: number;
  published: readonly UiDocument[];
  parsed: readonly UiDocument[];
  hadDocumentErrors: boolean;
}

/** Records the released activity against the documents the learner actually saw. */
export async function publishReleasedActivity(env: ActivityEnv, round: ActivityRound, args: PublishArgs): Promise<void> {
  const { activity, released } = round;
  if (!activity || !released || args.hadDocumentErrors || !activity.current()) return;
  const candidate = descriptor(released.candidate.reply);
  // Bind only documents in the actual final selected reply; an earlier tool round is a separate intervention.
  const selectedDocuments = extractUiDocuments(released.candidate.reply.text).documents;
  const sourceDocuments = boundSourceDocuments(args.published, args.parsed, selectedDocuments);
  const repository = env.repo.repository.current;
  if (!selectedDocuments.length && candidate?.kind === "prose" && round.continuedDocument && repository) {
    const latest = await mobileUnansweredActivityDocument(env.stateRef.current.sessions.find(session => session.id === args.sessionId),
      await repository.records.snapshot(), id => repository.uiActions.getJournal(id)).catch(() => null);
    const continued = continuedSourceDocument(latest, round.continuedDocument);
    if (continued) sourceDocuments.push(continued);
  }
  if (candidate) await activity.store.publish(activity.generation, {
    id: args.assistantId, sessionId: args.sessionId, createdAt: args.publishedAt, observations: released.observations, candidate,
    sources: activitySourcesFromDocuments(sourceDocuments), receipt: released.receipt,
  }, sourceDocuments, activity.current).catch(() => undefined);
}
