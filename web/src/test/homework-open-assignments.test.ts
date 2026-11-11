import { describe, expect, test } from "bun:test";
import type { UiDocument, UiTaskNode } from "@keating/learner-contracts";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import {
	assignmentChatTarget,
	describeDue,
	handedInAssignments,
	openAssignments,
	plainAsk,
	projectAssignments,
	type AssignmentEvidence,
} from "../keating/homework/open-assignments";
import { gatherAssignmentEvidence, loadOpenAssignments, replyProse, type AssignmentDataSource } from "../keating/homework/load-assignments";
import { taskDraftKey, taskSubmissionKey } from "../keating/homework/task-storage";
import type { OpenUiPresentationRecord } from "../keating/storage";

const AT = "2026-11-01T09:00:00.000Z";
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const HOUR = 3_600_000;

function task(overrides: Partial<UiTaskNode> = {}): UiTaskNode {
	return {
		type: "task",
		kind: "assignment",
		id: "essay",
		title: "Explain caching",
		brief: "## Brief\n\nWrite **one page** on when a cache helps.",
		items: [{ id: "read", title: "Read the notes" }, { id: "outline", title: "Outline your answer" }],
		submission: { format: "text" },
		...overrides,
	};
}

function doc(id: string, nodes: UiTaskNode[]): UiDocument {
	return { schemaVersion: 1, id, revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], nodes, createdAt: AT, updatedAt: AT };
}

function memory() {
	const map = new Map<string, string>();
	return { map, storage: { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } } };
}

function evidence(document: UiDocument, overrides: Partial<AssignmentEvidence> = {}): AssignmentEvidence {
	return { sessionId: "session-a", documentId: document.id, presentedAt: NOW - 48 * HOUR, document, receipts: [], ...overrides };
}

