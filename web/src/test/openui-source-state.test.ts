import { describe, expect, test } from "bun:test";
import type { UiDocument } from "@keating/learner-contracts";
import {
	hashOpenUISource,
	loadOpenUISourceState,
	migrateOpenUISourceStateToSharedDocument,
	openUISourceStateKey,
	saveOpenUISourceState,
} from "../keating/openui/source-state";
import { sharedUiActionStateKey } from "../keating/openui/shared-actions";

class MemoryStorage {
	readonly values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
}

const metadata = {
	id: "session-message-source",
	lifecycle: "resumable" as const,
	revision: 3,
	legacyIds: ["message-source"],
};
const source = 'root = LearningSurface([notes, plan], "Study")';
const document: UiDocument = {
	schemaVersion: 1,
	id: metadata.id,
	revision: metadata.revision,
	lifecycle: "ready",
	retention: "resumable",
	supportedSurfaces: ["web", "mobile", "desktop", "terminal"],
	nodes: [
		{ type: "notes", id: "notes-1", title: "Notes", value: "Start" },
		{
			type: "study-plan",
			id: "plan-1",
			title: "Plan",
			items: [
				{ id: "group", title: "Group", status: "not_started", children: [
					{ id: "leaf-a", title: "A", status: "not_started" },
					{ id: "leaf-b", title: "B", status: "not_started" },
				] },
			],
		},
	],
	createdAt: "2026-08-11T00:00:00.000Z",
	updatedAt: "2026-08-11T00:00:00.000Z",
};

describe("OpenUI source state provenance and migration", () => {
	test("writes source hash and revision and rejects stale or mismatched state", () => {
		const storage = new MemoryStorage();
		expect(saveOpenUISourceState(storage, metadata, source, { "notes-1": "Keep" }, Date.parse("2026-08-11T01:00:00.000Z"))).toBe(true);
		expect(loadOpenUISourceState(storage, metadata, source)?.state).toEqual({ "notes-1": "Keep" });
		expect(loadOpenUISourceState(storage, { ...metadata, revision: 4 }, source)).toBeNull();
		expect(loadOpenUISourceState(storage, metadata, `${source}\nchanged`)).toBeNull();
		const stored = JSON.parse(storage.getItem(openUISourceStateKey(metadata.id))!);
		expect(stored).toMatchObject({ version: 2, documentRevision: 3, sourceHash: hashOpenUISource(source) });
	});

	test("migrates only notes and true valid leaf progress, preserving legacy state", () => {
		const storage = new MemoryStorage();
		const legacyPayload = JSON.stringify({
			version: 1,
			updatedAt: Date.parse("2026-08-11T02:00:00.000Z"),
			state: {
				"notes-1": "Migrated notes",
				"plan-1:progress": { group: true, "leaf-a": true, missing: true, "leaf-b": false },
				"plan-1:expansion": { group: true },
				quiz: { invented: "progress" },
			},
		});
		storage.setItem(openUISourceStateKey(metadata.legacyIds[0]!), legacyPayload);

		const result = migrateOpenUISourceStateToSharedDocument(storage, metadata, source, document);
		expect(result).toMatchObject({ migrated: true, provenance: "legacy" });
		expect(result.document.revision).toBe(4);
		const notes = result.document.nodes.find((node) => node.type === "notes");
		expect(notes?.type === "notes" ? notes.value : undefined).toBe("Migrated notes");
		const plan = result.document.nodes.find((node) => node.type === "study-plan");
		expect(plan?.type === "study-plan" ? plan.items?.[0]?.status : undefined).toBe("not_started");
		expect(plan?.type === "study-plan" ? plan.items?.[0]?.children?.map((item) => item.status) : undefined).toEqual(["done", "not_started"]);
		expect(storage.getItem(openUISourceStateKey(metadata.legacyIds[0]!))).toBe(legacyPayload);
		expect(JSON.parse(storage.getItem(sharedUiActionStateKey(metadata.id))!)).toMatchObject({
			document: { revision: 4 },
			journal: { receipts: [] },
			deliveries: [],
		});
	});

	test("is idempotent and never overwrites an existing canonical state", () => {
		const storage = new MemoryStorage();
		saveOpenUISourceState(storage, metadata, source, { "notes-1": "First" }, Date.parse("2026-08-11T03:00:00.000Z"));
		const first = migrateOpenUISourceStateToSharedDocument(storage, metadata, source, document);
		expect(first.migrated).toBe(true);
		saveOpenUISourceState(storage, metadata, source, { "notes-1": "Second" }, Date.parse("2026-08-11T04:00:00.000Z"));
		const second = migrateOpenUISourceStateToSharedDocument(storage, metadata, source, document);
		expect(second.migrated).toBe(false);
		const notes = second.document.nodes.find((node) => node.type === "notes");
		expect(notes?.type === "notes" ? notes.value : undefined).toBe("First");
	});
});
