import { useStorage } from "nitro/storage";
import { z } from "zod";
import {
	allCourseLessons,
	courseCreateInputSchema,
	courseInviteSchema,
	courseSchema,
	type Course,
	type CourseCreateInput,
	type CourseInvite,
	type CourseListItem,
	type CourseOperation,
	type CourseRole,
	type CourseViewerSnapshot,
} from "../../src/courses/contracts";
import {
	applyCourseOperation,
	permissionsFor,
	projectCourseForViewer,
} from "../../src/courses/operations";

const COURSE_STORAGE = "keating:courses";
const MAX_APPLIED_OPERATIONS = 20_000;

const storedCourseRecordSchema = z.object({
	course: courseSchema,
	appliedOperationIds: z.array(z.string()).max(MAX_APPLIED_OPERATIONS).default([]),
});

interface StoredCourseRecord {
	course: Course;
	appliedOperationIds: string[];
}

interface CourseRepositoryGlobals {
	__keatingCourseLocks?: Map<string, Promise<void>>;
}

const globals = globalThis as typeof globalThis & CourseRepositoryGlobals;
const courseLocks = globals.__keatingCourseLocks ??= new Map<string, Promise<void>>();

function randomId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function randomToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString("base64url");
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Buffer.from(digest).toString("hex");
}

function storage() {
	return useStorage(COURSE_STORAGE);
}

function courseKey(courseId: string): string {
	return `course:${courseId}`;
}

async function accountKey(accountId: string): Promise<string> {
	return `account:${await sha256(accountId)}`;
}

async function withCourseLock<T>(courseId: string, task: () => Promise<T>): Promise<T> {
	const previous = courseLocks.get(courseId) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => gate);
	courseLocks.set(courseId, tail);
	await previous;
	try {
		return await task();
	} finally {
		release();
		if (courseLocks.get(courseId) === tail) courseLocks.delete(courseId);
	}
}

async function loadRecord(courseId: string): Promise<StoredCourseRecord | null> {
	const raw = await storage().getItem(courseKey(courseId));
	if (!raw) return null;
	return storedCourseRecordSchema.parse(raw);
}

async function saveRecord(record: StoredCourseRecord): Promise<void> {
	await storage().setItem(courseKey(record.course.id), record);
}

async function addCourseToAccount(accountId: string, courseId: string): Promise<void> {
	const key = await accountKey(accountId);
	const current = await storage().getItem<string[]>(key);
	const ids = new Set(Array.isArray(current) ? current : []);
	ids.add(courseId);
	await storage().setItem(key, [...ids]);
}

function listItem(course: Course, accountId: string): CourseListItem {
	const member = course.members.find((candidate) => candidate.accountId === accountId);
	if (!member) throw new Error("Course account index is inconsistent.");
	return {
		id: course.id,
		title: course.title,
		description: course.description,
		role: member.role,
		memberCount: course.members.length,
		lessonCount: allCourseLessons(course).length,
		completedLessons: member.progress.completedLessonIds.length,
		updatedAt: course.updatedAt,
	};
}

