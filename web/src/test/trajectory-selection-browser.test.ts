import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

test("selecting a saved mark keeps the range and opens Rewrite", async () => {
	const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
	const entry = resolve(import.meta.dir, "trajectory-selection-fixture.tsx");
	const build = await Bun.build({
		entrypoints: [entry], target: "browser", external: ["*?url", "*.svg"],
		define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
		files: { [entry]: `
			import { createRoot } from "react-dom/client";
			import { TrajectoryCanvas } from "../components/trajectory/TrajectoryCanvas";
			import { createTextAnchor } from "../keating/trajectory-review";
			const text = "The first call waits at this line.";
			const target = { kind: "message-span", role: "assistant", messageId: "m", anchor: createTextAnchor(text, 0, 20) };
			createRoot(document.querySelector("main")).render(<TrajectoryCanvas mode="transcript" transcript="continuous" onActivateMessage={() => {}} hideControls
				messages={[{ id: "m", role: "assistant", ordinal: 1, text }]} artifacts={[]}
				annotations={[{ id: "n", kind: "problem", note: "Explain the frame.", target }]}
				onSelectAnnotation={() => document.body.dataset.opened = "note"}
				onTextSelection={selection => document.body.dataset.opened = selection.intent}
			/>);
		` },
	});
	if (!build.success) throw new AggregateError(build.logs, "Review fixture build failed");
	const browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		args: ["--blink-settings=caretBrowsingEnabled=true"],
	});
	try {
		const page = await browser.newPage({ reducedMotion: "reduce" });
		page.on("pageerror", (error: Error) => console.error(error.message));
		await page.setContent('<main style="margin:120px;height:400px"></main>');
		await page.addStyleTag({ content: await Bun.file(resolve(import.meta.dir, "../../styled-system/styles.css")).text() });
		await page.addScriptTag({ type: "module", content: await build.outputs.find(o => o.path.endsWith(".js"))!.text() });
		const mark = page.locator("mark");
		await mark.waitFor({ timeout: 4000 });
		const bounds = await mark.boundingBox();
		const y = bounds.y + bounds.height / 2;
		await page.mouse.move(bounds.x + 1, y);
		await page.mouse.down();
		await page.mouse.move(bounds.x + bounds.width - 1, y, { steps: 10 });
		await page.mouse.up();
		expect(await page.evaluate(() => String(getSelection()))).toBe("The first call waits");
		expect(await page.evaluate(() => document.body.dataset.opened)).toBeUndefined();
		await page.getByRole("button", { name: /Rewrite/ }).click({ timeout: 2000 });
		expect(await page.evaluate(() => document.body.dataset.opened)).toBe("rewrite");
		const plain = page.locator("span[data-source-start]").filter({ hasText: "at this line" });
		await plain.click();
		await page.keyboard.press("Shift+ArrowRight");
		expect(await page.evaluate(() => String(getSelection()).length)).toBe(1);
		expect(await page.getByRole("toolbar", { name: "Annotate selection" }).count()).toBe(1);
		await page.getByRole("button", { name: /Rewrite/ }).click();
		await mark.focus();
		expect(await mark.evaluate((el: HTMLElement) => el === document.activeElement)).toBe(true);
		await mark.evaluate((el: HTMLElement) => getSelection()!.collapse(el.firstChild!, 0));
		await page.keyboard.press("Shift+ArrowRight");
		expect(await page.evaluate(() => String(getSelection()))).toBe("T");
		expect(await page.getByRole("toolbar", { name: "Annotate selection" }).count()).toBe(1);
		await page.getByRole("button", { name: /Rewrite/ }).click();
		await mark.click();
		expect(await page.evaluate(() => document.body.dataset.opened)).toBe("note");
	} finally {
		await browser.close();
	}
}, 30000);

test("the selection toolbar goes away once nothing is selected", async () => {
	const { chromium } = createRequire(resolve(import.meta.dir, "../../../spikes/flue-host/package.json"))("playwright");
	const entry = resolve(import.meta.dir, "trajectory-selection-dismiss-fixture.tsx");
	const build = await Bun.build({
		entrypoints: [entry], target: "browser", external: ["*?url", "*.svg"],
		define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
		files: { [entry]: `
			import { createRoot } from "react-dom/client";
			import { TrajectoryCanvas } from "../components/trajectory/TrajectoryCanvas";
			const text = "The first call waits at this line.";
			createRoot(document.querySelector("main")).render(<TrajectoryCanvas mode="transcript" transcript="continuous" onActivateMessage={() => {}} hideControls
				messages={[{ id: "m", role: "assistant", ordinal: 1, text }]} artifacts={[]} annotations={[]}
				onTextSelection={selection => document.body.dataset.opened = selection.intent}
			/>);
		` },
	});
	if (!build.success) throw new AggregateError(build.logs, "Review fixture build failed");
	const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	try {
		const page = await browser.newPage({ reducedMotion: "reduce" });
		page.on("pageerror", (error: Error) => console.error(error.message));
		await page.setContent('<main style="margin:120px;height:400px"></main><p id="away" style="margin:40px">Elsewhere</p>');
		await page.addStyleTag({ content: await Bun.file(resolve(import.meta.dir, "../../styled-system/styles.css")).text() });
		await page.addScriptTag({ type: "module", content: await build.outputs.find(o => o.path.endsWith(".js"))!.text() });
		const words = page.locator("[data-message-text]");
		await words.waitFor({ timeout: 4000 });
		const toolbar = page.getByRole("toolbar", { name: "Annotate selection" });
		const select = async () => {
			const bounds = (await words.boundingBox())!;
			const y = bounds.y + 6;
			await page.mouse.move(bounds.x + 1, y);
			await page.mouse.down();
			await page.mouse.move(bounds.x + 80, y, { steps: 8 });
			await page.mouse.up();
			await toolbar.waitFor({ timeout: 2000 });
		};
		await select();
		await page.locator("#away").click();
		await toolbar.waitFor({ state: "detached", timeout: 2000 });
		await select();
		await page.evaluate(() => getSelection()!.removeAllRanges());
		await toolbar.waitFor({ state: "detached", timeout: 2000 });
		await select();
		await page.getByRole("button", { name: /Rewrite/ }).click();
		expect(await page.evaluate(() => document.body.dataset.opened)).toBe("rewrite");
		expect(await toolbar.count()).toBe(0);
	} finally {
		await browser.close();
	}
}, 30000);
