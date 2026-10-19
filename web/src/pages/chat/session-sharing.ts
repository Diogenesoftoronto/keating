/**
 * Share-link decisions for the chat page.
 *
 * Rich session shares publish more than the old transcript-only links, so the
 * first public share needs fresh consent. These helpers keep that decision and
 * the learner-facing wording out of the share hook so they can be tested.
 */
import type { SharedSessionUrlResult } from "../../keating/shared-sessions";
import {
  shareModeExposesDataPublicly,
  type KeatingUiSettings,
} from "../../keating/ui-settings";

export type ShareState = "idle" | "confirm" | "sharing" | "copied" | "error";

export const PUBLIC_SHARE_CONSENT_MESSAGE =
  "This link publishes the visible conversation, safe session artifacts, and any finalized review feedback. It excludes drafts, hidden tool traffic, and unsupported or oversized artifacts. Anyone with the link can read it. Share again to confirm.";

/** Local links stay on-device; public modes need the trajectory acknowledgement. */
export function shareNeedsConsent(
  settings: Pick<KeatingUiSettings, "shareLinkMode" | "trajectoryShareWarningAcknowledged">,
): boolean {
  return (
    shareModeExposesDataPublicly(settings.shareLinkMode) &&
    !settings.trajectoryShareWarningAcknowledged
  );
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
        ? "Snapshot share link"
        : "Local share link";
  return `${linkType} ready${result.fallback ? " after portable storage was unavailable" : ""}. It was copied if your browser allowed clipboard access.`;
}

export function shareFailureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not create a share link yet.";
}
