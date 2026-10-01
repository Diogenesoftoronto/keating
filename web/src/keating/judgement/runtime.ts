import { guardCalibrationCall, webJudgementCalibrationStore, type WebJudgementCalibrationStore } from "./calibration";
/** Settings-to-runtime assembly. No inference, downloads, or learner activation. */
import {
  thresholdKey,
  isSha256Hex,
  type CalibrationTable,
  type JudgementBackendKey,
  type JudgementThresholds,
  type JudgementTier,
  type LocalLabelScorer,
  type RouterPolicy,
} from "@keating/learner-contracts";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL, type DesktopOfflineBridge } from "../../lib/desktop-offline";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS, JEV_REQUEST_TOKEN_LIMIT, JEV_STATE_QUESTION_TOKEN_LIMIT, loadJudgementModelSettings, type JudgementModelSettings } from "../judgement-model";
import { createDesktopLocalLabelScorer } from "./local-scorer";
import { createWebJudgementCaller, WEB_JUDGEMENT_MODEL_ALIAS, type WebJudgementCallerOptions } from "./transport";
import { createPublicAccountJudgementBackend, type JudgementAccountClient } from "./public-account";
import { createStoredTypesafeJudgementBackend } from "./typesafe-key";
import { observeJudgementCaller } from "./diagnostics";
import { JULIA_BROWSER_MODEL_ID, JULIA_MODEL, JULIA_MODEL_ID } from "../../../../shared/julia/manifest.js";
import { createBrowserJuliaScorer, createDesktopJuliaScorer } from "./julia-scorer";
import { juliaBrowserModel } from "../../stores/julia-model";

/** A measured table belongs to one exact backend/model/calibration identity. */
export interface WebJudgementCalibration {
  readonly backend: JudgementBackendKey;
  readonly table: CalibrationTable;
}

export interface WebJudgementRuntimeOptions {
  /** Device-local verifier seam for deterministic persistence/invalidation tests. */
  readonly calibrationStore?: WebJudgementCalibrationStore;
  /** Omit to snapshot the persisted independent judgement setting. */
  readonly settings?: JudgementModelSettings;
  readonly desktopBridge?: DesktopOfflineBridge;
  /** Future browser/other local runtimes must explicitly name their model. */
  readonly localScorer?: { readonly modelId: string; readonly scoreLabels: LocalLabelScorer; readonly contextWindowTokens?: number | null };
  readonly hosted?: Pick<WebJudgementCallerOptions, "model" | "fetch" | "sleep"> & {
    readonly accountClient?: JudgementAccountClient | null;
    /** Provider-specific limits; omit to use Jev's documented defaults when selected. */
    readonly requestTokens?: number | null;
    readonly stateQuestionTokens?: number | null;
    /** Legacy alias for stateQuestionTokens. */
    readonly contextWindowTokens?: number | null;
  };
  /** No defaults: local and hosted thresholds are measured separately. */
  readonly calibration?: { readonly local?: WebJudgementCalibration; readonly hosted?: WebJudgementCalibration };
  /** Pins restrict the existing router; they never override privacy settings. */
  readonly pinnedBackend?: JudgementBackendKey;
}

export interface WebJudgementRuntime {
  readonly settings: JudgementModelSettings;
  /** Effective budgets of the active judgement model, or null when a limit is unknown. */
  readonly judgementModel?: { readonly id: string; readonly requestTokens: number | null; readonly stateQuestionTokens: number | null };
  /** Pass directly to existing routeJudgement(s)/assessment helpers. */
  readonly policy: RouterPolicy;
}

function gatewayPath(path: string): string {
  // Backslashes and control characters can turn a seemingly relative path into
  // an off-origin URL when fetch parses it. Stored paths are user-controlled.
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path)) {
    return DEFAULT_JUDGEMENT_MODEL_SETTINGS.gatewayPath;
  }
  return path;
}

function calibrationKey(backend: "local" | "system-one", model: string, calibration?: WebJudgementCalibration): JudgementBackendKey {
  const candidate = calibration?.backend;
  const matches = candidate?.backend === backend && candidate.model === model
    && isSha256Hex(candidate.calibrationSha256)
    && model !== WEB_JUDGEMENT_MODEL_ALIAS && !model.endsWith("-latest");
  return Object.freeze({ backend, model, calibrationSha256: matches ? candidate.calibrationSha256 : null });
}

