/**
 * Canonical list of in-tab section anchors for the Models & Providers settings
 * tab. Used by the section nav (jump links) and by the `?settings=` URL
 * deep-link parser to validate that a requested section exists.
 *
 * The Models tab also injects an extra "Proxy" anchor from
 * `ModelsProvidersTab.tsx`; both lists are kept in sync manually so a deep
 * link never references a missing anchor.
 */
export const MODELS_TAB_SECTION_IDS = [
	"cloud-providers",
	"web-search",
	"provider-visibility",
	"my-models",
	"custom-providers",
] as const;

export const MODELS_TAB_SECTION_LABELS: Record<typeof MODELS_TAB_SECTION_IDS[number], string> = {
	"cloud-providers": "Cloud",
	"web-search": "Web Search",
	"provider-visibility": "Visibility",
	"my-models": "My Models",
	"custom-providers": "Custom Providers",
};

export const MODELS_TAB_EXTRA_SECTION_IDS = ["proxy"] as const;

export const MODELS_TAB_ALL_SECTION_IDS = [
	...MODELS_TAB_SECTION_IDS,
	...MODELS_TAB_EXTRA_SECTION_IDS,
] as const;

/** Top-level settings dialog tab ids, used for `?settings=<id>` deep links. */
export const SETTINGS_DIALOG_TAB_IDS = ["models", "learning", "app"] as const;