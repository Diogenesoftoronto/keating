import { useEffect, useState } from "react";
import type { WebTrainingArchive } from "../../keating/training-archive";

export function TrainingDatasetShare({ archive, recordCount, redacted }: { archive: WebTrainingArchive | null; recordCount: number; redacted: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const [consent, setConsent] = useState(false);
	const [sending, setSending] = useState(false);
	const [receipt, setReceipt] = useState<{ id: string; createdAt: string } | null>(null);
	const [error, setError] = useState("");
	useEffect(() => { setConsent(false); setReceipt(null); setError(""); }, [archive]);
	async function share() {
		if (!archive || !consent || sending) return;
		setSending(true); setError("");
		try {
			const response = await fetch("/api/training-datasets", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/zip", "X-Keating-Training-Consent": "global-improvement-v1" }, body: new Blob([new Uint8Array(archive.bytes)], { type: "application/zip" }) });
			const body = await response.json().catch(() => null);
			if (!response.ok) throw new Error(response.status === 401 ? "Sign in to your Keating account before sharing." : response.status === 503 ? "Dataset sharing is not configured on this server yet. Your local dataset is unchanged." : response.status === 413 ? "This dataset exceeds the server upload limit. Reduce the record limit and try again." : "The server did not accept this dataset. Your local download is still available.");
			if (!body || typeof body.id !== "string" || typeof body.createdAt !== "string") throw new Error("No valid storage receipt was returned. Sharing is unconfirmed.");
			setReceipt(body); setConsent(false);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed. Your local dataset is unchanged."); }
		finally { setSending(false); }
	}
	return <section className="training-share"><button type="button" className="training-secondary" disabled={!archive || sending} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Share with Keating</button>{expanded && <div><h3>Contribute to Keating’s improvement</h3><p>This sends the current dataset ZIP to Keating’s server for storage and use in improving Keating globally. It includes {recordCount} records, summaries, review notes, scoring metadata, and any source snapshot in the ZIP.</p><p>{redacted ? "Pattern-based secret redaction is enabled; inspect the records and notes for personal information before sharing." : "This dataset is unredacted. Inspect it for credentials and personal information before sharing."}</p><label className="training-check"><input type="checkbox" checked={consent} disabled={sending} onChange={event => setConsent(event.target.checked)}/><span>I have permission to share this data and agree to its storage and use for improving Keating globally.</span></label><button type="button" className="training-primary" disabled={!consent || sending || !archive} onClick={() => void share()}>{sending ? "Uploading…" : "Send dataset to Keating"}</button></div>}<div aria-live="polite">{receipt && <p>Stored by Keating · receipt {receipt.id} · {new Date(receipt.createdAt).toLocaleString()}</p>}{error && <p role="alert">{error}</p>}</div></section>;
}
