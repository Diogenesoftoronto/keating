import { Switch, Button } from "../../../design-system/kit";
import { SettingRow } from "../ui";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";
import "./data.css";

const developerSwitches = [
	["showReasoning", "Show reasoning", "Keep a Reasoning control available inside chat messages."],
	["showToolUi", "Show tool details", "Show tool arguments and results. Compact status stays visible when this is off."],
	["autoExpandReasoning", "Auto-open reasoning", "Start each Reasoning disclosure expanded."],
	["showRawErrors", "Show raw error details", "Show full error messages and response bodies in tool failures."],
] as const;

export function DeveloperTools() {
	const [settings, update] = useKeatingUiSettings();
	return <div className="sd-dev">
		<SettingRow id="showDeveloperDetails" label="Developer chat details" scope="this device" help="Show draft reviews, reasoning and technical tool details in chat.">
			<Switch labelledBy="showDeveloperDetails-label" checked={settings.showDeveloperDetails} onChange={showDeveloperDetails => update({ showDeveloperDetails })}/>
		</SettingRow>
		<div className="sd-dependents">
			{developerSwitches.map(([key, label, help]) => {
				const why = !settings.showDeveloperDetails ? "Turn on Developer chat details first."
					: key === "autoExpandReasoning" && !settings.showReasoning ? "Turn on Show reasoning first." : undefined;
				return <SettingRow key={key} id={key} label={label} help={help} scope="this device" why={why}>
					<Switch labelledBy={key + "-label"} checked={!why && settings[key]} disabled={!!why} onChange={checked => update({ [key]: checked })}/>
				</SettingRow>;
			})}
		</div>
		<SettingRow id="sd-reasoning-default" label="Reasoning level" scope="new chats" help="Change it for this chat from the composer.">
			<Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent("keating:settings-tab", { detail: "models.jobs" }))}>{settings.reasoningLevel} · Model settings</Button>
		</SettingRow>
	</div>;
}
