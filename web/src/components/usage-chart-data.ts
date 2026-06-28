import type { LearnerState } from "../keating/storage";
import type { SessionMetadata } from "../types/session";

export type LearnerSession = LearnerState["sessions"][number];
export type ModelUsageBasis = "tokens" | "messages";

export interface ModelUsageEntry {
	key: string;
	label: string;
	provider: string;
	modelId: string;
	sessions: number;
	messages: number;
	tokens: number;
	cost: number;
	value: number;
	share: number;
	color: string;
}

export interface ModelUsageBreakdown {
	basis: ModelUsageBasis;
	total: number;
	entries: ModelUsageEntry[];
}

const DEFAULT_OPEN_SESSION_DISPLAY_MS = 30 * 60 * 1000;
const MODEL_USAGE_COLORS = ["#6366f1", "#22c55e", "#f97316", "#06b6d4", "#d946ef", "#eab308", "#ef4444"];

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

function sessionTokenCount(session: SessionMetadata): number {
	return session.usage.totalTokens || session.usage.input + session.usage.output;
}

function modelLabel(session: SessionMetadata): { key: string; label: string; provider: string; modelId: string } {
	const provider = session.modelProvider?.trim() || "unknown";
	const modelId = session.modelId?.trim() || "unknown";
	const label = session.modelName?.trim() || (modelId === "unknown" ? "Unknown model" : modelId);
	return {
		key: `${provider}::${modelId}`,
		label,
		provider,
		modelId,
	};
}

function withShares(entries: ModelUsageEntry[], total: number): ModelUsageEntry[] {
	return entries.map((entry, index) => ({
		...entry,
		share: total > 0 ? entry.value / total : 0,
		color: entry.color || MODEL_USAGE_COLORS[index % MODEL_USAGE_COLORS.length],
	}));
}

export function buildModelUsageBreakdown(
	sessions: SessionMetadata[],
	maxEntries = 6,
): ModelUsageBreakdown {
	const totalTokens = sessions.reduce((sum, session) => sum + sessionTokenCount(session), 0);
	const basis: ModelUsageBasis = totalTokens > 0 ? "tokens" : "messages";
	const byModel = new Map<string, ModelUsageEntry>();

	for (const session of sessions) {
		const model = modelLabel(session);
		const tokens = sessionTokenCount(session);
		const current = byModel.get(model.key) ?? {
			...model,
			sessions: 0,
			messages: 0,
			tokens: 0,
			cost: 0,
			value: 0,
			share: 0,
			color: "",
		};
		current.sessions += 1;
		current.messages += session.messageCount;
		current.tokens += tokens;
		current.cost += session.usage.cost.total;
		current.value += basis === "tokens" ? tokens : session.messageCount;
		byModel.set(model.key, current);
	}

	const sorted = Array.from(byModel.values()).sort((a, b) => b.value - a.value);
	const visible = sorted.slice(0, maxEntries);
	const overflow = sorted.slice(maxEntries);
	if (overflow.length > 0) {
		visible.push({
			key: "other",
			label: "Other models",
			provider: "mixed",
			modelId: "other",
			sessions: overflow.reduce((sum, entry) => sum + entry.sessions, 0),
			messages: overflow.reduce((sum, entry) => sum + entry.messages, 0),
			tokens: overflow.reduce((sum, entry) => sum + entry.tokens, 0),
			cost: overflow.reduce((sum, entry) => sum + entry.cost, 0),
			value: overflow.reduce((sum, entry) => sum + entry.value, 0),
			share: 0,
			color: "",
		});
	}

	const total = visible.reduce((sum, entry) => sum + entry.value, 0);
	return {
		basis,
		total,
		entries: withShares(visible, total),
	};
}
