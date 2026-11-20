import { describe, expect, test } from "bun:test";
import { UI_CONTRACT_VERSION, type UiDocument, type UiDocumentNode } from "@keating/learner-contracts";
import { dispatchSharedUiAction } from "../keating/openui/shared-actions";
import { parseOpenUIMessageSegments } from "../keating/openui/segments";
import {
	findSessionMaterial,
	gatherSessionMaterials,
	loadSessionMaterials,
	resolveSessionMaterialReveal,
	summarizeMaterialsBySession,
	taskStatusLabel,
	type SessionMaterialsSource,
} from "../keating/session-materials";
import { presentationsFromAssistantText } from "../keating/judgement/active-work-host";
import type { OpenUiPresentationRecord } from "../keating/storage";

const AT = "2026-11-01T09:00:00.000Z";
const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const HOUR = 3_600_000;

function doc(id: string, nodes: UiDocumentNode[]): UiDocument {
	return { schemaVersion: UI_CONTRACT_VERSION, id, revision: 1, lifecycle: "ready", supportedSurfaces: ["web"], createdAt: AT, updatedAt: AT, nodes };
}

function record(document: UiDocument | null, documentId: string, nodeId: string, component: string, createdAt: number, sessionId = "s1"): OpenUiPresentationRecord {
	return { id: `${documentId}:${nodeId}`, documentId, revision: 1, nodeId, component, sessionId, createdAt, planRef: null, ...(document ? { document } : {}) };
}

function memory() {
	const map = new Map<string, string>();
	return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}

