import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgementSettingsView, type JudgementSettingsViewProps } from "../components/settings/JudgementSettings";
import { DEFAULT_JUDGEMENT_MODEL_SETTINGS } from "../keating/judgement-model";
import { DESKTOP_OFFLINE_MODEL } from "../lib/desktop-offline";
import { MODELS_TAB_ALL_SECTION_IDS } from "../components/settings/section-ids";

const initial: JudgementSettingsViewProps = {
  settings: DEFAULT_JUDGEMENT_MODEL_SETTINGS, desktop: false, scoringAvailable: false,
  account: null, checkingAccount: false, connecting: false, error: "",
  onChange() { throw new Error("Rendering must not save settings"); },
  onConnect() { throw new Error("Rendering must not start authorization"); },
};
function render(overrides: Partial<JudgementSettingsViewProps> = {}) {
  return renderToStaticMarkup(<JudgementSettingsView {...initial} {...overrides} />);
}

describe("independent judgement settings UI", () => {
  test("is reachable from settings links and explains independence and local limitations", () => {
    const html = render();
    expect(MODELS_TAB_ALL_SECTION_IDS).toContain("judgement");
    expect(html).toContain('id="settings-section-judgement"');
    expect(html).toContain("separate from your tutor model");
    expect(html).toContain("Scoring with browser models is not available yet");
    expect(html).toContain("Automatic grading stays with the existing checks");
    expect(html).not.toContain("Connect Not Organic");
  });
  test("off hides model and account controls while keeping built-in checks", () => {
    const html = render({ settings: { ...initial.settings, backend: "off" } });
    expect(html).toContain("Model reviews are off. Built-in checks remain available");
    expect(html).not.toContain("Local judgement model");
    expect(html).not.toContain("Connect Not Organic");
  });
  test("hosted selection discloses transfer and costs and requires a separate authorization action", () => {
    const html = render({ settings: { ...initial.settings, backend: "hosted" },
      account: { configured: true, connected: true, judgementAuthorized: false } });
    expect(html).toContain("Usage may incur account charges");
    expect(html).toContain("Authorize judgement access");
    expect(html).not.toContain("judgement access is connected");
  });
  test("expired account offers reconnect and an authorized account shows actual access", () => {
    const settings = { ...initial.settings, backend: "hosted" as const };
    const expired = render({ settings, account: { configured: true, connected: false, judgementAuthorized: false } });
    expect(expired).toContain("Connect or renew your Not Organic account");
    expect(expired).toContain("Connect Not Organic");
    const connected = render({ settings, account: { configured: true, connected: true, judgementAuthorized: true } });
    expect(connected).toContain("judgement access is connected");
    expect(connected).not.toContain("Connect Not Organic");
  });
  test("loading and unavailable account states cannot trigger connection", () => {
    const settings = { ...initial.settings, backend: "hosted" as const };
    expect(render({ settings, checkingAccount: true })).toContain("Checking Not Organic access");
    const unavailable = render({ settings, account: { configured: false, connected: false, judgementAuthorized: false } });
    expect(unavailable).toContain("unavailable in this app configuration");
    expect(unavailable).toContain('disabled=""');
  });
  test("an installed native model distinguishes scoring from installed calibration", () => {
    const html = render({ desktop: true, scoringAvailable: true,
      settings: { ...initial.settings, localModelId: DESKTOP_OFFLINE_MODEL.id },
      offlineStatus: { available: true, installed: true, downloading: false, downloadedBytes: 0, totalBytes: 0 } });
    expect(html).toContain("The local model is installed");
    expect(html).toContain("Matching verified calibration can be installed below");
    expect(html).not.toContain("Scoring with browser models is not available");
  });
  test("saved unlisted choices stay visible and errors have an accessible alert", () => {
    const html = render({ settings: { ...initial.settings, localModelId: "saved/model-v2" }, error: "Could not save" });
    expect(html).toContain('value="saved/model-v2" selected=""');
    expect(html).toContain("saved selection");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not save");
  });
});
