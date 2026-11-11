import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiDocument, UiSimulationNode } from "@keating/learner-contracts";
import { SimulationRenderer, useSimulationInteraction, type SimulationRendererProps } from "../components/SimulationRenderer";
import { SharedUiDocumentRenderer, type SharedUiActionEvent } from "../keating/openui/shared-renderer";
import {
	dispatchSharedUiAction,
	loadSharedUiActionState,
	loadSimulationState,
	simulationNodeSignature,
	simulationStateKey,
} from "../keating/openui/shared-actions";
import { createReactMountHarness } from "./helpers/react-mount";

const at = "2026-11-10T12:00:00.000Z";
const node: UiSimulationNode = {
	type: "simulation",
	id: "base-rate",
	title: "A positive test result",
	brief: "Predict the chance first, then move prevalence.",
	parameters: [
		{ id: "prevalence", label: "Prevalence", unit: "per 10k", min: 1, max: 5000, step: 1, value: 10 },
		{ id: "sensitivity", label: "Sensitivity", unit: "%", min: 50, max: 100, step: 0.5, value: 99 },
	],
	readouts: [
		{ id: "true_positives", label: "True positives", expr: "prevalence * sensitivity / 100", precision: 1 },
		{ id: "share", label: "Share sick", unit: "%", expr: "100 * prevalence / 10000", emphasis: true },
	],
};
const document: UiDocument = { schemaVersion: 1, id: "sim-doc", revision: 0, lifecycle: "ready", retention: "workspace", supportedSurfaces: ["web"], createdAt: at, updatedAt: at, nodes: [node] };

