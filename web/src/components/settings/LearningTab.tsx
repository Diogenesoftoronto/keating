import { css } from "../../../styled-system/css";
import { settingsSection } from "../../../styled-system/recipes";
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

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const sectionAnchorClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)" });
const subSectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });

/**
 * "Learning" settings tab: everything that shapes the tutoring experience —
 * who the teacher is (persona) and how it speaks (speech & voice).
 * Composes the existing tab components; one merged section nav on top.
 */
export function LearningTab({ onSpeechSettingsChange }: LearningTabProps) {
	return (
		<div className={stackClass}>
			<SettingsSectionNav
				sections={[{ id: "persona", label: "Persona" }, ...SPEECH_SECTIONS]}
			/>

			<div id="settings-section-persona" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Teacher Persona</h3>
				<TeacherPersonaTab />
			</div>

			<div className={settingsSection()}>
				<h3 className={sectionTitleClass}>Speech &amp; Voice</h3>
				<SpeechSettingsTab hideNav onSettingsChange={onSpeechSettingsChange} />
			</div>

			<div className={subSectionClass} />
		</div>
	);
}
