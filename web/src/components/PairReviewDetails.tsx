import { pairReviewOverlapMs, type OpenUiFinalComparison, type OpenUiPairReview } from "@keating/learner-contracts";

export function PairReviewDetails({ reviews, finalComparison }: { reviews: readonly OpenUiPairReview[]; finalComparison?: OpenUiFinalComparison }) {
  if (!reviews.length) return <span>No pair result recorded yet.</span>;
  const overlap = pairReviewOverlapMs(reviews);
  const policies = [...new Set(reviews.flatMap(review => review.policyVersion ? [review.policyVersion] : []))];
  return <div>
    <ul aria-label="Candidate pair reviews">{reviews.map(review => <li key={review.pair}>
      <strong>{review.pair === 1 ? "Drafts 1 and 2" : "Drafts 3 and 4"}</strong>
      {" · "}{review.status === "compared" ? `${review.model} preferred draft ${review.preferredAttempt}.`
        : review.status === "incomplete" ? (review.candidateAttempts.length ? `Only draft ${review.candidateAttempts[0]} completed.` : "Neither draft completed.")
        : `Comparison unavailable${review.error ? " (" + review.error + ")" : ""}.`}
      {review.eligibleAttempts && <> {review.eligibleAttempts.length ? `Eligible for release · ${review.eligibleAttempts.join(", ")}.` : "Neither draft was eligible for release."}</>}
      {review.finalistAttempt != null && <> Draft {review.finalistAttempt} advanced.</>}
      {Boolean(review.feedbackOnlyAttempts?.length) && <> Feedback-only prompt · {review.feedbackOnlyAttempts?.join(", ")}.</>}
      {Boolean(review.predictionQuestionAttempts?.length) && <> Prediction Question prompt · {review.predictionQuestionAttempts?.join(", ")}.</>}
      {review.candidateIssueIds?.map(({ attempt, issues }) => <div key={attempt}>
        Draft {attempt} review · {issues.length ? issues.join(", ") : "no issues recorded"}.
      </div>)}
    </li>)}</ul>
    {overlap !== null && <p>{overlap > 0 ? `The pair reviews overlapped for ${Math.round(overlap)} ms.` : "The recorded review intervals did not overlap."}</p>}
    {finalComparison && <p><strong>Final comparison</strong> · {finalComparison.model} preferred draft {finalComparison.preferredAttempt}.
      {" "}{finalComparison.candidateAttempts.map(id => `Draft ${id} · ${(100 * finalComparison.probabilities["draft_" + id]!).toFixed(1)}%`).join(", ")}.
      {finalComparison.confidence !== undefined && <> Reported confidence · {finalComparison.confidence}.</>}
    </p>}
    {policies.length > 0 && <p>Teaching policy · {policies.map(version => version.split("/").pop()).join(", ")}</p>}
  </div>;
}
