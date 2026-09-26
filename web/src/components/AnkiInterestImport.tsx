import { useRef, useState } from "react";
import type { ProfileProposal } from "@keating/learner-contracts";
import { getInitPromise, keatingStorage } from "../hooks/keating-storage";
import { describeAnkiImport, importAnkiForOnboarding, type OnboardingDeckStore } from "../keating/onboarding-anki-import";
import { KeatingBot } from "./KeatingBot";
import "./anki-interest-import.css";

/**
 * The optional Anki door in onboarding.
 *
 * Offered, never required, and never the first thing asked — a learner without
 * a collection should be able to ignore this entirely. The cards land in the
 * SRS immediately, because that is what "import my decks" means and the learner
 * asked for it by picking the file. The interests do not: they go back to the
 * caller as proposals for the same review card everything else passes through.
 */

export interface AnkiInterestImportProps {
	/** Called with interest proposals once the decks are in. May be empty. */
	onImported: (proposals: readonly ProfileProposal[]) => void;
	/** Overridable for tests; defaults to the app's deck storage. */
	store?: OnboardingDeckStore;
}

export function AnkiInterestImport({ onImported, store }: AnkiInterestImportProps) {
	const input = useRef<HTMLInputElement | null>(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const [error, setError] = useState("");

	const run = async (file: File) => {
		setBusy(true);
		setError("");
		setStatus("Reading your collection…");
		try {
			if (!store) await getInitPromise();
			const result = await importAnkiForOnboarding(
				{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				{ store: store ?? keatingStorage as unknown as OnboardingDeckStore },
			);
			setStatus(describeAnkiImport(result));
			onImported(result.proposals);
		} catch (cause) {
			// The parser's own wording is more useful than anything added here.
			setError(cause instanceof Error ? cause.message : "That file could not be read as an Anki collection.");
			setStatus("");
		} finally {
			setBusy(false);
		}
	};

	return <section className="anki-import">
		<KeatingBot size={56} state={busy ? "importing" : "greeting"} label="" />
		<div className="anki-import__body">
			<p className="anki-import__ask">Do you use Anki?</p>
			<p>Bring your decks and they keep their scheduling. What you have been drilling also tells me what you study — I will show you what I read from it before anything is kept.</p>
			{status && <p className="anki-import__status" role="status">{status}</p>}
			{error && <p className="anki-import__error" role="alert">{error}</p>}
			<input
				ref={input}
				type="file"
				className="anki-import__file"
				accept=".apkg,.txt,.csv,.tsv"
				onChange={event => {
					const file = event.target.files?.[0];
					// Clearing the value lets the same file be picked again after a failure.
					event.target.value = "";
					if (file) void run(file);
				}}
			/>
			<button type="button" className="chat-onboarding__secondary" disabled={busy} onClick={() => input.current?.click()}>
				{busy ? "Importing…" : "Choose an .apkg file"}
			</button>
		</div>
	</section>;
}
