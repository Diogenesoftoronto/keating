import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import {
	compileOpenUISourceToSharedDocument,
	INTERACTIVE_KINDS,
	INTERACTIVE_LIMITS,
	INTERACTIVE_REPLY_CONFIG_FIXTURE,
	UI_CONTRACT_VERSION,
	validateUiActionAgainstDocument,
	type InteractiveKind,
	type JsonObject,
	type UiActionReceipt,
	type UiDocument,
	type UiInteractiveNode,
} from "@keating/learner-contracts";
import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import { INTERACTIVE_REPLY_LOADERS, interactiveConfigProblems, loadInteractiveReply } from "../components/interactive-replies/registry";
import { interactiveShare, interactiveShareEvent } from "../components/interactive-replies/InteractiveReplyRenderer";

const at = "2026-11-24T12:00:00.000Z";

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}

function documentOf(nodes: UiInteractiveNode[], id = "replies"): UiDocument {
	return {
		schemaVersion: UI_CONTRACT_VERSION, id, revision: 1, lifecycle: "ready", retention: "workspace",
		supportedSurfaces: ["web", "desktop", "mobile", "terminal"], nodes, createdAt: at, updatedAt: at,
	} as UiDocument;
}

async function staticHtml(document: UiDocument, receipts: UiActionReceipt[] = []): Promise<string> {
	const { prelude } = await prerender(createElement(SharedUiDocumentRenderer, { document, receipts, onAction: () => true }));
	return new Response(prelude).text();
}

/* Configs reach the renderer as JSON from the model, so every preset makes a JSON round trip. */
const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonObject;

async function presetNodes(kind: InteractiveKind): Promise<UiInteractiveNode[]> {
	const module = await loadInteractiveReply(kind);
	return Object.entries(module.presets).map(([preset, config]) => ({ type: "interactive", id: `${kind}-${preset}`, kind, title: preset, config: roundTrip(config) }));
}

describe("interactive reply registry", () => {
	test("every contract kind has a loader", () => {
		expect(Object.keys(INTERACTIVE_REPLY_LOADERS).sort()).toEqual([...INTERACTIVE_KINDS].sort());
	});

	for (const kind of INTERACTIVE_KINDS) {
		test(`${kind}: every preset survives a JSON round trip and passes its validator`, async () => {
			const module = await loadInteractiveReply(kind);
			const names = Object.keys(module.presets);
			expect(names.length).toBeGreaterThan(0);
			for (const name of names) expect({ name, problems: interactiveConfigProblems(module, roundTrip(module.presets[name])) }).toEqual({ name, problems: [] });
		});

		/* A lane re-sync can change a preset; the contract fixture and the model-facing examples must still render. */
		test(`${kind}: the contract fixture and every catalogue example pass its validator`, async () => {
			const module = await loadInteractiveReply(kind);
			expect(interactiveConfigProblems(module, roundTrip(INTERACTIVE_REPLY_CONFIG_FIXTURE[kind]))).toEqual([]);
			const section = readFileSync(join(import.meta.dir, "../components/interactive-replies/catalogue", `${kind}.md`), "utf8");
			const programs = [...section.matchAll(/```openui[^\n]*\n([\s\S]*?)\n```/gu)].map((match) => match[1]!);
			expect(programs.length).toBeGreaterThan(0);
			for (const [index, program] of programs.entries()) {
				const node = compileOpenUISourceToSharedDocument(program, { documentId: `catalogue-${kind}-${index}`, retention: "ephemeral" }).nodes.find((entry) => entry.type === "interactive");
				expect({ index, problems: node?.type === "interactive" ? interactiveConfigProblems(module, node.config) : ["no interactive node"] }).toEqual({ index, problems: [] });
			}
		});
	}

	/* Configs come from a model, so a validator must answer every malformed shape with problems, never a throw:
	   non-objects, each field removed, each field swapped for a value of the wrong type, and the same one
	   level down inside arrays and objects. */
	const wrongValues: unknown[] = [null, undefined, 0, -1, Number.NaN, "", "x", true, [], [null], {}, { x: 1 }];
	function* mutations(config: unknown): Generator<unknown> {
		yield* wrongValues;
		if (!config || typeof config !== "object") return;
		const entries = Array.isArray(config) ? config.map((value, key) => [key, value] as const) : Object.entries(config);
		for (const [key, value] of entries) {
			const without = Array.isArray(config) ? config.filter((_, index) => index !== key) : { ...config };
			if (!Array.isArray(config)) delete (without as Record<string, unknown>)[key as string];
			yield without;
			for (const wrong of wrongValues) yield Array.isArray(config) ? config.map((item, index) => (index === key ? wrong : item)) : { ...config, [key]: wrong };
		}
	}
	for (const kind of INTERACTIVE_KINDS) {
		test(`${kind}: the validator returns string[] and never throws on malformed configs`, async () => {
			const module = await loadInteractiveReply(kind);
			const failures: string[] = [];
			let checked = 0;
			const check = (config: unknown, where: string) => {
				checked++;
				try {
					const problems: unknown = module.validate(config);
					if (!Array.isArray(problems) || problems.some((problem) => typeof problem !== "string")) failures.push(`${where}: returned ${JSON.stringify(problems)}`);
				} catch (error) {
					failures.push(`${where}: threw ${error instanceof Error ? error.message : String(error)}`);
				}
			};
			for (const [name, preset] of Object.entries(module.presets)) {
				const config = roundTrip(preset);
				let index = 0;
				for (const top of mutations(config)) check(top, `${name} #${index++}`);
				for (const [key, value] of Object.entries(config)) {
					if (!value || typeof value !== "object") continue;
					let inner = 0;
					for (const nested of mutations(value)) check({ ...config, [key]: nested }, `${name}.${key} #${inner++}`);
					const first = Array.isArray(value) ? value[0] : Object.values(value)[0];
					const firstKey = Array.isArray(value) ? 0 : Object.keys(value)[0];
					if (!first || typeof first !== "object") continue;
					inner = 0;
					for (const deep of mutations(first)) {
						const replaced = Array.isArray(value) ? [deep, ...value.slice(1)] : { ...value, [firstKey as string]: deep };
						check({ ...config, [key]: replaced }, `${name}.${key}.${String(firstKey)} #${inner++}`);
					}
				}
			}
			expect(checked).toBeGreaterThan(100);
			expect(failures.slice(0, 20)).toEqual([]);
		}, 60000);
	}

	test("a config the component rejects shows the calm fallback line, not the component", async () => {
		const markup = await staticHtml(documentOf([{ type: "interactive", id: "bad", kind: "data-explorer", title: "Broken", config: { title: "Broken", rows: [] } }]));
		expect(markup).toContain('data-interactive-fallback="data-explorer"');
		expect(markup).toContain("could not be shown here");
		expect(markup).not.toContain("data-simulation=");
	});
});

