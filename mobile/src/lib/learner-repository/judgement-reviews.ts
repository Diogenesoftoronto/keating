import { validateLearnerQuestionCheck, type LearnerQuestionCheck } from "@keating/learner-contracts";
import type { MobileQuestionJudgement, MobileQuestionReviewInput } from "../judgement/grading";
import { withExclusiveTransaction, type AsyncSqlDatabase } from "./database";

export interface MobileJudgementReviewRecord extends MobileQuestionReviewInput {
  judgement: MobileQuestionJudgement;
  reviewedAt: string;
}

/** Equality includes grading and teacher feedback, not only the submitted answer. */
export function mobileJudgementReviewIsCurrent(record: MobileJudgementReviewRecord, check: LearnerQuestionCheck | undefined): boolean {
  return check !== undefined && JSON.stringify(record.check) === JSON.stringify(check);
}

function validRecord(value: unknown): value is MobileJudgementReviewRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as MobileJudgementReviewRecord;
  if (!validateLearnerQuestionCheck(record.check) || record.input?.id !== record.check.id
    || record.input.question !== record.check.question || record.input.learnerAnswer !== record.check.answer
    || record.judgement?.final?.id !== record.check.id || record.judgement.final.source !== "proxy"
    || !Number.isFinite(Date.parse(record.reviewedAt))) return false;
  const proposal = record.judgement.proposal;
  if (!proposal) return true;
  return record.judgement.final.grading === "pending" && record.check.grading === "pending"
    && record.check.score === undefined && proposal.backend?.calibrationSha256 === null
    && typeof proposal.backend.model === "string" && Boolean(proposal.backend.model.trim())
    && proposal.backend.model !== "judgement" && !proposal.backend.model.endsWith("-latest")
    && typeof proposal.evidenceQuote === "string" && Boolean(proposal.evidenceQuote)
    && record.check.answer.includes(proposal.evidenceQuote)
    && typeof proposal.credit === "number" && proposal.credit >= 0 && proposal.credit <= 1;
}

/** Separate from portable grades, so an unfitted model cannot silently become final authority. */
export class MobileJudgementReviewStore {
  constructor(private readonly database: AsyncSqlDatabase) {}

  async list(): Promise<MobileJudgementReviewRecord[]> {
    const rows = await this.database.getAllAsync<{ payload_json: string }>("SELECT payload_json FROM judgement_reviews ORDER BY reviewed_at, check_id;");
    return rows.flatMap(row => { try { const value = JSON.parse(row.payload_json); return validRecord(value) ? [value] : []; } catch { return []; } });
  }

  async saveIfCurrent(source: MobileQuestionReviewInput, judgement: MobileQuestionJudgement, now = new Date().toISOString()): Promise<boolean> {
    if (source.check.grading !== "pending" || source.check.score !== undefined) return false;
    return withExclusiveTransaction(this.database, async transaction => {
      const row = await transaction.getFirstAsync<{ payload_json: string }>(
        "SELECT payload_json FROM learner_records WHERE kind = 'question_check' AND id = ?;", source.check.id);
      if (!row) return false;
      const current = JSON.parse(row.payload_json) as LearnerQuestionCheck;
      if (JSON.stringify(current) !== JSON.stringify(source.check)) return false;
      const existing = await transaction.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM judgement_reviews WHERE check_id = ?;", source.check.id);
      if (existing) {
        try { if (mobileJudgementReviewIsCurrent(JSON.parse(existing.payload_json), current)) return false; } catch { /* Replace invalid metadata only. */ }
      }
      const final = judgement.final;
      const next = final.grading !== "pending" && final.credit !== null
        ? { ...current, grading: final.grading, score: final.credit } : current;
      const record: MobileJudgementReviewRecord = { ...source, check: next, judgement, reviewedAt: now };
      if (!validRecord(record)) throw new Error("Invalid judgement review.");
      // Grade and its provenance commit together; late results cannot replace a teacher edit.
      if (next !== current) await transaction.runAsync("UPDATE learner_records SET payload_json = ? WHERE kind = 'question_check' AND id = ?;", JSON.stringify(next), current.id);
      await transaction.runAsync("INSERT INTO judgement_reviews (check_id, reviewed_at, payload_json) VALUES (?, ?, ?) ON CONFLICT(check_id) DO UPDATE SET reviewed_at = excluded.reviewed_at, payload_json = excluded.payload_json;",
        current.id, now, JSON.stringify(record));
      return true;
    });
  }
}
