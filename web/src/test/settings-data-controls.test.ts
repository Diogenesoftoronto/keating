import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let page: Awaited<ReturnType<typeof browser.newPage>>;
const fixture = "https://settings-data.test/";
const ui = "keating_ui_settings";
const analytics = "keating.analytics.preferences.v1";
const requests: string[] = [];

beforeAll(async () => {
	const entry = resolve(import.meta.dir, "settings-data-browser-fixture.tsx");
	const build = await Bun.build({
		target: "browser", entrypoints: [entry],
		// Vite resolves these resource URLs in production. The fixture never runs inference.
		external: ["*?url"],
		define: {
			"process.env.NODE_ENV": '"production"',
			"import.meta.env": JSON.stringify({ VITE_POSTHOG_PROJECT_TOKEN: "fixture", VITE_POSTHOG_SESSION_REPLAY: "true" }),
		},
		files: { [entry]: `
			import { createRoot } from "react-dom/client";
			import { SharingPrivacy } from "../components/settings/data/SharingPrivacy";
			import { DeveloperTools } from "../components/settings/data/DeveloperTools";
			import { ModelRequestLog } from "../components/settings/ModelRequestLog";
			import { JudgementDiagnostics } from "../components/JudgementDiagnostics";
			import { beginDiagnosticReply, getJudgementDiagnostics } from "../keating/judgement/diagnostics";
			import { keatingStorage } from "../hooks/keating-storage";
			window.seedJudgement = async () => {
				beginDiagnosticReply("fixture");
				await keatingStorage.putTurnJudgement({id:"fixture:1",sessionId:"fixture",assistantTimestamp:1,createdAt:1,updatedAt:1,extraction:[],memory:[]});
			};
			window.judgementCounts = async () => [getJudgementDiagnostics().replies.length, (await keatingStorage.getTurnJudgements("fixture")).length];
			import { ErrorDiagnosticsActions } from "../components/ErrorDiagnosticsActions";
			import { recordModelRequest } from "../keating/model-request-log";
			import { loadKeatingUiSettings } from "../keating/ui-settings";
			import { readAnalyticsPreferences } from "../lib/analytics-preferences";
			import { turnJudgementSavingEnabled } from "../keating/judgement/turn-ledger";
			import { learningIntelligenceEnabled } from "../keating/learning-intelligence/account";
			window.readSettings = () => ({...loadKeatingUiSettings(), ...readAnalyticsPreferences(true),
				extraction: learningIntelligenceEnabled(), judgement: turnJudgementSavingEnabled()});
			createRoot(document.querySelector("main")).render(<><SharingPrivacy/><DeveloperTools/>
				<ErrorDiagnosticsActions summary="Fixture failure"/><ModelRequestLog/><JudgementDiagnostics controls/>
				<button onClick={() => recordModelRequest({kind:"draft", sessionId:"fixture", model:"fixture-model"})}>Add fixture request</button></>);
		` },
	});
	if (!build.success) throw new AggregateError(build.logs, "Settings fixture failed");
	const js = await build.outputs.find(output => output.path.endsWith(".js"))!.text();
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	page = await browser.newPage({ reducedMotion: "reduce" });
	page.setDefaultTimeout(3000);
	page.on("pageerror", (error: Error) => console.error(error));
	await page.route("**/*", (route: { request(): {url(): string; method(): string}; fulfill(options: object): Promise<void>; abort(): Promise<void> }) => {
		const address = route.request().url();
		if (address === fixture) return route.fulfill({contentType: "text/html", body: '<main></main><script type="module" src="/fixture.js"></script>'});
		if (address === fixture + "fixture.js") return route.fulfill({contentType: "text/javascript", body: js});
		requests.push(route.request().method() + " " + address);
		if (address === fixture + "api/observability/v1/arize/config") return route.fulfill({json: {enabled: true, evaluationContentEnabled: true}});
		return route.abort();
	});
}, 30000);

afterAll(async () => { await browser?.close(); });
beforeEach(async () => {
	await page.goto(fixture);
	await page.evaluate(() => localStorage.clear());
	requests.length = 0;
	await page.reload();
	await page.getByRole("switch", {name:"Arize evaluation"}).and(page.locator(":enabled")).waitFor();
});
const toggle = (id: string) => page.locator(`[role=switch][aria-labelledby="${id}-label"]`);
const read = () => page.evaluate(() => (window as unknown as {readSettings(): Record<string, unknown>}).readSettings());

const moved = [
	["sd-analytics", "captureEnabled", analytics, true], ["sd-replay", "replayEnabled", analytics, true], ["sd-arize", "arizeEvaluationEnabled", analytics, false],
	["sd-crash", "diagnosticsReporting", ui, false], ["sd-extraction", "extraction", "keating.learning-intelligence.enabled.v1", true],
	["sd-judgements", "judgement", "keating:judgement-review-records:v1", false], ["showDeveloperDetails", "showDeveloperDetails", ui, false],
	["showReasoning", "showReasoning", ui, true], ["showToolUi", "showToolUi", ui, false], ["autoExpandReasoning", "autoExpandReasoning", ui, false],
	["showRawErrors", "showRawErrors", ui, false],
] as const;

