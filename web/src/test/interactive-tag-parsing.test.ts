import { describe, expect, it } from "bun:test";

import { __test_parseInteractiveSegments as parseInteractiveSegments } from "../components/AssistantChatPanel";
import { parseAnimationPayload } from "../components/AnimatedScene";

/** Emit a tag exactly the way the browser tools do (double-stringified JSON). */
function emitTag(tag: string, payload: unknown, attr = "json"): string {
	return `<keating-${tag} ${attr}=${JSON.stringify(JSON.stringify(payload))} />`;
}

describe("interactive tag parsing", () => {
	it("parses an animation tag whose body contains '>' and '/>' (hyperframes HTML)", () => {
		const payload = {
			topic: "Fourier series",
			kind: "hyperframes",
			summary: "A spinning epicycle demo",
			body: '<!doctype html><html><body><div class="stage"><svg viewBox="0 0 10 10"><path d="M0,0 L5,5"/></svg></div><script>const f = (x) => x > 3 ? "big" : "small";</script></body></html>',
		};
		const text = `[artifact://animation/abc]\n\n${emitTag("animation", payload)}`;

		const segments = parseInteractiveSegments(text);
		const animation = segments.find((s) => s.type === "animation");
		expect(animation).toBeDefined();
		if (!animation || animation.type !== "animation") throw new Error("unreachable");

		const decoded = parseAnimationPayload(JSON.parse(animation.json));
		expect(decoded).toEqual({
			topic: payload.topic,
			kind: "hyperframes",
			summary: payload.summary,
			body: payload.body,
		});
	});

	it("parses a manim animation body containing arrow functions ('=>')", () => {
		const payload = {
			topic: "Derivatives",
			kind: "manim",
			body: "async function construct(scene, M) { const pts = [1, 2].map((x) => x * 2); }",
		};
		const segments = parseInteractiveSegments(emitTag("animation", payload));
		expect(segments.filter((s) => s.type === "animation")).toHaveLength(1);
	});

	it("handles payloads with escaped quotes", () => {
		const payload = {
			topic: "Quotes",
			kind: "hyperframes",
			body: '<div title="say \\"hi\\"">x > y</div>',
		};
		const segments = parseInteractiveSegments(emitTag("animation", payload));
		const animation = segments.find((s) => s.type === "animation");
		expect(animation).toBeDefined();
		if (!animation || animation.type !== "animation") throw new Error("unreachable");
		const decoded = parseAnimationPayload(JSON.parse(animation.json));
		expect(decoded?.body).toBe(payload.body);
	});

	it("round-trips every double-stringified tag type", () => {
		const cases: Array<[string, Record<string, unknown>]> = [
			["quiz", { title: "Quiz", questions: [] }],
			["goal", { title: "Learn calculus" }],
			["image", { url: "https://example.com/a.png", alt: "a" }],
			["quiz-result", { resultId: "r1", score: 2 }],
			["quiz-grade", { resultId: "r1", grades: [] }],
			["deck", { id: "d1", title: "Deck", cards: [] }],
		];
		for (const [tag, payload] of cases) {
			const segments = parseInteractiveSegments(`before ${emitTag(tag, payload)} after`);
			const seg = segments.find((s) => s.type === tag) as { json: string } | undefined;
			expect(seg).toBeDefined();
			expect(JSON.parse(JSON.parse(seg!.json))).toEqual(payload);
		}
	});

	it("parses scene tags carrying markdown", () => {
		const markdown = "# Scene\n\nSome **bold** text with a > blockquote char";
		const segments = parseInteractiveSegments(emitTag("scene", markdown, "markdown"));
		const scene = segments.find((s) => s.type === "scene");
		expect(scene).toBeDefined();
		if (!scene || scene.type !== "scene") throw new Error("unreachable");
		expect(scene.markdown).toBe(JSON.stringify(markdown));
	});

	it("keeps surrounding text segments intact around multiple tags", () => {
		const text = [
			"Intro with an inequality 2 > 1 in prose.",
			emitTag("goal", { title: "G" }),
			"Middle text.",
			emitTag("deck", { id: "d", title: "D", cards: [] }),
			"Outro.",
		].join("\n");
		const segments = parseInteractiveSegments(text);
		const types = segments.map((s) => s.type);
		expect(types).toEqual(["text", "goal", "text", "deck", "text"]);
		const first = segments[0];
		if (first.type !== "text") throw new Error("unreachable");
		expect(first.content).toContain("2 > 1");
	});

	it("still parses legacy unquoted payloads via the fallback branch", () => {
		// Older question tags were emitted as a bare object literal without
		// surrounding quotes; the fallback [^>]+ branch must still match them.
		const text = '<keating-question json={"prompt":"What is 2+2?","fields":[]} />';
		const segments = parseInteractiveSegments(text);
		const question = segments.find((s) => s.type === "question");
		expect(question).toBeDefined();
		if (!question || question.type !== "question") throw new Error("unreachable");
		// The greedy fallback keeps the trailing space (legacy behavior);
		// JSON.parse tolerates surrounding whitespace.
		expect(JSON.parse(question.json)).toEqual({ prompt: "What is 2+2?", fields: [] });
	});

	it("returns a single text segment when no tags are present", () => {
		expect(parseInteractiveSegments("plain text, even with > chars")).toEqual([
			{ type: "text", content: "plain text, even with > chars" },
		]);
	});
});