describe("open assignments projection", () => {
	test("status moves from not started to in progress to submitted to feedback received", () => {
		const source = doc("doc-1", [task()]);
		const { storage } = memory();
		expect(projectAssignments([evidence(source)], {}, NOW)[0]!.status).toBe("not_started");

		const ticked = dispatchSharedUiAction(storage, source, { type: "complete-task-item", nodeId: "essay", itemId: "read", completed: true }, "2026-11-09T10:00:00.000Z");
		const progressing = projectAssignments([evidence(ticked.document, { receipts: ticked.journal.receipts })], {}, NOW)[0]!;
		expect(progressing.status).toBe("in_progress");
		expect(progressing.items).toEqual({ done: 1, total: 2 });
		expect(progressing.open).toBe(true);

		const submitted = dispatchSharedUiAction(storage, ticked.document, { type: "submit-task", nodeId: "essay", submission: "A cache trades freshness for speed." }, "2026-11-09T11:00:00.000Z");
		const handedIn = projectAssignments([evidence(submitted.document, { receipts: submitted.journal.receipts })], {}, NOW);
		expect(handedIn[0]!.status).toBe("submitted");
		expect(openAssignments(handedIn)).toHaveLength(0);
		expect(handedInAssignments(handedIn)).toHaveLength(1);

		const replies = { "session-a": [
			{ at: Date.parse("2026-11-09T10:30:00.000Z"), text: "Before the submission." },
			{ at: Date.parse("2026-11-09T11:05:00.000Z"), text: "Good start. Name one cost of staleness." },
		] };
		const reviewed = projectAssignments([evidence(submitted.document, { receipts: submitted.journal.receipts })], replies, NOW)[0]!;
		expect(reviewed.status).toBe("feedback_received");
		expect(reviewed.feedback?.text).toBe("Good start. Name one cost of staleness.");
	});

	test("an on-device draft marks a task in progress; an on-device submission hands it in", () => {
		const source = doc("doc-1", [task({ items: [] })]);
		const drafted = projectAssignments([evidence(source, { drafts: { essay: { submission: "Half an answer", notes: {}, savedAt: "2026-11-09T09:00:00.000Z" } } })], {}, NOW)[0]!;
		expect(drafted.status).toBe("in_progress");
		expect(drafted.hasDraft).toBe(true);
		const saved = projectAssignments([evidence(source, { submissions: { essay: { intent: { type: "submit-task", nodeId: "essay", submission: "Done" }, savedAt: "2026-11-09T09:00:00.000Z" } } })], {}, NOW)[0]!;
		expect(saved.status).toBe("submitted");
		expect(saved.hasDraft).toBe(false);
	});

	test("a checklist-only task is done when every item is ticked", () => {
		const source = doc("doc-1", [task({ kind: "practice", submission: { format: "none" }, items: [{ id: "a", title: "A", status: "done" }] })]);
		const [entry] = projectAssignments([evidence(source)], {}, NOW);
		expect(entry!.status).toBe("done");
		expect(entry!.open).toBe(false);
	});

	test("orders overdue first, then by due date, then most recent", () => {
		const entries = projectAssignments([
			evidence(doc("no-due-old", [task({ id: "old", title: "Old, no date" })]), { presentedAt: NOW - 90 * HOUR }),
			evidence(doc("no-due-new", [task({ id: "new", title: "New, no date" })]), { presentedAt: NOW - HOUR }),
			evidence(doc("later", [task({ id: "later", title: "Due later", dueAt: "2026-11-20T12:00:00.000Z" })])),
			evidence(doc("soon", [task({ id: "soon", title: "Due soon", dueAt: "2026-11-11T12:00:00.000Z" })])),
			evidence(doc("late", [task({ id: "late", title: "Overdue", dueAt: "2026-11-08T12:00:00.000Z" })])),
		], {}, NOW);
		expect(entries.map((entry) => entry.title)).toEqual(["Overdue", "Due soon", "Due later", "New, no date", "Old, no date"]);
		expect(entries[0]!.overdue).toBe(true);
		expect(entries[1]!.overdue).toBe(false);
	});

	test("a submitted task is not reported overdue", () => {
		const source = doc("doc-1", [task({ dueAt: "2026-11-08T12:00:00.000Z" })]);
		const [entry] = projectAssignments([evidence(source, { submissions: { essay: { intent: { type: "submit-task", nodeId: "essay", submission: "x" }, savedAt: "2026-11-09T00:00:00.000Z" } } })], {}, NOW);
		expect(entry!.overdue).toBe(false);
	});

	test("a later round supersedes the earlier one and carries its submission and feedback", () => {
		const roundOne = doc("doc-r1", [task({ kind: "draft", round: 1 })]);
		const roundTwo = doc("doc-r2", [task({ kind: "draft", round: 2 })]);
		const entries = projectAssignments([
			evidence(roundOne, { presentedAt: NOW - 30 * HOUR, submissions: { essay: { intent: { type: "submit-task", nodeId: "essay", submission: "First draft", round: 1 }, savedAt: "2026-11-09T08:00:00.000Z" } } }),
			evidence(roundTwo, { presentedAt: NOW - 20 * HOUR }),
		], { "session-a": [{ at: Date.parse("2026-11-09T08:10:00.000Z"), text: "Tighten the second paragraph." }] }, NOW);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.round).toBe(2);
		expect(entries[0]!.documentId).toBe("doc-r2");
		expect(entries[0]!.status).toBe("not_started");
		expect(entries[0]!.earlierRounds).toEqual([{
			round: 1,
			documentId: "doc-r1",
			presentedAt: NOW - 30 * HOUR,
			submission: { text: "First draft", attachments: [], submittedAt: Date.parse("2026-11-09T08:00:00.000Z") },
			feedback: { at: Date.parse("2026-11-09T08:10:00.000Z"), text: "Tighten the second paragraph." },
		}]);
	});

	test("keeps tasks from several sessions apart, even with the same node id", () => {
		const entries = projectAssignments([
			evidence(doc("a", [task()]), { sessionId: "session-a", sessionTitle: "Caching" }),
			evidence(doc("b", [task()]), { sessionId: "session-b", sessionTitle: "Databases" }),
		], {}, NOW);
		expect(entries.map((entry) => entry.sessionId).sort()).toEqual(["session-a", "session-b"]);
		expect(assignmentChatTarget(entries.find((entry) => entry.sessionId === "session-b")!)).toEqual({ to: "/chat", search: { session: "session-b" } });
	});

	test("describes due dates in words", () => {
		expect(describeDue(null, NOW)).toBe("No due date");
		expect(describeDue(NOW + HOUR, NOW)).toStartWith("Due today at");
		expect(describeDue(NOW - 3 * 24 * HOUR, NOW)).toStartWith("Was due 3 days ago, on");
		expect(describeDue(NOW + 24 * HOUR, NOW)).toStartWith("Due tomorrow at");
	});

	test("reduces a markdown brief to its first plain line", () => {
		expect(plainAsk("## Brief\n\nWrite **one page** on [caches](https://x.test).")).toBe("Brief");
		expect(plainAsk("- Write `two` lines")).toBe("Write two lines");
	});
});

