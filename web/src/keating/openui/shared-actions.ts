import {
	UI_ACTION_JOURNAL_KIND,
	UI_CONTRACT_VERSION,
	canonicalUiAction,
	receiptForUiAction,
	validateUiAction,
	validateUiActionAgainstDocument,
	validateUiActionJournal,
	validateUiActionResult,
	validateUiDocument,
	type UiAction,
	type UiActionJournal,
	type UiActionReceipt,
	type UiActionResult,
	type UiDocument,
	type UiDocumentNode,
	type UiStudyPlanItem,
} from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";

const SHARED_ACTION_STATE_PREFIX = "keating:openui-shared-actions:v1:";

type ActionBaseKey = "schemaVersion" | "documentId" | "documentRevision" | "idempotencyKey";

export type SharedUiActionIntent = UiAction extends infer TAction
	? TAction extends UiAction
		? Omit<TAction, ActionBaseKey>
		: never
	: never;

export interface StoredSharedUiActionState {
	version: 1;
	document: UiDocument;
	journal: UiActionJournal;
	deliveries: SharedUiActionDelivery[];
}

export interface SharedUiActionDelivery {
	id: string;
	sessionId: string;
	humanFriendlyMessage: string;
	sourceDocument: UiDocument;
	state: "pending" | "acknowledged";
	createdAt: string;
	acknowledgedAt?: string;
}

export interface SharedUiActionDispatch {
	action: UiAction;
	sourceDocument: UiDocument;
	result: UiActionResult;
	receipt: UiActionReceipt;
	document: UiDocument;
	journal: UiActionJournal;
	deliveries: SharedUiActionDelivery[];
	replayed: boolean;
}

