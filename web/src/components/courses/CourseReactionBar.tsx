import "../../pages/course-workspace/course-tabs.css";
import { Chip, Menu, IconButton } from "../../design-system/kit";
import {
  COURSE_REACTION_EMOJI,
  reactionNames,
  summarizeReactions,
} from "../../courses/course-comments";
import type {
  CourseMember,
  CourseReaction,
  CourseReactionTarget,
} from "../../courses/contracts";

/** Emoji reactions for any course post: a comment, a document, an artifact. */
export function CourseReactionBar({
  reactions,
  members,
  targetKind,
  targetId,
  viewerAccountId,
  onToggle,
  disabled = false,
}: {
  reactions: readonly CourseReaction[];
  members: readonly CourseMember[];
  targetKind: CourseReactionTarget;
  targetId: string;
  viewerAccountId: string;
  onToggle(emoji: string): void;
  disabled?: boolean;
}) {
  const summaries = summarizeReactions(
    reactions,
    targetKind,
    targetId,
    viewerAccountId,
  );
  const displayName = (accountId: string) =>
    accountId === viewerAccountId
      ? "You"
      : (members.find((member) => member.accountId === accountId)
          ?.displayName ?? "Course member");

  return (
    <div className="ct-reactions">
      {!disabled && <Menu label="Add a reaction" trigger={<IconButton glyph="react" size="sm" label="Add a reaction"/>}
        items={COURSE_REACTION_EMOJI.map(emoji => ({ id: emoji, label: `React with ${emoji}`, onSelect: () => onToggle(emoji) }))}/>}
      {summaries.map(summary => (
        <Chip as="button" key={summary.emoji} selected={summary.reacted} disabled={disabled}
          count={summary.count} title={reactionNames(summary, displayName)}
          aria-label={`React with ${summary.emoji}, ${summary.count}: ${reactionNames(summary, displayName)}`}
          onClick={() => onToggle(summary.emoji)}>
          {summary.emoji}
        </Chip>
      ))}
    </div>
  );
}
