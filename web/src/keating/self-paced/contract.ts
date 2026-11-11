/**
 * Self-paced courses: a bounded plan toward one outcome, worked through over
 * several sittings, with materials prepared in the background.
 *
 * Rules this contract enforces:
 * - Every activity states its learning purpose, the part of the source it
 *   draws on, and the condition that completes it.
 * - "The learner saw it" (exposure), "did it with help" (assisted), "did it
 *   alone" (independent), "still knew it later" (recall) and "used it somewhere
 *   new" (transfer) are different kinds of evidence and never substitute for
 *   one another.
 * - Every change to the plan is logged with who made it.
 */

export const ACTIVITY_KINDS = ["learn", "practice", "recall", "transfer"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const EVIDENCE_KINDS = ["exposure", "assisted", "independent", "recall", "transfer"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
	exposure: "Read",
	assisted: "Answered with help",
	independent: "Answered alone",
	recall: "Recalled later",
	transfer: "Applied to a new case",
};

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
	learn: "Learn",
	practice: "Practice",
	recall: "Recall",
	transfer: "Apply",
};

export type Verdict = "met" | "partly" | "not-met";

export const COURSE_LIMITS = {
	title: 120,
	promise: 400,
	prerequisite: 200,
	prerequisites: 8,
	activities: 12,
	minActivities: 3,
	activityTitle: 120,
	purpose: 400,
	sourceLabel: 200,
	excerpt: 24_000,
	changes: 100,
	answer: 4_000,
	/** Hours a recall activity waits after the work it revisits. */
	recallDelayHours: 12,
	defaultTokenBudget: 60_000,
} as const;

export interface ActivitySource {
	/** The part of the source this activity draws on, e.g. "Section 3.2.1, Scaled Dot-Product Attention". */
	label: string;
}

export interface CourseActivity {
	id: string;
	title: string;
	kind: ActivityKind;
	/** Why this activity exists: what the learner should be able to do after it. */
	purpose: string;
	source: ActivitySource;
	/** Activities that must be complete (or skipped) first. Always earlier in the list. */
	dependsOn: string[];
	/** The learner said they already know this. Visible in the plan; never counted as evidence. */
	skipped?: { at: number };
}

export type ChangeAuthor = "learner" | "agent";

export interface PlanChange {
	at: number;
	by: ChangeAuthor;
	summary: string;
}

export interface CourseSource {
	kind: "paper" | "document" | "topic";
	title: string;
	url?: string;
	/** Text the learner supplied. When absent, materials come from the model's own knowledge and say so. */
	excerpt?: string;
}

export type CourseStatus = "draft" | "active" | "completed" | "archived";

export interface SelfPacedCourse {
	schemaVersion: 1;
	id: string;
	title: string;
	/** What the learner will be able to do at the end. */
	promise: string;
	prerequisites: string[];
	source: CourseSource;
	activities: CourseActivity[];
	/** A draft has not been approved by the learner; nothing is prepared for it. */
	status: CourseStatus;
	revision: number;
	changes: PlanChange[];
	/** Limit on model tokens spent preparing this course without asking again. */
	budget: { maxTokens: number; usedTokens: number };
	createdAt: number;
	updatedAt: number;
}

export interface CourseEvidence {
	id: string;
	courseId: string;
	activityId: string;
	kind: EvidenceKind;
	at: number;
	/** Present for answered questions. */
	questionId?: string;
	answer?: string;
	verdict?: Verdict;
	feedback?: string;
	/** What help was in view when the answer was given. */
	help?: { hintShown: boolean; materialVisible: boolean };
}

export interface MaterialQuestion {
	id: string;
	prompt: string;
	/** What a good answer contains. Shown to the learner only after they answer. */
	rubric: string;
	hint: string;
}

export interface ActivityMaterial {
	/** `${courseId}:${activityId}`: one material per activity, so a retried job replaces instead of duplicating. */
	id: string;
	courseId: string;
	activityId: string;
	/** The activity content this was prepared for; a mismatch means the plan changed and it is outdated. */
	fingerprint: string;
	explanation: string;
	questions: MaterialQuestion[];
	/** Whether the model had the learner's source text, or worked from what it knows about the source. */
	groundedIn: "excerpt" | "model-knowledge";
	model: string;
	tokens: number;
	preparedAt: number;
}

export class CourseValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CourseValidationError";
	}
}

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