function calibratedEntries(key: JudgementBackendKey, calibration?: WebJudgementCalibration): Record<string, JudgementThresholds> {
  const entries: Record<string, JudgementThresholds> = {};
  if (!calibration || key.calibrationSha256 === null) return entries;
  const prefix = thresholdKey(key, "");
  for (const [entryKey, thresholds] of Object.entries(calibration.table.entries)) {
    if (!entryKey.startsWith(prefix) || entryKey.length === prefix.length) continue;
    if (!thresholds || !Number.isFinite(thresholds.deferBelow) || !Number.isFinite(thresholds.actAtOrAbove)
      || thresholds.deferBelow < 0 || thresholds.deferBelow > thresholds.actAtOrAbove || thresholds.actAtOrAbove > 1) continue;
    entries[entryKey] = Object.freeze({ deferBelow: thresholds.deferBelow, actAtOrAbove: thresholds.actAtOrAbove });
  }
  return entries;
}

/**
 * One immutable configuration per operation/experiment. Rebuild between runs
 * when settings change; a running comparison keeps its original pin and table.
 * `local` never calls hosted inference; `hosted` tries hosted inference first
 * and falls back to local scoring when available; `off` retains only the
 * caller's deterministic baseline.
 * Missing calibration stays unknown, so the shared router makes no model call.
 */
