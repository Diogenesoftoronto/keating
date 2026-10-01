/**
 * The judgement model is configured separately from the tutor model.
 *
 * The tutor model and judgement service serve different roles. The review mode
 * defaults to hosted Jev; the local model selection configures its on-device
 * fallback and remains independent from the tutor model.
 */
import { createLocalSetting } from "./local-setting";
import { DEFAULT_BROWSER_MODEL_ID } from "../stores/local-model";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL } from "../lib/desktop-offline";

const JUDGEMENT_MODEL_KEY = "keating:judgement-model";
export const JUDGEMENT_MODEL_CHANGED_EVENT = "keating:judgement-model-changed";
/** TypeSafe's documented Jev request budgets. */
export const JEV_REQUEST_TOKEN_LIMIT = 64_000;
export const JEV_STATE_QUESTION_TOKEN_LIMIT = 32_000;

/**
 * Which rung of the cascade may answer.
 *
 * `local` never leaves the device. `hosted` tries hosted inference first and
 * falls back to local scoring when available. `off` keeps every decision on
 * the deterministic tier, which always has an answer already.
 */
export type JudgementBackendPreference = "off" | "local" | "hosted";

export interface JudgementModelSettings {
  /**
   * Escalating from the on-device tier to the hosted one is a setting, not a
   * constant — §1.1 of the plan is explicit that this is the user's call.
   */
  readonly backend: JudgementBackendPreference;
  /** Direct BYOK is independent of Not Organic account authorization. */
  readonly hostedProvider?: "notorganic" | "typesafe";
  readonly customModel?: string;
  /** Local model id used for judgement, independent of the tutor model. */
  readonly localModelId: string;
  /**
   * Same-origin gateway that holds the credential. A key must never reach the
   * browser bundle, so the hosted backend is reachable only through this.
   */
  readonly gatewayPath: string;
  /** Optional request and state-plus-longest-question limits for a custom judge. */
  readonly requestTokens?: number | null;
  readonly stateQuestionTokens?: number | null;
  /** Legacy setting name, migrated to stateQuestionTokens when loading. */
  readonly contextWindowTokens?: number | null;
}

export const DEFAULT_JUDGEMENT_MODEL_SETTINGS: JudgementModelSettings = {
  backend: "hosted",
  localModelId: DEFAULT_BROWSER_MODEL_ID,
  gatewayPath: "/api/judgement",
  requestTokens: null,
  stateQuestionTokens: null,
};

/** Choose the native scoring runtime only when this build exposes it. No download or inference. */
function defaultJudgementModelSettings(): JudgementModelSettings {
  return typeof desktopOfflineBridge()?.scoreLabels === "function"
    ? { ...DEFAULT_JUDGEMENT_MODEL_SETTINGS, localModelId: DESKTOP_OFFLINE_MODEL.id }
    : DEFAULT_JUDGEMENT_MODEL_SETTINGS;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeContextWindow(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 512 && value <= 2_000_000
    ? value : null;
}

function normalizeBackend(value: unknown): JudgementBackendPreference {
  return value === "off" || value === "local" || value === "hosted"
    ? value
    : DEFAULT_JUDGEMENT_MODEL_SETTINGS.backend;
}

/**
 * A gateway must be same-origin: an absolute URL here would be a way to ship a
 * credential-bearing third-party endpoint into the browser, which is the exact
 * thing the hosted path exists to prevent.
 */
function normalizeGatewayPath(value: unknown): string {
  const path = cleanString(value);
  if (!path.startsWith("/") || path.startsWith("//")) {
    return DEFAULT_JUDGEMENT_MODEL_SETTINGS.gatewayPath;
  }
  return path;
}

const judgementModelSetting = createLocalSetting<JudgementModelSettings>({
  key: JUDGEMENT_MODEL_KEY,
  event: JUDGEMENT_MODEL_CHANGED_EVENT,
  normalize: (raw) => {
    let parsed: Partial<JudgementModelSettings> | null = null;
    try {
      parsed = typeof raw === "string"
        ? raw.length > 0 ? JSON.parse(raw) as Partial<JudgementModelSettings> : null
        : raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Partial<JudgementModelSettings>
          : null;
    } catch {
      parsed = null;
    }
    const defaults = defaultJudgementModelSettings();
    if (!parsed) return defaults;
    return {
      backend: normalizeBackend(parsed.backend),
      ...(parsed.hostedProvider === "typesafe" ? {
        hostedProvider: "typesafe" as const,
      } : {}),
      ...(parsed.customModel !== undefined || parsed.hostedProvider === "typesafe" ? { customModel: cleanString(parsed.customModel).slice(0, 200) || "jev-latest" } : {}),
      localModelId: cleanString(parsed.localModelId) || defaults.localModelId,
      gatewayPath: normalizeGatewayPath(parsed.gatewayPath),
      requestTokens: normalizeContextWindow(parsed.requestTokens),
      stateQuestionTokens: normalizeContextWindow(parsed.stateQuestionTokens ?? parsed.contextWindowTokens),
    };
  },
});

export function loadJudgementModelSettings(): JudgementModelSettings {
  return judgementModelSetting.load();
}

export function saveJudgementModelSettings(next: JudgementModelSettings): void {
  judgementModelSetting.save(next);
}

export function subscribeJudgementModelSettings(
  callback: (settings: JudgementModelSettings) => void,
): () => void {
  return judgementModelSetting.subscribe(callback);
}
