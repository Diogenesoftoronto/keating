/**
 * Background preparation for a self-paced course: one job per activity, run
 * while the learner does something else or is away.
 *
 * What "asynchronous" means here: jobs run in the learner's browser whenever
 * Keating is open in any tab, and survive reloads. There is no server worker,
 * so nothing runs while every Keating tab is closed.
 *
 * Guarantees:
 * - One job and one material per activity. The job id is derived from the
 *   course, the activity and the content it was planned for, so starting
 *   preparation twice, or in two tabs, cannot produce duplicates.
 * - Only one tab works a course's queue at a time (a browser lock), and a job
 *   whose material already exists finishes without calling the model, so an
 *   interrupted run never pays twice for the same result.
 * - Spending stops at the course's token budget. Reaching it is a visible
 *   state the learner can lift, never a silent stop.
 */
import { activityFingerprint, type ActivityMaterial, type CourseActivity, type SelfPacedCourse } from "./contract";
import type { SelfPacedStore } from "./store";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface PrepJob {
	/** `${courseId}:${activityId}:${fingerprint}` */
	id: string;
	courseId: string;
	activityId: string;
	fingerprint: string;
	status: JobStatus;
	attempts: number;
	/** Tokens this job spent across all attempts. */
	tokens: number;
	error?: string;
	/** Why a job was cancelled: the learner stopped preparation, or the plan no longer needs it. */
	cancelledBy?: "learner" | "plan";
	/** While running: when the claim lapses if its tab disappears. */
	leaseUntil?: number;
	createdAt: number;
	updatedAt: number;
}

export const JOB_LIMITS = {
	maxAttempts: 3,
	/** Longer than any single preparation call; a lapsed lease means the tab is gone. */
	leaseMs: 120_000,
} as const;

export interface PreparedMaterial {
	explanation: string;
	questions: ActivityMaterial["questions"];
	groundedIn: ActivityMaterial["groundedIn"];
	model: string;
	tokens: number;
}

export type PrepareActivity = (course: SelfPacedCourse, activity: CourseActivity, signal: AbortSignal) => Promise<PreparedMaterial>;

/** A failure that retrying cannot fix (no model connected, sign-in needed). */
export class PrepBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PrepBlockedError";
	}
}

export function jobId(course: SelfPacedCourse, activity: CourseActivity): string {
	return `${course.id}:${activity.id}:${activityFingerprint(course, activity)}`;
}

export function materialId(courseId: string, activityId: string): string {
	return `${courseId}:${activityId}`;
}

/**
 * Queues preparation for every activity that still needs it. Safe to call any
 * number of times: existing jobs and up-to-date materials are left alone.
 * Returns how many jobs were added.
 */
export async function enqueueCoursePreparation(store: SelfPacedStore, course: SelfPacedCourse, now: number, options: { revive?: boolean } = {}): Promise<number> {
	if (course.status !== "active") return 0;
	const [jobs, materials] = await Promise.all([store.listJobs(course.id), store.listMaterials(course.id)]);
	const existing = new Map(jobs.map((job) => [job.id, job]));
	let added = 0;
	for (const activity of course.activities) {
		if (activity.skipped) continue;
		const fingerprint = activityFingerprint(course, activity);
		if (materials.some((material) => material.activityId === activity.id && material.fingerprint === fingerprint)) continue;
		const id = jobId(course, activity);
		const prior = existing.get(id);
		if (prior) {
			// A job the plan dropped (a skipped activity brought back) is wanted again. One the learner
			// stopped stays stopped until they ask for preparation explicitly (`revive`).
			if (prior.status === "cancelled" && (options.revive || prior.cancelledBy !== "learner")) {
				await store.putJob({ ...prior, status: "queued", attempts: 0, error: undefined, cancelledBy: undefined, updatedAt: now });
				added += 1;
			}
			continue;
		}
		// The plan changed under an older job for this activity: it would prepare the wrong thing.
		for (const stale of jobs.filter((job) => job.activityId === activity.id && job.id !== id && (job.status === "queued" || job.status === "failed"))) {
			await store.putJob({ ...stale, status: "cancelled", cancelledBy: "plan", updatedAt: now });
		}
		await store.putJob({ id, courseId: course.id, activityId: activity.id, fingerprint, status: "queued", attempts: 0, tokens: 0, createdAt: now + added, updatedAt: now });
		added += 1;
	}
	return added;
}

export interface QueueState {
	queued: number;
	running: number;
	failed: number;
	done: number;
	/** Unfinished jobs exist but the budget is spent. */
	overBudget: boolean;
	/** A failure the learner has to resolve before preparation can continue. */
	blocked?: string;
}

export function describeQueue(course: SelfPacedCourse, jobs: readonly PrepJob[]): QueueState {
	const current = jobs.filter((job) => course.activities.some((activity) => !activity.skipped && activity.id === job.activityId && job.fingerprint === activityFingerprint(course, activity)));
	const queued = current.filter((job) => job.status === "queued").length;
	const running = current.filter((job) => job.status === "running").length;
	const failed = current.filter((job) => job.status === "failed").length;
	const blocked = current.find((job) => job.status === "failed" && job.attempts >= JOB_LIMITS.maxAttempts)?.error;
	return {
		queued, running, failed,
		done: current.filter((job) => job.status === "succeeded").length,
		overBudget: queued + running > 0 && course.budget.usedTokens >= course.budget.maxTokens,
		...(blocked ? { blocked } : {}),
	};
}

