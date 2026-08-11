import { Fragment, useMemo } from "react";
import { View } from "react-native";
import { GoalCard } from "@/components/cards/GoalCard";
import { QuestionCard } from "@/components/cards/QuestionCard";
import { QuizCard } from "@/components/cards/QuizCard";
import { MarkdownText } from "@/components/MarkdownText";
import { parseInteractiveSegments } from "@/lib/interactive-tags";
import { interactiveCardFallback } from "@/lib/interactive-card-fallback";
import {
  interactiveRecordId,
  portableGoalFromInteractive,
  portableQuestionChecksFromInteractive,
  portableQuizResultFromInteractive,
} from "@/lib/interactive-learning-records";
import { cardKey } from "@/state/card-state";
import { useKeating } from "@/state/KeatingProvider";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { hideUiDocumentWireWhileStreaming } from "@/lib/ui-document-wire";

/**
 * Renders an assistant turn: prose as markdown, and any `<keating-… />` tags it
 * carries as interactive cards.
 *
 * While a reply is still streaming the tag is usually incomplete, so parsing
 * simply finds no card yet and the partial markup stays hidden until the
 * closing `/>` arrives.
 */
export function MessageContent({
  messageId,
  content,
  streaming = false,
  onCardResult,
}: {
  messageId: string;
  content: string;
  streaming?: boolean;
  /** Sends a learner turn built from a card back into the conversation. */
  onCardResult: (text: string) => Promise<void>;
}) {
  const segments = useMemo(() => parseInteractiveSegments(content), [content]);
  const { settings } = useUiSettings();
  const {
    activeSession,
    learnerData,
    saveLearnerGoalStep,
    saveLearnerQuestionChecks,
    saveLearnerQuizResult,
  } = useKeating();

  return (
    <View>
      {segments.map((segment, index) => {
        const key = cardKey(messageId, index);
        if (segment.type === "text") {
          return <MarkdownText key={key} content={hideUnclosedTag(segment.content, streaming)} />;
        }
        // Cards stay inert until the reply is complete; submitting mid-stream
        // would interleave a learner turn with the one still arriving.
        if (streaming) return <Fragment key={key} />;
        // Saved replies may contain cards even after the preference is turned
        // off. Render the complete activity as Markdown so the learner can
        // still answer through the normal composer.
        if (!settings.showToolUi) {
          return <MarkdownText key={key} content={interactiveCardFallback(segment)} />;
        }
        if (segment.type === "quiz") {
          const saved = learnerData?.quizResults.find((result) => result.id === interactiveRecordId("quiz", key, 0));
          const savedAnswers = saved ? Object.fromEntries(segment.quiz.questions.map((question, questionIndex) => [
            question.id,
            saved.answers[interactiveRecordId("quiz-question", key, questionIndex)] ?? "",
          ])) : undefined;
          return (
            <QuizCard
              key={key}
              cardKey={key}
              quiz={segment.quiz}
              initialState={saved ? { answers: savedAnswers ?? {}, submitted: true } : undefined}
              onSubmit={async (answers, report) => {
                await saveLearnerQuizResult(portableQuizResultFromInteractive(
                  segment.quiz,
                  answers,
                  key,
                  new Date().toISOString(),
                  activeSession.id,
                ));
                await onCardResult(report);
              }}
            />
          );
        }
        if (segment.type === "question") {
          const savedById = new Map(learnerData?.questionChecks.map((check) => [check.id, check]) ?? []);
          const savedAnswers = segment.form.questions.map((_, questionIndex) => (
            savedById.get(interactiveRecordId("question-check", key, questionIndex))?.answer ?? ""
          ));
          const hasSavedAnswers = savedAnswers.some((answer) => answer.length > 0);
          return (
            <QuestionCard
              key={key}
              cardKey={key}
              form={segment.form}
              initialState={hasSavedAnswers ? { answers: savedAnswers, submitted: true } : undefined}
              onSubmit={async (answers, report) => {
                const projected = portableQuestionChecksFromInteractive(
                  segment.form,
                  answers,
                  key,
                  new Date().toISOString(),
                  activeSession.id,
                );
                await saveLearnerQuestionChecks(projected.checks);
                await onCardResult(report);
              }}
            />
          );
        }
        const savedGoal = learnerData?.goals.find((goal) => goal.id === interactiveRecordId("goal", key, 0));
        const savedStatuses = savedGoal ? Object.fromEntries(segment.goal.steps.map((step, stepIndex) => [
          step.id,
          savedGoal.steps.find((savedStep) => savedStep.id === interactiveRecordId("goal-step", key, stepIndex))?.status
            ?? step.status,
        ])) : undefined;
        return (
          <GoalCard
            key={key}
            cardKey={key}
            goal={segment.goal}
            initialStatuses={savedStatuses}
            onStepStatusChange={async (stepIndex, status) => {
              const portable = portableGoalFromInteractive(segment.goal, key, new Date().toISOString());
              await saveLearnerGoalStep(portable, portable.steps[stepIndex].id, status);
            }}
            onReport={onCardResult}
          />
        );
      })}
    </View>
  );
}

/** Trims a tag that is still being streamed so raw JSON never flashes on screen. */
function hideUnclosedTag(content: string, streaming: boolean): string {
  if (!streaming) return content;
  const opening = content.lastIndexOf("<keating-");
  const withoutLegacy = opening === -1 ? content : content.slice(0, opening).trimEnd();
  return hideUiDocumentWireWhileStreaming(withoutLegacy);
}
