import { useEffect, useState } from "react";
import { KeatingStorage, QUESTION_JUDGEMENT_CHANGED_EVENT, type QuestionCheckRecord } from "../keating/storage";
import "./question-judgement-review.css";

const reviewStorage = new KeatingStorage();

function recordedVerdict(check: QuestionCheckRecord): string | null {
  if (check.grading !== "model" || typeof check.score !== "number" || !Number.isFinite(check.score) || check.score < 0 || check.score > 1) return null;
  if (check.score === 1) return "Your answer is correct.";
  if (check.score === 0.5) return "Your answer is partly correct.";
  if (check.score === 0) return "Your answer is incorrect.";
  return null;
}

export function QuestionJudgementReviewView({ checks, multiple = checks.length > 1 }: { checks: readonly QuestionCheckRecord[]; multiple?: boolean }) {
  const reviewed = checks.filter(check => check.judgement || check.grading === "model" && typeof check.score === "number" && Number.isFinite(check.score) && check.score >= 0 && check.score <= 1);
  if (!reviewed.length) return null;
  return <div className="question-judgement-review" aria-live="polite">
    {reviewed.map(check => {
      const verdictText = recordedVerdict(check);
      const review = check.judgement;
      if (!review) return <section key={check.id} aria-label={`Recorded grade for ${check.question}`}>
        {multiple && <p className="question-judgement-review__question">{check.question}</p>}
        <p className="question-judgement-review__grade">{verdictText ?? `Recorded grade: ${Math.round(check.score! * 100)}%.`}</p>
      </section>;
      const estimate = review.proposal;
      const quote = estimate?.evidenceQuote ?? review.final.evidenceQuote;
      const model = estimate?.backend.model ?? review.final.attempts.find(attempt => attempt.outcome === "decided")?.backend.model;
      const pending = check.grading === "pending";
      const label = estimate ? "Review estimate" : review.evidenceKind === "calibrated-model-grade" ? "Model review" : "Review status";
      const verdict = estimate?.verdict;
      return <section key={check.id} aria-label={`${label}: ${check.question}`}>
        <h4>{label}</h4>
        {multiple && <p className="question-judgement-review__question">{check.question}</p>}
        {verdictText && <p className="question-judgement-review__grade">{verdictText}</p>}
        {estimate && <p>{verdict === "correct" ? "The review suggests the answer is correct."
          : verdict === "partial" ? "The review suggests the answer is partly correct."
            : verdict === "incorrect" ? "The review suggests the answer needs correction."
              : "The review could not reach a clear estimate."}</p>}
        <p className="question-judgement-review__grade">{pending ? "Final grade pending."
          : typeof check.score === "number" ? `Recorded grade: ${Math.round(check.score * 100)}%.` : "Grade recorded."}</p>
        {estimate && pending && <p>This estimate has not been validated for automatic grading. Your teacher can review it.</p>}
        {review.evidenceKind === "unavailable" && <p>A model review was unavailable. Your answer is saved.</p>}
        {quote && check.answer.includes(quote) && <blockquote><p>{quote}</p><footer>From your answer</footer></blockquote>}
        {model && <p className="question-judgement-review__model">Reviewed by {model}</p>}
      </section>;
    })}
  </div>;
}

export function QuestionJudgementReview({ recordIds }: { recordIds: readonly string[] }) {
  const [checks, setChecks] = useState<QuestionCheckRecord[]>([]);
  const identity = JSON.stringify(recordIds);
  useEffect(() => {
    let active = true;
    const ids = new Set<string>(JSON.parse(identity));
    setChecks([]);
    if (!ids.size || typeof indexedDB === "undefined") return;
    let latestRead = 0;
    const refresh = async () => {
      const read = ++latestRead;
      try {
        const saved = await reviewStorage.getQuestionChecks();
        if (active && read === latestRead) setChecks(saved.filter(check => ids.has(check.id)));
      } catch { /* A display read failure never changes or hides the saved answer. */ }
    };
    const changed = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id === "string" && ids.has(id)) void refresh();
    };
    window.addEventListener(QUESTION_JUDGEMENT_CHANGED_EVENT, changed);
    window.addEventListener("focus", refresh);
    void refresh();
    return () => { active = false; window.removeEventListener(QUESTION_JUDGEMENT_CHANGED_EVENT, changed); window.removeEventListener("focus", refresh); };
  }, [identity]);
  return <QuestionJudgementReviewView checks={checks.filter(check => recordIds.includes(check.id))} multiple={recordIds.length > 1} />;
}
