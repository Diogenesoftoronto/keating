/**
 * Opening Settings on a particular tab and section: the `?settings=` deep link
 * (`<tabId>` or `<tabId>-<sectionId>`, or a bare models section id) and the
 * in-app `keating:open-settings` request.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { PostHog } from "posthog-js";
import {
  MODELS_TAB_ALL_SECTION_IDS,
  SETTINGS_DIALOG_TAB_IDS,
} from "../../components/settings/section-ids";
import type { DialogState } from "../useDialogState";

export interface SettingsDeepLink {
  tabId: string;
  sectionId: string | null;
}

/** Unknown tabs fall back to Models; only Models sections are scrolled to. */
export function parseSettingsDeepLink(raw: string): SettingsDeepLink {
  const MODEL_SECTION_SET = new Set<string>(MODELS_TAB_ALL_SECTION_IDS);
  let tabId = raw;
  let sectionId: string | null = null;
  if (
    !SETTINGS_DIALOG_TAB_IDS.includes(
      raw as (typeof SETTINGS_DIALOG_TAB_IDS)[number],
    )
  ) {
    const dashIndex = raw.indexOf("-");
    const candidateTab = dashIndex === -1 ? raw : raw.slice(0, dashIndex);
    const candidateSection =
      dashIndex === -1 ? raw : raw.slice(dashIndex + 1);
    if (
      (SETTINGS_DIALOG_TAB_IDS as readonly string[]).includes(candidateTab)
    ) {
      tabId = candidateTab;
      sectionId = MODEL_SECTION_SET.has(candidateSection)
        ? candidateSection
        : null;
    } else if (MODEL_SECTION_SET.has(raw)) {
      tabId = "models";
      sectionId = raw;
    } else {
      tabId = "models";
    }
  }
  return { tabId, sectionId };
}

/** The tab an in-app open request names, or Models for anything unknown. */
export function requestedSettingsTab(tab: unknown): string {
  const requested = typeof tab === "string" ? tab : "";
  return (SETTINGS_DIALOG_TAB_IDS as readonly string[]).includes(requested)
    ? requested
    : "models";
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
    settingsDialog.onOpen();
  }, [posthog, settingsDialog]);

  // In-app request to open settings on a particular tab. The live surface uses
  // this to turn "no API key" into a button that lands on the right page,
  // without the URL churn the ?settings= deep link involves.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenSettingsTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: unknown }>).detail;
      settingsDeepLinkRef.current = { tabId: requestedSettingsTab(detail?.tab), sectionId: null };
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

  useEffect(() => {
    if (!settingsDialog.open) return;
    const link = settingsDeepLinkRef.current;
    if (!link) return;
    const handle = window.setTimeout(() => {
      const el = link.sectionId
        ? document.getElementById(`settings-section-${link.sectionId}`)
        : null;
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      settingsDeepLinkRef.current = null;
    }, 80);
    return () => window.clearTimeout(handle);
  }, [settingsDialog.open]);

  return { openSettings, settingsDeepLinkRef };
}
