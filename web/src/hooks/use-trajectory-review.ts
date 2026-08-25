import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionData } from "../types/session";
import { getInitPromise, keatingStorage, sessions } from "./keating-storage";
import {
	TRAJECTORY_IMAGE_CAPTURE_LIMITS,
	captureSessionArtifactVersions,
	createArtifactRevisionSnapshot,
	validatePersistedArtifactSnapshot,
} from "../keating/trajectory-artifacts";
import {
	buildTrajectoryReviewArchive,
	downloadTrajectoryReviewArchive,
} from "../keating/trajectory-export";
import {
	assertTextReviewCandidateGeneration,
	generateReviewCandidates,
} from "../keating/trajectory-generation";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	createReviewRecordId,
	defaultReviewModelPools,
	reviewTargetKey,
	sha256ContentHash,
	type ReviewArtifactSnapshot,
	type ReviewCandidateTarget,
	type ReviewGenerationCandidate,
	type ReviewModelPool,
	type TrajectoryAnnotation,
	type TrajectoryReview,
	type TrajectoryReviewTarget,
} from "../keating/trajectory-review";
import { insertReviewResponseCandidate } from "../keating/trajectory-session";
import { trajectoryReviewStore } from "../keating/trajectory-store";

export interface TrajectoryAnnotationInput {
	id?: string;
	target: TrajectoryReviewTarget;
	kind: TrajectoryAnnotation["kind"];
	category: string;
	severity?: TrajectoryAnnotation["severity"];
	note: string;
	pedagogicalImpact?: string;
	suggestedAlternative?: string;
	authorship?: TrajectoryAnnotation["authorship"];
	fieldAuthorship?: TrajectoryAnnotation["fieldAuthorship"];
	revision?: TrajectoryAnnotation["revision"];
	status?: TrajectoryAnnotation["status"];
}

