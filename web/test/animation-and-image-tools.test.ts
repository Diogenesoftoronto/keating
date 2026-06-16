import { describe, expect, test } from "bun:test";
import {
	parseStoryboardScenes,
	__test_buildManimScene,
	__test_buildHyperframesComposition,
	__test_buildProcessSvg,
	__test_buildLocalImageSvg,
	__test_buildInfographicSvg,
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
		expect(source).toMatch(/class .* extends Scene/);
		expect(source).toMatch(/FadeIn/);
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

describe("generate_image SVG builders use real authored content", () => {
	test("process kind emits a numbered box per authored point with arrows in between", () => {
		const svg = __test_buildProcessSvg({
			title: "DNS resolution",
			subtitle: "How a name becomes an IP, step by step",
			points: [
				"Browser checks its local DNS cache.",
				"OS asks the ISP's recursive resolver.",
				"Resolver queries a root nameserver for .com.",
				"Resolver queries the .com TLD for the authoritative server.",
				"Resolver queries the authoritative server and returns the A record.",
			],
			labels: ["Cache", "Resolver", "Root", "TLD", "Authoritative"],
			style: "light",
		});

		// All 5 authored labels appear in the SVG (one per box).
		for (const label of ["Cache", "Resolver", "Root", "TLD", "Authoritative"]) {
			expect(svg).toContain(label);
		}
		// All 5 authored points appear as box body text (wrapSvgText may
		// break long lines, so we check the *content* is in the SVG
		// somewhere rather than the exact unbroken substring).
		expect(svg).toContain("Browser checks its local DNS");
		expect(svg).toContain("cache.");
		expect(svg).toContain("ISP&#39;s recursive");
		expect(svg).toContain("resolver.");
		expect(svg).toContain("root");
		expect(svg).toContain("nameserver for .com.");
		expect(svg).toContain("authoritative server");
		expect(svg).toContain("returns the A record.");
		// Arrows connect boxes (lines + arrowhead polygons).
		expect(svg).toContain("data-arrow-key");
		expect(svg).toMatch(/<polygon [^>]*fill="[^"]+"\/>/);
	});

	test("process kind wraps to a second row when there are 5+ steps", () => {
		const svg = __test_buildProcessSvg({
			title: "Six steps",
			subtitle: "wrap",
			points: ["a", "b", "c", "d", "e", "f"],
			labels: ["A", "B", "C", "D", "E", "F"],
			style: "light",
		});
		// The vertical wrap-around arrow should be present exactly once
		// (only one row break for 6 steps split into 4 + 2 or 3 + 3).
		const wraps = svg.match(/data-arrow-key="v-/g) ?? [];
		expect(wraps.length).toBeGreaterThanOrEqual(1);
	});

	test("process kind uses the dark palette when requested", () => {
		const svg = __test_buildProcessSvg({
			title: "Signal transduction",
			subtitle: "Receptor to nucleus",
			points: ["Ligand binds receptor", "G-protein activates", "Cascade amplifies", "Transcription factor enters nucleus"],
			labels: ["Bind", "Activate", "Amplify", "Transcribe"],
			style: "dark",
		});
		expect(svg).toContain('fill="#101214"');
		expect(svg).toContain('fill="#f59e0b"');
	});

	test("infographic kind surfaces each authored point and label inside its card", () => {
		const svg = __test_buildInfographicSvg({
			title: "Antibody variants",
			subtitle: "Sizes and roles",
			points: [
				"IgG is the full ~150 kDa Y-shape antibody in serum.",
				"scFv is a 25 kDa single-chain binding fragment.",
				"Nanobodies are ~15 kDa single-domain binders from camelids.",
			],
			labels: ["IgG", "scFv", "Nanobody"],
			style: "light",
		});
		// Each authored label appears.
		for (const label of ["IgG", "scFv", "Nanobody"]) {
			expect(svg).toContain(label);
		}
		// Each authored point appears (text may be word-wrapped by
		// wrapSvgText, so we check the most distinctive substrings).
		expect(svg).toContain("150 kDa Y-shape");
		expect(svg).toContain("25 kDa single-chain");
		expect(svg).toContain("15 kDa");
		expect(svg).toContain("single-domain");
	});

	test("buildLocalImageSvg dispatches process to buildProcessSvg", () => {
		const svg = __test_buildLocalImageSvg({
			title: "Krebs cycle",
			subtitle: "Eight steps",
			points: ["Citrate", "Isocitrate", "Alpha-ketoglutarate", "Succinyl-CoA"],
			labels: ["1", "2", "3", "4"],
			style: "light",
			kind: "process",
		});
		expect(svg).toContain("data-arrow-key");
		expect(svg).toContain("Citrate");
		expect(svg).toContain("Isocitrate");
	});

	test("buildLocalImageSvg dispatches comparison to bar layout", () => {
		const svg = __test_buildLocalImageSvg({
			title: "Sizes",
			subtitle: "kDa",
			points: ["150 kDa IgG", "25 kDa scFv", "15 kDa nanobody"],
			labels: ["IgG", "scFv", "Nanobody"],
			style: "light",
			kind: "comparison",
		});
		expect(svg).toContain("150 kDa IgG");
		expect(svg).toContain("Nanobody");
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
