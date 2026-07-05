import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { css } from "../../styled-system/css";
import { primaryButton, outlineButton, textarea } from "../../styled-system/recipes";
import {
	DEFAULT_TEACHER_PERSONA,
	isDefaultPersona,
	loadPersona,
	resetPersona,
	savePersona,
	subscribePersona,
} from "../keating/persona";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1.25rem" });
const headerClass = css({ display: "flex", flexDirection: "column", gap: "0.25rem" });
const titleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const descriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const fieldStackClass = css({ display: "flex", flexDirection: "column", gap: "0.5rem" });
const fieldLabelClass = css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)" });
const metaRowClass = css({ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", color: "var(--muted-foreground)" });
const actionRowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" });
const footnoteClass = css({ fontSize: "11px", lineHeight: "1.25rem", color: "var(--muted-foreground)" });

export function TeacherPersonaTab() {
	const [draft, setDraft] = useState(() => loadPersona());
	const [saved, setSaved] = useState(false);
	const savedTimer = useRef<number | null>(null);

	// Reflect external changes (e.g. reset from another tab/window).
	useEffect(() => subscribePersona((persona) => setDraft(persona)), []);

	useEffect(() => {
		return () => {
			if (savedTimer.current) window.clearTimeout(savedTimer.current);
		};
	}, []);

	const stored = loadPersona();
	const dirty = draft.trim() !== stored.trim();
	const isDefault = isDefaultPersona(draft);

	const flashSaved = useCallback(() => {
		setSaved(true);
		if (savedTimer.current) window.clearTimeout(savedTimer.current);
		savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
	}, []);

	const handleSave = useCallback(() => {
		savePersona(draft.trim().length > 0 ? draft : DEFAULT_TEACHER_PERSONA);
		flashSaved();
	}, [draft, flashSaved]);

	const handleReset = useCallback(() => {
		resetPersona();
		setDraft(DEFAULT_TEACHER_PERSONA);
		flashSaved();
	}, [flashSaved]);

	return (
		<div className={stackClass}>
			<div className={headerClass}>
				<h3 className={titleClass}>Teacher Persona</h3>
				<p className={descriptionClass}>
					This is the editable identity and voice of your tutor — the "who" of the
					system prompt. It defaults to John Keating from <em>Dead Poets Society</em>.
					The agent's tools and teaching protocol are kept separate and always apply.
				</p>
			</div>

			<div className={fieldStackClass}>
				<label htmlFor="teacher-persona" className={fieldLabelClass}>
					Persona
				</label>
				<textarea
					id="teacher-persona"
					className={textarea()}
					value={draft}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					placeholder="Describe who the teacher is, their values, and their voice…"
				/>
				<div className={metaRowClass}>
					<span>{draft.trim().length} characters</span>
					<span>{isDefault ? "Default persona" : "Custom persona"}</span>
				</div>
			</div>

			<div className={actionRowClass}>
				<button
					type="button"
					onClick={handleSave}
					disabled={!dirty}
					className={primaryButton()}
				>
					{saved ? <Check size={15} /> : <Save size={15} />}
					{saved ? "Saved" : "Save persona"}
				</button>
				<button
					type="button"
					onClick={handleReset}
					disabled={isDefault && !dirty}
					className={outlineButton()}
				>
					<RotateCcw size={14} />
					Reset to John Keating
				</button>
			</div>

			<p className={footnoteClass}>
				Changes apply to the current conversation on the next message, and to all new sessions.
			</p>
		</div>
	);
}
