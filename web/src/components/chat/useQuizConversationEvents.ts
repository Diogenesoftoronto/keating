/**
 * Turns quiz and legacy question window events into learner turns for the
 * active thread. Text and routing live in quiz-conversation.ts.
 */
import { useEffect } from "react";
import { usePostHog } from "@posthog/react";
import type { FlueConversation } from "../../keating/flue/conversation";
import { createQuizConversationHandlers } from "./quiz-conversation";
import type { SubmitLearnerTurn } from "./useLearnerDelivery";

export function useQuizConversationEvents({
  agent,
  submitLearnerTurn,
}: {
  agent: FlueConversation | null;
  submitLearnerTurn: SubmitLearnerTurn;
}): void {
  const posthog = usePostHog();
  const handlers = () => createQuizConversationHandlers({
    hasAgent: () => Boolean(agent),
    submit: submitLearnerTurn,
    capture: (event, properties) => posthog.capture(event, properties),
  });

  // When the learner submits a legacy question form, feed its answers back into
  // the conversation. New question interactions arrive through OpenUI actions.
  useEffect(() => {
    const handler = handlers().questionAnswered;
    window.addEventListener("keating:question-answered", handler);
    return () =>
      window.removeEventListener("keating:question-answered", handler);
  }, [agent, submitLearnerTurn]);

  // When the learner finishes a quiz, report their score, timing, partial
  // credits, and flagged questions back to the agent.
  useEffect(() => {
    const handler = handlers().quizSubmitted;
    window.addEventListener("keating:quiz-submitted", handler);
    return () => window.removeEventListener("keating:quiz-submitted", handler);
  }, [agent, submitLearnerTurn]);

  // Handle quiz remediation requests: learner clicked "Review" on a missed Bloom's level.
  useEffect(() => {
    const handler = handlers().remediationRequested;
    window.addEventListener("keating:quiz-remediation-requested", handler);
    return () =>
      window.removeEventListener("keating:quiz-remediation-requested", handler);
  }, [submitLearnerTurn]);

  // Handle quiz reframe requests: learner selected a reframe mode with no pre-generated text.
  useEffect(() => {
    const handler = handlers().reframeRequested;
    window.addEventListener("keating:quiz-reframe-requested", handler);
    return () =>
      window.removeEventListener("keating:quiz-reframe-requested", handler);
  }, [submitLearnerTurn]);
}
