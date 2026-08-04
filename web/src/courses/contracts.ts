import { z } from "zod";

const idSchema = z
	.string()
	.min(2)
	.max(96)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, dashes, or underscores");
const isoDateSchema = z.string().datetime({ offset: true });
const shortTextSchema = z.string().trim().min(1).max(240);
const bodyTextSchema = z.string().max(120_000);
const httpUrlSchema = z.string().url().max(4_096).refine((value) => {
	const protocol = new URL(value).protocol;
	return protocol === "https:" || protocol === "http:";
}, "Course links must use HTTP or HTTPS");

export const courseRoleSchema = z.enum(["owner", "teacher", "student", "peer"]);
export type CourseRole = z.infer<typeof courseRoleSchema>;

export const teacherAccessSchema = z.enum(["private", "requested", "full"]);
export type TeacherAccess = z.infer<typeof teacherAccessSchema>;

export const courseMaterialSchema = z.object({
	id: idSchema,
	kind: z.enum(["document", "link", "note", "anki"]),
	title: shortTextSchema,
	description: z.string().trim().max(2_000).optional(),
	url: httpUrlSchema.optional(),
	storageKey: z.string().max(512).optional(),
	fileName: z.string().trim().max(255).optional(),
	mimeType: z.string().trim().max(160).optional(),
	sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(),
	createdAt: isoDateSchema,
	createdBy: z.string().min(1).max(256),
});
export type CourseMaterial = z.infer<typeof courseMaterialSchema>;

export const courseCardSchema = z.object({
	id: idSchema,
	front: z.string().trim().min(1).max(10_000),
	back: z.string().trim().min(1).max(20_000),
	tags: z.array(z.string().trim().min(1).max(64)).max(24).default([]),
	lessonId: idSchema.optional(),
	updatedAt: isoDateSchema,
	updatedBy: z.string().min(1).max(256),
});
export type CourseCard = z.infer<typeof courseCardSchema>;

export const courseExerciseSchema = z.object({
	id: idSchema,
	prompt: z.string().trim().min(1).max(30_000),
	placeholder: z.string().trim().max(240).optional(),
	rubric: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
});
export type CourseExercise = z.infer<typeof courseExerciseSchema>;

export const courseLessonSchema = z.object({
	id: idSchema,
	title: shortTextSchema,
	summary: z.string().trim().max(2_000).default(""),
	estimatedMinutes: z.number().int().positive().max(1_440).optional(),
	objectives: z.array(z.string().trim().min(1).max(1_000)).max(16).default([]),
	reading: bodyTextSchema.default(""),
	exercise: courseExerciseSchema.optional(),
	materialIds: z.array(idSchema).max(64).default([]),
	cardIds: z.array(idSchema).max(500).default([]),
});
export type CourseLesson = z.infer<typeof courseLessonSchema>;

export const courseModuleSchema = z.object({
	id: idSchema,
	title: shortTextSchema,
	description: z.string().trim().max(2_000).default(""),
	lessons: z.array(courseLessonSchema).max(64).default([]),
});
export type CourseModule = z.infer<typeof courseModuleSchema>;

export const courseProgressSchema = z.object({
	activeLessonId: idSchema.optional(),
	completedLessonIds: z.array(idSchema).max(2_000).default([]),
	lastActiveAt: isoDateSchema,
});
export type CourseProgress = z.infer<typeof courseProgressSchema>;

export const courseMemberSchema = z.object({
	accountId: z.string().min(1).max(256),
	displayName: z.string().trim().min(1).max(120),
	role: courseRoleSchema,
	teacherAccess: teacherAccessSchema.default("private"),
	joinedAt: isoDateSchema,
	progress: courseProgressSchema,
});
export type CourseMember = z.infer<typeof courseMemberSchema>;

export const courseSharedNoteSchema = z.object({
	id: idSchema,
	lessonId: idSchema,
	title: z.string().trim().min(1).max(160),
	text: bodyTextSchema,
	version: z.number().int().nonnegative(),
	updatedAt: isoDateSchema,
	updatedBy: z.string().min(1).max(256),
});
export type CourseSharedNote = z.infer<typeof courseSharedNoteSchema>;

