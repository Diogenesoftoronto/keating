import { Segmented } from "../../design-system/kit";
import { KeatingBot } from "../KeatingBot";
import "./companion-setting.css";
import { useSyncExternalStore } from "react";
import { subscribeStoredPreference } from "../../lib/stored-preference";
export type CompanionMode = "lively" | "calm" | "off";
export const preferenceKey = "keating.companion.mode.v1";
const changed = "keating:companion-mode-changed";
export function readMode(store?: Pick<Storage, "getItem">): CompanionMode {
	try {
		const value = (store ?? window.localStorage).getItem(preferenceKey);
		if (value === "calm" || value === "off") return value;
	} catch {
		/* Private browsing or server render. */
	}
	return "lively";
}
export function saveMode(
	mode: CompanionMode,
	store?: Pick<Storage, "setItem">,
) {
	try {
		(store ?? window.localStorage).setItem(preferenceKey, mode);
	} catch {
		return;
	}
	if (typeof window !== "undefined") window.dispatchEvent(new Event(changed));
}
const subscribe = subscribeStoredPreference(preferenceKey, changed);
export function useCompanionMode() {
	return useSyncExternalStore(subscribe, readMode, () => "lively" as const);
}
const choices = [
	["lively", "Lively", "Pick Keating up and see him react to your lesson."],
	[
		"calm",
		"Calm",
		"Keating sits beside your message and shows when he’s working.",
	],
	["off", "Off", "A still avatar opens the study menu."],
] as const;
export function CompanionSetting() {
	const mode = useCompanionMode();
	return (
		<div className="companion-setting">
			<KeatingBot size={36} label="" animated={mode === "lively"} />
			<div>
				<Segmented
					label="Companion"
					value={mode}
					onChange={saveMode}
					options={choices.map(([value, label, hint]) => ({
						value,
						label,
						hint,
					}))}
				/>
			</div>
		</div>
	);
}
