import type { KeatingOpenUIAction } from "../openui/types";
import { legacyPayloadToUiDocument, type UiActionRequest } from "../ui-protocol";
import type { ConversationRuntime } from "./conversation-runtime";
import { jsonSafe } from "./conversation-runtime";

let fallbackActionSequence = 0;

function actionRequestId(documentId: string, actionType: string): string {
	const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now()}-${++fallbackActionSequence}`;
	return `${documentId}:${actionType}:${unique}`;
}

export function recordOpenUIAction(runtime: ConversationRuntime, action: KeatingOpenUIAction): UiActionRequest {
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
