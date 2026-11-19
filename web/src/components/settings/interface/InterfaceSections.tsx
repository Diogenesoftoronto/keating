import { TEXT_SCALES, type TextScale } from "@keating/learner-contracts";
import { useEffect, useState, type ReactNode } from "react";
import {
	Segmented,
	Switch,
	SelectField,
	Prose,
	Chip,
	Eyebrow,
} from "../../../design-system/kit";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";
import { FONT_FAMILY_OPTIONS } from "../../../keating/ui-settings";
import {
	loadDeclaredProfile,
	subscribeDeclaredProfile,
	updateDeclaredProfile,
} from "../../../keating/learner-profile-store";
import { readThemePreference, saveThemePreference } from "../../../theme-sync";
import { isCanvasFeatureEnabled } from "../../../lib/feature-flags";
import {
	CompanionSetting,
	useCompanionMode,
} from "../../companion/CompanionSetting";
import { KeatingBot } from "../../KeatingBot";
import { interfaceEntries } from "../search/interface";
import { SettingRow, SavedHint } from "../ui";

function Row({ id, children }: { id: string; children: ReactNode }) {
	const entry = interfaceEntries.find((item) => item.id === id)!;
	return <SettingRow {...entry}>{children}</SettingRow>;
}
function useProfile() {
	const [profile, setProfile] = useState(loadDeclaredProfile);
	useEffect(() => subscribeDeclaredProfile(setProfile), []);
	return profile;
}
export function DisplaySettings() {
	const [settings, update] = useKeatingUiSettings();
	const profile = useProfile();
	const [theme, setTheme] = useState(readThemePreference);
	useEffect(() => {
		const sync = () => setTheme(readThemePreference());
		window.addEventListener("keating:theme", sync);
		window.addEventListener("storage", sync);
		return () => {
			window.removeEventListener("keating:theme", sync);
			window.removeEventListener("storage", sync);
		};
	}, []);
	return (
		<>
			<Row id="theme">
				<Segmented
					label="Theme"
					value={theme}
					onChange={saveThemePreference}
					options={[
						{ value: "system", label: "System" },
						{ value: "light", label: "Paper" },
						{ value: "dark", label: "Terminal" },
					]}
				/>
			</Row>
			<Row id="reply-typeface">
				<Segmented<typeof settings.replyTypeface>
					label="Reply typeface"
					value={settings.replyTypeface}
					onChange={(replyTypeface) => update({ replyTypeface })}
					options={[
						{ value: "serif", label: "Reading serif" },
						{ value: "sans", label: "Sans" },
						{ value: "mono", label: "Mono" },
					]}
				/>
			</Row>
			<Row id="font-family">
				<SelectField
					label="Font family"
					value={settings.fontFamily}
					onValueChange={(value) => {
						const option = FONT_FAMILY_OPTIONS.find((o) => o.value === value);
						if (option) update({ fontFamily: option.value });
					}}
				>
					{FONT_FAMILY_OPTIONS.map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</SelectField>
			</Row>
			<Row id="text-size">
				<Segmented<TextScale>
					label="Text size"
					value={profile.textScale || TEXT_SCALES[0]}
					onChange={(textScale) => updateDeclaredProfile({ textScale })}
					options={[
						{ value: TEXT_SCALES[0], label: "Default" },
						{ value: "large", label: "Large" },
						{ value: "larger", label: "Larger" },
					]}
				/>
			</Row>
			<Row id="contrast">
				<Switch
					labelledBy="contrast-label"
					checked={profile.highContrast}
					onChange={(highContrast) => updateDeclaredProfile({ highContrast })}
				/>
			</Row>
			<SavedHint />
		</>
	);
}
export function MotionSettings() {
	const profile = useProfile();
	const [settings, update] = useKeatingUiSettings();
	return (
		<>
			<Row id="motion-mode">
				<Segmented
					label="Motion"
					value={profile.reduceMotion ? "reduced" : "system"}
					onChange={(v) =>
						updateDeclaredProfile({ reduceMotion: v === "reduced" })
					}
					options={[
						{ value: "system", label: "Follow system" },
						{ value: "reduced", label: "Reduced" },
					]}
				/>
			</Row>
			<Row id="effects">
				<Switch
					labelledBy="effects-label"
					checked={settings.visualEffects}
					onChange={(visualEffects) => update({ visualEffects })}
				/>
			</Row>
			<SavedHint />
		</>
	);
}
export function ChatLayout() {
	const [s, update] = useKeatingUiSettings();
	if (!isCanvasFeatureEnabled())
		return <p>Materials controls are unavailable in this build.</p>;
	return (
		<>
			<Row id="materials">
				<Switch
					labelledBy="materials-label"
					checked={s.autoOpenArtifacts}
					onChange={(autoOpenArtifacts) => update({ autoOpenArtifacts })}
				/>
			</Row>
			<Row id="inline-preview">
				<Switch
					labelledBy="inline-preview-label"
					checked={s.limitInlineArtifactPreviews}
					onChange={(limitInlineArtifactPreviews) =>
						update({ limitInlineArtifactPreviews })
					}
				/>
			</Row>
			<SavedHint />
		</>
	);
}
export function CompanionSound() {
	const [s, update] = useKeatingUiSettings();
	return (
		<>
			<Row id="companion-mode">
				<CompanionSetting />
			</Row>
			<Row id="card-sounds">
				<Switch
					labelledBy="card-sounds-label"
					checked={s.flashcardSoundEnabled}
					onChange={(flashcardSoundEnabled) =>
						update({ flashcardSoundEnabled })
					}
				/>
			</Row>
			<SavedHint />
		</>
	);
}
export function InterfacePreview() {
	const mode = useCompanionMode();
	return (
		<>
			<Eyebrow>Preview</Eyebrow>
			<article>
				<Eyebrow muted>Keating</Eyebrow>
				<Prose className="st-reply-preview">
					Each paused call sits on a stack. The most recent one finishes first,
					so the <code>after</code> lines unwind in reverse.
				</Prose>
				<div>
					<Chip>Explain another way</Chip> <Chip>Quiz me</Chip>
				</div>
			</article>
			<article className="st-companion-line">
				<KeatingBot size={42} animated={mode === "lively"} label="" />
				<p>
					{mode === "off"
						? "A still avatar opens the study menu."
						: mode === "calm"
							? "Keating sits beside your message and shows when he’s working."
							: "Keating sits beside the composer and reacts to your lesson."}
				</p>
			</article>
			<p>
				This device means this browser only. Your profile is saved here and
				included in what Keating is told.
			</p>
		</>
	);
}
