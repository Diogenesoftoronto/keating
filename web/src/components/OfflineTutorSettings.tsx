import { useEffect, useState } from "react";
import { desktopOfflineBridge, type DesktopOfflineStatus } from "../lib/desktop-offline";
import "./offline-tutor-settings.css";

export function OfflineTutorSettings() {
	const bridge = desktopOfflineBridge();
	const [status, setStatus] = useState<DesktopOfflineStatus>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!bridge) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try { const next = await bridge.status(); if (active) setStatus(next); }
			catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not check offline storage."); }
			finally { if (active) timer = setTimeout(refresh, 1000); }
		};
		void refresh();
		return () => { active = false; clearTimeout(timer); };
	}, [bridge]);
	if (!bridge) return null;
	const action = async (run: () => Promise<void>) => {
		setBusy(true); setError("");
		try { await run(); setStatus(await bridge.status()); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Offline tutor operation failed. Please retry."); }
		finally { setBusy(false); }
	};
	const downloaded = Math.max(0, status?.downloadedBytes ?? 0);
	const total = Math.max(1, status?.totalBytes ?? 1_550_000_000);
	const progress = Math.min(100, Math.round(downloaded / total * 100));
	return <section id="offline-tutor" className="offline-tutor-settings" aria-labelledby="offline-tutor-title">
		<h3 id="offline-tutor-title">Offline tutor</h3>
		<p>MiniCPM5 2B runs on this device. Download once, then use text tutoring without an account or connection.</p>
		<p>About 1.55 GB. Kept across app updates. Images need a vision model; recordings need a transcript.</p>
		{!status ? <p role="status">Checking local storage…</p> : <>
			<p role="status">{status.downloading ? `Downloading: ${progress}%` : status.installed ? "Ready offline. Choose MiniCPM5 2B (Offline) in the model selector." : downloaded > 0 ? "Download paused. Resume when you’re ready." : status.available ? "Optional download. Your other models remain available." : "Offline runtime unavailable in this build."}</p>
			{status.downloading && <progress aria-label="Offline tutor download" max={total} value={downloaded} />}
			<div className="offline-tutor-settings__actions">
				{status.downloading ? <button type="button" onClick={() => void action(() => bridge.cancelDownload())}>Pause download</button> : !status.installed && <button type="button" disabled={busy || !status.available} onClick={() => void action(() => bridge.download())}>{downloaded > 0 ? "Resume download" : "Download offline tutor · 1.55 GB"}</button>}
				{!status.downloading && (status.installed || downloaded > 0) && !status.bundled && <button type="button" disabled={busy || status.generating} onClick={() => void action(() => bridge.remove())}>Remove download</button>}
			</div>
			{status.bundled && <p>Included with this offline edition. Removing the app removes its bundled model.</p>}
		</>}
		{(error || status?.error) && <p role="alert">{error || status?.error}</p>}
	</section>;
}
