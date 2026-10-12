import { blocksRelease, type TeachingDraftSnapshot } from "@keating/learner-contracts";

const failures: Record<string, string> = {
  "backend-unavailable": "The judgement model is unavailable. Check the judgement model in Settings, then try again.",
  "backend-unauthorized": "The review provider rejected authentication. Reconnect your account or update the judgement model credentials in Settings.",
  "backend-payment-required": "The review provider couldn't fund this review. Check your account credit and request spending limit, then try again.",
  "backend-rate-limited": "The review provider is rate limiting requests. Wait a moment, then try again.",
  "backend-overloaded": "The review provider is overloaded. Try again shortly.",
  "backend-timeout": "The review provider timed out. Try again or choose another judgement model in Settings.",
  "response-malformed": "The review provider returned an invalid or inconsistent response. Try again or choose another judgement model in Settings.",
  "request-invalid": "Keating couldn't prepare a valid review request within the judgement model's limits. Try a new conversation or choose a judgement model with a larger context in Settings.",
  "time-budget": "Keating ran out of time while preparing or checking the reply. Try again or choose a faster model in Settings.",
  "generation-unavailable": "The reply model failed before producing a complete draft. Try again or check the reply model and connection in Settings.",
  "selection-abstained": "Drafts passed the individual checks, but the final review couldn't select one that answered your request. Retry or choose a different reply model in Settings.",
  "review-unavailable": "Keating couldn't complete the reply checks because an internal review step failed. Try again; if it repeats, report the failure details below.",
  "evidence-unavailable": "Keating couldn't load the context needed to check this reply. Reload the conversation and try again.",
};

/** Only code-owned explanations and counts reach the transcript, never provider bodies or drafts. */
export function describeDraftFailure(snapshot: TeachingDraftSnapshot): string {
  const reason = snapshot.reason ?? "review-unavailable";
  const known = Object.hasOwn(failures, reason) || reason === "no-approved-draft";
  let explanation = Object.hasOwn(failures, reason) ? failures[reason]! : failures["review-unavailable"]!;
  if (reason === "no-approved-draft") {
    const checks = snapshot.attempts.flatMap(attempt => attempt.checks).filter(blocksRelease);
    const details = [
      checks.some(check => check.id === "runtime_tool_schema") ? "a proposed tool call had invalid arguments" : null,
      checks.some(check => check.id === "tool_success_invented") ? "the reviewer could not verify claims about tool results" : null,
      checks.some(check => check.id === "identity_invented") ? "the reviewer could not verify claims about the assistant's identity or capabilities" : null,
    ].filter(Boolean);
    explanation = "Keating couldn't verify a reply after reviewing the drafts: "
      + (details.length ? details.join("; ") : checks.some(check => check.status === "fail")
        ? "the drafts failed the teaching or evidence checks" : "the reviewer could not confidently approve the drafts")
      + ". Retry or choose a different reply model in Settings.";
    const ids = [...new Set(checks.map(check => check.id))].filter(id => /^[a-z][a-z0-9_]{0,79}$/.test(id));
    if (ids.length) explanation += ` Blocking checks: ${ids.join(", ")}.`;
  }
  const count = Math.max(snapshot.attempt, snapshot.attempts.length);
  const generated = snapshot.attempts.filter(attempt => attempt.status !== "generation-error").length;
  return `${explanation}\n\nFailure: ${known ? reason : "review-unavailable"}. Draft attempts: ${count}; completed drafts: ${generated}.`;
}
