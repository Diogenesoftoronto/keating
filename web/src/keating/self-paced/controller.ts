/**
 * The operations a learner performs on a self-paced course. The pages call
 * these; they hold every rule about status, logging and evidence so the UI
 * cannot record something the contract does not allow.
 */
import {
	COURSE_LIMITS,
	CourseValidationError,
	completionCondition,
	courseProgress,
	createCourse,
	evidenceKindFor,
	reviseCourse,
	type ActivityMaterial,
	type CourseDraftInput,
	type CourseEvidence,
	type CourseSource,
	type SelfPacedCourse,
} from "./contract";
import { draftCoursePlan, gradeAnswer, type Complete } from "./agent";
import { enqueueCoursePreparation } from "./jobs";
import type { SelfPacedStore } from "./store";

const newId = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Asks the tutor for a plan and saves it as a draft. Nothing is prepared until the learner approves it. */
export async function proposeCourse(
	store: SelfPacedStore,
	input: { source: CourseSource; goal: string; background: string },
	complete: Complete,
	options: { now?: number; signal?: AbortSignal } = {},
): Promise<SelfPacedCourse> {
	const now = options.now ?? Date.now();
	const { draft, tokens } = await draftCoursePlan(input, complete, { now, signal: options.signal });
	const course = createCourse(draft, input.source, { id: newId("course", now), now, by: "agent" });
	// Drafting the plan is the first spend against the course's budget.
	const saved = { ...course, budget: { ...course.budget, usedTokens: tokens } };
	await store.putCourse(saved);
	return saved;
}

/** The learner approves the plan: the course becomes active and its materials are queued. */
export async function startCourse(store: SelfPacedStore, courseId: string, now = Date.now()): Promise<SelfPacedCourse> {
	const course = await store.getCourse(courseId);
	if (!course) throw new CourseValidationError("That course no longer exists on this device.");
	if (course.status !== "draft") return course;
	const active = reviseCourse(course, { status: "active" }, { by: "learner", summary: "Plan approved. Preparation started.", now });
	await store.putCourse(active);
	await enqueueCoursePreparation(store, active, now);
	return active;
}

/** Any learner edit to the plan. Changed activities get fresh materials; untouched ones keep theirs. */
export async function editCoursePlan(
	store: SelfPacedStore,
	courseId: string,
	patch: Pick<CourseDraftInput, "title" | "promise" | "activities">,
	summary: string,
	now = Date.now(),
): Promise<SelfPacedCourse> {
	const course = await store.getCourse(courseId);
	if (!course) throw new CourseValidationError("That course no longer exists on this device.");
	const next = reviseCourse(course, {
		...(patch.title !== undefined ? { title: patch.title as string } : {}),
		...(patch.promise !== undefined ? { promise: patch.promise as string } : {}),
		...(patch.activities !== undefined ? { activities: patch.activities as SelfPacedCourse["activities"] } : {}),
	}, { by: "learner", summary, now });
	await store.putCourse(next);
	await enqueueCoursePreparation(store, next, now);
	return next;
}

/** "I already know this." Recorded as a skip in the plan, never as evidence of learning. */
export async function setActivitySkipped(store: SelfPacedStore, courseId: string, activityId: string, skipped: boolean, now = Date.now()): Promise<SelfPacedCourse> {
	const course = await store.getCourse(courseId);
	if (!course) throw new CourseValidationError("That course no longer exists on this device.");
	const target = course.activities.find((activity) => activity.id === activityId);
	if (!target) throw new CourseValidationError("That activity is no longer in the plan.");
	const activities = course.activities.map((activity) => {
		if (activity.id !== activityId) return activity;
		const { skipped: _previous, ...rest } = activity;
		return skipped ? { ...rest, skipped: { at: now } } : rest;
	});
	return editCoursePlan(store, courseId, { activities }, skipped ? `Skipped “${target.title}” as already known.` : `Brought back “${target.title}”.`, now);
}

