import { useEffect, useState } from "react";
import { JULIA_MODEL_ID, JULIA_TOTAL_BYTES } from "../../../../shared/julia/manifest.js";
import { juliaBrowserModel, type JuliaBrowserStatus } from "../../stores/julia-model";
import { type DesktopOfflineBridge } from "../../lib/desktop-offline";
import { createBrowserJuliaScorer, createDesktopJuliaScorer } from "../../keating/judgement/julia-scorer";

/** Installation and a manual preview never activate an automatic teaching decision. */
export function JuliaLocalModelSettings({ bridge }: { bridge?: DesktopOfflineBridge }) {
  const native = bridge?.supportedJudgementModels?.includes(JULIA_MODEL_ID) ? bridge : undefined;
  const [status, setStatus] = useState<JuliaBrowserStatus>(() => juliaBrowserModel.status());
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState("");
  const [example, setExample] = useState("I was charged twice for the same order.");
  useEffect(() => {
    let active = true;
    if (!native) { void juliaBrowserModel.check().catch(() => { if (active) setError("Could not check Julia storage."); }); const unsubscribe = juliaBrowserModel.subscribe(setStatus); return () => { active = false; unsubscribe(); }; }
    const refresh = async () => {
      try {
        const current = await native.status(JULIA_MODEL_ID);
        if (active) setStatus({ ...current, loaded: false });
      } catch { if (active) setError("Could not check the local decision model."); }
    };
    void refresh(); const timer = setInterval(refresh, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [native]);
  const perform = async (action: "download" | "cancel" | "remove" | "unload") => {
    setError(""); setPreview("");
    try {
      if (native) {
        if (action === "download") await native.download(JULIA_MODEL_ID);
        else if (action === "cancel") await native.cancelDownload(JULIA_MODEL_ID);
        else if (action === "remove") await native.remove(JULIA_MODEL_ID);
        else await native.unloadJudgement?.();
      } else {
        if (action === "download") await juliaBrowserModel.download();
        else if (action === "cancel") juliaBrowserModel.cancelDownload();
        else if (action === "remove") await juliaBrowserModel.remove();
        else await juliaBrowserModel.unload();
      }
    } catch (error) { setError(error instanceof Error ? error.message : "The local model action failed."); }
  };
  const test = async () => {
    if (testing) return;
    setTesting(true); setError(""); setPreview("");
    try {
      const scorer = native ? createDesktopJuliaScorer(native) : createBrowserJuliaScorer();
      const instructions = "Which team should handle this request?";
      const weights = await scorer({ state: example, instructions, labels: ["billing", "shipping", "access"],
        question: { type: "choice", instructions, criteria: { billing: "Billing and payment disputes", shipping: "Shipping and delivery", access: "Account access and login" } } });
      if (!weights) throw new Error("Julia could not score this example. Check installation and use a shorter message.");
      const labels = ["Billing", "Shipping", "Account access"], best = weights.indexOf(Math.max(...weights));
      setPreview(`${labels[best]} · model weight ${(weights[best] * 100).toFixed(1)}%. This is a preview, not a calibrated correctness estimate.`);
    } catch (error) { setError(error instanceof Error ? error.message : "The local decision preview failed."); }
    finally { setTesting(false); }
  };
  return <div id="local-decision-model" className="judgement-settings__account">
    <h4>Julia 1 · local decision model</h4>
    <p>About {(JULIA_TOTAL_BYTES / 1e6).toFixed(0)} MB. Kept separate from the tutor; reviews stay on this device.</p>
    <p role="status">{status.downloading ? `Downloading ${(status.downloadedBytes / 1e6).toFixed(0)} of ${(JULIA_TOTAL_BYTES / 1e6).toFixed(0)} MB…`
      : status.installed ? "Julia is installed. Automatic reviews still require matching verified calibration."
        : status.available ? "Download once for local decision previews and calibrated reviews." : "The local runtime is unavailable in this browser."}</p>
    {status.downloading ? <button type="button" onClick={() => void perform("cancel")}>Pause download</button>
      : !status.installed ? <button type="button" disabled={!status.available} onClick={() => void perform("download")}>Download Julia</button>
        : <>
          <button type="button" disabled={testing} onClick={() => void perform("unload")}>Unload model</button>{" "}
          <button type="button" disabled={testing} onClick={() => void perform("remove")}>Remove Julia</button>
        </>}
    {status.installed && <details>
      <summary>Try a local decision</summary>
      <label className="judgement-settings__field"><span>Support message</span><textarea maxLength={1500} value={example} onChange={event => setExample(event.target.value)} /></label>
      <p>Chooses Billing, Shipping or Account access. The example stays local and changes no learner records.</p>
      <button type="button" disabled={testing || !example.trim()} onClick={() => void test()}>{testing ? "Scoring locally…" : "Preview decision"}</button>
      {preview && <p role="status">{preview}</p>}
    </details>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
  </div>;
}
