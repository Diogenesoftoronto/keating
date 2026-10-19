import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_UI_SETTINGS } from "../keating/ui-settings";
import {
  acknowledgeShareConsent,
  PUBLIC_SHARE_CONSENT_MESSAGE,
  shareFailureMessage,
  shareNeedsConsent,
  shareReadyMessage,
} from "../pages/chat/session-sharing";
import { PersistentStorageBanner, ShareStatusBanner } from "../pages/chat/ChatBanners";

describe("chat session sharing", () => {
  test("public link modes need the trajectory acknowledgement; local links never do", () => {
    expect(shareNeedsConsent({ shareLinkMode: "portable-short", trajectoryShareWarningAcknowledged: false })).toBe(true);
    expect(shareNeedsConsent({ shareLinkMode: "compressed-hash", trajectoryShareWarningAcknowledged: false })).toBe(true);
    expect(shareNeedsConsent({ shareLinkMode: "portable-short", trajectoryShareWarningAcknowledged: true })).toBe(false);
    expect(shareNeedsConsent({ shareLinkMode: "local-short", trajectoryShareWarningAcknowledged: false })).toBe(false);
  });

  test("the legacy transcript acknowledgement alone does not grant rich-share consent", () => {
    const legacyOnly = { ...DEFAULT_UI_SETTINGS, shareWarningAcknowledged: true };
    expect(shareNeedsConsent(legacyOnly)).toBe(true);
  });

  test("confirming records both acknowledgements once and leaves other settings intact", () => {
    const settings = { ...DEFAULT_UI_SETTINGS, fontFamily: "custom" as never };
    expect(acknowledgeShareConsent(settings)).toEqual({
      ...settings,
      shareWarningAcknowledged: true,
      trajectoryShareWarningAcknowledged: true,
    });
    expect(acknowledgeShareConsent({ ...settings, trajectoryShareWarningAcknowledged: true })).toBeNull();
  });

  test("ready and failure wording match each link mode", () => {
    expect(shareReadyMessage({ mode: "portable-short", fallback: false })).toBe(
      "Portable share link ready. It was copied if your browser allowed clipboard access.",
    );
    expect(shareReadyMessage({ mode: "compressed-hash", fallback: true })).toBe(
      "Snapshot share link ready after portable storage was unavailable. It was copied if your browser allowed clipboard access.",
    );
    expect(shareReadyMessage({ mode: "local-short", fallback: false })).toStartWith("Local share link ready.");
    expect(shareFailureMessage(new Error("changed session"))).toBe("changed session");
    expect(shareFailureMessage("nope")).toBe("Could not create a share link yet.");
  });

  test("the consent banner offers a public share and cancel", () => {
    const html = renderToStaticMarkup(
      <ShareStatusBanner shareState="confirm" shareUrl={null} shareMessage={PUBLIC_SHARE_CONSENT_MESSAGE}
        onConfirm={async () => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain("Anyone with the link can read it.");
    expect(html).toContain("Share publicly");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain("readonly");
  });

  test("a created link is shown read-only with a dismiss action", () => {
    const html = renderToStaticMarkup(
      <ShareStatusBanner shareState="copied" shareUrl="https://example.test/s/1" shareMessage="ready"
        onConfirm={async () => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain('value="https://example.test/s/1"');
    expect(html).toContain(">Dismiss<");
    expect(html).not.toContain("Share publicly");
  });

  test("the persistence warning keeps its retry and accessible dismiss controls", () => {
    const html = renderToStaticMarkup(<PersistentStorageBanner onRetry={() => {}} onDismiss={() => {}} />);
    expect(html).toContain("Try again");
    expect(html).toContain('aria-label="Dismiss persistence warning"');
    expect(html).toContain("Storage persistence is not enabled.");
  });
});
