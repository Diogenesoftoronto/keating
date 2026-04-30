/**
 * Browser-compatible Keating storage using IndexedDB
 * Replaces Node.js filesystem operations from src/core/
 */

const DB_NAME = "keating-db";
const DB_VERSION = 2;

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
} as const;

export interface LessonPlan {
	id: string;
	topic: string;
	createdAt: number;
	updatedAt: number;
	content: string;
	metadata?: Record<string, unknown>;
}

export interface LessonMap {
	id: string;
	topic: string;
	createdAt: number;
	mmdContent: string;
	svgContent?: string;
}

export interface Animation {
	id: string;
	topic: string;
	createdAt: number;
	storyboard: string;
	scene: string;
	manifest: string;
}

export interface Verification {
	id: string;
	topic: string;
	createdAt: number;
	checklist: string;
	completed: boolean;
}

export interface BenchmarkResult {
	id: string;
	topic?: string;
	createdAt: number;
	score: number;
	trace?: string;
	report: string;
}

export interface EvolutionResult {
	id: string;
	topic?: string;
	createdAt: number;
	bestScore: number;
	policy: string;
	trace?: string;
	report: string;
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
}

export interface LearnerState {
	topicsExplored: string[];
	feedbackHistory: FeedbackEntry[];
	strengths: string[];
	weaknesses: string[];
	lastSessionAt?: number;
	sessionsCount: number;
	sessions: Array<{
		startedAt: number;
		endedAt?: number;
		topicsCovered: string[];
	}>;
}

export interface PromptEvolutionResult {
	id: string;
	promptName: string;
	createdAt: number;
	bestScore: number;
	bestPrompt: string;
	report: string;
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
}

export class KeatingStorage {
	private db: IDBDatabase | null = null;
	private dbPromise: Promise<IDBDatabase> | null = null;

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

	private async put<T>(storeName: string, data: T): Promise<string> {
		const store = await this.getStore(storeName, "readwrite");
		return new Promise((resolve, reject) => {
			const request = store.put(data);
			request.onsuccess = () => resolve(request.result as string);
			request.onerror = () => reject(request.error);
		});
	}

	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
	async saveAnimation(topic: string, storyboard: string, scene: string, manifest: string): Promise<Animation> {
		const animation: Animation = {
			id: this.generateId(),
			topic,
			createdAt: Date.now(),
			storyboard,
			scene,
			manifest,
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
	async recordFeedback(topic: string, signal: "thumbs-up" | "thumbs-down" | "confused"): Promise<FeedbackEntry> {
		const entry: FeedbackEntry = {
			id: this.generateId(),
			topic,
			signal,
			createdAt: Date.now(),
		};
		await this.put(STORES.FEEDBACK, entry);

		// Update learner state
		const state = await this.getLearnerState();
		state.feedbackHistory.push(entry);
		if (!state.topicsExplored.includes(topic)) {
			state.topicsExplored.push(topic);
		}
		state.lastSessionAt = Date.now();
		state.sessionsCount = (state.sessionsCount || 0) + 1;
		await this.saveLearnerState(state);

		return entry;
	}

	async getFeedback(topic?: string): Promise<FeedbackEntry[]> {
		if (topic) {
			return this.getByTopic<FeedbackEntry>(STORES.FEEDBACK, topic);
		}
		return this.getAll<FeedbackEntry>(STORES.FEEDBACK);
	}

	// Learner State
	async getLearnerState(): Promise<LearnerState> {
		const store = await this.getStore(STORES.LEARNER_STATE);
		return new Promise((resolve, reject) => {
			const request = store.get("learner-state");
			request.onsuccess = () => {
				resolve(
					request.result || {
						topicsExplored: [],
						feedbackHistory: [],
						strengths: [],
						weaknesses: [],
						sessionsCount: 0,
						sessions: [],
					}
				);
			};
			request.onerror = () => reject(request.error);
		});
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
		const state = await this.getLearnerState();
		if (!state.sessions) state.sessions = [];
		state.sessions.push({
			startedAt: Date.now(),
			topicsCovered: [],
		});
		state.lastSessionAt = Date.now();
		state.sessionsCount = (state.sessionsCount || 0) + 1;
		await this.saveLearnerState(state);
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
		};
		await this.put(STORES.PROMPT_EVOLUTIONS, result);
		return result;
	}

	async getPromptEvolutions(promptName?: string): Promise<PromptEvolutionResult[]> {
		if (promptName) {
			return this.getByTopic<PromptEvolutionResult>(STORES.PROMPT_EVOLUTIONS, promptName);
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
