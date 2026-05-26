const PROVIDER_ANCHORS: Record<string, string> = {
	google: "google-api-key",
	openai: "openai-api-key",
	anthropic: "anthropic-api-key",
};

export function tutorialApiKeyHref(provider?: string): string {
	const anchor = provider ? PROVIDER_ANCHORS[provider] ?? "get-api-key" : "get-api-key";
	return `/tutorial?tab=cloud#${anchor}`;
}

export function tutorialAdvancedHref(anchor = "fine-tune-from-keating"): string {
	return `/tutorial?tab=advanced#${anchor}`;
}
