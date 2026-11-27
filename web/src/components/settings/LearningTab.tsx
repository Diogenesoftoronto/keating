import { LearnerProfileTab } from "../LearnerProfileTab";
import { SpeechSettingsTab } from "../SpeechSettingsTab";
import { DesktopNeedleSettings } from "../DesktopNeedleSettings";
import { TeacherPersonaTab } from "../TeacherPersonaTab";
import { DecisionPolicySettings } from "./DecisionPolicySettings";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { Switch, TextInput } from "../../design-system/kit";
import { SettingRow, SavedHint } from "./ui";

export function LearningTab() {
	return <LearnerProfileTab />;
}

export function TeachingSection() {
	const [settings, update] = useKeatingUiSettings();
	return (
		<div className="pf-section">
			<TeacherPersonaTab />
			<SettingRow
				id="plan-approval"
				label="Ask before changing study plans"
				help="By default the tutor revises your active study plan on its own (marking a step done, adding a prerequisite, splitting a step) and tells you what changed. Turn this on to Accept or Decline each change first."
				scope="this device"
			>
				<Switch
					labelledBy="plan-approval-label"
					checked={settings.planChanges === "approval"}
					onChange={(checked) =>
						update({ planChanges: checked ? "approval" : "autonomous" })
					}
				/>
			</SettingRow>
			<SettingRow
				id="manual-reasoning"
				label="Choose the thinking level myself"
				help="By default Keating's judgement model decides how much the tutor thinks on each turn, and answers simple messages straight away. Turn this on to show the Reasoning control and use it as the ceiling."
				scope="this device"
			>
				<Switch
					labelledBy="manual-reasoning-label"
					checked={settings.manualReasoning}
					onChange={(checked) => update({ manualReasoning: checked })}
				/>
			</SettingRow>
			<SettingRow
				id="reviewed-replies"
				label="Review every reply before it appears"
				help="By default the tutor answers simple messages at once, and a slower check reads the reply in the background. If it finds a correction, a source or a useful activity, it adds a follow-up message. Turn this on to wait for planning and review before each reply instead. Answers to questions, practice and open activities are always reviewed first."
				scope="this device"
			>
				<Switch
					labelledBy="reviewed-replies-label"
					checked={settings.replyPacing === "reviewed"}
					onChange={(checked) =>
						update({ replyPacing: checked ? "reviewed" : "fast-slow" })
					}
				/>
			</SettingRow>
			<SettingRow
				id="response-comparison"
				label="Response comparison chance"
				help="Occasionally generate a second answer and ask which response helped more. The 1% default keeps comparisons useful without interrupting ordinary chats."
				scope="this device"
			>
				<label>
					<TextInput
						type="number"
						min={0}
						max={100}
						step={1}
						aria-label="Response comparison chance percent"
						value={Math.round(settings.alternativeResponseChance * 100)}
						onChange={(e) =>
							update({
								alternativeResponseChance: Math.max(
									0,
									Math.min(1, Number(e.target.value) / 100),
								),
							})
						}
					/>{" "}
					%
				</label>
			</SettingRow>
			<SavedHint />
		</div>
	);
}
export function VoiceSection() {
	return (
		<div id="settings-section-speech" className="pf-section">
			<h4>Speech and voice</h4>
			<SpeechSettingsTab hideNav />
		</div>
	);
}
export function RecallSection() {
	return (
		<div className="pf-section">
			<DesktopNeedleSettings />
			<DecisionPolicySettings />
		</div>
	);
}
