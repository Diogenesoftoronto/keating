import type { WebExportSources, WebFineTuneExportOptions, WebFineTuneExportResult } from "./export";
import type { JudgeCheckpoint, JudgeScorerConfig } from "./export-judge";

export interface TrainingExportJob {
	version: 1;
	sources: WebExportSources;
	options: Omit<WebFineTuneExportOptions, "judge">;
	primary: JudgeScorerConfig;
	fallback?: JudgeScorerConfig;
	maxExamples: number | null;
	scoring: boolean;
	bundle: WebFineTuneExportResult;
	updatedAt: number;
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
	return database ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open("keating-training-export", 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore("scores");
			request.result.createObjectStore("jobs");
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => { database = undefined; reject(request.error); };
	});
}

async function read<T>(store: string, key: string): Promise<T | null> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const request = db.transaction(store).objectStore(store).get(key);
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});
}

async function write(store: string, key: string, value: unknown): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(store, "readwrite");
		transaction.objectStore(store).put(value, key);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error ?? new Error("Checkpoint write aborted"));
	});
}

export const trainingScoreCache = {
	get: (key: string) => read<JudgeCheckpoint>("scores", key),
	set: (key: string, value: JudgeCheckpoint) => write("scores", key, value),
};
export const loadTrainingExportJob = () => read<TrainingExportJob>("jobs", "latest");
export const saveTrainingExportJob = (job: TrainingExportJob) => write("jobs", "latest", job);
