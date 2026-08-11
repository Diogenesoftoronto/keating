/**
 * Browser-compatible Keating storage using IndexedDB
 * Replaces Node.js filesystem operations from src/core/
 */

import type { LearnerGoal } from "./goals";
import { inferBrowserLearnerTurnSignal, type QuizQuestionGrade } from "./core";
import { deriveLearnerProfile, type LearnerTopicProfile } from "./learner-profile";
import type { Flashcard, FlashcardDeck, FlashcardSrsState } from "./flashcard-types";
import { applyReview, initialSrsState } from "./srs";
import {
	UI_ACTION_JOURNAL_KIND,
	UI_CONTRACT_VERSION,
	UiActionReplayConflictError,
	canonicalUiAction,
	receiptForUiAction,
	validateUiActionAgainstDocument,
	validateUiActionJournal,
	validateUiDocument,
	type UiAction,
	type UiActionJournal,
	type UiActionReceipt,
	type UiActionResult,
	type UiDeckCard,
	type UiDocument,
	type UiDocumentNode,
	type UiQuestion,
	type UiQuestionGroupResponse,
	type UiRowAnswer,
	type UiStudyPlanItem,
} from "@keating/learner-contracts";
export type { Flashcard, FlashcardDeck, FlashcardSrsState } from "./flashcard-types";

const DB_NAME = "keating-db";
const DB_VERSION = 7;
const LEARNER_STATE_SCHEMA_VERSION = 3;
const META_STORE = "_meta";
const OPENUI_ACTION_JOURNAL_PREFIX = "openui-action-journal:v1:";

// Store names
const STORES = {
	LESSON_PLANS: "lesson-plans",
	LESSON_MAPS: "lesson-maps",
	ANIMATIONS: "animations",
	VERIFICATIONS: "verifications",
	BENCHMARKS: "benchmarks",
	EVOLUTIONS: "evolutions",
	POLICIES: "policies",
	FEEDBACK: "feedback",
	LEARNER_STATE: "learner-state",
	PROMPT_EVOLUTIONS: "prompt-evolutions",
	IMPROVEMENTS: "improvements",
	GOALS: "goals",
	QUIZ_RESULTS: "quiz-results",
	DECKS: "decks",
	CARD_REVIEWS: "card-reviews",
	QUESTION_CHECKS: "question-checks",
} as const;

export interface KeatingStoragePortableData {
	lessonPlans: LessonPlan[];
	lessonMaps: LessonMap[];
	animations: Animation[];
	verifications: Verification[];
	benchmarks: BenchmarkResult[];
	evolutions: EvolutionResult[];
	policies: Policy[];
	feedback: FeedbackEntry[];
	learnerState: LearnerState;
	promptEvolutions: PromptEvolutionResult[];
	improvements: ImprovementAttemptRecord[];
	goals: LearnerGoal[];
	quizResults: QuizResultRecord[];
	decks: FlashcardDeck[];
	cardReviews: CardReviewRecord[];
	questionChecks: QuestionCheckRecord[];
}

export interface KeatingStorageImportResult {
	lessonPlans: number;
	lessonMaps: number;
	animations: number;
	verifications: number;
	benchmarks: number;
	evolutions: number;
	policies: number;
	feedback: number;
	promptEvolutions: number;
	improvements: number;
	goals: number;
	quizResults: number;
	decks: number;
	cardReviews: number;
	questionChecks: number;
}

export interface LessonPlan {
	id: string;
	topic: string;
	createdAt: number;
	updatedAt: number;
	content: string;
	metadata?: Record<string, unknown>;
	sessionId?: string;
}

export interface LessonMap {
	id: string;
	topic: string;
	createdAt: number;
	mmdContent: string;
	svgContent?: string;
	sessionId?: string;
}

export interface Animation {
	id: string;
	topic: string;
	createdAt: number;
	storyboard: string;
	scene: string;
	manifest: string;
	renderer?: "hyperframes";
	sessionId?: string;
}

export interface Verification {
	id: string;
	topic: string;
	createdAt: number;
	checklist: string;
	completed: boolean;
	sessionId?: string;
}

export interface BenchmarkResult {
	id: string;
	topic?: string;
	createdAt: number;
	score: number;
	trace?: string;
	report: string;
	sessionId?: string;
}

export interface EvolutionResult {
	id: string;
	topic?: string;
	createdAt: number;
	bestScore: number;
	policy: string;
	trace?: string;
	report: string;
	sessionId?: string;
}

export interface Policy {
	id: string;
	createdAt: number;
	updatedAt: number;
	content: string;
	active: boolean;
}

export interface FeedbackEntry {
	id: string;
	topic: string;
	signal: "thumbs-up" | "thumbs-down" | "confused";
	createdAt: number;
	source?: "explicit" | "turn-analysis";
	evidence?: string;
	sessionId?: string;
	messageId?: string;
	/** The generated assistant message the learner was reacting to. */
	referent?: {
		sessionId: string;
		messageId: string;
		content: string;
		createdAt?: number;
	};
	/** Makes it clear whether topic attribution is exact or merely session context. */
	topicSource?: "session-title" | "explicit" | "turn-analysis";
}

export interface LearnerState {
	schemaVersion: typeof LEARNER_STATE_SCHEMA_VERSION;
	topicsExplored: string[];
	feedbackHistory: FeedbackEntry[];
	strengths: string[];
	weaknesses: string[];
	topicProfiles: LearnerTopicProfile[];
	lastSessionAt?: number;
	sessionsCount: number;
	sessions: Array<{
		id?: string;
		startedAt: number;
		endedAt?: number;
		topicsCovered: string[];
	}>;
	profileBeliefs: LearnerProfileBelief[];
	/** Explicit learner intent for the Coming Up board. Scheduling evidence remains separate. */
	studyPriorities: StudyPriorityRecord[];
}

export type StudyPriority = "focus" | "maintain" | "low";
export type StudyPriorityTarget = "deck" | "verification" | "topic";

export interface StudyPriorityRecord {
	targetId: string;
	targetType: StudyPriorityTarget;
	priority: StudyPriority;
	updatedAt: number;
}

const STUDY_PRIORITIES: StudyPriority[] = ["focus", "maintain", "low"];
const STUDY_PRIORITY_TARGETS: StudyPriorityTarget[] = ["deck", "verification", "topic"];

export function normalizeStudyPriorities(value: unknown): StudyPriorityRecord[] {
	if (!Array.isArray(value)) return [];
	const byTarget = new Map<string, StudyPriorityRecord>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const candidate = item as Partial<StudyPriorityRecord>;
		if (
			typeof candidate.targetId !== "string"
			|| !candidate.targetId.trim()
			|| !STUDY_PRIORITY_TARGETS.includes(candidate.targetType as StudyPriorityTarget)
			|| !STUDY_PRIORITIES.includes(candidate.priority as StudyPriority)
			|| typeof candidate.updatedAt !== "number"
			|| !Number.isFinite(candidate.updatedAt)
		) continue;
		const normalized: StudyPriorityRecord = {
			targetId: candidate.targetId,
			targetType: candidate.targetType as StudyPriorityTarget,
			priority: candidate.priority as StudyPriority,
			updatedAt: candidate.updatedAt,
		};
		const key = `${normalized.targetType}:${normalized.targetId}`;
		const current = byTarget.get(key);
		if (!current || normalized.updatedAt >= current.updatedAt) byTarget.set(key, normalized);
	}
	return [...byTarget.values()].sort((left, right) => left.updatedAt - right.updatedAt);
}

export function mergeStudyPriorities(
	...lists: Array<StudyPriorityRecord[] | undefined>
): StudyPriorityRecord[] {
	return normalizeStudyPriorities(lists.flatMap((list) => list ?? []));
}

export type LearnerProfileCategory =
	| "motivation"
	| "communication-preference"
	| "learning-preference"
	| "interest";

export interface LearnerProfileBelief {
	id: string;
	category: LearnerProfileCategory;
	value: string;
	source: "explicit" | "observed";
	confidence: number;
	evidence: string;
	createdAt: number;
	updatedAt: number;
}

export interface QuizResultRecord {
	id: string;
	topic: string;
	createdAt: number;
	score: number;
	partialCreditPoints?: number;
	totalQuestions: number;
	answers?: Record<string, string>;
	partialCredits?: Record<string, number>;
	timing?: {
		totalMs: number;
		perQuestionMs: Record<string, number>;
	};
	flaggedQuestionIds?: string[];
	pendingGradeQuestionIds?: string[];
	openEndedGrades?: QuizQuestionGrade[];
	sessionId?: string;
}

export interface QuizResultDetails {
	resultId?: string;
	answers?: Record<string, string>;
	partialCredits?: Record<string, number>;
	timing?: {
		totalMs: number;
		perQuestionMs: Record<string, number>;
	};
	flaggedQuestionIds?: string[];
	pendingGradeQuestionIds?: string[];
}

/** Convert persisted answer evidence into a normalized 0..1 learner signal. */
export function quizEvidenceScore(result: QuizResultRecord): number {
	const openEndedPoints = (result.openEndedGrades ?? []).reduce((sum, grade) =>
		sum + (grade.verdict === "correct" ? 1 : grade.verdict === "partial" ? 0.5 : 0), 0);
	const totalQuestions = result.totalQuestions + (result.openEndedGrades?.length ?? 0);
	const objectivePoints = typeof result.partialCreditPoints === "number"
		? result.partialCreditPoints
		: result.score;
	return totalQuestions > 0
		? Math.max(0, Math.min(1, (objectivePoints + openEndedPoints) / totalQuestions))
		: 0;
}

