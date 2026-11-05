import { describe, expect, it } from "bun:test";
import { OPENUI_SOURCE_PARITY_FIXTURE, tryCompileOpenUISourceToSharedDocument } from "@keating/learner-contracts";
import { buildOpenUIPreview } from "../keating/openui/preview";

const sourceTurn = [
	"Here is how resolution works.",
	"",
	"```openui lifecycle=workspace id=dns",
	'root = LearningSurface([plan, map], "DNS", "How lookups resolve.", "workspace")',
	'plan = StudyPlan("resolution-plan", "Resolution plan", [{ id: "trace", title: "Trace a cold lookup", children: [{ id: "stub", title: "Label the stub resolver" }] }, { id: "ttl", title: "Reason about TTL" }], "workspace")',
	'map = ConceptMap("flowchart LR\\n Client --> Resolver", "workspace", "Resolution and reuse")',
	"```",
	"",
	"Tell me which step is least clear.",
].join("\n");

describe("openui preview", () => {
	it("keeps prose readable and collapses artifacts to chips", () => {
		const blocks = buildOpenUIPreview(sourceTurn, "session:message");
		expect(blocks.map((block) => block.type)).toEqual(["prose", "artifact", "artifact", "prose"]);
		expect(blocks[0]).toMatchObject({ type: "prose", markdown: "Here is how resolution works." });
		expect(blocks[1]).toMatchObject({ type: "artifact", kind: "study-plan", label: "Resolution plan", detail: "3 items" });
		expect(blocks[2]).toMatchObject({ type: "artifact", kind: "concept-map", label: "Resolution and reuse" });
		expect(blocks[3]).toMatchObject({ type: "prose", markdown: "Tell me which step is least clear." });
	});

	it("never leaks raw component source into the preview", () => {
		for (const block of buildOpenUIPreview(sourceTurn)) {
			if (block.type === "prose") expect(block.markdown).not.toContain("LearningSurface(");
		}
	});

	it("anchors verbatim prose to its offset in the original text", () => {
		const blocks = buildOpenUIPreview(sourceTurn);
		const [first] = blocks;
		const last = blocks.at(-1);
		if (first?.type !== "prose" || last?.type !== "prose") throw new Error("expected prose blocks");
		expect(sourceTurn.slice(first.sourceStart, first.sourceStart! + first.markdown.length)).toBe(first.markdown);
		expect(sourceTurn.slice(last.sourceStart, last.sourceStart! + last.markdown.length)).toBe(last.markdown);
	});

	it("passes plain turns through as a single anchored block", () => {
		expect(buildOpenUIPreview("Just prose.")).toEqual([
			{ type: "prose", id: "text:0", markdown: "Just prose.", sourceStart: 0 },
		]);
	});

	it("marks an unparsable fence as unavailable rather than dumping its source", () => {
		const blocks = buildOpenUIPreview("Before\n\n```openui id=broken\nroot = Nope(\n```\n\nAfter");
		expect(blocks.some((block) => block.type === "artifact" && block.kind === "unavailable")).toBe(true);
		for (const block of blocks) {
			if (block.type === "prose") expect(block.markdown).not.toContain("Nope(");
		}
	});

	it("summarizes a JSON document fence", () => {
		const document = JSON.stringify({
			schemaVersion: 1,
			id: "doc",
			revision: 0,
			lifecycle: "ready",
			retention: "workspace",
			supportedSurfaces: ["web"],
			title: "Cache",
			nodes: [
				{ type: "markdown", id: "intro", markdown: "Read this first." },
				{ type: "quiz", id: "check", title: "Cache check", questions: [] },
			],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const blocks = buildOpenUIPreview(["```openui-json id=doc", document, "```"].join("\n"));
		expect(blocks[0]).toMatchObject({ type: "prose", markdown: "Read this first." });
		expect(blocks[1]).toMatchObject({ type: "artifact", kind: "quiz", label: "Cache check" });
	});
	it("summarizes every component kind, so no component silently vanishes", () => {
		const source = OPENUI_SOURCE_PARITY_FIXTURE;
		const compiled = tryCompileOpenUISourceToSharedDocument(source, { documentId: "parity" });
		if (!compiled.ok) throw new Error(compiled.message);
		const blocks = buildOpenUIPreview(`\`\`\`openui lifecycle=workspace id=parity\n${source}\n\`\`\`\n`);
		// One readable block per node: nothing dropped, nothing raw.
		expect(blocks).toHaveLength(compiled.document.nodes.length);
		const details = blocks.flatMap((block) => block.type === "artifact" ? [`${block.label} | ${block.detail ?? ""}`] : []);
		expect(details).toContain("A little Spanish | Language practice · Spanish · 4 rounds");
		expect(details).toContain("Double a number | Coding challenge · JavaScript · 2 tests");
		expect(details).toContain("Hear a major triad | Music lab");
		expect(details).toContain("Take the update outside | Connect · 2 ways to share it · ~30 min");
		expect(details).toContain("Ada Lovelace | Person brief · 1 question");
		expect(details).toContain("Design a URL shortener | Diagram · 1 check");
		expect(details).toContain("Animal recall | Audio response");
		expect(details).toContain("Sign recall | Video response");
		expect(JSON.stringify(blocks)).not.toContain("LearningSurface(");
	});
	it("hides the review marker on best-effort replies and keeps offsets into the original text", () => {
		const text = "<!--keating:review=unverified-->\nCompare the two rates.";
		const blocks = buildOpenUIPreview(text);
		expect(blocks).toEqual([{ type: "prose", id: "text:0", markdown: "Compare the two rates.", sourceStart: text.indexOf("Compare") }]);
	});
});
