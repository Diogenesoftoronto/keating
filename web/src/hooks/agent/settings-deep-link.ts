/**
 * Opening Settings on a particular tab and section: the `?settings=` deep link
 * (`<tabId>` or `<tabId>-<sectionId>`, or a bare models section id) and the
 * in-app `keating:open-settings` request.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { PostHog } from "posthog-js";
import { SETTINGS_DIALOG_TAB_IDS } from "../../components/settings/section-ids";
import type { DialogState } from "../useDialogState";
import { currentEntry, settingsLeaving } from "../../components/settings/settings-history";

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

	// Deep links, reloads and Forward: a location that describes a Settings
	// entry (`?settings=…`) opens Settings there. The parameter stays in the URL
	// while Settings is open, so a reload lands on the same section; the dialog
	// owns the history entries from then on (components/settings/settings-history).
	const openRef = useRef(settingsDialog.open);
	openRef.current = settingsDialog.open;
	const { onOpen } = settingsDialog;
	useEffect(() => {
		if (typeof window === "undefined") return;
		const fromLocation = () => {
			const entry = currentEntry(window.location, window.history.state);
			if (!entry) return false;
			settingsDeepLinkRef.current = parseSettingsDeepLink(entry.raw);
			onOpen();
			return true;
		};
		fromLocation();
		// Back out of Settings, then Forward: reopen on the section that entry holds.
		const onPopState = () => {
			if (!openRef.current && !settingsLeaving()) fromLocation();
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [onOpen]);

	return { openSettings, settingsDeepLinkRef };
}
