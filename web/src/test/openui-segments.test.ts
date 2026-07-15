import { describe, expect, it } from "bun:test";

import {
	parseOpenUIMessageSegments,
	stripOpenUIPrograms,
} from "../keating/openui/segments";

describe("OpenUI message segments", () => {
	it("preserves Markdown around a complete OpenUI document", () => {
		const text = [
			"Before",
			"```openui lifecycle=resumable id=fractions-check",
			'root = Explanation({ markdown: "A whole can be partitioned." })',
			"```",
			"After",
		].join("\n");
		const segments = parseOpenUIMessageSegments(text);

		expect(segments.map((segment) => segment.type)).toEqual(["text", "openui", "text"]);
		const document = segments[1];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.complete).toBe(true);
		expect(document.metadata).toEqual({ id: "fractions-check", lifecycle: "resumable" });
		expect(document.program).toContain("partitioned");
	});

	it("returns an incomplete document while a response is streaming", () => {
		const segments = parseOpenUIMessageSegments(
			"```openui lifecycle=workspace id=map-1\nroot = ConceptMap({ code: \"graph TD",
		);
		const document = segments[0];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.complete).toBe(false);
		expect(document.metadata.lifecycle).toBe("workspace");
	});

	it("keeps an inferred document id stable as a program streams", () => {
		const prefix = "Lesson\n```openui lifecycle=ephemeral\nroot = Callout({";
		const first = parseOpenUIMessageSegments(prefix, "assistant-message-1")[1];
		const second = parseOpenUIMessageSegments(`${prefix} tone: \"hint\"`, "assistant-message-1")[1];
		if (first.type !== "openui" || second.type !== "openui") {
			throw new Error("expected OpenUI segments");
		}
		expect(first.metadata.id).toBe(second.metadata.id);
	});

	it("does not reuse fallback ids for unrelated documents at the same position", () => {
		const first = parseOpenUIMessageSegments("```openui lifecycle=workspace\nroot = Explanation({ markdown: \"Alpha\" })\n```")[0];
		const second = parseOpenUIMessageSegments("```openui lifecycle=workspace\nroot = Explanation({ markdown: \"Beta\" })\n```")[0];
		if (first.type !== "openui" || second.type !== "openui") {
			throw new Error("expected OpenUI segments");
		}
		expect(first.metadata.id).not.toBe(second.metadata.id);
	});

	it("ignores markdown fences embedded in OpenUI string literals", () => {
		const text = [
			"```openui id=code-example",
			'root = Explanation({ markdown: "Example:',
			"```js",
			"const answer = 42",
			"```",
			'Done" })',
			"```",
			"After",
		].join("\n");
		const segments = parseOpenUIMessageSegments(text);
		const document = segments[0];
		if (document.type !== "openui") throw new Error("expected OpenUI segment");

		expect(document.complete).toBe(true);
		expect(document.program).toContain("const answer = 42");
		expect(document.program).toContain("Done");
		expect(segments.at(-1)).toEqual({ type: "text", content: "After" });
	});

	it("defaults malformed metadata safely", () => {
		const [document] = parseOpenUIMessageSegments("```openui lifecycle=forever id=bad/id\nroot = Nope({})\n```");
		if (document.type !== "openui") throw new Error("expected OpenUI segment");
		expect(document.metadata.lifecycle).toBe("ephemeral");
		expect(document.metadata.id).toMatch(/^openui-/);
	});

	it("removes programs without discarding surrounding prose", () => {
		const text = "One\n```openui id=x\nroot = Explanation({ markdown: \"hidden\" })\n```\nTwo";
		expect(stripOpenUIPrograms(text)).toBe("One\nTwo");
	});

	it("leaves legacy messages unchanged", () => {
		const legacy = '<keating-question json={"question":"Why?"} />';
		expect(parseOpenUIMessageSegments(legacy)).toEqual([{ type: "text", content: legacy }]);
	});
});
