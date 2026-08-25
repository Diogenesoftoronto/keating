import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	buildAnnotationExpansionPrompt,
	buildCritiqueSweepPrompt,
	buildPatternDigestPrompt,
	buildRubricScorePrompt,
	parseAnnotationExpansion,
	parseCritiqueSweep,
	parsePatternDigest,
	parseRubricSweep,
	runReviewPass,
	type AnnotationExpansionProposal,
	type CritiqueProposal,
	type DigestSessionInput,
	type PatternDigestProposal,
	type ReviewPassKind,
	type RubricSweepProposal,
} from "../keating/trajectory-passes";
import {
	contentFingerprint,
	reviewMessageText,
	type AnnotationKind,
	type ReviewModelPool,
	type TrajectoryAnnotation,
	type TrajectoryReviewTarget,
} from "../keating/trajectory-review";

export interface ReviewPassRunInfo {
	model: string;
	latencyMs: number;
	at: number;
}

export interface UseReviewPassesResult {
	/** Which pass is in flight, if any. At most one runs at a time. */
	running: ReviewPassKind | null;
	error: string | null;
	critique: CritiqueProposal[];
	rubric: RubricSweepProposal | null;
	digest: PatternDigestProposal | null;
	lastRun: Partial<Record<ReviewPassKind, ReviewPassRunInfo>>;
	runCritiqueSweep: (pool: ReviewModelPool) => Promise<CritiqueProposal[]>;
	runRubricScore: (pool: ReviewModelPool) => Promise<RubricSweepProposal | null>;
	runPatternDigest: (pool: ReviewModelPool, sessions: readonly DigestSessionInput[]) => Promise<PatternDigestProposal | null>;
	expandAnnotation: (pool: ReviewModelPool, input: {
		note: string;
		kind: AnnotationKind;
		category?: string;
		quotedText?: string;
	}) => Promise<AnnotationExpansionProposal | null>;
	dismissCritique: (id: string) => void;
	clearCritique: () => void;
	clearRubric: () => void;
	cancel: () => void;
	dismissError: () => void;
}

/**
 * Turns a critique proposal into the annotation target it belongs on.
 *
 * An anchored proposal becomes a `message-span` so the note lands on the exact
 * sentence the pass quoted; an unanchored one falls back to the whole turn, and
 * one that cites no turn at all becomes a session-level note. The proposal is
 * never silently discarded for failing to anchor — a teacher can still act on
 * "you rushed the middle third" even when the model could not point at it.
 */
