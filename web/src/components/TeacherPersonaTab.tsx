import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import {
	DEFAULT_TEACHER_PERSONA,
	isDefaultPersona,
	loadPersona,
	resetPersona,
	savePersona,
	subscribePersona,
} from "../keating/persona";

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
		<div className="flex flex-col gap-5">
			<div>
				<h3 className="mb-2 text-sm font-semibold text-foreground">Teacher Persona</h3>
				<p className="text-sm text-muted-foreground">
					This is the editable identity and voice of your tutor — the "who" of the
					system prompt. It defaults to John Keating from <em>Dead Poets Society</em>.
					The agent's tools and teaching protocol are kept separate and always apply.
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<label htmlFor="teacher-persona" className="text-xs font-medium text-muted-foreground">
					Persona
				</label>
				<textarea
					id="teacher-persona"
					className="min-h-[280px] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary"
					value={draft}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					placeholder="Describe who the teacher is, their values, and their voice…"
				/>
				<div className="flex items-center justify-between text-[11px] text-muted-foreground">
					<span>{draft.trim().length} characters</span>
					<span>{isDefault ? "Default persona" : "Custom persona"}</span>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={handleSave}
					disabled={!dirty}
					className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{saved ? <Check size={15} /> : <Save size={15} />}
					{saved ? "Saved" : "Save persona"}
				</button>
				<button
					type="button"
					onClick={handleReset}
					disabled={isDefault && !dirty}
					className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
				>
					<RotateCcw size={14} />
					Reset to John Keating
				</button>
			</div>

			<p className="text-[11px] leading-5 text-muted-foreground">
				Changes apply to the current conversation on the next message, and to all new sessions.
			</p>
		</div>
	);
}
