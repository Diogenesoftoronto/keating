import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalRecallModelControls, localRecallModelManager, localRecallSettingsMessage, type LocalRecallSettingsStatus } from "../components/DesktopNeedleSettings";
import type { DesktopNativeBridge } from "../lib/desktop-native";

function render(status: LocalRecallSettingsStatus, desktop = true, busy: "install" | "remove" | "cancel" | null = null) {
  return renderToStaticMarkup(<LocalRecallModelControls desktop={desktop} supported status={status} busy={busy} progress={null}
    onInstall={() => {}} onRemove={() => {}} onCancel={() => {}} />);
}

test("desktop offers the pinned download even when a legacy workspace model is available", () => {
  const status = { available: true, model: "legacy-needle", installed: false, managed: false };
  const html = render(status);
  expect(html).toContain("Download local recall model (36 MB)");
  expect(html).not.toContain("Remove local recall model");
  expect(html).toContain("Keating app data"); expect(html).toContain("across restarts");
  expect(html).not.toContain("saved in this browser");
  expect(localRecallSettingsMessage(true, true, status, true)).toContain("configured in this desktop workspace");
});

test("managed installation and in-progress download have distinct remove and cancel controls", () => {
  const installed = { available: true, model: "pinned-needle", installed: true, managed: true };
  expect(render(installed)).toContain("Remove local recall model");
  expect(render(installed)).not.toContain("Download local recall model (36 MB)");
  expect(localRecallSettingsMessage(true, true, installed, false)).toBe("Downloaded model in Keating app data. Local recall is off.");
  const downloading = { available: false, model: null, installed: false, downloading: true, downloadedBytes: 18, totalBytes: 36 };
  expect(render(downloading)).toContain("Cancel download");
  expect(render(downloading)).toContain('value="50"');
  expect(render(downloading, true, "cancel")).toContain("disabled");
  expect(render(downloading)).not.toContain("Remove local recall model");
  expect(render({ available: false, model: null, installed: true })).toContain("Remove local recall model");
});

test("desktop manager uses native persistent install/status/cancel/remove and never renderer storage", async () => {
  const calls: string[] = [], controller = new AbortController();
  const status = { available: true, model: "pinned-needle", installed: true, downloading: false, managed: true };
  const bridge: DesktopNativeBridge = { getNativeRuntime: async () => ({ projectRoot: "/desktop/workspace" }), executeNative: async (operation, payload) => {
    expect(payload).toEqual({}); calls.push(operation); return operation === "needle.status" ? status : { ok: true };
  } };
  const manager = localRecallModelManager(bridge);
  expect(await manager.status()).toEqual(status);
  await manager.install(() => { throw Error("Browser progress must not be used for desktop"); }, controller.signal);
  await manager.cancel(controller); await manager.remove();
  expect(controller.signal.aborted).toBe(true);
  expect(calls).toEqual(["needle.status", "needle.install", "needle.cancelDownload", "needle.remove"]);
});

test("browser presentation retains browser storage semantics and unsupported runtimes offer no download", () => {
  const html = render({ available: false, model: null, installed: false }, false);
  expect(html).toContain("Download local recall model (36 MB)"); expect(html).toContain("Clearing browser data removes it");
  expect(html).not.toContain("Keating app data");
  expect(renderToStaticMarkup(<LocalRecallModelControls desktop={false} supported={false} progress={null} busy={null}
    onInstall={() => {}} onRemove={() => {}} onCancel={() => {}} />)).toBe("");
});