const plan = doc("plan-doc", [{ type: "study-plan", id: "plan", title: "Limits", items: [
	{ id: "a", title: "Intuition", status: "done" },
	{ id: "b", title: "Epsilon-delta", children: [{ id: "b1", title: "Definition" }, { id: "b2", title: "Proofs", status: "done" }] },
] }]);
const map = doc("map-doc", [{ type: "concept-map", id: "map", title: "Limits map", source: "graph TD; A-->B" }]);
const quiz = doc("quiz-doc", [
	{ type: "markdown", id: "intro", markdown: "Try these." },
	{ type: "quiz", id: "quiz", title: "Limits check", questions: [
		{ id: "q1", kind: "multiple_choice", prompt: "Is a limit a value?", choices: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
		{ id: "q2", kind: "text", prompt: "Define a limit." },
	] },
]);
const deck = doc("deck-doc", [{ type: "deck", id: "deck", title: "Limit cards", topic: "limits", cards: [{ id: "c1", front: "Limit?", back: "Approach value" }, { id: "c2", front: "Continuity?", back: "No gaps" }] }]);
const practice = doc("task-doc", [{ type: "task", kind: "practice", id: "drills", title: "Ten limit drills", brief: "Work through the drills.", items: [{ id: "one", title: "Drill 1" }], dueAt: "2026-11-21T17:00:00.000Z" }]);
const notes = doc("notes-doc", [{ type: "notes", id: "notes", title: "My notes", value: "" }]);
const audio = doc("audio-doc", [{ type: "media", id: "clip", kind: "audio", resource: { id: "r1", title: "Pronunciation", format: "markdown" } }]);
const question = doc("question-doc", [{ type: "question", id: "check", prompt: "Quick check?", kind: "text" }]);

const records = [
	record(plan, "plan-doc", "plan", "study-plan", NOW - 10 * HOUR),
	record(map, "map-doc", "map", "concept-map", NOW - 9 * HOUR),
	record(quiz, "quiz-doc", "quiz", "quiz", NOW - 8 * HOUR),
	record(deck, "deck-doc", "deck", "deck", NOW - 7 * HOUR),
	record(practice, "task-doc", "drills", "task", NOW - 6 * HOUR),
	record(notes, "notes-doc", "notes", "notes", NOW - 5 * HOUR),
	record(audio, "audio-doc", "clip", "media", NOW - 4 * HOUR),
	record(question, "question-doc", "check", "question", NOW - 3 * HOUR),
	record(quiz, "other-quiz", "quiz", "quiz", NOW - 2 * HOUR, "s2"),
];

describe("session materials gathering", () => {
	test("lists every material kind in panel order with learner-facing labels, never single questions", () => {
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records, storage: memory(), now: NOW });
		expect(materials.map((material) => [material.group, material.label, material.title])).toEqual([
			["plan", "Study plan", "Limits"],
			["maps", "Concept map", "Limits map"],
			["practice", "Flashcards", "Limit cards"],
			["practice", "Quiz", "Limits check"],
			["assignments", "Practice set", "Ten limit drills"],
			["notes", "Notes", "My notes"],
			["media", "Audio", "Pronunciation"],
		]);
		expect(materials.every((material) => material.source !== "missing")).toBe(true);
		// Workspace keys still resolve, so remembered selections keep working.
		expect(findSessionMaterial(materials, "plan:plan-doc")?.kind).toBe("plan");
		expect(findSessionMaterial(materials, "map:map-doc:map")?.kind).toBe("concept-map");
	});

	test("puts the newest plan first and orders the rest of a group newest first", () => {
		const older = doc("older-plan", [{ type: "study-plan", id: "plan", title: "Older", items: [] }]);
		const { materials } = gatherSessionMaterials({ sessionId: "s1", storage: null, now: NOW, records: [
			record(older, "older-plan", "plan", "study-plan", NOW - 20 * HOUR),
			record(plan, "plan-doc", "plan", "study-plan", NOW - HOUR),
			record(quiz, "quiz-a", "quiz", "quiz", NOW - 5 * HOUR),
			record(quiz, "quiz-b", "quiz", "quiz", NOW - 2 * HOUR),
		] });
		expect(materials.map((material) => material.key)).toEqual(["plan:plan-doc", "plan:older-plan", "node:quiz-b:quiz", "node:quiz-a:quiz"]);
	});

	test("reports short factual status from the learner's recorded work", () => {
		const storage = memory();
		dispatchSharedUiAction(storage, notes, { type: "update-notes", nodeId: "notes", value: "Limits approach, they need not equal." }, AT);
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records, storage, now: NOW });
		const status = Object.fromEntries(materials.map((material) => [material.title, material.status]));
		expect(status).toMatchObject({
			Limits: "2 of 3 done",
			"Limit cards": "2 cards",
			"Limits check": "Not started",
			"Ten limit drills": "Due Sat 21 Nov",
			"My notes": "Edited",
		});
		const notesMaterial = materials.find((material) => material.title === "My notes");
		expect(notesMaterial?.source === "openui" && notesMaterial.document.nodes[0]?.type === "notes" && notesMaterial.document.nodes[0].value).toBe("Limits approach, they need not equal.");
		// Narrowed to the one node, so the detail shows only that material.
		const quizMaterial = materials.find((material) => material.title === "Limits check");
		expect(quizMaterial?.source === "openui" && quizMaterial.document.nodes.map((node) => node.id)).toEqual(["quiz"]);
	});

	test("labels task status from the homework projection", () => {
		expect(taskStatusLabel({ status: "in_progress", open: true, overdue: true, dueAt: NOW - HOUR })).toBe("Overdue");
		expect(taskStatusLabel({ status: "submitted", open: false, overdue: false, dueAt: NOW + HOUR })).toBe("Handed in");
		expect(taskStatusLabel({ status: "feedback_received", open: false, overdue: false, dueAt: null })).toBe("Feedback ready");
		expect(taskStatusLabel({ status: "in_progress", open: true, overdue: false, dueAt: null })).toBe("In progress");
	});

	test("lists earlier stored records tagged with this session only", () => {
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records: [], storage: null, now: NOW, legacy: {
			plans: [{ id: "lp", topic: "Derivatives", content: "# Plan", createdAt: NOW - HOUR, updatedAt: NOW - HOUR, sessionId: "s1" } as never],
			verifications: [{ id: "v", topic: "Proof check", checklist: "- [ ] a", createdAt: NOW - 2 * HOUR, sessionId: "s1" } as never],
			decks: [{ id: "d", topic: "t", slug: "t", title: "Elsewhere", cards: [], createdAt: NOW, updatedAt: NOW, sessionId: "s2" }],
			animations: [{ id: "a", topic: "No session", createdAt: NOW } as never],
		} });
		expect(materials.map((material) => [material.group, material.label, material.title])).toEqual([
			["saved", "Lesson plan", "Derivatives"],
			["saved", "Checklist", "Proof check"],
		]);
	});

	test("an animation made with the current tool is listed as media, not as an earlier saved item", () => {
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records: [], storage: null, now: NOW, legacy: {
			animations: [{ id: "a", topic: "Wave interference", createdAt: NOW - HOUR, sessionId: "s1" } as never],
			plans: [{ id: "lp", topic: "Waves", content: "# Plan", createdAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR, sessionId: "s1" } as never],
		} });
		expect(materials.map((material) => [material.group, material.label, material.title])).toEqual([
			["media", "Animation", "Wave interference"],
			["saved", "Lesson plan", "Waves"],
		]);
	});
});

