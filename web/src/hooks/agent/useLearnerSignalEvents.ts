/**
 * Learner signals raised by the chat UI as window events: thumbs up/down on a
 * reply (`keating:message-feedback`) and answered question checks
 * (`keating:question-answered`), recorded against the active session.
 */
import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import type { SessionData } from "../../types/session";
import { keatingStorage, sessions } from "../keating-storage";
import type { AgentHostRefs } from "./host-refs";

export interface MessageFeedbackDetail {
  type?: unknown;
  comment?: unknown;
  messageId?: unknown;
  messageText?: unknown;
  messageCreatedAt?: unknown;
}

export function feedbackSignal(detail: MessageFeedbackDetail | undefined): "thumbs-up" | "thumbs-down" | null {
  return detail?.type === "up"
    ? "thumbs-up"
    : detail?.type === "down"
      ? "thumbs-down"
      : null;
}

/**
 * The stored feedback for one reply. The session title is context only; the
 * referent retains the exact generated answer, so later analysis need not
 * guess from a topic bucket.
 */
export function messageFeedbackRecord(
  detail: MessageFeedbackDetail,
  sessionId: string,
) {
  const messageId =
    typeof detail.messageId === "string" ? detail.messageId : undefined;
  const messageText =
    typeof detail.messageText === "string" ? detail.messageText.trim() : "";
  return {
    source: "explicit" as const,
    evidence:
      typeof detail.comment === "string" && detail.comment.trim()
        ? detail.comment
        : undefined,
    messageId,
    sessionId,
    topicSource: "session-title" as const,
    referent:
      messageId && messageText
        ? {
            sessionId,
            messageId,
            content: messageText.slice(0, 12_000),
            createdAt:
              typeof detail.messageCreatedAt === "number"
                ? detail.messageCreatedAt
                : undefined,
          }
        : undefined,
  };
}

interface AnsweredQuestionDetail {
  topic?: unknown;
  answers?: Array<{
    question?: unknown;
    answer?: unknown;
    score?: unknown;
    grading?: unknown;
  }>;
}

/** Well-formed answers only; malformed entries are dropped. */
export function answeredQuestions(detail: AnsweredQuestionDetail | undefined) {
  return detail?.answers?.filter(
    (
      answer,
    ): answer is {
      question: string;
      answer: string;
      score?: unknown;
      grading?: unknown;
    } =>
      typeof answer?.question === "string" &&
      typeof answer.answer === "string",
  ) ?? [];
}

export function useLearnerSignalEvents(
  refs: Pick<AgentHostRefs, "sessionIdRef">,
  posthog: Pick<PostHog, "capture">,
): void {
  const { sessionIdRef } = refs;

  useEffect(() => {
    const onMessageFeedback = async (event: Event) => {
      const detail = (event as CustomEvent<MessageFeedbackDetail>).detail;
      const signal = feedbackSignal(detail);
      if (!signal) return;
      const sessionId = sessionIdRef.current;
      const session = (await sessions.loadSession(
        sessionId,
      )) as SessionData | null;
      const topic = session?.title?.trim() || "general";
      posthog.capture("message_feedback_given", {
        signal,
        has_comment:
          typeof detail.comment === "string" &&
          detail.comment.trim().length > 0,
        session_id: sessionIdRef.current,
      });
      await keatingStorage.recordFeedback(topic, signal, messageFeedbackRecord(detail, sessionId));
    };
    window.addEventListener("keating:message-feedback", onMessageFeedback);
    return () =>
      window.removeEventListener("keating:message-feedback", onMessageFeedback);
  }, []);

  useEffect(() => {
    const onQuestionAnswered = (event: Event) => {
      const detail = (event as CustomEvent<AnsweredQuestionDetail>).detail;
      const answers = answeredQuestions(detail);
      if (answers.length === 0) return;
      void (async () => {
        const state = await keatingStorage.getLearnerState();
        const topic =
          typeof detail?.topic === "string" && detail.topic.trim()
            ? detail.topic.trim()
            : (state.topicsExplored.at(-1) ?? "general");
        await Promise.all(
          answers.map((answer) =>
            keatingStorage.recordQuestionCheck({
              topic,
              question: answer.question,
              answer: answer.answer,
              score:
                typeof answer.score === "number" ? answer.score : undefined,
              grading: answer.grading === "auto" ? "auto" : "pending",
              sessionId: sessionIdRef.current,
            }),
          ),
        );
      })();
    };
    window.addEventListener("keating:question-answered", onQuestionAnswered);
    return () =>
      window.removeEventListener(
        "keating:question-answered",
        onQuestionAnswered,
      );
  }, []);
}
