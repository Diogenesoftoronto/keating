import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { UI_CONTRACT_VERSION, type UiDocument, type UiStudyPlanNode } from "@keating/learner-contracts";
import { presentationsFromAssistantText } from "../keating/judgement/active-work-host";
import { loadSharedUiActionState } from "../keating/openui/shared-actions";
import { __resetPendingPlanSaves, dismissPendingPlanSave, getPendingPlanSave, PLAN_SAVE_STATUS_EVENT, retryPendingPlanSave } from "../keating/plan-pending-saves";
import { appendPlanHistory, comparePlanRevisions, loadPlanHistory, MAX_PLAN_HISTORY, type PlanRevisionHistoryEntry } from "../keating/plan-revision-history";
import { listPlanRevisionProposals, loadCurrentPlan, PLAN_REVISED_EVENT, resolvePlanRevisionProposal, revisePlan } from "../keating/plan-revisions";
import { loadSessionWorkspacePrefs, resolveRevealTarget, saveSessionWorkspacePrefs, sessionWorkspaceMaterials } from "../keating/session-workspace";
import { KeatingStorage, type OpenUiPresentationRecord } from "../keating/storage";

const at = "2026-01-01T00:00:00.000Z";
const plan = (id = "plan-doc"): UiDocument => ({ schemaVersion: UI_CONTRACT_VERSION, id, revision: 1, lifecycle: "ready", supportedSurfaces: ["web"],
	createdAt: at, updatedAt: at,
	nodes: [{ type: "study-plan", id: "plan", title: "Limits", items: [
		{ id: "a", title: "Intuition", status: "done" },
		{ id: "b", title: "Epsilon-delta", status: "in_progress", dependsOn: ["a"] },
		{ id: "c", title: "Continuity", status: "not_started" },
	] }] });

const mapTurn = [
	"Here is a map.",
	"```openui lifecycle=workspace id=limits-map",
	'root = LearningSurface([map], "Limits", "How the ideas connect.", "workspace")',
	'map = ConceptMap("flowchart LR\\n Intuition --> Proof", "workspace", "Limits map")',
	"```",
].join("\n");
const planTurn = [
	"Here is the path.",
	"```openui lifecycle=workspace id=limits-plan",
	'root = LearningSurface([plan], "Limits", "The path.", "workspace")',
	'plan = StudyPlan("limits-plan", "Limits plan", [{ id: "a", title: "Intuition" }, { id: "c", title: "Continuity" }], "workspace")',
	"```",
].join("\n");

const planRecord = (document: UiDocument, createdAt = 1): OpenUiPresentationRecord => ({ id: `${document.id}:plan`, documentId: document.id, revision: document.revision,
	nodeId: "plan", component: "study-plan", sessionId: "s1", createdAt, planRef: null, document });
const source = (records: OpenUiPresentationRecord[] = [planRecord(plan())]) => ({ getOpenUiPresentations: async () => records });

function memoryStorage() {
	const map = new Map<string, string>();
	return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}
/** Storage whose next `failures` writes throw a quota error. */
function flakyStorage(failures: number) {
	const inner = memoryStorage();
	let left = failures;
	return { ...inner, setItem: (key: string, value: string) => {
		if (left > 0) { left -= 1; throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); }
		inner.setItem(key, value);
	} };
}
const items = (doc: UiDocument | null | undefined) => (doc?.nodes[0] as UiStudyPlanNode | undefined)?.items ?? [];

const events: string[] = [];
const off: Array<() => void> = [];
beforeEach(() => {
	__resetPendingPlanSaves();
	events.length = 0;
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const target = Object.assign(new EventTarget(), { CustomEvent });
	for (const name of [PLAN_REVISED_EVENT, PLAN_SAVE_STATUS_EVENT]) target.addEventListener(name, () => events.push(name));
	Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: target });
	off.push(() => {
		if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});
});
afterEach(() => { while (off.length) off.pop()!(); __resetPendingPlanSaves(); });