export interface PromptEvolutionResult {
	id: string;
	promptName: string;
	createdAt: number;
	bestScore: number;
	bestPrompt: string;
	report: string;
	sessionId?: string;
}

export interface ImprovementAttemptRecord {
	id: string;
	createdAt: number;
	proposalId: string;
	baselineScore: number;
	afterScore: number | null;
	scoreDelta: number | null;
	accepted: boolean;
	targets: string;
	hypothesis: string;
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Flashcard decks & spaced-repetition state (SM-2 variant)
// ---------------------------------------------------------------------------

export interface CardReviewRecord {
	id: string;
	deckId: string;
	cardId: string;
	topic: string;
	slug: string;
	rating: 0 | 1 | 2 | 3;
	appliedIntervalDays: number;
	easeAfter: number;
	/** The interval the learner was asked to recall over, before this review. */
	previousIntervalDays?: number;
	isLapse?: boolean;
	createdAt: number;
	sessionId?: string;
}

/** A structured comprehension checkpoint from ask_user_question. */
export interface QuestionCheckRecord {
	id: string;
	topic: string;
	question: string;
	answer: string;
	/** Undefined means the response is preserved for the tutor but has not been graded. */
	score?: number;
	grading: "auto" | "model" | "pending";
	misconception?: string;
	createdAt: number;
	sessionId?: string;
}

/** The durable result of applying one canonical OpenUI action to learner records. */
export interface OpenUiLearnerRecordMaterialization {
	receipt: UiActionReceipt;
	result: UiActionResult;
	replayed: boolean;
}

interface UiActionJournalMetaRecord {
	key: string;
	journal: UiActionJournal;
}

function openUiJournalKey(documentId: string): string {
	return `${OPENUI_ACTION_JOURNAL_PREFIX}${documentId}`;
}

function emptyOpenUiJournal(documentId: string): UiActionJournal {
	return {
		kind: UI_ACTION_JOURNAL_KIND,
		schemaVersion: UI_CONTRACT_VERSION,
		documentId,
		receipts: [],
	};
}

function stableOpenUiRecordId(kind: string, documentId: string, value: string): string {
	return `openui:${kind}:${documentId}:${value}`;
}

function openUiTimestamp(now: string): number {
	const timestamp = Date.parse(now);
	if (!Number.isFinite(timestamp)) throw new Error("OpenUI materialization requires a valid timestamp.");
	return timestamp;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
	});
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
	});
}

function targetForOpenUiAction(document: UiDocument, nodeId: string): { node: UiDocumentNode; question?: UiQuestion } | null {
	for (const node of document.nodes) {
		if (node.id === nodeId) return { node };
		if (node.type === "quiz") {
			const question = node.questions.find((candidate) => candidate.id === nodeId);
			if (question) return { node, question };
		}
	}
	return null;
}

function actionQuestion(target: { node: UiDocumentNode; question?: UiQuestion }): UiQuestion | null {
	return target.node.type === "question" ? target.node : target.question ?? null;
}

function answerText(action: Extract<UiAction, { type: "submit-answer" | "choose-option" }>, question: UiQuestion): string {
	if (action.type === "choose-option") {
		const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
		return action.optionIds.map((id) => labels.get(id) ?? id).join(", ");
	}
	if (typeof action.answer === "string") return action.answer;
	if (action.answer.every((value): value is string => typeof value === "string")) return action.answer.join("\n");
	const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
	return action.answer.map((row) => `${row.item}: ${labels.get(row.optionId) ?? row.optionId}${row.reason ? ` — ${row.reason}` : ""}`).join("\n");
}

function isRowAnswerList(answer: unknown): answer is UiRowAnswer[] {
	return Array.isArray(answer) && answer.every((value) => !!value && typeof value === "object" && typeof value.item === "string" && typeof value.optionId === "string");
}

function automaticallyGrade(
	action: Extract<UiAction, { type: "submit-answer" | "choose-option" }>,
	question: UiQuestion,
): { grading: "auto"; score: number } | { grading: "pending"; score?: undefined } {
	const actual = action.type === "choose-option"
		? action.optionIds
		: typeof action.answer === "string"
			? [action.answer]
			: action.answer.every((value): value is string => typeof value === "string")
				? action.answer
				: action.answer.map((row) => row.optionId);
	const rows = action.type === "submit-answer" && isRowAnswerList(action.answer) ? action.answer : undefined;
	return automaticallyGradeValues(question, actual, rows);
}

function automaticallyGradeValues(
	question: UiQuestion,
	actual: readonly string[],
	rows?: readonly UiRowAnswer[],
): { grading: "auto"; score: number } | { grading: "pending"; score?: undefined } {
	const expected = question.correctAnswers ?? (question.correctAnswer === undefined ? undefined : [question.correctAnswer]);
	if (expected && expected.length > 0) {
		const normalize = (value: string) => value.trim().toLocaleLowerCase();
		const actualSet = new Set(actual.map(normalize));
		const expectedSet = new Set(expected.map(normalize));
		return {
			grading: "auto",
			 score: actualSet.size === expectedSet.size && [...actualSet].every((value) => expectedSet.has(value)) ? 1 : 0,
		};
	}
	if (question.correctMatches && rows) {
		return {
			grading: "auto",
			score: rows.every((row, index) => row.optionId === question.correctMatches?.[index]) ? 1 : 0,
		};
	}
	return { grading: "pending" };
}

function questionGroupResponseText(response: UiQuestionGroupResponse, question: UiQuestion): string {
	switch (response.type) {
		case "text": return response.answer;
		case "choice": {
			const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
			const selected = response.optionIds.map((id) => labels.get(id) ?? id).join(", ");
			const text = response.text?.trim() ?? "";
			if (!selected) return text;
			return text ? `${selected}\n${text}` : selected;
		}
		case "blanks": return response.answers.join("\n");
		case "rows": {
			const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]));
			return response.rows.map((row) => `${row.item}: ${labels.get(row.optionId) ?? row.optionId}${row.reason ? ` — ${row.reason}` : ""}`).join("\n");
		}
	}
}

function automaticallyGradeQuestionGroupResponse(
	response: UiQuestionGroupResponse,
	question: UiQuestion,
): { grading: "auto"; score: number } | { grading: "pending"; score?: undefined } {
	switch (response.type) {
		case "text": return automaticallyGradeValues(question, [response.answer]);
		case "choice": return automaticallyGradeValues(question, response.optionIds);
		case "blanks": return automaticallyGradeValues(question, response.answers);
		case "rows": return automaticallyGradeValues(question, response.rows.map((row) => row.optionId), response.rows);
	}
}

function reportedDeckReviewState(
	state: FlashcardSrsState,
	rating: Extract<UiAction, { type: "complete-deck" }>["ratings"][number],
	timestamp: number,
): FlashcardSrsState {
	const computed = applyReview(state, rating.rating, timestamp).next;
	return {
		...computed,
		ease: rating.easeAfter,
		intervalDays: rating.appliedIntervalDays,
		dueAt: rating.rating === 0
			? timestamp + 10 * 60 * 1000
			: timestamp + rating.appliedIntervalDays * 86_400_000,
	};
}

function updateStudyPlanItems(items: readonly UiStudyPlanItem[], itemId: string, completed: boolean): UiStudyPlanItem[] {
	return items.map((item) => ({
		...item,
		...(item.id === itemId ? { status: completed ? "done" as const : "not_started" as const } : {}),
		...(item.children ? { children: updateStudyPlanItems(item.children, itemId, completed) } : {}),
	}));
}

function documentAfterOpenUiAction(source: UiDocument, action: UiAction, now: string): UiDocument {
	const nodes = source.nodes.map((node) => {
		if (action.type === "complete-goal-step" && node.type === "goal" && node.id === action.nodeId) {
			const steps = node.steps.map((step) => step.id === action.stepId ? { ...step, status: "done" as const } : step);
			return { ...node, steps, status: steps.every((step) => step.status === "done") ? "completed" as const : node.status };
		}
		if (action.type === "complete-plan-item" && node.type === "study-plan" && node.id === action.nodeId && node.items) {
			return { ...node, items: updateStudyPlanItems(node.items, action.itemId, action.completed) };
		}
		if (action.type === "update-notes" && node.type === "notes" && node.id === action.nodeId) {
			return { ...node, value: action.value };
		}
		return node;
	});
	const document: UiDocument = {
		...source,
		revision: source.revision + 1,
		lifecycle: action.type === "retry" ? "ready" : source.lifecycle,
		nodes,
		updatedAt: now,
	};
	if (!validateUiDocument(document)) throw new Error("OpenUI action produced an invalid resulting document.");
	return document;
}

