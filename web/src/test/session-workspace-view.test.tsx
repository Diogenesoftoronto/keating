import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UI_CONTRACT_VERSION, type UiDocument } from "@keating/learner-contracts";
import { SessionWorkspaceView, type SessionWorkspaceViewProps } from "../components/workspace/SessionWorkspaceView";
import { decideWorkspaceProposal } from "../components/workspace/SessionWorkspace";
import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";
import { __resetPendingPlanSaves, type PendingPlanSave } from "../keating/plan-pending-saves";
import { loadPlanHistory } from "../keating/plan-revision-history";
import { listPlanRevisionProposals, loadCurrentPlan, revisePlan } from "../keating/plan-revisions";
import { onRevealQuoteSource, resolveRevealTarget, REVEAL_QUOTE_SOURCE_EVENT, sessionWorkspaceMaterials, type RevealQuoteSourceDetail } from "../keating/session-workspace";
import type { OpenUiPresentationRecord } from "../keating/storage";

const at = "2026-01-01T00:00:00.000Z";
const plan = (id = "plan-doc", revision = 1): UiDocument => ({ schemaVersion: UI_CONTRACT_VERSION, id, revision, lifecycle: "ready", supportedSurfaces: ["web"],
	createdAt: at, updatedAt: at,
	nodes: [{ type: "study-plan", id: "plan", title: id === "plan-doc" ? "Limits" : "Series", items: [
		{ id: "a", title: "Intuition", status: "done" },
		{ id: "b", title: "Epsilon-delta", status: "in_progress" },
	] }] });
const map: UiDocument = { schemaVersion: UI_CONTRACT_VERSION, id: "map-doc", revision: 3, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: at, updatedAt: at,
	nodes: [{ type: "concept-map", id: "map", title: "Limits map", source: "graph TD; A-->B" }] };
const record = (document: UiDocument, createdAt: number, component = "study-plan", nodeId = "plan"): OpenUiPresentationRecord => ({ id: `${document.id}:${nodeId}`,
	documentId: document.id, revision: document.revision, nodeId, component, sessionId: "s1", createdAt, planRef: null, document });
const records = [record(plan(), 1), record(map, 2, "concept-map", "map")];
const source = { getOpenUiPresentations: async () => records };

function memoryStorage() {
	const values = new Map<string, string>();
	return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

const noop = () => {};
function view(overrides: Partial<SessionWorkspaceViewProps> = {}, storage = memoryStorage()) {
	const data = sessionWorkspaceMaterials(records, "s1", storage);
	const props: SessionWorkspaceViewProps = {
		load: { status: "ready", ...data }, selectedKey: null, proposals: [], history: {}, pendingSaves: [], updated: null, compareOpen: false,
		onSelect: noop, onShowLibrary: noop, onReload: noop, onDecide: noop, onRetrySave: noop, onDismissSave: noop, onDismissUpdated: noop, onToggleCompare: noop,
		renderPlan: (material) => <SharedUiDocumentRenderer document={material.current} />,
		...overrides,
	};
	return renderToStaticMarkup(<SessionWorkspaceView {...props} />);
}

const off: Array<() => void> = [];
beforeEach(() => {
	__resetPendingPlanSaves();
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: Object.assign(new EventTarget(), { CustomEvent }) });
	off.push(() => {
		if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	});
});
afterEach(() => { while (off.length) off.pop()!(); });

