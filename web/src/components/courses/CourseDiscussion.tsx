import { Avatar, Button, Card, Eyebrow, EmptyState, Field, IconButton, Kbd, Note, Prose, SearchField, Segmented, TextArea } from "../../design-system/kit";
import { Select } from "../Select";
import { useEffect, useMemo, useState } from "react";
import "../../pages/course-workspace/course-tabs.css";
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
import { formatCourseRelative } from "./course-ui";

type Mutate = (
  operation: Parameters<typeof applyCourseOperation>[0],
  label: string,
) => Promise<void>;

export const COURSE_CHANNEL = "__course__";
export const ALL_CHANNEL = "__all__";

function newCommentId(): string {
  return `comment_${crypto.randomUUID().replaceAll("-", "")}`;
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
    <Card as="article" className="ct-comment">
      <header className="ct-row">
        <Avatar name={author?.displayName ?? "Course member"} size="sm" aria-hidden />
        <div className="ct-byline">
          <strong>{mine ? "You" : (author?.displayName ?? "Course member")}</strong>
          <small>{formatCourseRelative(comment.createdAt)}{comment.editedAt ? " · edited" : ""}</small>
        </div>
        {lessonTitle && onOpenLesson && <Button size="sm" variant="line" onClick={onOpenLesson}>{lessonTitle}</Button>}
        <span className="ct-actions">
          {onReply && canPost ? (
            <Button glyph="reply" size="sm" variant="ghost" onClick={onReply}>Reply</Button>
          ) : null}
          {mine && !editing ? (
            <IconButton glyph="edit"
              type="button"
              size="sm"
              label="Edit comment"
              onClick={() => setEditing(true)} />
          ) : null}
          {canDelete ? (
            <IconButton glyph="trash"
              type="button"
              className="ct-danger"
              label="Delete comment"
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
              }} />
          ) : null}
        </span>
      </header>
      {editing ? (
        <div className="ct-stack">
          <TextArea
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Edit comment"
          />
          <div className="ct-footer">
            <Button
              type="button"
              variant="line"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
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
            </Button>
          </div>
        </div>
      ) : (
        <Prose className="ct-text">{comment.body}</Prose>
      )}
      <div>
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
      </div>
    </Card>
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
    if (!draft.trim() || !postable || saving === "comment-add") return;
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
    if (!replyDraft.trim() || saving === `comment-reply-${parentId}`) return;
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

  const channels = [
    { value: COURSE_CHANNEL, label: `Course-wide thread (${counts.course ?? 0})` },
    ...lessons.map(lesson => ({ value: lesson.id, label: `${lesson.title} (${counts[lesson.id] ?? 0})` })),
    { value: ALL_CHANNEL, label: `Everything (${snapshot.course.comments.length})` },
  ];
  function selectChannel(next: string) {
    setReplyTo(null);
    if (next === COURSE_CHANNEL || next === ALL_CHANNEL) onChannelChange(next);
    else onSelectLesson(next);
  }

  return (
    <div className="ct-tab">
      <header className="k-halftone">
        <Eyebrow>Discussion</Eyebrow>
        <h2>Think where others can answer.</h2>
      </header>
      <div className="ct-tools">
        {channels.length <= 4 ? (
          <div className="ct-stack">
            <Eyebrow>Channel</Eyebrow>
            <Segmented size="sm" label="Channel" options={channels} value={channel} onChange={selectChannel}/>
          </div>
        ) : (
          <Field label="Channel">
            <Select value={channel} onValueChange={selectChannel} className="k-input">
              {channels.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
        )}
        <div className="ct-stack">
          <Eyebrow>Find in discussion</Eyebrow>
          <SearchField data-glyph-host label="Search threads" placeholder="Search threads…" value={filter} onChange={setFilter}/>
        </div>
      </div>
      {postable ? (
        <Card tone="hard" className="ct-composer">
          <TextArea
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                post();
            }}
            placeholder={
              channel === COURSE_CHANNEL
                ? "Ask the whole course…"
                : "Ask or add context for this lesson…"
            }
            aria-label="Write a comment"
          />
          <div className="ct-footer">
            <Kbd>⌘ / Ctrl + Enter</Kbd>
            <Button glyph="send" variant="primary" disabled={!draft.trim()} busy={saving === "comment-add"} onClick={post}>Post comment</Button>
          </div>
        </Card>
      ) : (
        <Note>
          {canPost
            ? "Pick a channel to post in. “Everything” is read-only."
            : "Peer comments are turned off for this course."}
        </Note>
      )}

      <div className="ct-stack">
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
                <div className="ct-replies">
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
                <Card className="ct-composer ct-replies">
                  <TextArea
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
                    placeholder="Reply…"
                    aria-label="Write a reply"
                  />
                  <div className="ct-footer">
                    <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancel reply</Button>
                    <Button size="sm" glyph="send" variant="primary" disabled={!replyDraft.trim()}
                      busy={saving === `comment-reply-${thread.comment.id}`} onClick={() => postReply(thread.comment.id)}>Post reply</Button>
                  </div>
                </Card>
              ) : null}
            </section>
          ))
        ) : (
          <EmptyState glyph="message" heading={filter.trim()
              ? "No thread matches that search."
              : "No thread yet. Leave the first useful question."} />
        )}
      </div>
    </div>
  );
}
