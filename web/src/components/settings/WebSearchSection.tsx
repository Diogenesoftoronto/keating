import { Toggle } from "../Toggle";
import type { KeatingUiSettings } from "../../keating/ui-settings";

export function WebSearchSection({
	settings,
	onPatch,
}: {
	settings: KeatingUiSettings;
	onPatch: (patch: Partial<KeatingUiSettings>) => void;
}) {
	return (
		<div id="settings-section-web-search" className="flex flex-col gap-4 scroll-mt-20">
			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Web Search</h3>
				<p className="text-sm text-muted-foreground">
					Let keyed chats use each provider's own web search: Google Search grounding on Gemini, the hosted <code>web_search</code> tool on OpenAI Responses models, and Anthropic's server-side <code>web_search</code> on Claude. Applies automatically when the active model and key support it.
				</p>
			</div>
			<div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
				<div>
					<div className="text-sm font-medium text-foreground">Provider-native web search</div>
					<div className="text-xs text-muted-foreground">Enables Gemini grounding plus OpenAI and Anthropic native web search when the active model supports it.</div>
				</div>
				<Toggle
					tone="success"
					checked={settings.webSearch === "auto"}
					onChange={(checked) => {
						onPatch({ webSearch: checked ? "auto" : "off" });
					}}
				/>
			</div>
		</div>
	);
}