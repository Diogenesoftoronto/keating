import { validateUiDocument, type UiDocument, type UiDocumentNode, type UiStudyPlanItem } from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";
import {
	emptySharedUiActionJournal,
	loadSharedUiActionState,
	sharedUiActionStateKey,
	type StoredSharedUiActionState,
} from "./shared-actions";
import type { OpenUIDocumentMetadata } from "./types";

export const OPENUI_SOURCE_STATE_VERSION = 2 as const;

interface LegacyStoredOpenUIState {
	version: 1;
	updatedAt: number;
	state: Record<string, unknown>;
}

export interface StoredOpenUISourceState {
	version: typeof OPENUI_SOURCE_STATE_VERSION;
	updatedAt: number;
	documentRevision: number;
	sourceHash: string;
	state: Record<string, unknown>;
}

export interface LoadedOpenUISourceState {
	state: Record<string, unknown>;
	updatedAt: number;
	provenance: "legacy" | "verified";
}

export interface OpenUISourceMigrationResult {
	document: UiDocument;
	migrated: boolean;
	provenance?: LoadedOpenUISourceState["provenance"];
}

type OpenUIStorage = Pick<StorageLike, "getItem" | "setItem">;

const SOURCE_STATE_KEY_PREFIX = "keating:openui-state:v1:";

export function openUISourceStateKey(documentId: string): string {
	return `${SOURCE_STATE_KEY_PREFIX}${documentId}`;
}

export function hashOpenUISource(source: string): string {
	let hash = 2166136261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function isStateRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoredSourceState(
	raw: string,
	metadata: OpenUIDocumentMetadata,
	source: string,
): LoadedOpenUISourceState | null {
	const parsed: unknown = JSON.parse(raw);
	if (!isStateRecord(parsed) || !isStateRecord(parsed.state)) return null;
	if (parsed.version === 1 && typeof parsed.updatedAt === "number") {
		return {
			state: parsed.state,
			updatedAt: parsed.updatedAt,
			provenance: "legacy",
		};
	}
	if (
		parsed.version === OPENUI_SOURCE_STATE_VERSION
		&& typeof parsed.updatedAt === "number"
		&& parsed.documentRevision === metadata.revision
		&& parsed.sourceHash === hashOpenUISource(source)
	) {
		return {
			state: parsed.state,
			updatedAt: parsed.updatedAt,
			provenance: "verified",
		};
	}
	return null;
}

export function loadOpenUISourceState(
	storage: (Pick<StorageLike, "getItem"> & Partial<Pick<StorageLike, "setItem">>) | null,
	metadata: OpenUIDocumentMetadata,
	source: string,
): LoadedOpenUISourceState | null {
	if (!storage || metadata.lifecycle === "ephemeral") return null;
	for (const documentId of [metadata.id, ...(metadata.legacyIds ?? [])]) {
		const key = openUISourceStateKey(documentId);
		const raw = storage.getItem(key);
		if (!raw) continue;
		try {
			const loaded = parseStoredSourceState(raw, metadata, source);
			if (loaded) {
				if (documentId !== metadata.id && storage.setItem) {
					storage.setItem(openUISourceStateKey(metadata.id), raw);
				}
				return loaded;
			}
		} catch {
			// A malformed or stale candidate is ignored; a later legacy id may still match.
		}
	}
	return null;
}

export function saveOpenUISourceState(
	storage: OpenUIStorage | null,
	metadata: OpenUIDocumentMetadata,
	source: string,
	state: Record<string, unknown>,
	now = Date.now(),
): boolean {
	if (!storage || metadata.lifecycle === "ephemeral") return false;
	const payload: StoredOpenUISourceState = {
		version: OPENUI_SOURCE_STATE_VERSION,
		updatedAt: now,
		documentRevision: metadata.revision,
		sourceHash: hashOpenUISource(source),
		state,
	};
	try {
		storage.setItem(openUISourceStateKey(metadata.id), JSON.stringify(payload));
		return true;
	} catch {
		return false;
	}
}

function migratePlanItems(
	items: readonly UiStudyPlanItem[],
	progress: Record<string, unknown>,
): { items: UiStudyPlanItem[]; changed: boolean } {
	let changed = false;
	const migrated = items.map((item) => {
		if (item.children?.length) {
			const children = migratePlanItems(item.children, progress);
			changed ||= children.changed;
			return children.changed ? { ...item, children: children.items } : item;
		}
		if (progress[item.id] !== true || item.status === "done") return item;
		changed = true;
		return { ...item, status: "done" as const };
	});
	return { items: migrated, changed };
}

function migrateNode(
	node: UiDocumentNode,
	state: Record<string, unknown>,
): { node: UiDocumentNode; changed: boolean } {
	if (node.type === "notes") {
		const value = state[node.id];
		if (typeof value === "string" && value !== node.value) {
			return { node: { ...node, value }, changed: true };
		}
	}
	if (node.type === "study-plan" && node.items) {
		const progress = state[`${node.id}:progress`];
		if (isStateRecord(progress)) {
			const migrated = migratePlanItems(node.items, progress);
			if (migrated.changed) return { node: { ...node, items: migrated.items }, changed: true };
		}
	}
	return { node, changed: false };
}

/**
 * Seed the canonical action state before switching a completed source fence to
 * the shared renderer. Only source fields with a proven semantic mapping are
 * copied. The legacy state remains intact for rollback and auditability.
 */
export function migrateOpenUISourceStateToSharedDocument(
	storage: OpenUIStorage | null,
	metadata: OpenUIDocumentMetadata,
	source: string,
	sourceDocument: UiDocument,
): OpenUISourceMigrationResult {
	if (!storage || metadata.lifecycle === "ephemeral") {
		return { document: sourceDocument, migrated: false };
	}
	const sharedKey = sharedUiActionStateKey(sourceDocument.id);
	if (storage.getItem(sharedKey)) {
		const existing = loadSharedUiActionState(storage, sourceDocument, metadata.legacyIds);
		return { document: existing.document, migrated: false };
	}
	const loaded = loadOpenUISourceState(storage, metadata, source);
	if (!loaded) return { document: sourceDocument, migrated: false };

	let changed = false;
	const nodes = sourceDocument.nodes.map((node) => {
		const migrated = migrateNode(node, loaded.state);
		changed ||= migrated.changed;
		return migrated.node;
	});
	if (!changed) return { document: sourceDocument, migrated: false, provenance: loaded.provenance };

	const createdAtMs = Date.parse(sourceDocument.createdAt);
	const updatedAt = new Date(Math.max(loaded.updatedAt, createdAtMs)).toISOString();
	const document: UiDocument = {
		...sourceDocument,
		revision: sourceDocument.revision + 1,
		nodes,
		updatedAt,
	};
	if (!validateUiDocument(document)) throw new Error("Migrated OpenUI source state produced an invalid shared document.");
	const sharedState: StoredSharedUiActionState = {
		version: 1,
		document,
		journal: emptySharedUiActionJournal(document.id),
		deliveries: [],
	};
	storage.setItem(sharedKey, JSON.stringify(sharedState));
	return { document, migrated: true, provenance: loaded.provenance };
}

export type { LegacyStoredOpenUIState };