export async function raiseCourseBudget(store: SelfPacedStore, courseId: string, extraTokens: number, now = Date.now()): Promise<SelfPacedCourse> {
	const course = await store.getCourse(courseId);
	if (!course) throw new CourseValidationError("That course no longer exists on this device.");
	const next = reviseCourse(course, { budget: { ...course.budget, maxTokens: course.budget.maxTokens + Math.max(0, Math.round(extraTokens)) } },
		{ by: "learner", summary: `Raised the preparation limit by ${Math.round(extraTokens).toLocaleString()} tokens.`, now });
	await store.putCourse(next);
	return next;
}

/** Marks a Learn activity read. This is exposure, and is recorded as nothing more. */
export async function recordRead(store: SelfPacedStore, courseId: string, activityId: string, now = Date.now()): Promise<CourseEvidence> {
	const evidence: CourseEvidence = { id: newId("ev", now), courseId, activityId, kind: "exposure", at: now };
	await store.addEvidence(evidence);
	await finishIfComplete(store, courseId, now);
	return evidence;
}

/**
 * Saves the learner's answer, then marks it. The answer is stored before the
 * model is called, so a failed or interrupted marking never loses it.
 */
export async function submitAnswer(
	store: SelfPacedStore,
	input: { courseId: string; activityId: string; questionId: string; answer: string; help: { hintShown: boolean; materialVisible: boolean } },
	material: ActivityMaterial,
	complete: Complete,
	options: { now?: number; signal?: AbortSignal } = {},
): Promise<CourseEvidence> {
	const now = options.now ?? Date.now();
	const course = await store.getCourse(input.courseId);
	const activity = course?.activities.find((candidate) => candidate.id === input.activityId);
	const question = material.questions.find((candidate) => candidate.id === input.questionId);
	if (!course || !activity || !question) throw new CourseValidationError("That question is no longer part of this course.");
	const answer = input.answer.trim().slice(0, COURSE_LIMITS.answer);
	if (!answer) throw new CourseValidationError("Write an answer first.");
	const state = courseProgress(course, await store.listEvidence(course.id), now).find((item) => item.activity.id === activity.id)?.state;
	if (state === "locked" || state === "waiting") throw new CourseValidationError("This activity is not open yet.");

	const pending: CourseEvidence = {
		id: newId("ev", now), courseId: course.id, activityId: activity.id,
		kind: evidenceKindFor(activity.kind, input.help), at: now,
		questionId: question.id, answer, help: input.help,
	};
	await store.addEvidence(pending);
	return markAnswer(store, pending, question, complete, options);
}

/** Marks (or re-marks) a saved answer. Used after a marking failure, without asking the learner to retype. */
export async function markAnswer(
	store: SelfPacedStore,
	evidence: CourseEvidence,
	question: ActivityMaterial["questions"][number],
	complete: Complete,
	options: { now?: number; signal?: AbortSignal } = {},
): Promise<CourseEvidence> {
	const now = options.now ?? Date.now();
	const { verdict, feedback, tokens } = await gradeAnswer(question, evidence.answer ?? "", complete, { now, signal: options.signal });
	const marked: CourseEvidence = { ...evidence, verdict, feedback };
	await store.addEvidence(marked);
	const course = await store.getCourse(evidence.courseId);
	if (course) await store.putCourse({ ...course, budget: { ...course.budget, usedTokens: course.budget.usedTokens + tokens } });
	await finishIfComplete(store, evidence.courseId, now);
	return marked;
}

async function finishIfComplete(store: SelfPacedStore, courseId: string, now: number): Promise<void> {
	const course = await store.getCourse(courseId);
	if (!course || course.status !== "active") return;
	const progress = courseProgress(course, await store.listEvidence(courseId), now);
	if (progress.length && progress[progress.length - 1]!.state === "done") {
		await store.putCourse(reviseCourse(course, { status: "completed" }, { by: "learner", summary: "Final task completed.", now }));
	}
}

export { completionCondition };