function openUiLessonPlanProjection(document: UiDocument, timestamp: number, sessionId: string | null): LessonPlan {
	const id = stableOpenUiRecordId("lesson-plan", document.id, "projection");
	const sections: string[] = [];
	for (const node of document.nodes) {
		if (node.type === "study-plan") {
			const lines = [`## ${node.title ?? "Study plan"}`];
			if (node.overview) lines.push("", node.overview);
			const appendItems = (items: readonly UiStudyPlanItem[], depth = 0) => {
				for (const item of items) {
					lines.push(`${"  ".repeat(depth)}- [${item.status === "done" ? "x" : " "}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
					if (item.children) appendItems(item.children, depth + 1);
				}
			};
			if (node.items) appendItems(node.items);
			sections.push(lines.join("\n"));
		}
		if (node.type === "notes") sections.push(`## ${node.title}\n\n${node.value}`);
		if (node.type === "artifact" || node.type === "image" || node.type === "media") {
			const resource = node.resource;
			sections.push(`## ${resource.title}\n\n${resource.content ?? resource.uri ?? ""}`);
		}
	}
	return {
		id,
		topic: document.title?.trim() || `OpenUI ${document.id}`,
		createdAt: timestamp,
		updatedAt: timestamp,
		content: [`# ${document.title?.trim() || "OpenUI learning record"}`, ...sections].join("\n\n"),
		metadata: { source: "openui", documentId: document.id, documentRevision: document.revision },
		sessionId: sessionId ?? undefined,
	};
}

export function mergeFeedbackById(...lists: Array<FeedbackEntry[] | undefined>): FeedbackEntry[] {
	const byFeedbackId = new Map<string, FeedbackEntry>();
	for (const list of lists) {
		for (const entry of list ?? []) {
			byFeedbackId.set(entry.id, entry);
		}
	}
	return [...byFeedbackId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export class KeatingStorage {
	private db: IDBDatabase | null = null;
	private dbPromise: Promise<IDBDatabase> | null = null;
	private learnerStateWriteQueue: Promise<void> = Promise.resolve();
	currentSessionId: string | null = null;

	setCurrentSessionId(id: string | null): void {
		this.currentSessionId = id;
	}

	async init(): Promise<void> {
		if (this.db) return;
		if (this.dbPromise) {
			await this.dbPromise;
			return;
		}

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				this.dbPromise = null;
				reject(request.error);
			};
			request.onblocked = () => {
				console.warn("Keating storage upgrade is waiting for another tab to close its old database connection.");
			};

			request.onsuccess = () => {
				this.db = request.result;
				this.db.onversionchange = () => {
					this.db?.close();
					this.db = null;
					this.dbPromise = null;
				};
				resolve(this.db);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create object stores
				Object.values(STORES).forEach((storeName) => {
					if (!db.objectStoreNames.contains(storeName)) {
						const store = db.createObjectStore(storeName, { keyPath: "id" });
						store.createIndex("topic", "topic", { unique: false });
						store.createIndex("createdAt", "createdAt", { unique: false });
						store.createIndex("promptName", "promptName", { unique: false });
					}
				});
				const metaStore = db.objectStoreNames.contains(META_STORE)
					? request.transaction!.objectStore(META_STORE)
					: db.createObjectStore(META_STORE, { keyPath: "key" });
				metaStore.put({
					key: "schema",
					version: DB_VERSION,
					upgradedFrom: event.oldVersion,
					upgradedAt: Date.now(),
				});
			};
		});

		await this.dbPromise;
	}

	private async getStore(storeName: string, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
		await this.init();
		if (!this.db) throw new Error("Database not initialized");
		const transaction = this.db.transaction(storeName, mode);
		return transaction.objectStore(storeName);
	}

	private async getAll<T>(storeName: string): Promise<T[]> {
		const store = await this.getStore(storeName);
		return new Promise((resolve, reject) => {
			const request = store.getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private async getByTopic<T>(storeName: string, topic: string): Promise<T[]> {
		const store = await this.getStore(storeName);
		const index = store.index("topic");
		return new Promise((resolve, reject) => {
			const request = index.getAll(topic);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private async getByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
		const store = await this.getStore(storeName);
		const index = store.index(indexName);
		return new Promise((resolve, reject) => {
			const request = index.getAll(value);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private async put<T>(storeName: string, data: T): Promise<string> {
		const store = await this.getStore(storeName, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put(data);
			request.onsuccess = () => resolve(request.result as string);
			request.onerror = () => reject(request.error);
		});
	}

	private async putMany<T>(storeName: string, records: T[] | undefined): Promise<number> {
		if (!records?.length) return 0;
		for (const record of records) {
			await this.put(storeName, record);
		}
		return records.length;
	}

	private async deleteById(storeName: string, id: string): Promise<void> {
		const store = await this.getStore(storeName, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.delete(id);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private defaultLearnerState(): LearnerState {
		return {
			schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
			topicsExplored: [],
			feedbackHistory: [],
			strengths: [],
			weaknesses: [],
			topicProfiles: [],
			sessionsCount: 0,
			sessions: [],
			profileBeliefs: [],
			studyPriorities: [],
		};
	}

	private normalizeLearnerState(value: unknown): LearnerState {
		const raw = value && typeof value === "object" ? value as Partial<LearnerState> : {};
		return {
			schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
			topicsExplored: Array.isArray(raw.topicsExplored) ? raw.topicsExplored.filter((topic): topic is string => typeof topic === "string") : [],
			feedbackHistory: Array.isArray(raw.feedbackHistory) ? raw.feedbackHistory.filter((entry): entry is FeedbackEntry => !!entry && typeof entry === "object") : [],
			strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((item): item is string => typeof item === "string") : [],
			weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.filter((item): item is string => typeof item === "string") : [],
			topicProfiles: Array.isArray(raw.topicProfiles)
				? raw.topicProfiles.filter((item): item is LearnerTopicProfile => !!item && typeof item === "object" && typeof (item as LearnerTopicProfile).topic === "string")
				: [],
			lastSessionAt: typeof raw.lastSessionAt === "number" ? raw.lastSessionAt : undefined,
			sessionsCount: typeof raw.sessionsCount === "number" ? raw.sessionsCount : 0,
			sessions: Array.isArray(raw.sessions) ? raw.sessions.filter((session): session is LearnerState["sessions"][number] => !!session && typeof session === "object") : [],
			profileBeliefs: Array.isArray(raw.profileBeliefs)
				? raw.profileBeliefs.filter((belief): belief is LearnerProfileBelief => {
					if (!belief || typeof belief !== "object") return false;
					const candidate = belief as Partial<LearnerProfileBelief>;
					return typeof candidate.id === "string"
						&& typeof candidate.value === "string"
						&& typeof candidate.evidence === "string"
						&& ["motivation", "communication-preference", "learning-preference", "interest"].includes(String(candidate.category));
				})
				: [],
			studyPriorities: normalizeStudyPriorities(raw.studyPriorities),
		};
	}

	private mergeFeedbackIntoLearnerState(state: LearnerState, feedback: FeedbackEntry[]): { state: LearnerState; changed: boolean } {
		let changed = false;
		const byId = new Set(state.feedbackHistory.map((entry) => entry.id));
		for (const entry of feedback) {
			if (!byId.has(entry.id)) {
				state.feedbackHistory.push(entry);
				byId.add(entry.id);
				changed = true;
			}
		}
		state.feedbackHistory.sort((a, b) => a.createdAt - b.createdAt);

		const topics = new Set(state.topicsExplored);
		for (const entry of state.feedbackHistory) {
			if (entry.topic && !topics.has(entry.topic)) {
				topics.add(entry.topic);
				changed = true;
			}
		}
		const nextTopics = [...topics];
		if (nextTopics.length !== state.topicsExplored.length || nextTopics.some((topic, index) => topic !== state.topicsExplored[index])) {
			state.topicsExplored = nextTopics;
			changed = true;
		}

		if (state.sessionsCount !== state.sessions.length) {
			state.sessionsCount = state.sessions.length;
			changed = true;
		}

		return { state, changed };
	}

	private async loadLearnerStateRecord(): Promise<LearnerState> {
		const store = await this.getStore(STORES.LEARNER_STATE);
		return new Promise((resolve, reject) => {
			const request = store.get("learner-state");
			request.onsuccess = () => resolve(this.normalizeLearnerState(request.result || this.defaultLearnerState()));
			request.onerror = () => reject(request.error);
		});
	}

	/** Rebuild the displayed learner profile from its durable evidence records. */
	private async refreshDerivedLearnerProfile(): Promise<LearnerState> {
		const [state, feedback, quizResults, questionChecks, cardReviews] = await Promise.all([
			this.loadLearnerStateRecord(),
			this.getAll<FeedbackEntry>(STORES.FEEDBACK),
			this.getAll<QuizResultRecord>(STORES.QUIZ_RESULTS),
			this.getAll<QuestionCheckRecord>(STORES.QUESTION_CHECKS),
			this.getAll<CardReviewRecord>(STORES.CARD_REVIEWS),
		]);
		const profile = deriveLearnerProfile([
			...feedback.map((entry) => ({
				topic: entry.topic,
				kind: "feedback" as const,
				score: entry.signal === "thumbs-up" ? 0.85 : entry.signal === "confused" ? 0.35 : 0.15,
				createdAt: entry.createdAt,
				weight: entry.source === "explicit" ? 0.25 : 0.1,
				note: entry.evidence,
			})),
			...quizResults
				.filter((result) => result.totalQuestions > 0 || (result.openEndedGrades?.length ?? 0) > 0)
				.map((result) => ({
				topic: result.topic,
				kind: "quiz" as const,
				score: quizEvidenceScore(result),
				createdAt: result.createdAt,
				weight: 1.2,
				})),
			...questionChecks.filter((check): check is QuestionCheckRecord & { score: number } => typeof check.score === "number").map((check) => ({
				topic: check.topic,
				kind: "diagnostic" as const,
				score: check.score,
				createdAt: check.createdAt,
				weight: 0.8,
				note: check.misconception,
			})),
			...cardReviews.map((review) => ({
				topic: review.topic,
				kind: "review" as const,
				score: review.rating === 0 ? 0.05 : review.rating === 1 ? 0.45 : review.rating === 2 ? 0.75 : 0.9,
				createdAt: review.createdAt,
				weight: 0.3 + Math.min(0.7, Math.max(0, review.previousIntervalDays ?? 0) / 21),
			})),
		]);
		const topicsExplored = [...new Set([
			...state.topicsExplored,
			...profile.topics.map((topic) => topic.topic),
		])];
		const next = {
			...state,
			topicsExplored,
			topicProfiles: profile.topics,
			strengths: profile.strengths,
			weaknesses: profile.weaknesses,
		};
		if (JSON.stringify(next) !== JSON.stringify(state)) await this.saveLearnerState(next);
		return next;
	}

	private async updateLearnerState(mutator: (state: LearnerState) => void | Promise<void>): Promise<LearnerState> {
		let updated: LearnerState | null = null;
		const run = this.learnerStateWriteQueue.then(async () => {
			const state = await this.getLearnerState();
			await mutator(state);
			state.sessionsCount = state.sessions.length;
			await this.saveLearnerState(state);
			updated = state;
		});
		this.learnerStateWriteQueue = run.catch(() => {});
		await run;
		return updated ?? this.getLearnerState();
	}

	/**
	 * Materialize a canonical OpenUI action into the browser's learner records.
	 * The receipt journal and every affected record share one IndexedDB
	 * transaction, so a retry can never observe a receipt without its effect.
	 */
	async materializeCanonicalOpenUiAction(
		action: UiAction,
		sourceDocument: UiDocument,
		now = new Date().toISOString(),
	): Promise<OpenUiLearnerRecordMaterialization> {
		if (!validateUiDocument(sourceDocument) || !validateUiActionAgainstDocument(action, sourceDocument)) {
			throw new Error("OpenUI action does not apply to its source document.");
		}
		const timestamp = openUiTimestamp(now);
		const target = action.type === "retry" ? null : targetForOpenUiAction(sourceDocument, action.nodeId);
		if (action.type !== "retry" && !target) throw new Error("OpenUI action target is missing from its source document.");

	const stores = [META_STORE];
	switch (action.type) {
		case "submit-answer":
		case "choose-option":
		case "submit-question-group":
		case "complete-quiz": stores.push(STORES.QUESTION_CHECKS); break;
			case "complete-goal-step": stores.push(STORES.GOALS); break;
			case "complete-plan-item":
			case "update-notes":
			case "save-artifact": stores.push(STORES.LESSON_PLANS); break;
		case "rate-card":
		case "complete-deck": stores.push(STORES.DECKS, STORES.CARD_REVIEWS); break;
			case "retry":
			case "open-handoff": break;
		}

		await this.init();
		if (!this.db) throw new Error("Database not initialized");
		const transaction = this.db.transaction(stores, "readwrite");
		const complete = transactionCompletion(transaction);
		let materialization: OpenUiLearnerRecordMaterialization | null = null;

		try {
			const metaStore = transaction.objectStore(META_STORE);
			const journalKey = openUiJournalKey(sourceDocument.id);
			const stored = await requestValue(metaStore.get(journalKey)) as UiActionJournalMetaRecord | undefined;
			const journal = stored === undefined
				? emptyOpenUiJournal(sourceDocument.id)
				: stored.journal;
			if (!validateUiActionJournal(journal) || journal.documentId !== sourceDocument.id) {
				throw new UiActionReplayConflictError("Stored OpenUI action journal is invalid.");
			}
			const replay = receiptForUiAction(journal, action);
			if (replay) {
				if (replay.state !== "completed" || !replay.result) {
					throw new UiActionReplayConflictError("Stored OpenUI action receipt is incomplete.");
				}
				materialization = { receipt: structuredClone(replay), result: structuredClone(replay.result), replayed: true };
			} else {
				const resultingDocument = documentAfterOpenUiAction(sourceDocument, action, now);
				if (action.type === "submit-answer" || action.type === "choose-option") {
					const question = target && actionQuestion(target);
					if (!question) throw new Error("OpenUI question action has no question target.");
					const grade = automaticallyGrade(action, question);
					const check: QuestionCheckRecord = {
						id: stableOpenUiRecordId("question-check", sourceDocument.id, action.idempotencyKey),
						topic: sourceDocument.title?.trim() || question.header?.trim() || `OpenUI ${sourceDocument.id}`,
						question: question.prompt,
						answer: answerText(action, question),
						...grade,
						createdAt: timestamp,
						sessionId: this.currentSessionId ?? undefined,
					};
					await requestValue(transaction.objectStore(STORES.QUESTION_CHECKS).put(check));
				}
				if (action.type === "submit-question-group") {
					if (!target || target.node.type !== "question-group") throw new Error("OpenUI group action has no question group target.");
					const group = target.node;
					const questionById = new Map(group.questions.map((question) => [question.id, question]));
					const checks = action.responses.map((response) => {
						const question = questionById.get(response.questionId);
						if (!question) throw new Error("OpenUI group response targets a missing question.");
						return {
							id: stableOpenUiRecordId("question-check", sourceDocument.id, `${action.idempotencyKey}:${question.id}`),
							topic: group.topic?.trim() || question.header?.trim() || sourceDocument.title?.trim() || `OpenUI ${sourceDocument.id}`,
							question: question.prompt,
							answer: questionGroupResponseText(response, question),
							...automaticallyGradeQuestionGroupResponse(response, question),
							createdAt: timestamp,
							sessionId: this.currentSessionId ?? undefined,
						} satisfies QuestionCheckRecord;
					});
					const questionChecks = transaction.objectStore(STORES.QUESTION_CHECKS);
					for (const check of checks) await requestValue(questionChecks.put(check));
				}
				if (action.type === "complete-quiz") {
					if (!target || target.node.type !== "quiz") throw new Error("OpenUI quiz action has no quiz target.");
					const quiz = target.node;
					const answers = new Map(action.answers.map((answer) => [answer.questionId, answer.answer]));
					const pending = new Set(action.pendingGradeQuestionIds);
					const skipped = new Set(action.skippedQuestionIds);
					const questionChecks = transaction.objectStore(STORES.QUESTION_CHECKS);
					for (const question of quiz.questions) {
						const answer = answers.get(question.id) ?? "";
						const reportedPartialCredit = action.partialCredits[question.id];
						const grade = pending.has(question.id)
							? { grading: "pending" as const }
							: typeof reportedPartialCredit === "number"
								? { grading: "auto" as const, score: Math.max(0, Math.min(1, reportedPartialCredit)) }
								: skipped.has(question.id)
									? { grading: "auto" as const, score: 0 }
									: automaticallyGradeValues(question, [answer]);
						const check: QuestionCheckRecord = {
							id: stableOpenUiRecordId("question-check", sourceDocument.id, `${action.idempotencyKey}:${question.id}`),
							topic: quiz.title.trim() || question.header?.trim() || sourceDocument.title?.trim() || `OpenUI ${sourceDocument.id}`,
							question: question.prompt,
							answer,
							...grade,
							createdAt: timestamp,
							sessionId: this.currentSessionId ?? undefined,
						};
						await requestValue(questionChecks.put(check));
					}
				}
				if (action.type === "complete-goal-step") {
					if (!target || target.node.type !== "goal") throw new Error("OpenUI goal action has no goal target.");
					const id = stableOpenUiRecordId("goal", sourceDocument.id, target.node.id);
					const goalStore = transaction.objectStore(STORES.GOALS);
					const current = await requestValue(goalStore.get(id)) as LearnerGoal | undefined;
					const base: LearnerGoal = current ?? {
						id,
						title: target.node.title,
						description: target.node.description ?? "",
						status: target.node.status,
						steps: target.node.steps.map((step, index) => ({
							id: step.id,
							order: index,
							title: step.title,
							description: "",
							kind: "milestone",
							successCriteria: step.successCriteria ?? [],
							status: step.status,
						})),
						createdAt: timestamp,
						updatedAt: timestamp,
						sessionId: this.currentSessionId ?? undefined,
					};
					const steps = base.steps.map((step) => step.id === action.stepId
						? { ...step, status: "done" as const, completedAt: now }
						: step);
					const goal: LearnerGoal = {
						...base,
						steps,
						status: steps.length > 0 && steps.every((step) => step.status === "done") ? "completed" : base.status === "completed" ? "active" : base.status,
						updatedAt: timestamp,
					};
					await requestValue(goalStore.put(goal));
				}
				if (action.type === "complete-plan-item" || action.type === "update-notes" || action.type === "save-artifact") {
					const planStore = transaction.objectStore(STORES.LESSON_PLANS);
					const projection = openUiLessonPlanProjection(resultingDocument, timestamp, this.currentSessionId);
					const current = await requestValue(planStore.get(projection.id)) as LessonPlan | undefined;
					await requestValue(planStore.put({
						...projection,
						createdAt: current?.createdAt ?? projection.createdAt,
						sessionId: current?.sessionId ?? projection.sessionId,
					}));
				}
				if (action.type === "rate-card") {
					if (!target || target.node.type !== "deck") throw new Error("OpenUI card action has no deck target.");
					const deckStore = transaction.objectStore(STORES.DECKS);
					const deckId = stableOpenUiRecordId("deck", sourceDocument.id, target.node.id);
					const current = await requestValue(deckStore.get(deckId)) as FlashcardDeck | undefined;
					const priorCards = new Map(current?.cards.map((card) => [card.id, card]));
					const cards: Flashcard[] = target.node.cards.map((card: UiDeckCard) => {
						const prior = priorCards.get(card.id);
						return {
							id: card.id,
							front: card.front,
							back: card.back,
							tags: card.tags,
							srs: prior?.srs ?? initialSrsState(timestamp),
							createdAt: prior?.createdAt ?? timestamp,
							updatedAt: prior?.updatedAt ?? timestamp,
						};
					});
					const card = cards.find((candidate) => candidate.id === action.cardId);
					if (!card) throw new Error("OpenUI card target is missing from its deck.");
					const outcome = applyReview(card.srs, action.rating, timestamp);
					const deck: FlashcardDeck = {
						id: deckId,
						topic: target.node.topic,
						slug: `openui-${sourceDocument.id}-${target.node.id}`,
						title: target.node.title,
						cards: cards.map((candidate) => candidate.id === card.id ? { ...candidate, srs: outcome.next, updatedAt: timestamp } : candidate),
						createdAt: current?.createdAt ?? timestamp,
						updatedAt: timestamp,
						sessionId: current?.sessionId ?? this.currentSessionId ?? undefined,
					};
					const review: CardReviewRecord = {
						id: stableOpenUiRecordId("card-review", sourceDocument.id, action.idempotencyKey),
						deckId,
						cardId: card.id,
						topic: deck.topic,
						slug: deck.slug,
						rating: action.rating,
						appliedIntervalDays: outcome.appliedIntervalDays,
						easeAfter: outcome.next.ease,
						previousIntervalDays: card.srs.intervalDays,
						isLapse: outcome.isLapse,
						createdAt: timestamp,
						sessionId: this.currentSessionId ?? undefined,
					};
					await requestValue(deckStore.put(deck));
					await requestValue(transaction.objectStore(STORES.CARD_REVIEWS).put(review));
				}
				if (action.type === "complete-deck") {
					if (!target || target.node.type !== "deck") throw new Error("OpenUI deck completion has no deck target.");
					const sourceDeck = target.node;
					const deckStore = transaction.objectStore(STORES.DECKS);
					const deckId = stableOpenUiRecordId("deck", sourceDocument.id, sourceDeck.id);
					const current = await requestValue(deckStore.get(deckId)) as FlashcardDeck | undefined;
					const priorCards = new Map(current?.cards.map((card) => [card.id, card]));
					const cards = sourceDeck.cards.map((card: UiDeckCard): Flashcard => {
						const prior = priorCards.get(card.id);
						return {
							id: card.id,
							front: card.front,
							back: card.back,
							tags: card.tags,
							srs: prior?.srs ?? initialSrsState(timestamp),
							createdAt: prior?.createdAt ?? timestamp,
							updatedAt: prior?.updatedAt ?? timestamp,
						};
					});
					const reviews: CardReviewRecord[] = action.ratings.map((rating) => {
						const card = cards.find((candidate) => candidate.id === rating.cardId);
						if (!card) throw new Error("OpenUI card target is missing from its deck.");
						const priorSrs = card.srs;
						const nextSrs = reportedDeckReviewState(priorSrs, rating, timestamp);
						card.srs = nextSrs;
						card.updatedAt = timestamp;
						return {
							id: stableOpenUiRecordId("card-review", sourceDocument.id, `${action.idempotencyKey}:${card.id}`),
							deckId,
							cardId: card.id,
							topic: sourceDeck.topic,
							slug: `openui-${sourceDocument.id}-${sourceDeck.id}`,
							rating: rating.rating,
							appliedIntervalDays: rating.appliedIntervalDays,
							easeAfter: rating.easeAfter,
							previousIntervalDays: priorSrs.intervalDays,
							isLapse: rating.rating === 0,
							createdAt: timestamp,
							sessionId: this.currentSessionId ?? undefined,
						};
					});
					const deck: FlashcardDeck = {
						id: deckId,
						topic: sourceDeck.topic,
						slug: `openui-${sourceDocument.id}-${sourceDeck.id}`,
						title: sourceDeck.title,
						cards,
						createdAt: current?.createdAt ?? timestamp,
						updatedAt: timestamp,
						sessionId: current?.sessionId ?? this.currentSessionId ?? undefined,
					};
					await requestValue(deckStore.put(deck));
					const reviewStore = transaction.objectStore(STORES.CARD_REVIEWS);
					for (const review of reviews) await requestValue(reviewStore.put(review));
				}

				const result: UiActionResult = {
					schemaVersion: UI_CONTRACT_VERSION,
					documentId: action.documentId,
					sourceRevision: action.documentRevision,
					actionIdempotencyKey: action.idempotencyKey,
					status: "completed",
					documentLifecycle: resultingDocument.lifecycle,
					resultingDocument,
				};
				const receipt: UiActionReceipt = {
					schemaVersion: UI_CONTRACT_VERSION,
					action,
					actionFingerprint: canonicalUiAction(action),
					state: "completed",
					createdAt: now,
					updatedAt: now,
					result,
				};
				const nextJournal: UiActionJournal = { ...journal, receipts: [...journal.receipts, receipt] };
				if (!validateUiActionJournal(nextJournal)) throw new Error("OpenUI action journal is invalid or full.");
				await requestValue(metaStore.put({ key: journalKey, journal: nextJournal } satisfies UiActionJournalMetaRecord));
				materialization = { receipt: structuredClone(receipt), result: structuredClone(result), replayed: false };
			}
		} catch (error) {
			try { transaction.abort(); } catch { /* the transaction may already have finished */ }
			await complete.catch(() => undefined);
			throw error;
		}
		await complete;
		if (!materialization) throw new Error("OpenUI action materialization did not produce a result.");
		return materialization;
	}

	// Learner Goals — long-horizon curricula, tracked across sessions
	async saveGoal(goal: LearnerGoal): Promise<LearnerGoal> {
		const record: LearnerGoal = {
			...goal,
			sessionId: goal.sessionId ?? this.currentSessionId ?? undefined,
			updatedAt: Date.now(),
		};
		await this.put(STORES.GOALS, record);
		return record;
	}

	async getGoals(): Promise<LearnerGoal[]> {
		const goals = await this.getAll<LearnerGoal>(STORES.GOALS);
		return goals.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async getGoal(id: string): Promise<LearnerGoal | null> {
		const goals = await this.getAll<LearnerGoal>(STORES.GOALS);
		return goals.find((g) => g.id === id) ?? null;
	}

	async deleteGoal(id: string): Promise<void> {
		await this.deleteById(STORES.GOALS, id);
	}

	async exportPortableData(): Promise<KeatingStoragePortableData> {
		const [
			lessonPlans,
			lessonMaps,
			animations,
			verifications,
			benchmarks,
			evolutions,
			policies,
			feedback,
			learnerState,
			promptEvolutions,
			improvements,
			goals,
			quizResults,
			decks,
			cardReviews,
		] = await Promise.all([
			this.getLessonPlans(),
			this.getLessonMaps(),
			this.getAnimations(),
			this.getVerifications(),
			this.getBenchmarks(),
			this.getEvolutions(),
			this.getPolicies(),
			this.getFeedback(),
			this.getLearnerState(),
			this.getPromptEvolutions(),
			this.getImprovementAttempts(),
			this.getGoals(),
			this.getQuizResults(),
			this.getDecks(),
			this.getCardReviews(),
		]);
		return {
			lessonPlans,
			lessonMaps,
			animations,
			verifications,
			benchmarks,
			evolutions,
			policies,
			feedback,
			learnerState,
			promptEvolutions,
			improvements,
			goals,
			quizResults,
			decks,
			cardReviews,
			questionChecks: await this.getQuestionChecks(),
		};
	}

	async importPortableData(data: Partial<KeatingStoragePortableData>): Promise<KeatingStorageImportResult> {
		const result: KeatingStorageImportResult = {
			lessonPlans: await this.putMany(STORES.LESSON_PLANS, data.lessonPlans),
			lessonMaps: await this.putMany(STORES.LESSON_MAPS, data.lessonMaps),
			animations: await this.putMany(STORES.ANIMATIONS, data.animations),
			verifications: await this.putMany(STORES.VERIFICATIONS, data.verifications),
			benchmarks: await this.putMany(STORES.BENCHMARKS, data.benchmarks),
			evolutions: await this.putMany(STORES.EVOLUTIONS, data.evolutions),
			policies: await this.putMany(STORES.POLICIES, data.policies),
			feedback: await this.putMany(STORES.FEEDBACK, data.feedback),
			promptEvolutions: await this.putMany(STORES.PROMPT_EVOLUTIONS, data.promptEvolutions),
			improvements: await this.putMany(STORES.IMPROVEMENTS, data.improvements),
			goals: await this.putMany(STORES.GOALS, data.goals),
			quizResults: await this.putMany(STORES.QUIZ_RESULTS, data.quizResults),
			decks: await this.putMany(STORES.DECKS, data.decks),
			cardReviews: await this.putMany(STORES.CARD_REVIEWS, data.cardReviews),
			questionChecks: await this.putMany(STORES.QUESTION_CHECKS, data.questionChecks),
		};
		if (data.learnerState) {
			const current = await this.getLearnerState();
			const mergedFeedback = mergeFeedbackById(current.feedbackHistory, data.learnerState.feedbackHistory, data.feedback);
			const bySessionId = new Map(
				[...(current.sessions ?? []), ...(data.learnerState.sessions ?? [])].map((session) => [
					session.id ?? `${session.startedAt}:${session.endedAt ?? "open"}`,
					session,
				]),
			);
			const mergedState = this.normalizeLearnerState({
				...current,
				...data.learnerState,
				topicsExplored: [...new Set([...(current.topicsExplored ?? []), ...(data.learnerState.topicsExplored ?? [])])],
				feedbackHistory: mergedFeedback,
				strengths: [...new Set([...(current.strengths ?? []), ...(data.learnerState.strengths ?? [])])],
				weaknesses: [...new Set([...(current.weaknesses ?? []), ...(data.learnerState.weaknesses ?? [])])],
				sessions: [...bySessionId.values()],
				studyPriorities: mergeStudyPriorities(current.studyPriorities, data.learnerState.studyPriorities),
			});
			await this.saveLearnerState(mergedState);
		} else if (data.feedback?.length) {
			await this.getLearnerState();
		}
		await this.refreshDerivedLearnerProfile();
		return result;
	}

	// Lesson Plans
	async saveLessonPlan(topic: string, content: string, metadata?: Record<string, unknown>): Promise<LessonPlan> {
		const plan: LessonPlan = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			content,
			metadata,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.LESSON_PLANS, plan);
		return plan;
	}

	async getLessonPlans(topic?: string): Promise<LessonPlan[]> {
		if (topic) {
			return this.getByTopic<LessonPlan>(STORES.LESSON_PLANS, topic);
		}
		return this.getAll<LessonPlan>(STORES.LESSON_PLANS);
	}

	// Lesson Maps
	async saveLessonMap(topic: string, mmdContent: string, svgContent?: string): Promise<LessonMap> {
		const map: LessonMap = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			mmdContent,
			svgContent,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.LESSON_MAPS, map);
		return map;
	}

	async getLessonMaps(topic?: string): Promise<LessonMap[]> {
		if (topic) {
			return this.getByTopic<LessonMap>(STORES.LESSON_MAPS, topic);
		}
		return this.getAll<LessonMap>(STORES.LESSON_MAPS);
	}

	// Animations
	async saveAnimation(
		topic: string,
		storyboard: string,
		scene: string,
		manifest: string,
		renderer: "hyperframes" = "hyperframes",
	): Promise<Animation> {
		const animation: Animation = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			storyboard,
			scene,
			manifest,
			renderer,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.ANIMATIONS, animation);
		return animation;
	}

	async getAnimations(topic?: string): Promise<Animation[]> {
		if (topic) {
			return this.getByTopic<Animation>(STORES.ANIMATIONS, topic);
		}
		return this.getAll<Animation>(STORES.ANIMATIONS);
	}

	// Verifications
	async saveVerification(topic: string, checklist: string): Promise<Verification> {
		const verification: Verification = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			checklist,
			completed: false,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.VERIFICATIONS, verification);
		return verification;
	}

	async getVerifications(topic?: string): Promise<Verification[]> {
		if (topic) {
			return this.getByTopic<Verification>(STORES.VERIFICATIONS, topic);
		}
		return this.getAll<Verification>(STORES.VERIFICATIONS);
	}

	async setVerificationCompleted(id: string, completed: boolean): Promise<Verification | null> {
		const verifications = await this.getVerifications();
		const current = verifications.find((verification) => verification.id === id);
		if (!current) return null;
		const updated = { ...current, completed };
		await this.put(STORES.VERIFICATIONS, updated);
		return updated;
	}

	// Benchmarks
	async saveBenchmark(score: number, report: string, topic?: string, trace?: string): Promise<BenchmarkResult> {
		const benchmark: BenchmarkResult = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			score,
			trace,
			report,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.BENCHMARKS, benchmark);
		return benchmark;
	}

	async getBenchmarks(topic?: string): Promise<BenchmarkResult[]> {
		if (topic) {
			return this.getByTopic<BenchmarkResult>(STORES.BENCHMARKS, topic);
		}
		return this.getAll<BenchmarkResult>(STORES.BENCHMARKS);
	}

	// Quiz Results
	async saveQuizResult(
		score: number,
		partialCreditPoints: number | undefined,
		totalQuestions: number,
		topic?: string,
		details?: QuizResultDetails,
	): Promise<QuizResultRecord> {
		const record: QuizResultRecord = {
			id: details?.resultId || this.generateId(),
			topic: topic || "general",
			createdAt: Date.now(),
			score,
			partialCreditPoints,
			totalQuestions,
			answers: details?.answers ? { ...details.answers } : undefined,
			partialCredits: details?.partialCredits ? { ...details.partialCredits } : undefined,
			timing: details?.timing ? {
				totalMs: details.timing.totalMs,
				perQuestionMs: { ...details.timing.perQuestionMs },
			} : undefined,
			flaggedQuestionIds: details?.flaggedQuestionIds ? [...details.flaggedQuestionIds] : undefined,
			pendingGradeQuestionIds: details?.pendingGradeQuestionIds ? [...details.pendingGradeQuestionIds] : undefined,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.QUIZ_RESULTS, record);
		await this.refreshDerivedLearnerProfile();
		return record;
	}

	async saveQuizGrades(resultId: string, grades: QuizQuestionGrade[]): Promise<QuizResultRecord | null> {
		const current = (await this.getQuizResults()).find((result) => result.id === resultId);
		if (!current) return null;
		const byQuestionId = new Map((current.openEndedGrades ?? []).map((grade) => [grade.questionId, grade]));
		for (const grade of grades) byQuestionId.set(grade.questionId, { ...grade });
		const gradedIds = new Set(grades.map((grade) => grade.questionId));
		const updated: QuizResultRecord = {
			...current,
			openEndedGrades: [...byQuestionId.values()],
			pendingGradeQuestionIds: (current.pendingGradeQuestionIds ?? []).filter((id) => !gradedIds.has(id)),
		};
		await this.put(STORES.QUIZ_RESULTS, updated);
		await this.refreshDerivedLearnerProfile();
		return updated;
	}

	async getQuizResults(topic?: string): Promise<QuizResultRecord[]> {
		const results = topic
			? await this.getByTopic<QuizResultRecord>(STORES.QUIZ_RESULTS, topic)
			: await this.getAll<QuizResultRecord>(STORES.QUIZ_RESULTS);
		return results.map((record) => {
			const current = { ...record } as QuizResultRecord & {
				confidence?: unknown;
				weightedScore?: unknown;
			};
			delete current.confidence;
			delete current.weightedScore;
			return current;
		});
	}

	async getTopicQuizStats(topic: string): Promise<{ count: number; avgScore: number; avgPartialCreditPoints: number; topQuartile: number } | null> {
		const results = await this.getQuizResults(topic);
		if (results.length < 5) return null;
		const sorted = [...results].sort((a, b) => b.score - a.score);
		const avgScore = sorted.reduce((s, r) => s + r.score, 0) / sorted.length;
		const partialCreditResults = sorted.filter((r) => typeof r.partialCreditPoints === "number");
		const avgPartialCreditPoints = partialCreditResults.length > 0
			? partialCreditResults.reduce((sum, result) => sum + (result.partialCreditPoints ?? 0), 0) / partialCreditResults.length
			: 0;
		const qIdx = Math.floor(sorted.length * 0.25);
		const topQuartile = sorted[qIdx]?.score ?? sorted[0]?.score ?? 0;
		return { count: sorted.length, avgScore, avgPartialCreditPoints, topQuartile };
	}

	// Evolutions
	async saveEvolution(bestScore: number, policy: string, report: string, topic?: string, trace?: string): Promise<EvolutionResult> {
		const evolution: EvolutionResult = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			bestScore,
			policy,
			trace,
			report,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.EVOLUTIONS, evolution);
		return evolution;
	}

	async getEvolutions(topic?: string): Promise<EvolutionResult[]> {
		if (topic) {
			return this.getByTopic<EvolutionResult>(STORES.EVOLUTIONS, topic);
		}
		return this.getAll<EvolutionResult>(STORES.EVOLUTIONS);
	}

	// Policies
	async savePolicy(content: string, active: boolean = true): Promise<Policy> {
		// Deactivate other policies if this one is active
		if (active) {
			const policies = await this.getAll<Policy>(STORES.POLICIES);
			for (const p of policies) {
				if (p.active) {
					p.active = false;
					p.updatedAt = Date.now();
					await this.put(STORES.POLICIES, p);
				}
			}
		}

		const policy: Policy = {
			id: this.generateId(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			content,
			active,
		};
		await this.put(STORES.POLICIES, policy);
		return policy;
	}

	async getActivePolicy(): Promise<Policy | null> {
		const policies = await this.getAll<Policy>(STORES.POLICIES);
		return policies.find((p) => p.active) || null;
	}

	async getPolicies(): Promise<Policy[]> {
		return this.getAll<Policy>(STORES.POLICIES);
	}

	// Feedback
	async recordFeedback(
		topic: string,
		signal: "thumbs-up" | "thumbs-down" | "confused",
		options: {
			source?: "explicit" | "turn-analysis";
			evidence?: string;
			sessionId?: string;
			messageId?: string;
			referent?: FeedbackEntry["referent"];
			topicSource?: FeedbackEntry["topicSource"];
		} = {},
	): Promise<FeedbackEntry> {
		const entry: FeedbackEntry = {
			id: this.generateId(),
			topic,
			signal,
			createdAt: Date.now(),
			source: options.source ?? "explicit",
			evidence: options.evidence,
			sessionId: options.sessionId ?? this.currentSessionId ?? undefined,
			messageId: options.messageId,
			referent: options.referent,
			topicSource: options.topicSource ?? (options.source === "turn-analysis" ? "turn-analysis" : "explicit"),
		};
		await this.put(STORES.FEEDBACK, entry);

		await this.updateLearnerState((state) => {
			if (!state.feedbackHistory.some((existing) => existing.id === entry.id)) {
				state.feedbackHistory.push(entry);
			}
			if (!state.topicsExplored.includes(topic)) {
				state.topicsExplored.push(topic);
			}
			state.lastSessionAt = Date.now();
		});
		await this.refreshDerivedLearnerProfile();

		return entry;
	}

	async recordLearnerTurnFeedback(messages: Array<{ role?: unknown; content?: unknown }>): Promise<number> {
		const state = await this.getLearnerState();
		const fallbackTopic = state.topicsExplored.at(-1) ?? state.feedbackHistory.at(-1)?.topic ?? "general";
		let count = 0;
		const entries: FeedbackEntry[] = [];

		for (const message of messages) {
			const role = message.role;
			if (role !== "user" && role !== "user-with-attachments") continue;
			const text = browserMessageText(message);
			const inferred = inferBrowserLearnerTurnSignal(text, fallbackTopic);
			if (!inferred || inferred.topic === "general") continue;
			if (state.feedbackHistory.some((entry) => entry.source === "turn-analysis" && entry.evidence === inferred.evidence)) continue;
			const entry: FeedbackEntry = {
				id: this.generateId(),
				topic: inferred.topic,
				signal: inferred.signal,
				createdAt: Date.now(),
				source: "turn-analysis",
				evidence: inferred.evidence,
			};
			await this.put(STORES.FEEDBACK, entry);
			entries.push(entry);
			count += 1;
		}

		if (count > 0) {
			await this.updateLearnerState((nextState) => {
				for (const entry of entries) {
					if (!nextState.feedbackHistory.some((existing) => existing.id === entry.id)) {
						nextState.feedbackHistory.push(entry);
					}
					if (!nextState.topicsExplored.includes(entry.topic)) nextState.topicsExplored.push(entry.topic);
				}
				nextState.lastSessionAt = Date.now();
			});
			await this.refreshDerivedLearnerProfile();
		}

		return count;
	}

	async getFeedback(topic?: string): Promise<FeedbackEntry[]> {
		if (topic) {
			return this.getByTopic<FeedbackEntry>(STORES.FEEDBACK, topic);
		}
		return this.getAll<FeedbackEntry>(STORES.FEEDBACK);
	}

	// Learner State
	async getLearnerState(): Promise<LearnerState> {
		const state = await this.loadLearnerStateRecord();
		const feedback = await this.getAll<FeedbackEntry>(STORES.FEEDBACK);
		const merged = this.mergeFeedbackIntoLearnerState(state, feedback);
		if (merged.changed) {
			await this.saveLearnerState(merged.state);
		}
		return this.refreshDerivedLearnerProfile();
	}

	async saveLearnerState(state: LearnerState): Promise<void> {
		const store = await this.getStore(STORES.LEARNER_STATE, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put({
				...state,
				schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
				id: "learner-state",
			});
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async setStudyPriority(input: Omit<StudyPriorityRecord, "updatedAt">): Promise<LearnerState> {
		return this.updateLearnerState((state) => {
			state.studyPriorities = state.studyPriorities.filter((record) =>
				record.targetId !== input.targetId || record.targetType !== input.targetType);
			state.studyPriorities.push({ ...input, updatedAt: Date.now() });
		});
	}

	async rememberLearnerProfileBelief(input: {
		category: LearnerProfileCategory;
		value: string;
		source: "explicit" | "observed";
		evidence: string;
		confidence?: number;
	}): Promise<LearnerProfileBelief> {
		const value = input.value.trim().slice(0, 240);
		const evidence = input.evidence.trim().slice(0, 500);
		if (!value || !evidence) throw new Error("A profile belief needs both a value and supporting evidence.");
		const now = Date.now();
		let saved: LearnerProfileBelief | null = null;
		await this.updateLearnerState((state) => {
			const normalized = value.toLocaleLowerCase();
			const existing = state.profileBeliefs.find((belief) =>
				belief.category === input.category && belief.value.toLocaleLowerCase() === normalized
			);
			const requestedConfidence = Number.isFinite(input.confidence)
				? Math.max(0, Math.min(1, input.confidence!))
				: input.source === "explicit" ? 1 : 0.45;
			const confidence = input.source === "explicit"
				? 1
				: Math.min(0.65, requestedConfidence);
			if (existing) {
				existing.source = existing.source === "explicit" ? "explicit" : input.source;
				existing.confidence = existing.source === "explicit"
					? 1
					: Math.max(existing.confidence, confidence);
				existing.evidence = evidence;
				existing.updatedAt = now;
				saved = { ...existing };
				return;
			}
			const belief: LearnerProfileBelief = {
				id: this.generateId(),
				category: input.category,
				value,
				source: input.source,
				confidence,
				evidence,
				createdAt: now,
				updatedAt: now,
			};
			state.profileBeliefs.push(belief);
			saved = belief;
		});
		if (!saved) throw new Error("Learner profile belief was not saved.");
		return saved;
	}

	async recordSessionStart(): Promise<void> {
		await this.updateLearnerState((state) => {
			if (!state.sessions) state.sessions = [];
			const activeSessionId = this.currentSessionId;
			const existing = activeSessionId
				? state.sessions.find((session) => session.id === activeSessionId && !session.endedAt)
				: state.sessions.at(-1);
			if (existing && !existing.endedAt) {
				state.lastSessionAt = Date.now();
				return;
			}
			state.sessions.push({
				id: activeSessionId ?? undefined,
				startedAt: Date.now(),
				topicsCovered: [],
			});
			state.lastSessionAt = Date.now();
		});
	}

	async recordSessionEnd(topicsCovered: string[]): Promise<void> {
		const state = await this.getLearnerState();
		if (!state.sessions) state.sessions = [];
		const current = state.sessions[state.sessions.length - 1];
		if (current && !current.endedAt) {
			current.endedAt = Date.now();
			current.topicsCovered = topicsCovered;
		}
		await this.saveLearnerState(state);
	}

	// Prompt Evolutions
	async savePromptEvolution(promptName: string, run: { bestScore: number; bestPrompt: string; report: string }): Promise<PromptEvolutionResult> {
		const result: PromptEvolutionResult = {
			id: this.generateId(),
			promptName,
			createdAt: Date.now(),
			bestScore: run.bestScore,
			bestPrompt: run.bestPrompt,
			report: run.report,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.PROMPT_EVOLUTIONS, result);
		return result;
	}

	async getPromptEvolutions(promptName?: string): Promise<PromptEvolutionResult[]> {
		if (promptName) {
			return this.getByIndex<PromptEvolutionResult>(STORES.PROMPT_EVOLUTIONS, "promptName", promptName);
		}
		return this.getAll<PromptEvolutionResult>(STORES.PROMPT_EVOLUTIONS);
	}

	// Improvements
	async saveImprovementAttempt(attempt: {
		proposalId: string;
		baselineScore: number;
		afterScore: number | null;
		scoreDelta: number | null;
		accepted: boolean;
		targets: string;
		hypothesis: string;
	}): Promise<ImprovementAttemptRecord> {
		const record: ImprovementAttemptRecord = {
			id: this.generateId(),
			createdAt: Date.now(),
			...attempt,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.IMPROVEMENTS, record);

		const archive = await this.getImprovementArchive();
		archive.attempts.push({
			proposal: {
				id: attempt.proposalId,
				timestamp: new Date().toISOString(),
				targets: [],
				hypothesis: attempt.hypothesis,
				baselineScore: attempt.baselineScore,
				status: attempt.accepted ? "accepted" : "rejected",
			},
			baselineScore: attempt.baselineScore,
			afterScore: attempt.afterScore,
			scoreDelta: attempt.scoreDelta,
			accepted: attempt.accepted,
			completedAt: new Date().toISOString(),
		});
		if (attempt.accepted) {
			archive.totalAccepted += 1;
			archive.cumulativeImprovement += attempt.scoreDelta ?? 0;
		} else {
			archive.totalRejected += 1;
		}
		await this.saveImprovementArchive(archive);

		return record;
	}

	async getImprovementAttempts(): Promise<ImprovementAttemptRecord[]> {
		return this.getAll<ImprovementAttemptRecord>(STORES.IMPROVEMENTS);
	}

	async getImprovementArchive(): Promise<{
		attempts: Array<{
			proposal: { id: string; timestamp: string; targets: unknown[]; hypothesis: string; baselineScore: number; status: string };
			baselineScore: number;
			afterScore: number | null;
			scoreDelta: number | null;
			accepted: boolean;
			completedAt: string | null;
		}>;
		totalAccepted: number;
		totalRejected: number;
		cumulativeImprovement: number;
	}> {
		const attempts = await this.getImprovementAttempts();
		const archive = {
			attempts: attempts.map((a) => ({
				proposal: {
					id: a.proposalId,
					timestamp: new Date(a.createdAt).toISOString(),
					targets: a.targets.split(",").map((t) => ({ area: t.trim() })),
					hypothesis: a.hypothesis,
					baselineScore: a.baselineScore,
					status: a.accepted ? "accepted" : "rejected",
				},
				baselineScore: a.baselineScore,
				afterScore: a.afterScore,
				scoreDelta: a.scoreDelta,
				accepted: a.accepted,
				completedAt: new Date(a.createdAt).toISOString(),
			})),
			totalAccepted: attempts.filter((a) => a.accepted).length,
			totalRejected: attempts.filter((a) => !a.accepted).length,
			cumulativeImprovement: attempts.filter((a) => a.accepted).reduce((sum, a) => sum + (a.scoreDelta ?? 0), 0),
		};
		return archive;
	}

	async saveImprovementArchive(archive: {
		totalAccepted: number;
		totalRejected: number;
		cumulativeImprovement: number;
		attempts: unknown[];
	}): Promise<void> {
		const store = await this.getStore(STORES.LEARNER_STATE, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put({ id: "improvement-archive", ...archive });
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	// Flashcard Decks (SM-2 spaced repetition)
	async saveDeck(deck: Omit<FlashcardDeck, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: number }): Promise<FlashcardDeck> {
		const now = Date.now();
		const record: FlashcardDeck = {
			id: deck.id ?? this.generateId(),
			topic: deck.topic,
			slug: deck.slug,
			title: deck.title,
				description: deck.description,
				anki: deck.anki,
			cards: deck.cards,
			createdAt: deck.createdAt ?? now,
			updatedAt: now,
			sessionId: deck.sessionId ?? this.currentSessionId ?? undefined,
		};
		await this.put(STORES.DECKS, record);
		return record;
	}

	async getDecks(topic?: string): Promise<FlashcardDeck[]> {
		if (topic) {
			return this.getByTopic<FlashcardDeck>(STORES.DECKS, topic);
		}
		return this.getAll<FlashcardDeck>(STORES.DECKS);
	}

	async getDeck(id: string): Promise<FlashcardDeck | null> {
		const decks = await this.getDecks();
		return decks.find((d) => d.id === id) ?? null;
	}

	async getDeckBySlug(slug: string): Promise<FlashcardDeck | null> {
		const decks = await this.getDecks();
		return decks.find((d) => d.slug === slug) ?? null;
	}

	async updateDeckCardSrs(deckId: string, cardId: string, srs: FlashcardSrsState, updatedAt: number = Date.now()): Promise<FlashcardDeck | null> {
		const deck = await this.getDeck(deckId);
		if (!deck) return null;
		let changed = false;
		const cards = deck.cards.map((card) => {
			if (card.id !== cardId) return card;
			changed = true;
			return { ...card, srs, updatedAt };
		});
		if (!changed) return deck;
		const updated: FlashcardDeck = { ...deck, cards, updatedAt };
		await this.put(STORES.DECKS, updated);
		return updated;
	}

	async deleteDeck(id: string): Promise<void> {
		await this.deleteById(STORES.DECKS, id);
	}

	async recordCardReview(review: Omit<CardReviewRecord, "id" | "createdAt"> & { id?: string; createdAt?: number }): Promise<CardReviewRecord> {
		const record: CardReviewRecord = {
			id: review.id ?? this.generateId(),
			deckId: review.deckId,
			cardId: review.cardId,
			topic: review.topic,
			slug: review.slug,
			rating: review.rating,
			appliedIntervalDays: review.appliedIntervalDays,
			easeAfter: review.easeAfter,
			previousIntervalDays: review.previousIntervalDays,
			isLapse: review.isLapse,
			createdAt: review.createdAt ?? Date.now(),
			sessionId: review.sessionId ?? this.currentSessionId ?? undefined,
		};
		await this.put(STORES.CARD_REVIEWS, record);
		await this.refreshDerivedLearnerProfile();
		return record;
	}

	async getCardReviews(topic?: string): Promise<CardReviewRecord[]> {
		if (topic) {
			return this.getByTopic<CardReviewRecord>(STORES.CARD_REVIEWS, topic);
		}
		return this.getAll<CardReviewRecord>(STORES.CARD_REVIEWS);
	}

	async recordQuestionCheck(check: Omit<QuestionCheckRecord, "id" | "createdAt"> & { id?: string; createdAt?: number }): Promise<QuestionCheckRecord> {
		const record: QuestionCheckRecord = {
			id: check.id ?? this.generateId(),
			topic: check.topic,
			question: check.question,
			answer: check.answer,
			score: typeof check.score === "number" ? Math.max(0, Math.min(1, check.score)) : undefined,
			grading: check.grading,
			createdAt: check.createdAt ?? Date.now(),
			sessionId: check.sessionId ?? this.currentSessionId ?? undefined,
		};
		await this.put(STORES.QUESTION_CHECKS, record);
		await this.refreshDerivedLearnerProfile();
		return record;
	}

	async getQuestionChecks(topic?: string): Promise<QuestionCheckRecord[]> {
		if (topic) return this.getByTopic<QuestionCheckRecord>(STORES.QUESTION_CHECKS, topic);
		return this.getAll<QuestionCheckRecord>(STORES.QUESTION_CHECKS);
	}

	async gradeQuestionCheck(id: string, grade: { score: number; misconception?: string }): Promise<QuestionCheckRecord | null> {
		const checks = await this.getQuestionChecks();
		const current = checks.find((check) => check.id === id);
		if (!current) return null;
		const updated: QuestionCheckRecord = {
			...current,
			score: Math.max(0, Math.min(1, grade.score)),
			grading: "model",
			misconception: grade.misconception?.trim() || undefined,
		};
		await this.put(STORES.QUESTION_CHECKS, updated);
		await this.refreshDerivedLearnerProfile();
		return updated;
	}

	// List all artifacts
	async listArtifacts(): Promise<Array<{ id: string; label: string; type: string; createdAt: number }>> {
		const [plans, maps, animations, benchmarks, evolutions, promptEvos, improvements, decks] = await Promise.all([
			this.getLessonPlans(),
			this.getLessonMaps(),
			this.getAnimations(),
			this.getBenchmarks(),
			this.getEvolutions(),
			this.getPromptEvolutions(),
			this.getImprovementAttempts(),
			this.getDecks(),
		]);

		return [
			...plans.map((p) => ({ id: p.id, label: `Plan: ${p.topic}`, type: "plan", createdAt: p.createdAt })),
			...maps.map((m) => ({ id: m.id, label: `Map: ${m.topic}`, type: "map", createdAt: m.createdAt })),
			...animations.map((a) => ({ id: a.id, label: `Animation: ${a.topic}`, type: "animation", createdAt: a.createdAt })),
			...decks.map((d) => ({ id: d.id, label: `Deck: ${d.title} (${d.cards.length} cards)`, type: "deck", createdAt: d.updatedAt })),
			...benchmarks.map((b) => ({
				id: b.id,
				label: `Benchmark: ${b.topic || "general"} (${b.score.toFixed(2)})`,
				type: "benchmark",
				createdAt: b.createdAt,
			})),
			...evolutions.map((e) => ({
				id: e.id,
				label: `Evolution: ${e.topic || "general"} (${e.bestScore.toFixed(2)})`,
				type: "evolution",
				createdAt: e.createdAt,
			})),
			...promptEvos.map((pe) => ({
				id: pe.id,
				label: `Prompt Evo: ${pe.promptName} (${pe.bestScore.toFixed(2)})`,
				type: "prompt-evolution",
				createdAt: pe.createdAt,
			})),
			...improvements.map((imp) => ({
				id: imp.id,
				label: `Improve: ${imp.accepted ? "✓" : "✗"} ${imp.proposalId} (Δ${(imp.scoreDelta ?? 0) >= 0 ? "+" : ""}${(imp.scoreDelta ?? 0).toFixed(2)})`,
				type: "improvement",
				createdAt: imp.createdAt,
			})),
		].sort((a, b) => b.createdAt - a.createdAt);
	}
}

function browserMessageText(message: { content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") return item;
				if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
					return (item as { text: string }).text;
				}
				return "";
			})
			.filter(Boolean)
			.join(" ")
			.trim();
	}
	return "";
}

// Default policy for browser
export const DEFAULT_BROWSER_POLICY = `# Keating Hyperteacher Policy

## Teaching Approach
- Diagnose before teaching
- Guide with questions, not lectures
- Encourage reconstruction over memorization
- Test knowledge transfer to new contexts
- Preserve learner voice and articulation

## Response Style
- Be patient and encouraging
- Celebrate genuine understanding
- Gently redirect rote responses
- Adapt to learner pace
`;
