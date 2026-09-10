import { afterEach, expect, test } from "bun:test";
import { desktopOfflineStream } from "../keating/desktop-offline-stream";
import { DESKTOP_OFFLINE_MODEL, installedDesktopOfflineModel, type DesktopOfflineBridge } from "../lib/desktop-offline";
import { getProviderApiKey, resolveAvailableChatModel } from "../lib/provider-models";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window"); });
function bridge(overrides: Partial<DesktopOfflineBridge> = {}) {
	const value: DesktopOfflineBridge = {
		status: async () => ({ available: true, installed: true, downloading: false, downloadedBytes: 10, totalBytes: 10 }),
		download: async () => {}, cancelDownload: async () => {}, remove: async () => {},
		generate: async () => "A fraction represents part of a whole.", cancelGeneration: async () => {}, ...overrides,
	};
	Object.defineProperty(globalThis, "window", { configurable: true, value: { keatingOffline: value } });
	return value;
}
test("installed native tutor is selectable without provider credentials, preserving explicit selections", async () => {
	bridge();
	expect(await installedDesktopOfflineModel()).toEqual(DESKTOP_OFFLINE_MODEL);
	expect(await getProviderApiKey(DESKTOP_OFFLINE_MODEL.provider)).toBe("desktop-local-runtime");
	const cloud = { ...DESKTOP_OFFLINE_MODEL, provider: "openai", id: "chosen" };
	expect(await resolveAvailableChatModel(cloud, { allowFallback: false })).toBe(cloud);
	expect(await resolveAvailableChatModel(cloud)).toEqual(DESKTOP_OFFLINE_MODEL);
});
test("uninstalled models stay out of selection and fail before generation", async () => {
	let called = false;
	bridge({ status: async () => ({ available: true, installed: false, downloading: false, downloadedBytes: 0, totalBytes: 10 }), generate: async () => { called = true; return "wrong"; } });
	expect(await installedDesktopOfflineModel()).toBeUndefined();
	const result = await desktopOfflineStream({ messages: [] }).result();
	expect(result.errorMessage).toContain("Download the offline tutor");
	expect(called).toBe(false);
});
test("native inference preserves role history and returns a final stream event", async () => {
	let prompt = "";
	bridge({ generate: async input => { prompt = input.prompt; return "Four."; } });
	const stream = desktopOfflineStream({ systemPrompt: "Teach gently", messages: [{ role: "user", content: "Two plus two?", timestamp: 1 }] });
	const events = [];
	for await (const event of stream) events.push(event.type);
	expect(events).toContain("done");
	expect(JSON.parse(prompt)).toEqual({ system: "Teach gently", conversation: [{ role: "user", content: "Two plus two?" }] });
	expect((await stream.result()).content).toEqual([{ type: "text", text: "Four." }]);
});
test("native text-only route rejects images before touching the model", async () => {
	let called = false;
	bridge({ generate: async () => { called = true; return "wrong"; } });
	const result = await desktopOfflineStream({ messages: [{ role: "user", timestamp: 1, content: [{ type: "image", data: "abc", mimeType: "image/png" }] }] }).result();
	expect(result.errorMessage).toContain("text only");
	expect(called).toBe(false);
});
test("pre-aborted requests do not start native generation", async () => {
	let called = false;
	bridge({ generate: async () => { called = true; return "wrong"; } });
	const controller = new AbortController(); controller.abort();
	const result = await desktopOfflineStream({ messages: [] }, { signal: controller.signal }).result();
	expect(result.stopReason).toBe("aborted"); expect(called).toBe(false);
});
