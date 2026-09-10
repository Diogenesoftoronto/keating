export const DOCUMENTATION_URL = "https://docs.keating.help/";

const PROVIDER_ANCHORS: Record<string, string> = {
	google: "google-api-key",
	openai: "openai-api-key",
	anthropic: "anthropic-api-key",
	openrouter: "openrouter-api-key",
};

export function tutorialApiKeyHref(_provider?: string): string {
	// The learner guide currently explains all provider keys in this section.
	return `${DOCUMENTATION_URL}choose-a-model/#section-use-your-own-provider-key`;
}

export function tutorialAdvancedHref(anchor = "fine-tune-from-keating"): string {
	if (anchor === "feynman-harness") return "https://dev.keating.help/evaluation-and-evolution/";
	if (anchor === "doc-to-lora") return "https://dev.keating.help/models-and-providers/";
	return "https://dev.keating.help/data-and-privacy/#training-archives-preserve-provenance";
}

const LEGACY_SECTIONS: Record<string, string> = {
	"what-is-keating": "start-here/",
	surfaces: "install-keating/",
	"suggested-prompts": "learning-with-keating/",
	"tool-commands": "learning-with-keating/",
	"terminal-onboarding": "install-keating/",
	settings: "learning-with-keating/",
	"review-sessions": "sessions-and-review/",
	problems: "troubleshooting/",
	"model-setup": "choose-a-model/",
	"tab-browser": "offline-tutor/",
	"tab-ollama": "connect-local-models/#section-ollama",
	"tab-llamacpp": "connect-local-models/#section-llama-cpp",
	"tab-litellm": "connect-local-models/#section-litellm",
	"tab-cloud": "choose-a-model/",
};
const ADVANCED_ANCHORS = new Set([
	"tab-advanced", "unsloth-studio", "fine-tune-from-keating", "runpod-training", "doc-to-lora", "feynman-harness",
]);

/** Resolve only the retired page, never its still-used /tutorial/* images. */
export function legacyTutorialHref(href: string): string | null {
	if (!href.startsWith("/") || href.startsWith("//") || /[\\\r\n]/.test(href)) return null;
	const url = new URL(href, "https://keating.help");
	if (url.pathname !== "/tutorial" && url.pathname !== "/tutorial/") return null;
	const anchor = url.hash.slice(1);
	if (anchor === "get-api-key" || Object.values(PROVIDER_ANCHORS).includes(anchor)) {
		return tutorialApiKeyHref();
	}
	if (ADVANCED_ANCHORS.has(anchor)) return tutorialAdvancedHref(anchor);
	if (Object.hasOwn(LEGACY_SECTIONS, anchor)) return `${DOCUMENTATION_URL}${LEGACY_SECTIONS[anchor]}`;
	const tab = url.searchParams.get("tab");
	if (tab === "advanced") return tutorialAdvancedHref();
	if (tab && Object.hasOwn(LEGACY_SECTIONS, `tab-${tab}`)) return `${DOCUMENTATION_URL}${LEGACY_SECTIONS[`tab-${tab}`]}`;
	return DOCUMENTATION_URL;
}

export function handleTutorialLinkClick(
	event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "preventDefault">,
	href: string,
): void {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
	if (typeof window === "undefined") return;
	const url = new URL(href, window.location.origin);
	const legacy = url.origin === window.location.origin
		? legacyTutorialHref(`${url.pathname}${url.search}${url.hash}`)
		: null;
	if (legacy || url.origin !== window.location.origin) {
		// Let real anchors preserve ordinary browser navigation and modified clicks.
		// Electron's window-open policy sends these URLs to the system browser.
		if ("keatingDesktop" in window) {
			event.preventDefault();
			window.open(legacy ?? url.href, "_blank", "noopener,noreferrer");
		} else if (legacy) {
			event.preventDefault();
			window.location.assign(legacy);
		}
		return;
	}
	event.preventDefault();
	window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
	window.dispatchEvent(new PopStateEvent("popstate"));
	if (url.hash) {
		window.requestAnimationFrame(() => {
			document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}
}
