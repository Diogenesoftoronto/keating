import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createTeachingTools } from "../keating/browser-tools/teaching";
import { parseInteractiveSegments } from "../components/interactive-segments";
import { PlanRevisionCard } from "../components/PlanRevisionCard";
import { UI_CONTRACT_VERSION, type UiDocument, type UiStudyPlanNode } from "@keating/learner-contracts";
import { keatingLifecycle, type KeatingLifecycleEvent } from "../keating/lifecycle";
import { loadSharedUiActionState, sharedUiActionStateKey } from "../keating/openui/shared-actions";
import { getPlanRevisionProposal, loadCurrentPlan, planRevisionChangeFrom, resolvePlanRevisionProposal, revisePlan } from "../keating/plan-revisions";
import type { OpenUiPresentationRecord } from "../keating/storage";

const plan = (): UiDocument => ({ schemaVersion: UI_CONTRACT_VERSION, id: "plan-doc", revision: 1, lifecycle: "ready", supportedSurfaces: ["web"],
	createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	nodes: [{ type: "study-plan", id: "plan", title: "Limits", items: [
		{ id: "a", title: "Intuition", status: "done" },
		{ id: "b", title: "Epsilon-delta", status: "in_progress", dependsOn: ["a"] },
	] }] });

const record = (document: UiDocument): OpenUiPresentationRecord => ({ id: `${document.id}:plan`, documentId: document.id, revision: document.revision,
	nodeId: "plan", component: "study-plan", sessionId: "s1", createdAt: 1, planRef: null, document });
const source = (records: OpenUiPresentationRecord[] = [record(plan())]) => ({ getOpenUiPresentations: async () => records });

function memoryStorage() {
	const map = new Map<string, string>();
	return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}

const items = (doc: UiDocument | null | undefined) => (doc?.nodes[0] as UiStudyPlanNode | undefined)?.items ?? [];
const off: Array<() => void> = [];
beforeEach(() => {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: Object.assign(new EventTarget(), { CustomEvent }) });
	off.push(() => {
		if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});
});
afterEach(() => { while (off.length) off.pop()!(); });

function captureHook() {
	const events: KeatingLifecycleEvent[] = [];
	off.push(keatingLifecycle.on("plan_revised", (event) => { events.push(event); }));
	return events;
}

