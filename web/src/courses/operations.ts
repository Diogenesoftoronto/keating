import {
	allCourseLessons,
	type Course,
	type CourseActivity,
	type CourseMember,
	type CourseOperation,
	type CoursePermissions,
	type CourseRole,
	type CourseSubmission,
	type CourseViewerSnapshot,
} from "./contracts";

export class CourseAuthorizationError extends Error {
	readonly code = "course_forbidden";
}

export class CourseConflictError extends Error {
	readonly code = "course_conflict";
	constructor(
		message: string,
		readonly currentRevision: number,
	) {
		super(message);
	}
}

export class CourseNotFoundError extends Error {
	readonly code = "course_not_found";
}

function memberFor(course: Course, accountId: string): CourseMember {
	const member = course.members.find((candidate) => candidate.accountId === accountId);
	if (!member) throw new CourseAuthorizationError("You are not enrolled in this course.");
	return member;
}

function roleCanTeach(role: CourseRole): boolean {
	return role === "owner" || role === "teacher";
}

function roleCanOwn(role: CourseRole): boolean {
	return role === "owner";
}

function assertLesson(course: Course, lessonId: string): void {
	if (!allCourseLessons(course).some((lesson) => lesson.id === lessonId)) {
		throw new CourseNotFoundError("This lesson is no longer part of the course.");
	}
}

function activity(
	id: string,
	type: CourseActivity["type"],
	accountId: string,
	message: string,
	createdAt: string,
	lessonId?: string,
): CourseActivity {
	return {
		// Operation ids are stable across storage replays and Pear replication.
		id,
		type,
		accountId,
		message,
		createdAt,
		...(lessonId ? { lessonId } : {}),
	};
}

function appendActivity(course: Course, item: CourseActivity): void {
	course.activity = [item, ...course.activity].slice(0, 5_000);
}

function operationNeedsCurrentRevision(operation: CourseOperation): boolean {
	return (
		operation.type === "course.update" ||
		operation.type === "lesson.update" ||
		operation.type === "material.add" ||
		operation.type === "member.role.update"
	);
}

export function permissionsFor(course: Course, accountId: string): CoursePermissions {
	const member = memberFor(course, accountId);
	const canTeach = roleCanTeach(member.role);
	return {
		canEditCourse: canTeach,
		canInvite: canTeach,
		canReview: canTeach,
		canEditDeck: canTeach || course.settings.allowPeerDeckEdits,
		canRequestTeacherAccess: canTeach,
	};
}