describe("plan revision history", () => {
	it("records each tutor or accepted revision with before/after and how it landed", async () => {
		const storage = memoryStorage();
		await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "b" }, "autonomous", storage, () => 1000);
		const proposed = await revisePlan(source(), "plan-doc", { op: "insert-prerequisite", beforeItemId: "c", item: { id: "abs", title: "Absolute value" } }, "approval", storage, () => 2000);
		if (proposed.status !== "proposed") throw new Error(proposed.status);
		expect(await resolvePlanRevisionProposal(source(), proposed.proposal.id, "accept", storage, () => 3000)).toBe("accepted");
		const history = loadPlanHistory(storage, "plan-doc");
		expect(history.map((entry) => [entry.revision, entry.previousRevision, entry.via, entry.at])).toEqual([[2, 1, "autonomous", 1000], [3, 2, "accepted", 3000]]);
		expect(history[0]!.summary).toBe('Marked "Epsilon-delta" as done');
		expect(history[1]!.summary).toBe('Added "Absolute value" before "Continuity"');
		expect(items(history[1]!.before).map((item) => item.id)).toEqual(["a", "b", "c"]);
		expect(items(history[1]!.after).map((item) => item.id)).toEqual(["a", "b", "abs", "c"]);
	});

	it("keeps only the newest bounded, linear entries", () => {
		const entry = (revision: number): PlanRevisionHistoryEntry => ({ revision, previousRevision: revision - 1, op: "complete-item", via: "autonomous", summary: `r${revision}`, at: revision, before: plan(), after: plan() });
		let history: PlanRevisionHistoryEntry[] = [];
		for (let revision = 2; revision < 2 + MAX_PLAN_HISTORY + 5; revision += 1) history = appendPlanHistory(history, entry(revision));
		expect(history).toHaveLength(MAX_PLAN_HISTORY);
		expect(history[0]!.revision).toBe(7);
		expect(history.at(-1)!.revision).toBe(MAX_PLAN_HISTORY + 6);
		// Linear: a re-landed revision replaces anything at or after it instead of branching.
		const rewound = appendPlanHistory(history, entry(10));
		expect(rewound.at(-1)!.revision).toBe(10);
		expect(rewound.map((candidate) => candidate.revision).filter((revision) => revision >= 10)).toEqual([10]);
	});

	it("compares the previous revision with the current one item by item", () => {
		const before = plan();
		const after: UiDocument = { ...before, revision: 4, nodes: [{ type: "study-plan", id: "plan", title: "Limits", items: [
			{ id: "a", title: "Intuition", status: "done" },
			{ id: "b", title: "Epsilon–delta proofs", status: "done" },
			{ id: "abs", title: "Absolute value" },
		] }] };
		const diff = comparePlanRevisions(before, after);
		expect(diff).toMatchObject({ previousRevision: 1, currentRevision: 4, unchanged: false,
			added: [{ id: "abs", title: "Absolute value" }], removed: [{ id: "c", title: "Continuity" }],
			retitled: [{ id: "b", from: "Epsilon-delta", to: "Epsilon–delta proofs" }],
			statusChanged: [{ id: "b", title: "Epsilon–delta proofs", from: "In progress", to: "Done" }] });
		expect(comparePlanRevisions(before, before).unchanged).toBe(true);
	});
});

describe("failed plan saves", () => {
	it("holds a refused revision in memory, shows it, and announces only after a retry stores it", async () => {
		const storage = flakyStorage(1);
		const outcome = await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "b" }, "autonomous", storage);
		expect(outcome).toMatchObject({ status: "applied", saved: false });
		expect(events).toEqual([PLAN_SAVE_STATUS_EVENT]);
		expect(getPendingPlanSave("plan-doc")?.error).toBe("This browser is out of storage space for Keating.");
		// Nothing stored, but the unsaved change is what the learner (and the next revision) sees.
		expect(storage.map.size).toBe(0);
		expect((await loadCurrentPlan(source(), "plan-doc", storage))?.document.revision).toBe(2);
		expect(loadPlanHistory(storage, "plan-doc")).toHaveLength(1);

		expect(await retryPendingPlanSave("plan-doc", storage)).toBe(true);
		expect(getPendingPlanSave("plan-doc")).toBeNull();
		expect(events).toEqual([PLAN_SAVE_STATUS_EVENT, PLAN_SAVE_STATUS_EVENT, PLAN_REVISED_EVENT]);
		expect(loadSharedUiActionState(storage, plan()).document.revision).toBe(2);
		expect(loadPlanHistory(storage, "plan-doc").map((entry) => entry.revision)).toEqual([2]);
	});

	it("keeps an accepted proposal unsaved together with its status, and dismiss restores the stored plan", async () => {
		const storage = flakyStorage(0);
		const proposed = await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "c" }, "approval", storage);
		if (proposed.status !== "proposed") throw new Error(proposed.status);
		const failing = { ...storage, setItem: () => { throw new Error("Storage is blocked."); } };
		expect(await resolvePlanRevisionProposal(source(), proposed.proposal.id, "accept", failing)).toBe("accepted");
		expect(getPendingPlanSave("plan-doc")?.error).toBe("Storage is blocked.");
		expect(listPlanRevisionProposals(["plan-doc"], storage)[0]!.status).toBe("accepted");
		dismissPendingPlanSave("plan-doc");
		expect(listPlanRevisionProposals(["plan-doc"], storage)[0]!.status).toBe("pending");
		expect((await loadCurrentPlan(source(), "plan-doc", storage))?.document.revision).toBe(1);
	});
});

