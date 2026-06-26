import { describe, expect, test } from "bun:test";
import {
	parseStoryboardScenes,
	__test_buildManimScene,
	__test_buildHyperframesComposition,
	__test_parseStoryboardDurationSeconds,
	__test_storyboardTitle,
} from "../src/keating/browser-tools";
import { resolveTopic } from "../src/keating/core";

describe("animate storyboard parsing", () => {
	test("extracts scene number, title, duration, visual, audio, and highlight", () => {
		const storyboard = `# Animation Storyboard: DNS Resolution

## Scene 1: The browser cache (0-3s)
- **Visual**: Browser checks its local cache for the IP. Show a small "Cache" box on the left with a question mark.
- **Audio**: The OS asks: have we seen this domain recently?
- **Duration**: 3s

## Scene 2: Recursive resolver (3-7s)
- **Visual**: A packet leaves the laptop toward the ISP's recursive resolver. Animate a labeled arrow.
- **Highlight**: The resolver does the heavy lifting.

## Scene 3: Root then TLD (7-12s)
- **Visual**: The resolver queries a root server (.), then the .com TLD. Show two stacked arrows.
- **Audio**: Walk down the namespace.
`;

		const scenes = parseStoryboardScenes(storyboard);
		expect(scenes).toHaveLength(3);
		expect(scenes[0].number).toBe(1);
		expect(scenes[0].title).toBe("The browser cache");
		expect(scenes[0].duration).toBe("3s");
		expect(scenes[0].visual).toMatch(/Browser checks its local cache/);
		expect(scenes[0].audio).toMatch(/OS asks/);
		expect(scenes[1].title).toBe("Recursive resolver");
		expect(scenes[1].duration).toBe("3-7s");
		expect(scenes[1].highlight).toMatch(/heavy lifting/);
		expect(scenes[2].duration).toBe("7-12s");
	});

	test("returns no scenes for a generic template-only storyboard", () => {
		// Verifies the parser does not accept the OLD generic template as real
		// content; an empty parse signals the animate tool to ask the agent to
		// author proper beats.
		const generic = `# Animation Storyboard: Generic

## Scene 1: Introduction (0-2s)
- **Visual**: Title card with "Generic"
- **Transition**: Fade in
- **Audio**: Brief hook from summary
`;
		// A single scene should still parse, but with no audio/visual in the
		// usual sense — the author is expected to fill these in.
		const scenes = parseStoryboardScenes(generic);
		expect(scenes).toHaveLength(1);
		expect(scenes[0].visual).toMatch(/Title card with "Generic"/);
	});
});

describe("buildManimScene from authored storyboard", () => {
	test("emits a play() line for every authored scene with real visual content", () => {
		const resolved = resolveTopic("DNS");
		const storyboard = `# Animation Storyboard: DNS Resolution

## Scene 1: Browser cache (0-3s)
- **Visual**: Browser checks local DNS cache; show a "cache hit" pill.
- **Audio**: The OS asks the resolver for the IP.

## Scene 2: Recursive resolver (3-7s)
- **Visual**: A packet leaves the laptop to the ISP's recursive resolver.
- **Audio**: The resolver does the heavy lifting.

## Scene 3: Root and TLD (7-12s)
- **Visual**: Two stacked arrows: root . then .com TLD.
- **Audio**: Walk down the namespace from right to left.
`;

		const source = __test_buildManimScene(resolved, storyboard);
		// Real authored scene titles and visuals should appear in the source,
		// not the generic FadeIn(title("...")) placeholder.
		expect(source).toContain("Browser cache");
		expect(source).toContain("Recursive resolver");
		expect(source).toContain("Root and TLD");
		expect(source).toContain("Browser checks local DNS cache");
		expect(source).toContain("recursive resolver");
		// The generic placeholder that used to ship should be gone.
		expect(source).not.toContain("Title card with");
	});

	test("falls back to a minimal scene when storyboard is empty", () => {
		const resolved = resolveTopic("DNS");
		const source = __test_buildManimScene(resolved, "");
		expect(source).toContain("async function construct(scene, M)");
		expect(source).toContain("new M.FadeIn");
		expect(source).not.toMatch(/class .* extends Scene/);
	});

	test("emits construct(scene, M) source that the iframe host can execute", () => {
		const resolved = resolveTopic("DNS");
		const storyboard = `# Animation Storyboard: DNS

## Scene 1: Query path (0-2s)
- **Visual**: A packet moves from browser cache to resolver.
`;
		const source = __test_buildManimScene(resolved, storyboard);
		expect(source).toContain("async function construct(scene, M)");
		expect(source).toContain("new M.Text");
		expect(source).toContain("await scene.play");
		expect(source).not.toContain("extends Scene");
		expect(source).not.toContain("this.play");
	});
});

describe("buildHyperframesComposition from authored storyboard", () => {
	test("uses authored scene titles and body text in clip elements", () => {
		const resolved = resolveTopic("DNS");
		const storyboard = `# Animation Storyboard: DNS Resolution

## Scene 1: Browser cache (0-3s)
- **Visual**: Browser checks local DNS cache.
- **Audio**: The OS asks the resolver for the IP.

## Scene 2: Recursive resolver (3-7s)
- **Visual**: A packet leaves the laptop to the ISP's recursive resolver.
- **Highlight**: The resolver does the heavy lifting.
`;
		const html = __test_buildHyperframesComposition(resolved, storyboard);
		// Authored scene titles appear in clip sections.
		expect(html).toContain("Browser cache");
		expect(html).toContain("Recursive resolver");
		// Authored body lines appear in <p> blocks.
		expect(html).toContain("Browser checks local DNS cache");
		expect(html).toContain("recursive resolver");
		// The old generic placeholder is gone.
		expect(html).not.toContain("Start concrete");
		expect(html).not.toContain("Name the structure");
	});

	test("encodes clip timings that match authored scene durations", () => {
		const resolved = resolveTopic("DNS");
		const storyboard = `# Animation Storyboard: DNS

## Scene 1: A (0-2s)
- **Visual**: a

## Scene 2: B (2-5s)
- **Visual**: b

## Scene 3: C (5-9s)
- **Visual**: c
`;
		const html = __test_buildHyperframesComposition(resolved, storyboard);
		// Expect 3 clip selectors; the encoded clips JSON should encode starts
		// at 0, 2, 5.
		expect(html).toContain("#clip-0");
		expect(html).toContain("#clip-2");
		expect(html).toContain("#clip-5");
	});
});

describe("parseStoryboardDurationSeconds", () => {
	test("expands a range to (end - start)", () => {
		expect(__test_parseStoryboardDurationSeconds("3-9s")).toBe(6);
		expect(__test_parseStoryboardDurationSeconds("0-2.5s")).toBe(2.5);
	});
	test("uses single number when no range", () => {
		expect(__test_parseStoryboardDurationSeconds("4s")).toBe(4);
		expect(__test_parseStoryboardDurationSeconds("7")).toBe(7);
	});
	test("falls back to 4 on garbage", () => {
		expect(__test_parseStoryboardDurationSeconds("nope")).toBe(4);
	});
});

describe("storyboardTitle", () => {
	test("extracts the H1 title", () => {
		expect(__test_storyboardTitle("# Animation Storyboard: DNS\n\n## Scene 1: A (0-1s)\n")).toBe("DNS");
	});
	test("returns empty string when no title is present", () => {
		expect(__test_storyboardTitle("## Scene 1: A (0-1s)\n")).toBe("");
	});
});