describe("session workspace view", () => {
	it("opens on the session's current plan, with the quote-source hook and a separate route to the library", () => {
		const html = view();
		expect(html).toContain('data-quote-source-kind="artifact"');
		expect(html).toContain('data-quote-source-id="plan-doc"');
		expect(html).toContain('data-quote-source-revision="1"');
		expect(html).toContain("Epsilon-delta");
		expect(html).toContain("Revision 1");
		expect(html).toContain("This session&#x27;s materials");
		expect(html).toContain("All materials");
		expect(html).toContain('tabindex="-1"');
	});

	it("shows loading, empty and error states with a way forward", () => {
		expect(view({ load: { status: "loading" } })).toContain('role="status"');
		const empty = view({ load: { status: "ready", materials: [], currentPlanKey: null } });
		expect(empty).toContain("No study plan yet for this session");
		expect(empty).toContain("Ask Keating for one");
		const error = view({ load: { status: "error", message: "Blocked by the browser." } });
		expect(error).toContain('role="alert"');
		expect(error).toContain("Blocked by the browser.");
		expect(error).toContain("Try again");
	});

	it("marks an update that landed while open, and an outdated plan, in words not only color", () => {
		const updated = view({ updated: { documentId: "plan-doc", revision: 2, via: "autonomous" } });
		expect(updated).toContain("Updated to revision 2");
		expect(updated).toContain("Changed by Keating");
		const twoPlans = [record(plan(), 1), record(plan("newer"), 5)];
		const data = sessionWorkspaceMaterials(twoPlans, "s1", null);
		const outdated = renderToStaticMarkup(<SessionWorkspaceView {...{ load: { status: "ready", ...data }, selectedKey: "plan:plan-doc", proposals: [], history: {}, pendingSaves: [], updated: null, compareOpen: false,
			onSelect: noop, onShowLibrary: noop, onReload: noop, onDecide: noop, onRetrySave: noop, onDismissSave: noop, onDismissUpdated: noop, onToggleCompare: noop,
			renderPlan: () => null }} />);
		expect(outdated).toContain("Older plan");
		expect(outdated).toContain("Show the current plan");
	});

	it("surfaces an unsaved change with retry and discard", () => {
		const save: PendingPlanSave = { documentId: "plan-doc", writes: {}, error: "This browser is out of storage space for Keating.", failedAt: 1, attempts: 1 };
		const html = view({ pendingSaves: [save] });
		expect(html).toContain("Plan change not saved");
		expect(html).toContain("Retry save");
		expect(html).toContain("Discard change");
		expect(html).toContain("out of storage space");
	});

	it("compares the previous revision with the current one and lists the history", async () => {
		const storage = memoryStorage();
		await revisePlan(source, "plan-doc", { op: "complete-item", itemId: "b" }, "autonomous", storage, () => 1000);
		const html = view({ compareOpen: true, history: { "plan-doc": loadPlanHistory(storage, "plan-doc") } }, storage);
		expect(html).toContain("Revision 1 (before the last change) compared with revision 2 (now)");
		expect(html).toContain("Epsilon-delta: In progress → Done");
		expect(html).toContain("Rev 2");
		expect(html).toContain("Changed by Keating");
		expect(html).toContain('data-quote-source-revision="2"');
	});
});

describe("workspace proposals", () => {
	it("lists pending proposals with Accept/Decline and settles them through resolvePlanRevisionProposal", async () => {
		const storage = memoryStorage();
		const first = await revisePlan(source, "plan-doc", { op: "insert-prerequisite", beforeItemId: "b", item: { id: "abs", title: "Absolute value" } }, "approval", storage);
		const second = await revisePlan(source, "plan-doc", { op: "complete-item", itemId: "b" }, "approval", storage);
		if (first.status !== "proposed" || second.status !== "proposed") throw new Error("expected proposals");
		const html = view({ proposals: listPlanRevisionProposals(["plan-doc"], storage) }, storage);
		expect(html).toContain("2 proposed changes");
		expect(html).toContain("Absolute value");
		expect(html.match(/Accept<\/button>/g)).toHaveLength(2);
		expect(html.match(/Decline<\/button>/g)).toHaveLength(2);
		expect(html).toContain("Decline");

		expect(await decideWorkspaceProposal(source, first.proposal, "accept", storage)).toBeNull();
		expect((await loadCurrentPlan(source, "plan-doc", storage))?.document.revision).toBe(2);
		expect(await decideWorkspaceProposal(source, second.proposal, "decline", storage)).toBeNull();
		expect(listPlanRevisionProposals(["plan-doc"], storage).map((proposal) => proposal.status)).toEqual(["accepted", "declined"]);
		expect(view({ proposals: listPlanRevisionProposals(["plan-doc"], storage) }, storage)).not.toContain("proposed change");
		expect(await decideWorkspaceProposal(source, { id: "missing" }, "accept", storage)).toContain("could not be found");
	});
});

describe("reveal quote source", () => {
	it("opens the named artifact material and ignores other kinds", () => {
		const seen: RevealQuoteSourceDetail[] = [];
		off.push(onRevealQuoteSource((detail) => seen.push(detail)));
		window.dispatchEvent(new CustomEvent(REVEAL_QUOTE_SOURCE_EVENT, { detail: { kind: "message", id: "m1" } }));
		window.dispatchEvent(new CustomEvent(REVEAL_QUOTE_SOURCE_EVENT, { detail: { kind: "artifact", id: "map-doc", revision: 3 } }));
		window.dispatchEvent(new CustomEvent(REVEAL_QUOTE_SOURCE_EVENT, { detail: { kind: "artifact" } }));
		expect(seen).toEqual([{ kind: "artifact", id: "map-doc", revision: 3 }]);

		const data = sessionWorkspaceMaterials(records, "s1", null);
		const target = resolveRevealTarget(data.materials, seen[0]);
		expect(target?.kind).toBe("concept-map");
		const html = view({ selectedKey: target!.key });
		expect(html).toContain('data-quote-source-id="map-doc"');
		expect(html).toContain('data-quote-source-revision="3"');
		expect(html).toContain("Limits map");
	});
});
