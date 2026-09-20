import { verifyJudgementCalibrationText, MAX_CALIBRATION_BYTES, type JudgementCalibrationArtifact } from "../../../../packages/learner-contracts/src/judgement/calibration-artifact";
import type { CalibrationTable, JudgementBackendKey, JudgementCaller } from "@keating/learner-contracts";
import { JUDGEMENT_MODEL_CHANGED_EVENT } from "../judgement-model";

export { MAX_CALIBRATION_BYTES };
export const WEB_CALIBRATION_TEXT_KEY = "keating:judgement-calibration:artifact";
export const WEB_CALIBRATION_SHA_KEY = "keating:judgement-calibration:expected-sha256";
export interface WebCalibrationState {
  status: "unloaded" | "loading" | "empty" | "ready" | "error";
  generation: number;
  error: string | null;
  fileSha256: string | null;
  models: readonly { backend: string; model: string; questions: number }[];
}
export interface InstalledCalibration { backend: JudgementBackendKey; table: CalibrationTable }
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
const storageError = "This browser could not save or read calibration. Allow local storage and try again.";
const verificationError = "Calibration could not be verified. Check the file and its supplied SHA-256.";
const cancelled = () => ({ ok: false as const, error: { code: "cancelled" as const, retryable: false } });

/** Device-local import authority. Never stores a trusted derived table or synchronizes learner data. */
export function createWebJudgementCalibrationStore(options: { storage: () => StorageLike | null; events?: EventTarget; digest?: (text: string) => Promise<string> }) {
  let state: WebCalibrationState = { status: "unloaded", generation: 0, error: null, fileSha256: null, models: [] };
  let artifact: JudgementCalibrationArtifact | null = null;
  let captured: { contents: string | null; sha: string | null } | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const read = () => { const storage = options.storage(); return { contents: storage?.getItem(WEB_CALIBRATION_TEXT_KEY) ?? null, sha: storage?.getItem(WEB_CALIBRATION_SHA_KEY) ?? null }; };
  const same = (a: typeof captured, b: typeof captured) => !!a && !!b && a.contents === b.contents && a.sha === b.sha;
  const publish = (next: Omit<WebCalibrationState, "generation">) => {
    state = { ...next, generation: state.generation + 1 };
    for (const listener of listeners) { try { listener(); } catch { /* UI observers cannot alter authority. */ } }
    options.events?.dispatchEvent(new Event(JUDGEMENT_MODEL_CHANGED_EVENT));
  };
  const unavailable = (error: string) => { artifact = null; publish({ status: "error", error, fileSha256: null, models: [] }); };
  const verify = async (contents: string, sha: string) => {
    const checked = await verifyJudgementCalibrationText(contents, sha, options.digest ?? digest);
    const groups = checked.artifact.groups.filter(group => group.status === "validated");
    const hosted = new Set(groups.filter(group => group.backend.backend === "system-one").map(group => group.backend.model));
    if (hosted.size > 1) throw new Error("Choose an artifact containing one hosted model. Multiple hosted models are ambiguous.");
    if (!groups.length) throw new Error("This artifact has no independently validated question thresholds.");
    return checked;
  };
  const ready = (checked: Awaited<ReturnType<typeof verify>>) => {
    artifact = checked.artifact;
    const models = new Map<string, { backend: string; model: string; questions: number }>();
    for (const group of artifact.groups.filter(group => group.status === "validated")) {
      const key = JSON.stringify([group.backend.backend, group.backend.model]);
      const model = models.get(key) ?? { backend: group.backend.backend, model: group.backend.model, questions: 0 };
      model.questions++; models.set(key, model);
    }
    publish({ status: "ready", error: null, fileSha256: checked.sha256, models: [...models.values()] });
  };
  function reload(): Promise<void> {
    artifact = null;
    let source: NonNullable<typeof captured>;
    try { source = read(); captured = source; } catch { unavailable(storageError); return Promise.resolve(); }
    if (source.contents === null && source.sha === null) {
      publish({ status: "empty", error: null, fileSha256: null, models: [] }); return Promise.resolve();
    }
    publish({ status: "loading", error: null, fileSha256: null, models: [] });
    const generation = state.generation;
    const operation = (async () => {
      try {
        if (source.contents === null || source.sha === null) throw new Error();
        const checked = await verify(source.contents, source.sha);
        if (disposed || generation !== state.generation) return;
        if (!same(source, read())) { await reload(); return; }
        ready(checked);
      } catch { if (!disposed && generation === state.generation) unavailable(verificationError); }
    })();
    pending = operation;
    void operation.finally(() => { if (pending === operation) pending = null; });
    return operation;
  }
  function current(generation: number): boolean {
    if (disposed || generation !== state.generation || !["ready", "empty"].includes(state.status)) return false;
    try { if (!same(captured, read())) { void reload(); return false; } }
    catch { unavailable(storageError); return false; }
    return true;
  }
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key != null && key !== WEB_CALIBRATION_TEXT_KEY && key !== WEB_CALIBRATION_SHA_KEY) return;
    try { if (!same(captured, read())) void reload(); } catch { unavailable(storageError); }
  };
  options.events?.addEventListener("storage", onStorage);
  return {
    ensureLoaded(): Promise<void> { return state.status === "unloaded" ? reload() : pending ?? Promise.resolve(); },
    reload,
    state: () => structuredClone(state),
    current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; artifact = null; state = { ...state, generation: state.generation + 1 }; for (const listener of listeners) listener(); listeners.clear(); options.events?.removeEventListener("storage", onStorage); },
    calibration(localModel: string, hostedModel?: string): { local?: InstalledCalibration; hosted?: InstalledCalibration } {
      if (!current(state.generation) || !artifact) return {};
      const find = (backend: "local" | "system-one", model?: string) => {
        const groups = artifact!.groups.filter(group => group.status === "validated" && group.backend.backend === backend && (model === undefined || group.backend.model === model));
        if (!groups.length) return undefined;
        return structuredClone({ backend: groups[0]!.backend, table: { entries: Object.fromEntries(groups.map(group => [group.key, artifact!.table.entries[group.key]!])) } });
      };
      return { local: find("local", localModel), hosted: find("system-one", hostedModel) };
    },
    async install(contents: string, expectedSha256: string): Promise<void> {
      artifact = null; publish({ status: "loading", error: null, fileSha256: null, models: [] });
      const generation = state.generation;
      let checked: Awaited<ReturnType<typeof verify>>;
      try { checked = await verify(contents, expectedSha256); }
      catch (error) {
        const message = error instanceof Error && (error.message.startsWith("Choose an artifact") || error.message.startsWith("This artifact has no")) ? error.message : verificationError;
        if (generation === state.generation) unavailable(message);
        throw new Error(message);
      }
      if (disposed || generation !== state.generation) throw new Error("Calibration installation was cancelled.");
      try {
        const storage = options.storage(); if (!storage) throw new Error();
        storage.setItem(WEB_CALIBRATION_TEXT_KEY, contents); storage.setItem(WEB_CALIBRATION_SHA_KEY, expectedSha256);
        const persisted = read();
        if (persisted.contents !== contents || persisted.sha !== expectedSha256) throw new Error();
        captured = persisted;
      } catch { unavailable(storageError); throw new Error(storageError); }
      ready(checked);
    },
    remove(): void {
      artifact = null; publish({ status: "loading", error: null, fileSha256: null, models: [] });
      try {
        const storage = options.storage(); if (!storage) throw new Error();
        storage.removeItem(WEB_CALIBRATION_TEXT_KEY); storage.removeItem(WEB_CALIBRATION_SHA_KEY);
        captured = read(); if (captured.contents !== null || captured.sha !== null) throw new Error();
        publish({ status: "empty", error: null, fileSha256: null, models: [] });
      } catch { unavailable(storageError); throw new Error(storageError); }
    },
  };
}
export type WebJudgementCalibrationStore = ReturnType<typeof createWebJudgementCalibrationStore>;
let singleton: WebJudgementCalibrationStore | undefined;
export function webJudgementCalibrationStore(): WebJudgementCalibrationStore {
  return singleton ??= createWebJudgementCalibrationStore({ storage: () => typeof localStorage === "undefined" ? null : localStorage,
    events: typeof window === "undefined" ? undefined : window });
}
export const loadWebJudgementCalibration = () => webJudgementCalibrationStore().ensureLoaded();
export const getWebJudgementCalibrationState = () => webJudgementCalibrationStore().state();
export const webJudgementCalibrationGeneration = () => getWebJudgementCalibrationState().generation;
export const installWebJudgementCalibration = (contents: string, expectedSha256: string) => webJudgementCalibrationStore().install(contents, expectedSha256);
export const removeWebJudgementCalibration = () => webJudgementCalibrationStore().remove();
export const subscribeWebJudgementCalibration = (listener: () => void) => webJudgementCalibrationStore().subscribe(listener);

/** Replace/remove and cross-tab raw storage changes invalidate both dispatch and late responses. */
export function guardCalibrationCall(call: JudgementCaller, store: WebJudgementCalibrationStore, generation: number): JudgementCaller {
  return async (request, signal) => {
    if (signal?.aborted || !store.current(generation)) return cancelled();
    const controller = new AbortController();
    let stop!: () => void;
    const abandoned = new Promise<ReturnType<typeof cancelled>>(resolve => { stop = () => { controller.abort(); resolve(cancelled()); }; });
    const unsubscribe = store.subscribe(() => { if (!store.current(generation)) stop(); });
    signal?.addEventListener("abort", stop, { once: true });
    try {
      if (signal?.aborted || !store.current(generation)) return cancelled();
      const result = await Promise.race([call(request, controller.signal), abandoned]);
      return controller.signal.aborted || !store.current(generation) ? cancelled() : result;
    } finally { unsubscribe(); signal?.removeEventListener("abort", stop); }
  };
}