export const courseSubmissionSchema = z.object({
	id: idSchema,
	lessonId: idSchema,
	exerciseId: idSchema,
	accountId: z.string().min(1).max(256),
	answer: bodyTextSchema,
	sharedWithPeers: z.boolean().default(false),
	version: z.number().int().positive(),
	updatedAt: isoDateSchema,
	review: z
		.object({
			status: z.enum(["needs-review", "reviewed"]),
			feedback: z.string().max(30_000).default(""),
			reviewerAccountId: z.string().min(1).max(256),
			updatedAt: isoDateSchema,
		})
		.optional(),
});
export type CourseSubmission = z.infer<typeof courseSubmissionSchema>;

export const courseCommentSchema = z.object({
	id: idSchema,
	lessonId: idSchema,
	accountId: z.string().min(1).max(256),
	body: z.string().trim().min(1).max(12_000),
	createdAt: isoDateSchema,
});
export type CourseComment = z.infer<typeof courseCommentSchema>;

export const courseActivitySchema = z.object({
	id: idSchema,
	type: z.enum([
		"course-created",
		"lesson-completed",
		"note-updated",
		"submission-saved",
		"submission-reviewed",
		"comment-added",
		"card-updated",
		"material-added",
		"teacher-access-requested",
		"teacher-access-changed",
		"member-joined",
		"member-role-changed",
	]),
	accountId: z.string().min(1).max(256),
	message: z.string().trim().min(1).max(500),
	lessonId: idSchema.optional(),
	createdAt: isoDateSchema,
});
export type CourseActivity = z.infer<typeof courseActivitySchema>;

export const courseSettingsSchema = z.object({
	teacherAccessPolicy: z.enum(["request", "required-on-enrollment"]).default("request"),
	allowPeerDeckEdits: z.boolean().default(true),
	allowPeerComments: z.boolean().default(true),
});
export type CourseSettings = z.infer<typeof courseSettingsSchema>;

export const courseSchema = z.object({
	schemaVersion: z.literal(1),
	id: idSchema,
	title: shortTextSchema,
	description: z.string().trim().max(4_000).default(""),
	outcomes: z.array(z.string().trim().min(1).max(1_000)).max(24).default([]),
	ownerAccountId: z.string().min(1).max(256),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema,
	revision: z.number().int().nonnegative(),
	modules: z.array(courseModuleSchema).max(48).default([]),
	materials: z.array(courseMaterialSchema).max(500).default([]),
	cards: z.array(courseCardSchema).max(10_000).default([]),
	members: z.array(courseMemberSchema).min(1).max(5_000),
	sharedNotes: z.array(courseSharedNoteSchema).max(2_000).default([]),
	submissions: z.array(courseSubmissionSchema).max(50_000).default([]),
	comments: z.array(courseCommentSchema).max(50_000).default([]),
	activity: z.array(courseActivitySchema).max(5_000).default([]),
	settings: courseSettingsSchema,
});
export type Course = z.infer<typeof courseSchema>;

export const courseCreateInputSchema = z.object({
	title: shortTextSchema,
	description: z.string().trim().max(4_000).default(""),
	outcomes: z.array(z.string().trim().min(1).max(1_000)).max(24).default([]),
	modules: z.array(courseModuleSchema).max(48).default([]),
	settings: courseSettingsSchema.partial().optional(),
});
export type CourseCreateInput = z.infer<typeof courseCreateInputSchema>;

export const courseInviteSchema = z.object({
	id: idSchema,
	courseId: idSchema,
	role: z.enum(["teacher", "student", "peer"]),
	createdBy: z.string().min(1).max(256),
	createdAt: isoDateSchema,
	expiresAt: isoDateSchema,
	maxUses: z.number().int().positive().max(5_000),
	uses: z.number().int().nonnegative(),
	tokenHash: z.string().length(64),
});
export type CourseInvite = z.infer<typeof courseInviteSchema>;

const operationBaseSchema = z.object({
	id: idSchema,
	courseId: idSchema,
	baseRevision: z.number().int().nonnegative(),
});

