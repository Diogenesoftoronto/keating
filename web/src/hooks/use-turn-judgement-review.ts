/** Saved turn judgements and reviewer labels for one reviewed conversation. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TeachingDraftReceiptRecord } from "../keating/storage";
import { keatingStorage } from "./keating-storage";
import { applyWebMemoryOverride, currentWebMemoryScope } from "../keating/judgement/memory-admission";
import { retryPendingMemoryLabels, saveCheckLabel, saveMemoryLabel, type JudgementLabelDeps } from "../keating/judgement/judgement-labels";
import type { JudgementLabelRecord, TurnJudgementRecord } from "../keating/judgement/turn-records";
import type { JudgementReviewContextValue } from "../components/trajectory/judgement-review-context";

const deps: JudgementLabelDeps = { storage: keatingStorage, memoryScope: currentWebMemoryScope, applyMemory: applyWebMemoryOverride };

export function useTurnJudgementReview(sessionId: string | undefined, receipts: readonly TeachingDraftReceiptRecord[]) {
	const [records, setRecords] = useState<TurnJudgementRecord[]>([]);
	const [labels, setLabels] = useState<JudgementLabelRecord[]>([]);
	const [error, setError] = useState<string | null>(null);
	const current = useRef(sessionId);
	current.current = sessionId;

	useEffect(() => {
		setRecords([]); setLabels([]); setError(null);
		if (!sessionId) return;
		let cancelled = false;
		void Promise.all([keatingStorage.getTurnJudgements(sessionId), keatingStorage.getJudgementLabels(sessionId)])
			.then(async ([saved, savedLabels]) => {
				if (cancelled) return;
				const retried = await retryPendingMemoryLabels(deps, savedLabels);
				if (cancelled) return;
				setRecords(saved);
				setLabels(savedLabels.flatMap((row) => {
					const next = retried.find((next) => next.id === row.id);
					return next?.cleared ? [] : [next ?? row];
				}));
				if (retried.some((row) => row.effect === "failed")) setError("Your memory correction could not be applied. Try again.");
			})
			.catch(() => { if (!cancelled) setError("Saved judgements could not be loaded."); });
		return () => { cancelled = true; };
	}, [sessionId]);

	const replace = useCallback((id: string, next: JudgementLabelRecord | null) => {
		setLabels((rows) => next ? [...rows.filter((row) => row.id !== id), next] : rows.filter((row) => row.id !== id));
	}, []);

	const context = useMemo<JudgementReviewContextValue | null>(() => {
		if (!sessionId) return null;
		const guard = <T,>(work: Promise<T>, apply: (value: T) => void) => {
			setError(null);
			void work.then((value) => { if (current.current === sessionId) apply(value); })
				.catch(() => { if (current.current === sessionId) setError("Your label could not be saved. Try again."); });
		};
		return {
			labels,
			error,
			labelCheck: (assistantTimestamp, input) => {
				const receipt = receipts.find((row) => row.messageTimestamp === assistantTimestamp);
				const existing = labels.find((row) => row.assistantTimestamp === assistantTimestamp && row.target.kind === "draft-check"
					&& row.target.attempt === input.attempt && row.target.checkId === input.check.id);
				guard(saveCheckLabel(deps, { sessionId, assistantTimestamp }, { ...input, judge: receipt?.snapshot.judgeModel ?? null, existing }),
					(next) => { const id = existing?.id ?? next?.id; if (id) replace(id, next); });
			},
			labelMemory: (assistantTimestamp, input) => {
				const existing = labels.find((row) => row.assistantTimestamp === assistantTimestamp && row.target.kind === "memory-admission"
					&& row.target.candidateId === input.decision.candidate.id);
				guard(saveMemoryLabel(deps, { sessionId, assistantTimestamp }, { ...input, existing }),
					(next) => {
						const id = existing?.id ?? next?.id;
						if (id) replace(id, next);
						if (next?.pendingClear) setError(next.effect === "failed"
							? "Undo could not clear the memory correction. Try again."
							: "Undo is pending until the original memory account returns.");
						else if (next?.effect === "failed") setError("Your memory correction could not be applied. Try again.");
					});
			},
		};
	}, [error, labels, receipts, replace, sessionId]);

	return { records, labels, context };
}
