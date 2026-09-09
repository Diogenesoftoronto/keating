import { css } from "../../../styled-system/css";
import { settingsCard } from "../../../styled-system/recipes";
import { Toggle } from "../Toggle";
import type { ModelPrefs } from "../../keating/model-prefs";

const sectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const sectionDescriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const rowStackClass = css({ display: "flex", flexDirection: "column", gap: "0.75rem" });
const providerLabelClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)", textTransform: "capitalize" });
const actionButtonClass = css({
	alignSelf: "flex-start",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
});

export function ProviderVisibilitySection({
	providers,
	modelPrefs,
	onToggle,
	onSetAllHidden,
}: {
	providers: string[];
	modelPrefs: ModelPrefs;
	onToggle: (provider: string, hidden: boolean) => void;
	onSetAllHidden: (hidden: boolean) => void;
}) {
	const visibleCount = providers.filter((provider) => !modelPrefs.hiddenProviders.includes(provider)).length;
	const allHidden = providers.length > 0 && visibleCount === 0;
	return (
		<div id="settings-section-provider-visibility" className={sectionClass}>
			<div>
				<h3 className={sectionTitleClass}>Provider Visibility</h3>
				<p className={sectionDescriptionClass}>
					Hide all providers, then enable only the ones you use.
				</p>
			</div>
			<button type="button" className={actionButtonClass} onClick={() => onSetAllHidden(!allHidden)}>
				{allHidden ? "Show all providers" : "Hide all providers"}
			</button>
			<div className={rowStackClass}>
				{providers.map((provider) => {
					const hidden = modelPrefs.hiddenProviders.includes(provider);
					return (
						<div key={provider} className={settingsCard({ tone: "subtle" })}>
							<div className={providerLabelClass}>{provider}</div>
							<Toggle
								tone="success"
								aria-label={hidden ? "Hidden" : "Visible"}
								checked={!hidden}
								onChange={(checked) => onToggle(provider, !checked)}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
