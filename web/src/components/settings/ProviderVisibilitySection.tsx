import { Toggle } from "../Toggle";
import type { ModelPrefs } from "../../keating/model-prefs";

export function ProviderVisibilitySection({
	providers,
	modelPrefs,
	onToggle,
}: {
	providers: string[];
	modelPrefs: ModelPrefs;
	onToggle: (provider: string, hidden: boolean) => void;
}) {
	return (
		<div id="settings-section-provider-visibility" className="flex flex-col gap-4 scroll-mt-20">
			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Provider Visibility</h3>
				<p className="text-sm text-muted-foreground">
					Hide providers you don't use to declutter the model selector.
				</p>
			</div>
			<div className="flex flex-col gap-3">
				{providers.map((provider) => {
					const hidden = modelPrefs.hiddenProviders.includes(provider);
					return (
						<div key={provider} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
							<div className="text-sm font-medium text-foreground capitalize">{provider}</div>
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