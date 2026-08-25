import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createReviewRecord,
	type ReviewGenerationCandidate,
	type ReviewModelPool,
	type ReviewArtifactSnapshot,
	type TrajectoryAnnotation,
	type TrajectoryReview,
} from "./trajectory-review";

const DEFAULT_DB_NAME = "keating-trajectory-review";
const DB_VERSION = 2;

const STORES = {
	REVIEWS: "reviews",
	ANNOTATIONS: "annotations",
	MODEL_POOLS: "model-pools",
	CANDIDATES: "candidates",
	ARTIFACT_VERSIONS: "artifact-versions",
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

export interface TrajectoryReviewSnapshot {
	schemaVersion: typeof TRAJECTORY_REVIEW_SCHEMA_VERSION;
	review: TrajectoryReview;
	annotations: TrajectoryAnnotation[];
	candidates: ReviewGenerationCandidate[];
	modelPools: ReviewModelPool[];
	artifacts: ReviewArtifactSnapshot[];
}

export interface TrajectoryReviewStoreOptions {
	databaseName?: string;
	indexedDB?: IDBFactory;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Review storage request failed."));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("Review storage transaction failed."));
		transaction.onabort = () => reject(transaction.error ?? new Error("Review storage transaction was cancelled."));
	});
}

function byUpdatedAt<T extends { updatedAt: number }>(records: T[]): T[] {
	return records.sort((left, right) => left.updatedAt - right.updatedAt);
}

export class TrajectoryReviewStore {
	private readonly databaseName: string;
	private readonly indexedDBFactory: IDBFactory;
	private databasePromise: Promise<IDBDatabase> | null = null;

	constructor(options: TrajectoryReviewStoreOptions = {}) {
		const factory = options.indexedDB ?? globalThis.indexedDB;
		if (!factory) throw new Error("This browser does not provide IndexedDB review storage.");
		this.databaseName = options.databaseName ?? DEFAULT_DB_NAME;
		this.indexedDBFactory = factory;
	}

	async init(): Promise<void> {
		await this.database();
	}

	close(): void {
		void this.databasePromise?.then((database) => database.close());
		this.databasePromise = null;
	}

	async getOrCreateReview(sessionId: string, now = Date.now()): Promise<TrajectoryReview> {
		const id = `review:${sessionId}`;
		const existing = await this.get<TrajectoryReview>(STORES.REVIEWS, id);
		if (existing) return existing;
		const review = createReviewRecord(sessionId, now);
		await this.put(STORES.REVIEWS, review);
		return review;
	}

	async getReviewForSession(sessionId: string): Promise<TrajectoryReview | null> {
		return await this.get<TrajectoryReview>(STORES.REVIEWS, `review:${sessionId}`) ?? null;
	}

	async saveReview(review: TrajectoryReview, now = Date.now()): Promise<TrajectoryReview> {
		const database = await this.database();
		const transaction = database.transaction(STORES.REVIEWS, "readwrite");
		const done = transactionDone(transaction);
		const store = transaction.objectStore(STORES.REVIEWS);
		const stored = await requestResult(store.get(review.id)) as TrajectoryReview | undefined;
		const next = {
			...review,
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			selectedCandidateIds: { ...stored?.selectedCandidateIds, ...review.selectedCandidateIds },
			updatedAt: now,
		};
		store.put(next);
		await done;
		this.notify(review.sessionId);
		return next;
	}

	async listReviews(): Promise<TrajectoryReview[]> {
		return byUpdatedAt(await this.getAll<TrajectoryReview>(STORES.REVIEWS)).reverse();
	}

	async saveAnnotation(annotation: TrajectoryAnnotation, now = Date.now()): Promise<TrajectoryAnnotation> {
		const next = { ...annotation, schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION, updatedAt: now };
		await this.put(STORES.ANNOTATIONS, next);
		this.notify(annotation.sessionId);
		return next;
	}

	async listAnnotations(reviewId: string): Promise<TrajectoryAnnotation[]> {
		return byUpdatedAt(await this.getAllByIndex<TrajectoryAnnotation>(STORES.ANNOTATIONS, "reviewId", reviewId));
	}

	async deleteAnnotation(id: string, sessionId?: string): Promise<void> {
		await this.delete(STORES.ANNOTATIONS, id);
		this.notify(sessionId);
	}

	async saveArtifactVersion(snapshot: ReviewArtifactSnapshot): Promise<ReviewArtifactSnapshot> {
		await this.put(STORES.ARTIFACT_VERSIONS, snapshot);
		this.notify(snapshot.sessionId);
		return snapshot;
	}