describe("sharing", () => {
	test("a share is bounded to the contract, dispatches against the document and shows the Shared receipt", async () => {
		const [node] = await presetNodes("sort-board");
		const document = documentOf([node!]);
		const long = "x".repeat(5000);
		const bounded = interactiveShare({ learner: long, data: long, reply: long });
		expect(bounded.learner.length).toBe(INTERACTIVE_LIMITS.shareLearner);
		expect(bounded.data.length).toBe(INTERACTIVE_LIMITS.shareData);
		expect(bounded.analysis.length).toBe(INTERACTIVE_LIMITS.shareAnalysis);

		const event = interactiveShareEvent(node!, { learner: "I sorted the cards.", data: "4 of 4 in place.", reply: "Every card is where it belongs." });
		expect(event.intent).toEqual({ type: "share-interactive", nodeId: node!.id, kind: "sort-board", share: { learner: "I sorted the cards.", data: "4 of 4 in place.", analysis: "Every card is where it belongs." } });
		expect(event.humanFriendlyMessage).toBe("I sorted the cards.");
		const dispatch = dispatchSharedUiAction(new MemoryStorage(), document, event.intent, at, { sessionId: "s1", humanFriendlyMessage: event.humanFriendlyMessage });
		expect(dispatch.receipt.state).toBe("completed");
		expect(validateUiActionAgainstDocument(dispatch.action, document)).toBe(true);

		// The receipt line sits outside the lazy component, so a synchronous render (which stops at the
		// Suspense fallback and never reaches Dragology) is enough to see it.
		const markup = renderToStaticMarkup(createElement(SharedUiDocumentRenderer, { document, receipts: [dispatch.receipt], onAction: () => true }));
		expect(markup).toContain("Your tutor has your result.");
		expect(markup).toContain('data-shared="true"');
	});
});

/* The shared renderer's graph reaches Vite-only imports (\`?url\` assets, \`?raw\` text, \`?worker\`). None of them
   run while these replies render, so the fixture build stubs them: raw text is inlined, the rest become "". */
const viteSuffixes: import("bun").BunPlugin = {
	name: "vite-suffixes",
	setup(build) {
		build.onResolve({ filter: /\?(url|raw|worker|inline|sharedworker)$/ }, (args) => ({ path: args.path, namespace: "vite-suffix", pluginData: { importer: args.importer } }));
		build.onLoad({ filter: /.*/, namespace: "vite-suffix" }, async (args) => {
			const [specifier, suffix] = args.path.split("?") as [string, string];
			if (suffix === "raw" && specifier.startsWith(".")) {
				const importer = (args as unknown as { pluginData?: { importer?: string } }).pluginData?.importer ?? "";
				return { contents: `export default ${JSON.stringify(await Bun.file(resolve(importer, "..", specifier)).text())};`, loader: "js" };
			}
			return { contents: 'export default "";', loader: "js" };
		});
	},
};