describe("session materials recovery", () => {
	const program = 'quiz = Quiz("limits-quiz", "Limits check", [{ id: "tf", type: "true_false", level: "recall", question: "A limit can exist where a function is undefined.", correctAnswer: "true", explanation: "Holes do not stop a limit." }], "resumable")\nroot = LearningSurface([quiz], "Practice", "A quick check.", "workspace")';
	const text = `Try this.\n\n\`\`\`openui id=practice\n${program}\n\`\`\``;
	const messages = [
		{ role: "user", timestamp: NOW - 3 * HOUR, content: "Quiz me" },
		{ role: "assistant", timestamp: NOW - 2 * HOUR, content: [{ type: "text", text }] },
	];
	const scope = { sessionId: "s1", messageId: `assistant-1-${NOW - 2 * HOUR}` };
	const segment = parseOpenUIMessageSegments(text, scope).find((entry) => entry.type === "openui");
	const documentId = segment?.type === "openui" ? segment.metadata.id : "";

	function source(overrides: Partial<SessionMaterialsSource> = {}, list: OpenUiPresentationRecord[] = [record(null, documentId, "limits-quiz", "quiz", NOW - 2 * HOUR)]): SessionMaterialsSource {
		return { getOpenUiPresentations: async () => list, loadSession: async () => ({ messages }), ...overrides };
	}

	test("rebuilds a material with no snapshot from the session transcript", async () => {
		expect(documentId).not.toBe("");
		const { materials } = await loadSessionMaterials(source(), "s1", null, { now: NOW });
		expect(materials).toHaveLength(1);
		expect(materials[0]).toMatchObject({ source: "openui", kind: "quiz", title: "Limits check", status: "Not started", documentId });
	});

	test("falls back to the action journal copy when the transcript has nothing", async () => {
		const storage = memory();
		const rebuilt = presentationsFromAssistantText(text, scope, null, NOW)[0]!.document!;
		dispatchSharedUiAction(storage, rebuilt, { type: "complete-quiz", nodeId: "limits-quiz", resultId: "r1", answers: [{ questionId: "quiz-tf", answer: "quiz-tf-true" }], score: 1, partialCreditPoints: 0, partialCredits: {},
			timing: { totalMs: 1000, perQuestionMs: { "quiz-tf": 1000 } }, flaggedQuestionIds: [], pendingGradeQuestionIds: [], skippedQuestionIds: [] }, AT);
		const { materials } = await loadSessionMaterials(source({ loadSession: async () => null }), "s1", storage, { now: NOW });
		// The journal copy carries the completion, and its score.
		expect(materials[0]).toMatchObject({ source: "openui", title: "Limits check", status: "Completed · 1/1" });
	});

	test("keeps an unrecoverable material in the list instead of dropping it", async () => {
		const { materials } = await loadSessionMaterials(source({ loadSession: async () => ({ messages: [] }) }), "s1", null, { now: NOW });
		expect(materials).toEqual([expect.objectContaining({ source: "missing", kind: "quiz", label: "Quiz", status: null })]);
	});

	test("does not read the transcript when every material has its snapshot", async () => {
		let reads = 0;
		await loadSessionMaterials(source({ loadSession: async () => { reads += 1; return null; } }, [record(quiz, "quiz-doc", "quiz", "quiz", NOW)]), "s1", null, { now: NOW });
		expect(reads).toBe(0);
	});
});

