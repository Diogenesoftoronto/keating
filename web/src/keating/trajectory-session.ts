import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionData, SessionMetadata } from "../types/session";
import {
	createSessionId,
	sessionModelMetadata,
	sessionPreview,
	sessionSearchText,
	sessionUsage,
} from "../hooks/session-metadata";
import {
	messageReviewAnchor,
	modelFromStoredReference,
	type ReviewGenerationCandidate,
} from "./trajectory-review";
import type { TrajectoryReviewStore } from "./trajectory-store";

interface SessionRevisionPersistence {
	getAllMetadata(): Promise<unknown[]>;
	save(data: SessionData, metadata: SessionMetadata): Promise<void>;
}

function assistantIndex(source: SessionData, candidate: ReviewGenerationCandidate): number {
	if (candidate.target.kind !== "response") return -1;
	const target = candidate.target;
	const assistantTurns = source.messages.flatMap((message, ordinal) => {
		const entry = message as { role?: unknown; timestamp?: unknown };
		if (entry.role !== "assistant") return [];
		return [{ ordinal, timestamp: entry.timestamp, anchor: messageReviewAnchor(source.id, message, ordinal) }];
	});
	const exact = assistantTurns.find((turn) => turn.anchor.id === target.messageId);
	if (exact) return exact.ordinal;

	const fallback = assistantTurns.filter((turn) =>
		(target.messageTimestamp === undefined || turn.timestamp === target.messageTimestamp)
		&& turn.anchor.text === target.originalContent,
	);
	return fallback.length === 1 ? fallback[0].ordinal : -1;
}

function usageForCandidate(candidate: ReviewGenerationCandidate) {
	return {
		input: candidate.usage?.inputTokens ?? 0,
		output: candidate.usage?.outputTokens ?? 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: candidate.usage?.totalTokens
			?? (candidate.usage?.inputTokens ?? 0) + (candidate.usage?.outputTokens ?? 0),
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: candidate.usage?.costUsd ?? 0,
		},
	};
}

export function buildInsertedReviewSession(
	source: SessionData,
	candidate: ReviewGenerationCandidate,
	now = new Date().toISOString(),
	id = createSessionId(),
): { data: SessionData; metadata: SessionMetadata } {
	if (candidate.target.kind !== "response") {
		throw new Error("Only response candidates can be inserted into a session.");
	}
	if (candidate.state !== "completed" || !candidate.content?.trim()) {
		throw new Error("Only a completed response candidate can be inserted.");
	}
	const replaceIndex = assistantIndex(source, candidate);
	if (replaceIndex < 0) throw new Error("The reviewed assistant turn is no longer present in this session.");

	const model = modelFromStoredReference(candidate.model);
	const timestamp = Math.max(
		Date.parse(now),
		(candidate.target.messageTimestamp ?? 0) + 1,
	);
	const replacement = {
		role: "assistant",
		content: [{ type: "text", text: candidate.content.trim() }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: usageForCandidate(candidate),
		stopReason: "stop",
		timestamp,
	} as AgentMessage;
	const messages = [...structuredClone(source.messages.slice(0, replaceIndex)), replacement];
	const title = `${source.title || "Session"} (review revision)`;
	const common = {
		id,
		title,
		parentSessionId: source.id,
		forkedAt: now,
		forkedFromMessageTimestamp: candidate.target.messageTimestamp,
		createdAt: now,
		lastModified: now,
		aiGeneratedTitle: false,
	};
	const data: SessionData = {
		...common,
		model,
		thinkingLevel: source.thinkingLevel,
		messages,
	};
	const metadata: SessionMetadata = {
		...common,
		messageCount: messages.length,
		usage: sessionUsage(messages),
		thinkingLevel: source.thinkingLevel,
		...sessionModelMetadata(model),
		preview: sessionPreview(messages),
		searchText: sessionSearchText(messages),
	};
	return { data, metadata };
}

export async function insertReviewResponseCandidate(
	source: SessionData,
	candidate: ReviewGenerationCandidate,
	dependencies: {
		sessions: SessionRevisionPersistence;
		reviews: Pick<TrajectoryReviewStore, "saveCandidate">;
	},
): Promise<{ data: SessionData; metadata: SessionMetadata; candidate: ReviewGenerationCandidate }> {
	const revision = buildInsertedReviewSession(source, candidate);
	await dependencies.sessions.save(revision.data, revision.metadata);
	const nextCandidate = await dependencies.reviews.saveCandidate({
		...candidate,
		insertedSessionId: revision.data.id,
	});
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("keating:sessions-changed", {
			detail: { sessionId: revision.data.id, parentSessionId: source.id, reviewRevision: true },
		}));
	}
	return { ...revision, candidate: nextCandidate };
}
