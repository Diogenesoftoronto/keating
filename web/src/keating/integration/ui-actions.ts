import {
	canonicalUiAction,
	validateUiActionAgainstDocument,
	validateUiActionCorrelation,
	validateUiActionReceipt,
	validateUiDocument,
} from "@keating/learner-contracts";
import type { CanonicalKeatingOpenUIAction, KeatingOpenUIAction } from "../openui/types";
import { legacyPayloadToUiDocument, type UiActionRequest } from "../ui-protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { jsonSafe } from "./conversation-runtime";
import {
	createOpenUIActionLearnerResponse,
	serializeLearnerResponse,
} from "../learner-response";

let fallbackActionSequence = 0;

function actionRequestId(documentId: string, actionType: string): string {
	const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${++fallbackActionSequence}`;
	return `${documentId}:${actionType}:${unique}`;
}

function canonicalRequest(action: CanonicalKeatingOpenUIAction): UiActionRequest {
	return {
		protocol: "keating.ui",
		version: 1,
		id: `${action.action.documentId}-${action.action.idempotencyKey}`,
		documentId: action.action.documentId,
		documentRevision: action.action.documentRevision,
		actionId: action.action.type,
		createdAt: action.receipt.createdAt,
		payload: jsonSafe({ action: action.action, receipt: action.receipt }) as UiActionRequest["payload"],
	};
}

function recordCanonicalOpenUIAction(runtime: ConversationRuntime, action: CanonicalKeatingOpenUIAction): UiActionRequest {
	if (!validateUiDocument(action.sourceDocument)
		|| !validateUiActionAgainstDocument(action.action, action.sourceDocument)
		|| !validateUiActionReceipt(action.receipt)
		|| action.receipt.state !== "completed"
		|| canonicalUiAction(action.receipt.action) !== canonicalUiAction(action.action)
		|| !action.receipt.result
		|| !validateUiActionCorrelation(action.action, action.receipt.result, action.sourceDocument)
		|| action.document.id !== action.sourceDocument.id
		|| action.document.revision !== action.sourceDocument.revision) {
		throw new Error("Rejected invalid canonical OpenUI action receipt");
	}
	const request = canonicalRequest(action);
	const sessionMessageId = `openui:${request.id}`;
	const serialized = serializeLearnerResponse(createOpenUIActionLearnerResponse(action, {
		id: sessionMessageId,
		submittedAt: action.receipt.createdAt,
	}));
	const retainLearnerResponse = () => runtime.putPendingLearnerResponse({
		version: 1,
		receiptId: request.id,
		uiActionId: request.id,
		sessionMessageId,
		serialized,
		createdAt: action.receipt.createdAt,
	});
	const replay = runtime.replay();
	const existing = replay.uiActions.find((candidate) => candidate.id === request.id);
	if (existing) {
		retainLearnerResponse();
		return request;
	}

	const current = replay.uiDocuments[action.sourceDocument.id];
	if (current && current.revision > action.sourceDocument.revision) {
		throw new Error(`Rejected stale OpenUI document ${action.sourceDocument.id} revision ${action.sourceDocument.revision}`);
	}
	if (!current || current.revision < action.sourceDocument.revision) {
		runtime.emit("ui.document.upserted", {
			document: {
				id: action.sourceDocument.id,
				kind: "shared-openui",
				lifecycle: action.document.lifecycle,
				revision: action.sourceDocument.revision,
				content: jsonSafe(action.sourceDocument),
			},
		});
	}
	runtime.emit("ui.action", {
		action: {
			id: request.id,
			documentId: request.documentId,
			documentRevision: request.documentRevision,
			type: request.actionId,
			params: request.payload,
			humanFriendlyMessage: action.humanFriendlyMessage,
		},
	});
	const resultingDocument = action.receipt.result.resultingDocument;
	if (!resultingDocument) throw new Error("Canonical OpenUI completion is missing its resulting document");
	runtime.emit("ui.document.upserted", {
		document: {
			id: resultingDocument.id,
			kind: "shared-openui",
			lifecycle: action.document.lifecycle,
			revision: resultingDocument.revision,
			content: jsonSafe(resultingDocument),
		},
	});
	retainLearnerResponse();
	return request;
}

export function recordOpenUIAction(runtime: ConversationRuntime, action: KeatingOpenUIAction): UiActionRequest {
	if (action.kind === "canonical") return recordCanonicalOpenUIAction(runtime, action);
	const current = runtime.replay().uiDocuments[action.document.id];
	const revision = action.document.revision;
	if (!current && revision !== 0) {
		throw new Error(`OpenUI document ${action.document.id} must begin at revision 0`);
	}
	if (current && revision < current.revision) {
		throw new Error(`Rejected stale OpenUI document ${action.document.id} revision ${revision}`);
	}
	if (current && revision > current.revision + 1) {
		throw new Error(`OpenUI document ${action.document.id} revision must increment by one`);
	}
	if (!current || revision === current.revision + 1) {
		const document = legacyPayloadToUiDocument("openui", { lifecycle: action.document.lifecycle }, {
			id: action.document.id,
			revision,
			title: action.formName,
		});
		runtime.emit("ui.document.upserted", {
			document: {
				id: document.id,
				kind: document.kind,
				lifecycle: action.document.lifecycle,
				revision: document.revision,
				content: jsonSafe(document),
			},
		});
	}
	const request: UiActionRequest = {
		protocol: "keating.ui",
		version: 1,
		id: actionRequestId(action.document.id, action.type),
		documentId: action.document.id,
		documentRevision: revision,
		actionId: action.type,
		createdAt: new Date().toISOString(),
		payload: jsonSafe({ ...action.params, formState: action.formState }) as Record<string, never>,
	};
	runtime.emit("ui.action", {
			action: {
			id: request.id,
			documentId: request.documentId,
			documentRevision: request.documentRevision,
			type: request.actionId,
			params: request.payload,
			humanFriendlyMessage: action.humanFriendlyMessage,
		},
	});
	return request;
}
