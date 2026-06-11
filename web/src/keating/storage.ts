/**
 * Browser-compatible Keating storage using IndexedDB
 * Replaces Node.js filesystem operations from src/core/
 */

import type { LearnerGoal } from "./goals";
import { inferBrowserLearnerTurnSignal } from "./core";

const DB_NAME = "keating-db";
const DB_VERSION = 4;

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
	renderer?: "manim" | "hyperframes";
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
}

export interface LearnerState {
	topicsExplored: string[];
	feedbackHistory: FeedbackEntry[];
	strengths: string[];
	weaknesses: string[];
	lastSessionAt?: number;
	sessionsCount: number;
	sessions: Array<{
		id?: string;
		startedAt: number;
		endedAt?: number;
		topicsCovered: string[];
	}>;
}

export interface QuizResultRecord {
	id: string;
	topic: string;
	createdAt: number;
	score: number;
	weightedScore?: number;
	totalQuestions: number;
	sessionId?: string;
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

			request.onerror = () => reject(request.error);

			request.onsuccess = () => {
				this.db = request.result;
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
			topicsExplored: [],
			feedbackHistory: [],
			strengths: [],
			weaknesses: [],
			sessionsCount: 0,
			sessions: [],
		};
	}

	private normalizeLearnerState(value: unknown): LearnerState {
		const raw = value && typeof value === "object" ? value as Partial<LearnerState> : {};
		return {
			topicsExplored: Array.isArray(raw.topicsExplored) ? raw.topicsExplored.filter((topic): topic is string => typeof topic === "string") : [],
			feedbackHistory: Array.isArray(raw.feedbackHistory) ? raw.feedbackHistory.filter((entry): entry is FeedbackEntry => !!entry && typeof entry === "object") : [],
			strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((item): item is string => typeof item === "string") : [],
			weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.filter((item): item is string => typeof item === "string") : [],
			lastSessionAt: typeof raw.lastSessionAt === "number" ? raw.lastSessionAt : undefined,
			sessionsCount: typeof raw.sessionsCount === "number" ? raw.sessionsCount : 0,
			sessions: Array.isArray(raw.sessions) ? raw.sessions.filter((session): session is LearnerState["sessions"][number] => !!session && typeof session === "object") : [],
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
		};
		if (data.learnerState) {
			const current = await this.getLearnerState();
			const mergedFeedback = [...current.feedbackHistory, ...(data.learnerState.feedbackHistory ?? []), ...(data.feedback ?? [])];
			const byFeedbackId = new Map(mergedFeedback.map((entry) => [entry.id, entry]));
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
				feedbackHistory: [...byFeedbackId.values()],
				strengths: [...new Set([...(current.strengths ?? []), ...(data.learnerState.strengths ?? [])])],
				weaknesses: [...new Set([...(current.weaknesses ?? []), ...(data.learnerState.weaknesses ?? [])])],
				sessions: [...bySessionId.values()],
			});
			await this.saveLearnerState(mergedState);
		} else if (data.feedback?.length) {
			await this.getLearnerState();
		}
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
		renderer: "manim" | "hyperframes" = "manim",
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
	async saveQuizResult(score: number, weightedScore: number | undefined, totalQuestions: number, topic?: string): Promise<QuizResultRecord> {
		const record: QuizResultRecord = {
			id: this.generateId(),
			topic: topic || "general",
			createdAt: Date.now(),
			score,
			weightedScore,
			totalQuestions,
			sessionId: this.currentSessionId ?? undefined,
		};
		await this.put(STORES.QUIZ_RESULTS, record);
		return record;
	}

	async getQuizResults(topic?: string): Promise<QuizResultRecord[]> {
		if (topic) {
			return this.getByTopic<QuizResultRecord>(STORES.QUIZ_RESULTS, topic);
		}
		return this.getAll<QuizResultRecord>(STORES.QUIZ_RESULTS);
	}

	async getTopicQuizStats(topic: string): Promise<{ count: number; avgScore: number; avgWeightedScore: number; topQuartile: number } | null> {
		const results = await this.getQuizResults(topic);
		if (results.length < 5) return null;
		const sorted = [...results].sort((a, b) => b.score - a.score);
		const avgScore = sorted.reduce((s, r) => s + r.score, 0) / sorted.length;
		const avgWeighted = sorted.filter((r) => typeof r.weightedScore === "number").reduce((s, r) => s + (r.weightedScore ?? 0), 0) / sorted.length;
		const qIdx = Math.floor(sorted.length * 0.25);
		const topQuartile = sorted[qIdx]?.score ?? sorted[0]?.score ?? 0;
		return { count: sorted.length, avgScore, avgWeightedScore: avgWeighted, topQuartile };
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
		options: { source?: "explicit" | "turn-analysis"; evidence?: string } = {},
	): Promise<FeedbackEntry> {
		const entry: FeedbackEntry = {
			id: this.generateId(),
			topic,
			signal,
			createdAt: Date.now(),
			source: options.source ?? "explicit",
			evidence: options.evidence,
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
		return merged.state;
	}

	async saveLearnerState(state: LearnerState): Promise<void> {
		const store = await this.getStore(STORES.LEARNER_STATE, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put({ ...state, id: "learner-state" });
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
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

	// List all artifacts
	async listArtifacts(): Promise<Array<{ id: string; label: string; type: string; createdAt: number }>> {
		const [plans, maps, animations, benchmarks, evolutions, promptEvos, improvements] = await Promise.all([
			this.getLessonPlans(),
			this.getLessonMaps(),
			this.getAnimations(),
			this.getBenchmarks(),
			this.getEvolutions(),
			this.getPromptEvolutions(),
			this.getImprovementAttempts(),
		]);

		return [
			...plans.map((p) => ({ id: p.id, label: `Plan: ${p.topic}`, type: "plan", createdAt: p.createdAt })),
			...maps.map((m) => ({ id: m.id, label: `Map: ${m.topic}`, type: "map", createdAt: m.createdAt })),
			...animations.map((a) => ({ id: a.id, label: `Animation: ${a.topic}`, type: "animation", createdAt: a.createdAt })),
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
