/**
 * Opening Settings on a particular tab and section: the `?settings=` deep link
 * (`<tabId>` or `<tabId>-<sectionId>`, or a bare models section id) and the
 * in-app `keating:open-settings` request.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { PostHog } from "posthog-js";
import { SETTINGS_DIALOG_TAB_IDS } from "../../components/settings/section-ids";
import type { DialogState } from "../useDialogState";

export interface SettingsDeepLink {
	tabId: string;
	sectionId: string | null;
}

const groupIds = [
	...SETTINGS_DIALOG_TAB_IDS,
	"interface",
	"data",
] as readonly string[];
export function parseSettingsDeepLink(raw: string): SettingsDeepLink {
	if (groupIds.includes(raw)) return { tabId: raw, sectionId: null };
	const prefix = groupIds.find(
		(id) => raw.startsWith(id + ".") || raw.startsWith(id + "-"),
	);
	if (prefix) return { tabId: prefix, sectionId: raw.slice(prefix.length + 1) };
	return { tabId: "models", sectionId: raw };
}
export function requestedSettingsTab(tab: unknown): string {
	return typeof tab === "string" && groupIds.includes(tab) ? tab : "models";
}
export function eventDestination(detail: unknown): string {
	if (typeof detail === "string") return detail;
	if (detail && typeof detail === "object") {
		if ("section" in detail && typeof detail.section === "string")
			return detail.section;
		if ("tab" in detail && typeof detail.tab === "string") return detail.tab;
	}
	return "models";
}

export function useSettingsDialogLinks(
	settingsDialog: DialogState,
	posthog: Pick<PostHog, "capture">,
): {
	openSettings: () => void;
	settingsDeepLinkRef: MutableRefObject<SettingsDeepLink | null>;
} {
	const settingsDeepLinkRef = useRef<SettingsDeepLink | null>(null);

	const openSettings = useCallback(() => {
		posthog.capture("settings_opened", { source: "toolbar" });
		settingsDeepLinkRef.current = null;
		settingsDialog.onOpen();
	}, [posthog, settingsDialog]);

	// In-app request to open settings on a particular tab. The live surface uses
	// this to turn "no API key" into a button that lands on the right page,
	// without the URL churn the ?settings= deep link involves.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const onOpenSettingsTab = (event: Event) => {
			const detail = (event as CustomEvent<{ tab?: unknown }>).detail;
			settingsDeepLinkRef.current = parseSettingsDeepLink(
				eventDestination(detail),
			);
			if (settingsDialog.open)
				window.dispatchEvent(
					new CustomEvent("keating:settings-tab", { detail }),
				);
			settingsDialog.onOpen();
		};
		window.addEventListener("keating:open-settings", onOpenSettingsTab);
		return () =>
			window.removeEventListener("keating:open-settings", onOpenSettingsTab);
	}, [settingsDialog]);

	// Deep-link support: ?settings=<tabId> or ?settings=<tabId>-<sectionId>.
	// Opens the settings dialog on the matching tab, scrolls to the section
	// anchor after the dialog mounts, then strips the param from the URL so
	// it doesn't pollute history/back-button behavior.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const params = new URLSearchParams(window.location.search);
		const raw = params.get("settings");
		if (!raw) return;
		settingsDeepLinkRef.current = parseSettingsDeepLink(raw);
		params.delete("settings");
		const next = params.toString();
		const url = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
		window.history.replaceState({}, "", url);
		settingsDialog.onOpen();
	}, [settingsDialog]);

	return { openSettings, settingsDeepLinkRef };
}
