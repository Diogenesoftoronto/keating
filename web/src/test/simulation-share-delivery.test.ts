import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { validateUiActionAgainstDocument, type UiDocument, type UiSimulationNode } from "@keating/learner-contracts";
import {
	acknowledgeSharedUiActionDelivery,
	dispatchSharedUiAction,
	loadSharedUiActionState,
	simulationShareIntent,
	simulationShareMatches,
} from "../keating/openui/shared-actions";
import {
	createOpenUIActionLearnerResponse,
	learnerResponseReviewText,
	parseLearnerResponse,
	serializeLearnerResponse,
} from "../keating/learner-response";
import { createConversationRuntime, recordOpenUIAction } from "../keating/integration";
import { StorageConversationEventStore } from "../keating/event-store";
import { canonicalActionReceiptId, transcriptUserTexts } from "../components/chat/learner-delivery";
import { KeatingStorage } from "../keating/storage";
import { keatingOpenUIPrompt } from "../keating/openui/library";
import type { CanonicalKeatingOpenUIAction } from "../keating/openui/types";

const at = "2026-11-10T12:00:00.000Z";
const node: UiSimulationNode = {
	type: "simulation",
	id: "projectile",
	title: "Launch angle",
	parameters: [
		{ id: "angle", label: "Angle", unit: "deg", min: 0, max: 90, step: 1, value: 30 },
		{ id: "speed", label: "Speed", unit: "m/s", min: 1, max: 50, step: 1, value: 20 },
	],
	readouts: [
		{ id: "height", label: "Peak height proxy", unit: "m", expr: "speed * angle / 90", emphasis: true, precision: 2 },
		{ id: "pole", label: "Inverse tilt", expr: "1 / (angle - 45)" },
	],
};
const document: UiDocument = { schemaVersion: 1, id: "sim-share", revision: 0, lifecycle: "ready", retention: "workspace", supportedSurfaces: ["web"], createdAt: at, updatedAt: at, nodes: [node] };

