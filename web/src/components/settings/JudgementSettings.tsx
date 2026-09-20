import { JudgementCalibrationSettings } from "./JudgementCalibrationSettings";
import { useEffect, useId, useState } from "react";
import {
  loadJudgementModelSettings, saveJudgementModelSettings, subscribeJudgementModelSettings,
  type JudgementBackendPreference, type JudgementModelSettings,
} from "../../keating/judgement-model";
import { judgementAccountStatus, judgementAuthorizationUrl } from "../../keating/judgement/public-account";
import { BROWSER_MODELS } from "../../stores/local-model";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODEL, type DesktopOfflineStatus } from "../../lib/desktop-offline";
import "./judgement-settings.css";

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
}

/** Separate rendering keeps loading, unavailable, and expired-account states reviewable. */
export function JudgementSettingsView({ settings, desktop, scoringAvailable, offlineStatus, account,
  checkingAccount, connecting, error, onChange, onConnect }: JudgementSettingsViewProps) {
  const id = useId();
  const localModels = [
    ...(desktop ? [{ id: DESKTOP_OFFLINE_MODEL.id, name: "MiniCPM5 2B · desktop" }] : []),
    ...BROWSER_MODELS.map(({ id, name }) => ({ id, name })),
  ];
  if (!localModels.some(({ id }) => id === settings.localModelId)) {
    localModels.push({ id: settings.localModelId, name: `${settings.localModelId} · saved selection` });
  }
  const nativeSelected = settings.localModelId === DESKTOP_OFFLINE_MODEL.id;
  const localStatus = !nativeSelected
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
      <span>Review mode</span>
      <select id={`${id}-backend`} value={settings.backend} disabled={connecting}
        aria-describedby={`${id}-privacy`} onChange={(event) => onChange({ ...settings,
          backend: event.target.value as JudgementBackendPreference })}>
        <option value="off">Off · built-in checks only</option>
        <option value="local">On this device</option>
        <option value="hosted">Hosted · Not Organic</option>
      </select>
    </label>
    <p id={`${id}-privacy`}>
      {settings.backend === "off" ? "Model reviews are off. Built-in checks remain available."
        : settings.backend === "local" ? "Model reviews stay on this device. Work is not sent to a hosted judge."
          : "Allows relevant work to be sent through Not Organic to its hosted judgement service. Usage may incur account charges."}
    </p>
    {settings.backend !== "off" && <>
      <label className="judgement-settings__field" htmlFor={`${id}-model`}>
        <span>Local judgement model</span>
        <select id={`${id}-model`} value={settings.localModelId} disabled={connecting}
          aria-describedby={`${id}-local-status`} onChange={(event) => onChange({ ...settings, localModelId: event.target.value })}>
          {localModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>
      <p id={`${id}-local-status`} role="status">{localStatus}</p>
      <p>Automatic grading stays with the existing checks until calibration and validation are complete.</p>
    </>}
    {settings.backend === "hosted" && <div className="judgement-settings__account">
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
    <JudgementCalibrationSettings />
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
  const bridge = desktopOfflineBridge();
  useEffect(() => subscribeJudgementModelSettings(setSettings), []);
  useEffect(() => {
    if (!bridge || settings.backend === "off") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const status = await bridge.status(); if (active) setOfflineStatus(status); }
      catch { if (active) setError("Could not check the local model. Reopen settings to retry."); }
      finally { if (active) timer = setTimeout(refresh, 2000); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [bridge, settings.backend]);
  useEffect(() => {
    if (settings.backend !== "hosted") return;
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
  }, [settings.backend]);
  const change = (next: JudgementModelSettings) => {
    setError("");
    saveJudgementModelSettings(next);
    const saved = loadJudgementModelSettings();
    setSettings(saved);
    if (saved.backend !== next.backend || saved.localModelId !== next.localModelId) {
      setError("This browser could not save the judgement setting. Allow local storage and try again.");
    }
  };
  const connect = async () => {
    if (connecting || settings.backend !== "hosted") return;
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
    offlineStatus={offlineStatus} account={account} checkingAccount={checkingAccount} connecting={connecting}
    error={error} onChange={change} onConnect={() => void connect()} />;
}