export function critiqueProposalTarget(
	proposal: CritiqueProposal,
	messages: readonly AgentMessage[],
): TrajectoryReviewTarget {
	if (!proposal.messageId) return { kind: "session" };
	const message = messages.find((entry) => (entry as { id?: unknown }).id === proposal.messageId);
	if (!message) return { kind: "session" };

	const role = String((message as { role?: unknown }).role ?? "assistant");
	const messageTimestamp = typeof (message as { timestamp?: unknown }).timestamp === "number"
		? (message as { timestamp: number }).timestamp
		: undefined;

	if (proposal.anchor) {
		return { kind: "message-span", messageId: proposal.messageId, role, messageTimestamp, anchor: proposal.anchor };
	}
	return {
		kind: "message",
		messageId: proposal.messageId,
		role,
		messageTimestamp,
		contentFingerprint: contentFingerprint(reviewMessageText(message)),
	};
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Owns AI pass state for one session's review.
 *
 * Deliberately separate from `useTrajectoryReview`: passes produce proposals
 * that live only in memory, so keeping them out of the store-backed hook means
 * a failed or half-read pass can never leave residue in the saved review.
 */
export function useReviewPasses(
	sessionId: string,
	messages: readonly AgentMessage[],
	existingAnnotations: readonly TrajectoryAnnotation[] = [],
): UseReviewPassesResult {
	const [running, setRunning] = useState<ReviewPassKind | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [critique, setCritique] = useState<CritiqueProposal[]>([]);
	const [rubric, setRubric] = useState<RubricSweepProposal | null>(null);
	const [digest, setDigest] = useState<PatternDigestProposal | null>(null);
	const [lastRun, setLastRun] = useState<Partial<Record<ReviewPassKind, ReviewPassRunInfo>>>({});
	const abort = useRef<AbortController | null>(null);

	// Proposals belong to the session that produced them.
	useEffect(() => {
		abort.current?.abort();
		abort.current = null;
		setRunning(null);
		setCritique([]);
		setRubric(null);
		setError(null);
	}, [sessionId]);

	useEffect(() => () => abort.current?.abort(), []);

	const execute = useCallback(async <T,>(
		kind: ReviewPassKind,
		pool: ReviewModelPool,
		prompt: string,
		parse: (text: string) => T,
	): Promise<T | null> => {
		abort.current?.abort();
		const controller = new AbortController();
		abort.current = controller;
		setRunning(kind);
		setError(null);
		try {
			const run = await runReviewPass({ kind, prompt, pool, signal: controller.signal });
			if (controller.signal.aborted) return null;
			const parsed = parse(run.text);
			setLastRun((current) => ({
				...current,
				[kind]: { model: `${run.model.provider}/${run.model.id}`, latencyMs: run.latencyMs, at: Date.now() },
			}));
			return parsed;
		} catch (cause) {
			if (controller.signal.aborted) return null;
			setError(errorMessage(cause));
			return null;
		} finally {
			if (abort.current === controller) {
				abort.current = null;
				setRunning((current) => (current === kind ? null : current));
			}
		}
	}, []);

	const runCritiqueSweep = useCallback(async (pool: ReviewModelPool) => {
		const proposals = await execute(
			"critique-sweep",
			pool,
			buildCritiqueSweepPrompt({ trajectory: messages, existingAnnotations }),
			(text) => parseCritiqueSweep(text, messages),
		);
		if (proposals) setCritique(proposals);
		return proposals ?? [];
	}, [execute, existingAnnotations, messages]);

	const runRubricScore = useCallback(async (pool: ReviewModelPool) => {
		const parsed = await execute(
			"rubric-score",
			pool,
			buildRubricScorePrompt(messages),
			(text) => parseRubricSweep(text, messages),
		);
		if (parsed) setRubric(parsed);
		return parsed;
	}, [execute, messages]);

	const runPatternDigest = useCallback(async (pool: ReviewModelPool, sessions: readonly DigestSessionInput[]) => {
		if (sessions.length < 2) {
			setError("A pattern digest needs at least two finished reviews.");
			return null;
		}
		const parsed = await execute(
			"pattern-digest",
			pool,
			buildPatternDigestPrompt(sessions),
			(text) => parsePatternDigest(text),
		);
		if (parsed) setDigest(parsed);
		return parsed;
	}, [execute]);

	const expandAnnotation = useCallback(async (
		pool: ReviewModelPool,
		input: { note: string; kind: AnnotationKind; category?: string; quotedText?: string },
	) => execute(
		"annotation-expand",
		pool,
		buildAnnotationExpansionPrompt({ ...input, trajectory: messages }),
		parseAnnotationExpansion,
	), [execute, messages]);

	const dismissCritique = useCallback((id: string) => {
		setCritique((current) => current.filter((proposal) => proposal.id !== id));
	}, []);

	const cancel = useCallback(() => {
		abort.current?.abort();
		abort.current = null;
		setRunning(null);
	}, []);

	return {
		running,
		error,
		critique,
		rubric,
		digest,
		lastRun,
		runCritiqueSweep,
		runRubricScore,
		runPatternDigest,
		expandAnnotation,
		dismissCritique,
		clearCritique: useCallback(() => setCritique([]), []),
		clearRubric: useCallback(() => setRubric(null), []),
		cancel,
		dismissError: useCallback(() => setError(null), []),
	};
}
