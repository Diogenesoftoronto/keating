import {
	DEFAULT_WEIGHTS,
	feedbackToOutcomeScore,
	inferBrowserLearnerTurnSignal,
	type SimulationWeights,
} from "./core";
import type { FeedbackEntry, QuizResultRecord } from "./storage";

export const REWARD_NEUTRAL = 0.5;
export const KTO_GOOD_THRESHOLD = 0.7;
export const KTO_BAD_THRESHOLD = 0.35;
export const PREFERENCE_MIN_GAP = 0.3;
export const FEEDBACK_WINDOW_MS = 10 * 60_000;
export const SIGNAL_WEIGHTS = { explicit: 0.6, inferred: 0.15, quiz: 0.25 } as const;
export const JUDGE_BLEND = 0.35;

export interface RewardChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface RewardSourceSignal {
	score: number;
	joinedBy?: "messageId" | "timestampWindow" | "nextTurn" | "sessionId" | "topicWindow";
	signal?: FeedbackEntry["signal"];
	feedbackId?: string;
	quizResultId?: string;
}

export interface JudgeScore {
	masteryGain: number;
	retention: number;
	engagement: number;
	transfer: number;
	confusion: number;
}

export interface RewardedTurn {
	sessionId: string;
	topic?: string;
	messageTimestamp?: number;
	context: RewardChatMessage[];
	completion: string;
	reward: number;
	signals: {
		explicit?: RewardSourceSignal;
		inferred?: RewardSourceSignal;
		quiz?: RewardSourceSignal;
		judge?: JudgeScore & { score: number };
	};
	scored: boolean;
}

export interface NormalizedRewardMessage {
	role: "user" | "assistant";
	content: string;
	timestamp?: number;
	shortAssistant?: boolean;
}

export type ExportJudge = (examples: RewardedTurn[]) => Promise<Array<JudgeScore | null>>;

export interface RewardStats {
	scored: number;
	unscored: number;
	bySource: {
		explicit: number;
		inferred: number;
		quiz: number;
		judge: number;
	};
	distribution: [number, number, number, number, number];
}

export interface PreferencePair {
	prompt: RewardChatMessage[];
	chosen: string;
	rejected: string;
	chosenReward: number;
	rejectedReward: number;
	rewardGap: number;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return REWARD_NEUTRAL;
	return Math.max(0, Math.min(1, value));
}

function weightedMean(entries: Array<{ score: number; weight: number }>): number | null {
	const present = entries.filter((entry) => Number.isFinite(entry.score));
	const total = present.reduce((sum, entry) => sum + entry.weight, 0);
	if (total <= 0) return null;
	return clamp01(present.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / total);
}

function timestampFromMessageId(messageId?: string): number | null {
	if (!messageId) return null;
	const match = /-(\d+)$/.exec(messageId);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

function promptKey(context: RewardChatMessage[]): string {
	return JSON.stringify(context.map((message) => [message.role, message.content]));
}

function quizScore(record: QuizResultRecord): number {
	if (typeof record.weightedScore === "number") return clamp01(record.weightedScore);
	return clamp01(record.score / Math.max(1, record.totalQuestions));
}

export function computeSessionRewardedTurns({
	sessionId,
	title,
	persona,
	messages,
	feedback,
	quizResults,
	usedFeedbackIds,
}: {
	sessionId: string;
	title?: string;
	persona?: string;
	messages: NormalizedRewardMessage[];
	feedback: FeedbackEntry[];
	quizResults: QuizResultRecord[];
	usedFeedbackIds: Set<string>;
}): RewardedTurn[] {
	const turns: RewardedTurn[] = [];
	const topicFallback = title?.trim() || "general";

	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role !== "assistant" || message.shortAssistant) continue;
		const prior = messages.slice(0, index).map((entry): RewardChatMessage => ({
			role: entry.role,
			content: entry.content,
		}));
		const context: RewardChatMessage[] = persona?.trim()
			? [{ role: "system", content: persona.trim() }, ...prior]
			: prior;
		turns.push({
			sessionId,
			topic: topicFallback,
			messageTimestamp: message.timestamp,
			context,
			completion: message.content,
			reward: REWARD_NEUTRAL,
			signals: {},
			scored: false,
		});
	}

	for (const turn of turns) {
		const explicit = findExplicitSignal(turn, messages, feedback, usedFeedbackIds);
		if (explicit) turn.signals.explicit = explicit;
		if (!explicit) {
			const inferred = findInferredSignal(turn, messages, topicFallback);
			if (inferred) turn.signals.inferred = inferred;
		}
		const quiz = findQuizSignal(turn, quizResults, messages, topicFallback);
		if (quiz) turn.signals.quiz = quiz;
		const base = weightedMean([
			...(turn.signals.explicit ? [{ score: turn.signals.explicit.score, weight: SIGNAL_WEIGHTS.explicit }] : []),
			...(turn.signals.inferred ? [{ score: turn.signals.inferred.score, weight: SIGNAL_WEIGHTS.inferred }] : []),
			...(turn.signals.quiz ? [{ score: turn.signals.quiz.score, weight: SIGNAL_WEIGHTS.quiz }] : []),
		]);
		if (base === null) {
			turn.reward = REWARD_NEUTRAL;
			turn.scored = false;
		} else {
			turn.reward = base;
			turn.scored = true;
		}
	}

	return turns;
}

