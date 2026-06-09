import { describe, expect, it } from "bun:test";
import {
	buildArtifactHeroMap,
	categorize,
	estimateRowSpan,
	pxToSpan,
} from "../components/session-card-visuals";

describe("categorize", () => {
	it("maps topical keywords to their category", () => {
		expect(categorize("Quantum mechanics intro").key).toBe("physics-math");
		expect(categorize("Recursion in JavaScript").key).toBe("cs");
		expect(categorize("Photosynthesis in plant cells").key).toBe("science");
		expect(categorize("The fall of the Roman empire").key).toBe("history");
		expect(categorize("Color theory and pigments").key).toBe("arts");
		expect(categorize("Spanish grammar basics").key).toBe("language");
	});

	it("falls back to general for unknown or empty titles", () => {
		expect(categorize("").key).toBe("general");
		expect(categorize(undefined).key).toBe("general");
		expect(categorize("Random musings").key).toBe("general");
	});
});

describe("masonry sizing", () => {
	it("never returns a span below the floor", () => {
		expect(pxToSpan(0)).toBeGreaterThanOrEqual(6);
	});

	it("grows with content height", () => {
		expect(pxToSpan(400)).toBeGreaterThan(pxToSpan(120));
	});

	it("estimates a larger span for SVG heroes and long previews", () => {
		const small = estimateRowSpan({ titleLength: 10, previewLength: 20, hasSvgHero: false });
		const large = estimateRowSpan({ titleLength: 80, previewLength: 400, hasSvgHero: true });
		expect(large).toBeGreaterThan(small);
	});
});

describe("buildArtifactHeroMap", () => {
	const storage = {
		getLessonMaps: async () => [
			{ id: "m1", topic: "Cells", createdAt: 1, mmdContent: "graph", svgContent: "<svg/>", sessionId: "s1" },
			{ id: "m2", topic: "Orphan", createdAt: 1, mmdContent: "graph", sessionId: undefined },
		],
		getAnimations: async () => [
			{ id: "a1", topic: "Mitosis", createdAt: 1, storyboard: "", scene: "", manifest: "", sessionId: "s1" },
			{ id: "a2", topic: "Waves", createdAt: 1, storyboard: "", scene: "", manifest: "", sessionId: "s2" },
		],
		getLessonPlans: async () => [
			{ id: "p1", topic: "Algebra", createdAt: 1, updatedAt: 1, content: "", sessionId: "s3" },
		],
	};

	it("picks the richest artifact per session and keeps the map SVG", async () => {
		const heroes = await buildArtifactHeroMap(storage as never);
		// s1 has both a map and an animation; the map (with SVG) wins.
		expect(heroes.get("s1")).toEqual({ type: "map", topic: "Cells", svg: "<svg/>" });
		expect(heroes.get("s2")?.type).toBe("animation");
		expect(heroes.get("s3")?.type).toBe("plan");
	});

	it("ignores artifacts without a session id", async () => {
		const heroes = await buildArtifactHeroMap(storage as never);
		expect([...heroes.keys()].sort()).toEqual(["s1", "s2", "s3"]);
	});
});