	async listArtifactVersions(reviewId: string): Promise<ReviewArtifactSnapshot[]> {
		const records = await this.getAllByIndex<ReviewArtifactSnapshot>(STORES.ARTIFACT_VERSIONS, "reviewId", reviewId);
		return records.sort((left, right) => left.capturedAt - right.capturedAt);
	}

	async saveModelPool(pool: ReviewModelPool, now = Date.now()): Promise<ReviewModelPool> {
		const candidateCount = Math.max(1, Math.min(8, Math.floor(pool.candidateCount)));
		const next = {
			...pool,
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			candidateCount,
			temperature: Math.max(0, Math.min(2, pool.temperature)),
			maxTokens: Math.max(64, Math.min(65_536, Math.floor(pool.maxTokens))),
			updatedAt: now,
		};
		await this.put(STORES.MODEL_POOLS, next);
		this.notify();
		return next;
	}

	async listModelPools(): Promise<ReviewModelPool[]> {
		return byUpdatedAt(await this.getAll<ReviewModelPool>(STORES.MODEL_POOLS));
	}

	async deleteModelPool(id: string): Promise<void> {
		const database = await this.database();
		const transaction = database.transaction([STORES.MODEL_POOLS, STORES.CANDIDATES], "readwrite");
		const done = transactionDone(transaction);
		const candidates = await requestResult(transaction.objectStore(STORES.CANDIDATES).getAll()) as ReviewGenerationCandidate[];
		if (candidates.some((candidate) => candidate.poolId === id)) {
			transaction.abort();
			await done.catch(() => undefined);
			throw new Error("Model pools with generated candidates are retained for provenance.");
		}
		transaction.objectStore(STORES.MODEL_POOLS).delete(id);
		await done;
		this.notify();
	}

	async saveCandidate(candidate: ReviewGenerationCandidate, now = Date.now()): Promise<ReviewGenerationCandidate> {
		const database = await this.database();
		const transaction = database.transaction(STORES.CANDIDATES, "readwrite");
		const done = transactionDone(transaction);
		const store = transaction.objectStore(STORES.CANDIDATES);
		const stored = await requestResult(store.get(candidate.id)) as ReviewGenerationCandidate | undefined;
		const next = {
			...candidate,
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			preferred: stored?.preferred ?? candidate.preferred,
			updatedAt: now,
		};
		store.put(next);
		await done;
		this.notify(candidate.sessionId);
		return next;
	}

	async listCandidates(reviewId: string, targetKey?: string): Promise<ReviewGenerationCandidate[]> {
		const records = await this.getAllByIndex<ReviewGenerationCandidate>(STORES.CANDIDATES, "reviewId", reviewId);
		return byUpdatedAt(targetKey ? records.filter((record) => record.targetKey === targetKey) : records);
	}

	async chooseCandidate(review: TrajectoryReview, candidateId: string, now = Date.now()): Promise<{
		review: TrajectoryReview;
		candidates: ReviewGenerationCandidate[];
	}> {
		const database = await this.database();
		const transaction = database.transaction([STORES.REVIEWS, STORES.CANDIDATES], "readwrite");
		const done = transactionDone(transaction);
		const [storedReview, candidates] = await Promise.all([
			requestResult(transaction.objectStore(STORES.REVIEWS).get(review.id)),
			requestResult(transaction.objectStore(STORES.CANDIDATES).index("reviewId").getAll(review.id)),
		]) as [TrajectoryReview | undefined, ReviewGenerationCandidate[]];
		const chosen = candidates.find((candidate) => candidate.id === candidateId);
		if (!chosen || chosen.state !== "completed" || !chosen.content?.trim()) {
			transaction.abort();
			await done.catch(() => undefined);
			throw new Error("Only a completed candidate can be chosen.");
		}
		const nextReview: TrajectoryReview = {
			...(storedReview ?? review),
			selectedCandidateIds: { ...(storedReview ?? review).selectedCandidateIds, [chosen.targetKey]: chosen.id },
			updatedAt: now,
		};
		transaction.objectStore(STORES.REVIEWS).put(nextReview);
		for (const candidate of candidates) {
			if (candidate.targetKey !== chosen.targetKey) continue;
			transaction.objectStore(STORES.CANDIDATES).put({
				...candidate,
				preferred: candidate.id === chosen.id,
				updatedAt: now,
			});
		}
		await done;
		this.notify(review.sessionId);
		return {
			review: nextReview,
			candidates: candidates.map((candidate) => candidate.targetKey === chosen.targetKey
				? { ...candidate, preferred: candidate.id === chosen.id, updatedAt: now }
				: candidate),
		};
	}