function findExplicitSignal(
	turn: RewardedTurn,
	messages: NormalizedRewardMessage[],
	feedback: FeedbackEntry[],
	usedFeedbackIds: Set<string>,
): RewardSourceSignal | null {
	for (const entry of feedback) {
		if (usedFeedbackIds.has(entry.id)) continue;
		if (entry.sessionId && entry.sessionId !== turn.sessionId) continue;
		const timestamp = timestampFromMessageId(entry.messageId);
		if (timestamp !== null && timestamp === turn.messageTimestamp) {
			usedFeedbackIds.add(entry.id);
			return {
				score: feedbackToOutcomeScore(entry.signal),
				joinedBy: "messageId",
				signal: entry.signal,
				feedbackId: entry.id,
			};
		}
	}

	if (typeof turn.messageTimestamp !== "number") return null;
	const nextUser = messages.find((message) => (
		message.role === "user"
		&& typeof message.timestamp === "number"
		&& message.timestamp > turn.messageTimestamp!
	));
	const end = nextUser?.timestamp ?? turn.messageTimestamp + FEEDBACK_WINDOW_MS;
	const candidates = feedback
		.filter((entry) => {
			if (usedFeedbackIds.has(entry.id) || entry.messageId) return false;
			if (entry.sessionId && entry.sessionId !== turn.sessionId) return false;
			return entry.createdAt >= turn.messageTimestamp! && entry.createdAt < end;
		})
		.sort((a, b) => Math.abs(a.createdAt - turn.messageTimestamp!) - Math.abs(b.createdAt - turn.messageTimestamp!));
	const winner = candidates[0];
	if (!winner) return null;
	usedFeedbackIds.add(winner.id);
	return {
		score: feedbackToOutcomeScore(winner.signal),
		joinedBy: "timestampWindow",
		signal: winner.signal,
		feedbackId: winner.id,
	};
}

function findInferredSignal(
	turn: RewardedTurn,
	messages: NormalizedRewardMessage[],
	topicFallback: string,
): RewardSourceSignal | null {
	if (typeof turn.messageTimestamp !== "number") return null;
	const nextUser = messages.find((message) => (
		message.role === "user"
		&& typeof message.timestamp === "number"
		&& message.timestamp > turn.messageTimestamp!
	));
	if (!nextUser) return null;
	const inferred = inferBrowserLearnerTurnSignal(nextUser.content, topicFallback);
	if (!inferred) return null;
	return {
		score: feedbackToOutcomeScore(inferred.signal),
		joinedBy: "nextTurn",
		signal: inferred.signal,
	};
}

function findQuizSignal(
	turn: RewardedTurn,
	quizResults: QuizResultRecord[],
	messages: NormalizedRewardMessage[],
	topicFallback: string,
): RewardSourceSignal | null {
	if (typeof turn.messageTimestamp !== "number") return null;
	const candidates = quizResults
		.filter((record) => {
			if (record.sessionId) return record.sessionId === turn.sessionId && record.createdAt >= turn.messageTimestamp!;
			if (record.topic !== topicFallback) return false;
			return record.createdAt >= turn.messageTimestamp! && record.createdAt < turn.messageTimestamp! + FEEDBACK_WINDOW_MS;
		})
		.filter((record) => {
			const laterAssistant = messages.find((message) => (
				message.role === "assistant"
				&& typeof message.timestamp === "number"
				&& message.timestamp > turn.messageTimestamp!
				&& message.timestamp <= record.createdAt
			));
			return !laterAssistant;
		})
		.sort((a, b) => b.createdAt - a.createdAt);
	const winner = candidates[0];
	if (!winner) return null;
	return {
		score: quizScore(winner),
		joinedBy: winner.sessionId ? "sessionId" : "topicWindow",
		quizResultId: winner.id,
	};
}

