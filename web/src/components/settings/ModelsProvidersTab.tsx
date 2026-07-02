import { ProvidersModelsTab } from "../ProvidersModelsTab";
import { ProxyTab } from "../ProxyTab";
import { MODELS_TAB_EXTRA_SECTION_IDS } from "./section-ids";

/**
 * "Models & Providers" settings tab: everything about how the app reaches
 * LLM providers — API keys, web search, visibility, custom models/providers,
 * and the CORS proxy (it routes provider requests, so it lives here).
 * The proxy entry is injected into ProvidersModelsTab's section nav via
 * `extraNavSections`; the section itself is appended below.
 */
export function ModelsProvidersTab() {
	return (
		<div className="flex flex-col gap-8">
			<ProvidersModelsTab
				extraNavSections={MODELS_TAB_EXTRA_SECTION_IDS.map((id) => ({ id, label: "Proxy" }))}
			/>

			<div id={`settings-section-${MODELS_TAB_EXTRA_SECTION_IDS[0]}`} className="flex flex-col gap-4 scroll-mt-20">
				<h3 className="text-base font-semibold text-foreground">Proxy</h3>
				<ProxyTab />
			</div>
		</div>
	);
}
