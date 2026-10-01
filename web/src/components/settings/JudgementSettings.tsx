import { JudgementCalibrationSettings } from "./JudgementCalibrationSettings";
import { useEffect, useId, useState } from "react";
import {
  JEV_REQUEST_TOKEN_LIMIT, JEV_STATE_QUESTION_TOKEN_LIMIT, loadJudgementModelSettings, saveJudgementModelSettings, subscribeJudgementModelSettings,
  type JudgementModelSettings,
} from "../../keating/judgement-model";
import { judgementAccountStatus, judgementAuthorizationUrl } from "../../keating/judgement/public-account";
import { BROWSER_MODELS } from "../../stores/local-model";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL, type DesktopOfflineStatus } from "../../lib/desktop-offline";
import "./judgement-settings.css";
import { JULIA_BROWSER_MODEL_ID, JULIA_MODEL_ID, JULIA_MODEL } from "../../../../shared/julia/manifest.js";
import type { DesktopOfflineBridge } from "../../lib/desktop-offline";
import { JuliaLocalModelSettings } from "./JuliaLocalModelSettings";
import { getAppStorage } from "../../keating/app-storage";

interface AccountStatus { configured: boolean; connected: boolean; judgementAuthorized: boolean }
export interface JudgementSettingsViewProps {
  settings: JudgementModelSettings;
  desktop: boolean;
  scoringAvailable: boolean;
  offlineStatus?: DesktopOfflineStatus;
  account: AccountStatus | null;
  checkingAccount: boolean;
  connecting: boolean;
  error: string;
  onChange: (settings: JudgementModelSettings) => void;
  onConnect: () => void;
  keyInput?: string;
  keySaved?: boolean;
  checkingKey?: boolean;
  savingKey?: boolean;
  keyError?: string;
  onKeyInput?: (value: string) => void;
  onSaveKey?: () => void;
  onRemoveKey?: () => void;
  juliaId?: string;
  juliaBridge?: DesktopOfflineBridge;
}

