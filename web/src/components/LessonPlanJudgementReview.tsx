import { useEffect, useRef, useState } from "react";
import { css } from "../../styled-system/css";
import { LESSON_PLAN_CRITERIA, lessonPlanBlocks, type LessonPlanReview } from "../../../shared/pedagogy/lesson-plan-judgement";
import { renderedLessonPlanInput, saveAndReviewLessonPlan, type ReviewableStudyPlan } from "../keating/judgement/lesson-plan-review";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";

export function LessonPlanJudgementReview({ plan, disabled = false }: { plan: ReviewableStudyPlan; disabled?: boolean }) {
  const input = renderedLessonPlanInput(plan), key = JSON.stringify(input);
  const current = useRef(input); current.current = input;
  const controller = useRef<AbortController | null>(null);
  const [settings, setSettings] = useState(loadJudgementModelSettings);
  const [status, setStatus] = useState<"idle" | "saving" | "reviewing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ key: string; review: LessonPlanReview } | null>(null);
  useEffect(() => { controller.current?.abort(); setStatus("idle"); setResult(null); return () => { controller.current?.abort(); }; }, [key, disabled]);
  useEffect(() => subscribeJudgementModelSettings(next => { controller.current?.abort(); setSettings(next); setStatus("idle"); setResult(null); }), []);
  const start = async () => {
    if (disabled || status === "saving" || status === "reviewing") return;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setStatus("saving"); setResult(null);
    try {
      const { getInitPromise, keatingStorage } = await import("../hooks/keating-storage");
      await getInitPromise();
      if (abort.signal.aborted) return;
      const response = await saveAndReviewLessonPlan({ input, storage: keatingStorage, signal: abort.signal,
        currentInput: () => current.current, onSaved: () => { if (!abort.signal.aborted) setStatus("reviewing"); } });
      if (!abort.signal.aborted) { setResult({ key, review: response.review }); setStatus("done"); }
    } catch { if (!abort.signal.aborted) setStatus("error"); }
  };
  const review = result?.key === key ? result.review : null;
  const blocks = lessonPlanBlocks(input.content);
  return <aside aria-label="Lesson plan review" className={css({ borderTop: "1px solid var(--border)", p: "0.8rem", fontSize: "0.75rem", lineHeight: 1.5 })}>
    <button type="button" disabled={disabled || settings.backend === "off" || status === "saving" || status === "reviewing"} onClick={() => void start()}
      className={css({ border: "1px solid var(--border)", borderRadius: "0.35rem", p: "0.5rem", fontWeight: 650 })}>
      {status === "saving" ? "Saving plan…" : status === "reviewing" ? "Reviewing saved plan…" : "Save & review plan"}
    </button>
    {status === "reviewing" && <button type="button" onClick={() => { controller.current?.abort(); setStatus("idle"); }} className={css({ ml: "0.7rem" })}>Cancel review</button>}
    <p>{disabled ? "Review is available when this plan is complete and active." : settings.backend === "off" ? "Judgement is off in Settings." : settings.backend === "hosted" ? "Saves this plan first, then may send its text to your configured hosted judgement service." : "Saves this plan first, then uses the independent local judgement model."}</p>
    {status === "reviewing" && <p role="status">Plan saved. You can keep working while review runs.</p>}
    {status === "error" && <p role="status">Saving or review is unavailable. Your rendered plan remains available.</p>}
    {review && <div role="status">
      <strong>Uncalibrated reviewer suggestions · {review.backend ? `${review.backend.backend} / ${review.backend.model}` : "backend unavailable"}</strong>
      {review.status !== "estimated" && <p>Review {review.status}: {review.reason}. The plan was saved; no passing result is implied.</p>}
      {review.findings.map(finding => {
        const criterion = LESSON_PLAN_CRITERIA.find(item => item.id === finding.criterionId)!;
        const block = blocks.find(item => item.id === finding.evidenceBlockId);
        return <div key={finding.criterionId} className={css({ mt: "0.6rem" })}>
          <strong>{criterion.label}: {finding.verdict === "attention" ? "check this" : finding.verdict === "supported" ? "appears supported" : "unknown"}</strong>
          {finding.verdict === "attention" && <p>{criterion.action}</p>}
          {block && <details><summary>Exact plan evidence · {block.id}</summary><blockquote className={css({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" })}>{block.text}</blockquote></details>}
        </div>;
      })}
      <p>Suggestions only; no plan changes or learner grades. Review results last for this view. Backend activity is available in judgement diagnostics.</p>
    </div>}
  </aside>;
}
