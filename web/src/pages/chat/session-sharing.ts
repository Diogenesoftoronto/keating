/** Consent and result wording for chat session links. */
import type { SharedSessionUrlResult } from "../../keating/shared-sessions";
import {
  shareModeExposesDataPublicly,
  type KeatingUiSettings,
} from "../../keating/ui-settings";

export type ShareState = "idle" | "confirm" | "sharing" | "ready" | "error";

/** Every public link requires fresh consent. */
export function shareNeedsConsent(
  settings: Pick<KeatingUiSettings, "shareLinkMode" | "trajectoryShareWarningAcknowledged">,
): boolean {
  return shareModeExposesDataPublicly(settings.shareLinkMode);
}

/** Settings to save once the learner confirms, or null when nothing changes. */
export function acknowledgeShareConsent(
  settings: KeatingUiSettings,
): KeatingUiSettings | null {
  if (settings.trajectoryShareWarningAcknowledged) return null;
  return {
    ...settings,
    shareWarningAcknowledged: true,
    trajectoryShareWarningAcknowledged: true,
  };
}

export function shareReadyMessage(
  result: Pick<SharedSessionUrlResult, "mode" | "fallback">,
): string {
  const linkType =
    result.mode === "portable-short"
      ? "Portable share link"
      : result.mode === "compressed-hash"
        ? "Compressed share link"
        : "Local share link";
  return `${linkType} ready${result.fallback ? " after portable storage was unavailable" : ""}.`;
}

export function shareFailureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not create a share link yet.";
}
