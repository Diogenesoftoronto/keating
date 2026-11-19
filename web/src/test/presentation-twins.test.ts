import { afterEach, describe, expect, it } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { presentationsFromAssistantText } from "../keating/judgement/active-work-host";
import { isPresentationTwin, withoutPresentationTwins } from "../keating/openui/presentation-twins";
import { gatherSessionMaterials } from "../keating/session-materials";
import { KeatingStorage, type OpenUiPresentationRecord } from "../keating/storage";
import { renderAsServer } from "./server-render-env";

// Other test files leave a partial `window` behind; storage must not try to announce changes on it.
renderAsServer();

// One tutor turn that presents one flashcard deck, as the walkthrough's scripted tutor does.
const deckTurn = "Try recalling what a waiting call keeps.\n\n```openui lifecycle=resumable id=phone-recursion-cards\nroot = LearningSurface([activity], \"\", \"\", \"resumable\")\nactivity = Flashcards(\"phone-recursion-cards\", \"Recursion\", \"Recursion cards\", [{\"id\": \"pause\", \"front\": \"What keeps its local variables while a second call runs?\", \"back\": \"The first call\u2019s stack frame.\"}], \"resumable\")\n```";

const record = (over: Partial<OpenUiPresentationRecord>): OpenUiPresentationRecord => ({
	id: "openui-aaa-deck:cards", documentId: "openui-aaa-deck", revision: 1, nodeId: "cards", component: "flashcards",
	sessionId: "s1", createdAt: 1_000, planRef: null, ...over,
});

const realIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
afterEach(() => { (globalThis as { indexedDB?: unknown }).indexedDB = realIndexedDb; });

describe("presentation twins", () => {
	it("recognises the same node recorded under two message-derived document ids moments apart", () => {
		const first = record({});
		const second = record({ id: "openui-bbb-deck:cards", documentId: "openui-bbb-deck", createdAt: 1_500 });
		expect(isPresentationTwin(first, second)).toBe(true);
		// Not twins: a later reply, another node, another session, another declared id, the same document.
		expect(isPresentationTwin(first, { ...second, createdAt: 20_000 })).toBe(false);
		expect(isPresentationTwin(first, { ...second, nodeId: "other" })).toBe(false);
		expect(isPresentationTwin(first, { ...second, sessionId: "s2" })).toBe(false);
		expect(isPresentationTwin(first, { ...second, documentId: "openui-bbb-other-deck" })).toBe(false);
		expect(isPresentationTwin(first, { ...first })).toBe(false);
		expect(isPresentationTwin({ ...first, sessionId: undefined }, { ...second, sessionId: undefined })).toBe(false);
	});

	it("reads stored twins as one record, keeping the later id and everything unrelated", () => {
		const first = record({});
		const second = record({ id: "openui-bbb-deck:cards", documentId: "openui-bbb-deck", createdAt: 1_500 });
		const again = record({ id: "openui-ccc-deck:cards", documentId: "openui-ccc-deck", createdAt: 60_000 });
		const other = record({ id: "openui-aaa-plan:plan", documentId: "openui-aaa-plan", nodeId: "plan", component: "study-plan" });
		expect(withoutPresentationTwins([first, other, second, again]).map((entry) => entry.id))
			.toEqual([other.id, second.id, again.id]);
	});

	it("one reply whose message id changes after it finishes leaves one record and one entry in Materials", async () => {
		(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
		const storage = new KeatingStorage();
		const live = presentationsFromAssistantText(deckTurn, { sessionId: "s1", messageId: "live-row-id" }, null, 10_000);
		const stored = presentationsFromAssistantText(deckTurn, { sessionId: "s1", messageId: "assistant-9-1795103839000" }, null, 10_572);
		expect(live).toHaveLength(1);
		expect(stored[0]!.documentId).not.toBe(live[0]!.documentId);

		expect(await storage.recordOpenUiPresentations(live)).toBe(1);
		expect(await storage.recordOpenUiPresentations(stored)).toBe(1);
		const records = await storage.getOpenUiPresentations("s1");
		expect(records.map((entry) => entry.documentId)).toEqual([stored[0]!.documentId]);
		// The first link is kept: when the node was first shown.
		expect(records[0]!.createdAt).toBe(10_000);

		const materials = gatherSessionMaterials({ sessionId: "s1", records, storage: null }).materials;
		expect(materials.filter((material) => material.title === "Recursion cards")).toHaveLength(1);

		// Asking for the same deck again later is a second deck, and stays one.
		const later = presentationsFromAssistantText(deckTurn, { sessionId: "s1", messageId: "assistant-11-1795103999000" }, null, 90_000);
		expect(await storage.recordOpenUiPresentations(later)).toBe(1);
		expect((await storage.getOpenUiPresentations("s1")).map((entry) => entry.documentId))
			.toEqual(expect.arrayContaining([stored[0]!.documentId, later[0]!.documentId]));
		expect(await storage.getOpenUiPresentations("s1")).toHaveLength(2);
	});
});