describe("session workspace materials", () => {
	it("retains concept-map snapshots on presentation records and lists them as session materials", () => {
		const records = presentationsFromAssistantText(mapTurn, { sessionId: "s1", messageId: "m1" }, null, 5);
		const map = records.find((record) => record.component === "concept-map");
		expect(map?.document).toBeDefined();
		const data = sessionWorkspaceMaterials([...records, planRecord(plan(), 1)], "s1", memoryStorage());
		const material = data.materials.find((candidate) => candidate.kind === "concept-map");
		expect(material).toMatchObject({ kind: "concept-map", title: "Limits map", nodeId: "map" });
		expect(material?.kind === "concept-map" && material.document.nodes.map((node) => node.type)).toEqual(["concept-map"]);
		expect(data.currentPlanKey).toBe("plan:plan-doc");
	});

	it("shows the plan advanced to its saved revision and picks the newest plan as current", async () => {
		const storage = memoryStorage();
		await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "b" }, "autonomous", storage);
		const data = sessionWorkspaceMaterials([planRecord(plan(), 1), planRecord(plan("newer"), 9), { ...planRecord(plan("other")), sessionId: "s2" }], "s1", storage);
		expect(data.materials.map((material) => material.key)).toEqual(["plan:newer", "plan:plan-doc"]);
		expect(data.currentPlanKey).toBe("plan:newer");
		const older = data.materials[1]!;
		expect(older.kind === "plan" && older.current.revision).toBe(2);
		expect(older.kind === "plan" && older.presented.revision).toBe(1);
	});

	it("resolves reveal requests for artifacts only", () => {
		const data = sessionWorkspaceMaterials([planRecord(plan(), 1), ...presentationsFromAssistantText(mapTurn, { sessionId: "s1", messageId: "m1" }, null, 5)], "s1", null);
		const mapKey = data.materials.find((material) => material.kind === "concept-map")!.key;
		expect(resolveRevealTarget(data.materials, { kind: "artifact", id: "plan-doc", revision: 1 })?.key).toBe("plan:plan-doc");
		expect(resolveRevealTarget(data.materials, { kind: "artifact", id: mapKey })?.key).toBe(mapKey);
		expect(resolveRevealTarget(data.materials, { kind: "artifact", id: data.materials.find((m) => m.kind === "concept-map")!.documentId })?.kind).toBe("concept-map");
		expect(resolveRevealTarget(data.materials, { kind: "message", id: "plan-doc" })).toBeNull();
		expect(resolveRevealTarget(data.materials, { kind: "artifact", id: "missing" })).toBeNull();
	});

	it("remembers per session whether the workspace was open and what was selected", () => {
		const storage = memoryStorage();
		expect(loadSessionWorkspacePrefs("s1", storage)).toEqual({ open: false, selectedKey: null });
		expect(saveSessionWorkspacePrefs("s1", { open: true, selectedKey: "plan:plan-doc" }, storage)).toBe(true);
		expect(loadSessionWorkspacePrefs("s1", storage)).toEqual({ open: true, selectedKey: "plan:plan-doc" });
		expect(loadSessionWorkspacePrefs("s2", storage)).toEqual({ open: false, selectedKey: null });
		expect(saveSessionWorkspacePrefs("s1", { open: false, selectedKey: null }, { setItem: () => { throw new Error("blocked"); } })).toBe(false);
		storage.setItem("keating:session-workspace:v1:s3", "{not json");
		expect(loadSessionWorkspacePrefs("s3", storage)).toEqual({ open: false, selectedKey: null });
	});

	it("restores the workspace with the saved revision from a fresh storage instance (reload)", async () => {
		(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
		const local = memoryStorage();
		const first = new KeatingStorage();
		const presented = presentationsFromAssistantText(`${planTurn}\n\n${mapTurn}`, { sessionId: "s1", messageId: "m1" }, null, 5);
		expect(await first.recordOpenUiPresentations(presented)).toBe(2);
		const planId = presented.find((record) => record.component === "study-plan")!.documentId;
		expect((await revisePlan(first, planId, { op: "complete-item", itemId: "c" }, "autonomous", local)).status).toBe("applied");
		saveSessionWorkspacePrefs("s1", { open: true, selectedKey: `plan:${planId}` }, local);

		const reloaded = new KeatingStorage();
		const data = sessionWorkspaceMaterials(await reloaded.getOpenUiPresentations("s1"), "s1", local);
		expect(loadSessionWorkspacePrefs("s1", local)).toEqual({ open: true, selectedKey: `plan:${planId}` });
		const restored = data.materials.find((material) => material.key === `plan:${planId}`);
		const presentedRevision = presented.find((record) => record.component === "study-plan")!.revision;
		expect(restored?.kind === "plan" && restored.current.revision).toBe(presentedRevision + 1);
		expect(restored?.kind === "plan" && items(restored.current).find((item) => item.id === "c")?.status).toBe("done");
		expect(data.materials.some((material) => material.kind === "concept-map")).toBe(true);
		expect(loadPlanHistory(local, planId).map((entry) => entry.revision)).toEqual([presentedRevision + 1]);
	});
});