/* Every preset of every kind, mounted through SharedUiDocumentRenderer in a real browser (Dragology needs a
   DOM: its floating layers are portals), in the light and dark themes. Uses the repository's browser-test
   dependency, as kit-interactions.test.tsx does. */
describe("interactive replies render through the shared document renderer", () => {
	const spike = "spikes/flue-host/package.json";
	const localSpike = resolve(import.meta.dir, "../../..", spike);
	const packagePath = existsSync(resolve(localSpike, "../node_modules/playwright")) ? localSpike
		: resolve(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim(), "..", spike);
	const fixture = "http://interactive-replies.local/";
	let browser: any;
	let page: any;
	let serve: (route: { request(): { url(): string }; fulfill(options: object): Promise<void>; abort(): Promise<void> }) => Promise<void>;
	const errors: string[] = [];

	beforeAll(async () => {
		const { chromium } = createRequire(packagePath)("playwright");
		const entry = resolve(import.meta.dir, "interactive-replies-fixture.tsx");
		const built = await Bun.build({
			entrypoints: [entry], target: "browser", plugins: [viteSuffixes],
			define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
			files: { [entry]: `
				import { createElement as h } from "react";
				import { createRoot } from "react-dom/client";
				import { INTERACTIVE_KINDS, UI_CONTRACT_VERSION } from "@keating/learner-contracts";
				import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
				import { loadInteractiveReply } from "../components/interactive-replies/registry";
				if (location.search === "?dark") document.documentElement.classList.add("dark");
				const at = "2026-11-24T12:00:00.000Z";
				const documents = await Promise.all(INTERACTIVE_KINDS.map(async kind => {
					const module = await loadInteractiveReply(kind);
					const nodes = Object.entries(module.presets).map(([preset, config]) => ({ type: "interactive", id: kind + "-" + preset, kind, title: preset, config: JSON.parse(JSON.stringify(config)) }));
					return { schemaVersion: UI_CONTRACT_VERSION, id: "replies-" + kind, revision: 1, lifecycle: "ready", retention: "workspace", supportedSurfaces: ["web"], nodes, createdAt: at, updatedAt: at };
				}));
				window.__expected = documents.flatMap(d => d.nodes.map(n => n.id));
				createRoot(document.body.appendChild(document.createElement("div"))).render(
					h("div", { style: location.search === "?resize" ? {} : { maxWidth: "640px" } }, documents.map(d => h(SharedUiDocumentRenderer, { key: d.id, document: d, onAction: () => true }))));
			` },
		});
		if (!built.success) throw new AggregateError(built.logs, "Interactive replies fixture build failed");
		const js = await built.outputs.find((output) => output.path.endsWith(".js"))!.text();
		const css = (await built.outputs.find((output) => output.path.endsWith(".css"))?.text()) ?? "";
		const tokens = await Bun.file(resolve(import.meta.dir, "../../styled-system/styles.css")).text();
		browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
		page = await browser.newPage({ viewport: { width: 420, height: 900 }, reducedMotion: "reduce" });
		page.on("pageerror", (error: Error) => errors.push(`pageerror: ${error.message}`));
		page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
		serve = (route) => {
			const url = route.request().url();
			if (!url.startsWith(fixture)) return route.abort();
			if (url.endsWith("/fixture.js")) return route.fulfill({ contentType: "text/javascript", body: js });
			if (url.endsWith("/fixture.css")) return route.fulfill({ contentType: "text/css", body: tokens + css });
			return route.fulfill({ contentType: "text/html", body: '<!doctype html><link rel="stylesheet" href="/fixture.css"><body><script type="module" src="/fixture.js"></script>' });
		};
		await page.route("**/*", serve);
	}, 60000);
	afterAll(async () => { await browser?.close(); });

	const mounted = (target: any) => target.waitForFunction(() => {
		const expected = (window as { __expected?: string[] }).__expected;
		return expected && document.querySelectorAll(".interactive-reply").length === expected.length && !document.querySelector(".interactive-reply__loading");
	}, null, { timeout: 30000 });

	/* Live resize: layouts that change shape between widths (wrapped labels, compact/wide canvases) must not
	   trip Dragology's lerp between renders. Motion stays on here so the lerp actually runs. */
	test("every preset survives a live resize 320 → 480 → 728 → 1000 → 560 → 320 with no page error", async () => {
		const resizeErrors: string[] = [];
		const live = await browser.newPage({ viewport: { width: 320, height: 900 }, reducedMotion: "no-preference" });
		live.on("pageerror", (error: Error) => resizeErrors.push(`pageerror: ${error.message}`));
		live.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") resizeErrors.push(`console: ${message.text()}`); });
		await live.route("**/*", serve);
		try {
			await live.goto(fixture + "?resize");
			await mounted(live);
			await live.waitForTimeout(400);
			// Through each waypoint in 12px steps, so the next layout lands while the last one is still lerping.
			let from = 320;
			for (const to of [480, 728, 1000, 560, 320]) {
				const step = to > from ? 12 : -12;
				for (let width = from + step; step > 0 ? width < to : width > to; width += step) {
					await live.setViewportSize({ width, height: 900 });
					await live.waitForTimeout(40);
				}
				await live.setViewportSize({ width: to, height: 900 });
				await live.waitForTimeout(300);
				from = to;
			}
			const fallbacks = await live.evaluate(() => [...document.querySelectorAll<HTMLElement>(".interactive-reply")]
				.filter((reply) => reply.querySelector("[data-interactive-fallback], [data-crashed]")).map((reply) => reply.dataset.interactiveNode));
			expect(fallbacks).toEqual([]);
			expect(resizeErrors).toEqual([]);
		} finally {
			await live.close();
		}
	}, 180000);

	/* Anatomy3D draws three.js only where WebGL exists; elsewhere every preset must work in the flat SVG view. */
	test("without WebGL every anatomy preset renders the flat view, with no fallback and no error", async () => {
		const flatErrors: string[] = [];
		const flat = await browser.newPage({ viewport: { width: 420, height: 900 }, reducedMotion: "reduce" });
		flat.on("pageerror", (error: Error) => flatErrors.push(`pageerror: ${error.message}`));
		flat.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") flatErrors.push(`console: ${message.text()}`); });
		await flat.addInitScript(() => {
			const original = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
				return /webgl/i.test(kind) ? null : (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
			} as typeof original;
		});
		await flat.route("**/*", serve);
		try {
			await flat.goto(fixture);
			await mounted(flat);
			await flat.waitForFunction(() => !document.querySelector(".an-loading"), null, { timeout: 30000 });
			const result = await flat.evaluate(() => {
				const replies = [...document.querySelectorAll<HTMLElement>('.interactive-reply[data-interactive-kind="anatomy"]')];
				return {
					count: replies.length,
					flat: replies.filter((reply) => reply.querySelector(".an-flat-note") && reply.querySelector("svg [data-sid]")).length,
					canvases: replies.filter((reply) => reply.querySelector("canvas")).length,
					fallbacks: replies.filter((reply) => reply.querySelector("[data-interactive-fallback], .an-fallback")).map((reply) => reply.dataset.interactiveNode),
				};
			});
			expect(result.count).toBeGreaterThan(0);
			expect(result).toEqual({ count: result.count, flat: result.count, canvases: 0, fallbacks: [] });
			expect(flatErrors).toEqual([]);
		} finally {
			await flat.close();
		}
	}, 60000);

	for (const theme of ["light", "dark"] as const) {
		test(`every preset of every kind mounts with no fallback and no error (${theme})`, async () => {
			errors.length = 0;
			await page.goto(fixture + (theme === "dark" ? "?dark" : ""));
			await page.waitForFunction(() => {
				const expected = (window as { __expected?: string[] }).__expected;
				return expected && document.querySelectorAll(".interactive-reply").length === expected.length && !document.querySelector(".interactive-reply__loading");
			}, null, { timeout: 30000 });
			await page.waitForTimeout(400); // let first-frame measurements and their re-layout settle
			const result = await page.evaluate(() => {
				const expected = (window as unknown as { __expected: string[] }).__expected;
				const replies = [...document.querySelectorAll<HTMLElement>(".interactive-reply")];
				return {
					missing: expected.filter((id) => !replies.some((reply) => reply.dataset.interactiveNode === id)),
					fallbacks: replies.filter((reply) => reply.querySelector("[data-interactive-fallback], .is-fallback, .nl-fallback, .sb-fallback, [data-invalid], [data-crashed]")).map((reply) => reply.dataset.interactiveNode),
					unthemed: replies.filter((reply) => !getComputedStyle(reply).getPropertyValue("--mock-ink").trim()).map((reply) => reply.dataset.interactiveNode),
					ink: getComputedStyle(replies[0]!).getPropertyValue("--mock-ink").trim(),
					paper: getComputedStyle(replies[0]!).getPropertyValue("--mock-surface").trim(),
				};
			});
			expect(result.missing).toEqual([]);
			expect(result.fallbacks).toEqual([]);
			expect(result.unthemed).toEqual([]);
			// The token layer follows the app theme, not the OS.
			expect(result.ink).toBe(theme === "dark" ? "#dcefe0" : "#1c211b");
			expect(result.paper).toBe(theme === "dark" ? "#0c1510" : "#f1ece0");
			expect(errors).toEqual([]);
		}, 60000);
	}
});
