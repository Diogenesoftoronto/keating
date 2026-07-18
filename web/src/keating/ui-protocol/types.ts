export const KEATING_UI_PROTOCOL = "keating.ui" as const;
export const KEATING_UI_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type UiDocumentKind =
	| "quiz"
	| "question"
	| "goal"
	| "deck"
	| "image"
	| "scene"
	| "artifact"
	| "generic";

export type UiDocumentStatus = "active" | "submitted" | "completed" | "disabled" | "error";

export interface UiActionDefinition {
	id: string;
	kind:
		| "submit"
		| "answer"
		| "select"
		| "update_step"
		| "review_card"
		| "request_reframe"
		| "request_remediation"
		| "open"
		| "retry"
		| "custom";
	label: string;
	description?: string;
	destructive?: boolean;
	disabled?: boolean;
	input?: JsonObject;
}

interface UiDocumentBase<K extends UiDocumentKind, P extends object> {
	protocol: typeof KEATING_UI_PROTOCOL;
	version: typeof KEATING_UI_VERSION;
	id: string;
	revision: number;
	kind: K;
	createdAt?: string;
	title?: string;
	status?: UiDocumentStatus;
	actions?: UiActionDefinition[];
	payload: P;
}

export interface QuizQuestionDocument {
	id: string;
	prompt: string;
	type: string;
	level?: string;
	options?: string[];
	blanks?: Array<{ placeholder?: string; hint?: string }>;
	min?: number;
	max?: number;
	step?: number;
	explanation?: string;
	rubric?: string;
}

export interface QuizPayload {
	topic: string;
	questions: QuizQuestionDocument[];
	totalPoints?: number;
	answers?: JsonObject;
	grades?: JsonObject;
	resultId?: string;
}

export interface QuestionFieldDocument {
	id: string;
	prompt: string;
	type: "choice" | "text" | "blanks" | "classification" | "matching" | string;
	header?: string;
	choices?: string[];
	items?: string[];
	blanks?: Array<{ placeholder?: string; hint?: string }>;
	hint?: string;
	allowText?: boolean;
	multiSelect?: boolean;
	requireReasons?: boolean;
	uniqueMatches?: boolean;
}

export interface QuestionPayload {
	intro?: string;
	topic?: string;
	fields: QuestionFieldDocument[];
	answers?: JsonObject;
}

export interface GoalStepDocument {
	id: string;
	title: string;
	status: "not_started" | "in_progress" | "done" | string;
	order?: number;
	kind?: string;
	description?: string;
	topic?: string;
	successCriteria?: string[];
}

export interface GoalPayload {
	goalId: string;
	title: string;
	description?: string;
	motivation?: string;
	status: string;
	steps: GoalStepDocument[];
	progress?: number;
}

export interface FlashcardDocument {
	id: string;
	front: string;
	back: string;
	tags?: string[];
	dueAt?: number;
	state?: JsonObject;
}

export interface DeckPayload {
	deckId: string;
	topic: string;
	title: string;
	description?: string;
	cards: FlashcardDocument[];
	restrictToCardIds?: string[];
}

export interface ImagePayload {
	title: string;
	alt: string;
	url?: string;
	dataUrl?: string;
	mimeType?: string;
	model?: string;
	prompt?: string;
}

export interface ScenePayload {
	topic?: string;
	kind?: string;
	summary?: string;
	storyboard?: string;
	body?: string;
	markdown?: string;
	renderer?: string;
}

export interface ArtifactPayload {
	artifactId?: string;
	uri: string;
	artifactType?: string;
	label?: string;
	mediaType?: string;
	summary?: string;
	content?: string;
}

export interface GenericPayload {
	format: "text" | "markdown" | "json" | string;
	content?: string;
	data?: JsonValue;
	originalKind?: string;
}

export type QuizDocument = UiDocumentBase<"quiz", QuizPayload>;
export type QuestionDocument = UiDocumentBase<"question", QuestionPayload>;
export type GoalDocument = UiDocumentBase<"goal", GoalPayload>;
export type DeckDocument = UiDocumentBase<"deck", DeckPayload>;
export type ImageDocument = UiDocumentBase<"image", ImagePayload>;
export type SceneDocument = UiDocumentBase<"scene", ScenePayload>;
export type ArtifactDocument = UiDocumentBase<"artifact", ArtifactPayload>;
export type GenericDocument = UiDocumentBase<"generic", GenericPayload>;

export type UiDocument =
	| QuizDocument
	| QuestionDocument
	| GoalDocument
	| DeckDocument
	| ImageDocument
	| SceneDocument
	| ArtifactDocument
	| GenericDocument;

export interface UiActionRequest {
	protocol: typeof KEATING_UI_PROTOCOL;
	version: typeof KEATING_UI_VERSION;
	id: string;
	documentId: string;
	documentRevision: number;
	actionId: string;
	createdAt: string;
	payload: JsonObject;
}

export interface UiActionResult {
	protocol: typeof KEATING_UI_PROTOCOL;
	version: typeof KEATING_UI_VERSION;
	id: string;
	actionRequestId: string;
	documentId: string;
	documentRevision: number;
	status: "accepted" | "rejected" | "error";
	createdAt: string;
	resultingRevision?: number;
	payload?: JsonObject;
	error?: { code: string; message: string; retryable?: boolean };
}