for (const [id, field, key, initial] of moved) {
	test(id + " preserves its old default, key, writer and saved value on remount", async () => {
		if (["showReasoning", "showToolUi", "autoExpandReasoning", "showRawErrors"].includes(id)) await toggle("showDeveloperDetails").click();
		const original = await read();
		expect(original[field]).toBe(initial);
		expect(await toggle(id).isChecked()).toBe(initial);
		await toggle(id).click();
		expect(await read()).toEqual({...original, [field]: !initial});
		const stored = await page.evaluate((name: string) => JSON.parse(localStorage.getItem(name)!), key);
		expect(key === ui || key === analytics ? stored[field] : stored).toBe(!initial);
		await page.reload();
		await toggle(id).waitFor();
		if (id === "sd-arize") await page.getByRole("switch", {name:"Arize evaluation"}).and(page.locator(":enabled")).waitFor();
		expect(await toggle(id).isChecked()).toBe(!initial);
		await toggle(id).click();
		expect(await read()).toEqual(original);
	});
}

test("opening settings writes no consent and sends only the read-only configuration lookup", async () => {
	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys.filter((k: string) => moved.some(row => row[2] === k))).toEqual([]);
	expect(requests).toEqual(["GET " + fixture + "api/observability/v1/arize/config"]);
});

test("dependent switches retain saved choices when the developer or reasoning gate is closed", async () => {
	const dependents = ["showReasoning", "showToolUi", "autoExpandReasoning", "showRawErrors"];
	for (const id of dependents) {
		expect(await toggle(id).isDisabled()).toBe(true);
		expect(await toggle(id).isChecked()).toBe(false);
	}
	await toggle("showDeveloperDetails").click();
	await toggle("autoExpandReasoning").click();
	await toggle("showReasoning").click();
	expect(await toggle("autoExpandReasoning").isDisabled()).toBe(true);
	expect(await toggle("autoExpandReasoning").isChecked()).toBe(false);
	expect((await read()).autoExpandReasoning).toBe(true);
	await toggle("showDeveloperDetails").click();
	await toggle("showDeveloperDetails").click();
	await toggle("showReasoning").click();
	expect(await toggle("autoExpandReasoning").isChecked()).toBe(true);
});

test("error card and Settings subscribe to the same reporting consent", async () => {
	await toggle("sd-crash").click();
	await page.getByRole("button", {name:"Turn off diagnostics"}).click();
	expect(await toggle("sd-crash").isChecked()).toBe(false);
	expect((await read()).diagnosticsReporting).toBe(false);
});

test("resetting both first-use warnings preserves the share mode and unrelated consent", async () => {
	await page.evaluate(() => localStorage.setItem("keating_ui_settings", JSON.stringify({shareWarningAcknowledged:true, trajectoryShareWarningAcknowledged:true, shareLinkMode:"local-short"})));
	await page.reload();
	const original = await read();
	await page.getByRole("button", {name:"Ask me again before the next public share"}).click();
	expect(await read()).toEqual({...original, shareWarningAcknowledged:false, trajectoryShareWarningAcknowledged:false});
});

test("clearing the request log requires confirmation, cancel retains the entry", async () => {
	await page.getByRole("switch", {name:"Record model requests"}).click();
	await page.getByRole("button", {name:"Add fixture request"}).click();
	const trigger = page.getByRole("button", {name:"Clear request log", exact:true});
	await trigger.click();
	const dialog = page.getByRole("alertdialog", {name:"Clear request log?"});
	expect(await dialog.innerText()).toContain("draft and review request payloads");
	await dialog.getByRole("button", {name:"Cancel"}).click();
	expect(await page.getByText(/draft · fixture-model/).count()).toBe(1);
	await trigger.click();
	await dialog.getByRole("button", {name:"Clear request log", exact:true}).click();
	expect(await trigger.isDisabled()).toBe(true);
	expect(await page.getByText(/draft · fixture-model/).count()).toBe(0);
});

test("clear captured calls and delete saved records each require their own confirmation", async () => {
	await page.getByRole("switch", {name:"Capture judgement diagnostics"}).click();
	await page.evaluate(() => (window as unknown as {seedJudgement(): Promise<void>}).seedJudgement());
	await page.locator("details > summary").filter({hasText:/^Judgements ·/}).click();
	const counts = () => page.evaluate(() => (window as unknown as {judgementCounts(): Promise<number[]>}).judgementCounts());
	for (const [label, before, after] of [
		["Clear captured calls", [1, 1], [0, 1]],
		["Delete saved judgement records", [0, 1], [0, 0]],
	] as const) {
		const trigger = page.getByRole("button", {name:label, exact:true});
		await trigger.click();
		const dialog = page.getByRole("alertdialog", {name:label + "?"});
		expect(await counts()).toEqual([...before]);
		await dialog.getByRole("button", {name:"Cancel"}).click();
		expect(await counts()).toEqual([...before]);
		await trigger.click();
		await dialog.getByRole("button", {name:label, exact:true}).click();
		if (label === "Delete saved judgement records") await page.getByText("Saved judgement records and your labels were deleted.", {exact:false}).waitFor();
		expect(await counts()).toEqual([...after]);
	}
});

test("changing independent trace consent preserves a more recent analytics opt-out", async () => {
	await page.evaluate(() => localStorage.setItem("keating.analytics.preferences.v1", JSON.stringify({captureEnabled:false,replayEnabled:false,arizeEvaluationEnabled:false})));
	await toggle("sd-arize").click();
	expect(await read()).toMatchObject({captureEnabled:false,replayEnabled:false,arizeEvaluationEnabled:true});
});