class MemoryStorage {
	data = new Map<string, string>();
	getItem(key: string) { return this.data.get(key) ?? null; }
	setItem(key: string, value: string) { this.data.set(key, value); }
	removeItem(key: string) { this.data.delete(key); }
}
beforeEach(() => { (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory(); });

function hostAction(dispatch: ReturnType<typeof dispatchSharedUiAction>, message: string): CanonicalKeatingOpenUIAction {
	return {
		kind: "canonical", type: dispatch.action.type, params: {}, humanFriendlyMessage: message,
		document: { id: document.id, revision: dispatch.sourceDocument.revision, lifecycle: "workspace" },
		sourceDocument: dispatch.sourceDocument, action: dispatch.action, receipt: dispatch.receipt,
	};
}

describe("simulation share delivery", () => {
	const intent = simulationShareIntent(node, { values: { angle: 45, speed: 20 }, parameterId: "angle", readoutId: "height" });

	test("the share intent carries concrete values, recomputed readouts and the changed list", () => {
		expect(intent.parameters).toEqual([{ parameterId: "angle", value: 45 }, { parameterId: "speed", value: 20 }]);
		expect(intent.readouts).toEqual([{ readoutId: "height", value: 10 }, { readoutId: "pole", value: null }]);
		expect(intent.changedParameterIds).toEqual(["angle"]);
		expect(simulationShareMatches(intent, node, { values: { angle: 45, speed: 20 } })).toBe(true);
		expect(simulationShareMatches(intent, node, { values: { angle: 46, speed: 20 } })).toBe(false);
	});

	test("the tutor's learner response names every value, unit, readout and change", () => {
		const storage = new MemoryStorage();
		const dispatch = dispatchSharedUiAction(storage, document, intent, at, { sessionId: "s1", humanFriendlyMessage: "Shared Launch angle after changing Angle." });
		expect(validateUiActionAgainstDocument(dispatch.action, document)).toBe(true);
		const response = createOpenUIActionLearnerResponse(hostAction(dispatch, "Shared Launch angle after changing Angle."));
		expect(response.review.title).toBe("Simulation shared");
		expect(response.review.summary).toBe("Launch angle: changed Angle from the starting settings.");
		expect(response.review.items).toEqual([
			{ label: "Angle", value: "45 deg" },
			{ label: "Speed", value: "20 m/s" },
			{ label: "Readout: Peak height proxy", value: "10 m" },
			{ label: "Readout: Inverse tilt", value: "No finite value at these settings" },
			{ label: "Changed from defaults", value: "Angle: 30 deg → 45 deg" },
			{ label: "Graph", value: "Peak height proxy against Angle" },
		]);
		expect(response.agentInstruction).toContain("compare it with this readout");
		const serialized = serializeLearnerResponse(response);
		expect(parseLearnerResponse(serialized)).toEqual(response);
		expect(serialized).toContain('"changedParameterIds":["angle"]');
		expect(learnerResponseReviewText(serialized)).toContain("Angle: 45 deg");
	});

	test("duplicate shares are suppressed by the journal, the runtime and the transcript check", () => {
		const storage = new MemoryStorage();
		const first = dispatchSharedUiAction(storage, document, intent, at, { sessionId: "s1", humanFriendlyMessage: "Shared." });
		const replay = dispatchSharedUiAction(storage, document, intent, at, { sessionId: "s1", humanFriendlyMessage: "Shared." });
		expect(replay.replayed).toBe(true);
		expect(replay.journal.receipts).toHaveLength(1);
		expect(replay.deliveries).toHaveLength(1);

		const runtime = createConversationRuntime({ sessionId: "s1", runId: "run", store: new StorageConversationEventStore(new MemoryStorage()) });
		recordOpenUIAction(runtime, hostAction(first, "Shared."));
		recordOpenUIAction(runtime, hostAction(first, "Shared."));
		expect(runtime.replay().uiActions).toHaveLength(1);
		const pending = runtime.pendingLearnerResponses();
		expect(pending).toHaveLength(1);
		expect(pending[0]!.receiptId).toBe(canonicalActionReceiptId(first.action));
		// A reload with the turn already in the transcript settles instead of re-sending.
		expect(transcriptUserTexts([{ role: "user", content: pending[0]!.serialized }]).has(pending[0]!.serialized)).toBe(true);

		// Once acknowledged, a reload carries no pending delivery to emit again.
		expect(acknowledgeSharedUiActionDelivery(storage, document, first.deliveries[0]!.id, at)).toBe(true);
		expect(acknowledgeSharedUiActionDelivery(storage, document, first.deliveries[0]!.id, at)).toBe(false);
		const reloaded = loadSharedUiActionState(storage, document);
		expect(reloaded.deliveries.map((delivery) => delivery.state)).toEqual(["acknowledged"]);
		expect(reloaded.document.revision).toBe(1);
		expect(reloaded.document.nodes[0]).toEqual(node); // a share never rewrites the authored defaults
	});

	test("a later share of different settings is a distinct delivery against the next revision", () => {
		const storage = new MemoryStorage();
		const first = dispatchSharedUiAction(storage, document, intent, at, { sessionId: "s1", humanFriendlyMessage: "Shared." });
		const next = simulationShareIntent(node, { values: { angle: 60, speed: 25 } });
		const second = dispatchSharedUiAction(storage, first.document, next, at, { sessionId: "s1", humanFriendlyMessage: "Shared again." });
		expect(second.replayed).toBe(false);
		expect(second.deliveries).toHaveLength(2);
		expect(second.action.idempotencyKey).not.toBe(first.action.idempotencyKey);
		expect(() => dispatchSharedUiAction(storage, first.document, { ...next, readouts: [{ readoutId: "height", value: 999 }, { readoutId: "pole", value: null }] }, at))
			.toThrow();
	});

	test("the learner record store accepts and replays a share", async () => {
		const dispatch = dispatchSharedUiAction(new MemoryStorage(), document, intent, at);
		const database = new KeatingStorage();
		await database.init();
		const first = await database.materializeCanonicalOpenUiAction(dispatch.action, document, at);
		expect(first.replayed).toBe(false);
		expect((await database.materializeCanonicalOpenUiAction(dispatch.action, document, at)).replayed).toBe(true);
	});

	test("the tutor is told it will receive shared settings and must respond to them", () => {
		expect(keatingOpenUIPrompt).toContain("Share what I found");
		expect(keatingOpenUIPrompt).toContain("Moving a slider sends you nothing");
		expect(keatingOpenUIPrompt).toContain("compare the readout with the prediction you asked for");
	});
});
