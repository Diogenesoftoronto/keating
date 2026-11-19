import { useRef, useState, type ReactNode } from "react";
import { usePostHog } from "@posthog/react";
import { Button, ButtonLink, Chip, Loading } from "../../design-system/kit";
import { downloadTextFile } from "../../lib/browser-download";
import { ExportSheet } from "./ExportSheet";
import "./export.css";

const format = (count: number) => count.toLocaleString();

function DataRow({ name, detail, format, children }: { name: string; detail: string; format: string; children: ReactNode }) {
	return <li id={"sd-" + name.toLowerCase().replaceAll(" ", "-")} tabIndex={-1}><div><strong>{name}</strong><small>{detail}</small></div><Chip>{format}</Chip>{children}</li>;
}

export function YourDataSection() {
	const posthog = usePostHog();
	const fileInput = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState<"export" | "import" | null>(null);
	const [exportOpen, setExportOpen] = useState(false);
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");
	async function transfer(file?: File) {
		const action = file ? "import" : "export";
		setBusy(action);
		setStatus("");
		setError("");
		try {
			const portable = await import("../../keating/portable-data");
			if (file) {
				const bundle = portable.parseKeatingPortableDataBundle(JSON.parse(await file.text()));
				const imported = await portable.importKeatingPortableDataBundle(bundle);
				const artifacts = imported.lessonPlans + imported.lessonMaps + imported.animations + imported.verifications
					+ imported.benchmarks + imported.evolutions + imported.promptEvolutions + imported.improvements + imported.quizResults;
				setStatus(`Imported ${format(imported.sessions)} sessions, ${format(imported.feedback)} feedback records, ${format(artifacts)} artifacts, ${format(imported.goals)} goals, and ${format(imported.sandboxCommitsImported)} sandbox commits.`);
				posthog?.capture("portable_data_imported", { success: true, session_count: imported.sessions, feedback_count: imported.feedback, sandbox_commit_count: imported.sandboxCommitsImported });
			} else {
				const bundle = await portable.buildKeatingPortableDataBundle({ includeSandbox: true });
				downloadTextFile("keating-portable-data.json", JSON.stringify(bundle, null, 2) + "\n");
				setExportOpen(false);
				setStatus(`Exported ${format(bundle.sessions.length)} sessions and ${format(bundle.storage.feedback.length)} feedback records.`);
				posthog?.capture("portable_data_exported", { success: true, include_sandbox: true, session_count: bundle.sessions.length, feedback_count: bundle.storage.feedback.length });
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			posthog?.capture(file ? "portable_data_imported" : "portable_data_exported", { success: false, failure_type: cause instanceof Error ? cause.name : "unknown" });
		} finally { setBusy(null); }
	}
	return <section className="export-data" aria-labelledby="export-data-title">
		<h3 id="export-data-title">Your data</h3>
		<ul>
			<DataRow name="Everything on this device" detail="Sessions, learner state, materials, goals and sandbox history" format="JSON">
				<Button variant="ghost" disabled={!!busy} busy={busy === "export"} onClick={() => { setError(""); setExportOpen(true); }}>{busy === "export" ? <Loading size="inline" label="Exporting"/> : "Export"}</Button>
			</DataRow>
			<DataRow name="A session review" detail="Session turns, notes, rubric scores and rewrites" format="ZIP"><ButtonLink href="/review" variant="ghost">Open reviews</ButtonLink></DataRow>
			<DataRow name="A training dataset" detail="Filtered records, training examples and a README" format="ZIP"><ButtonLink href="/training-data" variant="ghost">Prepare</ButtonLink></DataRow>
			<DataRow name="Materials from your sessions" detail="Plans, maps and decks, individually or together" format="MD · SVG · JSON"><ButtonLink href="/chat?materials=1" variant="ghost">Open materials</ButtonLink></DataRow>
			<DataRow name="Flashcards" detail="Review decks for Anki" format="APKG · TSV"><ButtonLink href="/coming-up" variant="ghost">Open decks</ButtonLink></DataRow>
			<DataRow name="Room transcripts" detail="Export from a room’s People panel" format="Markdown"><ButtonLink href="/rooms" variant="ghost">Open rooms</ButtonLink></DataRow>
			<DataRow name="Bring data in" detail="Import a portable Keating file. Matching sessions and records are replaced, and learner history is merged." format="JSON">
				<Button variant="ghost" disabled={!!busy} busy={busy === "import"} onClick={() => fileInput.current?.click()}>{busy === "import" ? <Loading size="inline" label="Importing"/> : "Import"}</Button>
			</DataRow>
		</ul>
		{exportOpen && <ExportSheet open title="Export your data" onClose={() => { if (!busy) setExportOpen(false); }}
			included="Sessions, learner state, feedback, materials, goals and available sandbox history on this device."
			excluded="Data saved only in another browser and account sign-in settings."
			format="Portable Keating JSON" destination="Your downloads folder. Nothing is uploaded."
			confirmLabel="Export" busyLabel="Exporting…" busy={busy === "export"} error={error || undefined} onConfirm={() => transfer()}/>}
		<input hidden type="file" aria-label="Import portable JSON" accept=".json,application/json" ref={fileInput} onChange={event => {
			const file = event.currentTarget.files?.[0];
			event.currentTarget.value = "";
			if (file) void transfer(file);
		}}/>
		<p role="status">{status}</p>{error && !exportOpen && <p role="alert">{error}</p>}
	</section>;
}
