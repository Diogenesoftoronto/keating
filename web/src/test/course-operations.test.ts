import { describe, expect, test } from "bun:test";
import type { Course, CourseOperation } from "../courses/contracts";
import {
	applyCourseOperation,
	CourseAuthorizationError,
	CourseConflictError,
	projectCourseForViewer,
} from "../courses/operations";
import { projectCourseForPear } from "../../server/utils/course-pear-gateway";
import { courseDevAccountId } from "../../server/utils/course-session";

const NOW = "2026-08-03T16:00:00.000Z";

function courseFixture(): Course {
	return {
		schemaVersion: 1,
		id: "course_causal",
		title: "Causal Inference",
		description: "Work from potential outcomes to identification.",
		outcomes: ["Distinguish intervention from observation"],
		ownerAccountId: "teacher_1",
		createdAt: NOW,
		updatedAt: NOW,
		revision: 4,
		modules: [
			{
				id: "module_1",
				title: "Counterfactuals",
				description: "",
				lessons: [
					{
						id: "lesson_1",
						title: "Correlation to intervention",
						summary: "",
						objectives: [],
						reading: "Correlation observes; causation intervenes.",
						materialIds: [],
						cardIds: [],
						exercise: {
							id: "exercise_1",
							prompt: "Give two non-causal explanations.",
							rubric: [],
						},
					},
				],
			},
		],
		materials: [],
		cards: [],
		members: [
			{
				accountId: "teacher_1",
				displayName: "Professor Keating",
				role: "owner",
				teacherAccess: "full",
				joinedAt: NOW,
				progress: { completedLessonIds: [], lastActiveAt: NOW },
			},
			{
				accountId: "student_1",
				displayName: "Maya Patel",
				role: "student",
				teacherAccess: "private",
				joinedAt: NOW,
				progress: { completedLessonIds: [], lastActiveAt: NOW },
			},
		],
		sharedNotes: [],
		submissions: [],
		comments: [],
		activity: [],
		settings: {
			teacherAccessPolicy: "request",
			allowPeerDeckEdits: true,
			allowPeerComments: true,
		},
	};
}

function operation<T extends CourseOperation>(value: T): T {
	return value;
}

