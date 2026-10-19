/**
 * Identity keys and gates derived from the judgement settings. A request is
 * only valid while these keys are unchanged, so every call site must build
 * them the same way.
 */
import type { KeatingUiSettings } from "@/lib/ui-settings";

export interface CalibrationRevisions {
  hosted: number;
  local: number;
}

type JudgeSettings = Pick<KeatingUiSettings, "judgementHosted" | "judgementLocalModel">;

/** Stable key for "which judge is configured, at which calibration". */
export function configuredJudgeKey(settings: JudgeSettings, revisions: CalibrationRevisions): string {
  return JSON.stringify([settings.judgementHosted, settings.judgementLocalModel, revisions.hosted, revisions.local]);
}

/** Memory-admission requests also depend on the account identity and the memory toggle. */
export function memoryRequestKey(
  quizIdentity: string,
  settings: JudgeSettings & Pick<KeatingUiSettings, "judgementMemory">,
  revisions: CalibrationRevisions,
): string {
  return JSON.stringify([quizIdentity, settings.judgementMemory, settings.judgementHosted,
    settings.judgementLocalModel, revisions.hosted, revisions.local]);
}

/** Some judge (hosted or on-device) is switched on. */
export function judgeEnabled(settings: JudgeSettings): boolean {
  return settings.judgementHosted || settings.judgementLocalModel !== "off";
}

/** Quiz performance predictions may only leave the judge paths the learner allowed. */
export function hostedPredictionAllowed(settings: JudgeSettings): boolean {
  return settings.judgementHosted || settings.judgementLocalModel === "minicpm5-2b-int4";
}

export interface BackgroundActivityGate {
  appActive: boolean;
  hasRepository: boolean;
  scope: string | null;
  granted: boolean;
  /** The learner's chosen predictor for this account scope. */
  preference: string | null | undefined;
  expectedPreference: string;
  chatMode: string;
}

/** Background teaching research needs an active app, a repository, a granted account and a live judge. */
export function backgroundActivityAllowed(gate: BackgroundActivityGate, settings: JudgeSettings): boolean {
  return gate.appActive && gate.hasRepository && !!gate.scope && gate.granted
    && gate.preference === gate.expectedPreference && gate.chatMode === "background"
    && judgeEnabled(settings);
}
