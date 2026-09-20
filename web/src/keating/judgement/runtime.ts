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
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS, loadJudgementModelSettings, type JudgementModelSettings } from "../judgement-model";
import { createDesktopLocalLabelScorer } from "./local-scorer";
import { createWebJudgementCaller, WEB_JUDGEMENT_MODEL_ALIAS, type WebJudgementCallerOptions } from "./transport";
import { createPublicAccountJudgementBackend, type JudgementAccountClient } from "./public-account";
import { observeJudgementCaller } from "./diagnostics";

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
  readonly localScorer?: { readonly modelId: string; readonly scoreLabels: LocalLabelScorer };
  readonly hosted?: Pick<WebJudgementCallerOptions, "model" | "fetch" | "sleep"> & {
    readonly accountClient?: JudgementAccountClient | null;
  };
  /** No defaults: local and hosted thresholds are measured separately. */
  readonly calibration?: { readonly local?: WebJudgementCalibration; readonly hosted?: WebJudgementCalibration };
  /** Pins restrict the existing router; they never override privacy settings. */
  readonly pinnedBackend?: JudgementBackendKey;
}

export interface WebJudgementRuntime {
  readonly settings: JudgementModelSettings;
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
 * `local` never calls hosted inference; `hosted` permits local-first escalation
 * to the account gateway; `off` retains only the caller's deterministic baseline.
 * Missing calibration stays unknown, so the shared router makes no model call.
 */
export function createWebJudgementRuntime(options: WebJudgementRuntimeOptions = {}): WebJudgementRuntime {
  const requested = options.settings ?? loadJudgementModelSettings();
  const settings: JudgementModelSettings = Object.freeze({
    backend: requested.backend === "hosted" || requested.backend === "off" ? requested.backend : "local",
    localModelId: requested.localModelId,
    gatewayPath: gatewayPath(requested.gatewayPath),
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
        ? createDesktopLocalLabelScorer({ modelId: settings.localModelId, bridge }) : undefined;
    const local = createWebJudgementCaller({
      localScorer: scorer ?? (async () => null), localModel: key.model,
      calibrationSha256: key.calibrationSha256, gateway: "none",
    });
    tiers.push(Object.freeze({ key, call: local.call, isAvailable: () => scorer !== undefined }));
    Object.assign(entries, calibratedEntries(key, calibration?.local));
  }

  if (settings.backend === "hosted") {
    const model = options.hosted?.model ?? calibration?.hosted?.backend.model ?? WEB_JUDGEMENT_MODEL_ALIAS;
    const key = calibrationKey("system-one", model, calibration?.hosted);
    const account = !options.hosted?.fetch || options.hosted?.accountClient
      ? createPublicAccountJudgementBackend({ client: options.hosted?.accountClient,
        model: key.model, calibrationSha256: key.calibrationSha256, sleep: options.hosted?.sleep }) : null;
    const hosted = createWebJudgementCaller({
      gateway: "same-origin", endpoint: settings.gatewayPath,
      model: key.model, calibrationSha256: key.calibrationSha256,
      fetch: options.hosted?.fetch, sleep: options.hosted?.sleep,
    });
    tiers.push(Object.freeze(account ?? { key, call: hosted.call }));
    Object.assign(entries, calibratedEntries(key, calibration?.hosted));
  }

  const policy: RouterPolicy = Object.freeze({
    tiers: Object.freeze(tiers.map(tier => Object.freeze({ ...tier,
      ...(installation ? { isAvailable: () => installation.current(generation!) && (tier.isAvailable?.() ?? true) } : {}),
      call: observeJudgementCaller(installation ? guardCalibrationCall(tier.call, installation, generation!) : tier.call, tier.key),
    }))),
    calibration: Object.freeze({ entries: Object.freeze(entries) }),
    ...(options.pinnedBackend ? { pinnedBackend: Object.freeze({ ...options.pinnedBackend }) } : {}),
  });
  return Object.freeze({ settings, policy });
}
