import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileOpenUISourceToSharedDocument, parseSimulationExpression, type UiSimulationNode } from "@keating/learner-contracts";
import { useSimulationInteraction, type SimulationRendererProps } from "../components/SimulationRenderer";
import { KeatingOpenUIRenderer } from "../keating/openui/renderer";
import { parseOpenUIMessageSegments } from "../keating/openui/segments";
import { simulationDefaultView, simulationShareIntent } from "../keating/openui/shared-actions";
import { createReactMountHarness } from "./helpers/react-mount";

/**
 * A simulation opens on the relationship its author set up: the emphasised
 * readout against the first authored parameter it depends on. These cases hold
 * that through the ordinary path — fenced tutor reply, compiled and validated
 * shared document, browser renderer — including the genuine archived replies.
 */
const audit = join(import.meta.dir, "../../../docs/benchmarks/openui-audit-2026-11-18");
const archivedReply = (path: string): string => JSON.parse(readFileSync(join(audit, path), "utf8")).public.text;

function simulationFrom(reply: string): { node: UiSimulationNode; html: string } {
	const segment = parseOpenUIMessageSegments(reply).find((item) => item.type === "openui");
	if (segment?.type !== "openui" || !segment.complete) throw new Error("Expected a completed OpenUI fence");
	const node = compileOpenUISourceToSharedDocument(segment.rawProgram, { documentId: "opening-view" }).nodes[0];
	if (node?.type !== "simulation") throw new Error("Expected a simulation node");
	const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={segment.program} source={segment.rawProgram} sourceComplete={segment.complete} metadata={segment.metadata} />);
	return { node, html };
}

/** What the renderer chose before this change: the last parameter the default readout depends on. */
function previousParameterId(node: UiSimulationNode): string | undefined {
	const ids = node.parameters.map((parameter) => parameter.id);
	const readout = node.readouts.find((item) => item.emphasis) ?? node.readouts[0];
	const parsed = readout ? parseSimulationExpression(readout.expr, ids) : undefined;
	return [...ids].reverse().find((id) => parsed?.ok && parsed.parameters.includes(id)) ?? ids[0];
}

const fence = (body: string) => `Try it.\n\n\`\`\`openui lifecycle=ephemeral id=opening\nroot = LearningSurface([sim], "Model", "", "ephemeral")\nsim = ${body}\n\`\`\`\n`;
const graphLabel = (html: string) => /<figure aria-label="([^"]+)"/u.exec(html)?.[1]?.replaceAll("&#x27;", "'");

async function mount(props: SimulationRendererProps) {
	const harness = createReactMountHarness();
	const current: { value?: ReturnType<typeof useSimulationInteraction> } = {};
	function Probe(probeProps: SimulationRendererProps) { current.value = useSimulationInteraction(probeProps); return null; }
	await harness.render(createElement(Probe, props));
	return { get api() { return current.value!; }, unmount: () => harness.unmount() };
}

describe("archived tutor replies open on the relationship the learner asked for", () => {
	test("policy holdout bus reply: buses per hour, not the last demand assumption", () => {
		const { node, html } = simulationFrom(archivedReply("policy-holdout/segment-two--MiniMax-M2.7-highspeed--bus.json"));
		expect(node.parameters.map((parameter) => parameter.id)).toEqual(["busesPerHour", "seatsPerBus", "baseRiders", "extraRidersPerBus"]);
		expect(previousParameterId(node)).toBe("extraRidersPerBus");
		expect(simulationDefaultView(node)).toEqual({ parameterId: "busesPerHour", readoutId: "available" });
		expect(graphLabel(html)).toBe("Seats available per hour (seats) against Buses per hour (buses)");
	});

	test("Gemini Decision bus reply: buses per hour, not load factor; the authored emphasis is kept as written", () => {
		const { node, html } = simulationFrom(archivedReply("gemini-decision/turn-receipts/MiniMax-M2.7-highspeed--bus.json"));
		expect(node.parameters.map((parameter) => parameter.id)).toEqual(["freq", "seats", "load"]);
		expect(previousParameterId(node)).toBe("load");
		// The tutor chose unoccupied seats over seats offered; that authored choice is history, not something to rewrite.
		expect(simulationDefaultView(node)).toEqual({ parameterId: "freq", readoutId: "available" });
		expect(graphLabel(html)).toBe("Seats available per hour (unoccupied) (seats) against Buses per hour (buses)");
	});

	test("a single-variable archived reply is unchanged", () => {
		const { node } = simulationFrom(JSON.parse(readFileSync(join(audit, "evidence/MiniMax-M2.7-highspeed--variable.json"), "utf8")).drafts[1].response.text.replaceAll("```unknown", "```"));
		expect(previousParameterId(node)).toBe("width");
		expect(simulationDefaultView(node)).toEqual({ parameterId: "width", readoutId: "area" });
	});
});

