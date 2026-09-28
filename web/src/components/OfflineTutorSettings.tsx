import { useEffect, useState } from "react";
import { desktopOfflineBridge, DESKTOP_OFFLINE_MODELS, type DesktopOfflineStatus } from "../lib/desktop-offline";
import "./offline-tutor-settings.css";

export function OfflineTutorSettings() {
	const bridge = desktopOfflineBridge();
	const [modelId, setModelId] = useState<string>(DESKTOP_OFFLINE_MODELS[0].id);
  const model = DESKTOP_OFFLINE_MODELS.find(item => item.id === modelId)!;
  const isGemma = modelId === DESKTOP_OFFLINE_MODELS[1].id;
  const isBonsai = modelId === DESKTOP_OFFLINE_MODELS[2].id;
	const [status, setStatus] = useState<DesktopOfflineStatus>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!bridge) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try { const next = await bridge.status(modelId); if (active) setStatus(next); }
			catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not check offline storage."); }
			finally { if (active) timer = setTimeout(refresh, 1000); }
		};
		void refresh();
		return () => { active = false; clearTimeout(timer); };
	}, [bridge, modelId]);
	if (!bridge) return null;
	const action = async (run: () => Promise<void>) => {
		setBusy(true); setError("");
		try { await run(); setStatus(await bridge.status(modelId)); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Offline tutor operation failed. Please retry."); }
		finally { setBusy(false); }
	};
	const downloaded = Math.max(0, status?.downloadedBytes ?? 0);
	const total = Math.max(1, status?.totalBytes ?? 1_550_000_000);
	const progress = Math.min(100, Math.round(downloaded / total * 100));
	return <section id="offline-tutor" className="offline-tutor-settings" aria-labelledby="offline-tutor-title">
		<h3 id="offline-tutor-title">Offline tutor</h3>
		<label>Offline model <select value={modelId} disabled={busy} onChange={event => { setModelId(event.target.value); setStatus(undefined); setError(""); }}>
      {DESKTOP_OFFLINE_MODELS.filter(item => item.id === DESKTOP_OFFLINE_MODELS[0].id || bridge.supportedModels?.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <p>Download once, then learn without an account or connection.</p>
		<p>{isBonsai ? "About 6.58 GB of weights, plus runtime and working memory. Images and text; Keating enables it on supported desktops with at least 12 GB RAM. Uses the Prism runtime with a conservative 4,096 token context and 512 token replies." : isGemma ? "About 3.66 GB plus working memory. Supports images and WAV recordings; starts with a conservative 4,096 token context. Larger and slower than MiniCPM on compact devices." : "About 1.55 GB. A compact text tutor. Images need a vision model; recordings need a transcript."} Kept across app updates.</p>
		{!status ? <p role="status">Checking local storage…</p> : <>
			<p role="status">{status.downloading ? `Downloading: ${progress}%` : status.installed ? `Ready offline. Choose ${model.name} in the model selector.` : downloaded > 0 ? "Download paused. Resume when you’re ready." : status.available ? "Optional download. Your other models remain available." : "Offline runtime unavailable in this build."}</p>
			{status.downloading && <progress aria-label="Offline tutor download" max={total} value={downloaded} />}
			<div className="offline-tutor-settings__actions">
				{status.downloading ? <button type="button" onClick={() => void action(() => bridge.cancelDownload(modelId))}>Pause download</button> : !status.installed && <button type="button" disabled={busy || !status.available} onClick={() => void action(() => bridge.download(modelId))}>{downloaded > 0 ? "Resume download" : `Download ${isBonsai ? "Bonsai · 6.58 GB" : isGemma ? "Gemma · 3.66 GB" : "MiniCPM · 1.55 GB"}`}</button>}
				{!status.downloading && (status.installed || downloaded > 0) && !status.bundled && <button type="button" disabled={busy || status.generating} onClick={() => void action(() => bridge.remove(modelId))}>Remove download</button>}
			</div>
			{status.bundled && <p>Included with this offline edition. Removing the app removes its bundled model.</p>}
		</>}
		{(error || status?.error) && <p role="alert">{error || status?.error}</p>}
	</section>;
}
