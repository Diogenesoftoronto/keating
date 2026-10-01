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
    expect(html).toContain('value="hosted" selected=""');
    expect(html).toContain("Connect Not Organic");
    expect(html).toContain('disabled=""');
  });
  test("off hides model and account controls while keeping built-in checks", () => {
    const html = render({ settings: { ...initial.settings, backend: "off" } });
    expect(html).toContain("Model reviews are off. Built-in checks remain available");
    expect(html).not.toContain("Local judgement model");
    expect(html).not.toContain(">Connect Not Organic</button>");
  });
  test("hosted selection discloses transfer and costs and requires a separate authorization action", () => {
    const html = render({ settings: { ...initial.settings, backend: "hosted" },
      account: { configured: true, connected: true, judgementAuthorized: false } });
    expect(html).toContain("usage may incur account charges");
    expect(html).toContain("Authorize judgement access");
    expect(html).not.toContain("judgement access is connected");
  });
  test("TypeSafe selection exposes an independent model and key without account authorization", () => {
    const html = render({ settings: { ...initial.settings, backend: "hosted", hostedProvider: "typesafe" },
      account: { configured: true, connected: true, judgementAuthorized: false } });
    expect(html).toContain('value="typesafe" selected=""');
    expect(html).toContain("Model ID");
    expect(html).toContain('value="jev-latest"');
    expect(html).toContain("TypeSafe API key");
    expect(html).toContain('type="password"');
    expect(html).toContain("No TypeSafe API key saved");
    expect(html).toContain("TypeSafe bills you directly");
    expect(html).toContain("relayed through Keating only for requests");
    expect(html).not.toContain("Checking Not Organic access");
    expect(html).not.toContain("Your account is connected");
    expect(html).not.toContain(">Authorize judgement access</button>");
  });
  test("saved TypeSafe credentials expose update and remove actions without filling the saved secret", () => {
    const html = render({ settings: { ...initial.settings, backend: "hosted", hostedProvider: "typesafe", customModel: "my-jev-model" }, keySaved: true });
    expect(html).toContain('value="my-jev-model"');
    expect(html).toContain("Enter a replacement key");
    expect(html).toContain("Update API key");
    expect(html).toContain("Remove API key");
    expect(html).toContain("API key saved on this device");
    expect(html).toMatch(/type="password"[^>]*value=""/);
  });
  test("TypeSafe key loading, updates and errors have accessible feedback", () => {
    const settings = { ...initial.settings, backend: "hosted" as const, hostedProvider: "typesafe" as const };
    expect(render({ settings, checkingKey: true })).toContain("Checking saved API key");
    const updating = render({ settings, keySaved: true, savingKey: true });
    expect(updating).toContain("Updating API key");
    expect(updating).toContain('disabled=""');
    const failed = render({ settings, keyError: "Could not save the API key" });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Could not save the API key");
  });
  test("expired account offers reconnect and an authorized account shows actual access", () => {
    const settings = { ...initial.settings, backend: "hosted" as const };
    const expired = render({ settings, account: { configured: true, connected: false, judgementAuthorized: false } });
    expect(expired).toContain("Connect or renew your Not Organic account");
    expect(expired).toContain("Connect Not Organic");
    const connected = render({ settings, account: { configured: true, connected: true, judgementAuthorized: true } });
    expect(connected).toContain("judgement access is connected");
    expect(connected).not.toContain(">Connect Not Organic</button>");
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
