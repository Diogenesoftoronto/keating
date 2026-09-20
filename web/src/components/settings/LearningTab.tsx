import { css } from "../../../styled-system/css";
import { settingsSection } from "../../../styled-system/recipes";
import { outlineButton } from "../../../styled-system/recipes";
import { Compass } from "lucide-react";
import { SettingsSectionNav } from "../SettingsSectionNav";
import { TeacherPersonaTab } from "../TeacherPersonaTab";
import { DesktopNeedleSettings } from "../DesktopNeedleSettings";
import { DecisionPolicySettings } from "./DecisionPolicySettings";
import { LEARNER_PROFILE_SECTIONS, LearnerProfileTab } from "../LearnerProfileTab";
import {
	SPEECH_SECTIONS,
	SpeechSettingsTab,
} from "../SpeechSettingsTab";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const sectionAnchorClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)" });
const subSectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem" });
const tourRowClass = css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" });
const tourCopyClass = css({ fontSize: "0.875rem", lineHeight: "1.25rem", color: "var(--muted-foreground)", maxWidth: "36rem" });

/**
 * "Learning" settings tab: everything that shapes the tutoring experience —
 * who the teacher is (persona) and how it speaks (speech & voice).
 * Composes the existing tab components; one merged section nav on top.
 */
export function LearningTab({ onStartTour }: { onStartTour?: () => void } = {}) {
	return (
		<div className={stackClass}>
			<SettingsSectionNav
				sections={[...LEARNER_PROFILE_SECTIONS, { id: "persona", label: "Persona" }, ...SPEECH_SECTIONS]}
			/>

			{onStartTour && (
				<div className={tourRowClass}>
					<p className={tourCopyClass}>
						Forgotten where something lives? Keating can walk you through the chat interface again.
					</p>
					<button type="button" className={outlineButton()} onClick={onStartTour}>
						<Compass size={14} />
						Show me around
					</button>
				</div>
			)}

			<div className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Your profile</h3>
				<LearnerProfileTab />
			</div>

			<div id="settings-section-persona" className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Teacher Persona</h3>
				<TeacherPersonaTab />
			</div>

			<DesktopNeedleSettings />
			<DecisionPolicySettings />

			<div className={settingsSection()}>
				<h3 className={sectionTitleClass}>Speech &amp; Voice</h3>
				<SpeechSettingsTab hideNav />
			</div>

			<div className={subSectionClass} />
		</div>
	);
}