export function applyCourseOperation(
	current: Course,
	actorAccountId: string,
	operation: CourseOperation,
	now = new Date().toISOString(),
): Course {
	if (operation.courseId !== current.id) {
		throw new CourseNotFoundError("The operation targets a different course.");
	}
	if (operationNeedsCurrentRevision(operation) && operation.baseRevision !== current.revision) {
		throw new CourseConflictError(
			"The course changed while you were editing. Refresh and try again.",
			current.revision,
		);
	}

	const actor = memberFor(current, actorAccountId);
	const next = structuredClone(current);

	switch (operation.type) {
		case "course.update": {
			if (!roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Only course teachers can change course details.");
			}
			Object.assign(next, operation.patch);
			break;
		}
		case "lesson.update": {
			if (!roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Only course teachers can edit lessons.");
			}
			const module = next.modules.find((candidate) => candidate.id === operation.moduleId);
			if (!module) throw new CourseNotFoundError("This module is no longer part of the course.");
			const index = module.lessons.findIndex((lesson) => lesson.id === operation.lesson.id);
			if (index === -1) module.lessons.push(operation.lesson);
			else module.lessons[index] = operation.lesson;
			break;
		}
		case "lesson.complete": {
			assertLesson(next, operation.lessonId);
			const target = next.members.find((member) => member.accountId === actorAccountId)!;
			const completed = new Set(target.progress.completedLessonIds);
			if (operation.completed) completed.add(operation.lessonId);
			else completed.delete(operation.lessonId);
			target.progress.completedLessonIds = [...completed];
			target.progress.activeLessonId = operation.lessonId;
			target.progress.lastActiveAt = now;
			appendActivity(
				next,
				activity(
					operation.id,
					"lesson-completed",
					actorAccountId,
					operation.completed ? "Completed a lesson" : "Reopened a lesson",
					now,
					operation.lessonId,
				),
			);
			break;
		}
		case "shared-note.update": {
			assertLesson(next, operation.lessonId);
			const index = next.sharedNotes.findIndex((note) => note.id === operation.noteId);
			const existing = index === -1 ? null : next.sharedNotes[index];
			if (existing && existing.version !== operation.baseVersion) {
				throw new CourseConflictError(
					"Someone else changed these shared notes. Review their version before saving yours.",
					next.revision,
				);
			}
			const note = {
				id: operation.noteId,
				lessonId: operation.lessonId,
				title: operation.title,
				text: operation.text,
				version: (existing?.version ?? 0) + 1,
				updatedAt: now,
				updatedBy: actorAccountId,
			};
			if (index === -1) next.sharedNotes.push(note);
			else next.sharedNotes[index] = note;
			appendActivity(
				next,
				activity(operation.id, "note-updated", actorAccountId, "Updated shared notes", now, operation.lessonId),
			);
			break;
		}
		case "submission.save": {
			assertLesson(next, operation.lessonId);
			const index = next.submissions.findIndex(
				(submission) =>
					submission.id === operation.submissionId && submission.accountId === actorAccountId,
			);
			const existing = index === -1 ? null : next.submissions[index];
			const submission: CourseSubmission = {
				id: operation.submissionId,
				lessonId: operation.lessonId,
				exerciseId: operation.exerciseId,
				accountId: actorAccountId,
				answer: operation.answer,
				sharedWithPeers: operation.sharedWithPeers,
				version: (existing?.version ?? 0) + 1,
				updatedAt: now,
				...(existing?.review ? { review: existing.review } : {}),
			};
			if (index === -1) next.submissions.push(submission);
			else next.submissions[index] = submission;
			appendActivity(
				next,
				activity(operation.id, "submission-saved", actorAccountId, "Saved exercise work", now, operation.lessonId),
			);
			break;
		}
		case "submission.review": {
			if (!roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Only course teachers can review submissions.");
			}
			const submission = next.submissions.find((candidate) => candidate.id === operation.submissionId);
			if (!submission) throw new CourseNotFoundError("This submission could not be found.");
			const student = memberFor(next, submission.accountId);
			if (student.teacherAccess !== "full") {
				throw new CourseAuthorizationError("The learner has not granted full teacher access.");
			}
			submission.review = {
				status: operation.status,
				feedback: operation.feedback,
				reviewerAccountId: actorAccountId,
				updatedAt: now,
			};
			appendActivity(
				next,
				activity(operation.id, "submission-reviewed", actorAccountId, "Reviewed exercise work", now, submission.lessonId),
			);
			break;
		}
		case "comment.add": {
			if (!next.settings.allowPeerComments && !roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Peer comments are disabled for this course.");
			}
			assertLesson(next, operation.lessonId);
			next.comments.push({
				id: operation.commentId,
				lessonId: operation.lessonId,
				accountId: actorAccountId,
				body: operation.body,
				createdAt: now,
			});
			appendActivity(
				next,
				activity(operation.id, "comment-added", actorAccountId, "Added a lesson comment", now, operation.lessonId),
			);
			break;
		}
		case "card.upsert": {
			if (!roleCanTeach(actor.role) && !next.settings.allowPeerDeckEdits) {
				throw new CourseAuthorizationError("Only course teachers can edit this deck.");
			}
			const index = next.cards.findIndex((card) => card.id === operation.card.id);
			const card = { ...operation.card, updatedAt: now, updatedBy: actorAccountId };
			if (index === -1) next.cards.push(card);
			else next.cards[index] = card;
			appendActivity(
				next,
				activity(operation.id, "card-updated", actorAccountId, "Updated an Anki card", now, card.lessonId),
			);
			break;
		}
		case "material.add": {
			if (!roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Only course teachers can add course materials.");
			}
			const material = { ...operation.material, createdAt: now, createdBy: actorAccountId };
			const index = next.materials.findIndex((candidate) => candidate.id === material.id);
			if (index === -1) next.materials.push(material);
			else next.materials[index] = material;
			appendActivity(next, activity(operation.id, "material-added", actorAccountId, "Added course material", now));
			break;
		}
		case "teacher-access.request": {
			if (!roleCanTeach(actor.role)) {
				throw new CourseAuthorizationError("Only course teachers can request full access.");
			}
			const target = memberFor(next, operation.memberAccountId);
			if (roleCanTeach(target.role)) {
				throw new CourseAuthorizationError("Teacher access applies to learners and invited peers.");
			}
			target.teacherAccess = "requested";
			appendActivity(
				next,
				activity(operation.id, "teacher-access-requested", actorAccountId, "Requested full teacher access", now),
			);
			break;
		}
		case "teacher-access.respond": {
			const target = memberFor(next, actorAccountId);
			if (target.teacherAccess !== "requested") {
				throw new CourseConflictError("There is no active teacher-access request.", next.revision);
			}
			target.teacherAccess = operation.approve ? "full" : "private";
			appendActivity(
				next,
				activity(
					operation.id,
					"teacher-access-changed",
					actorAccountId,
					operation.approve ? "Granted full teacher access" : "Declined full teacher access",
					now,
				),
			);
			break;
		}
		case "member.role.update": {
			if (!roleCanOwn(actor.role)) {
				throw new CourseAuthorizationError("Only the course owner can change member roles.");
			}
			const target = memberFor(next, operation.memberAccountId);
			if (target.role === "owner") {
				throw new CourseAuthorizationError("Transfer ownership before changing the owner role.");
			}
			target.role = operation.role;
			appendActivity(
				next,
				activity(operation.id, "member-role-changed", actorAccountId, "Changed a course member role", now),
			);
			break;
		}
	}

	next.revision += 1;
	next.updatedAt = now;
	return next;
}

