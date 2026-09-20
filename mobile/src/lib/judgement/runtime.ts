import { createSystemOneCaller, createLocalJudgementCaller, type LocalLabelScorer, type JudgementCaller, type JudgementOutcome, type RouterPolicy } from "@keating/learner-contracts";
import { notOrganicJudgementRequest } from "../notorganic-account/client";
import { mobileJudgementCalibrationStore, mobileLocalJudgementCalibrationStore, type InstalledMobileCalibration, type MobileJudgementCalibrationStore } from "./calibration";
import { createMobileLocalLabelScorer, MOBILE_LOCAL_JUDGEMENT_MODEL } from "./local-scorer";

export interface MobileJudgementRuntime {
  readonly hostedEnabled: boolean;
  readonly enabled?: boolean;
  readonly localEnabled?: boolean;
  readonly policy: RouterPolicy;
  readonly call: JudgementCaller;
}

/** A fresh operation pins either a verified fitted model or the resolved hosted alias. */
export function createMobileJudgementRuntime(options: {
  hostedEnabled: boolean;
  localEnabled?: boolean;
  localScorer?: LocalLabelScorer;
  localCalibration?: InstalledMobileCalibration | null;
  localConsent?: () => Promise<boolean>;
  consent?: () => Promise<boolean>;
  request?: typeof notOrganicJudgementRequest;
  timeoutMs?: number;
  calibration?: InstalledMobileCalibration | null;
  configuration?: { revision: number; store: Pick<MobileJudgementCalibrationStore, "isCurrent" | "subscribe"> };
}): MobileJudgementRuntime {
  if (options.localEnabled) {
    const hosted = createMobileJudgementRuntime({ ...options, localEnabled: false });
    const installed = options.localCalibration ? structuredClone(options.localCalibration) : null;
    const valid = !installed || installed.backend.backend === "local" && installed.backend.model === MOBILE_LOCAL_JUDGEMENT_MODEL;
    const key = Object.freeze({ backend: "local" as const, model: MOBILE_LOCAL_JUDGEMENT_MODEL, calibrationSha256: installed?.backend.calibrationSha256 ?? null });
    const local = createLocalJudgementCaller({ model: key.model, calibrationSha256: key.calibrationSha256, scoreLabels: options.localScorer ?? createMobileLocalLabelScorer() });
    const current = () => !options.configuration || options.configuration.store.isCurrent(options.configuration.revision);
    const call: JudgementCaller = async (request, signal) => {
      const cancelled: JudgementOutcome = { ok: false, error: { code: "cancelled", retryable: false } };
      if (!valid) return { ok: false, error: { code: "backend-unavailable", retryable: false } };
      if (signal?.aborted || !current() || options.localConsent && !await options.localConsent()) return cancelled;
      const controller = new AbortController();
      let abort!: () => void;
      const cancellation = new Promise<JudgementOutcome>(resolve => { abort = () => { controller.abort(); resolve(cancelled); }; });
      signal?.addEventListener("abort", abort, { once: true });
      const unsubscribe = options.configuration?.store.subscribe(abort);
      const timer = setTimeout(abort, options.timeoutMs ?? 30_000);
      try {
        if (signal?.aborted || !current()) abort();
        const result = await Promise.race([local(request, controller.signal).catch(() => ({ ok: false, error: { code: "backend-unavailable", retryable: false } }) as JudgementOutcome), cancellation]);
        if (controller.signal.aborted || !current() || options.localConsent && !await options.localConsent()) return cancelled;
        return result;
      } finally { clearTimeout(timer); unsubscribe?.(); signal?.removeEventListener("abort", abort); }
    };
    const combined: JudgementCaller = async (request, signal) => {
      const result = await call(request, signal);
      if (result.ok && Object.keys(request.questions).every(id => Object.hasOwn(result.response.answers, id))) return result;
      if (signal?.aborted || !current() || !result.ok && result.error.code === "cancelled") return result;
      return options.hostedEnabled ? hosted.call(request, signal) : result;
    };
    return Object.freeze({ hostedEnabled: options.hostedEnabled, localEnabled: true, enabled: true, call: combined,
      policy: Object.freeze({ tiers: Object.freeze([{ key, call }, ...hosted.policy.tiers]),
        calibration: Object.freeze({ entries: Object.freeze(Object.fromEntries(Object.entries({ ...hosted.policy.calibration.entries,
          ...(valid ? installed?.table.entries ?? {} : {}) }).map(([name, thresholds]) => [name, Object.freeze({ ...thresholds })]))) }) }) });
  }
  const unavailable: JudgementOutcome = { ok: false, error: { code: "backend-unavailable", retryable: false } };
  let model: string | undefined;
  const calibrated = options.calibration ? structuredClone(options.calibration) : null;
  const key = Object.freeze(calibrated?.backend ?? { backend: "system-one" as const, model: "judgement", calibrationSha256: null });
  const calibration = Object.freeze({ entries: Object.freeze(Object.fromEntries(Object.entries(options.hostedEnabled && calibrated ? calibrated.table.entries : {})
    .map(([entry, thresholds]) => [entry, Object.freeze({ ...thresholds })]))) });
  const current = () => !options.configuration || options.configuration.store.isCurrent(options.configuration.revision);
  const underlying = createSystemOneCaller({ model: key.model, requestModel: "judgement", requireResolvedModel: true,
    endpoint: "/v1/judgement", calibrationSha256: key.calibrationSha256, retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0 },
    fetch: async (_url, init) => {
      if (!options.hostedEnabled || (options.consent && !await options.consent())) return new Response(null, { status: 403 });
      if (!current() || init.signal?.aborted) return new Response(null, { status: 403 });
      const payload = JSON.parse(init.body) as { state: unknown; questions: Record<string, { type: string; criteria?: object }> };
      if (Object.values(payload.questions).some(question => question.type === "choice" && Object.keys(question.criteria ?? {}).length > 64)) {
        return new Response(null, { status: 400 });
      }
      // Current Not Organic boundary accepts flat string fields; preserve nested state as JSON.
      if (typeof payload.state !== "string") payload.state = JSON.stringify(payload.state);
      return (options.request ?? notOrganicJudgementRequest)(JSON.stringify(payload), init.signal);
    },
  });
  const call: JudgementCaller = async (request, signal) => {
    if (!options.hostedEnabled) return unavailable;
    if (signal?.aborted || !current()) return { ok: false, error: { code: "cancelled", retryable: false } };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let abort!: () => void;
    const cancelled = new Promise<JudgementOutcome>(resolve => {
      abort = () => { controller.abort(); resolve({ ok: false, error: { code: "cancelled", retryable: false } }); };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => { controller.abort(); resolve({ ok: false, error: { code: "backend-timeout", retryable: false } }); }, options.timeoutMs ?? 30_000);
    });
    const unsubscribe = options.configuration?.store.subscribe(abort);
    if (!current()) abort();
    try {
      const result = await Promise.race([underlying(request, controller.signal).catch(() => unavailable), cancelled]);
      if (controller.signal.aborted || !current()) return { ok: false, error: { code: result.ok ? "cancelled" : result.error.code, retryable: false } };
      if (!result.ok) return result;
      if (calibrated && (result.response.backend.backend !== key.backend || result.response.backend.model !== key.model || result.response.backend.calibrationSha256 !== key.calibrationSha256)) {
        return { ok: false, error: { code: "response-malformed", retryable: false } };
      }
      if (model && result.response.backend.model !== model) return { ok: false, error: { code: "response-malformed", retryable: false } };
      model = result.response.backend.model;
      return result;
    } finally { clearTimeout(timer!); signal?.removeEventListener("abort", abort); unsubscribe?.(); }
  };
  return Object.freeze({ hostedEnabled: options.hostedEnabled, enabled: options.hostedEnabled, localEnabled: false, call, policy: Object.freeze({ tiers: Object.freeze(options.hostedEnabled
    ? [Object.freeze({ key, call })] : []), calibration }) });
}

