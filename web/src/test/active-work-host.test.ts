import { describe, expect, it } from "bun:test";
import { UI_ACTION_JOURNAL_KIND } from "@keating/learner-contracts";
import { loadActiveWork, presentationsFromAssistantText, recordAssistantPresentations } from "../keating/judgement/active-work-host";
import { sharedUiActionStateKey } from "../keating/openui/shared-actions";
import type { OpenUiPresentationRecord, QuestionCheckRecord } from "../keating/storage";

const planTurn = [
	"Here is the path.",
	"```openui lifecycle=workspace id=dns",
	'root = LearningSurface([plan], "DNS", "How lookups resolve.", "workspace")',
	'plan = StudyPlan("resolution-plan", "Resolution plan", [{ id: "trace", title: "Trace a cold lookup" }, { id: "ttl", title: "Reason about TTL" }], "workspace")',
	"```",
].join("\n");

const questionTurn = [
	"Try this.",
	"```openui id=check",
	'root = LearningSurface([check], "DNS", "A quick check.", "ephemeral")',
	'check = Question([{ question: "Why can a repeated lookup be faster?", type: "text" }], "ephemeral", "DNS")',
	"```",
].join("\n");

function memorySource(checks: QuestionCheckRecord[] = []) {
	const records = new Map<string, OpenUiPresentationRecord>();
	return {
		records,
		checks,
		async getOpenUiPresentations(sessionId?: string) {
			return [...records.values()].filter((record) => !sessionId || record.sessionId === sessionId);
		},
		async getQuestionChecks() { return checks; },
		async recordOpenUiPresentations(next: readonly OpenUiPresentationRecord[]) {
			let added = 0;
			for (const record of next) if (!records.has(record.id)) { records.set(record.id, record); added += 1; }
			return added;
		},
	};
}

const emptyStorage = { getItem: () => null };

describe("active work host", () => {
	it("records interactive nodes with the renderer's scoped document ids", () => {
		const records = presentationsFromAssistantText(questionTurn, { sessionId: "s1", messageId: "m1" }, null, 5);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ component: "question-group", sessionId: "s1", createdAt: 5, planRef: null });
		expect(records[0]!.documentId).toStartWith("openui-");
		expect(records[0]!.document).toBeUndefined();
	});

	it("keeps a plan snapshot and never links a plan to its own items", () => {
		const [plan] = presentationsFromAssistantText(planTurn, { sessionId: "s1", messageId: "m1" }, { documentId: "x", itemId: "y" });
		expect(plan).toMatchObject({ component: "study-plan", planRef: null });
		expect(plan!.document?.nodes.some((node) => node.type === "study-plan")).toBe(true);
	});

	it("links later questions to the focus current when they were presented and joins answers", async () => {
		const source = memorySource();
		await recordAssistantPresentations(source, planTurn, { sessionId: "s1", messageId: "m1" });
		await recordAssistantPresentations(source, questionTurn, { sessionId: "s1", messageId: "m2" });
		const question = [...source.records.values()].find((record) => record.component === "question-group")!;
		expect(question.planRef?.itemId).toBe("trace");

		source.checks.push({
			id: "c1", topic: "DNS", question: "Why?", answer: "cache", grading: "auto", score: 1, createdAt: 10, sessionId: "s1",
			source: { documentId: question.documentId, revision: question.revision, nodeId: question.nodeId },
		});
		const work = await loadActiveWork(source, "s1", emptyStorage);
		expect(work.focus?.itemId).toBe("trace");
		expect(work.focus?.evidence).toMatchObject({ presented: 1, attempted: 1, correct: 1 });
		expect(work.openInteractions).toEqual([]);
	});

	it("re-rendering a turn does not relink its first presentation", async () => {
		const source = memorySource();
		await recordAssistantPresentations(source, questionTurn, { sessionId: "s1", messageId: "m2" });
		await recordAssistantPresentations(source, planTurn, { sessionId: "s1", messageId: "m1" });
		expect(await recordAssistantPresentations(source, questionTurn, { sessionId: "s1", messageId: "m2" })).toBe(0);
		expect([...source.records.values()].find((record) => record.component === "question-group")?.planRef).toBeNull();
	});

	it("uses the learner-updated plan revision from shared action state", async () => {
		const source = memorySource();
		await recordAssistantPresentations(source, planTurn, { sessionId: "s1", messageId: "m1" });
		const plan = [...source.records.values()][0]!;
		const document = structuredClone(plan.document!);
		const updated = {
			...document,
			revision: document.revision + 1,
			nodes: document.nodes.map((node) => node.type === "study-plan"
				? { ...node, items: node.items?.map((item) => item.id === "trace" ? { ...item, status: "done" as const } : item) }
				: node),
		};
		const stored = JSON.stringify({
			version: 1,
			document: updated,
			journal: { kind: UI_ACTION_JOURNAL_KIND, schemaVersion: 1, documentId: document.id, receipts: [] },
			deliveries: [],
		});
		const storage = { getItem: (key: string) => key === sharedUiActionStateKey(document.id) ? stored : null };
		const work = await loadActiveWork(source, "s1", storage);
		expect(work.focus?.itemId).toBe("ttl");
	});

	it("is empty without a session", async () => {
		const work = await loadActiveWork(memorySource(), null, emptyStorage);
		expect(work).toEqual({ plan: null, focus: null, openInteractions: [], truncated: false });
	});
});