describe("assignment loader", () => {
	const scopeMessage = (index: number, timestamp: number, program: string) => ({ role: "assistant", timestamp, content: [{ type: "text", text: `Here is your homework.\n\n\`\`\`openui id=hw\n${program}\n\`\`\`` }], index });

	test("rebuilds a task with no snapshot from its session transcript and reads on-device work", async () => {
		const program = 'essay = Assignment("essay", "Explain caching", "Write one page.", ["Names one cost"], "workspace", 30)\nroot = LearningSurface([essay], "Homework", "Take-home work.", "workspace")';
		const messages = [
			{ role: "user", timestamp: NOW - 50 * HOUR, content: "Give me homework" },
			scopeMessage(1, NOW - 49 * HOUR, program),
			{ role: "assistant", timestamp: NOW - 2 * HOUR, content: [{ type: "text", text: "Thanks, here is my feedback." }] },
		];
		// Find the document id the chat would give this message.
		const { parseOpenUIMessageSegments } = await import("../keating/openui/segments");
		const segment = parseOpenUIMessageSegments((messages[1]!.content as Array<{ text: string }>)[0]!.text, { sessionId: "s1", messageId: `assistant-1-${NOW - 49 * HOUR}` }).find((entry) => entry.type === "openui");
		const documentId = segment?.type === "openui" ? segment.metadata.id : "";
		expect(documentId).not.toBe("");
		const records: OpenUiPresentationRecord[] = [{ id: `${documentId}:essay`, documentId, revision: 0, nodeId: "essay", component: "task", sessionId: "s1", createdAt: NOW - 49 * HOUR, planRef: null }];
		const local = new Map<string, unknown>([[taskDraftKey(documentId, "essay", undefined), { submission: "My draft", notes: {}, savedAt: AT }]]);
		const source: AssignmentDataSource = {
			getOpenUiPresentations: async () => records,
			loadSession: async () => ({ title: "Caching chat", messages }),
			readLocal: async <T,>(_store: "tasks", key: string) => local.get(key) as T | undefined,
			storage: null,
		};
		const loaded = await loadOpenAssignments({ source, now: NOW });
		expect(loaded.unrecoverable).toBe(0);
		expect(loaded.open).toHaveLength(1);
		expect(loaded.open[0]).toMatchObject({ title: "Explain caching", sessionTitle: "Caching chat", status: "in_progress", hasDraft: true, messageTimestamp: NOW - 49 * HOUR });

		local.set(taskSubmissionKey(documentId, "essay", undefined), { intent: { type: "submit-task", nodeId: "essay", submission: "Final" }, savedAt: new Date(NOW - 3 * HOUR).toISOString() });
		const after = await loadOpenAssignments({ source, now: NOW });
		expect(after.open).toHaveLength(0);
		expect(after.handedIn[0]).toMatchObject({ status: "feedback_received", feedback: { text: "Thanks, here is my feedback." } });
	});

	test("counts a task it cannot rebuild instead of failing", async () => {
		const source: AssignmentDataSource = {
			getOpenUiPresentations: async () => [{ id: "gone:essay", documentId: "gone", revision: 0, nodeId: "essay", component: "task", sessionId: "s1", createdAt: NOW, planRef: null }],
			loadSession: async () => null,
			readLocal: async () => undefined,
			storage: null,
		};
		const { evidence, unrecoverable } = await gatherAssignmentEvidence(source);
		expect(evidence).toHaveLength(0);
		expect(unrecoverable).toBe(1);
	});

	test("feedback prose drops OpenUI blocks", () => {
		expect(replyProse("Nice work.\n\n```openui id=x\nroot = Assignment()\n```\n\nNext round below.")).toBe("Nice work.\n\nNext round below.");
	});
});
