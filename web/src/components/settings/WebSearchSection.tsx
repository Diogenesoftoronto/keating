import { css } from "../../../styled-system/css";
import { settingsCard } from "../../../styled-system/recipes";
import { Toggle } from "../Toggle";
import type { KeatingUiSettings } from "../../keating/ui-settings";

const sectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const sectionDescriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const titleClass = css({ fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" });
const descriptionClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });

export function WebSearchSection({
	settings,
	onPatch,
}: {
	settings: KeatingUiSettings;
	onPatch: (patch: Partial<KeatingUiSettings>) => void;
}) {
	return (
		<div id="settings-section-web-search" className={sectionClass}>
			<div>
				<h3 className={sectionTitleClass}>Web Search</h3>
				<p className={sectionDescriptionClass}>
					Let keyed chats use each provider's own web search: Google Search grounding on Gemini, the hosted <code>web_search</code> tool on OpenAI Responses models, and Anthropic's server-side <code>web_search</code> on Claude. Applies automatically when the active model and key support it.
				</p>
			</div>
			<div className={settingsCard({ tone: "subtle" })}>
				<div>
					<div className={titleClass}>Provider-native web search</div>
					<div className={descriptionClass}>Enables Gemini grounding plus OpenAI and Anthropic native web search when the active model supports it.</div>
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
