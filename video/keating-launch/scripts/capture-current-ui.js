// Run through Playwriter, for example:
// rtk proxy bunx playwriter@latest -s <your-session> -f video/keating-launch/scripts/capture-current-ui.js
// Requires the current local application at :3000 and Storybook at :6006.
// Captures an illustrative stored response through the actual application UI.
// It does not invoke inference or manufacture a streaming response.
const fs = require("node:fs");
const root = "/home/diogenes/Projects/keating/video/keating-launch";
const provenance = JSON.parse(fs.readFileSync(`${root}/scripts/current-ui-capture.json`, "utf8"));
state.capturePage = await context.newPage();
await state.capturePage.addInitScript(() => { window.__REACT_GRAB_DISABLED__ = true; });
await state.capturePage.setViewportSize({ width: 1920, height: 1080 });
await state.capturePage.goto(provenance.classroom.url, { waitUntil: "domcontentloaded" });
await state.capturePage.getByRole("button", { name: "Go straight to chat" }).click();
await state.capturePage.evaluate(async ({ prompt, response }) => {
  const { getAppStorage } = await import("/src/keating/app-storage.ts");
  const id = "launch-recursion-example";
  const time = new Date().toISOString();
  const title = "Recursion: finding the stopping point";
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const model = { id: "example-transcript", name: "Example transcript", api: "openai-completions", provider: "Example", baseUrl: "http://127.0.0.1:9", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const messages = [
    { role: "user", content: prompt, timestamp: Date.now() - 2000 },
    { role: "assistant", content: [{ type: "text", text: response }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: "stop", timestamp: Date.now() - 1000 },
  ];
  await getAppStorage().sessions.save(
    { id, title, model, thinkingLevel: "off", messages, createdAt: time, lastModified: time },
    { id, title, createdAt: time, lastModified: time, messageCount: 2, usage, thinkingLevel: "off", modelProvider: model.provider, modelId: model.id, modelName: model.name, modelApi: model.api, preview: prompt },
  );
}, provenance.classroom);
await state.capturePage.reload({ waitUntil: "domcontentloaded" });
await state.capturePage.getByRole("button", { name: "Copy message", exact: true }).waitFor();
const persistenceWarning = state.capturePage.getByRole("button", { name: "Dismiss persistence warning" });
if (await persistenceWarning.isVisible()) await persistenceWarning.click();
await ghostCursor.hide({ page: state.capturePage });
console.log(await snapshot({ page: state.capturePage }));
console.log(await getLatestLogs({ page: state.capturePage, sinceLastCall: true }));
await state.capturePage.screenshot({ path: `${root}/assets/clips/classroom-current-proof.png`, scale: "css" });
console.log("Saved current classroom UI proof; encode the held response shot with ffmpeg at 30 fps for 6 seconds.");

state.liveCapturePage = await context.newPage();
await state.liveCapturePage.setViewportSize({ width: 1060, height: 872 });
await state.liveCapturePage.goto(provenance.gptLive.url, { waitUntil: "domcontentloaded" });
await state.liveCapturePage.getByRole("combobox", { name: "Live model" }).waitFor();
console.log(await snapshot({ page: state.liveCapturePage }));
console.log(await getLatestLogs({ page: state.liveCapturePage, sinceLastCall: true }));
await ghostCursor.hide({ page: state.liveCapturePage });
await state.liveCapturePage.screenshot({
  path: `${root}/assets/stills/feature-live-current.png`,
  scale: "css",
  clip: { x: 21, y: 21, width: 1060, height: 832 },
  captureBeyondViewport: true,
});