describe("session materials reveal and snapshots", () => {
	test("a reveal resolves plans as before, and any other material by its document", () => {
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records, storage: null, now: NOW });
		expect(resolveSessionMaterialReveal(materials, { kind: "artifact", id: "plan-doc" })?.key).toBe("plan:plan-doc");
		expect(resolveSessionMaterialReveal(materials, { kind: "artifact", id: "quiz-doc" })?.key).toBe("node:quiz-doc:quiz");
		expect(resolveSessionMaterialReveal(materials, { kind: "message", id: "quiz-doc" })).toBeNull();
	});

	test("new presentations keep a snapshot for materials, never for questions, and never become plans", () => {
		const turn = '```openui id=mixed\nquiz = Quiz("q", "Check", [{ id: "tf", type: "true_false", level: "recall", question: "True?", correctAnswer: "true", explanation: "Yes." }], "resumable")\nroot = LearningSurface([quiz], "Practice", "Check.", "workspace")\n```';
		const [presented] = presentationsFromAssistantText(turn, { sessionId: "s1", messageId: "m1" }, null, NOW);
		expect(presented).toMatchObject({ component: "quiz" });
		expect(presented!.document?.nodes.some((node) => node.type === "quiz")).toBe(true);
		const { workspace } = gatherSessionMaterials({ sessionId: "s1", records: [presented!], storage: null, now: NOW });
		expect(workspace.materials).toHaveLength(0);
		expect(workspace.currentPlanKey).toBeNull();
	});
});

describe("session materials list view", () => {
	test("a lab shows the selected checkpoint evidence without mounting its device controls", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { createElement } = await import("react");
		const { SessionMaterialsPanel } = await import("../components/workspace/SessionMaterialsPanel");
		const labs = doc("measurements", [
			{ type: "lab", id: "first", title: "First", brief: "Other lab brief", adapter: { kind: "midi" },
				checkpoints: [{ id: "key", title: "Play C", check: { kind: "notes", notes: [60] } }] },
			{ type: "lab", id: "sensor", title: "Measure", brief: "Check the voltage.", adapter: { kind: "serial", unit: "mV", baudRate: 9600 },
				checkpoints: [{ id: "low", title: "Set a low voltage", check: { kind: "range", min: 5, max: 10 } }] },
		]);
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records: [record(labs, labs.id, "sensor", "lab", NOW)], storage: null });
		const material = materials[0]!;
		if (material.source !== "openui") throw new Error("Lab material could not be resolved");
		material.receipts.push({ schemaVersion: UI_CONTRACT_VERSION, actionFingerprint: "saved", createdAt: AT, updatedAt: AT, state: "completed",
			action: { schemaVersion: UI_CONTRACT_VERSION, type: "observe-lab", documentId: labs.id, documentRevision: 1, nodeId: "sensor",
				attemptId: "read-1", checkpointId: "low", passed: true, observation: { kind: "range", value: 7, input: "device" },
				evidence: "Device reading: 7 mV", idempotencyKey: "sensor-low" } });
		const noop = () => {};
		const render = () => renderToStaticMarkup(createElement(SessionMaterialsPanel, { sessionId: "s1", selectedKey: material.key, onSelect: noop,
			source: { getOpenUiPresentations: async () => [] }, onShowLibrary: noop, onClose: noop,
			state: { sessionId: "s1", load: { status: "ready", materials, currentPlanKey: null }, arrival: null, reload: noop,
				workspace: { load: { status: "loading" }, proposals: [], history: {}, pendingSaves: [], updated: null, dismissUpdated: noop, reload: noop } },
		}));
		const html = render();
		for (const text of ["Check the voltage.", "Set a low voltage", "Checkpoint met", "Device reading: 7 mV"]) expect(html).toContain(text);
		expect(html).not.toMatch(/Connect device|Manual reading|Play C|Other lab brief/);
		material.document = labs;
		material.nodeId = "removed-node";
		expect(render()).toContain("missing from the saved document");
		expect(render()).not.toContain("Other lab brief");
	});
	test("groups rows under fixed section labels with kind, time and status, and offers suggestions", async () => {
		const { renderToStaticMarkup } = await import("react-dom/server");
		const { createElement } = await import("react");
		const { SessionMaterialList } = await import("../components/workspace/SessionMaterialsPanel");
		const { materials } = gatherSessionMaterials({ sessionId: "s1", records, storage: null, now: NOW });
		const html = renderToStaticMarkup(createElement(SessionMaterialList, { materials, selectedKey: "plan:plan-doc", sessionId: "s1", onOpen: () => {}, now: NOW }));
		const order = ["Plan", "Maps and diagrams", "Practice", "Assignments", "Notes and goals", "Media"].map((label) => html.indexOf(`>${label}<`));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(html).not.toContain("Earlier saved items");
		expect(html).toContain('aria-current="true"');
		expect(html).toContain("2 of 3 done");
		expect(html).toContain("Quiz · ");
		expect(html).toContain("Ask Keating for…");
		expect(html).not.toMatch(/artifact|OpenUI/i);
		const empty = renderToStaticMarkup(createElement(SessionMaterialList, { materials: [], selectedKey: null, sessionId: "s1", onOpen: () => {}, now: NOW }));
		for (const text of ["Make me a study plan", "Quiz me on what we covered", "Give me an assignment"]) expect(empty).toContain(text);
	});
});

