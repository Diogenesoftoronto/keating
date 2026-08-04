import type {
	FlashcardDeck,
	LearnerState,
	StudyPriority,
	StudyPriorityRecord,
	StudyPriorityTarget,
	Verification,
} from "./storage";

const MS_PER_DAY = 86_400_000;

export interface ComingUpItem {
	id: string;
	targetId: string;
	targetType: StudyPriorityTarget;
	priority: StudyPriority;
	prioritySource: "learner" | "recommended";
	title: string;
	topic: string;
	description: string;
	dueCount: number;
	overdueCount: number;
	nextDueAt: number | null;
	estimatedMinutes: number;
	weakConcepts: string[];
	cardCount: number;
	createdAt: number;
}

export interface ComingUpQueue {
	items: ComingUpItem[];
	lanes: Record<StudyPriority, ComingUpItem[]>;
	dueCardCount: number;
	overdueCardCount: number;
	estimatedMinutes: number;
	dueDeckIds: string[];
}

export interface ComingUpSources {
	decks: FlashcardDeck[];
	verifications: Verification[];
	learnerState: LearnerState;
	now?: number;
}

function priorityFor(
	targetType: StudyPriorityTarget,
	targetId: string,
	recommended: StudyPriority,
	priorities: Map<string, StudyPriorityRecord>,
): Pick<ComingUpItem, "priority" | "prioritySource"> {
	const saved = priorities.get(`${targetType}:${targetId}`);
	return saved
		? { priority: saved.priority, prioritySource: "learner" }
		: { priority: recommended, prioritySource: "recommended" };
}

function compareUrgency(left: ComingUpItem, right: ComingUpItem): number {
	if (left.overdueCount !== right.overdueCount) return right.overdueCount - left.overdueCount;
	if (left.dueCount !== right.dueCount) return right.dueCount - left.dueCount;
	const leftDue = left.nextDueAt ?? Number.POSITIVE_INFINITY;
	const rightDue = right.nextDueAt ?? Number.POSITIVE_INFINITY;
	if (leftDue !== rightDue) return leftDue - rightDue;
	return left.title.localeCompare(right.title);
}

export function buildComingUpQueue({ decks, verifications, learnerState, now = Date.now() }: ComingUpSources): ComingUpQueue {
	const priorities = new Map(learnerState.studyPriorities.map((record) => [
		`${record.targetType}:${record.targetId}`,
		record,
	]));
	const topicProfiles = new Map(learnerState.topicProfiles.map((profile) => [profile.topic, profile]));
	const items: ComingUpItem[] = [];

	for (const deck of decks) {
		const dueCards = deck.cards.filter((card) => card.srs.dueAt <= now);
		const overdueCards = dueCards.filter((card) => card.srs.dueAt < now - MS_PER_DAY);
		const nextDueAt = deck.cards.length > 0
			? Math.min(...deck.cards.map((card) => card.srs.dueAt))
			: null;
		const profile = topicProfiles.get(deck.topic);
		items.push({
			id: `deck:${deck.id}`,
			targetId: deck.id,
			targetType: "deck",
			...priorityFor("deck", deck.id, dueCards.length > 0 ? "focus" : "maintain", priorities),
			title: deck.title,
			topic: deck.topic,
			description: deck.description?.trim() || "Spaced-repetition deck",
			dueCount: dueCards.length,
			overdueCount: overdueCards.length,
			nextDueAt,
			estimatedMinutes: Math.max(1, Math.ceil(dueCards.length * 1.25)),
			weakConcepts: profile?.reportedChallenges ?? [],
			cardCount: deck.cards.length,
			createdAt: deck.createdAt,
		});
	}

	for (const verification of verifications.filter((item) => !item.completed)) {
		const ageDays = Math.max(0, (now - verification.createdAt) / MS_PER_DAY);
		items.push({
			id: `verification:${verification.id}`,
			targetId: verification.id,
			targetType: "verification",
			...priorityFor("verification", verification.id, ageDays >= 7 ? "focus" : "maintain", priorities),
			title: `${verification.topic} check`,
			topic: verification.topic,
			description: verification.checklist.trim().split("\n").find(Boolean)?.replace(/^[-*\d.)\s]+/, "") || "Open knowledge check",
			dueCount: 0,
			overdueCount: 0,
			nextDueAt: null,
			estimatedMinutes: 5,
			weakConcepts: topicProfiles.get(verification.topic)?.reportedChallenges ?? [],
			cardCount: 0,
			createdAt: verification.createdAt,
		});
	}

	for (const profile of learnerState.topicProfiles.filter((item) => item.status === "needs-review")) {
		const hasTopicWork = items.some((item) => item.topic === profile.topic);
		if (hasTopicWork) continue;
		items.push({
			id: `topic:${profile.topic}`,
			targetId: profile.topic,
			targetType: "topic",
			...priorityFor("topic", profile.topic, "focus", priorities),
			title: profile.topic,
			topic: profile.topic,
			description: "Needs a fresh retrieval check",
			dueCount: 0,
			overdueCount: 0,
			nextDueAt: null,
			estimatedMinutes: 8,
			weakConcepts: profile.reportedChallenges,
			cardCount: 0,
			createdAt: profile.lastEvidenceAt,
		});
	}

	const sorted = [...items].sort(compareUrgency);
	const lanes: ComingUpQueue["lanes"] = { focus: [], maintain: [], low: [] };
	for (const item of sorted) lanes[item.priority].push(item);
	const dueDeckIds = sorted
		.filter((item) => item.targetType === "deck" && item.dueCount > 0)
		.sort((left, right) => {
			const priorityRank: Record<StudyPriority, number> = { focus: 0, maintain: 1, low: 2 };
			return priorityRank[left.priority] - priorityRank[right.priority] || compareUrgency(left, right);
		})
		.map((item) => item.targetId);

	return {
		items: sorted,
		lanes,
		dueCardCount: sorted.reduce((sum, item) => sum + item.dueCount, 0),
		overdueCardCount: sorted.reduce((sum, item) => sum + item.overdueCount, 0),
		estimatedMinutes: sorted.reduce((sum, item) => sum + (item.dueCount > 0 ? item.estimatedMinutes : 0), 0),
		dueDeckIds,
	};
}