export async function listCoursesForAccount(accountId: string): Promise<CourseListItem[]> {
	const ids = await storage().getItem<string[]>(await accountKey(accountId));
	if (!Array.isArray(ids)) return [];
	const items = await Promise.all(ids.map(async (courseId) => {
		const record = await loadRecord(courseId);
		if (!record || !record.course.members.some((member) => member.accountId === accountId)) return null;
		return listItem(record.course, accountId);
	}));
	return items
		.filter((item): item is CourseListItem => item !== null)
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createCourse(
	accountId: string,
	displayName: string,
	input: CourseCreateInput,
): Promise<CourseViewerSnapshot> {
	const parsed = courseCreateInputSchema.parse(input);
	const now = new Date().toISOString();
	const courseId = randomId("course");
	const course = courseSchema.parse({
		schemaVersion: 1,
		id: courseId,
		title: parsed.title,
		description: parsed.description,
		outcomes: parsed.outcomes,
		ownerAccountId: accountId,
		createdAt: now,
		updatedAt: now,
		revision: 0,
		modules: parsed.modules,
		materials: [],
		cards: [],
		members: [{
			accountId,
			displayName,
			role: "owner",
			teacherAccess: "full",
			joinedAt: now,
			progress: { completedLessonIds: [], lastActiveAt: now },
		}],
		sharedNotes: [],
		submissions: [],
		comments: [],
		activity: [{
			id: randomId("activity"),
			type: "course-created",
			accountId,
			message: "Created the course",
			createdAt: now,
		}],
		settings: {
			teacherAccessPolicy: parsed.settings?.teacherAccessPolicy ?? "request",
			allowPeerDeckEdits: parsed.settings?.allowPeerDeckEdits ?? true,
			allowPeerComments: parsed.settings?.allowPeerComments ?? true,
		},
	});
	await saveRecord({ course, appliedOperationIds: [] });
	await addCourseToAccount(accountId, courseId);
	return projectCourseForViewer(course, accountId);
}

export async function getCourseForAccount(
	courseId: string,
	accountId: string,
): Promise<CourseViewerSnapshot | null> {
	const record = await loadRecord(courseId);
	if (!record || !record.course.members.some((member) => member.accountId === accountId)) return null;
	return projectCourseForViewer(record.course, accountId);
}

export async function applyStoredCourseOperation(
	accountId: string,
	operation: CourseOperation,
): Promise<{ snapshot: CourseViewerSnapshot; applied: boolean }> {
	return withCourseLock(operation.courseId, async () => {
		const record = await loadRecord(operation.courseId);
		if (!record) return Promise.reject(new Error("Course not found."));
		if (record.appliedOperationIds.includes(operation.id)) {
			return { snapshot: projectCourseForViewer(record.course, accountId), applied: false };
		}
		const course = applyCourseOperation(record.course, accountId, operation);
		const appliedOperationIds = [...record.appliedOperationIds, operation.id].slice(-MAX_APPLIED_OPERATIONS);
		await saveRecord({ course, appliedOperationIds });
		return { snapshot: projectCourseForViewer(course, accountId), applied: true };
	});
}

export interface CreatedCourseInvite {
	invite: Omit<CourseInvite, "tokenHash">;
	token: string;
}

export class CourseEnrollmentConsentRequiredError extends Error {
	readonly code = "course_teacher_access_consent_required";
	constructor() {
		super("This managed course requires full teacher access to current and future course work. Approve that access to enroll.");
	}
}

export async function createCourseInvite(
	courseId: string,
	accountId: string,
	role: Exclude<CourseRole, "owner">,
	expiresInHours = 168,
	maxUses = 25,
): Promise<CreatedCourseInvite> {
	return withCourseLock(courseId, async () => {
		const record = await loadRecord(courseId);
		if (!record) throw new Error("Course not found.");
		const permissions = permissionsFor(record.course, accountId);
		if (!permissions.canInvite) throw new Error("You cannot invite people to this course.");
		const token = randomToken();
		const createdAt = new Date();
		const invite = courseInviteSchema.parse({
			id: randomId("invite"),
			courseId,
			role,
			createdBy: accountId,
			createdAt: createdAt.toISOString(),
			expiresAt: new Date(createdAt.getTime() + expiresInHours * 60 * 60 * 1_000).toISOString(),
			maxUses,
			uses: 0,
			tokenHash: await sha256(token),
		});
		await storage().setItem(`invite:${invite.tokenHash}`, invite);
		const { tokenHash: _tokenHash, ...publicInvite } = invite;
		return { invite: publicInvite, token };
	});
}

export async function joinCourseWithInvite(
	token: string,
	accountId: string,
	displayName: string,
	acceptTeacherAccess = false,
): Promise<CourseViewerSnapshot | null> {
	const tokenHash = await sha256(token);
	const rawInvite = await storage().getItem(`invite:${tokenHash}`);
	if (!rawInvite) return null;
	const invite = courseInviteSchema.parse(rawInvite);
	return withCourseLock(invite.courseId, async () => {
		const freshRaw = await storage().getItem(`invite:${tokenHash}`);
		if (!freshRaw) return null;
		const freshInvite = courseInviteSchema.parse(freshRaw);
		if (freshInvite.uses >= freshInvite.maxUses || Date.parse(freshInvite.expiresAt) <= Date.now()) return null;
		const record = await loadRecord(freshInvite.courseId);
		if (!record) return null;
		const existing = record.course.members.find((member) => member.accountId === accountId);
		if (!existing) {
			const requiresTeacherAccess = freshInvite.role !== "teacher"
				&& record.course.settings.teacherAccessPolicy === "required-on-enrollment";
			if (requiresTeacherAccess && !acceptTeacherAccess) {
				throw new CourseEnrollmentConsentRequiredError();
			}
			const now = new Date().toISOString();
			record.course.members.push({
				accountId,
				displayName,
				role: freshInvite.role,
				teacherAccess: freshInvite.role === "teacher" || requiresTeacherAccess ? "full" : "private",
				joinedAt: now,
				progress: { completedLessonIds: [], lastActiveAt: now },
			});
			record.course.revision += 1;
			record.course.updatedAt = now;
			record.course.activity.unshift({
				id: freshInvite.id,
				type: "member-joined",
				accountId,
				message: "Joined the course",
				createdAt: now,
			});
			await saveRecord(record);
			freshInvite.uses += 1;
			await storage().setItem(`invite:${tokenHash}`, freshInvite);
			await addCourseToAccount(accountId, record.course.id);
		}
		return projectCourseForViewer(record.course, accountId);
	});
}
