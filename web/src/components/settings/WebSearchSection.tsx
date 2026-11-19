import { Switch } from "../../design-system/kit";
import type { KeatingUiSettings } from "../../keating/ui-settings";
import { SettingRow } from "./ui";

export function WebSearchSwitch({
	settings,
	onPatch,
	labelledBy,
}: {
	settings: KeatingUiSettings;
	onPatch: (patch: Partial<KeatingUiSettings>) => void;
	labelledBy: string;
}) {
	return (
		<Switch
			labelledBy={labelledBy}
			checked={settings.webSearch === "auto"}
			onChange={(enabled) => onPatch({ webSearch: enabled ? "auto" : "off" })}
		/>
	);
}

export function WebSearchSection({
	settings,
	onPatch,
}: {
	settings: KeatingUiSettings;
	onPatch: (patch: Partial<KeatingUiSettings>) => void;
}) {
	return (
		<SettingRow
			id="settings-section-web-search"
			label="Automatic web search"
			scope="this device"
			help="Use native search with your Codex login, Google Search grounding on Gemini, hosted search on OpenAI Responses models, and server-side search on Claude. When the active model has no search, Keating can use a configured OpenAI, Gemini, or Anthropic key as an auxiliary search provider."
		>
			<WebSearchSwitch
				labelledBy="settings-section-web-search-label"
				settings={settings}
				onPatch={onPatch}
			/>
		</SettingRow>
	);
}