export function judgeComposite(score: JudgeScore, w: SimulationWeights = DEFAULT_WEIGHTS): number {
	return clamp01(
		score.masteryGain * w.masteryGain
		+ score.retention * w.retention
		+ score.engagement * w.engagement
		+ score.transfer * w.transfer
		- score.confusion * w.confusion,
	);
}

export function applyJudgeScores(turns: RewardedTurn[], scores: Array<JudgeScore | null>): RewardedTurn[] {
	for (let index = 0; index < turns.length; index += 1) {
		const score = scores[index];
		if (!score) continue;
		const composite = judgeComposite(score);
		const turn = turns[index];
		turn.signals.judge = { ...score, score: composite };
		turn.reward = clamp01((1 - JUDGE_BLEND) * turn.reward + JUDGE_BLEND * composite);
		turn.scored = true;
	}
	return turns;
}

export function buildKtoExamples(turns: RewardedTurn[]) {
	return turns
		.filter((turn) => turn.scored && (turn.reward >= KTO_GOOD_THRESHOLD || turn.reward <= KTO_BAD_THRESHOLD))
		.map((turn) => ({
			prompt: turn.context,
			completion: turn.completion,
			label: turn.reward >= KTO_GOOD_THRESHOLD,
		}));
}

export function buildPreferencePairs(turns: RewardedTurn[]) {
	const groups = new Map<string, RewardedTurn[]>();
	for (const turn of turns) {
		if (!turn.scored) continue;
		const key = promptKey(turn.context);
		groups.set(key, [...(groups.get(key) ?? []), turn]);
	}
	const pairs: PreferencePair[] = [];
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const sorted = [...group].sort((a, b) => b.reward - a.reward);
		for (let chosenIndex = 0; chosenIndex < sorted.length - 1; chosenIndex += 1) {
			for (let rejectedIndex = chosenIndex + 1; rejectedIndex < sorted.length; rejectedIndex += 1) {
				const chosen = sorted[chosenIndex];
				const rejected = sorted[rejectedIndex];
				const rewardGap = chosen.reward - rejected.reward;
				if (rewardGap >= PREFERENCE_MIN_GAP) {
					pairs.push({
						prompt: chosen.context,
						chosen: chosen.completion,
						rejected: rejected.completion,
						chosenReward: chosen.reward,
						rejectedReward: rejected.reward,
						rewardGap,
					});
				}
			}
		}
	}
	return pairs;
}

export function buildDpoChatExamples(pairs: PreferencePair[]) {
	return pairs.map((pair) => ({
		prompt: pair.prompt,
		chosen: pair.chosen,
		rejected: pair.rejected,
	}));
}

export function formatDpoPrompt(messages: RewardChatMessage[]): string {
	return messages.map((message) => {
		switch (message.role) {
			case "system":
				return `System: ${message.content}`;
			case "user":
				return `User: ${message.content}`;
			case "assistant":
				return `Assistant: ${message.content}`;
		}
	}).join("\n\n");
}

export function buildDpoTextExamples(pairs: PreferencePair[]) {
	return pairs.map((pair) => ({
		prompt: formatDpoPrompt(pair.prompt),
		chosen: pair.chosen,
		rejected: pair.rejected,
	}));
}

export function buildGrpoPrompts(turns: RewardedTurn[]) {
	const seen = new Set<string>();
	const prompts: Array<{ prompt: RewardChatMessage[] }> = [];
	for (const turn of turns) {
		const key = promptKey(turn.context);
		if (seen.has(key)) continue;
		seen.add(key);
		prompts.push({ prompt: turn.context });
	}
	return prompts;
}

export function computeRewardStats(turns: RewardedTurn[]): RewardStats {
	const stats: RewardStats = {
		scored: 0,
		unscored: 0,
		bySource: { explicit: 0, inferred: 0, quiz: 0, judge: 0 },
		distribution: [0, 0, 0, 0, 0],
	};
	for (const turn of turns) {
		if (turn.scored) stats.scored += 1;
		else stats.unscored += 1;
		if (turn.signals.explicit) stats.bySource.explicit += 1;
		if (turn.signals.inferred) stats.bySource.inferred += 1;
		if (turn.signals.quiz) stats.bySource.quiz += 1;
		if (turn.signals.judge) stats.bySource.judge += 1;
		const bucket = Math.min(4, Math.max(0, Math.floor(clamp01(turn.reward) / 0.2)));
		stats.distribution[bucket] += 1;
	}
	return stats;
}
