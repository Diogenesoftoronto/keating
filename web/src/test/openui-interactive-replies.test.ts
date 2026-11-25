import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createParser } from "@openuidev/react-lang";
import { compileOpenUISourceToSharedDocument, INTERACTIVE_COMPONENT_NAMES, INTERACTIVE_KINDS, type InteractiveKind } from "@keating/learner-contracts";

import { keatingOpenUIInteractiveRepliesGuide, keatingOpenUILibrary, keatingOpenUIPrompt } from "../keating/openui/library";
import {
	interactiveComponentsInDirectives,
	interactiveSchemaSections,
	MAX_INJECTED_SCHEMAS,
	withInteractiveSchemas,
} from "../components/interactive-replies/catalogue";

const catalogueDir = join(import.meta.dir, "../components/interactive-replies/catalogue");
const section = (kind: InteractiveKind) => readFileSync(join(catalogueDir, `${kind}.md`), "utf8");
const programs = (kind: InteractiveKind) => [...section(kind).matchAll(/```openui[^\n]*\n([\s\S]*?)\n```/gu)].map((match) => match[1]!);

describe("interactive reply components in OpenUI Lang", () => {
	const parser = createParser(keatingOpenUILibrary.toJSONSchema());

	for (const kind of INTERACTIVE_KINDS) {
		const name = INTERACTIVE_COMPONENT_NAMES[kind];

		it(`parses and compiles every ${name} catalogue example`, () => {
			const examples = programs(kind);
			expect(examples.length).toBeGreaterThan(0);
			for (const program of examples) {
				expect(program).toContain(`reply = ${name}("`);
				const result = parser.parse(program);
				expect(result.root?.typeName).toBe("LearningSurface");
				expect(result.meta.errors).toEqual([]);
				expect(result.meta.unresolved).toEqual([]);
				const document = compileOpenUISourceToSharedDocument(program, { documentId: `example-${kind}`, retention: "ephemeral" });
				const node = document.nodes.find((entry) => entry.type === "interactive");
				expect(node).toMatchObject({ type: "interactive", kind });
			}
		});

		it(`parses ${name} in positional form with a brief`, () => {
			const program = `root = LearningSurface([reply])\nreply = ${name}("Try it", { mode: "x" }, "Drag one piece.")`;
			const result = parser.parse(program);
			expect(result.meta.errors).toEqual([]);
			const document = compileOpenUISourceToSharedDocument(program, { documentId: `positional-${kind}`, retention: "ephemeral" });
			expect(document.nodes.find((entry) => entry.type === "interactive")).toMatchObject({ kind, title: "Try it", brief: "Drag one piece.", config: { mode: "x" } });
		});
	}

	it("lists every component in its own group and guide", () => {
		const group = keatingOpenUILibrary.componentGroups?.find((entry) => entry.name === "Interactive replies");
		expect(group?.components).toEqual(INTERACTIVE_KINDS.map((kind) => INTERACTIVE_COMPONENT_NAMES[kind]));
		for (const kind of INTERACTIVE_KINDS) expect(keatingOpenUIInteractiveRepliesGuide).toContain(`\`${INTERACTIVE_COMPONENT_NAMES[kind]}\``);
		expect(keatingOpenUIPrompt).toContain(keatingOpenUIInteractiveRepliesGuide);
	});

	it("keeps full schemas out of the base prompt", () => {
		// A schema-only phrase from each section must not leak into the always-on prompt.
		expect(keatingOpenUIPrompt).not.toContain("type StateMachineConfig");
		expect(keatingOpenUIPrompt).not.toContain("Expression grammar");
		expect(keatingOpenUIInteractiveRepliesGuide.length).toBeLessThan(3_200);
	});
});

describe("per-turn interactive schemas", () => {
	const prompt = (directives: string[]) => `Base prompt mentions SortBoard in passing.\n\nTurn decisions:\n${directives.map((line) => `- ${line}`).join("\n")}\n\nResponse scope: concise`;

	it("names only components offered in the turn directives", () => {
		expect(interactiveComponentsInDirectives(prompt(["Answer directly."]))).toEqual([]);
		expect(interactiveComponentsInDirectives(prompt(["At most one OpenUI activity may help this turn: Question to ask; or EquationWorkbench to work the equation."]))).toEqual(["equation"]);
		expect(interactiveComponentsInDirectives("No directives here, but StateMachine appears.")).toEqual([]);
	});

	it("appends the shared conventions and each named section, and nothing otherwise", async () => {
		const offered = prompt(["Include exactly one OpenUI activity this turn: StateMachine or Simulation to build it."]);
		const withSchema = await withInteractiveSchemas(offered);
		expect(withSchema.startsWith(offered)).toBe(true);
		expect(withSchema).toContain("## Shared conventions");
		expect(withSchema).toContain("type StateMachineConfig");
		expect(withSchema).not.toContain("type SortBoardConfig");
		const plain = prompt(["Answer without a new OpenUI activity this turn."]);
		expect(await withInteractiveSchemas(plain)).toBe(plain);
	});

	it("skips schemas when too many components are named", async () => {
		const many = INTERACTIVE_KINDS.slice(0, MAX_INJECTED_SCHEMAS + 1);
		expect(await interactiveSchemaSections(many)).toBe("");
	});

	it("reports the size of every section", async () => {
		const sizes = await Promise.all(INTERACTIVE_KINDS.map(async (kind) => [kind, (await interactiveSchemaSections([kind])).length] as const));
		for (const [, size] of sizes) expect(size).toBeGreaterThan(1_000);
	});
});