function hashText(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
	return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
		.join(",")}}`;
}

export function sharedUiActionStateKey(documentId: string): string {
	return `${SHARED_ACTION_STATE_PREFIX}${encodeURIComponent(documentId)}`;
}

export function emptySharedUiActionJournal(documentId: string): UiActionJournal {
	return {
		kind: UI_ACTION_JOURNAL_KIND,
		schemaVersion: UI_CONTRACT_VERSION,
		documentId,
		receipts: [],
	};
}

function isStoredState(value: unknown): value is StoredSharedUiActionState {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Partial<StoredSharedUiActionState>;
	return candidate.version === 1
		&& validateUiDocument(candidate.document)
		&& validateUiActionJournal(candidate.journal)
		&& candidate.document.id === candidate.journal.documentId;
}

function remapActionDocumentId(action: UiAction, documentId: string): UiAction {
	const {
		schemaVersion: _schemaVersion,
		documentId: _documentId,
		documentRevision: _documentRevision,
		idempotencyKey: _idempotencyKey,
		...intent
	} = action;
	const idempotencyKey = `web-ui-${hashText(stableJson({
		documentId,
		documentRevision: action.documentRevision,
		intent,
	}))}`;
	return { ...action, documentId, idempotencyKey } as UiAction;
}

function remapStoredStateDocumentId(
	state: StoredSharedUiActionState,
	documentId: string,
): StoredSharedUiActionState | null {
	const document = { ...state.document, id: documentId };
	const receipts = state.journal.receipts.map((receipt) => {
		const action = remapActionDocumentId(receipt.action, documentId);
		const resultingDocument = receipt.result?.resultingDocument
			? { ...receipt.result.resultingDocument, id: documentId }
			: receipt.result?.resultingDocument;
		const result = receipt.result
			? {
				...receipt.result,
				documentId,
				actionIdempotencyKey: action.idempotencyKey,
				...(resultingDocument ? { resultingDocument } : {}),
			}
			: receipt.result;
		return {
			...receipt,
			action,
			actionFingerprint: canonicalUiAction(action),
			...(result ? { result } : {}),
		};
	});
	const migrated: StoredSharedUiActionState = {
		version: 1,
		document,
		journal: { ...state.journal, documentId, receipts },
		deliveries: (state.deliveries ?? []).map((delivery) => ({
			...delivery,
			id: delivery.id.replace(state.document.id, documentId),
			sourceDocument: { ...delivery.sourceDocument, id: documentId },
		})),
	};
	return isStoredState(migrated) ? migrated : null;
}

/**
 * Load only a strictly validated result newer than the message snapshot. A
 * same-revision content mismatch means the model supplied a competing snapshot,
 * so the message remains authoritative and the stale local journal is ignored.
 */
export function loadSharedUiActionState(
	storage: Pick<StorageLike, "getItem"> & Partial<Pick<StorageLike, "setItem">> | null,
	sourceDocument: UiDocument,
	legacyDocumentIds: readonly string[] = [],
): StoredSharedUiActionState {
	const fallback = {
		version: 1 as const,
		document: structuredClone(sourceDocument),
		journal: emptySharedUiActionJournal(sourceDocument.id),
		deliveries: [],
	};
	if (!storage || !validateUiDocument(sourceDocument)) return fallback;
	try {
		const currentKey = sharedUiActionStateKey(sourceDocument.id);
		for (const candidateId of [sourceDocument.id, ...legacyDocumentIds]) {
			const key = sharedUiActionStateKey(candidateId);
			const raw = storage.getItem(key);
			if (!raw) continue;
			const parsed: unknown = JSON.parse(raw);
			if (!isStoredState(parsed) || parsed.document.id !== candidateId) continue;
			const candidate = candidateId === sourceDocument.id
				? { ...parsed, deliveries: parsed.deliveries ?? [] }
				: remapStoredStateDocumentId(parsed, sourceDocument.id);
			if (!candidate) continue;
			const accepted = candidate.document.revision > sourceDocument.revision
				|| (candidate.document.revision === sourceDocument.revision
					&& stableJson(candidate.document) === stableJson(sourceDocument));
			if (!accepted) continue;
			if (key !== currentKey && storage.setItem) {
				storage.setItem(currentKey, JSON.stringify(candidate));
			}
			return structuredClone(candidate);
		}
		return fallback;
	} catch {
		return fallback;
	}
}

export function createSharedUiAction(document: UiDocument, intent: SharedUiActionIntent): UiAction {
	const idempotencyKey = `web-ui-${hashText(stableJson({
		documentId: document.id,
		documentRevision: document.revision,
		intent,
	}))}`;
	const action = {
		...intent,
		schemaVersion: UI_CONTRACT_VERSION,
		documentId: document.id,
		documentRevision: document.revision,
		idempotencyKey,
	} as UiAction;
	if (!validateUiAction(action)) throw new Error("The OpenUI action is invalid.");
	return action;
}

function updatePlanItems(
	items: readonly UiStudyPlanItem[],
	itemId: string,
	completed: boolean,
): UiStudyPlanItem[] {
	return items.map((item) => ({
		...item,
		...(item.id === itemId
			? { status: completed ? "done" as const : "not_started" as const }
			: {}),
		...(item.children
			? { children: updatePlanItems(item.children, itemId, completed) }
			: {}),
	}));
}

function applyActionToNodes(nodes: readonly UiDocumentNode[], action: UiAction): UiDocumentNode[] {
	return nodes.map((node) => {
		if (action.type === "complete-goal-step" && node.type === "goal" && node.id === action.nodeId) {
			const steps = node.steps.map((step) => step.id === action.stepId
				? { ...step, status: "done" as const }
				: step);
			return {
				...node,
				steps,
				status: steps.every((step) => step.status === "done") ? "completed" as const : node.status,
			};
		}
		if (action.type === "complete-plan-item" && node.type === "study-plan" && node.id === action.nodeId && node.items) {
			return { ...node, items: updatePlanItems(node.items, action.itemId, action.completed) };
		}
		if (action.type === "update-notes" && node.type === "notes" && node.id === action.nodeId) {
			return { ...node, value: action.value };
		}
		return node;
	});
}

function completedDocument(source: UiDocument, action: UiAction, now: string): UiDocument {
	const document: UiDocument = {
		...source,
		revision: source.revision + 1,
		lifecycle: action.type === "retry" ? "ready" : source.lifecycle,
		nodes: applyActionToNodes(source.nodes, action),
		updatedAt: now,
	};
	if (!validateUiDocument(document)) throw new Error("The OpenUI action produced an invalid document.");
	return document;
}

/**
 * Web's durable exactly-once boundary. The resulting document and completed
 * receipt are serialized into one localStorage value and committed with one
 * setItem call before any success UI or host learner turn is emitted.
 */
export function dispatchSharedUiAction(
	storage: Pick<StorageLike, "getItem" | "setItem">,
	sourceDocument: UiDocument,
	intent: SharedUiActionIntent,
	now = new Date().toISOString(),
	delivery?: { sessionId: string; humanFriendlyMessage: string },
): SharedUiActionDispatch {
	const action = createSharedUiAction(sourceDocument, intent);
	const state = loadSharedUiActionState(storage, sourceDocument);
	const currentDocument = state.document;
	const existing = receiptForUiAction(state.journal, action);
	if (existing) {
		if (!existing.result || existing.state !== "completed" || !existing.result.resultingDocument) {
			throw new Error("This OpenUI action has an incomplete durable receipt.");
		}
		return {
			action,
			sourceDocument: currentDocument,
			result: structuredClone(existing.result),
			receipt: structuredClone(existing),
			document: structuredClone(existing.result.resultingDocument),
			journal: structuredClone(state.journal),
			deliveries: structuredClone(state.deliveries),
			replayed: true,
		};
	}
	if (!validateUiActionAgainstDocument(action, currentDocument)) {
		throw new Error("This OpenUI action no longer applies to the current document revision.");
	}

	const resultingDocument = completedDocument(currentDocument, action, now);
	const result: UiActionResult = {
		schemaVersion: UI_CONTRACT_VERSION,
		documentId: action.documentId,
		sourceRevision: action.documentRevision,
		actionIdempotencyKey: action.idempotencyKey,
		status: "completed",
		documentLifecycle: resultingDocument.lifecycle,
		resultingDocument,
	};
	if (!validateUiActionResult(result)) throw new Error("The OpenUI completion result is invalid.");
	const receipt: UiActionReceipt = {
		schemaVersion: UI_CONTRACT_VERSION,
		action,
		actionFingerprint: canonicalUiAction(action),
		state: "completed",
		createdAt: now,
		updatedAt: now,
		result,
	};
	const journal: UiActionJournal = {
		...state.journal,
		receipts: [...state.journal.receipts, receipt],
	};
	if (!validateUiActionJournal(journal)) throw new Error("The OpenUI action journal is invalid or full.");
	const next: StoredSharedUiActionState = {
		version: 1,
		document: resultingDocument,
		journal,
		deliveries: delivery
			? [...state.deliveries, {
				id: `${action.documentId}-${action.idempotencyKey}`,
				sessionId: delivery.sessionId,
				humanFriendlyMessage: delivery.humanFriendlyMessage,
				sourceDocument: structuredClone(currentDocument),
				state: "pending",
				createdAt: now,
			}]
			: state.deliveries,
	};
	storage.setItem(sharedUiActionStateKey(sourceDocument.id), JSON.stringify(next));
	return {
		action: structuredClone(action),
		sourceDocument: structuredClone(currentDocument),
		result: structuredClone(result),
		receipt: structuredClone(receipt),
		document: structuredClone(resultingDocument),
		journal: structuredClone(journal),
		deliveries: structuredClone(next.deliveries),
		replayed: false,
	};
}

export function acknowledgeSharedUiActionDelivery(
	storage: Pick<StorageLike, "getItem" | "setItem">,
	sourceDocument: UiDocument,
	deliveryId: string,
	now = new Date().toISOString(),
): boolean {
	const state = loadSharedUiActionState(storage, sourceDocument);
	const index = state.deliveries.findIndex((delivery) => delivery.id === deliveryId);
	if (index < 0 || state.deliveries[index]?.state === "acknowledged") return false;
	const deliveries = state.deliveries.map((delivery, deliveryIndex) => deliveryIndex === index
		? { ...delivery, state: "acknowledged" as const, acknowledgedAt: now }
		: delivery);
	storage.setItem(sharedUiActionStateKey(sourceDocument.id), JSON.stringify({ ...state, deliveries }));
	return true;
}
