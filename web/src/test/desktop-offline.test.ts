import { afterEach, expect, test } from "bun:test";
import { desktopOfflineStream } from "../keating/desktop-offline-stream";
import { DESKTOP_OFFLINE_MODEL, DESKTOP_GEMMA_OFFLINE_MODEL, DESKTOP_BONSAI_OFFLINE_MODEL, installedDesktopOfflineModels, installedDesktopOfflineModel, type DesktopOfflineBridge } from "../lib/desktop-offline";
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


test("Gemma is offered only by capable desktop bridges and its identity reaches native media inference", async () => {
  bridge();
  expect(await installedDesktopOfflineModels()).toEqual([DESKTOP_OFFLINE_MODEL]);
  let request: Parameters<DesktopOfflineBridge["generate"]>[0] | undefined;
  bridge({ supportedModels: [DESKTOP_OFFLINE_MODEL.id, DESKTOP_GEMMA_OFFLINE_MODEL.id], generate: async input => { request = input; return "Red."; } });
  expect(await installedDesktopOfflineModels()).toEqual([DESKTOP_OFFLINE_MODEL, DESKTOP_GEMMA_OFFLINE_MODEL]);
  const stream = desktopOfflineStream({ messages: [{ role: "user", timestamp: 1, content: [{ type: "text", text: "What colour?" }, { type: "image", data: "aGk=", mimeType: "image/png" }] }] }, undefined, DESKTOP_GEMMA_OFFLINE_MODEL);
  const result = await stream.result();
  expect(result.model).toBe(DESKTOP_GEMMA_OFFLINE_MODEL.id);
  expect(request?.modelId).toBe(DESKTOP_GEMMA_OFFLINE_MODEL.id);
  expect(request?.media).toEqual([{ turn: 0, type: "image", data: "aGk=", mimeType: "image/png" }]);
  expect(JSON.parse(request!.prompt).conversation[0].content).toBe("What colour?");
});


test("Gemma-only installation supplies an offline first-run fallback", async () => {
  bridge({ supportedModels: [DESKTOP_OFFLINE_MODEL.id, DESKTOP_GEMMA_OFFLINE_MODEL.id], status: async id => ({ available: true, installed: id === DESKTOP_GEMMA_OFFLINE_MODEL.id, downloading: false, downloadedBytes: 0, totalBytes: 0 }) });
  expect(await installedDesktopOfflineModel()).toEqual(DESKTOP_GEMMA_OFFLINE_MODEL);
  expect(await resolveAvailableChatModel({ ...DESKTOP_OFFLINE_MODEL, provider: "openai", id: "missing-credentials" })).toEqual(DESKTOP_GEMMA_OFFLINE_MODEL);
});


test("Bonsai selection routes to its exact native runtime with compact output and image bytes", async () => {
  let request: Parameters<DesktopOfflineBridge["generate"]>[0] | undefined;
  bridge({ supportedModels: [DESKTOP_BONSAI_OFFLINE_MODEL.id], status: async id => ({ available: true, installed: id === DESKTOP_BONSAI_OFFLINE_MODEL.id, downloading: false, downloadedBytes: 0, totalBytes: 0 }), generate: async input => { request = input; return "Red."; } });
  expect(await installedDesktopOfflineModels()).toEqual([DESKTOP_BONSAI_OFFLINE_MODEL]);
  const stream = desktopOfflineStream({ messages: [{ role: "user", timestamp: 1, content: [{ type: "image", data: "aGk=", mimeType: "image/png" }] }] }, undefined, DESKTOP_BONSAI_OFFLINE_MODEL);
  expect((await stream.result()).model).toBe(DESKTOP_BONSAI_OFFLINE_MODEL.id);
  expect(request?.modelId).toBe(DESKTOP_BONSAI_OFFLINE_MODEL.id);
  expect(request?.maxTokens).toBe(512);
  expect(request?.media).toEqual([{ turn: 0, type: "image", data: "aGk=", mimeType: "image/png" }]);
});
