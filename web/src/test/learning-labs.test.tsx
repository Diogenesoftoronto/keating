import { describe, expect, test } from "bun:test";
import { runInNewContext, Script } from "node:vm";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { compileOpenUISourceToSharedDocument, validateUiDocument } from "@keating/learner-contracts";
import { buildCodingProgram, type CodingRunResult } from "../components/labs/coding-runner";
import { buildMusicDocument } from "../components/labs/music-document";
import { MUSIC_CONTROLS_PRELUDE, MUSIC_PLAYER_SCRIPT } from "../components/labs/music-player";
import { TWO_SUM_CHALLENGE, MUSIC_LAB_EXAMPLES } from "../components/labs/examples";
import { CodingChallenge } from "../components/CodingChallenge";
import { MusicLab } from "../components/MusicLab";

function executeFixture(code: string, tests = TWO_SUM_CHALLENGE.tests): Promise<CodingRunResult & { kind: string; message?: string }> {
	return new Promise((resolve) => {
		runInNewContext(buildCodingProgram(code, "twoSum", tests), { self: { postMessage: resolve }, structuredClone, performance }, { timeout: 1000 });
	});
}

describe("coding exercise harness", () => {
	test("runs the authored sample inputs and distinguishes successes from wrong outputs", async () => {
		const correct = await executeFixture("function twoSum(nums, target) { for(let i=0;i<nums.length;i++) for(let j=i+1;j<nums.length;j++) if(nums[i]+nums[j]===target) return [i,j]; }");
		expect(correct.kind).toBe("result");
		expect(correct.cases.map((result) => result.passed)).toEqual([true, true, true]);
		const incorrect = await executeFixture("function twoSum() { return [0,1]; }");
		expect(incorrect.cases.map((result) => result.passed)).toEqual([true, false, true]);
		expect(incorrect.cases[1]?.actual).toEqual([0, 1]);
	});
	test("handles promises, order-independent object keys, and per-case exceptions", async () => {
		const object = await executeFixture("async function twoSum() { return {b: 2, a: 1}; }", [{ id: "object", label: "Object", args: [], expected: { a: 1, b: 2 } }]);
		expect(object.cases[0]?.passed).toBe(true);
		const thrown = await executeFixture('function twoSum() { throw new Error("Try a different index"); }');
		expect(thrown.cases.every((item) => !item.passed && item.error === "Try a different index")).toBe(true);
	});
	test("reports an absent entrypoint and rejects code injected through its name", async () => {
		const result = await executeFixture("const other = 2;");
		expect(result.kind).toBe("error");
		expect(result.message).toContain("Define a function named twoSum");
		expect(() => buildCodingProgram("", "solve(); fetch('secret')", [])).toThrow("valid function name");
	});
	test("renders a named editor and deliberate run controls, with no invented initial results", () => {
		const html = renderToStaticMarkup(<CodingChallenge node={TWO_SUM_CHALLENGE} />);
		expect(html).toContain("Your JavaScript solution");
		expect(html).toContain("Run tests");
		expect(html).toContain('data-test-result="pending"');
		expect(html).not.toContain('data-test-result="passed"');
	});
	test("bounds displayed outputs without changing the comparison result", async () => {
		const result = await executeFixture('function twoSum() { return "x".repeat(8000); }', [{ id: "long", label: "Long result", args: [], expected: "short" }]);
		expect(result.cases[0]?.passed).toBe(false);
		expect(String(result.cases[0]?.actual).length).toBeLessThanOrEqual(2049);
	});
});

