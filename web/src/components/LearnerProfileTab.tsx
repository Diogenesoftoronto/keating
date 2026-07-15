import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { css } from "../../styled-system/css";
import { outlineButton, primaryButton, textarea } from "../../styled-system/recipes";
import {
	MAX_LEARNER_CONTEXT_LENGTH,
	loadLearnerContext,
	resetLearnerContext,
	saveLearnerContext,
	subscribeLearnerContext,
} from "../keating/learner-context";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });
const descriptionClass = css({ fontSize: "0.875rem", lineHeight: "1.5rem", color: "var(--muted-foreground)" });
const fieldStackClass = css({ display: "flex", flexDirection: "column", gap: "0.5rem" });
const fieldLabelClass = css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)" });
const metaRowClass = css({ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.5rem", fontSize: "11px", color: "var(--muted-foreground)" });
const actionRowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" });
const footnoteClass = css({ fontSize: "11px", lineHeight: "1.25rem", color: "var(--muted-foreground)" });

export interface LearnerProfileStore {
	load: () => string;
	save: (context: string) => void;
	reset: () => void;
	subscribe: (listener: (context: string) => void) => () => void;
}

const browserLearnerProfileStore: LearnerProfileStore = {
	load: loadLearnerContext,
	save: saveLearnerContext,
	reset: resetLearnerContext,
	subscribe: subscribeLearnerContext,
};

export function LearnerProfileTab({ store = browserLearnerProfileStore }: { store?: LearnerProfileStore }) {
	const [draft, setDraft] = useState(() => store.load());
	const [saved, setSaved] = useState(false);
	const savedTimer = useRef<number | null>(null);

	useEffect(() => store.subscribe(setDraft), [store]);
	useEffect(() => () => {
		if (savedTimer.current) window.clearTimeout(savedTimer.current);
	}, []);

	const stored = store.load();
	const dirty = draft.trim() !== stored;

	const flashSaved = useCallback(() => {
		setSaved(true);
		if (savedTimer.current) window.clearTimeout(savedTimer.current);
		savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
	}, []);

	const handleSave = useCallback(() => {
		store.save(draft);
		flashSaved();
	}, [draft, flashSaved, store]);

	const handleReset = useCallback(() => {
		store.reset();
		setDraft("");
		flashSaved();
	}, [flashSaved, store]);

	return (
		<div className={stackClass}>
			<p className={descriptionClass}>
				Tell Keating what helps it teach you well: your goals, existing knowledge, interests, preferred examples, languages, or accessibility needs. This stays in this browser.
			</p>
			<div className={fieldStackClass}>
				<label htmlFor="learner-profile" className={fieldLabelClass}>About you</label>
				<textarea
					id="learner-profile"
					className={textarea()}
					value={draft}
					maxLength={MAX_LEARNER_CONTEXT_LENGTH}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="I am learning for… I already know… I learn best with… I am interested in…"
				/>
				<div className={metaRowClass}>
					<span>{draft.length} / {MAX_LEARNER_CONTEXT_LENGTH} characters</span>
					<span>{stored ? "Saved learner context" : "No learner context yet"}</span>
				</div>
			</div>
			<div className={actionRowClass}>
				<button type="button" onClick={handleSave} disabled={!dirty} className={primaryButton()}>
					{saved ? <Check size={15} /> : <Save size={15} />}
					{saved ? "Saved" : "Save about you"}
				</button>
				<button type="button" onClick={handleReset} disabled={!draft && !stored} className={outlineButton()}>
					<RotateCcw size={14} />
					Clear profile
				</button>
			</div>
			<p className={footnoteClass}>Changes apply to the current conversation on the next message and to every new session.</p>
		</div>
	);
}