/** Separate rendering keeps loading, unavailable, and expired-account states reviewable. */
export function JudgementSettingsView({ settings, desktop, scoringAvailable, offlineStatus, account,
  checkingAccount, connecting, error, onChange, onConnect, juliaId, juliaBridge,
  keyInput = "", keySaved = false, checkingKey = false, savingKey = false, keyError = "", onKeyInput, onSaveKey, onRemoveKey }: JudgementSettingsViewProps) {
  const id = useId();
  const typesafeSelected = settings.backend === "hosted" && settings.hostedProvider === "typesafe";
  const [modelInput, setModelInput] = useState(settings.customModel ?? "jev-latest");
  const [modelError, setModelError] = useState("");
  useEffect(() => { setModelInput(settings.customModel ?? "jev-latest"); setModelError(""); }, [settings.customModel]);
  const saveModel = () => {
    const model = modelInput.trim() || "jev-latest";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) {
      setModelError("Use a model ID of up to 200 letters, numbers, periods, underscores, colons, slashes or hyphens, starting with a letter or number.");
      return;
    }
    setModelError("");
    setModelInput(model);
    if (model !== (settings.customModel ?? "jev-latest")) onChange({ ...settings, customModel: model });
  };
  const localModels = [
    ...(juliaId ? [{ id: juliaId, name: "Julia 1 · local decision model" }] : []),
    ...(desktop ? [{ id: DESKTOP_OFFLINE_MODEL.id, name: "MiniCPM5 2B · desktop" }] : []),
    ...BROWSER_MODELS.map(({ id, name }) => ({ id, name })),
  ];
  if (!localModels.some(({ id }) => id === settings.localModelId)) {
    localModels.push({ id: settings.localModelId, name: `${settings.localModelId} · saved selection` });
  }
  const nativeSelected = settings.localModelId === DESKTOP_OFFLINE_MODEL.id;
  const juliaSelected = Boolean(juliaId && settings.localModelId === juliaId);
  const localStatus = juliaSelected ? "Install Julia below to preview local decisions. Automatic reviews require matching verified calibration."
    : !nativeSelected
    ? "Scoring with browser models is not available yet. Your selected model is saved."
    : !desktop || !scoringAvailable
      ? "This app build does not provide local judgement scoring."
      : !offlineStatus ? "Checking the local model…"
        : !offlineStatus.available ? "The local scoring runtime is unavailable in this build."
          : !offlineStatus.installed ? "Install the offline tutor above to use this model for judgement."
            : "The local model is installed. Matching verified calibration can be installed below.";
  return <section id="settings-section-judgement" className="judgement-settings" aria-labelledby={`${id}-title`}>
    <div>
      <h3 id={`${id}-title`}>Judgement model</h3>
      <p>Choose how Keating reviews work. This choice is separate from your tutor model.</p>
    </div>
    <label className="judgement-settings__field" htmlFor={`${id}-backend`}>
      <span>Choose a judgement model</span>
      <select id={`${id}-backend`} value={settings.backend === "local" ? `local:${settings.localModelId}` : typesafeSelected ? "typesafe" : settings.backend} disabled={connecting}
        aria-describedby={`${id}-privacy`} onChange={(event) => {
          const value = event.target.value;
          onChange(value.startsWith("local:")
            ? { ...settings, backend: "local", localModelId: value.slice(6) }
            : { ...settings, backend: value === "off" ? "off" : "hosted", hostedProvider: value === "typesafe" ? "typesafe" : "notorganic" });
        }}>
        <option value="hosted">Jev · Not Organic · Recommended</option>
        <option value="typesafe">Jev · your TypeSafe API key</option>
        <optgroup label="On this device">
          {!desktop && !localModels.some(model => model.id === DESKTOP_OFFLINE_MODEL.id) && <option value={`local:${DESKTOP_OFFLINE_MODEL.id}`} disabled>MiniCPM5 2B · requires desktop app</option>}
          {localModels.map(model => <option key={model.id} value={`local:${model.id}`}
            disabled={model.id !== juliaId && (model.id !== DESKTOP_OFFLINE_MODEL.id || !desktop || !scoringAvailable)}>
            {model.name}{model.id === juliaId ? "" : model.id !== DESKTOP_OFFLINE_MODEL.id ? " · scoring unavailable" : !scoringAvailable ? " · scoring unavailable in this build" : ""}
          </option>)}
        </optgroup>
        <option value="off">Off · built-in checks only</option>
      </select>
    </label>
    <p id={`${id}-privacy`}>
      {settings.backend === "off" ? "Model reviews are off. Built-in checks remain available."
        : settings.backend === "local" ? "Reviews stay on this device."
        : typesafeSelected ? "Reviews go to TypeSafe with your own key. TypeSafe bills you directly. Your key is relayed through Keating only for requests you trigger."
        : "Reviews go through your Not Organic account and may use credit."}
    </p>
    <p className="judgement-settings__hint">New to this? <a href="https://docs.keating.help/" target="_blank" rel="noopener noreferrer">Read the judgement setup guide</a> for Jev, your own TypeSafe key, and on-device options.</p>
    {typesafeSelected && <div className="judgement-settings__account">
      <label className="judgement-settings__field" htmlFor={`${id}-typesafe-model`}>
        <span>Model ID</span>
        <input id={`${id}-typesafe-model`} type="text" value={modelInput}
          placeholder="jev-latest" maxLength={200} aria-invalid={Boolean(modelError)}
          aria-describedby={modelError ? `${id}-model-error` : undefined}
          onChange={(event) => { setModelInput(event.target.value); setModelError(""); }} onBlur={saveModel}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </label>
      {modelError && <p id={`${id}-model-error`} role="alert">{modelError}</p>}
      <label className="judgement-settings__field" htmlFor={`${id}-typesafe-key`}>
        <span>TypeSafe API key</span>
        <input id={`${id}-typesafe-key`} type="password" autoComplete="new-password" spellCheck={false}
          value={keyInput} disabled={checkingKey || savingKey}
          placeholder={keySaved ? "Enter a replacement key" : "Enter your TypeSafe API key"}
          aria-describedby={`${id}-key-status`} onChange={(event) => onKeyInput?.(event.target.value)} />
      </label>
      <div className="judgement-settings__actions">
        <button type="button" disabled={checkingKey || savingKey || !keyInput.trim()} onClick={onSaveKey}>
          {savingKey ? "Saving…" : keySaved ? "Update API key" : "Save API key"}
        </button>
        {keySaved && <button type="button" disabled={checkingKey || savingKey} onClick={onRemoveKey}>Remove API key</button>}
      </div>
      <p id={`${id}-key-status`} role="status">{checkingKey ? "Checking saved API key…" : savingKey ? "Updating API key…"
        : keySaved ? "API key saved on this device." : "No TypeSafe API key saved. Save a key to use this judgement model."}</p>
      {keyError && <p role="alert">{keyError}</p>}
    </div>}
    {settings.backend !== "off" && <>
      {settings.backend === "hosted" && <>
      <label className="judgement-settings__field" htmlFor={`${id}-model`}>
        <span>Local judgement model · fallback</span>
        <select id={`${id}-model`} value={settings.localModelId} disabled={connecting}
          aria-describedby={`${id}-local-status`} onChange={(event) => onChange({ ...settings, localModelId: event.target.value })}>
          {localModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      </>}
      <p id={`${id}-local-status`} role="status">{localStatus}</p>
      {juliaSelected && <JuliaLocalModelSettings bridge={juliaBridge} />}
      {nativeSelected && desktop && scoringAvailable && !offlineStatus?.installed && <a href="#offline-tutor">Set up the offline tutor</a>}
      <details className="judgement-settings__account">
      <summary>Advanced review options</summary>
      <label className="judgement-settings__field" htmlFor={`${id}-request-tokens`}>
        <span>Maximum tokens per judge request</span>
        <input id={`${id}-request-tokens`} type="number" min={512} max={2_000_000} step={512}
          value={settings.requestTokens ?? (settings.backend === "hosted" ? JEV_REQUEST_TOKEN_LIMIT : "")} disabled={connecting}
          placeholder={juliaSelected ? String(JULIA_MODEL.contextTokens) : nativeSelected ? String(DESKTOP_OFFLINE_MODEL.contextWindow) : "Model default"}
          aria-describedby={`${id}-context-window-help`}
          onChange={(event) => {
            const raw = event.target.value;
            onChange({ ...settings, requestTokens: raw === "" ? null : Number(raw) });
          }} />
      </label>
      <label className="judgement-settings__field" htmlFor={`${id}-state-question-tokens`}>
        <span>State plus longest question (tokens)</span>
        <input id={`${id}-state-question-tokens`} type="number" min={512} max={2_000_000} step={512}
          value={settings.stateQuestionTokens ?? (settings.backend === "hosted" ? JEV_STATE_QUESTION_TOKEN_LIMIT : "")} disabled={connecting}
          placeholder={juliaSelected ? String(JULIA_MODEL.contextTokens) : nativeSelected ? String(DESKTOP_OFFLINE_MODEL.contextWindow) : "Model default"}
          aria-describedby={`${id}-context-window-help`}
          onChange={(event) => {
            const raw = event.target.value;
            onChange({ ...settings, stateQuestionTokens: raw === "" ? null : Number(raw) });
          }} />
      </label>
      <p id={`${id}-context-window-help`}>
        Leave blank for the model default. Hosted Jev allows 64,000 and 32,000 tokens; long chats drop the oldest turns first. <a href="https://docs.keating.help/" target="_blank" rel="noopener noreferrer">Learn more</a>
      </p>
      </details>
      <p>Automatic grading stays with the existing checks until calibration and validation are complete.</p>
    </>}
    {settings.backend === "hosted" && !typesafeSelected && <div className="judgement-settings__account">
      <p role="status">{checkingAccount ? "Checking Not Organic access…"
        : account?.judgementAuthorized ? "Not Organic judgement access is connected."
          : account?.connected ? "Your account is connected. Authorize judgement access to use hosted reviews."
            : account?.configured ? "Connect or renew your Not Organic account to use hosted reviews."
              : "Not Organic account access is unavailable in this app configuration."}</p>
      {!account?.judgementAuthorized && <button type="button" disabled={checkingAccount || connecting || !account?.configured}
        onClick={onConnect}>
        {connecting ? "Opening authorization…" : account?.connected ? "Authorize judgement access" : "Connect Not Organic"}
      </button>}
    </div>}
    <details className="judgement-settings__account"><summary>Calibration</summary><JudgementCalibrationSettings /></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function JudgementSettings() {
  const [settings, setSettings] = useState(loadJudgementModelSettings);
  const [offlineStatus, setOfflineStatus] = useState<DesktopOfflineStatus>();
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [checkingAccount, setCheckingAccount] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [checkingKey, setCheckingKey] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const bridge = desktopOfflineBridge();
  useEffect(() => {
    let active = true;
    void getAppStorage().providerKeys.get("typesafe-judgement")
      .then((key) => { if (active) setKeySaved(Boolean(key)); })
      .catch(() => { if (active) setKeyError("Could not check the saved API key. Reopen settings to retry."); })
      .finally(() => { if (active) setCheckingKey(false); });
    return () => { active = false; };
  }, []);
  const updateKey = async (remove: boolean) => {
    if (savingKey || checkingKey || (!remove && !keyInput.trim())) return;
    setSavingKey(true);
    setKeyError("");
    try {
      const keys = getAppStorage().providerKeys;
      if (remove) await keys.delete("typesafe-judgement");
      else await keys.set("typesafe-judgement", keyInput.trim());
      setKeySaved(!remove);
      setKeyInput("");
      saveJudgementModelSettings({ ...settings });
    } catch {
      setKeyError(remove ? "Could not remove the API key. Please try again." : "Could not save the API key. Please try again.");
    } finally { setSavingKey(false); }
  };
  useEffect(() => subscribeJudgementModelSettings(setSettings), []);
  useEffect(() => {
    if (!bridge || settings.backend === "off" || settings.localModelId !== DESKTOP_OFFLINE_MODEL.id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const status = await bridge.status(); if (active) setOfflineStatus(status); }
      catch { if (active) setError("Could not check the local model. Reopen settings to retry."); }
      finally { if (active) timer = setTimeout(refresh, 2000); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [bridge, settings.backend, settings.localModelId]);
  useEffect(() => {
    if (settings.backend !== "hosted" || settings.hostedProvider === "typesafe") {
      setCheckingAccount(false);
      return;
    }
    let active = true;
    const refresh = async () => {
      if (active) setCheckingAccount(true);
      try { const status = await judgementAccountStatus(); if (active) setAccount(status); }
      catch { if (active) { setAccount(null); setError("Could not check Not Organic access. Reopen settings to retry."); } }
      finally { if (active) setCheckingAccount(false); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [settings.backend, settings.hostedProvider]);
  const change = (next: JudgementModelSettings) => {
    setError("");
    saveJudgementModelSettings(next);
    const saved = loadJudgementModelSettings();
    setSettings(saved);
    if (saved.backend !== next.backend || (saved.hostedProvider ?? "notorganic") !== (next.hostedProvider ?? "notorganic")
      || (saved.customModel ?? "jev-latest") !== (next.customModel?.trim() || "jev-latest") || saved.localModelId !== next.localModelId
      || saved.requestTokens !== (next.requestTokens ?? null)
      || saved.stateQuestionTokens !== (next.stateQuestionTokens ?? null)) {
      setError("This browser could not save the judgement setting. Allow local storage and try again.");
    }
  };
  const connect = async () => {
    if (connecting || settings.backend !== "hosted" || settings.hostedProvider === "typesafe") return;
    setConnecting(true);
    setError("");
    try {
      const returnTo = new URL(window.location.href);
      returnTo.searchParams.set("settings", "judgement");
      const url = await judgementAuthorizationUrl(returnTo.pathname + returnTo.search + returnTo.hash);
      window.location.assign(url);
    } catch {
      setError("Could not start Not Organic authorization. Please try again.");
      setConnecting(false);
    }
  };
  return <JudgementSettingsView settings={settings} desktop={!!bridge} scoringAvailable={typeof bridge?.scoreLabels === "function"}
    juliaId={bridge?.supportedJudgementModels?.includes(JULIA_MODEL_ID) ? JULIA_MODEL_ID : JULIA_BROWSER_MODEL_ID} juliaBridge={bridge ?? undefined}
    offlineStatus={offlineStatus} account={account} checkingAccount={checkingAccount} connecting={connecting}
    error={error} onChange={change} onConnect={() => void connect()}
    keyInput={keyInput} keySaved={keySaved} checkingKey={checkingKey} savingKey={savingKey} keyError={keyError}
    onKeyInput={setKeyInput} onSaveKey={() => void updateKey(false)} onRemoveKey={() => void updateKey(true)} />;
}