describe("music lab isolation", () => {
	test("keeps code containing HTML boundaries inside JSON data", () => {
		const code = '</script><script>parent.alert("no")</script>';
		const html = buildMusicDocument(code, "https://keating.example");
		expect(html).not.toContain(code);
		const settings = html.match(/<script id="settings" type="application\/json">(.*?)<\/script>/s)?.[1];
		expect(JSON.parse(settings!).code).toBe(code);
		expect(html).toContain("/vendor/strudel-web-1.3.0/index.js");
		expect(html).toContain("connect-src 'none'");
	});
	test("renders an opaque frame and preserves disabled source without mounting playback", () => {
		const html = renderToStaticMarkup(<MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} />);
		expect(html).toContain('sandbox="allow-scripts"');
		expect(html).not.toContain("allow-same-origin");
		expect(html).toContain("Sound starts when you press Play.");
		const disabled = renderToStaticMarkup(<MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} disabled />);
		expect(disabled).not.toContain("<iframe");
		expect(disabled).toContain("setcpm(controls.tempo / 4)");
	});
	test("renders stable inert markup when a server test has a window stub without location", () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
		try {
			Object.defineProperty(globalThis, "window", { value: {}, configurable: true, writable: true });
			const html = renderToStaticMarkup(<MusicLab node={MUSIC_LAB_EXAMPLES.timbre} />);
			expect(html).toContain('sandbox="allow-scripts"');
			expect(html).not.toContain("srcDoc=");
		} finally {
			if (previous) Object.defineProperty(globalThis, "window", previous);
			else Reflect.deleteProperty(globalThis, "window");
		}
	});
	test("keeps controls as numeric data and ships a syntactically valid isolated controller", () => {
		const node = MUSIC_LAB_EXAMPLES.timbre;
		const html = buildMusicDocument(node.code, "https://keating.example", node);
		const settings = JSON.parse(html.match(/<script id="settings" type="application\/json">(.*?)<\/script>/s)![1]!);
		expect(settings.controls).toEqual(node.controls);
		expect(settings.visualization).toBe("scope");
		expect(() => new Script(MUSIC_PLAYER_SCRIPT)).not.toThrow();
		expect(html).toContain('id="visual" role="img"');
		expect(html).toContain('<details id="edit">');
	});
	test("Play reaches the evaluator after Strudel publishes its own global apply function", async () => {
		const drawing = new Proxy({}, { get: () => () => undefined });
		const elements = new Map<string, Record<string, any>>();
		const element = (id: string): Record<string, any> => {
			if (!elements.has(id)) elements.set(id, {
				textContent: "", value: "", dataset: {}, style: { setProperty() {} }, listeners: {},
				clientWidth: 300, clientHeight: 160, width: 300, height: 160,
				getContext: () => drawing, setAttribute() {}, replaceChildren() {}, append() {},
				addEventListener(this: Record<string, any>, type: string, listener: () => unknown) { this.listeners[type] = listener; },
			});
			return elements.get(id)!;
		};
		element("settings").textContent = JSON.stringify({ code: 'note("c3")', controls: [] });
		const evaluated: string[] = [];
		let accidentalApplyCalls = 0;
		const repl = { state: { pattern: { queryArc: () => [] }, error: undefined }, scheduler: { now: () => 0 }, stop() {}, evaluate: async (source: string) => { evaluated.push(source); } };
		const scope: Record<string, any> = {
			document: { getElementById: element, body: {}, addEventListener() {} },
			parent: { postMessage() {} }, devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
			ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
			addEventListener() {}, setTimeout, clearTimeout,
			strudel: { getAudioContext: () => ({ resume: async () => undefined }), initAudio: async () => undefined, hush() {},
				initStrudel: async () => { scope.apply = () => { accidentalApplyCalls++; }; return repl; },
			},
		};
		scope.window = scope;
		runInNewContext(MUSIC_PLAYER_SCRIPT, scope, { timeout: 1000 });
		await Promise.resolve();
		expect(evaluated).toHaveLength(0);
		await element("play").listeners.click();
		expect(evaluated).toHaveLength(1);
		expect(evaluated[0]).toContain('note("c3")');
		expect(accidentalApplyCalls).toBe(0);
		expect(element("visual").dataset.playing).toBe("true");
		element("stop").listeners.click();
		expect(element("visual").dataset.playing).toBe("false");
	});
});

