import type { LearnerState } from "../keating/storage";

export type LearnerSession = LearnerState["sessions"][number];

const DEFAULT_OPEN_SESSION_DISPLAY_MS = 30 * 60 * 1000;

export function getPrimaryCurriculumTopic(session: LearnerSession): string | null {
	const topic = session.topicsCovered?.find((entry) => entry.trim().length > 0)?.trim();
	return topic ?? null;
}

export function getVisibleCurriculumSessions(sessions: LearnerState["sessions"] | undefined): LearnerSession[] {
	return [...(sessions ?? [])]
		.filter((session) => typeof session.startedAt === "number" && getPrimaryCurriculumTopic(session) !== null)
		.sort((a, b) => a.startedAt - b.startedAt);
}

export function getCurriculumDisplayEnd(session: LearnerSession, now = Date.now()): number {
	if (typeof session.endedAt === "number" && session.endedAt >= session.startedAt) {
		return session.endedAt;
	}
	return Math.min(now, session.startedAt + DEFAULT_OPEN_SESSION_DISPLAY_MS);
}

export function hasMeaningfulPolicyScores(scores: Array<{ score: number }>): boolean {
	return scores.some((entry) => entry.score > 0);
}