	async exportSnapshot(reviewId: string): Promise<TrajectoryReviewSnapshot> {
		const review = await this.get<TrajectoryReview>(STORES.REVIEWS, reviewId);
		if (!review) throw new Error("Review not found.");
		const [annotations, candidates, pools, artifacts] = await Promise.all([
			this.listAnnotations(reviewId),
			this.listCandidates(reviewId),
			this.listModelPools(),
			this.listArtifactVersions(reviewId),
		]);
		const poolIds = new Set(candidates.map((candidate) => candidate.poolId));
		return {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			review,
			annotations,
			candidates,
			modelPools: pools.filter((pool) => poolIds.has(pool.id)),
			artifacts,
		};
	}

	private notify(sessionId?: string): void {
		if (typeof window === "undefined") return;
		window.dispatchEvent(new CustomEvent("keating:trajectory-review-changed", { detail: { sessionId } }));
	}

	private database(): Promise<IDBDatabase> {
		if (this.databasePromise) return this.databasePromise;
		this.databasePromise = new Promise((resolve, reject) => {
			const request = this.indexedDBFactory.open(this.databaseName, DB_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(STORES.REVIEWS)) {
					const store = database.createObjectStore(STORES.REVIEWS, { keyPath: "id" });
					store.createIndex("sessionId", "sessionId", { unique: true });
					store.createIndex("updatedAt", "updatedAt");
				}
				if (!database.objectStoreNames.contains(STORES.ANNOTATIONS)) {
					const store = database.createObjectStore(STORES.ANNOTATIONS, { keyPath: "id" });
					store.createIndex("reviewId", "reviewId");
					store.createIndex("sessionId", "sessionId");
					store.createIndex("targetKey", "targetKey");
					store.createIndex("updatedAt", "updatedAt");
				}
				if (!database.objectStoreNames.contains(STORES.MODEL_POOLS)) {
					const store = database.createObjectStore(STORES.MODEL_POOLS, { keyPath: "id" });
					store.createIndex("updatedAt", "updatedAt");
				}
				if (!database.objectStoreNames.contains(STORES.CANDIDATES)) {
					const store = database.createObjectStore(STORES.CANDIDATES, { keyPath: "id" });
					store.createIndex("reviewId", "reviewId");
					store.createIndex("sessionId", "sessionId");
					store.createIndex("targetKey", "targetKey");
					store.createIndex("updatedAt", "updatedAt");
				}
				if (!database.objectStoreNames.contains(STORES.ARTIFACT_VERSIONS)) {
					const store = database.createObjectStore(STORES.ARTIFACT_VERSIONS, { keyPath: "id" });
					store.createIndex("reviewId", "reviewId");
					store.createIndex("sessionId", "sessionId");
					store.createIndex("capturedAt", "capturedAt");
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => {
				this.databasePromise = null;
				reject(request.error ?? new Error("Review storage could not be opened."));
			};
			request.onblocked = () => {
				this.databasePromise = null;
				reject(new Error("Review storage upgrade is blocked by another Keating tab."));
			};
		});
		return this.databasePromise;
	}

	private async get<T>(storeName: StoreName, id: string): Promise<T | null> {
		const database = await this.database();
		const transaction = database.transaction(storeName, "readonly");
		const done = transactionDone(transaction);
		const result = await requestResult(transaction.objectStore(storeName).get(id));
		await done;
		return (result as T | undefined) ?? null;
	}

	private async getAll<T>(storeName: StoreName): Promise<T[]> {
		const database = await this.database();
		const transaction = database.transaction(storeName, "readonly");
		const done = transactionDone(transaction);
		const result = await requestResult(transaction.objectStore(storeName).getAll());
		await done;
		return result as T[];
	}

	private async getAllByIndex<T>(storeName: StoreName, indexName: string, value: IDBValidKey): Promise<T[]> {
		const database = await this.database();
		const transaction = database.transaction(storeName, "readonly");
		const done = transactionDone(transaction);
		const result = await requestResult(transaction.objectStore(storeName).index(indexName).getAll(value));
		await done;
		return result as T[];
	}

	private async put<T>(storeName: StoreName, value: T): Promise<void> {
		const database = await this.database();
		const transaction = database.transaction(storeName, "readwrite");
		const done = transactionDone(transaction);
		transaction.objectStore(storeName).put(value);
		await done;
	}

	private async delete(storeName: StoreName, id: string): Promise<void> {
		const database = await this.database();
		const transaction = database.transaction(storeName, "readwrite");
		const done = transactionDone(transaction);
		transaction.objectStore(storeName).delete(id);
		await done;
	}
}

let sharedStore: TrajectoryReviewStore | null = null;

export function trajectoryReviewStore(): TrajectoryReviewStore {
	sharedStore ??= new TrajectoryReviewStore();
	return sharedStore;
}
