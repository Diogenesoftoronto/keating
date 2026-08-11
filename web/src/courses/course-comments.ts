import type {
  CourseComment,
  CourseReaction,
  CourseReactionTarget,
} from "./contracts";

/** Offered on every post; kept short so the row never wraps on a phone. */
export const COURSE_REACTION_EMOJI = ["👍", "🎯", "💡", "❓", "🔥", "🙌"] as const;

export interface CourseReactionSummary {
  emoji: string;
  count: number;
  /** True when the viewer is one of the reacting members. */
  reacted: boolean;
  accountIds: string[];
}

export interface CourseCommentThread {
  comment: CourseComment;
  replies: CourseComment[];
  /** Newest timestamp in the thread, used to float active threads up. */
  lastActivityAt: string;
}

export type CourseDiscussionScope =
  | { kind: "lesson"; lessonId: string }
  | { kind: "course" }
  | { kind: "all" };

function inScope(comment: CourseComment, scope: CourseDiscussionScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "course") return !comment.lessonId;
  return comment.lessonId === scope.lessonId;
}

function matches(comment: CourseComment, query: string): boolean {
  return comment.body.toLowerCase().includes(query);
}

/**
 * Group flat comments into two-level threads. Roots are ordered by their most
 * recent reply so a revived question does not sink below quiet newer ones.
 */
export function buildCommentThreads(
  comments: readonly CourseComment[],
  scope: CourseDiscussionScope,
  query = "",
): CourseCommentThread[] {
  const scoped = comments.filter((comment) => inScope(comment, scope));
  const repliesByParent = new Map<string, CourseComment[]>();
  for (const comment of scoped) {
    if (!comment.parentId) continue;
    const bucket = repliesByParent.get(comment.parentId);
    if (bucket) bucket.push(comment);
    else repliesByParent.set(comment.parentId, [comment]);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const threads: CourseCommentThread[] = [];
  for (const comment of scoped) {
    if (comment.parentId) continue;
    const replies = [...(repliesByParent.get(comment.id) ?? [])].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    );
    if (
      normalizedQuery &&
      !matches(comment, normalizedQuery) &&
      !replies.some((reply) => matches(reply, normalizedQuery))
    ) {
      continue;
    }
    const lastActivityAt = replies.length
      ? (replies[replies.length - 1]?.createdAt ?? comment.createdAt)
      : comment.createdAt;
    threads.push({ comment, replies, lastActivityAt });
  }
  threads.sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt),
  );
  return threads;
}

/** Reaction chips for one post, most used first, with the viewer's own state. */
export function summarizeReactions(
  reactions: readonly CourseReaction[],
  targetKind: CourseReactionTarget,
  targetId: string,
  viewerAccountId: string,
): CourseReactionSummary[] {
  const byEmoji = new Map<string, string[]>();
  for (const reaction of reactions) {
    if (reaction.targetKind !== targetKind || reaction.targetId !== targetId)
      continue;
    const bucket = byEmoji.get(reaction.emoji);
    if (bucket) bucket.push(reaction.accountId);
    else byEmoji.set(reaction.emoji, [reaction.accountId]);
  }
  return [...byEmoji.entries()]
    .map(([emoji, accountIds]) => ({
      emoji,
      count: accountIds.length,
      reacted: accountIds.includes(viewerAccountId),
      accountIds,
    }))
    .sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji));
}

/** Comment totals per lesson id, plus a `course` bucket for the shared thread. */
export function commentCounts(
  comments: readonly CourseComment[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const comment of comments) {
    const key = comment.lessonId ?? "course";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function reactionNames(
  summary: CourseReactionSummary,
  displayName: (accountId: string) => string,
): string {
  return summary.accountIds.map(displayName).join(", ");
}
