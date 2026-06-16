const PROVIDER_ANCHORS: Record<string, string> = {
	google: "google-api-key",
	openai: "openai-api-key",
	anthropic: "anthropic-api-key",
	openrouter: "openrouter-api-key",
};

export function tutorialApiKeyHref(provider?: string): string {
	const anchor = provider ? PROVIDER_ANCHORS[provider] ?? "get-api-key" : "get-api-key";
	return `/tutorial?tab=cloud#${anchor}`;
}

export function tutorialAdvancedHref(anchor = "fine-tune-from-keating"): string {
	return `/tutorial?tab=advanced#${anchor}`;
}

export function handleTutorialLinkClick(
	event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "preventDefault">,
	href: string,
): void {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (typeof window === "undefined") return;
	event.preventDefault();
	const url = new URL(href, window.location.origin);
	window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
	window.dispatchEvent(new PopStateEvent("popstate"));
	if (url.hash) {
		window.requestAnimationFrame(() => {
			document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
}