export interface UseTrajectoryReviewResult {
	session: SessionData | null;
	review: TrajectoryReview | null;
	annotations: TrajectoryAnnotation[];
	artifacts: ReviewArtifactSnapshot[];
	modelPools: ReviewModelPool[];
	candidates: ReviewGenerationCandidate[];
	loading: boolean;
	busy: { saving: boolean; generating: boolean; exporting: boolean };
	error: string | null;
	reload: () => Promise<void>;
	saveReview: (next: TrajectoryReview) => Promise<TrajectoryReview>;
	saveAnnotation: (input: TrajectoryAnnotationInput) => Promise<TrajectoryAnnotation>;
	deleteAnnotation: (id: string) => Promise<void>;
	saveModelPool: (pool: ReviewModelPool) => Promise<ReviewModelPool>;
	deleteModelPool: (id: string) => Promise<void>;
	generateCandidates: (target: ReviewCandidateTarget, poolId: string, annotationIds?: string[]) => Promise<ReviewGenerationCandidate[]>;
	chooseCandidate: (candidateId: string) => Promise<void>;
	insertCandidate: (candidateId: string) => Promise<string>;
	acceptArtifactRevision: (candidateId: string) => Promise<ReviewArtifactSnapshot>;
	exportArchive: () => Promise<void>;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function useTrajectoryReview(sessionId: string): UseTrajectoryReviewResult {
	const store = useMemo(() => trajectoryReviewStore(), []);
	const [session, setSession] = useState<SessionData | null>(null);
	const [review, setReview] = useState<TrajectoryReview | null>(null);
	const [annotations, setAnnotations] = useState<TrajectoryAnnotation[]>([]);
	const [artifacts, setArtifacts] = useState<ReviewArtifactSnapshot[]>([]);
	const [modelPools, setModelPools] = useState<ReviewModelPool[]>([]);
	const [candidates, setCandidates] = useState<ReviewGenerationCandidate[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState({ saving: false, generating: false, exporting: false });
	const [error, setError] = useState<string | null>(null);
	const currentSessionId = useRef(sessionId);
	currentSessionId.current = sessionId;
	const loadSequence = useRef(0);
	const generationSequence = useRef(0);
	const generationAbort = useRef<AbortController | null>(null);
	const saveReviewQueue = useRef<Promise<void>>(Promise.resolve());
	const pendingReviewSaves = useRef(0);
	const isCurrentSessionLoad = useCallback((sequence: number, expectedSessionId: string) => (
		sequence === loadSequence.current && expectedSessionId === currentSessionId.current
	), []);

	const reload = useCallback(async () => {
		const requestedSessionId = sessionId;
		const sequence = ++loadSequence.current;
		setLoading(true);
		setError(null);
		try {
			await getInitPromise();
			const loadedSession = await sessions.loadSession(sessionId) as SessionData | null;
			if (!loadedSession) throw new Error("This session is not available in local storage.");
			const loadedReview = await store.getOrCreateReview(sessionId);
			let [loadedAnnotations, loadedCandidates, loadedPools, loadedArtifacts, capturedArtifacts] = await Promise.all([
				store.listAnnotations(loadedReview.id),
				store.listCandidates(loadedReview.id),
				store.listModelPools(),
				store.listArtifactVersions(loadedReview.id),
				captureSessionArtifactVersions(keatingStorage, loadedReview.id, sessionId, Date.now(), loadedSession.messages),
			]);
			const validatedArtifacts: ReviewArtifactSnapshot[] = [];
			let validatedMediaCount = 0;
			for (const artifact of loadedArtifacts) {
				if (artifact.media && validatedMediaCount >= TRAJECTORY_IMAGE_CAPTURE_LIMITS.maxImages) continue;
				const validated = await validatePersistedArtifactSnapshot(artifact);
				if (!validated) continue;
				validatedArtifacts.push(validated);
				if (validated.media) validatedMediaCount += 1;
			}
			loadedArtifacts = validatedArtifacts;
			if (loadedPools.length === 0) {
				loadedPools = await Promise.all(defaultReviewModelPools(loadedSession.model).map((pool) => store.saveModelPool(pool)));
			}
			const storedArtifactIds = new Set(loadedArtifacts.map((artifact) => artifact.id));
			const unseenArtifacts = capturedArtifacts.filter((artifact) => !storedArtifactIds.has(artifact.id));
			if (unseenArtifacts.length > 0) {
				await Promise.all(unseenArtifacts.map((artifact) => store.saveArtifactVersion(artifact)));
			}
			loadedArtifacts = [...loadedArtifacts, ...unseenArtifacts]
				.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
			if (!isCurrentSessionLoad(sequence, requestedSessionId)) return;
			setSession(loadedSession);
			setReview(loadedReview);
			setAnnotations(loadedAnnotations);
			setCandidates(loadedCandidates);
			setModelPools(loadedPools);
			setArtifacts(loadedArtifacts);
		} catch (cause) {
			if (isCurrentSessionLoad(sequence, requestedSessionId)) setError(errorMessage(cause));
		} finally {
			if (isCurrentSessionLoad(sequence, requestedSessionId)) setLoading(false);
		}
	}, [isCurrentSessionLoad, sessionId, store]);

	useEffect(() => {
		generationAbort.current?.abort();
		generationSequence.current += 1;
		setSession(null);
		setReview(null);
		setAnnotations([]);
		setArtifacts([]);
		setModelPools([]);
		setCandidates([]);
		setBusy({ saving: false, generating: false, exporting: false });
		void reload();
		return () => {
			generationAbort.current?.abort();
			generationSequence.current += 1;
			loadSequence.current += 1;
		};
	}, [reload]);

	const saveReview = useCallback((next: TrajectoryReview) => {
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		pendingReviewSaves.current += 1;
		setBusy((current) => ({ ...current, saving: true }));
		setError(null);
		const pending = saveReviewQueue.current.then(() => store.saveReview(next));
		saveReviewQueue.current = pending.then(() => undefined, () => undefined);
		return pending.then(
			(saved) => {
				if (isCurrentSessionLoad(requestSequence, requestSessionId)) setReview(saved);
				return saved;
			},
			(cause) => {
				if (isCurrentSessionLoad(requestSequence, requestSessionId)) setError(errorMessage(cause));
				throw cause;
			},
		).finally(() => {
			pendingReviewSaves.current -= 1;
			if (isCurrentSessionLoad(requestSequence, requestSessionId) && pendingReviewSaves.current === 0) {
				setBusy((current) => ({ ...current, saving: false }));
			}
		});
	}, [isCurrentSessionLoad, sessionId, store]);

	const saveAnnotation = useCallback(async (input: TrajectoryAnnotationInput) => {
		if (!review) throw new Error("The trajectory review has not loaded yet.");
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		const existing = input.id ? annotations.find((annotation) => annotation.id === input.id) : undefined;
		const now = Date.now();
		const annotation: TrajectoryAnnotation = {
			schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
			id: existing?.id ?? createReviewRecordId("annotation"),
			reviewId: review.id,
			sessionId: review.sessionId,
			target: input.target,
			targetKey: reviewTargetKey(input.target),
			kind: input.kind,
			category: input.category.trim() || "pedagogy",
			severity: input.severity,
			note: input.note.trim(),
			pedagogicalImpact: input.pedagogicalImpact?.trim() || undefined,
			suggestedAlternative: input.suggestedAlternative?.trim() || undefined,
			authorship: input.authorship ?? existing?.authorship ?? "human",
			fieldAuthorship: input.fieldAuthorship ?? existing?.fieldAuthorship,
			revision: input.revision ?? existing?.revision,
			status: input.status ?? existing?.status ?? "draft",
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		if (!annotation.note) throw new Error("An annotation needs a note.");
		const saved = await store.saveAnnotation(annotation);
		if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
			setAnnotations((current) => [...current.filter((entry) => entry.id !== saved.id), saved]
				.sort((left, right) => left.updatedAt - right.updatedAt));
		}
		return saved;
	}, [annotations, isCurrentSessionLoad, review, sessionId, store]);

	const deleteAnnotation = useCallback(async (id: string) => {
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		await store.deleteAnnotation(id, sessionId);
		if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
			setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
		}
	}, [isCurrentSessionLoad, sessionId, store]);

	const saveModelPool = useCallback(async (pool: ReviewModelPool) => {
		const saved = await store.saveModelPool(pool);
		setModelPools((current) => [...current.filter((entry) => entry.id !== saved.id), saved]
			.sort((left, right) => left.updatedAt - right.updatedAt));
		return saved;
	}, [store]);

	const deleteModelPool = useCallback(async (id: string) => {
		await store.deleteModelPool(id);
		setModelPools((current) => current.filter((pool) => pool.id !== id));
	}, [store]);

	const generateCandidates = useCallback(async (
		target: ReviewCandidateTarget,
		poolId: string,
		annotationIds?: string[],
	) => {
		if (!review || !session) throw new Error("The trajectory review has not loaded yet.");
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		const pool = modelPools.find((entry) => entry.id === poolId);
		if (!pool) throw new Error("Choose an available model pool first.");
		const selectedAnnotations = annotationIds
			? annotations.filter((annotation) => annotationIds.includes(annotation.id))
			: annotations.filter((annotation) => annotation.targetKey === reviewTargetKey(target));
		generationAbort.current?.abort();
		const controller = new AbortController();
		generationAbort.current = controller;
		const sequence = ++generationSequence.current;
		setBusy((current) => ({ ...current, generating: true }));
		setError(null);
		try {
			const generated = await generateReviewCandidates({
				reviewId: review.id,
				sessionId,
				target,
				trajectory: session.messages,
				annotations: selectedAnnotations,
				pool,
				signal: controller.signal,
				onCandidate: async (candidate) => {
					const stale = sequence !== generationSequence.current
						|| controller.signal.aborted
						|| !isCurrentSessionLoad(requestSequence, requestSessionId);
					if (stale && candidate.state !== "cancelled") return;
					const saved = await store.saveCandidate(candidate);
					if (sequence !== generationSequence.current
						|| controller.signal.aborted
						|| !isCurrentSessionLoad(requestSequence, requestSessionId)) return;
					setCandidates((current) => [...current.filter((entry) => entry.id !== saved.id), saved]
						.sort((left, right) => left.createdAt - right.createdAt));
				},
			});
			return generated;
		} catch (cause) {
			if (controller.signal.aborted
				|| sequence !== generationSequence.current
				|| !isCurrentSessionLoad(requestSequence, requestSessionId)) return [];
			setError(errorMessage(cause));
			throw cause;
		} finally {
			if (sequence === generationSequence.current) {
				generationAbort.current = null;
				if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
					setBusy((current) => ({ ...current, generating: false }));
				}
			}
		}
	}, [annotations, isCurrentSessionLoad, modelPools, review, session, sessionId, store]);

