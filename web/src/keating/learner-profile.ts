/**
 * Turns the browser's durable learning events into cautious, topic-level
 * learner beliefs.  These are deliberately derived: the original feedback,
 * quiz, diagnostic, and review records remain the source of truth.
 */

export type LearningEvidenceKind = "feedback" | "quiz" | "diagnostic" | "review";

export interface LearningEvidence {
	topic: string;
	kind: LearningEvidenceKind;
	score: number;
	createdAt: number;
	weight: number;
	note?: string;
}

export interface LearnerTopicProfile {
	topic: string;
	mastery: number;
	retention: number | null;
	confidence: number;
	evidenceCount: number;
	lastEvidenceAt: number;
	/** Learner-reported friction or a tutor-supported misconception, never inferred from a score alone. */
	reportedChallenges: string[];
	status: "strong" | "developing" | "needs-review";
}

export interface LearnerProfileSummary {
	topics: LearnerTopicProfile[];
	strengths: string[];
	weaknesses: string[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function weightedMean(evidence: LearningEvidence[]): number | null {
	const totalWeight = evidence.reduce((sum, item) => sum + item.weight, 0);
	if (totalWeight <= 0) return null;
	return clamp01(evidence.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
}

/**
 * Derive a compact profile from observed performance. Sentiment has a small
 * weight; quizzes and scored checks carry the mastery estimate, while spaced
 * reviews are the only source of retention.
 */
export function deriveLearnerProfile(evidence: LearningEvidence[]): LearnerProfileSummary {
	const byTopic = new Map<string, LearningEvidence[]>();
	for (const item of evidence) {
		if (!item.topic || !Number.isFinite(item.score) || !(item.weight > 0)) continue;
		const topicEvidence = byTopic.get(item.topic) ?? [];
		topicEvidence.push({ ...item, score: clamp01(item.score) });
		byTopic.set(item.topic, topicEvidence);
	}

	const topics = [...byTopic.entries()].map(([topic, topicEvidence]) => {
		const masteryEvidence = topicEvidence.filter((item) => item.kind !== "review");
		const reviewEvidence = topicEvidence.filter((item) => item.kind === "review");
		// A review still says something about usable knowledge when there are no
		// direct checks yet, but it must not drown out a quiz or diagnostic.
		const mastery = weightedMean(masteryEvidence) ?? weightedMean(reviewEvidence) ?? 0.5;
		const retention = weightedMean(reviewEvidence);
		const totalWeight = topicEvidence.reduce((sum, item) => sum + item.weight, 0);
		const confidence = clamp01(totalWeight / 5);
		const lastEvidenceAt = Math.max(...topicEvidence.map((item) => item.createdAt));
		const reportedChallenges = [...new Set(topicEvidence
			.filter((item) => (item.kind === "feedback" || item.kind === "diagnostic") && item.score <= 0.5 && item.note?.trim())
			.map((item) => item.note!.trim())
		)].slice(-3);
		const status = mastery < 0.45 || (retention !== null && retention < 0.45)
			? "needs-review"
			: confidence >= 0.35 && mastery >= 0.75 && (retention === null || retention >= 0.65)
				? "strong"
				: "developing";
		return {
			topic,
			mastery,
			retention,
			confidence,
			evidenceCount: topicEvidence.length,
			lastEvidenceAt,
			reportedChallenges,
			status,
		} satisfies LearnerTopicProfile;
	}).sort((left, right) => right.lastEvidenceAt - left.lastEvidenceAt);

	return {
		topics,
		strengths: topics.filter((topic) => topic.status === "strong").map((topic) => topic.topic),
		weaknesses: topics.filter((topic) => topic.status === "needs-review").map((topic) => topic.topic),
	};
}
