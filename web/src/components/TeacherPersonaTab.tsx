import { useCallback, useContext, useEffect, useState } from "react";
import { Button, ConfirmDialog, TextArea } from "../design-system/kit";
import { SettingsStatusContext, SettingsSection } from "./settings/ui";
import {
	DEFAULT_TEACHER_PERSONA,
	isDefaultPersona,
	loadPersona,
	resetPersona,
	savePersona,
	subscribePersona,
} from "../keating/persona";

// The shell owns this callback for one open dialog. Keep its unsaved persona
// available to the shell's Save action while another section is mounted.
const drafts = new WeakMap<object, string>();

export function TeacherPersonaTab() {
	const report = useContext(SettingsStatusContext);
	const [stored, setStored] = useState(loadPersona);
	const [draft, setDraft] = useState(() => drafts.get(report) ?? stored);
	const [confirm, setConfirm] = useState(false);
	const [notice, setNotice] = useState("");
	useEffect(
		() =>
			subscribePersona((next) => {
				setStored(next);
				if (!drafts.has(report)) setDraft(next);
			}),
		[report],
	);
	const dirty = draft.trim() !== stored.trim();
	const save = useCallback(() => {
		drafts.delete(report);
		savePersona(draft.trim() || DEFAULT_TEACHER_PERSONA);
		report("teaching");
		setDraft(loadPersona());
		setStored(loadPersona());
		setNotice("Persona saved");
	}, [report, draft]);
	useEffect(() => {
		if (dirty) {
			drafts.set(report, draft);
			report("teaching", { count: 1, save });
		} else {
			drafts.delete(report);
			report("teaching");
		}
	}, [report, dirty, draft, save]);
	return (
		<div id="settings-section-persona">
			<SettingsSection
				title="Teacher persona"
				description="This is the editable identity and voice of your tutor. It defaults to John Keating from Dead Poets Society. The agent’s tools and teaching protocol always apply."
			>
				<label htmlFor="pf-persona">Persona</label>
				<TextArea
					id="pf-persona"
					rows={8}
					value={draft}
					spellCheck={false}
					onChange={(e) => {
						setDraft(e.target.value);
						setNotice("");
					}}
					placeholder="Describe who the teacher is, their values, and their voice…"
				/>
				<small>
					{draft.trim().length} characters ·{" "}
					{isDefaultPersona(draft) ? "Default persona" : "Custom persona"}
				</small>
				<div className="pf-persona-actions">
					<Button
						variant="ghost"
						disabled={isDefaultPersona(draft) && !dirty}
						onClick={() => setConfirm(true)}
					>
						Reset to John Keating
					</Button>
					<Button variant="primary" disabled={!dirty} onClick={save}>
						Save persona
					</Button>
				</div>
				<p>
					Changes apply to the current conversation on the next message, and to
					all new sessions.
				</p>
				<span role="status">{notice}</span>
				<ConfirmDialog
					open={confirm}
					title="Reset to John Keating?"
					description="Replace your custom teacher persona with the default."
					confirmLabel="Reset to John Keating"
					onCancel={() => setConfirm(false)}
					onConfirm={() => {
						drafts.delete(report);
						resetPersona();
						setStored(loadPersona());
						setDraft(loadPersona());
						setConfirm(false);
						setNotice("Default persona restored");
					}}
				/>
			</SettingsSection>
		</div>
	);
}