describe("plan revisions", () => {
	it("applies autonomously by default, keeps the journal, and fires the plan_revised hook", async () => {
		const storage = memoryStorage();
		const events = captureHook();
		const outcome = await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "b" }, undefined, storage);
		expect(outcome.status).toBe("applied");
		const stored = loadSharedUiActionState(storage, plan());
		expect(stored.document.revision).toBe(2);
		expect(items(stored.document).find((item) => item.id === "b")?.status).toBe("done");
		expect(stored.journal.documentId).toBe("plan-doc");
		expect((await loadCurrentPlan(source(), "plan-doc", storage))?.document.revision).toBe(2);
		expect(events).toEqual([{ type: "plan_revised", sessionId: "s1", documentId: "plan-doc", revision: 2, op: "complete-item", via: "autonomous" }]);
		expect(storage.getItem(sharedUiActionStateKey("plan-doc"))).not.toBeNull();
	});

	it("rejects an unknown plan or a change that does not fit, leaving the plan alone", async () => {
		const storage = memoryStorage();
		expect(await revisePlan(source(), "missing", { op: "complete-item", itemId: "b" }, "autonomous", storage)).toEqual({ status: "rejected", reason: "no-plan" });
		expect(await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "zzz" }, "autonomous", storage)).toEqual({ status: "rejected", reason: "invalid-change" });
		expect(storage.getItem(sharedUiActionStateKey("plan-doc"))).toBeNull();
	});

	it("approval mode proposes without applying; accept applies and fires the hook", async () => {
		const storage = memoryStorage();
		const events = captureHook();
		const change = { op: "insert-prerequisite", beforeItemId: "b", item: { id: "abs", title: "Absolute value" } } as const;
		const outcome = await revisePlan(source(), "plan-doc", change, "approval", storage);
		if (outcome.status !== "proposed") throw new Error(outcome.status);
		expect(storage.getItem(sharedUiActionStateKey("plan-doc"))).toBeNull();
		expect(events).toEqual([]);
		expect(await resolvePlanRevisionProposal(source(), outcome.proposal.id, "accept", storage)).toBe("accepted");
		expect(items(loadSharedUiActionState(storage, plan()).document).map((item) => item.id)).toEqual(["a", "abs", "b"]);
		expect(events.map((event) => event.type === "plan_revised" && event.via)).toEqual(["accepted"]);
		// Settled proposals stay settled.
		expect(await resolvePlanRevisionProposal(source(), outcome.proposal.id, "decline", storage)).toBe("accepted");
	});

	it("decline leaves the plan unchanged, and accept on a plan that moved on marks the proposal stale", async () => {
		const storage = memoryStorage();
		const declined = await revisePlan(source(), "plan-doc", { op: "complete-item", itemId: "b" }, "approval", storage);
		if (declined.status !== "proposed") throw new Error(declined.status);
		expect(await resolvePlanRevisionProposal(source(), declined.proposal.id, "decline", storage)).toBe("declined");
		expect(storage.getItem(sharedUiActionStateKey("plan-doc"))).toBeNull();

		const change = { op: "expand-item", itemId: "b", children: [{ id: "b1", title: "Definition" }] } as const;
		const first = await revisePlan(source(), "plan-doc", change, "approval", storage);
		const second = await revisePlan(source(), "plan-doc", change, "approval", storage);
		if (first.status !== "proposed" || second.status !== "proposed") throw new Error("expected proposals");
		expect(await resolvePlanRevisionProposal(source(), first.proposal.id, "accept", storage)).toBe("accepted");
		// b1 now exists, so the identical second proposal no longer fits.
		expect(await resolvePlanRevisionProposal(source(), second.proposal.id, "accept", storage)).toBe("stale");
		expect(getPlanRevisionProposal(second.proposal.id, storage)?.status).toBe("stale");
	});

	it("parses tool arguments into one bounded change", () => {
		expect(planRevisionChangeFrom({ change: "complete-item", item_id: "b" })).toEqual({ op: "complete-item", itemId: "b" });
		expect(planRevisionChangeFrom({ change: "insert-prerequisite", item_id: "b", items: [{ id: "p", title: " Prereq ", outcomes: ["x", 3] }] }))
			.toEqual({ op: "insert-prerequisite", beforeItemId: "b", item: { id: "p", title: "Prereq", outcomes: ["x"] } });
		expect(planRevisionChangeFrom({ change: "expand-item", item_id: "b", items: [] })).toBeNull();
		expect(planRevisionChangeFrom({ change: "expand-item", item_id: "b", items: Array.from({ length: 9 }, (_, n) => ({ id: `c${n}`, title: "t" })) })).toBeNull();
		expect(planRevisionChangeFrom({ change: "expand-item", item_id: "b", items: [{ id: "c", title: "" }] })).toBeNull();
		expect(planRevisionChangeFrom({ change: "rewrite", item_id: "b" })).toBeNull();
		expect(planRevisionChangeFrom({ change: "complete-item" })).toBeNull();
	});

	it("the revise_study_plan tool applies by default and emits an Accept/Decline card in approval mode", async () => {
		const testGlobal = globalThis as { localStorage?: unknown };
		const previous = testGlobal.localStorage;
		const local = memoryStorage();
		testGlobal.localStorage = local;
		off.push(() => { testGlobal.localStorage = previous; });
		const tool = createTeachingTools(source() as never).find((candidate) => candidate.name === "revise_study_plan")!;
		const run = async (params: Record<string, unknown>) => {
			const result = await (tool.execute as any)("call", params, undefined, () => {});
			return result.content.map((item: { text?: string }) => item.text ?? "").join("\n") as string;
		};

		expect(await run({ plan_document_id: "plan-doc", change: "complete-item", item_id: "b" })).toContain("Plan revised (complete-item)");
		expect(local.getItem(sharedUiActionStateKey("plan-doc"))).not.toBeNull();
		await expect(run({ plan_document_id: "plan-doc", change: "complete-item", item_id: "nope" })).rejects.toThrow("does not fit the plan");

		local.setItem("keating_ui_settings", JSON.stringify({ planChanges: "approval" }));
		const text = await run({ plan_document_id: "plan-doc", change: "expand-item", item_id: "b", items: [{ id: "b1", title: "Write the definition" }] });
		const card = parseInteractiveSegments(text).find((segment) => segment.type === "plan-revision");
		if (card?.type !== "plan-revision") throw new Error("missing plan-revision card");
		const proposal = JSON.parse(JSON.parse(card.json));
		const html = renderToStaticMarkup(<PlanRevisionCard proposal={proposal} />);
		expect(html).toContain("Accept");
		expect(html).toContain("Decline");
		expect(html).toContain("Write the definition");
	});
});