function canSeeSubmission(course: Course, viewer: CourseMember, submission: CourseSubmission): boolean {
	if (submission.accountId === viewer.accountId) return true;
	if (roleCanTeach(viewer.role)) {
		return memberFor(course, submission.accountId).teacherAccess === "full";
	}
	return submission.sharedWithPeers;
}

function canSeeMemberPrivateState(viewer: CourseMember, member: CourseMember): boolean {
	if (member.accountId === viewer.accountId) return true;
	return roleCanTeach(viewer.role) && !roleCanTeach(member.role) && member.teacherAccess === "full";
}

function canSeeMemberConsentState(viewer: CourseMember, member: CourseMember): boolean {
	if (member.accountId === viewer.accountId) return true;
	return roleCanTeach(viewer.role) && !roleCanTeach(member.role);
}

function projectMemberForViewer(course: Course, viewer: CourseMember, member: CourseMember): CourseMember {
	if (canSeeMemberPrivateState(viewer, member)) return structuredClone(member);
	return {
		accountId: member.accountId,
		displayName: member.displayName,
		role: member.role,
		teacherAccess: canSeeMemberConsentState(viewer, member) ? member.teacherAccess : "private",
		// CourseMember remains schema-compatible without revealing member-specific timestamps.
		joinedAt: course.createdAt,
		progress: {
			completedLessonIds: [],
			lastActiveAt: course.createdAt,
		},
	};
}

export function projectCourseForViewer(course: Course, viewerAccountId: string): CourseViewerSnapshot {
	const viewer = memberFor(course, viewerAccountId);
	const projected = structuredClone(course);
	projected.members = course.members.map((member) => projectMemberForViewer(course, viewer, member));
	projected.submissions = projected.submissions.filter((submission) =>
		canSeeSubmission(course, viewer, submission),
	);
	projected.activity = projected.activity.filter((item) => {
		const member = course.members.find((candidate) => candidate.accountId === item.accountId);
		return member ? canSeeMemberPrivateState(viewer, member) : false;
	});
	return {
		course: projected,
		viewer: structuredClone(viewer),
		permissions: permissionsFor(course, viewerAccountId),
	};
}
