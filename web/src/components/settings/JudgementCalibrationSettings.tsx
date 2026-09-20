import { useEffect, useId, useState } from "react";
import { getWebJudgementCalibrationState, installWebJudgementCalibration, loadWebJudgementCalibration,
  MAX_CALIBRATION_BYTES, removeWebJudgementCalibration, subscribeWebJudgementCalibration, type WebCalibrationState } from "../../keating/judgement/calibration";

export function JudgementCalibrationSettingsView({ state, file, sha256, busy, error, onFile, onSha256, onInstall, onRemove }: {
  state: WebCalibrationState; file: File | null; sha256: string; busy: boolean; error: string;
  onFile: (file: File | null) => void; onSha256: (sha: string) => void; onInstall: () => void; onRemove: () => void;
}) {
  const id = useId();
  return <details className="judgement-settings__account">
    <summary>Validated calibration</summary>
    <p>Install measured question thresholds for this device. Your review mode stays unchanged. Only matching models and questions can use them.</p>
    <p role="status">{state.status === "loading" || state.status === "unloaded" ? "Verifying saved calibration…"
      : state.status === "ready" ? "Calibration verified on this device."
        : state.status === "error" ? "Calibration is unavailable. Existing built-in checks remain available."
          : "No calibration installed. Model estimates remain uncalibrated."}</p>
    {state.status === "ready" && state.fileSha256 && <p>Installed file SHA-256: <code className="judgement-settings__hash">{state.fileSha256}</code></p>}
    {state.status === "ready" && <ul>{state.models.map(model => <li key={`${model.backend}:${model.model}`}>{model.model}: {model.questions} validated question{model.questions === 1 ? "" : "s"} ({model.backend === "local" ? "on this device" : "hosted"})</li>)}</ul>}
    <label className="judgement-settings__field" htmlFor={`${id}-file`}><span>Calibration file</span>
      <input id={`${id}-file`} type="file" accept="application/json,.json" disabled={busy} onChange={event => onFile(event.target.files?.[0] ?? null)} /></label>
    <label className="judgement-settings__field" htmlFor={`${id}-sha`}><span>Supplied file SHA-256</span>
      <input id={`${id}-sha`} value={sha256} disabled={busy} spellCheck={false} autoCapitalize="none" autoComplete="off" maxLength={64}
        aria-describedby={`${id}-help`} onChange={event => onSha256(event.target.value.trim())} /></label>
    <p id={`${id}-help`}>Use the 64-character hash supplied with the fitted artifact. The file is checked and stored locally; importing it sends no learner data.</p>
    <button type="button" disabled={busy || !file || !/^[a-f0-9]{64}$/.test(sha256)} onClick={onInstall}>{busy ? "Verifying calibration…" : "Install calibration"}</button>
    {state.status !== "empty" && state.status !== "unloaded" && <button type="button" disabled={busy} onClick={onRemove}>Remove calibration</button>}
    {(error || state.error) && <p role="alert">{error || state.error}</p>}
  </details>;
}

export function JudgementCalibrationSettings() {
  const [state, setState] = useState(getWebJudgementCalibrationState);
  const [file, setFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const unsubscribe = subscribeWebJudgementCalibration(() => setState(getWebJudgementCalibrationState()));
    void loadWebJudgementCalibration();
    return unsubscribe;
  }, []);
  const install = async () => {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      if (file.size === 0 || file.size > MAX_CALIBRATION_BYTES) throw new Error("Choose a calibration JSON file no larger than 5 MB.");
      let contents: string;
      try { contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("The calibration file must contain valid UTF-8 JSON."); }
      await installWebJudgementCalibration(contents, sha256);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Calibration could not be installed."); }
    finally { setBusy(false); }
  };
  const remove = () => { setError(""); try { removeWebJudgementCalibration(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Calibration could not be removed."); } };
  return <JudgementCalibrationSettingsView state={state} file={file} sha256={sha256} busy={busy} error={error}
    onFile={value => { setFile(value); setError(""); }} onSha256={value => { setSha256(value); setError(""); }} onInstall={() => void install()} onRemove={remove} />;
}