export function createWebJudgementRuntime(options: WebJudgementRuntimeOptions = {}): WebJudgementRuntime {
  const requested = options.settings ?? loadJudgementModelSettings();
  const settings: JudgementModelSettings = Object.freeze({
    backend: requested.backend === "hosted" || requested.backend === "off" ? requested.backend : "local",
    ...(requested.hostedProvider === "typesafe" ? { hostedProvider: "typesafe" as const, customModel: requested.customModel?.trim() || "jev-latest" } : {}),
    localModelId: requested.localModelId,
    gatewayPath: gatewayPath(requested.gatewayPath),
    requestTokens: typeof requested.requestTokens === "number" && Number.isSafeInteger(requested.requestTokens)
      && requested.requestTokens >= 512 && requested.requestTokens <= 2_000_000 ? requested.requestTokens : null,
    stateQuestionTokens: typeof requested.stateQuestionTokens === "number" && Number.isSafeInteger(requested.stateQuestionTokens)
      && requested.stateQuestionTokens >= 512 && requested.stateQuestionTokens <= 2_000_000 ? requested.stateQuestionTokens
      : typeof requested.contextWindowTokens === "number" && Number.isSafeInteger(requested.contextWindowTokens)
        && requested.contextWindowTokens >= 512 && requested.contextWindowTokens <= 2_000_000 ? requested.contextWindowTokens : null,
  });
  const installation = settings.backend !== "off" && options.calibration === undefined ? options.calibrationStore ?? webJudgementCalibrationStore() : null;
  if (installation) void installation.ensureLoaded();
  const calibration = options.calibration ?? installation?.calibration(settings.localModelId, options.hosted?.model);
  const generation = installation?.state().generation;
  const tiers: JudgementTier[] = [];
  const entries: Record<string, JudgementThresholds> = {};

  if (settings.backend !== "off") {
    const key = calibrationKey("local", settings.localModelId, calibration?.local);
    const bridge = options.desktopBridge ?? desktopOfflineBridge();
    const supplied = options.localScorer;
    const scorer = supplied?.modelId === settings.localModelId ? supplied.scoreLabels
      : settings.localModelId === DESKTOP_OFFLINE_MODEL.id && typeof bridge?.scoreLabels === "function"
        ? createDesktopLocalLabelScorer({ modelId: settings.localModelId, bridge })
        : settings.localModelId === JULIA_MODEL_ID && bridge?.supportedJudgementModels?.includes(JULIA_MODEL_ID) && bridge.scoreLabels
          ? createDesktopJuliaScorer(bridge)
          : settings.localModelId === JULIA_BROWSER_MODEL_ID && juliaBrowserModel.status().available ? createBrowserJuliaScorer() : undefined;
    const local = createWebJudgementCaller({
      localScorer: scorer ?? (async () => null), localModel: key.model,
      calibrationSha256: key.calibrationSha256, gateway: "none",
    });
    tiers.push(Object.freeze({ key, call: local.call, isAvailable: () => scorer !== undefined
      && (settings.localModelId !== JULIA_BROWSER_MODEL_ID || juliaBrowserModel.status().installed) }));
    Object.assign(entries, calibratedEntries(key, calibration?.local));
  }

  if (settings.backend === "hosted") {
    const model = settings.hostedProvider === "typesafe" ? settings.customModel ?? "jev-latest"
      : options.hosted?.model ?? calibration?.hosted?.backend.model ?? WEB_JUDGEMENT_MODEL_ALIAS;
    const key = calibrationKey("system-one", model, calibration?.hosted);
    const sameOrigin = import.meta.env?.VITE_KEATING_JUDGEMENT_SAME_ORIGIN === "true";
    const account = !sameOrigin && (!options.hosted?.fetch || options.hosted?.accountClient)
      ? createPublicAccountJudgementBackend({ client: options.hosted?.accountClient,
        model: key.model, calibrationSha256: key.calibrationSha256, sleep: options.hosted?.sleep }) : null;
    const hosted = createWebJudgementCaller({
      gateway: "same-origin", endpoint: settings.gatewayPath,
      model: key.model, calibrationSha256: key.calibrationSha256,
      fetch: options.hosted?.fetch, sleep: options.hosted?.sleep,
    });
    tiers.push(Object.freeze(settings.hostedProvider === "typesafe" ? createStoredTypesafeJudgementBackend(model) : account ?? { key, call: hosted.call }));
    if (settings.hostedProvider !== "typesafe") Object.assign(entries, calibratedEntries(key, calibration?.hosted));
  }

  const orderedTiers = settings.backend === "hosted" ? [...tiers].reverse() : tiers;
  const policy: RouterPolicy = Object.freeze({
    tiers: Object.freeze(orderedTiers.map(tier => Object.freeze({ ...tier,
      ...(installation ? { isAvailable: () => installation.current(generation!) && (tier.isAvailable?.() ?? true) } : {}),
      call: observeJudgementCaller(installation ? guardCalibrationCall(tier.call, installation, generation!) : tier.call, tier.key),
    }))),
    calibration: Object.freeze({ entries: Object.freeze(entries) }),
    ...(options.pinnedBackend ? { pinnedBackend: Object.freeze({ ...options.pinnedBackend }) } : {}),
  });
  const hostedModel = settings.hostedProvider === "typesafe" ? settings.customModel ?? "jev-latest"
    : options.hosted?.model ?? calibration?.hosted?.backend.model ?? WEB_JUDGEMENT_MODEL_ALIAS;
  const isJevModel = hostedModel === "jev-latest" || hostedModel === "jev-preview" || /^jev-\d/.test(hostedModel);
  const localNativeContextWindow = options.localScorer?.contextWindowTokens
    ?? (settings.localModelId === JULIA_MODEL_ID || settings.localModelId === JULIA_BROWSER_MODEL_ID ? JULIA_MODEL.contextTokens
      : settings.localModelId === DESKTOP_OFFLINE_MODEL.id && typeof (options.desktopBridge ?? desktopOfflineBridge())?.scoreLabels === "function"
      ? DESKTOP_OFFLINE_MODEL.contextWindow : null);
  const localRequestTokens = localNativeContextWindow ?? settings.requestTokens ?? null;
  const localStateQuestionTokens = localNativeContextWindow ?? settings.stateQuestionTokens ?? null;
  const hostedRequestTokens = options.hosted?.requestTokens ?? settings.requestTokens
    ?? (isJevModel ? JEV_REQUEST_TOKEN_LIMIT : null);
  const hostedStateQuestionTokens = options.hosted?.stateQuestionTokens ?? options.hosted?.contextWindowTokens ?? settings.stateQuestionTokens
    ?? (isJevModel ? JEV_STATE_QUESTION_TOKEN_LIMIT : null);
  const localFallbackAvailable = options.localScorer?.modelId === settings.localModelId
    || settings.localModelId === DESKTOP_OFFLINE_MODEL.id && typeof (options.desktopBridge ?? desktopOfflineBridge())?.scoreLabels === "function"
    || settings.localModelId === JULIA_MODEL_ID && Boolean((options.desktopBridge ?? desktopOfflineBridge())?.supportedJudgementModels?.includes(JULIA_MODEL_ID))
    || settings.localModelId === JULIA_BROWSER_MODEL_ID && juliaBrowserModel.status().installed;
  const activeRequestLimits = settings.backend === "hosted"
    ? [hostedRequestTokens, ...(localFallbackAvailable ? [localRequestTokens] : [])]
    : settings.backend === "local" ? [localRequestTokens] : [];
  const activeStateQuestionLimits = settings.backend === "hosted"
    ? [hostedStateQuestionTokens, ...(localFallbackAvailable ? [localStateQuestionTokens] : [])]
    : settings.backend === "local" ? [localStateQuestionTokens] : [];
  const minimumKnown = (values: readonly (number | null)[]) => {
    const known = values.filter((value): value is number => typeof value === "number"
      && Number.isSafeInteger(value) && value >= 512 && value <= 2_000_000);
    return known.length ? Math.min(...known) : null;
  };
  const judgementModel = Object.freeze({
    id: settings.backend === "hosted" ? hostedModel : settings.localModelId,
    requestTokens: minimumKnown(activeRequestLimits),
    stateQuestionTokens: minimumKnown(activeStateQuestionLimits),
  });
  return Object.freeze({ settings, policy, judgementModel });
}