export interface RunOptions {
	store: SelfPacedStore;
	courseId: string;
	prepare: PrepareActivity;
	now?: () => number;
	signal?: AbortSignal;
	/** Runs `work` while holding an exclusive, cross-tab claim on this course's queue. */
	exclusive?: <T>(name: string, work: () => Promise<T>) => Promise<T | undefined>;
}

export type RunOutcome = "idle" | "drained" | "budget" | "blocked" | "cancelled" | "busy";

async function withBrowserLock<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
	const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
	// Without the Locks API there is one tab's worth of protection only: the job lease below.
	if (!locks) return work();
	return locks.request(name, { ifAvailable: true }, async (lock) => lock ? work() : undefined);
}

/**
 * Works the course's queue until it is empty, the budget is reached, a job is
 * blocked, or the caller aborts. Returns why it stopped.
 */
export async function runCoursePreparation(options: RunOptions): Promise<RunOutcome> {
	const { store, courseId, prepare } = options;
	const now = options.now ?? Date.now;
	const exclusive = options.exclusive ?? withBrowserLock;
	const result = await exclusive(`keating-self-paced-prep:${courseId}`, async (): Promise<RunOutcome> => {
		let worked = false;
		for (;;) {
			if (options.signal?.aborted) return "cancelled";
			const course = await store.getCourse(courseId);
			if (!course || course.status !== "active") return worked ? "drained" : "idle";
			const jobs = await store.listJobs(courseId);
			const job = jobs.find((candidate) => candidate.status === "queued"
				|| (candidate.status === "running" && (candidate.leaseUntil ?? 0) < now())
				|| (candidate.status === "failed" && candidate.attempts < JOB_LIMITS.maxAttempts));
			if (!job) return worked ? "drained" : "idle";

			const activity = course.activities.find((candidate) => candidate.id === job.activityId);
			if (!activity || activity.skipped || activityFingerprint(course, activity) !== job.fingerprint) {
				await store.putJob({ ...job, status: "cancelled", cancelledBy: "plan", updatedAt: now(), leaseUntil: undefined });
				continue;
			}

			// A material that already matches means an earlier run finished the work but not the bookkeeping.
			const materials = await store.listMaterials(courseId);
			if (materials.some((material) => material.activityId === activity.id && material.fingerprint === job.fingerprint)) {
				await store.putJob({ ...job, status: "succeeded", updatedAt: now(), leaseUntil: undefined });
				continue;
			}

			if (course.budget.usedTokens >= course.budget.maxTokens) return "budget";

			const running: PrepJob = { ...job, status: "running", attempts: job.attempts + 1, leaseUntil: now() + JOB_LIMITS.leaseMs, updatedAt: now(), error: undefined };
			await store.putJob(running);
			worked = true;
			try {
				const prepared = await prepare(course, activity, options.signal ?? new AbortController().signal);
				const tokens = Math.max(0, Math.round(prepared.tokens));
				// Material first, then the spend and the job: a crash between them re-checks the material and stops.
				await store.putMaterial({
					id: materialId(course.id, activity.id), courseId: course.id, activityId: activity.id, fingerprint: job.fingerprint,
					explanation: prepared.explanation, questions: prepared.questions, groundedIn: prepared.groundedIn,
					model: prepared.model, tokens, preparedAt: now(),
				});
				const latest = await store.getCourse(courseId);
				if (latest) await store.putCourse({ ...latest, budget: { ...latest.budget, usedTokens: latest.budget.usedTokens + tokens } });
				await store.putJob({ ...running, status: "succeeded", tokens: job.tokens + tokens, leaseUntil: undefined, updatedAt: now() });
			} catch (error) {
				if (options.signal?.aborted) {
					// Stopping is not a failed attempt: put the job back as it was.
					await store.putJob({ ...job, status: "queued", leaseUntil: undefined, updatedAt: now() });
					return "cancelled";
				}
				const blocked = error instanceof PrepBlockedError;
				const message = error instanceof Error && error.message ? error.message.slice(0, 300) : "Preparation failed.";
				await store.putJob({
					...running, status: "failed", leaseUntil: undefined, updatedAt: now(), error: message,
					// A blocked job would fail the same way again; stop retrying until the learner acts.
					attempts: blocked ? JOB_LIMITS.maxAttempts : running.attempts,
				});
				if (blocked) return "blocked";
			}
		}
	});
	return result ?? "busy";
}

/** Lets the learner try again after fixing whatever blocked preparation. */
export async function retryFailedJobs(store: SelfPacedStore, courseId: string, now: number): Promise<number> {
	const failed = (await store.listJobs(courseId)).filter((job) => job.status === "failed");
	for (const job of failed) await store.putJob({ ...job, status: "queued", attempts: 0, error: undefined, updatedAt: now });
	return failed.length;
}

/** Stops everything not yet started. A running job finishes or is aborted by its tab. */
export async function cancelQueuedJobs(store: SelfPacedStore, courseId: string, now: number): Promise<number> {
	const pending = (await store.listJobs(courseId)).filter((job) => job.status === "queued" || job.status === "failed");
	for (const job of pending) await store.putJob({ ...job, status: "cancelled", cancelledBy: "learner", updatedAt: now });
	return pending.length;
}
