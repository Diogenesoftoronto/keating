import { useEffect, useMemo, useState } from "react";
import {
  CornerDownRight,
  MessageSquareText,
  Pencil,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { newCourseOperationId, type applyCourseOperation } from "../../courses/client";
import {
  buildCommentThreads,
  commentCounts,
  type CourseDiscussionScope,
} from "../../courses/course-comments";
import type {
  CourseComment,
  CourseViewerSnapshot,
} from "../../courses/contracts";
import { CourseReactionBar } from "./CourseReactionBar";
import {
  courseAvatarColor,
  courseButtonClass,
  courseEmptyClass,
  courseInputClass,
  courseLabelClass,
  coursePrimaryButtonClass,
  formatCourseRelative,
} from "./course-ui";

type Mutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

export const COURSE_CHANNEL = "__course__";
export const ALL_CHANNEL = "__all__";

function newCommentId(): string {
  return `comment_${crypto.randomUUID().replaceAll("-", "")}`;
}

function Avatar({ name, role }: { name: string; role: string }) {
  return (
    <span
      aria-hidden
      className={css({
        display: "grid",
        h: "1.7rem",
        w: "1.7rem",
        flexShrink: 0,
        placeItems: "center",
        borderRadius: "50%",
        fontSize: "0.8rem",
        fontWeight: 800,
        color: "white",
      })}
      style={{ background: courseAvatarColor(role) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function CommentCard({
  snapshot,
  comment,
  saving,
  mutate,
  canPost,
  isReply,
  lessonTitle,
  onReply,
  onOpenLesson,
}: {
  snapshot: CourseViewerSnapshot;
  comment: CourseComment;
  saving: string;
  mutate: Mutate;
  canPost: boolean;
  isReply: boolean;
  lessonTitle?: string;
  onReply?: () => void;
  onOpenLesson?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  useEffect(() => setDraft(comment.body), [comment.body]);
  const author = snapshot.course.members.find(
    (member) => member.accountId === comment.accountId,
  );
  const mine = comment.accountId === snapshot.viewer.accountId;
  const canDelete = mine || snapshot.permissions.canReview;

  const base = () => ({
    id: newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  });

  return (
    <article
      className={css({
        borderLeft: "3px solid var(--peer-blue, #3468b3)",
        bg: "var(--paper)",
        px: "0.75rem",
        py: "0.6rem",
      })}
      style={isReply ? { borderLeftColor: "color-mix(in srgb, var(--ink) 35%, transparent)" } : undefined}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        })}
      >
        <Avatar
          name={author?.displayName ?? "?"}
          role={author?.role ?? "peer"}
        />
        <span className={css({ minW: 0, flex: 1 })}>
          <strong className={css({ fontSize: "0.8rem" })}>
            {mine ? "You" : (author?.displayName ?? "Course member")}
          </strong>
          <small
            className={css({
              ml: "0.4rem",
              fontSize: "0.68rem",
              color: "var(--ink-soft)",
            })}
          >
            {formatCourseRelative(comment.createdAt)}
            {comment.editedAt ? " · edited" : ""}
          </small>
        </span>
        {lessonTitle && onOpenLesson ? (
          <button
            type="button"
            onClick={onOpenLesson}
            className={css({
              border: "1px solid color-mix(in srgb, var(--ink) 30%, transparent)",
              px: "0.35rem",
              fontSize: "0.63rem",
              color: "var(--ink-soft)",
              cursor: "pointer",
              _hover: { color: "var(--ink)" },
            })}
          >
            {lessonTitle}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className={css({ mt: "0.5rem", display: "grid", gap: "0.4rem" })}>
          <textarea
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            className={courseInputClass}
            aria-label="Edit comment"
          />
          <div className={css({ display: "flex", gap: "0.35rem", justifyContent: "flex-end" })}>
            <button
              type="button"
              className={courseButtonClass}
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cx(courseButtonClass, coursePrimaryButtonClass)}
              disabled={!draft.trim() || saving === `comment-edit-${comment.id}`}
              onClick={() =>
                void mutate(
                  {
                    ...base(),
                    type: "comment.update",
                    commentId: comment.id,
                    body: draft.trim(),
                  },
                  `comment-edit-${comment.id}`,
                ).then(() => setEditing(false))
              }
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p
          className={css({
            mt: "0.4rem",
            whiteSpace: "pre-wrap",
            fontSize: "0.88rem",
            lineHeight: 1.55,
          })}
        >
          {comment.body}
        </p>
      )}
      <div
        className={css({
          mt: "0.5rem",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        })}
      >
        <CourseReactionBar
          reactions={snapshot.course.reactions}
          members={snapshot.course.members}
          targetKind="comment"
          targetId={comment.id}
          viewerAccountId={snapshot.viewer.accountId}
          disabled={!canPost}
          onToggle={(emoji) =>
            void mutate(
              {
                ...base(),
                type: "reaction.toggle",
                targetKind: "comment",
                targetId: comment.id,
                emoji,
              },
              `reaction-${comment.id}-${emoji}`,
            )
          }
        />
        <span className={css({ display: "flex", gap: "0.25rem" })}>
          {onReply && canPost ? (
            <button type="button" className={courseButtonClass} onClick={onReply}>
              <CornerDownRight size={12} /> Reply
            </button>
          ) : null}
          {mine && !editing ? (
            <button
              type="button"
              className={courseButtonClass}
              aria-label="Edit comment"
              onClick={() => setEditing(true)}
            >
              <Pencil size={12} />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className={cx(courseButtonClass, css({ color: "var(--destructive)" }))}
              aria-label="Delete comment"
              disabled={saving === `comment-delete-${comment.id}`}
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  !window.confirm(
                    isReply
                      ? "Remove this reply?"
                      : "Remove this comment and its replies?",
                  )
                )
                  return;
                void mutate(
                  { ...base(), type: "comment.delete", commentId: comment.id },
                  `comment-delete-${comment.id}`,
                );
              }}
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </span>
      </div>
    </article>
  );
}

/**
 * Threaded course discussion: one channel per lesson plus a course-wide room,
 * with replies, edits, removals, and reactions on every post.
 */
export function CourseDiscussion({
  snapshot,
  channel,
  onChannelChange,
  saving,
  mutate,
  onSelectLesson,
}: {
  snapshot: CourseViewerSnapshot;
  /** COURSE_CHANNEL, ALL_CHANNEL, or a lesson id. Owned by the workspace. */
  channel: string;
  onChannelChange(channel: string): void;
  saving: string;
  mutate: Mutate;
  onSelectLesson(lessonId: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [filter, setFilter] = useState("");

  const lessons = useMemo(
    () => snapshot.course.modules.flatMap((module) => module.lessons),
    [snapshot.course.modules],
  );
  const counts = useMemo(
    () => commentCounts(snapshot.course.comments),
    [snapshot.course.comments],
  );
  const scope: CourseDiscussionScope =
    channel === COURSE_CHANNEL
      ? { kind: "course" }
      : channel === ALL_CHANNEL
        ? { kind: "all" }
        : { kind: "lesson", lessonId: channel };
  const threads = useMemo(
    () => buildCommentThreads(snapshot.course.comments, scope, filter),
    [snapshot.course.comments, channel, filter],
  );
  const canPost =
    snapshot.course.settings.allowPeerComments || snapshot.permissions.canReview;
  const postable = channel !== ALL_CHANNEL && canPost;

  const base = () => ({
    id: newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  });

  const post = () => {
    if (!draft.trim() || !postable) return;
    void mutate(
      {
        ...base(),
        type: "comment.add",
        commentId: newCommentId(),
        ...(channel === COURSE_CHANNEL ? {} : { lessonId: channel }),
        body: draft.trim(),
      },
      "comment-add",
    ).then(() => setDraft(""));
  };

  const postReply = (parentId: string) => {
    if (!replyDraft.trim()) return;
    void mutate(
      {
        ...base(),
        type: "comment.add",
        commentId: newCommentId(),
        parentId,
        body: replyDraft.trim(),
      },
      `comment-reply-${parentId}`,
    ).then(() => {
      setReplyDraft("");
      setReplyTo(null);
    });
  };

  return (
    <div className={css({ mx: "auto", maxW: "48rem" })}>
      <div
        className={css({
          display: "flex",
          flexWrap: "wrap",
          alignItems: "end",
          justifyContent: "space-between",
          gap: "0.75rem",
        })}
      >
        <div>
          <p className={courseLabelClass}>Discussion</p>
          <h2
            className={css({
              mt: "0.3rem",
              fontFamily: "Georgia, serif",
              fontSize: { base: "1.9rem", md: "2.4rem" },
              lineHeight: 1.05,
            })}
          >
            Think where others can answer.
          </h2>
        </div>
        <MessageSquareText size={22} />
      </div>

      <div
        className={css({
          mt: "1.1rem",
          display: "grid",
          gap: "0.45rem",
          sm: { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" },
        })}
      >
        <label>
          <span className={cx(courseLabelClass, css({ display: "block", mb: "0.2rem" }))}>
            Channel
          </span>
          <select
            value={channel}
            onChange={(event) => {
              const next = event.target.value;
              setReplyTo(null);
              if (next !== COURSE_CHANNEL && next !== ALL_CHANNEL)
                onSelectLesson(next);
              else onChannelChange(next);
            }}
            className={courseInputClass}
          >
            <option value={COURSE_CHANNEL}>
              Course-wide thread ({counts.course ?? 0})
            </option>
            {lessons.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {lesson.title} ({counts[lesson.id] ?? 0})
              </option>
            ))}
            <option value={ALL_CHANNEL}>
              Everything ({snapshot.course.comments.length})
            </option>
          </select>
        </label>
        <label>
          <span className={cx(courseLabelClass, css({ display: "block", mb: "0.2rem" }))}>
            Find in discussion
          </span>
          <span
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              border: "1px solid var(--ink)",
              bg: "var(--paper)",
              px: "0.55rem",
            })}
          >
            <Search size={14} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search threads…"
              aria-label="Search threads"
              className={css({
                w: "100%",
                bg: "transparent",
                py: "0.5rem",
                fontSize: "0.82rem",
                outline: 0,
              })}
            />
          </span>
        </label>
      </div>

      {postable ? (
        <div
          className={css({
            mt: "0.85rem",
            display: "flex",
            alignItems: "stretch",
            gap: "0.45rem",
          })}
        >
          <textarea
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                post();
            }}
            className={cx(courseInputClass, css({ resize: "vertical" }))}
            placeholder={
              channel === COURSE_CHANNEL
                ? "Ask the whole course…"
                : "Ask or add context for this lesson…"
            }
            aria-label="Write a comment"
          />
          <button
            type="button"
            className={cx(courseButtonClass, coursePrimaryButtonClass)}
            disabled={!draft.trim() || saving === "comment-add"}
            onClick={post}
            aria-label="Post comment"
            title="Post · ⌘↵"
          >
            <Send size={15} />
          </button>
        </div>
      ) : (
        <p className={cx(courseEmptyClass, css({ mt: "0.85rem" }))}>
          {canPost
            ? "Pick a channel to post in. “Everything” is read-only."
            : "Peer comments are turned off for this course."}
        </p>
      )}

      <div className={css({ mt: "1.1rem", display: "grid", gap: "0.7rem" })}>
        {threads.length ? (
          threads.map((thread) => (
            <section key={thread.comment.id}>
              <CommentCard
                snapshot={snapshot}
                comment={thread.comment}
                saving={saving}
                mutate={mutate}
                canPost={canPost}
                isReply={false}
                {...(channel === ALL_CHANNEL && thread.comment.lessonId
                  ? {
                      lessonTitle:
                        lessons.find(
                          (lesson) => lesson.id === thread.comment.lessonId,
                        )?.title ?? "Lesson",
                      onOpenLesson: () =>
                        onSelectLesson(thread.comment.lessonId as string),
                    }
                  : {})}
                onReply={() => {
                  setReplyTo(
                    replyTo === thread.comment.id ? null : thread.comment.id,
                  );
                  setReplyDraft("");
                }}
              />
              {thread.replies.length ? (
                <div
                  className={css({
                    ml: { base: "0.6rem", sm: "1.6rem" },
                    mt: "0.4rem",
                    display: "grid",
                    gap: "0.4rem",
                  })}
                >
                  {thread.replies.map((reply) => (
                    <CommentCard
                      key={reply.id}
                      snapshot={snapshot}
                      comment={reply}
                      saving={saving}
                      mutate={mutate}
                      canPost={canPost}
                      isReply
                    />
                  ))}
                </div>
              ) : null}
              {replyTo === thread.comment.id ? (
                <div
                  className={css({
                    ml: { base: "0.6rem", sm: "1.6rem" },
                    mt: "0.4rem",
                    display: "flex",
                    alignItems: "stretch",
                    gap: "0.4rem",
                  })}
                >
                  <textarea
                    value={replyDraft}
                    rows={2}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key === "Enter"
                      )
                        postReply(thread.comment.id);
                    }}
                    className={cx(courseInputClass, css({ resize: "vertical" }))}
                    placeholder="Reply…"
                    aria-label="Write a reply"
                  />
                  <button
                    type="button"
                    className={cx(courseButtonClass, coursePrimaryButtonClass)}
                    disabled={
                      !replyDraft.trim() ||
                      saving === `comment-reply-${thread.comment.id}`
                    }
                    onClick={() => postReply(thread.comment.id)}
                    aria-label="Post reply"
                  >
                    <Send size={14} />
                  </button>
                  <button
                    type="button"
                    className={courseButtonClass}
                    aria-label="Cancel reply"
                    onClick={() => setReplyTo(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}
            </section>
          ))
        ) : (
          <p className={courseEmptyClass}>
            {filter.trim()
              ? "No thread matches that search."
              : "No thread yet. Leave the first useful question."}
          </p>
        )}
      </div>
    </div>
  );
}
