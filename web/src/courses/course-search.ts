import { allCourseLessons, type Course } from "./contracts";

export type CourseSearchKind =
  | "lesson"
  | "module"
  | "document"
  | "artifact"
  | "assignment"
  | "card"
  | "comment"
  | "note"
  | "member";

export interface CourseSearchResult {
  /** Unique across kinds so results can be keyed and compared directly. */
  key: string;
  kind: CourseSearchKind;
  id: string;
  title: string;
  detail: string;
  /** Present when opening the result should move the desk to a lesson. */
  lessonId?: string;
  score: number;
}

const KIND_WEIGHT: Record<CourseSearchKind, number> = {
  lesson: 6,
  module: 5,
  assignment: 4,
  artifact: 4,
  document: 4,
  note: 3,
  comment: 2,
  card: 2,
  member: 1,
};

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** A short excerpt centred on the first match, so results explain themselves. */
function excerpt(body: string, token: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const index = clean.toLowerCase().indexOf(token);
  if (index === -1) return clean.slice(0, 120);
  const start = Math.max(0, index - 40);
  const slice = clean.slice(start, start + 140);
  return `${start > 0 ? "…" : ""}${slice}${start + 140 < clean.length ? "…" : ""}`;
}

interface Candidate {
  kind: CourseSearchKind;
  id: string;
  title: string;
  body: string;
  fallbackDetail: string;
  lessonId?: string;
}

function scoreCandidate(
  candidate: Candidate,
  query: string,
  tokens: string[],
): CourseSearchResult | null {
  const title = candidate.title.toLowerCase();
  const body = candidate.body.toLowerCase();
  let score = KIND_WEIGHT[candidate.kind];
  for (const token of tokens) {
    const inTitle = title.includes(token);
    const inBody = body.includes(token);
    if (!inTitle && !inBody) return null;
    if (inTitle) score += 6;
    if (inBody) score += 2;
  }
  if (title.startsWith(query)) score += 8;
  else if (title.includes(query)) score += 4;
  const matched = tokens.find((token) => body.includes(token));
  return {
    key: `${candidate.kind}:${candidate.id}`,
    kind: candidate.kind,
    id: candidate.id,
    title: candidate.title,
    detail:
      (matched && !title.includes(matched)
        ? excerpt(candidate.body, matched)
        : "") || candidate.fallbackDetail,
    ...(candidate.lessonId ? { lessonId: candidate.lessonId } : {}),
    score,
  };
}

function courseCandidates(course: Course): Candidate[] {
  const lessonTitles = new Map(
    allCourseLessons(course).map((lesson) => [lesson.id, lesson.title]),
  );
  const attachedTo = (lessonId?: string): string =>
    lessonId
      ? `In ${lessonTitles.get(lessonId) ?? "a lesson"}`
      : "Course-wide";

  const candidates: Candidate[] = [];
  for (const module of course.modules) {
    candidates.push({
      kind: "module",
      id: module.id,
      title: module.title,
      body: module.description,
      fallbackDetail: `${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}`,
    });
    for (const lesson of module.lessons) {
      candidates.push({
        kind: "lesson",
        id: lesson.id,
        title: lesson.title,
        body: [
          lesson.summary,
          lesson.reading,
          lesson.objectives.join(" "),
          lesson.exercise?.prompt ?? "",
        ].join(" "),
        fallbackDetail: module.title,
        lessonId: lesson.id,
      });
    }
  }
  for (const material of course.materials) {
    candidates.push({
      kind: "document",
      id: material.id,
      title: material.title,
      body: [material.description ?? "", material.fileName ?? "", material.url ?? ""].join(" "),
      fallbackDetail: `${material.kind} · ${attachedTo(material.lessonId)}`,
      ...(material.lessonId ? { lessonId: material.lessonId } : {}),
    });
  }
  for (const artifact of course.artifacts) {
    candidates.push({
      kind: "artifact",
      id: artifact.id,
      title: artifact.title,
      body: [artifact.description ?? "", artifact.content.slice(0, 4_000)].join(" "),
      fallbackDetail: `${artifact.kind.replaceAll("-", " ")} · ${attachedTo(artifact.lessonId)}`,
      ...(artifact.lessonId ? { lessonId: artifact.lessonId } : {}),
    });
  }
  for (const assignment of course.assignments) {
    candidates.push({
      kind: "assignment",
      id: assignment.id,
      title: assignment.title,
      body: [
        assignment.brief,
        assignment.deliverables.join(" "),
        assignment.rubric.join(" "),
      ].join(" "),
      fallbackDetail: attachedTo(assignment.lessonId),
      ...(assignment.lessonId ? { lessonId: assignment.lessonId } : {}),
    });
  }
  for (const card of course.cards) {
    candidates.push({
      kind: "card",
      id: card.id,
      title: card.front,
      body: [card.back, card.tags.join(" ")].join(" "),
      fallbackDetail: `Card · ${attachedTo(card.lessonId)}`,
      ...(card.lessonId ? { lessonId: card.lessonId } : {}),
    });
  }
  for (const note of course.sharedNotes) {
    candidates.push({
      kind: "note",
      id: note.id,
      title: note.title,
      body: note.text,
      fallbackDetail: `Shared notes · ${attachedTo(note.lessonId)}`,
      lessonId: note.lessonId,
    });
  }
  const memberNames = new Map(
    course.members.map((member) => [member.accountId, member.displayName]),
  );
  for (const comment of course.comments) {
    candidates.push({
      kind: "comment",
      id: comment.id,
      title: memberNames.get(comment.accountId) ?? "Course member",
      body: comment.body,
      fallbackDetail: attachedTo(comment.lessonId),
      ...(comment.lessonId ? { lessonId: comment.lessonId } : {}),
    });
  }
  for (const member of course.members) {
    candidates.push({
      kind: "member",
      id: member.accountId,
      title: member.displayName,
      body: member.role,
      fallbackDetail: member.role,
    });
  }
  return candidates;
}

/**
 * Rank every addressable piece of a course against a free-text query. Pure so
 * the palette, the builder filters, and tests share one definition of a match.
 */
export function searchCourse(
  course: Course,
  query: string,
  options: { limit?: number; kinds?: readonly CourseSearchKind[] } = {},
): CourseSearchResult[] {
  const normalized = query.trim().toLowerCase();
  const tokens = tokenize(normalized);
  if (!tokens.length) return [];
  const allowed = options.kinds ? new Set(options.kinds) : null;
  const results: CourseSearchResult[] = [];
  for (const candidate of courseCandidates(course)) {
    if (allowed && !allowed.has(candidate.kind)) continue;
    const result = scoreCandidate(candidate, normalized, tokens);
    if (result) results.push(result);
  }
  results.sort(
    (left, right) =>
      right.score - left.score || left.title.localeCompare(right.title),
  );
  return results.slice(0, options.limit ?? 25);
}

export const COURSE_SEARCH_KIND_LABEL: Record<CourseSearchKind, string> = {
  lesson: "Lesson",
  module: "Module",
  document: "Document",
  artifact: "Artifact",
  assignment: "Assignment",
  card: "Card",
  comment: "Discussion",
  note: "Shared note",
  member: "Member",
};