export const courseOperationSchema = z.discriminatedUnion("type", [
	operationBaseSchema.extend({
		type: z.literal("course.update"),
		patch: z.object({
			title: shortTextSchema.optional(),
			description: z.string().trim().max(4_000).optional(),
			outcomes: z.array(z.string().trim().min(1).max(1_000)).max(24).optional(),
		}),
	}),
	operationBaseSchema.extend({
		type: z.literal("lesson.update"),
		moduleId: idSchema,
		lesson: courseLessonSchema,
	}),
	operationBaseSchema.extend({
		type: z.literal("lesson.complete"),
		lessonId: idSchema,
		completed: z.boolean(),
	}),
	operationBaseSchema.extend({
		type: z.literal("shared-note.update"),
		noteId: idSchema,
		lessonId: idSchema,
		title: z.string().trim().min(1).max(160),
		text: bodyTextSchema,
		baseVersion: z.number().int().nonnegative(),
	}),
	operationBaseSchema.extend({
		type: z.literal("submission.save"),
		submissionId: idSchema,
		lessonId: idSchema,
		exerciseId: idSchema,
		answer: bodyTextSchema,
		sharedWithPeers: z.boolean().default(false),
	}),
	operationBaseSchema.extend({
		type: z.literal("submission.review"),
		submissionId: idSchema,
		status: z.enum(["needs-review", "reviewed"]),
		feedback: z.string().max(30_000).default(""),
	}),
	operationBaseSchema.extend({
		type: z.literal("comment.add"),
		commentId: idSchema,
		lessonId: idSchema,
		body: z.string().trim().min(1).max(12_000),
	}),
	operationBaseSchema.extend({
		type: z.literal("card.upsert"),
		card: courseCardSchema.omit({ updatedAt: true, updatedBy: true }),
	}),
	operationBaseSchema.extend({
		type: z.literal("material.add"),
		material: courseMaterialSchema.omit({ createdAt: true, createdBy: true }),
	}),
	operationBaseSchema.extend({
		type: z.literal("teacher-access.request"),
		memberAccountId: z.string().min(1).max(256),
	}),
	operationBaseSchema.extend({
		type: z.literal("teacher-access.respond"),
		approve: z.boolean(),
	}),
	operationBaseSchema.extend({
		type: z.literal("member.role.update"),
		memberAccountId: z.string().min(1).max(256),
		role: z.enum(["teacher", "student", "peer"]),
	}),
]);
export type CourseOperation = z.infer<typeof courseOperationSchema>;

export interface CoursePermissions {
	canEditCourse: boolean;
	canInvite: boolean;
	canReview: boolean;
	canEditDeck: boolean;
	canRequestTeacherAccess: boolean;
}

export interface CourseNetworkInfo {
	mode: "pear-gateway";
	status: "connected" | "reconnecting" | "offline";
	peerCount: number;
	/** Read-only Hypercore public key for installed Pear clients. */
	publicKey?: string;
}

export interface CourseViewerSnapshot {
	course: Course;
	viewer: CourseMember;
	permissions: CoursePermissions;
	network?: CourseNetworkInfo;
}

export interface CourseListItem {
	id: string;
	title: string;
	description: string;
	role: CourseRole;
	memberCount: number;
	lessonCount: number;
	completedLessons: number;
	updatedAt: string;
}

export type CourseRealtimeMessage =
	| { type: "snapshot"; snapshot: CourseViewerSnapshot }
	| { type: "course.updated"; courseId: string; revision: number }
	| { type: "presence"; courseId: string; accountIds: string[] }
	| { type: "gateway.status"; status: "connected" | "reconnecting" | "offline" }
	| { type: "error"; message: string; code?: string };

export function allCourseLessons(course: Pick<Course, "modules">): CourseLesson[] {
	return course.modules.flatMap((module) => module.lessons);
}

export function courseCompletionPercent(course: Course, member: CourseMember): number {
	const lessonCount = allCourseLessons(course).length;
	if (lessonCount === 0) return 0;
	const knownLessonIds = new Set(allCourseLessons(course).map((lesson) => lesson.id));
	const completed = new Set(
		member.progress.completedLessonIds.filter((lessonId) => knownLessonIds.has(lessonId)),
	).size;
	return Math.round((completed / lessonCount) * 100);
}