describe("authored order and emphasis decide the opening graph", () => {
	const parameters = '[{ id: "rate", label: "Rate", unit: "%", min: 0, max: 10, value: 2 }, { id: "years", label: "Years", min: 1, max: 30, value: 5 }, { id: "fee", label: "Fee", min: 0, max: 50, value: 10 }]';
	const opening = (readouts: string, order = parameters) => {
		const { node, html } = simulationFrom(fence(`Simulation("growth", "Growth", ${order}, ${readouts}, "ephemeral")`));
		return { view: simulationDefaultView(node), label: graphLabel(html), node };
	};

	test("with several variables the first listed one the emphasised readout depends on is varied", () => {
		const { view, label } = opening('[{ id: "total", label: "Total", expr: "100 * rate * years - fee" }, { id: "net", label: "Net", expr: "rate * years - fee", emphasis: true }]');
		expect(view).toEqual({ parameterId: "rate", readoutId: "net" });
		expect(label).toBe("Net against Rate (%)");
	});

	test("reordering the authored parameters changes the opening input, with nothing else changed", () => {
		const reordered = '[{ id: "years", label: "Years", min: 1, max: 30, value: 5 }, { id: "rate", label: "Rate", unit: "%", min: 0, max: 10, value: 2 }, { id: "fee", label: "Fee", min: 0, max: 50, value: 10 }]';
		const { view, label } = opening('[{ id: "net", label: "Net", expr: "rate * years - fee", emphasis: true }]', reordered);
		expect(view).toEqual({ parameterId: "years", readoutId: "net" });
		expect(label).toBe("Net against Years");
	});

	test("a readout that ignores the first parameter opens on the first one it does depend on", () => {
		expect(opening('[{ id: "cost", label: "Cost", expr: "years * fee", emphasis: true }]').view).toEqual({ parameterId: "years", readoutId: "cost" });
	});

	test("without emphasis the first readout is watched; with two, the first emphasised one", () => {
		expect(opening('[{ id: "cost", label: "Cost", expr: "years * fee" }, { id: "net", label: "Net", expr: "rate" }]').view).toEqual({ parameterId: "years", readoutId: "cost" });
		expect(opening('[{ id: "cost", label: "Cost", expr: "fee" }, { id: "net", label: "Net", expr: "years", emphasis: true }, { id: "all", label: "All", expr: "rate", emphasis: true }]').view).toEqual({ parameterId: "years", readoutId: "net" });
	});

	test("a constant readout falls back to the first parameter", () => {
		expect(opening('[{ id: "fixed", label: "Fixed", expr: "42", emphasis: true }]').view).toEqual({ parameterId: "rate", readoutId: "fixed" });
	});

	test("an emphasised readout the compiler dropped does not leave the graph without an output", () => {
		const { view, node } = opening('[{ id: "bad", label: "Bad", expr: "Math.max(rate, 1)", emphasis: true }, { id: "net", label: "Net", expr: "years - fee" }]');
		expect(node.readouts.map((readout) => readout.id)).toEqual(["net"]);
		expect(view).toEqual({ parameterId: "years", readoutId: "net" });
	});
});

describe("the opening graph in the live hook", () => {
	const { node } = simulationFrom(archivedReply("policy-holdout/segment-two--MiniMax-M2.7-highspeed--bus.json"));

	test("opens on the authored graph and reports it when shared untouched", async () => {
		const view = await mount({ node });
		expect([view.api.parameterId, view.api.readoutId, view.api.dirty]).toEqual(["busesPerHour", "available", false]);
		expect(simulationShareIntent(node, view.api)).toMatchObject({ selectedParameterId: "busesPerHour", selectedReadoutId: "available", changedParameterIds: [] });
		await view.unmount();
	});

	test("a learner's own choice of graph is kept until they reset", async () => {
		const view = await mount({ node });
		view.api.selectParameter("seatsPerBus");
		view.api.selectReadout("loadFactor");
		view.api.setValue("busesPerHour", 16);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect([view.api.parameterId, view.api.readoutId, view.api.values.busesPerHour, view.api.dirty]).toEqual(["seatsPerBus", "loadFactor", 16, true]);
		view.api.reset();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect([view.api.parameterId, view.api.readoutId, view.api.values.busesPerHour, view.api.dirty]).toEqual(["busesPerHour", "available", 8, false]);
		await view.unmount();
	});
});
