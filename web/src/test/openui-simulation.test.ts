import { describe, expect, test } from "bun:test";
import type { UiDocument, UiSimulationReadout } from "@keating/learner-contracts";
import { validateUiDocument } from "@keating/learner-contracts";

/**
 * Rendering is exercised visually in `Learning/Simulation` in Storybook. What
 * has to hold here is the boundary: a readout may only reach the parameters its
 * own node declares, so no surface ever has to decide at render time what an
 * unknown identifier means.
 */
function documentWith(readouts: UiSimulationReadout[]): UiDocument {
	return {
		schemaVersion: 1,
		id: "sim-doc",
		revision: 0,
		lifecycle: "ready",
		retention: "workspace",
		supportedSurfaces: ["web"],
		title: "Base rates",
		nodes: [{
			type: "simulation",
			id: "base-rate",
			title: "A positive test result",
			parameters: [
				{ id: "prevalence", label: "Prevalence", min: 1, max: 5000, step: 1, value: 10 },
				{ id: "sensitivity", label: "Sensitivity", min: 50, max: 100, step: 0.1, value: 99 },
			],
			readouts,
		}],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("openui simulation contract", () => {
	test("accepts a readout built only from declared parameters", () => {
		expect(validateUiDocument(documentWith([
			{ id: "ppv", label: "Positive predictive value", unit: "%", emphasis: true, expr: "100 * prevalence / (prevalence + sensitivity)" },
		]))).toBe(true);
	});

	test("rejects a readout that reaches outside its declared parameters", () => {
		for (const expr of ["globalThis", "alert(1)", "prevalence + secret", "prevalence.constructor", "window"]) {
			expect(validateUiDocument(documentWith([{ id: "leak", label: "Leak", expr }]))).toBe(false);
		}
	});

	test("rejects a parameter whose starting value sits outside its own range", () => {
		const document = documentWith([{ id: "ok", label: "Fine", expr: "prevalence" }]);
		const node = document.nodes[0];
		if (node?.type !== "simulation") throw new Error("expected a simulation node");
		node.parameters[0] = { id: "prevalence", label: "Prevalence", min: 1, max: 10, step: 1, value: 999 };
		expect(validateUiDocument(document)).toBe(false);
	});

	test("rejects an inverted range", () => {
		const document = documentWith([{ id: "ok", label: "Fine", expr: "prevalence" }]);
		const node = document.nodes[0];
		if (node?.type !== "simulation") throw new Error("expected a simulation node");
		node.parameters[0] = { id: "prevalence", label: "Prevalence", min: 100, max: 1, value: 50 };
		expect(validateUiDocument(document)).toBe(false);
	});
});
