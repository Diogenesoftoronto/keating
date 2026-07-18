import {
	KEATING_UI_PROTOCOL,
	KEATING_UI_VERSION,
	type JsonObject,
	type JsonValue,
	type UiActionRequest,
	type UiActionResult,
	type UiDocument,
	type UiDocumentKind,
} from "./types";

export interface ValidationResult<T> {
	ok: boolean;
	value?: T;
	errors: string[];
}

const DOCUMENT_KINDS = new Set<UiDocumentKind>([
	"quiz", "question", "goal", "deck", "image", "scene", "artifact", "generic",
]);

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function revision(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object") return false;
	if (seen.has(value as object)) return false;
	seen.add(value as object);
	const valid = Array.isArray(value)
		? value.every((entry) => isJsonValue(entry, seen))
		: Object.entries(value as Record<string, unknown>).every(
			([key, entry]) => key !== "__proto__" && isJsonValue(entry, seen),
		);
	seen.delete(value as object);
	return valid;
}

function validateActions(value: unknown, errors: string[]): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push("actions must be an array");
		return;
	}
	const ids = new Set<string>();
	for (const [index, action] of value.entries()) {
		if (!record(action)) {
			errors.push(`actions[${index}] must be an object`);
			continue;
		}
		if (!nonEmptyString(action.id)) errors.push(`actions[${index}].id is required`);
		else if (ids.has(action.id)) errors.push(`actions[${index}].id must be unique`);
		else ids.add(action.id);
		if (!nonEmptyString(action.kind)) errors.push(`actions[${index}].kind is required`);
		if (!nonEmptyString(action.label)) errors.push(`actions[${index}].label is required`);
		if (action.input !== undefined && (!record(action.input) || !isJsonValue(action.input))) {
			errors.push(`actions[${index}].input must be JSON-safe`);
		}
	}
}

function validatePayload(kind: UiDocumentKind, payload: Record<string, unknown>, errors: string[]): void {
	const requireString = (key: string) => {
		if (!nonEmptyString(payload[key])) errors.push(`payload.${key} is required`);
	};
	const requireArray = (key: string) => {
		if (!Array.isArray(payload[key])) errors.push(`payload.${key} must be an array`);
	};

	switch (kind) {
		case "quiz": requireString("topic"); requireArray("questions"); break;
		case "question": requireArray("fields"); break;
		case "goal": requireString("goalId"); requireString("title"); requireString("status"); requireArray("steps"); break;
		case "deck": requireString("deckId"); requireString("topic"); requireString("title"); requireArray("cards"); break;
		case "image":
			requireString("title"); requireString("alt");
			if (!nonEmptyString(payload.url) && !nonEmptyString(payload.dataUrl)) errors.push("payload.url or payload.dataUrl is required");
			break;
		case "scene":
			if (![payload.body, payload.storyboard, payload.markdown].some(nonEmptyString)) errors.push("scene payload requires body, storyboard, or markdown");
			break;
		case "artifact": requireString("uri"); break;
		case "generic": requireString("format"); break;
	}
}

export function validateUiDocument(value: unknown): ValidationResult<UiDocument> {
	const errors: string[] = [];
	if (!record(value)) return { ok: false, errors: ["document must be an object"] };
	if (value.protocol !== KEATING_UI_PROTOCOL) errors.push(`protocol must be ${KEATING_UI_PROTOCOL}`);
	if (value.version !== KEATING_UI_VERSION) errors.push(`version must be ${KEATING_UI_VERSION}`);
	if (!nonEmptyString(value.id)) errors.push("id is required");
	if (!revision(value.revision)) errors.push("revision must be a non-negative safe integer");
	if (!nonEmptyString(value.kind) || !DOCUMENT_KINDS.has(value.kind as UiDocumentKind)) errors.push("kind is unsupported");
	if (!record(value.payload)) errors.push("payload must be an object");
	else {
		if (!isJsonValue(value.payload)) errors.push("payload must be JSON-safe");
		if (DOCUMENT_KINDS.has(value.kind as UiDocumentKind)) validatePayload(value.kind as UiDocumentKind, value.payload, errors);
	}
	validateActions(value.actions, errors);
	return errors.length === 0 ? { ok: true, value: value as unknown as UiDocument, errors } : { ok: false, errors };
}

export function isUiDocument(value: unknown): value is UiDocument {
	return validateUiDocument(value).ok;
}

export function validateUiActionRequest(value: unknown): ValidationResult<UiActionRequest> {
	const errors: string[] = [];
	if (!record(value)) return { ok: false, errors: ["action request must be an object"] };
	if (value.protocol !== KEATING_UI_PROTOCOL) errors.push(`protocol must be ${KEATING_UI_PROTOCOL}`);
	if (value.version !== KEATING_UI_VERSION) errors.push(`version must be ${KEATING_UI_VERSION}`);
	for (const key of ["id", "documentId", "actionId", "createdAt"] as const) {
		if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
	}
	if (!revision(value.documentRevision)) errors.push("documentRevision must be a non-negative safe integer");
	if (!record(value.payload) || !isJsonValue(value.payload)) errors.push("payload must be a JSON-safe object");
	return errors.length === 0 ? { ok: true, value: value as unknown as UiActionRequest, errors } : { ok: false, errors };
}

export function isUiActionRequest(value: unknown): value is UiActionRequest {
	return validateUiActionRequest(value).ok;
}

export function validateUiActionResult(value: unknown): ValidationResult<UiActionResult> {
	const errors: string[] = [];
	if (!record(value)) return { ok: false, errors: ["action result must be an object"] };
	if (value.protocol !== KEATING_UI_PROTOCOL) errors.push(`protocol must be ${KEATING_UI_PROTOCOL}`);
	if (value.version !== KEATING_UI_VERSION) errors.push(`version must be ${KEATING_UI_VERSION}`);
	for (const key of ["id", "actionRequestId", "documentId", "createdAt"] as const) {
		if (!nonEmptyString(value[key])) errors.push(`${key} is required`);
	}
	if (!revision(value.documentRevision)) errors.push("documentRevision must be a non-negative safe integer");
	if (!["accepted", "rejected", "error"].includes(String(value.status))) errors.push("status is unsupported");
	if (value.resultingRevision !== undefined && !revision(value.resultingRevision)) errors.push("resultingRevision must be a non-negative safe integer");
	if (value.payload !== undefined && (!record(value.payload) || !isJsonValue(value.payload))) errors.push("payload must be a JSON-safe object");
	if (value.status === "error" && (!record(value.error) || !nonEmptyString(value.error.code) || !nonEmptyString(value.error.message))) {
		errors.push("error results require error.code and error.message");
	}
	return errors.length === 0 ? { ok: true, value: value as unknown as UiActionResult, errors } : { ok: false, errors };
}

export function isUiActionResult(value: unknown): value is UiActionResult {
	return validateUiActionResult(value).ok;
}

export function actionTargetsDocument(request: UiActionRequest, document: UiDocument): boolean {
	return request.documentId === document.id && request.documentRevision === document.revision;
}

export function resultCorrelatesToAction(result: UiActionResult, request: UiActionRequest): boolean {
	return result.actionRequestId === request.id
		&& result.documentId === request.documentId
		&& result.documentRevision === request.documentRevision;
}