describe("executable labs OpenUI mapping", () => {
	test("compiles and validates the coding/music component data without executing it", () => {
		const coding = { ...TWO_SUM_CHALLENGE, type: undefined };
		const music = { ...MUSIC_LAB_EXAMPLES.polyrhythm, type: undefined };
		const document = compileOpenUISourceToSharedDocument(`root = LearningSurface([coding,music])\ncoding = CodingChallenge(${JSON.stringify(coding)})\nmusic = MusicLab(${JSON.stringify(music)})`, { documentId: "labs" });
		expect(document.nodes.map((node) => node.type)).toEqual(["coding-challenge", "music-lab"]);
		expect(validateUiDocument(document)).toBe(true);
		const invalid = structuredClone(document);
		if (invalid.nodes[0]?.type === "coding-challenge") invalid.nodes[0].entrypoint = "solve();";
		expect(validateUiDocument(invalid)).toBe(false);
	});
	test("preserves live music controls and rejects invalid ranges, duplicate ids, and unknown visualization modes", () => {
		const music = { ...MUSIC_LAB_EXAMPLES.timbre, type: undefined };
		const source = `root = LearningSurface([music])\nmusic = MusicLab(${JSON.stringify(music)})`;
		const document = compileOpenUISourceToSharedDocument(source, { documentId: "music-controls" });
		expect(document.nodes[0]).toMatchObject({ controls: MUSIC_LAB_EXAMPLES.timbre.controls, visualization: "scope" });
		for (const patch of [
			{ controls: [{ id: "tempo", label: "Tempo", min: 80, max: 40, value: 60 }] },
			{ controls: [{ id: "tempo", label: "Tempo", min: 40, max: 80, value: 100 }] },
			{ controls: [music.controls![0], music.controls![0]] },
			{ visualization: "random" },
		]) expect(validateUiDocument({ ...document, nodes: [{ ...document.nodes[0], ...patch }] })).toBe(false);
	});
});

test("the pinned Strudel compiler keeps controls numeric and produces the intended notes and harmonics", async () => {
	const scope: Record<string, any> = {
		window: { addEventListener() {} }, document: { currentScript: null, addEventListener() {}, querySelector: () => null },
		console: { log() {}, warn() {}, error() {} }, performance, setTimeout, clearTimeout,
	};
	runInNewContext(readFileSync(new URL("../../public/vendor/strudel-web-1.3.0/index.js", import.meta.url), "utf8"), scope, { timeout: 1000 });
	const runtime = scope.strudel;
	await runtime.evalScope(runtime);
	runtime.miniAllStrings();
	const repl = runtime.repl({ getTime: () => 0, defaultOutput() {}, transpiler: runtime.transpiler, setInterval: () => 0, clearInterval() {} });
	async function notes(kind: keyof typeof MUSIC_LAB_EXAMPLES, overrides: Record<string, number> = {}) {
		const node = MUSIC_LAB_EXAMPLES[kind];
		scope.__keatingMusicControls = Object.freeze({ ...Object.fromEntries(node.controls!.map((control) => [control.id, control.value])), ...overrides });
		const pattern = await repl.evaluate(MUSIC_CONTROLS_PRELUDE + node.code, false);
		expect(repl.state.error).toBeUndefined();
		return pattern.queryArc(0, 1).map((event: { value: Record<string, unknown> }) => event.value);
	}
	expect(await notes("polyrhythm")).toHaveLength(7);
	expect(await notes("polyrhythm", { lowPulses: 5 })).toHaveLength(9);
	expect((await notes("intervals")).map((value: Record<string, unknown>) => Number(value.note))).toEqual([60, 63]);
	expect((await notes("intervals", { interval: 12 })).map((value: Record<string, unknown>) => Number(value.note))).toEqual([60, 72]);
	const harmonics = await notes("timbre");
	expect(harmonics.map((value: Record<string, unknown>) => value.freq)).toEqual([220, 440, 660]);
	expect(harmonics.every((value: Record<string, unknown>) => Number.isFinite(value.gain))).toBe(true);
	expect((await notes("timbre", { second: 0, third: 0 })).map((value: Record<string, unknown>) => value.gain)).toEqual([0.12, 0, 0]);
});
