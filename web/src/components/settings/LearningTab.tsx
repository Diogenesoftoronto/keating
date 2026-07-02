import { SettingsSectionNav } from "../SettingsSectionNav";
import { TeacherPersonaTab } from "../TeacherPersonaTab";
import {
	SPEECH_SECTIONS,
	SpeechSettingsTab,
} from "../SpeechSettingsTab";
import type { WebSpeechSettings } from "../../keating/speech";

interface LearningTabProps {
	onSpeechSettingsChange?: (settings: WebSpeechSettings) => void;
}

/**
 * "Learning" settings tab: everything that shapes the tutoring experience —
 * who the teacher is (persona) and how it speaks (speech & voice).
 * Composes the existing tab components; one merged section nav on top.
 */
export function LearningTab({ onSpeechSettingsChange }: LearningTabProps) {
	return (
		<div className="flex flex-col gap-8">
			<SettingsSectionNav
				sections={[{ id: "persona", label: "Persona" }, ...SPEECH_SECTIONS]}
			/>

			<div id="settings-section-persona" className="flex flex-col gap-4 scroll-mt-20">
				<h3 className="text-base font-semibold text-foreground">Teacher Persona</h3>
				<TeacherPersonaTab />
			</div>

			<div className="flex flex-col gap-4">
				<h3 className="text-base font-semibold text-foreground">Speech &amp; Voice</h3>
				<SpeechSettingsTab hideNav onSettingsChange={onSpeechSettingsChange} />
			</div>
		</div>
	);
}