	const chooseCandidate = useCallback(async (candidateId: string) => {
		if (!review) throw new Error("The trajectory review has not loaded yet.");
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		const choice = await store.chooseCandidate(review, candidateId);
		if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
			setReview(choice.review);
			setCandidates(choice.candidates);
		}
	}, [isCurrentSessionLoad, review, sessionId, store]);

	const insertCandidate = useCallback(async (candidateId: string) => {
		if (!session) throw new Error("The trajectory review has not loaded yet.");
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		const candidate = candidates.find((entry) => entry.id === candidateId);
		if (!candidate) throw new Error("Review candidate not found.");
		const inserted = await insertReviewResponseCandidate(session, candidate, { sessions, reviews: store });
		if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
			setCandidates((current) => current.map((entry) => entry.id === inserted.candidate.id ? inserted.candidate : entry));
		}
		return inserted.data.id;
	}, [candidates, isCurrentSessionLoad, session, sessionId, store]);

	const acceptArtifactRevision = useCallback(async (candidateId: string) => {
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		const candidate = candidates.find((entry) => entry.id === candidateId);
		if (!candidate || candidate.target.kind !== "artifact" || candidate.state !== "completed" || !candidate.content) {
			throw new Error("Only a completed artifact candidate can be accepted.");
		}
		assertTextReviewCandidateGeneration(candidate.target);
		const targetArtifact = candidate.target.artifact;
		const original = artifacts.find((artifact) => artifact.artifact.versionId === targetArtifact.versionId
			&& artifact.artifact.contentHash === targetArtifact.contentHash);
		if (!original) throw new Error("The frozen source artifact is no longer available in this review.");
		const hash = await sha256ContentHash(candidate.content);
		const revision = createArtifactRevisionSnapshot(original, candidate.content, hash, candidate.id);
		await store.saveArtifactVersion(revision);
		const savedCandidate = await store.saveCandidate({ ...candidate, materializedArtifactId: revision.id });
		if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
			setArtifacts((current) => [...current.filter((entry) => entry.id !== revision.id), revision]);
			setCandidates((current) => current.map((entry) => entry.id === savedCandidate.id ? savedCandidate : entry));
		}
		return revision;
	}, [artifacts, candidates, isCurrentSessionLoad, sessionId, store]);

	const exportArchive = useCallback(async () => {
		if (!session || !review) throw new Error("The trajectory review has not loaded yet.");
		const requestSequence = loadSequence.current;
		const requestSessionId = sessionId;
		setBusy((current) => ({ ...current, exporting: true }));
		setError(null);
		try {
			const snapshot = await store.exportSnapshot(review.id);
			const archive = buildTrajectoryReviewArchive({
				snapshot,
				session: { id: session.id, title: session.title, messages: session.messages },
			});
			if (isCurrentSessionLoad(requestSequence, requestSessionId)) downloadTrajectoryReviewArchive(archive);
		} catch (cause) {
			if (isCurrentSessionLoad(requestSequence, requestSessionId)) setError(errorMessage(cause));
			throw cause;
		} finally {
			if (isCurrentSessionLoad(requestSequence, requestSessionId)) {
				setBusy((current) => ({ ...current, exporting: false }));
			}
		}
	}, [isCurrentSessionLoad, review, session, sessionId, store]);

	return {
		session,
		review,
		annotations,
		artifacts,
		modelPools,
		candidates,
		loading,
		busy,
		error,
		reload,
		saveReview,
		saveAnnotation,
		deleteAnnotation,
		saveModelPool,
		deleteModelPool,
		generateCandidates,
		chooseCandidate,
		insertCandidate,
		acceptArtifactRevision,
		exportArchive,
	};
}
