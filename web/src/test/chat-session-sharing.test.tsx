import { copySessionLink } from "../components/export/ShareSheet";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_UI_SETTINGS } from "../keating/ui-settings";
import {
  acknowledgeShareConsent,
  shareFailureMessage,
  shareNeedsConsent,
  shareReadyMessage,
} from "../pages/chat/session-sharing";
import { PersistentStorageBanner, ShareStatusBanner } from "../pages/chat/ChatBanners";

describe("chat session sharing", () => {
  test("public modes require consent on every share", () => {
    expect(shareNeedsConsent({ shareLinkMode: "portable-short", trajectoryShareWarningAcknowledged: false })).toBe(true);
    expect(shareNeedsConsent({ shareLinkMode: "compressed-hash", trajectoryShareWarningAcknowledged: false })).toBe(true);
    expect(shareNeedsConsent({ shareLinkMode: "portable-short", trajectoryShareWarningAcknowledged: true })).toBe(true);
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
      "Portable share link ready.",
    );
    expect(shareReadyMessage({ mode: "compressed-hash", fallback: true })).toBe(
      "Compressed share link ready after portable storage was unavailable.",
    );
    expect(shareReadyMessage({ mode: "local-short", fallback: false })).toStartWith("Local share link ready.");
    expect(shareFailureMessage(new Error("changed session"))).toBe("changed session");
    expect(shareFailureMessage("nope")).toBe("Could not create a share link yet.");
  });

  test("the consent banner offers a public share and cancel", () => {
    const html = renderToStaticMarkup(
      <ShareStatusBanner shareState="confirm" shareUrl={null} shareMessage="Share session"
        onConfirm={async () => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain("Anyone with the link can read it.");
    expect(html).toContain("Share publicly");
    expect(html).toContain(">Cancel<");
    expect(html).toMatch(/<button[^>]*disabled[^>]*><span>Share publicly/);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("readonly");
  });

  test("a created link is shown read-only with a dismiss action", () => {
    const html = renderToStaticMarkup(
      <ShareStatusBanner shareState="ready" shareUrl="https://example.test/s/1" shareMessage="ready"
        onConfirm={async () => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain('value="https://example.test/s/1"');
    expect(html).toContain(">Dismiss<");
    expect(html).not.toContain("Share publicly");
  });

  test("the persistence warning keeps its retry and accessible dismiss controls", () => {
    const html = renderToStaticMarkup(<PersistentStorageBanner onRetry={() => {}} onDismiss={() => {}} />);
    expect(html).toContain(">Fix<");
    expect(html).toContain('aria-label="Dismiss persistence warning"');
    expect(html).toContain("Storage is not persistent");
  });
});

test("copy confirms a successful write or selects the complete read-only link", async () => {
  const actions: string[] = [];
  const field = { focus() { actions.push("focus"); }, select() { actions.push("select"); } } as HTMLInputElement;
  const url = "https://example.test/share/id";
  expect(await copySessionLink(url, field, { async writeText(value) { actions.push(value); } })).toBe("copied");
  expect(actions).toEqual([url]);
  for (const clipboard of [undefined, { async writeText() { throw Error("Denied"); } }]) {
    actions.length = 0;
    expect(await copySessionLink(url, field, clipboard)).toBe("selected");
    expect(actions).toEqual(["focus", "select"]);
  }
});

test("busy and failure states keep the sheet and exact error", () => {
  const props = { shareUrl: null, onConfirm: async () => {}, onDismiss: () => {} };
  expect(renderToStaticMarkup(<ShareStatusBanner {...props} shareState="sharing" shareMessage={null}/>)).toContain("Sharing…");
  const html = renderToStaticMarkup(<ShareStatusBanner {...props} shareState="error" shareMessage="Portable storage refused this share."/>);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Portable storage refused this share.");
});

test("local mode offers an on-device link and acknowledged public modes retain the per-share checkbox", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const mode of ["local-short", "portable-short", "compressed-hash"]) {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        getItem: () => JSON.stringify({ shareLinkMode: mode, trajectoryShareWarningAcknowledged: true }),
      } });
      const html = renderToStaticMarkup(<ShareStatusBanner shareState="confirm" shareUrl={null} shareMessage="Share session" onConfirm={async () => {}} onDismiss={() => {}}/>);
      expect(html).not.toContain("<details open");
      if (mode === "local-short") {
        expect(html).toContain("Stays on this device");
        expect(html).toContain("Create local link");
        expect(html).not.toContain("Share publicly");
      } else {
        expect(html).toContain('type="checkbox"');
        expect(html).toMatch(/<button[^>]*disabled[^>]*><span>Share publicly/);
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
