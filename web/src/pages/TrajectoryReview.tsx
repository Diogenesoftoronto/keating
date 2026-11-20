import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Link, useParams } from "@tanstack/react-router";
import { Loading } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { css } from "../../styled-system/css";
import { TrajectoryReviewWorkspace } from "../components/trajectory/TrajectoryReviewWorkspace";
import type {
	NormalizedTrajectoryArtifact,
	TrajectoryAnnotationDraft,
	TrajectoryReviewWorkspaceCallbacks,
	TrajectorySessionMessage,
	TrajectoryTextSelection,
	TrajectorySelectionIntent,
} from "../components/trajectory/types";
import { useTrajectoryReview } from "../hooks/use-trajectory-review";
import { useTurnJudgementReview } from "../hooks/use-turn-judgement-review";
import { JudgementReviewContext } from "../components/trajectory/judgement-review-context";
import type { TurnJudgementRecord } from "../keating/judgement/turn-records";
import { keatingStorage } from "../hooks/keating-storage";
import type { TeachingDraftReceiptRecord } from "../keating/storage";
import { critiqueProposalTarget, useReviewPasses } from "../hooks/use-review-passes";
import { markPassDrafted, overallAuthorship } from "../keating/annotation-provenance";
import { rubricProposalMatchesTrajectory, type CritiqueProposal, type RubricSweepProposal } from "../keating/trajectory-passes";
import type { TrajectoryPassCallbacks, TrajectoryPassState } from "../components/trajectory/types";
import { checkBrowserModelAvailability, discoverModels } from "../lib/model-catalog";
import { reviewArtifactDisplayText } from "../keating/trajectory-artifacts";
import {
	learnerResponseReviewMarkdown,
	learnerResponseReviewText,
} from "../keating/learner-response";
import { assertTextReviewCandidateGeneration } from "../keating/trajectory-generation";
import { collectReviewToolOutcomes, reviewMessageDisplay } from "../keating/trajectory-message-display";
import { foldToolSteps } from "../components/trajectory/tool-activity";
import {
	initialReviewWorkspaceUiState,
	reviewWorkspaceUiReducer,
} from "../keating/trajectory-review-ui-state";
import {
	TRAJECTORY_REVIEW_SCHEMA_VERSION,
	artifactVersionKey,
	createReviewRecordId,
	messageReviewAnchor,
	reviewTargetKey,
	storedModelReference,
	type ReviewCandidateTarget,
	type ReviewGenerationCandidate,
	type ReviewGenerationTask,
	type AuthoredAnnotationField,
	type ReviewModelPool,
	type TrajectoryAnnotation,
	type TrajectoryReviewTarget,
} from "../keating/trajectory-review";

