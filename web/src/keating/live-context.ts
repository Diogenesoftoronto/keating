import { allCourseLessons, normalizeCourseViewerSnapshot } from "../courses/contracts";
import { getCourse } from "../courses/client";
import type { KeatingStorage } from "./storage";
import type {
	LiveContextResource,
	LiveSessionContext,
} from "./speech";

const MAX_PROFILE_CHARS = 2_400;
const MAX_DOCUMENTS = 5;
const MAX_ARTIFACTS = 6;
const MAX_EXCERPT_CHARS = 900;

const SECRET_PATTERNS = [
	/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g,
	/\bAIza[A-Za-z0-9_-]{16,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
	/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
	/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
	/^[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)\s*=\s*.+$/gm,
	/\b(?=[a-f0-9]{32,}\b)(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]{32,}\b/gi,
];

/** Strip credentials and constrain text before it can leave the browser session. */
export function safeLiveContextText(value: unknown, maxChars = MAX_EXCERPT_CHARS): string {
	let text = typeof value === "string" ? value.trim() : "";
	for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[REDACTED]");
	return text.slice(0, Math.max(0, maxChars));
}

function recentSessionDocuments(messages: readonly unknown[]): Array<LiveContextResource & { excerpt?: string }> {
	const documents: Array<LiveContextResource & { excerpt?: string }> = [];
	for (let index = messages.length - 1; index >= 0 && documents.length < MAX_DOCUMENTS; index -= 1) {
		const message = messages[index] as { attachments?: unknown };
		if (!Array.isArray(message?.attachments)) continue;
		for (const candidate of [...message.attachments].reverse()) {
			if (documents.length >= MAX_DOCUMENTS) break;
			if (!candidate || typeof candidate !== "object") continue;
			const attachment = candidate as Record<string, unknown>;
			const title = safeLiveContextText(attachment.fileName, 180);
			if (!title) continue;
			const excerpt = safeLiveContextText(attachment.extractedText, MAX_EXCERPT_CHARS);
			documents.push({
				title,
				kind: safeLiveContextText(attachment.mimeType, 120) || "document",
				...(excerpt ? { excerpt } : {}),
				source: "session",
			});
		}
	}
	return documents.reverse();
}

function sessionArtifacts(
	storageRecords: Array<{ title: string; kind: string; excerpt: string; createdAt: number; sessionId?: string }>,
	sessionId: string,
): Array<LiveContextResource & { excerpt: string }> {
	return storageRecords
		.filter((item) => item.sessionId === sessionId)
		.sort((left, right) => right.createdAt - left.createdAt)
		.slice(0, MAX_ARTIFACTS)
		.map((item) => ({
			title: safeLiveContextText(item.title, 180),
			kind: item.kind,
			excerpt: safeLiveContextText(item.excerpt),
			source: "session" as const,
		}))
		.filter((item) => item.title && item.excerpt);
}

async function storedArtifacts(storage: KeatingStorage, sessionId: string): Promise<Array<LiveContextResource & { excerpt: string }>> {
	const [plans, maps, animations, verifications, decks] = await Promise.all([
		storage.getLessonPlans(),
		storage.getLessonMaps(),
		storage.getAnimations(),
		storage.getVerifications(),
		storage.getDecks(),
	]);
	return sessionArtifacts([
		...plans.map((item) => ({ title: item.topic, kind: "lesson plan", excerpt: item.content, createdAt: item.createdAt, sessionId: item.sessionId })),
		...maps.map((item) => ({ title: item.topic, kind: "lesson map", excerpt: item.mmdContent, createdAt: item.createdAt, sessionId: item.sessionId })),
		...animations.map((item) => ({ title: item.topic, kind: "animation storyboard", excerpt: item.storyboard, createdAt: item.createdAt, sessionId: item.sessionId })),
		...verifications.map((item) => ({ title: item.topic, kind: "verification", excerpt: item.checklist, createdAt: item.createdAt, sessionId: item.sessionId })),
		...decks.map((item) => ({ title: item.title, kind: "flashcard deck", excerpt: item.cards.slice(0, 6).map((card) => `${card.front}: ${card.back}`).join("\n"), createdAt: item.updatedAt, sessionId: item.sessionId })),
	], sessionId);
}

export async function buildLiveSessionContext(input: {
	storage: KeatingStorage;
	sessionId: string;
	messages: readonly unknown[];
	providedProfile?: string;
	activeCourseId?: string;
}): Promise<LiveSessionContext> {
	const [learnerState, artifacts, courseSnapshot] = await Promise.all([
		input.storage.getLearnerState(),
		storedArtifacts(input.storage, input.sessionId),
		input.activeCourseId
			? getCourse(input.activeCourseId).then(normalizeCourseViewerSnapshot).catch(() => null)
			: Promise.resolve(null),
	]);

	const documents = recentSessionDocuments(input.messages);
	const context: LiveSessionContext = {
		sessionId: input.sessionId,
		learner: {
			providedProfile: safeLiveContextText(input.providedProfile, MAX_PROFILE_CHARS) || undefined,
			strengths: learnerState.strengths.slice(0, 8).map((value) => safeLiveContextText(value, 160)),
			needsReview: learnerState.weaknesses.slice(0, 8).map((value) => safeLiveContextText(value, 160)),
			recentTopics: learnerState.topicsExplored.slice(-10).map((value) => safeLiveContextText(value, 160)),
			studyPriorities: learnerState.studyPriorities.slice(-8).map((priority) => `${priority.targetType}: ${safeLiveContextText(priority.targetId, 120)} (${priority.priority})`),
		},
		documents,
		artifacts,
	};

	if (!courseSnapshot) return context;
	const { course, viewer } = courseSnapshot;
	const lessons = allCourseLessons(course);
	const currentLesson = lessons.find((lesson) => lesson.id === viewer.progress.activeLessonId)
		?? lessons.find((lesson) => !viewer.progress.completedLessonIds.includes(lesson.id))
		?? lessons[0];
	context.learner.displayName = safeLiveContextText(viewer.displayName, 120) || undefined;
	context.learner.role = viewer.role;
	context.course = {
		id: course.id,
		title: safeLiveContextText(course.title, 240),
		description: safeLiveContextText(course.description, 700) || undefined,
		outcomes: course.outcomes.slice(0, 12).map((value) => safeLiveContextText(value, 300)),
		...(currentLesson ? {
			currentLesson: {
				id: currentLesson.id,
				title: safeLiveContextText(currentLesson.title, 240),
				summary: safeLiveContextText(currentLesson.summary, 600) || undefined,
				objectives: currentLesson.objectives.slice(0, 12).map((value) => safeLiveContextText(value, 300)),
				readingExcerpt: safeLiveContextText(currentLesson.reading, 1_200) || undefined,
			},
		} : {}),
		completedLessons: viewer.progress.completedLessonIds.length,
		totalLessons: lessons.length,
	};

	const relevantMaterial = course.materials
		.filter((item) => !item.lessonId || item.lessonId === currentLesson?.id)
		.slice(-MAX_DOCUMENTS)
		.map((item): LiveContextResource & { excerpt?: string } => ({
			title: safeLiveContextText(item.title, 180),
			kind: item.kind,
			...(item.description ? { excerpt: safeLiveContextText(item.description) } : {}),
			source: "course",
		}));
	const learnerSubmission = course.submissions
		.filter((item) => item.accountId === viewer.accountId && (!currentLesson || item.lessonId === currentLesson.id))
		.slice(-1)
		.map((item): LiveContextResource & { excerpt?: string } => ({
			title: `${currentLesson?.title ?? "Course"} learner response`,
			kind: "submission",
			excerpt: safeLiveContextText(item.answer),
			source: "course",
		}));
	context.documents = [...context.documents, ...relevantMaterial, ...learnerSubmission].slice(-MAX_DOCUMENTS);
	const courseArtifacts = course.artifacts
		.filter((item) => !item.lessonId || item.lessonId === currentLesson?.id)
		.slice(-MAX_ARTIFACTS)
		.map((item): LiveContextResource & { excerpt: string } => ({
			title: safeLiveContextText(item.title, 180),
			kind: item.kind,
			excerpt: safeLiveContextText(item.content),
			source: "course",
		}));
	context.artifacts = [...context.artifacts, ...courseArtifacts].slice(-MAX_ARTIFACTS);
	return context;
}
