/**
 * Review-page authority for judgement labels. The transcript canvas reads it so
 * label controls appear only where the review page supplies them.
 */
import { createContext, useContext } from "react";
import type { MemoryCategory, TeachingPolicyCheck } from "@keating/learner-contracts";
import type { DraftCheckVerdict, JudgementLabelRecord, MemoryVerdict, TurnMemoryDecision } from "../../keating/judgement/turn-records";

export interface JudgementReviewContextValue {
	labels: readonly JudgementLabelRecord[];
	labelCheck: (assistantTimestamp: number, input: { attempt: number; check: TeachingPolicyCheck; verdict: DraftCheckVerdict | null; note?: string }) => void;
	labelMemory: (assistantTimestamp: number, input: { decision: TurnMemoryDecision; verdict: MemoryVerdict | null; category?: MemoryCategory }) => void;
	error: string | null;
}

export const JudgementReviewContext = createContext<JudgementReviewContextValue | null>(null);
export const useJudgementReview = () => useContext(JudgementReviewContext);
