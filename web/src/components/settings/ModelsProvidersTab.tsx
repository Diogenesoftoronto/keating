import { css } from "../../../styled-system/css";
import { ProvidersModelsTab } from "../ProvidersModelsTab";
import { ProxyTab } from "../ProxyTab";
import { MODELS_TAB_EXTRA_SECTION_IDS } from "./section-ids";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "2rem" });
const sectionAnchorClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const sectionTitleClass = css({ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)" });

/**
 * "Models & Providers" settings tab: everything about how the app reaches
 * LLM providers — API keys, web search, visibility, custom models/providers,
 * and the CORS proxy (it routes provider requests, so it lives here).
 * The proxy entry is injected into ProvidersModelsTab's section nav via
 * `extraNavSections`; the section itself is appended below.
 */
export function ModelsProvidersTab() {
	return (
		<div className={stackClass}>
			<ProvidersModelsTab
				extraNavSections={MODELS_TAB_EXTRA_SECTION_IDS.map((id) => ({ id, label: "Proxy" }))}
			/>

			<div id={`settings-section-${MODELS_TAB_EXTRA_SECTION_IDS[0]}`} className={sectionAnchorClass}>
				<h3 className={sectionTitleClass}>Proxy</h3>
				<ProxyTab />
			</div>
		</div>
	);
}
