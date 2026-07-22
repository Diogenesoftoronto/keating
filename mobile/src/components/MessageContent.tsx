import { Fragment, useMemo } from "react";
import { View } from "react-native";
import { GoalCard } from "@/components/cards/GoalCard";
import { QuestionCard } from "@/components/cards/QuestionCard";
import { QuizCard } from "@/components/cards/QuizCard";
import { MarkdownText } from "@/components/MarkdownText";
import { parseInteractiveSegments } from "@/lib/interactive-tags";
import { cardKey } from "@/state/card-state";

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
  onCardResult: (text: string) => void;
}) {
  const segments = useMemo(() => parseInteractiveSegments(content), [content]);

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
        if (segment.type === "quiz") {
          return <QuizCard key={key} cardKey={key} quiz={segment.quiz} onSubmit={onCardResult} />;
        }
        if (segment.type === "question") {
          return <QuestionCard key={key} cardKey={key} form={segment.form} onSubmit={onCardResult} />;
        }
        return <GoalCard key={key} cardKey={key} goal={segment.goal} onReport={onCardResult} />;
      })}
    </View>
  );
}

/** Trims a tag that is still being streamed so raw JSON never flashes on screen. */
function hideUnclosedTag(content: string, streaming: boolean): string {
  if (!streaming) return content;
  const opening = content.lastIndexOf("<keating-");
  return opening === -1 ? content : content.slice(0, opening).trimEnd();
}
