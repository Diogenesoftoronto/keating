import type { ReasoningLevel } from "../../../keating/ui-settings";
import { Select } from "../../Select";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";
import { SettingRow } from "../ui";
const REASONING_LEVELS: {
	value: ReasoningLevel;
	label: string;
	description: string;
}[] = [
	{
		value: "off",
		label: "Off",
		description: "Fastest responses, no reasoning tokens",
	},
	{ value: "minimal", label: "Minimal", description: "Brief internal checks" },
	{
		value: "low",
		label: "Low",
		description: "Light reasoning for simple tasks",
	},
	{ value: "medium", label: "Medium", description: "Balanced depth and speed" },
	{
		value: "high",
		label: "High",
		description: "Deeper analysis for complex questions",
	},
	{
		value: "xhigh",
		label: "Extra high",
		description: "Extended reasoning for difficult questions",
	},
	{
		value: "max",
		label: "Maximum",
		description: "Most thorough reasoning (select models only)",
	},
];

export function ModelReasoning() {
	const [settings, update] = useKeatingUiSettings();
	return (
		<SettingRow
			id="settings-section-ui-reasoning"
			label="Reasoning level"
			help="Set how much the model thinks before responding. Higher levels produce more thorough answers but take longer."
			scope="new chats"
		>
			<Select
				aria-labelledby="settings-section-ui-reasoning-label"
				value={settings.reasoningLevel}
				onValueChange={(v) =>
					update({ reasoningLevel: v as typeof settings.reasoningLevel })
				}
			>
				{REASONING_LEVELS.map((level) => (
					<option value={level.value} key={level.value}>
						{level.label} · {level.description}
					</option>
				))}
			</Select>
		</SettingRow>
	);
}
