import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { HandsOnExplanation } from "../components/chat/HandsOnExplanation";
import { handsOnFirstLayout, isHandsOnRequest } from "../keating/openui/hands-on-first";
import { parseOpenUIMessageSegments } from "../keating/openui/segments";

/**
 * A requested hands-on simulation is offered ahead of the prose written before
 * it. These cases run the archived replies through the ordinary segment parser
 * and validated-document compile, and hold every other reply to its authored order.
 */
const audit = join(import.meta.dir, "../../../docs/benchmarks/openui-audit-2026-11-18");
const json = (path: string) => JSON.parse(readFileSync(join(audit, path), "utf8"));
const cohort = json("policy-v2.2/cohort.json").cases as Array<{ id: string; learner: string }>;
const learner = (id: string) => cohort.find((item) => item.id === id)!.learner;
const conveyor = json("policy-v2.2/receipts/conveyor--google.json").public.text as string;
const layout = (reply: string, request: string | undefined) => handsOnFirstLayout(parseOpenUIMessageSegments(reply), request);
const sim = (id = "s") => `\`\`\`openui lifecycle=ephemeral id=${id}\nroot = LearningSurface([sim], "Model", "", "ephemeral")\nsim = Simulation("${id}", "Model", [{ id: "v", label: "Speed", min: 0, max: 10, value: 5 }], [{ id: "o", label: "Output", expr: "v*2" }], "ephemeral")\n\`\`\`\n`;
const prose = "First paragraph about the model.\n\nSecond paragraph with more detail.\n\n";
const ask = learner("conveyor");

describe("archived conveyor reply", () => {
	test("the learner asked to vary speed themselves and did not ask for an explanation", () => {
		expect(ask).toContain("vary its speed myself");
		expect(isHandsOnRequest(ask)).toBe(true);
	});

	test("the simulation comes first and the lead prose is kept whole", () => {
		const segments = parseOpenUIMessageSegments(conveyor);
		expect(segments.map((segment) => segment.type)).toEqual(["text", "openui", "text"]);
		expect(handsOnFirstLayout(segments, ask)).toEqual({ control: 1, lead: [0] });
		const lead = segments[0]!;
		// Presentation only: the segment the disclosure renders is the authored text, unchanged.
		expect(lead.type === "text" && conveyor.startsWith(lead.content)).toBe(true);
		expect(lead.type === "text" && lead.content).toContain("Move the sliders to test that.");
	});
});

describe("replies that keep their authored order", () => {
	test("archived negative controls", () => {
		// Released as text only under the other decision model.
		expect(layout(json("policy-v2.2/receipts/conveyor--jev.json").public.text, ask)).toBeNull();
		expect(layout(json("policy-v2.2/receipts/direct-label--google.json").public.text, learner("direct-label"))).toBeNull();
		// The same reply answering requests that never asked for a hands-on model.
		for (const id of ["direct-label", "account-seats", "plain-relationship", "active-checkpoint"]) expect(layout(conveyor, learner(id))).toBeNull();
	});

	test("no learner request, or one carrying quoted material", () => {
		expect(layout(conveyor, undefined)).toBeNull();
		expect(layout(conveyor, "")).toBeNull();
		expect(layout(conveyor, `<!-- keating-quotes [] -->\n${ask}`)).toBeNull();
	});

	test("the learner also asked for an explanation", () => {
		for (const request of [
			"Explain why output scales, then let me vary the speed myself and see what happens.",
			"Let me change the speed and see the output. Why does it double?",
			"Walk me through the formula and let me adjust the rate to see what changes.",
			"How does spacing matter? Let me vary the speed and watch the count.",
		]) expect(layout(conveyor, request)).toBeNull();
	});

	test("an unfinished, invalid, or non-simulation document", () => {
		expect(layout(conveyor.slice(0, conveyor.lastIndexOf("```")), ask)).toBeNull();
		expect(layout(conveyor.replace("LearningSurface([sim]", "LearningSurface([sim, missing]"), ask)).toBeNull();
		const question = '```openui lifecycle=ephemeral id=q\nroot = LearningSurface([q], "Check", "", "ephemeral")\nq = Question([{ question: "Which?", type: "choice", choices: ["A", "B"] }], "ephemeral", "Check")\n```\n';
		expect(layout(prose + question, ask)).toBeNull();
	});

	test("a simulation beside other interactive material", () => {
		expect(layout(prose + sim("a") + "Then compare.\n\n" + sim("b"), ask)).toBeNull();
		const twoNodes = sim().replace("[sim]", "[sim, note]").replace("```\n", 'note = Callout("Remember", "Units are metres.")\n```\n');
		expect(layout(prose + twoNodes, ask)).toBeNull();
	});

	test("code, required reading, or a single lead-in", () => {
		expect(layout(prose + "```python\nprint(60 / 10)\n```\n\n" + sim(), ask)).toBeNull();
		expect(layout(prose + sim() + "\n```python\nprint(60 / 10)\n```\n", ask)).toBeNull();
		expect(layout("Important: the belt model ignores jams.\n\nIt is otherwise linear.\n\n" + sim(), ask)).toBeNull();
		expect(layout("Do not use these figures for real line planning.\n\nThey are illustrative.\n\n" + sim(), ask)).toBeNull();
		expect(layout("Move the slider to see the output change.\n\n" + sim(), ask)).toBeNull();
		expect(layout(sim() + prose, ask)).toBeNull();
		expect(layout(prose + sim(), ask)).toEqual({ control: 1, lead: [0] });
	});
});

test("the explanation is a native disclosure, closed by default, holding its children", () => {
	const html = renderToStaticMarkup(<HandsOnExplanation><p>Two consequences worth noticing</p></HandsOnExplanation>);
	expect(html).toMatch(/^<details [^>]*data-hands-on-explanation[^>]*><summary/u);
	expect(html).not.toContain(" open");
	expect(html).toContain("Read the explanation</summary>");
	expect(html).toContain("<p>Two consequences worth noticing</p>");
});
