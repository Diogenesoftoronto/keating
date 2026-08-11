import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
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

const chipClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  border: "1px solid color-mix(in srgb, var(--ink) 40%, transparent)",
  bg: "var(--paper)",
  px: "0.4rem",
  py: "0.15rem",
  fontSize: "0.72rem",
  lineHeight: 1.5,
  cursor: "pointer",
  _hover: { borderColor: "var(--ink)" },
  _disabled: { opacity: 0.5, cursor: "not-allowed" },
});

const activeChipClass = css({
  borderColor: "var(--course-green-dark, #14743c)",
  bg: "var(--course-wash, #ddebdd)",
  fontWeight: 700,
});

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
  const [pickerOpen, setPickerOpen] = useState(false);
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
    <div
      className={css({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.3rem",
      })}
    >
      {summaries.map((summary) => (
        <button
          key={summary.emoji}
          type="button"
          disabled={disabled}
          className={cx(chipClass, summary.reacted && activeChipClass)}
          title={reactionNames(summary, displayName)}
          aria-pressed={summary.reacted}
          onClick={() => onToggle(summary.emoji)}
        >
          <span aria-hidden>{summary.emoji}</span>
          <span className={css({ fontFamily: "var(--mono-display)" })}>
            {summary.count}
          </span>
        </button>
      ))}
      {disabled ? null : pickerOpen ? (
        <span
          className={css({
            display: "inline-flex",
            alignItems: "center",
            gap: "0.15rem",
            border: "1px solid var(--ink)",
            bg: "var(--paper)",
            px: "0.2rem",
            py: "0.1rem",
          })}
        >
          {COURSE_REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              className={css({
                px: "0.2rem",
                py: "0.1rem",
                fontSize: "0.95rem",
                lineHeight: 1.2,
                cursor: "pointer",
                _hover: { bg: "var(--course-wash, #ddebdd)" },
              })}
              onClick={() => {
                onToggle(emoji);
                setPickerOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : (
        <button
          type="button"
          className={cx(
            chipClass,
            css({ color: "var(--ink-soft)", borderStyle: "dashed" }),
          )}
          aria-label="Add a reaction"
          onClick={() => setPickerOpen(true)}
        >
          <SmilePlus size={13} />
        </button>
      )}
    </div>
  );
}