describe("course operations", () => {
	test("development course auth is impossible in production", () => {
		expect(courseDevAccountId({ NODE_ENV: "production", KEATING_COURSES_DEV_ACCOUNT_ID: "demo" })).toBeNull();
		expect(courseDevAccountId({ NODE_ENV: "development", KEATING_COURSES_DEV_ACCOUNT_ID: "demo" })).toBe("demo");
	});
	test("learners update only their own progress", () => {
		const next = applyCourseOperation(
			courseFixture(),
			"student_1",
			operation({
				id: "op_complete",
				courseId: "course_causal",
				baseRevision: 4,
				type: "lesson.complete",
				lessonId: "lesson_1",
				completed: true,
			}),
			NOW,
		);

		expect(next.members.find((member) => member.accountId === "student_1")?.progress.completedLessonIds).toEqual([
			"lesson_1",
		]);
		expect(next.members.find((member) => member.accountId === "teacher_1")?.progress.completedLessonIds).toEqual([]);
		expect(next.revision).toBe(5);
		expect(next.activity[0]?.id).toBe("op_complete");
	});

	test("teacher access is one request and one learner approval", () => {
		const requested = applyCourseOperation(
			courseFixture(),
			"teacher_1",
			operation({
				id: "op_request",
				courseId: "course_causal",
				baseRevision: 4,
				type: "teacher-access.request",
				memberAccountId: "student_1",
			}),
			NOW,
		);
		expect(requested.members[1]?.teacherAccess).toBe("requested");

		const approved = applyCourseOperation(
			requested,
			"student_1",
			operation({
				id: "op_approve",
				courseId: "course_causal",
				baseRevision: 5,
				type: "teacher-access.respond",
				approve: true,
			}),
			NOW,
		);
		expect(approved.members[1]?.teacherAccess).toBe("full");
	});

	test("teachers cannot review private learner work", () => {
		let course = courseFixture();
		course = applyCourseOperation(
			course,
			"student_1",
			operation({
				id: "op_submit",
				courseId: "course_causal",
				baseRevision: 4,
				type: "submission.save",
				submissionId: "submission_1",
				lessonId: "lesson_1",
				exerciseId: "exercise_1",
				answer: "A common cause or selection bias.",
				sharedWithPeers: false,
			}),
			NOW,
		);

		expect(projectCourseForViewer(course, "teacher_1").course.submissions).toHaveLength(0);
		expect(() =>
			applyCourseOperation(
				course,
				"teacher_1",
				operation({
					id: "op_review",
					courseId: "course_causal",
					baseRevision: 5,
					type: "submission.review",
					submissionId: "submission_1",
					status: "reviewed",
					feedback: "Good distinction.",
				}),
				NOW,
			),
		).toThrow(CourseAuthorizationError);
	});

	test("viewer projections honor learner consent without leaking private state to peers", () => {
		const course = courseFixture();
		course.members[1]!.teacherAccess = "requested";
		course.members[1]!.joinedAt = "2026-08-02T10:00:00.000Z";
		course.members[1]!.progress = {
			activeLessonId: "lesson_1",
			completedLessonIds: ["lesson_1"],
			lastActiveAt: "2026-08-03T15:45:00.000Z",
		};
		course.members.push({
			accountId: "peer_1",
			displayName: "Study Partner",
			role: "peer",
			teacherAccess: "private",
			joinedAt: "2026-08-03T12:00:00.000Z",
			progress: { completedLessonIds: [], lastActiveAt: "2026-08-03T15:30:00.000Z" },
		});
		course.activity.push({
			id: "activity_student",
			type: "lesson-completed",
			accountId: "student_1",
			message: "Completed a lesson",
			lessonId: "lesson_1",
			createdAt: "2026-08-03T15:45:00.000Z",
		});

		const teacherView = projectCourseForViewer(course, "teacher_1");
		const requestedLearner = teacherView.course.members.find((member) => member.accountId === "student_1")!;
		expect(requestedLearner.teacherAccess).toBe("requested");
		expect(requestedLearner.progress.completedLessonIds).toEqual([]);
		expect(requestedLearner.progress.lastActiveAt).toBe(course.createdAt);
		expect(requestedLearner.joinedAt).toBe(course.createdAt);
		expect(teacherView.course.activity).toHaveLength(0);

		const selfView = projectCourseForViewer(course, "student_1");
		expect(selfView.viewer.teacherAccess).toBe("requested");
		expect(selfView.course.members.find((member) => member.accountId === "student_1")?.progress.completedLessonIds).toEqual([
			"lesson_1",
		]);
		expect(selfView.course.activity.map((item) => item.id)).toEqual(["activity_student"]);

		course.members[1]!.teacherAccess = "full";
		const consentedTeacherView = projectCourseForViewer(course, "teacher_1");
		expect(
			consentedTeacherView.course.members.find((member) => member.accountId === "student_1")?.progress.completedLessonIds,
		).toEqual(["lesson_1"]);
		expect(consentedTeacherView.course.activity.map((item) => item.id)).toEqual(["activity_student"]);

		const peerView = projectCourseForViewer(course, "peer_1");
		const peerVisibleLearner = peerView.course.members.find((member) => member.accountId === "student_1")!;
		expect(peerVisibleLearner).toMatchObject({
			accountId: "student_1",
			displayName: "Maya Patel",
			role: "student",
			teacherAccess: "private",
		});
		expect(peerVisibleLearner.progress.completedLessonIds).toEqual([]);
		expect(peerVisibleLearner.progress.lastActiveAt).toBe(course.createdAt);
		expect(peerVisibleLearner.joinedAt).toBe(course.createdAt);
		expect(peerView.course.activity).toHaveLength(0);
	});

	test("shared-note writes reject stale versions", () => {
		const course = courseFixture();
		course.sharedNotes.push({
			id: "note_1",
			lessonId: "lesson_1",
			title: "Shared notes",
			text: "Current text",
			version: 3,
			updatedAt: NOW,
			updatedBy: "student_1",
		});

		expect(() =>
			applyCourseOperation(
				course,
				"student_1",
				operation({
					id: "op_note",
					courseId: "course_causal",
					baseRevision: 4,
					type: "shared-note.update",
					noteId: "note_1",
					lessonId: "lesson_1",
					title: "Shared notes",
					text: "Stale text",
					baseVersion: 2,
				}),
				NOW,
			),
		).toThrow(CourseConflictError);
	});

	test("students cannot edit the course definition", () => {
		expect(() =>
			applyCourseOperation(
				courseFixture(),
				"student_1",
				operation({
					id: "op_course_update",
					courseId: "course_causal",
					baseRevision: 4,
					type: "course.update",
					patch: { title: "Taken over" },
				}),
				NOW,
			),
		).toThrow(CourseAuthorizationError);
	});

	test("Pear replication keeps shared room data but strips all private account state", () => {
		const course = courseFixture();
		course.members[1]!.teacherAccess = "full";
		course.members[1]!.joinedAt = "2026-08-02T10:00:00.000Z";
		course.members[1]!.progress = {
			activeLessonId: "lesson_1",
			completedLessonIds: ["lesson_1"],
			lastActiveAt: "2026-08-03T15:45:00.000Z",
		};
		course.activity.push({
			id: "activity_student",
			type: "lesson-completed",
			accountId: "student_1",
			message: "Completed a lesson",
			lessonId: "lesson_1",
			createdAt: "2026-08-03T15:45:00.000Z",
		});
		course.materials.push({
			id: "material_1",
			kind: "link",
			title: "Public reading",
			url: "https://example.com/reading",
			storageKey: "private/material-storage-key",
			createdAt: NOW,
			createdBy: "material_author_secret",
		});
		course.cards.push({
			id: "card_1",
			front: "What is exchangeability?",
			back: "Treatment groups have comparable potential outcomes.",
			tags: ["causal-inference"],
			lessonId: "lesson_1",
			updatedAt: NOW,
			updatedBy: "card_author_secret",
		});
		course.sharedNotes.push({
			id: "note_public",
			lessonId: "lesson_1",
			title: "Shared synthesis",
			text: "Interventions differ from observations.",
			version: 2,
			updatedAt: NOW,
			updatedBy: "note_author_secret",
		});
		course.comments.push({
			id: "comment_private",
			lessonId: "lesson_1",
			accountId: "comment_author_secret",
			body: "Private course comment",
			createdAt: NOW,
		});
		course.submissions.push(
			{
				id: "submission_private",
				lessonId: "lesson_1",
				exerciseId: "exercise_1",
				accountId: "student_1",
				answer: "Private answer",
				sharedWithPeers: false,
				version: 1,
				updatedAt: NOW,
			},
			{
				id: "submission_shared",
				lessonId: "lesson_1",
				exerciseId: "exercise_1",
				accountId: "student_1",
				answer: "Shared answer",
				sharedWithPeers: true,
				version: 1,
				updatedAt: NOW,
				review: {
					status: "reviewed",
					feedback: "Private teacher feedback",
					reviewerAccountId: "reviewer_secret",
					updatedAt: NOW,
				},
			},
		);

		const replica = projectCourseForPear(course);
		const keys = (value: object) => Object.keys(value).sort();
		expect(keys(replica)).toEqual(
			[
				"schemaVersion",
				"id",
				"title",
				"description",
				"outcomes",
				"createdAt",
				"updatedAt",
				"revision",
				"modules",
				"materials",
				"cards",
				"sharedNotes",
				"submissions",
			].sort(),
		);
		expect(keys(replica.modules[0]!)).toEqual(["description", "id", "lessons", "title"]);
		expect(keys(replica.modules[0]!.lessons[0]!)).toEqual([
			"cardIds",
			"exercise",
			"id",
			"materialIds",
			"objectives",
			"reading",
			"summary",
			"title",
		]);
		expect(keys(replica.modules[0]!.lessons[0]!.exercise!)).toEqual(["id", "prompt", "rubric"]);
		expect(keys(replica.materials[0]!)).toEqual(["id", "kind", "title", "url"]);
		expect(keys(replica.cards[0]!)).toEqual(["back", "front", "id", "lessonId", "tags"]);
		expect(keys(replica.sharedNotes[0]!)).toEqual([
			"id",
			"lessonId",
			"text",
			"title",
			"updatedAt",
			"version",
		]);
		expect(replica.submissions.map((submission) => submission.id)).toEqual(["submission_shared"]);
		expect(keys(replica.submissions[0]!)).toEqual(["answer", "exerciseId", "id", "lessonId"]);

		const serialized = JSON.stringify(replica);
		for (const secret of [
			"teacher_1",
			"student_1",
			"Professor Keating",
			"Maya Patel",
			"material_author_secret",
			"card_author_secret",
			"note_author_secret",
			"comment_author_secret",
			"reviewer_secret",
			"Private answer",
			"Private course comment",
			"Private teacher feedback",
		]) {
			expect(serialized).not.toContain(secret);
		}
		for (const prohibitedKey of [
			"ownerAccountId",
			"members",
			"accountId",
			"displayName",
			"role",
			"createdBy",
			"updatedBy",
			"reviewerAccountId",
			"comments",
			"activity",
			"settings",
			"teacherAccess",
			"joinedAt",
			"progress",
			"completedLessonIds",
			"lastActiveAt",
			"sharedWithPeers",
			"review",
			"feedback",
			"storageKey",
		]) {
			expect(serialized).not.toContain(`\"${prohibitedKey}\"`);
		}
	});
});