function labelForRole(role: string): string {
	if (role === "assistant") return "Tutor response";
	if (role === "user" || role === "user-with-attachments") return "Learner message";
	if (role === "toolResult") return "Tool result";
	return role.replaceAll(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Messages as a teacher reviews them: learner messages and tutor replies. Tool
 * calls and their results are agent steps, not turns, and travel with the reply
 * they led to. A step stays a turn of its own only when something is pinned to
 * it already (a note, a draft receipt, a judgement, or a generated candidate).
 */
function reviewTurns(sessionId: string, messages: readonly AgentMessage[], receipts: readonly TeachingDraftReceiptRecord[], turns: readonly TurnJudgementRecord[], annotations: readonly TrajectoryAnnotation[], candidates: readonly ReviewGenerationCandidate[]) {
	const proseIds = new Set<string>();
	const all = normalizedMessages(sessionId, messages, receipts, turns, proseIds);
	const pinned = new Set(annotations.flatMap((annotation) => "messageId" in annotation.target ? [annotation.target.messageId] : []));
	for (const { target } of candidates) {
		if (target.kind === "response") pinned.add(target.messageId);
	}
	return foldToolSteps(all, {
		hasProse: (message) => proseIds.has(message.id),
		keep: (message) => pinned.has(message.id) || Boolean(message.draftReview || message.turnJudgement),
	});
}

function normalizedMessages(sessionId: string, messages: readonly AgentMessage[], receipts: readonly TeachingDraftReceiptRecord[] = [], turns: readonly TurnJudgementRecord[] = [], proseIds?: Set<string>): TrajectorySessionMessage[] {
	const toolOutcomes = collectReviewToolOutcomes(messages);
	const receiptByTimestamp = new Map(receipts.map((receipt) => [receipt.messageTimestamp, receipt]));
	const turnByAssistant = new Map(turns.map((turn) => [turn.assistantTimestamp, turn]));
	const turnByLearner = new Map(turns.flatMap((turn) => turn.learnerTimestamp === undefined ? [] : [[turn.learnerTimestamp, turn] as const]));
	return messages.map((message, ordinal) => {
		const anchor = messageReviewAnchor(sessionId, message, ordinal);
		const entry = message as { role?: string; model?: string; stopReason?: string; errorMessage?: string };
		const display = reviewMessageDisplay(message, toolOutcomes);
		const rawSource = reviewArtifactDisplayText(anchor.text);
		const displayText = learnerResponseReviewText(rawSource);
		if (display.markdown || entry.errorMessage) proseIds?.add(anchor.id);
		return {
			...anchor,
			role: entry.role === "user-with-attachments" ? "user" : entry.role === "toolResult" ? "tool" : anchor.role,
			text: displayText || entry.errorMessage || `[${labelForRole(anchor.role)}]`,
			markdown: learnerResponseReviewMarkdown(rawSource),
			rawSource,
			raw: display.raw,
			tools: display.tools,
			label: labelForRole(anchor.role),
			model: entry.model,
			status: entry.stopReason === "error" || entry.stopReason === "aborted" ? "failed" : "complete",
			...(entry.role === "assistant" && anchor.timestamp !== undefined && receiptByTimestamp.has(anchor.timestamp)
				? { draftReview: receiptByTimestamp.get(anchor.timestamp) }
				: {}),
			...(() => {
				const turns = entry.role === "assistant" ? turnByAssistant : entry.role === "user" || entry.role === "user-with-attachments" ? turnByLearner : null;
				const turn = anchor.timestamp === undefined ? undefined : turns?.get(anchor.timestamp);
				return turn ? { turnJudgement: turn } : {};
			})(),
		};
	});
}

function candidateForMessage(message: TrajectorySessionMessage): ReviewCandidateTarget {
	return {
		kind: "response",
		messageId: message.id,
		messageTimestamp: message.timestamp,
		originalContent: message.text,
	};
}

function annotationMatchesCandidate(annotation: TrajectoryAnnotation, target: ReviewCandidateTarget): boolean {
	if (target.kind === "response") {
		return (annotation.target.kind === "message" || annotation.target.kind === "message-span")
			&& annotation.target.messageId === target.messageId;
	}
	const annotationTarget = annotation.target;
	return annotationTarget.kind.startsWith("artifact") && "artifact" in annotationTarget
		&& artifactVersionKey(annotationTarget.artifact) === artifactVersionKey(target.artifact);
}

function draftForTarget(target: TrajectoryReviewTarget, intent?: TrajectorySelectionIntent): TrajectoryAnnotationDraft {
	const quote = target.kind === "message-span" || target.kind === "artifact-span" ? target.anchor.quote : "";
	// A rewrite is an annotation whose alternative is the new text and whose revision
	// remembers the old one. Seeding the alternative with the quote means the teacher
	// edits the sentence rather than retyping it.
	const rewriting = intent?.intent === "rewrite" && Boolean(quote);
	return {
		target,
		targetKey: reviewTargetKey(target),
		kind: intent?.kind ?? "problem",
		// Category is inferable from the note and is defaulted on save; leaving it
		// empty keeps the "why" the only field the teacher must supply.
		category: "",
		note: "",
		pedagogicalImpact: "",
		suggestedAlternative: rewriting ? quote : "",
		revision: rewriting ? { original: quote } : undefined,
		status: "draft",
	};
}

function generationTargetKey(target: TrajectoryReviewTarget): string {
	if (target.kind === "message" || target.kind === "message-span") return `message:${target.messageId}`;
	if (target.kind.startsWith("artifact") && "artifact" in target) {
		return reviewTargetKey({ kind: "artifact", artifact: target.artifact });
	}
	return reviewTargetKey(target);
}

function annotationSourceId(
	target: TrajectoryReviewTarget,
	artifacts: readonly NormalizedTrajectoryArtifact[],
): string | undefined {
	if (target.kind === "message" || target.kind === "message-span") return target.messageId;
	if (target.kind.startsWith("artifact") && "artifact" in target) {
		const targetVersionKey = artifactVersionKey(target.artifact);
		return artifacts.find((artifact) => artifactVersionKey(artifact.reference) === targetVersionKey)?.id;
	}
	return undefined;
}

function draftFromAnnotation(annotation: TrajectoryAnnotation): TrajectoryAnnotationDraft {
	return {
		id: annotation.id,
		target: annotation.target,
		targetKey: annotation.targetKey,
		kind: annotation.kind,
		category: annotation.category,
		severity: annotation.severity,
		note: annotation.note,
		pedagogicalImpact: annotation.pedagogicalImpact,
		suggestedAlternative: annotation.suggestedAlternative,
		status: annotation.status,
	};
}

function pageError(message: string) {
	return (
		<main className={css({ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "1.5rem", background: "var(--background)", color: "var(--foreground)" })}>
			<div className={css({ maxWidth: "32rem" })}>
				<Link to="/review" className={css({ display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: "2.5rem", color: "var(--muted-foreground)", fontSize: "0.8125rem", _hover: { color: "var(--foreground)" } })}><KeatingGlyph name="left" size={15} /> Reviews</Link>
				<h1 className={css({ marginTop: "0.75rem", fontFamily: "serif", fontSize: "1.5rem", fontWeight: 650 })}>Review unavailable</h1>
				<p role="alert" className={css({ marginTop: "0.5rem", color: "var(--muted-foreground)", fontSize: "0.875rem", lineHeight: 1.6 })}>{message}</p>
			</div>
		</main>
	);
}

export function TrajectoryReview() {
	const params = useParams({ strict: false }) as { sessionId?: string };
	const sessionId = params.sessionId ?? "";
	const reviewState = useTrajectoryReview(sessionId);
	const passes = useReviewPasses(sessionId, reviewState.session?.messages ?? [], reviewState.annotations);
	const [ui, dispatchUi] = useReducer(reviewWorkspaceUiReducer, initialReviewWorkspaceUiState);
	const currentSessionId = useRef(sessionId);
	currentSessionId.current = sessionId;

	useEffect(() => {
		dispatchUi({ type: "reset", sessionId });
	}, [sessionId]);

	useEffect(() => {
		if (reviewState.review) dispatchUi({ type: "sync-review", review: reviewState.review });
	}, [reviewState.review]);

	// Same catalog the chat model picker reads, so a provider hidden in settings
	// or a custom model added there means the same thing in a review pool — and
	// a pool holding a custom model is not wrongly flagged as uninstallable.
	useEffect(() => {
		let cancelled = false;
		void checkBrowserModelAvailability()
			.then(discoverModels)
			.then((entries) => {
				if (!cancelled) dispatchUi({ type: "models-loaded", models: entries.map((entry) => storedModelReference(entry.model)) });
			})
			.catch((cause) => {
				if (!cancelled) dispatchUi({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId]);

	const [draftReceipts, setDraftReceipts] = useState<TeachingDraftReceiptRecord[]>([]);
	useEffect(() => {
		const reviewedSessionId = reviewState.session?.id;
		if (!reviewedSessionId) return;
		let cancelled = false;
		keatingStorage.getTeachingDraftReceipts(reviewedSessionId)
			.then((receipts) => { if (!cancelled) setDraftReceipts(receipts); })
			.catch(() => { if (!cancelled) setDraftReceipts([]); });
		return () => { cancelled = true; };
	}, [reviewState.session]);
	const judgementReview = useTurnJudgementReview(reviewState.session?.id, draftReceipts);
	const { turns: messages, hostOf: stepHosts } = useMemo(
		() => reviewState.session
			? reviewTurns(reviewState.session.id, reviewState.session.messages, draftReceipts, judgementReview.records, reviewState.annotations, reviewState.candidates)
			: { turns: [] as TrajectorySessionMessage[], hostOf: new Map<string, string>() },
		[draftReceipts, judgementReview.records, reviewState.annotations, reviewState.candidates, reviewState.session],
	);
	const artifacts = useMemo<NormalizedTrajectoryArtifact[]>(
		() => reviewState.artifacts.map((snapshot) => ({
			id: snapshot.id,
			title: snapshot.label,
			reference: snapshot.artifact,
			summary: snapshot.topic ? `${snapshot.topic} · captured ${new Date(snapshot.capturedAt).toLocaleString()}` : undefined,
			media: snapshot.media ? {
				kind: "image" as const,
				src: snapshot.media.dataUrl,
				alt: snapshot.media.alt,
				assetHash: snapshot.media.assetHash,
				naturalWidth: snapshot.media.naturalWidth,
				naturalHeight: snapshot.media.naturalHeight,
			} : undefined,
			plainText: snapshot.artifact.artifactType === "animation"
				? snapshot.secondaryContent || "Animation source is frozen. Review its storyboard or annotate the whole artifact."
				: snapshot.content,
			createdAt: snapshot.createdAt,
			status: "ready",
		})),
		[reviewState.artifacts],
	);

	useEffect(() => {
		if (!ui.activeTurnId && messages.length > 0) {
			const initial = messages.find((message) => message.role === "assistant") ?? messages[0];
			dispatchUi({ type: "hydrate", turnId: initial.id, turnTargetKey: reviewTargetKey({
				kind: "message",
				messageId: initial.id,
				role: initial.role,
				messageTimestamp: initial.timestamp,
				contentFingerprint: initial.contentFingerprint,
			}) });
		}
	}, [messages, ui.activeTurnId]);

	useEffect(() => {
		if (!ui.activeArtifactId && artifacts.length > 0) dispatchUi({ type: "hydrate", artifactId: artifacts[0].id });
	}, [artifacts, ui.activeArtifactId]);

	useEffect(() => {
		if (!ui.activeModelPoolId && reviewState.modelPools.length > 0) dispatchUi({ type: "hydrate", poolId: reviewState.modelPools[0].id });
	}, [reviewState.modelPools, ui.activeModelPoolId]);

	const run = useCallback((work: (isCurrent: () => boolean) => Promise<unknown>) => {
		const originSessionId = sessionId;
		const isCurrent = () => currentSessionId.current === originSessionId;
		dispatchUi({ type: "error", message: null });
		void work(isCurrent).catch((cause) => {
			if (isCurrent()) dispatchUi({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
		});
	}, [sessionId]);

	const targetForActiveSelection = useCallback((): ReviewCandidateTarget => {
		const message = messages.find((entry) => entry.id === ui.activeTurnId);
		const artifact = artifacts.find((entry) => entry.id === ui.activeArtifactId);
		if (ui.activeSource === "artifact" && artifact) {
			const target: ReviewCandidateTarget = {
				kind: "artifact",
				artifact: artifact.reference,
				topic: reviewState.artifacts.find((entry) => entry.id === artifact.id)?.topic ?? artifact.title,
				originalContent: reviewState.artifacts.find((entry) => entry.id === artifact.id)?.content ?? artifact.plainText ?? "",
			};
			assertTextReviewCandidateGeneration(target);
			return target;
		}
		if (message?.role === "assistant") return candidateForMessage(message);
		throw new Error("Select a tutor response or artifact before generating candidates.");
	}, [artifacts, messages, reviewState.artifacts, ui.activeArtifactId, ui.activeSource, ui.activeTurnId]);

	const generate = useCallback((target: ReviewCandidateTarget, poolId: string, annotationIds?: string[]) => {
		run(() => reviewState.generateCandidates(target, poolId, annotationIds));
	}, [reviewState, run]);

	if (!sessionId) return pageError("No session was selected.");
	if (reviewState.loading) {
		return (
			<main>
				<Loading size="page" label="Loading review workspace…" />
			</main>
		);
	}
	if (!reviewState.session || !reviewState.review) return pageError(reviewState.error ?? "The review could not be loaded.");

	function selectTurn(requestedId: string) {
		// A pass may point at a tool step. Open the turn that carries it.
		const messageId = stepHosts.get(requestedId) ?? requestedId;
		if (messages.some((message) => message.id === messageId)) {
			dispatchUi({ type: "select-turn", id: messageId, targetKey: `message:${messageId}` });
		}
	}

	const callbacks: TrajectoryReviewWorkspaceCallbacks = {
		onSelectTurn: selectTurn,
		onSelectArtifact: (artifactId) => {
			const artifact = artifacts.find((entry) => entry.id === artifactId);
			if (artifact) dispatchUi({ type: "select-artifact", id: artifactId, targetKey: reviewTargetKey({ kind: "artifact", artifact: artifact.reference }) });
		},
		onTextSelection: (selection: TrajectoryTextSelection) => {
			dispatchUi({
				type: "open-annotation",
				draft: draftForTarget(selection.target, { kind: selection.kind, intent: selection.intent }),
				generationTargetKey: generationTargetKey(selection.target),
				sourceId: annotationSourceId(selection.target, artifacts),
			});
		},
		onReviewChange: (next) => dispatchUi({ type: "change-review", review: next }),
		onStartAnnotation: (target) => {
			dispatchUi({
				type: "open-annotation",
				draft: draftForTarget(target),
				generationTargetKey: generationTargetKey(target),
				sourceId: annotationSourceId(target, artifacts),
			});
		},
		onAnnotationDraftChange: (draft) => dispatchUi({ type: "change-annotation", draft }),
		onSaveAnnotation: (draft) => run(async (isCurrent) => {
			const saved = await reviewState.saveAnnotation(draft);
			if (isCurrent()) dispatchUi({ type: "annotation-saved", id: saved.id });
		}),
		onCancelAnnotation: () => dispatchUi({ type: "close-annotation" }),
		onEditAnnotation: (annotation) => {
			dispatchUi({
				type: "open-annotation",
				draft: draftFromAnnotation(annotation),
				generationTargetKey: generationTargetKey(annotation.target),
				sourceId: annotationSourceId(annotation.target, artifacts),
				annotationId: annotation.id,
			});
		},
		onDeleteAnnotation: (annotationId) => run(async (isCurrent) => {
			await reviewState.deleteAnnotation(annotationId);
			if (isCurrent()) dispatchUi({ type: "annotation-deleted", id: annotationId });
		}),
		onSelectCandidate: (id) => dispatchUi({ type: "select-candidate", id }),
		onChooseCandidate: (candidateId) => run(() => reviewState.chooseCandidate(candidateId)),
		onInsertCandidate: (candidateId) => run(async () => {
			const candidate = reviewState.candidates.find((entry) => entry.id === candidateId);
			if (!candidate) throw new Error("Review candidate not found.");
			if (candidate.target.kind === "artifact") assertTextReviewCandidateGeneration(candidate.target);
			await reviewState.chooseCandidate(candidateId);
			if (candidate.target.kind === "artifact") await reviewState.acceptArtifactRevision(candidateId);
			else await reviewState.insertCandidate(candidateId);
		}),
		onRegenerateCandidate: (candidateId) => {
			const candidate = reviewState.candidates.find((entry) => entry.id === candidateId);
			if (candidate) generate(candidate.target, candidate.poolId, candidate.annotationIds);
		},
		onGenerateCandidates: (poolId) => {
			try {
				const target = targetForActiveSelection();
				const annotationIds = reviewState.annotations.filter((annotation) => annotationMatchesCandidate(annotation, target)).map((annotation) => annotation.id);
				generate(target, poolId, annotationIds);
			} catch (cause) {
				dispatchUi({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
			}
		},
		onSelectModelPool: (id) => dispatchUi({ type: "select-pool", id }),
		onModelPoolChange: (pool) => run(() => reviewState.saveModelPool(pool)),
		onAddModel: (poolId, model) => run(async () => {
			const pool = reviewState.modelPools.find((entry) => entry.id === poolId);
			if (!pool) throw new Error("Model pool not found.");
			if (pool.models.some((entry) => entry.provider === model.provider && entry.id === model.id)) return;
			await reviewState.saveModelPool({ ...pool, models: [...pool.models, model] });
		}),
		onRemoveModel: (poolId, model) => {
			const pool = reviewState.modelPools.find((entry) => entry.id === poolId);
			if (pool) run(() => reviewState.saveModelPool({ ...pool, models: pool.models.filter((entry) => entry.provider !== model.provider || entry.id !== model.id) }));
		},
		onCreateModelPool: () => {
			const model = reviewState.session?.model;
			if (!model) return;
			let target: ReviewCandidateTarget;
			try {
				target = targetForActiveSelection();
			} catch (cause) {
				dispatchUi({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
				return;
			}
			const now = Date.now();
			const tasks: ReviewGenerationTask[] = target.kind === "artifact"
				? [`artifact:${target.artifact.artifactType}`]
				: ["response"];
			const pool: ReviewModelPool = {
				schemaVersion: TRAJECTORY_REVIEW_SCHEMA_VERSION,
				id: createReviewRecordId("pool"),
				name: "New review pool",
				tasks,
				models: [storedModelReference(model)],
				candidateCount: 3,
				temperature: 0.7,
				maxTokens: 2_048,
				createdAt: now,
				updatedAt: now,
			};
			run(async (isCurrent) => {
				const saved = await reviewState.saveModelPool(pool);
				if (isCurrent()) dispatchUi({ type: "select-pool", id: saved.id });
			});
		},
		onDeleteModelPool: (poolId) => run(() => reviewState.deleteModelPool(poolId)),
		onSave: () => {
			const submittedDraft = ui.reviewDraft ?? reviewState.review!;
			const submittedRevision = ui.reviewDraftRevision;
			run(async (isCurrent) => {
				const saved = await reviewState.saveReview(submittedDraft);
				if (isCurrent()) dispatchUi({ type: "review-saved", review: saved, submittedRevision });
			});
		},
		onExport: async () => {
			const origin = sessionId;
			const submittedDraft = ui.reviewDraft;
			const submittedRevision = ui.reviewDraftRevision;
			const saveBeforeExport = ui.reviewDirty && submittedDraft;
			if (saveBeforeExport) {
				const saved = await reviewState.saveReview(submittedDraft);
				if (currentSessionId.current !== origin) return;
				dispatchUi({ type: "review-saved", review: saved, submittedRevision });
			}
			await reviewState.exportArchive();
		},
	};

	const activePool = reviewState.modelPools.find((pool) => pool.id === ui.activeModelPoolId) ?? reviewState.modelPools[0];
	const lastPass = passes.lastRun["critique-sweep"] ?? passes.lastRun["rubric-score"] ?? passes.lastRun["annotation-expand"];

	const passState: TrajectoryPassState = {
		running: passes.running,
		error: passes.error,
		critique: passes.critique,
		rubric: passes.rubric,
		footnote: lastPass ? `Last pass: ${lastPass.model} · ${(lastPass.latencyMs / 1_000).toFixed(1)}s` : undefined,
	};

	const passCallbacks: TrajectoryPassCallbacks = {
		onRunPass: (kind) => {
			if (kind === "rubric-score") { void passes.runRubricScore(); return; }
			if (!activePool) return;
			if (kind === "critique-sweep") void passes.runCritiqueSweep(activePool);
			else if (kind === "annotation-expand") {
				const draft = ui.annotationDraft;
				if (!draft?.note.trim()) return;
				void passes.expandAnnotation(activePool, {
					note: draft.note,
					kind: draft.kind,
					category: draft.category,
					quotedText: draft.target.kind === "message-span" || draft.target.kind === "artifact-span"
						? draft.target.anchor.quote
						: undefined,
				}).then((expansion) => {
					// Fill only the empty halves: a teacher who already wrote an
					// alternative keeps it, and the pass fills what is missing.
					if (!expansion || currentSessionId.current !== sessionId) return;
					const filled: AuthoredAnnotationField[] = [];
					const keepImpact = Boolean(draft.pedagogicalImpact?.trim());
					const keepAlternative = Boolean(draft.suggestedAlternative?.trim());
					if (!keepImpact && expansion.pedagogicalImpact?.trim()) filled.push("pedagogicalImpact");
					if (!keepAlternative && expansion.suggestedAlternative?.trim()) filled.push("suggestedAlternative");
					const fieldAuthorship = markPassDrafted(draft.fieldAuthorship, filled);
					dispatchUi({
						type: "expand-annotation",
						draft: {
							...draft,
							pedagogicalImpact: keepImpact ? draft.pedagogicalImpact : expansion.pedagogicalImpact,
							suggestedAlternative: keepAlternative ? draft.suggestedAlternative : expansion.suggestedAlternative,
							fieldAuthorship,
							authorship: overallAuthorship(fieldAuthorship),
						},
					});
				});
			}
		},
		onCancelPass: passes.cancel,
		onDismissPassError: passes.dismissError,
		onAcceptProposal: (proposal: CritiqueProposal) => run(async (isCurrent) => {
			// A proposal becomes an ordinary annotation through the ordinary save path,
			// but the record keeps that a model drafted it and the teacher merely
			// accepted it — a one-click accept is a far weaker signal than written prose.
			const target = critiqueProposalTarget(proposal, reviewState.session?.messages ?? []);
			const saved = await reviewState.saveAnnotation({
				authorship: "pass-drafted",
				fieldAuthorship: markPassDrafted(undefined, ["note", "pedagogicalImpact", "suggestedAlternative"]),
				target,
				kind: proposal.kind,
				category: proposal.category,
				severity: proposal.severity,
				note: proposal.note,
				pedagogicalImpact: proposal.pedagogicalImpact,
				suggestedAlternative: proposal.suggestedAlternative,
				status: "draft",
			});
			if (isCurrent()) {
				passes.dismissCritique(proposal.id);
				dispatchUi({ type: "annotation-saved", id: saved.id });
			}
		}),
		onDismissProposal: passes.dismissCritique,
		onDismissAllProposals: passes.clearCritique,
		onApplyRubric: (proposal: RubricSweepProposal) => {
			if (!rubricProposalMatchesTrajectory(proposal, sessionId, reviewState.session?.messages ?? [])) {
				dispatchUi({ type: "error", message: "The transcript changed. Run the rubric review again before applying its estimates." });
				passes.clearRubric();
				return;
			}
			const base = ui.reviewDraft ?? reviewState.review;
			if (!base) return;
			const ratings = { ...base.ratings };
			for (const rating of proposal.ratings) ratings[rating.key] = rating.rating;
			dispatchUi({
				type: "change-review",
				review: {
					...base,
					ratings,
					rubricJudgement: proposal.judgement ?? base.rubricJudgement,
					overallRating: proposal.overallRating ?? base.overallRating,
					// The teacher's own summary and verdict are never overwritten.
					summary: base.summary?.trim() ? base.summary : proposal.summary,
					verdict: base.verdict === "undecided" && proposal.verdict ? proposal.verdict : base.verdict,
					updatedAt: Date.now(),
				},
			});
			passes.clearRubric();
		},
		onDismissRubric: passes.clearRubric,
		onRevealProposal: (proposal) => {
			if (proposal.messageId) selectTurn(proposal.messageId);
		},
	};

	return (
		<JudgementReviewContext.Provider value={judgementReview.context}>
			<TrajectoryReviewWorkspace key={reviewState.session.id}
				data={{
					session: {
						id: reviewState.session.id,
						title: reviewState.session.title || "Untitled session",
						subtitle: `${messages.length} recorded turns · ${artifacts.length} frozen artifacts`,
						startedAt: Date.parse(reviewState.session.createdAt),
					},
					messages,
					artifacts,
					review: ui.reviewDraft ?? reviewState.review,
					annotations: reviewState.annotations,
					annotationDraft: ui.annotationDraft,
					modelPools: reviewState.modelPools,
					availableModels: ui.availableModels,
					candidates: reviewState.candidates,
					activeTurnId: ui.activeTurnId,
					activeArtifactId: ui.activeArtifactId,
					activeAnnotationId: ui.activeAnnotationId,
					activeCandidateId: ui.activeCandidateId,
					activeModelPoolId: ui.activeModelPoolId,
					activeTargetKey: ui.activeTargetKey,
					reviewDirty: ui.reviewDirty,
					busy: reviewState.busy,
					error: ui.localError ?? reviewState.error ?? undefined,
				}}
				callbacks={callbacks}
				passes={passState}
				passCallbacks={passCallbacks}
			/>
		</JudgementReviewContext.Provider>
	);
}