export async function configuredMobileJudgementRuntime(options: {
  loadSettings?: () => Promise<{ judgementHosted: boolean; judgementLocalModel?: string }>;
  calibrationStore?: MobileJudgementCalibrationStore;
  localCalibrationStore?: MobileJudgementCalibrationStore;
  localScorer?: LocalLabelScorer;
  request?: typeof notOrganicJudgementRequest;
} = {}): Promise<MobileJudgementRuntime> {
  const loadSettings = options.loadSettings ?? (await import("../ui-settings-storage")).loadUiSettings;
  const settings = await loadSettings();
  const localEnabled = settings.judgementLocalModel === "minicpm5-2b-int4";
  if (!settings.judgementHosted && !localEnabled) return createMobileJudgementRuntime({ hostedEnabled: false });
  const store = options.calibrationStore ?? mobileJudgementCalibrationStore;
  const localStore = options.localCalibrationStore ?? mobileLocalJudgementCalibrationStore;
  let calibration: InstalledMobileCalibration | null;
  let localCalibration: InstalledMobileCalibration | null;
  try { calibration = settings.judgementHosted ? await store.load() : null; localCalibration = localEnabled ? await localStore.load() : null; }
  catch {
    // A broken installed pin must not quietly continue under an uncalibrated alias.
    return createMobileJudgementRuntime({ hostedEnabled: settings.judgementHosted, consent: async () => false });
  }
  const revision = store.getRevision(), localRevision = localStore.getRevision();
  const currentSettings = async () => { const next = await loadSettings(); return next.judgementHosted === settings.judgementHosted && next.judgementLocalModel === settings.judgementLocalModel; };
  const configuration = { revision: 0, store: {
    isCurrent: () => (!settings.judgementHosted || store.isCurrent(revision)) && (!localEnabled || localStore.isCurrent(localRevision)),
    subscribe: (callback: () => void) => { const a = store.subscribe(callback), b = localStore.subscribe(callback); return () => { a(); b(); }; },
  } };
  return createMobileJudgementRuntime({ hostedEnabled: settings.judgementHosted, calibration, localEnabled, localCalibration,
    localScorer: options.localScorer, localConsent: currentSettings,
    request: options.request, configuration,
    consent: async () => settings.judgementHosted && await currentSettings() });
}