describe("materials across conversations", () => {
	test("counts each conversation's materials by kind, newest conversation first", () => {
		const summaries = summarizeMaterialsBySession([
			record(null, "plan-doc", "plan", "study-plan", NOW - 5 * HOUR, "older"),
			record(null, "quiz-a", "quiz", "quiz", NOW - 4 * HOUR, "older"),
			record(null, "quiz-b", "quiz", "quiz", NOW - 3 * HOUR, "older"),
			record(null, "deck-doc", "deck", "deck", NOW - HOUR, "newer"),
			record(null, "task-doc", "task", "task", NOW - 2 * HOUR, "newer"),
		]);
		expect(summaries).toEqual([
			{ sessionId: "newer", latestAt: NOW - HOUR, total: 2, kinds: [{ label: "Flashcards", count: 1 }, { label: "Assignment", count: 1 }] },
			{ sessionId: "older", latestAt: NOW - 3 * HOUR, total: 3, kinds: [{ label: "Study plan", count: 1 }, { label: "Quiz", count: 2 }] },
		]);
	});

	test("a conversational question is not a material, and a plan shown again is still one plan", () => {
		const summaries = summarizeMaterialsBySession([
			record(null, "q-doc", "check", "question", NOW - HOUR),
			record(null, "plan-doc", "plan", "study-plan", NOW - 3 * HOUR),
			{ ...record(null, "plan-doc", "plan-again", "study-plan", NOW - 2 * HOUR), id: "plan-doc:plan-again" },
		]);
		expect(summaries).toEqual([{ sessionId: "s1", latestAt: NOW - 2 * HOUR, total: 1, kinds: [{ label: "Study plan", count: 1 }] }]);
	});

	test("earlier stored records count under their own conversation; untagged ones are left out", () => {
		const summaries = summarizeMaterialsBySession([], {
			plans: [{ id: "lp", topic: "Derivatives", content: "# Plan", createdAt: NOW - HOUR, updatedAt: NOW - HOUR, sessionId: "s1" } as never],
			animations: [{ id: "a", topic: "Waves", createdAt: NOW - 2 * HOUR, sessionId: "s1" } as never, { id: "b", topic: "No session", createdAt: NOW } as never],
		});
		expect(summaries).toEqual([{ sessionId: "s1", latestAt: NOW - HOUR, total: 2, kinds: [{ label: "Animation", count: 1 }, { label: "Lesson plan", count: 1 }] }]);
	});
});
