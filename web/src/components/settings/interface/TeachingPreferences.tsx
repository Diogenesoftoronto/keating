import { Toggle } from "../../Toggle";
import { SettingRow } from "../../SettingRow";

import { css } from "../../../../styled-system/css";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";

const stackClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "1.5rem",
});
const mutedSmallClass = css({
	fontSize: "0.875rem",
	color: "var(--muted-foreground)",
});

export function TeachingPreferences() {
	const [settings, update] = useKeatingUiSettings();
	return (
		<div className={stackClass}>
			<SettingRow
				title="Ask before changing study plans"
				description="By default the tutor revises your active study plan on its own (marking a step done, adding a prerequisite, splitting a step) and tells you what changed. Turn this on to Accept or Decline each change first."
			>
				<Toggle
					checked={settings.planChanges === "approval"}
					onChange={(checked) =>
						update({ planChanges: checked ? "approval" : "autonomous" })
					}
				/>
			</SettingRow>
			<SettingRow
				title="Response comparison chance"
				description="Occasionally generate a second answer and ask which response helped more. The 1% default keeps comparisons useful without interrupting ordinary chats."
			>
				<label
					className={css({
						display: "flex",
						alignItems: "center",
						gap: "0.5rem",
					})}
				>
					<input
						type="number"
						min={0}
						max={100}
						step={1}
						className={css({
							height: "2.25rem",
							width: "4rem",
							borderRadius: "0.375rem",
							border: "1px solid var(--border)",
							backgroundColor: "var(--background)",
							paddingInline: "0.5rem",
							fontSize: "0.875rem",
							color: "var(--foreground)",
						})}
						value={Math.round(settings.alternativeResponseChance * 100)}
						onChange={(event) =>
							update({
								alternativeResponseChance: Math.max(
									0,
									Math.min(1, Number(event.target.value) / 100),
								),
							})
						}
						aria-label="Response comparison chance percent"
					/>
					<span className={mutedSmallClass}>%</span>
				</label>
			</SettingRow>
		</div>
	);
}