function memoryStorage() {
	const values = new Map<string, string>();
	return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
type Interaction = ReturnType<typeof useSimulationInteraction>;

/** Mounts the real hook in a real reconciler so effects (persistence) run as they do in the browser. */
async function mountInteraction(props: SimulationRendererProps) {
	const harness = createReactMountHarness();
	const current: { value?: Interaction } = {};
	function Probe(probeProps: SimulationRendererProps) {
		current.value = useSimulationInteraction(probeProps);
		return null;
	}
	await harness.render(createElement(Probe, props));
	return {
		get api() { return current.value!; },
		rerender: (next: SimulationRendererProps) => harness.render(createElement(Probe, next)),
		unmount: () => harness.unmount(),
	};
}

describe("simulation exploration survives a reload", () => {
	test("a moved parameter and chosen graph are restored after remounting", async () => {
		const storage = memoryStorage();
		const first = await mountInteraction({ node, documentId: document.id, storage });
		expect(storage.values.size).toBe(0); // rendering alone writes nothing
		first.api.setValue("prevalence", 250);
		first.api.selectParameter("sensitivity");
		first.api.selectReadout("true_positives");
		await settle();
		await first.unmount();

		const reloaded = await mountInteraction({ node, documentId: document.id, storage });
		expect(reloaded.api.values).toEqual({ prevalence: 250, sensitivity: 99 });
		expect(reloaded.api.parameterId).toBe("sensitivity");
		expect(reloaded.api.readoutId).toBe("true_positives");
		await reloaded.unmount();
	});

	test("reset persists, so a reload shows the authored defaults again", async () => {
		const storage = memoryStorage();
		const first = await mountInteraction({ node, documentId: document.id, storage });
		first.api.setValue("sensitivity", 80);
		await settle();
		first.api.reset();
		await settle();
		await first.unmount();
		const reloaded = await mountInteraction({ node, documentId: document.id, storage });
		expect(reloaded.api.values).toEqual({ prevalence: 10, sensitivity: 99 });
		await reloaded.unmount();
	});

	test("out-of-range input is clamped before it is stored", async () => {
		const storage = memoryStorage();
		const view = await mountInteraction({ node, documentId: document.id, storage });
		view.api.setValue("prevalence", 999_999);
		await settle();
		expect(loadSimulationState(storage, document.id, node).values.prevalence).toBe(5000);
		await view.unmount();
	});

	test("without a document id (ephemeral surfaces) nothing is persisted", async () => {
		const storage = memoryStorage();
		const view = await mountInteraction({ node, storage });
		view.api.setValue("prevalence", 30);
		await settle();
		expect(storage.values.size).toBe(0);
		await view.unmount();
	});
});

describe("corrupt stored simulation state", () => {
	const key = simulationStateKey(document.id, node.id);
	const valid = { version: 1, signature: simulationNodeSignature(node), values: { prevalence: 42, sensitivity: 70 } };
	test("the well-formed control record is restored", () => {
		const storage = memoryStorage();
		storage.values.set(key, JSON.stringify(valid));
		expect(loadSimulationState(storage, document.id, node).values).toEqual({ prevalence: 42, sensitivity: 70 });
	});
	const cases: Array<[string, string]> = [
		["values that are not an object", JSON.stringify({ ...valid, values: [42, 70] })],
		["a missing signature", JSON.stringify({ version: 1, values: valid.values })],
		["not JSON", "{not json"],
		["an array", "[1,2]"],
		["null", "null"],
		["a future version", JSON.stringify({ ...valid, version: 9 })],
		["a different authored model", JSON.stringify({ ...valid, signature: "stale" })],
	];
	for (const [label, raw] of cases) {
		test(`falls back to defaults for ${label}`, async () => {
			const storage = memoryStorage();
			storage.values.set(key, raw);
			expect(loadSimulationState(storage, document.id, node)).toEqual({ values: { prevalence: 10, sensitivity: 99 } });
			const view = await mountInteraction({ node, documentId: document.id, storage });
			expect(view.api.values).toEqual({ prevalence: 10, sensitivity: 99 });
			await view.unmount();
		});
	}

	test("keeps valid fields and drops invalid ones individually", async () => {
		const storage = memoryStorage();
		const seeded = await mountInteraction({ node, documentId: document.id, storage });
		seeded.api.setValue("prevalence", 42);
		await settle();
		await seeded.unmount();
		const stored = JSON.parse(storage.values.get(key)!);
		storage.values.set(key, JSON.stringify({ ...stored, values: { prevalence: 42, sensitivity: "high" }, parameterId: "missing", readoutId: 7 }));
		expect(loadSimulationState(storage, document.id, node)).toEqual({ values: { prevalence: 42, sensitivity: 99 } });
		storage.values.set(key, JSON.stringify({ ...stored, values: { prevalence: -5, sensitivity: Number.MAX_VALUE } }));
		expect(loadSimulationState(storage, document.id, node).values).toEqual({ prevalence: 10, sensitivity: 99 });
	});

	test("a storage that throws on read or write never breaks the simulation", async () => {
		const hostile = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
		const view = await mountInteraction({ node, documentId: document.id, storage: hostile });
		expect(view.api.values).toEqual({ prevalence: 10, sensitivity: 99 });
		view.api.setValue("prevalence", 20);
		await settle();
		expect(view.api.values.prevalence).toBe(20);
		expect(view.api.saveFailed).toBe(true);
		await view.unmount();
	});
});

describe("sharing with the tutor", () => {
	test("an explicit share sends the exact settings once, and a repeat is suppressed", async () => {
		const storage = memoryStorage();
		const events: SharedUiActionEvent[] = [];
		let state = loadSharedUiActionState(storage, document);
		const onAction = (event: SharedUiActionEvent) => {
			events.push(event);
			const dispatched = dispatchSharedUiAction(storage, state.document, event.intent, at, { sessionId: "s1", humanFriendlyMessage: event.humanFriendlyMessage });
			state = { version: 1, document: dispatched.document, journal: dispatched.journal, deliveries: dispatched.deliveries };
			return true;
		};
		const receipt = () => state.journal.receipts.at(-1);
		const props = (): SimulationRendererProps => ({ node, documentId: document.id, storage, onAction, receipt: receipt() });
		const view = await mountInteraction(props());
		expect(view.api.canShare).toBe(true);
		view.api.setValue("prevalence", 100);
		await settle();
		expect(view.api.share()).toBe(true);
		await view.rerender(props());
		expect(events).toHaveLength(1);
		expect(events[0]!.intent).toEqual({
			type: "share-simulation",
			nodeId: "base-rate",
			parameters: [{ parameterId: "prevalence", value: 100 }, { parameterId: "sensitivity", value: 99 }],
			readouts: [{ readoutId: "true_positives", value: 99 }, { readoutId: "share", value: 1 }],
			changedParameterIds: ["prevalence"],
			selectedParameterId: "prevalence",
			selectedReadoutId: "share",
		});
		expect(events[0]!.humanFriendlyMessage).toBe("Shared A positive test result after changing Prevalence.");
		expect(view.api.alreadyShared).toBe(true);
		expect(view.api.share()).toBe(false);
		expect(events).toHaveLength(1);
		expect(state.deliveries).toHaveLength(1);

		// After a reload the receipt comes back from storage and still suppresses a duplicate.
		await view.unmount();
		state = loadSharedUiActionState(storage, document);
		const reloaded = await mountInteraction(props());
		expect(reloaded.api.values.prevalence).toBe(100);
		expect(reloaded.api.alreadyShared).toBe(true);
		expect(reloaded.api.share()).toBe(false);

		// Changing a setting re-enables one new share.
		reloaded.api.setValue("sensitivity", 90);
		await settle();
		expect(reloaded.api.canShare).toBe(true);
		expect(reloaded.api.share()).toBe(true);
		expect(events).toHaveLength(2);
		expect(events[1]!.intent).toMatchObject({ changedParameterIds: ["prevalence", "sensitivity"] });
		await reloaded.unmount();
	});

	test("a refused share keeps the settings and reports it", async () => {
		const view = await mountInteraction({ node, documentId: document.id, storage: memoryStorage(), onAction: () => false });
		expect(view.api.share()).toBe(false);
		await settle();
		expect(view.api.shareStatus).toBe("failed");
		await view.unmount();
	});

	test("disabled surfaces cannot share", async () => {
		let calls = 0;
		const view = await mountInteraction({ node, documentId: document.id, storage: memoryStorage(), disabled: true, onAction: () => { calls += 1; return true; } });
		expect(view.api.canShare).toBe(false);
		expect(view.api.share()).toBe(false);
		expect(calls).toBe(0);
		await view.unmount();
	});
});

describe("share control markup", () => {
	test("renders a labelled share button with a live status when the host can deliver", () => {
		const html = renderToStaticMarkup(<SimulationRenderer node={node} storage={null} documentId={document.id} onAction={() => true} />);
		expect(html).toContain('data-simulation-share="base-rate"');
		expect(html).toContain("Share what I found");
		expect(html).toMatch(/role="status"[^>]*>Sends your settings and readouts to your tutor\./);
		expect(html).toContain("prefers-reduced-motion");
	});

	test("omits the control when nothing can deliver it", () => {
		expect(renderToStaticMarkup(<SimulationRenderer node={node} storage={null} />)).not.toContain("Share what I found");
	});

	test("the shared document renderer wires the share control to its action handler", () => {
		expect(renderToStaticMarkup(<SharedUiDocumentRenderer document={document} onAction={() => true} />)).toContain("Share what I found");
		expect(renderToStaticMarkup(<SharedUiDocumentRenderer document={document} />)).not.toContain("Share what I found");
	});
});