function text(value: unknown, max: number, label: string, required = true): string {
	if (typeof value !== "string" || !value.trim()) {
		if (required) throw new CourseValidationError(`${label} is missing.`);
		return "";
	}
	return value.replace(CONTROL, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(value: unknown, fallback: string): string {
	const base = typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) : "";
	return base || fallback;
}

/** The completion condition for each kind of activity, in the learner's words. */
export function completionCondition(kind: ActivityKind): { evidence: EvidenceKind; needsVerdict: boolean; description: string } {
	switch (kind) {
		case "learn": return { evidence: "exposure", needsVerdict: false, description: "Read the explanation and mark it read." };
		case "practice": return { evidence: "independent", needsVerdict: true, description: "Answer one question correctly without the hint or the explanation in view." };
		case "recall": return { evidence: "recall", needsVerdict: true, description: `Answer correctly from memory, at least ${COURSE_LIMITS.recallDelayHours} hours after the work it revisits.` };
		case "transfer": return { evidence: "transfer", needsVerdict: true, description: "Solve a new problem correctly without help." };
	}
}

/**
 * Which kind of evidence an answer is. Help in view always makes it
 * "assisted", whatever the activity: an answer given with the hint open is not
 * recall and not transfer.
 */
export function evidenceKindFor(kind: ActivityKind, help: { hintShown: boolean; materialVisible: boolean }): EvidenceKind {
	if (kind === "learn") return "exposure";
	if (help.hintShown || help.materialVisible) return "assisted";
	return kind === "practice" ? "independent" : kind;
}

/**
 * Builds the activity list from untrusted input (a model's draft or an edited
 * plan). Order is meaningful: an activity may depend only on earlier ones, so
 * the plan cannot contain a cycle.
 */
export function validateActivities(input: unknown): CourseActivity[] {
	if (!Array.isArray(input)) throw new CourseValidationError("The plan has no activities.");
	if (input.length < COURSE_LIMITS.minActivities) throw new CourseValidationError(`A course needs at least ${COURSE_LIMITS.minActivities} activities.`);
	if (input.length > COURSE_LIMITS.activities) throw new CourseValidationError(`Keep a course to ${COURSE_LIMITS.activities} activities or fewer.`);
	const seen = new Set<string>();
	const activities = input.map((value, index): CourseActivity => {
		if (!value || typeof value !== "object") throw new CourseValidationError(`Activity ${index + 1} could not be read.`);
		const raw = value as Record<string, unknown>;
		const kind = ACTIVITY_KINDS.find((name) => name === raw.kind);
		if (!kind) throw new CourseValidationError(`Activity ${index + 1} has an unknown kind.`);
		const title = text(raw.title, COURSE_LIMITS.activityTitle, `The title of activity ${index + 1}`);
		let id = slug(raw.id, `activity-${index + 1}`);
		while (seen.has(id)) id = `${id}-${index + 1}`;
		const source = raw.source && typeof raw.source === "object" ? raw.source as Record<string, unknown> : {};
		const dependsOn = Array.isArray(raw.dependsOn)
			? [...new Set(raw.dependsOn.map((dependency) => slug(dependency, "")).filter((dependency) => seen.has(dependency)))]
			: [];
		const skipped = raw.skipped && typeof raw.skipped === "object" && typeof (raw.skipped as { at?: unknown }).at === "number"
			? { at: (raw.skipped as { at: number }).at } : undefined;
		seen.add(id);
		return {
			id, title, kind,
			purpose: text(raw.purpose, COURSE_LIMITS.purpose, `The purpose of “${title}”`),
			source: { label: text(source.label, COURSE_LIMITS.sourceLabel, `The source for “${title}”`) },
			dependsOn,
			...(skipped ? { skipped } : {}),
		};
	});
	const last = activities[activities.length - 1]!;
	if (last.kind !== "transfer") throw new CourseValidationError("A course must end with an Apply activity: the task that shows the outcome was reached.");
	if (last.skipped) throw new CourseValidationError("The final task cannot be skipped: it is what completes the course.");
	for (const activity of activities) {
		if (activity.kind === "recall" && !activity.dependsOn.length) {
			throw new CourseValidationError(`“${activity.title}” is a Recall activity, so it must say which earlier activity it revisits.`);
		}
	}
	return activities;
}

export interface CourseDraftInput {
	title?: unknown;
	promise?: unknown;
	prerequisites?: unknown;
	activities?: unknown;
}

export function validateCourseDraft(input: CourseDraftInput): Pick<SelfPacedCourse, "title" | "promise" | "prerequisites" | "activities"> {
	const prerequisites = Array.isArray(input.prerequisites)
		? input.prerequisites.map((value) => text(value, COURSE_LIMITS.prerequisite, "A prerequisite", false)).filter(Boolean).slice(0, COURSE_LIMITS.prerequisites)
		: [];
	return {
		title: text(input.title, COURSE_LIMITS.title, "The course title"),
		promise: text(input.promise, COURSE_LIMITS.promise, "What the course promises"),
		prerequisites,
		activities: validateActivities(input.activities),
	};
}

export function validateCourseSource(input: { kind?: unknown; title?: unknown; url?: unknown; excerpt?: unknown }): CourseSource {
	const kind = (["paper", "document", "topic"] as const).find((name) => name === input.kind) ?? "topic";
	const title = text(input.title, 200, "The source title");
	let url: string | undefined;
	if (typeof input.url === "string" && input.url.trim()) {
		try {
			const parsed = new URL(input.url.trim());
			if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("scheme");
			url = parsed.toString();
		} catch {
			throw new CourseValidationError("The source link must be a full web address.");
		}
	}
	const excerpt = typeof input.excerpt === "string" && input.excerpt.trim()
		? input.excerpt.replace(CONTROL, "").trim().slice(0, COURSE_LIMITS.excerpt) : undefined;
	return { kind, title, ...(url ? { url } : {}), ...(excerpt ? { excerpt } : {}) };
}

export function createCourse(
	draft: CourseDraftInput,
	source: CourseSource,
	options: { id: string; now: number; by: ChangeAuthor; status?: CourseStatus; maxTokens?: number },
): SelfPacedCourse {
	return {
		schemaVersion: 1,
		id: options.id,
		...validateCourseDraft(draft),
		source,
		status: options.status ?? "draft",
		revision: 1,
		changes: [{ at: options.now, by: options.by, summary: options.by === "agent" ? "Plan drafted by Keating." : "Plan created." }],
		budget: { maxTokens: options.maxTokens ?? COURSE_LIMITS.defaultTokenBudget, usedTokens: 0 },
		createdAt: options.now,
		updatedAt: options.now,
	};
}

/** Applies a change and records it. The log keeps the most recent entries. */
export function reviseCourse(
	course: SelfPacedCourse,
	patch: Partial<Pick<SelfPacedCourse, "title" | "promise" | "prerequisites" | "activities" | "status" | "budget">>,
	change: { by: ChangeAuthor; summary: string; now: number },
): SelfPacedCourse {
	const next: SelfPacedCourse = { ...course, ...patch };
	if (patch.activities) next.activities = validateActivities(patch.activities);
	if (patch.title !== undefined) next.title = text(patch.title, COURSE_LIMITS.title, "The course title");
	if (patch.promise !== undefined) next.promise = text(patch.promise, COURSE_LIMITS.promise, "What the course promises");
	return {
		...next,
		revision: course.revision + 1,
		changes: [...course.changes, { at: change.now, by: change.by, summary: change.summary.slice(0, 300) }].slice(-COURSE_LIMITS.changes),
		updatedAt: change.now,
	};
}

/** Identifies the activity content a material was prepared for. */
export function activityFingerprint(course: SelfPacedCourse, activity: CourseActivity): string {
	const input = JSON.stringify([course.source.title, course.source.url ?? "", course.source.excerpt?.length ?? 0, course.promise, activity.kind, activity.title, activity.purpose, activity.source.label]);
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

export type ActivityState = "done" | "skipped" | "available" | "waiting" | "locked";

export interface ActivityProgress {
	activity: CourseActivity;
	state: ActivityState;
	/** Evidence recorded for this activity, by kind. */
	evidence: Record<EvidenceKind, number>;
	/** For a recall activity that is waiting: when it opens. */
	availableAt?: number;
	/** Names of unfinished activities this one waits on. */
	blockedBy: string[];
}

function completes(activity: CourseActivity, evidence: readonly CourseEvidence[]): CourseEvidence | undefined {
	const condition = completionCondition(activity.kind);
	return evidence.find((item) => item.activityId === activity.id && item.kind === condition.evidence && (!condition.needsVerdict || item.verdict === "met"));
}

export function courseProgress(course: SelfPacedCourse, evidence: readonly CourseEvidence[], now: number): ActivityProgress[] {
	const finishedAt = new Map<string, number>();
	const progress: ActivityProgress[] = [];
	for (const activity of course.activities) {
		const own = evidence.filter((item) => item.activityId === activity.id);
		const counts: Record<EvidenceKind, number> = { exposure: 0, assisted: 0, independent: 0, recall: 0, transfer: 0 };
		for (const item of own) counts[item.kind] += 1;
		const completion = completes(activity, evidence);
		const blockedBy = activity.dependsOn.filter((id) => !finishedAt.has(id)).map((id) => course.activities.find((other) => other.id === id)?.title ?? id);
		let state: ActivityState;
		let availableAt: number | undefined;
		if (completion) {
			state = "done";
			finishedAt.set(activity.id, completion.at);
		} else if (activity.skipped) {
			state = "skipped";
			finishedAt.set(activity.id, activity.skipped.at);
		} else if (blockedBy.length) {
			state = "locked";
		} else if (activity.kind === "recall") {
			// Recall means later: the wait starts when the work it revisits was finished.
			const revisited = Math.max(...activity.dependsOn.map((id) => finishedAt.get(id) ?? 0));
			availableAt = revisited + COURSE_LIMITS.recallDelayHours * 3_600_000;
			state = now >= availableAt ? "available" : "waiting";
		} else {
			state = "available";
		}
		progress.push({ activity, state, evidence: counts, blockedBy, ...(availableAt !== undefined && state === "waiting" ? { availableAt } : {}) });
	}
	return progress;
}

export interface CourseSummary {
	done: number;
	skipped: number;
	total: number;
	/** The course is complete only when its final task has transfer evidence. Skips never complete it. */
	complete: boolean;
	next?: ActivityProgress;
	/** When nothing is available now, the soonest a waiting activity opens. */
	nextAvailableAt?: number;
	evidence: Record<EvidenceKind, number>;
}

export function summarizeCourse(progress: readonly ActivityProgress[]): CourseSummary {
	const evidence: Record<EvidenceKind, number> = { exposure: 0, assisted: 0, independent: 0, recall: 0, transfer: 0 };
	for (const item of progress) for (const kind of EVIDENCE_KINDS) evidence[kind] += item.evidence[kind];
	const waiting = progress.filter((item) => item.state === "waiting" && item.availableAt !== undefined).map((item) => item.availableAt!);
	const next = progress.find((item) => item.state === "available");
	return {
		done: progress.filter((item) => item.state === "done").length,
		skipped: progress.filter((item) => item.state === "skipped").length,
		total: progress.length,
		complete: progress.length > 0 && progress[progress.length - 1]!.state === "done",
		...(next ? { next } : {}),
		...(!next && waiting.length ? { nextAvailableAt: Math.min(...waiting) } : {}),
		evidence,
	};
}

/** A plain-text copy of the course and what was done, for the learner to keep. */
export function exportCourseMarkdown(course: SelfPacedCourse, evidence: readonly CourseEvidence[], materials: readonly ActivityMaterial[], now: number): string {
	const progress = courseProgress(course, evidence, now);
	const lines = [
		`# ${course.title}`, "",
		`**You will be able to:** ${course.promise}`, "",
		`**Source:** ${course.source.title}${course.source.url ? ` (${course.source.url})` : ""}`, "",
	];
	if (course.prerequisites.length) lines.push("## Before you start", "", ...course.prerequisites.map((item) => `- ${item}`), "");
	lines.push("## Activities", "");
	for (const item of progress) {
		const { activity } = item;
		const material = materials.find((candidate) => candidate.activityId === activity.id);
		lines.push(
			`### ${ACTIVITY_LABELS[activity.kind]}: ${activity.title}`, "",
			`- Status: ${item.state}`,
			`- Purpose: ${activity.purpose}`,
			`- Source: ${activity.source.label}`,
			`- Completes when: ${completionCondition(activity.kind).description}`, "",
		);
		if (material?.explanation) lines.push(material.explanation, "");
		for (const record of evidence.filter((candidate) => candidate.activityId === activity.id && candidate.answer)) {
			const question = material?.questions.find((candidate) => candidate.id === record.questionId);
			lines.push(
				`**${EVIDENCE_LABELS[record.kind]}** (${new Date(record.at).toISOString().slice(0, 10)}${record.verdict ? `, ${record.verdict}` : ""})`,
				...(question ? [`> ${question.prompt}`] : []), "",
				record.answer!, "",
				...(record.feedback ? [`_Keating's feedback (AI):_ ${record.feedback}`, ""] : []),
			);
		}
	}
	lines.push("## Plan changes", "", ...course.changes.map((change) => `- ${new Date(change.at).toISOString().slice(0, 10)} (${change.by === "agent" ? "Keating" : "you"}): ${change.summary}`), "");
	return lines.join("\n");
}
