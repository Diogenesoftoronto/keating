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
					Use native search with your Codex login, Google Search grounding on Gemini, hosted search on OpenAI Responses models, and server-side search on Claude. When the active model has no search, Keating can use a configured OpenAI, Gemini, or Anthropic key as an auxiliary search provider.
				</p>
			</div>
			<div className={settingsCard({ tone: "subtle" })}>
				<div>
					<div className={titleClass}>Automatic web search</div>
					<div className={descriptionClass}>Uses native search when possible and a search-capable configured provider for models such as MiniMax.</div>
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
