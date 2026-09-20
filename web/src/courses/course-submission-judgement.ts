import type { CourseViewerSnapshot } from "./contracts";
import { addCourseSource, finishCourseReviewSnapshot, type CourseReviewTarget, type CourseSourceBlock, type ReviewUnavailable } from "./course-judgement";

/** This receives the server-projected visible snapshot, not unrestricted course storage. */
export async function buildCourseSubmissionSnapshot(view: CourseViewerSnapshot, target: Exclude<CourseReviewTarget, { kind: "author" }>) {
  const blocks: CourseSourceBlock[] = [];
  const course = view.course;
  const submitted = target.kind === "lesson" ? course.submissions.find(row => row.id === target.submissionId)
    : course.assignmentSubmissions.find(row => row.id === target.submissionId);
  const task = target.kind === "assignment" && submitted && "assignmentId" in submitted
    ? course.assignments.find(row => row.id === submitted.assignmentId) : undefined;
  const lessonId = submitted && "lessonId" in submitted ? submitted.lessonId : task?.lessonId;
  const lesson = course.modules.flatMap(module => module.lessons).find(row => row.id === lessonId);
  const exercise = target.kind === "lesson" && submitted && "exerciseId" in submitted && lesson?.exercise?.id === submitted.exerciseId ? lesson.exercise : undefined;
  const add = (id: string, label: string, text: string) => addCourseSource(blocks, id, label, text);
  let unavailable: ReviewUnavailable | null = !view.permissions.canReview ? "permission" : !submitted || (!task && !exercise) ? "no-content" : null;
  const omitted: string[] = [];
  if (submitted) {
    addCourseSource(blocks, `submission/${submitted.id}/answer`, "Submitted answer", submitted.answer, true);
    if (!submitted.answer.trim() || /^\s*https?:\/\/\S+\s*$/i.test(submitted.answer)) unavailable ??= "unseen-work";
    if ("attachments" in submitted && submitted.attachments?.length) omitted.push("Attachments were not opened. This suggestion covers submitted text only.");
  }
  if (exercise) {
    add(`exercise/${exercise.id}/prompt`, "Task instructions", exercise.prompt);
    exercise.rubric.forEach((text, i) => add(`exercise/${exercise.id}/rubric/${i}`, `Task rubric ${i + 1}`, text));
  }
  if (task) {
    add(`assignment/${task.id}/brief`, "Task instructions", task.brief);
    task.rubric.forEach((text, i) => add(`assignment/${task.id}/rubric/${i}`, `Task rubric ${i + 1}`, text));
    task.deliverables.forEach((text, i) => add(`assignment/${task.id}/deliverables/${i}`, `Required deliverable ${i + 1}`, text));
    task.taskItems?.forEach(item => add(`assignment/${task.id}/item/${item.id}`, item.title, item.detail ?? item.title));
  }
  if (lesson) {
    add(`lesson/${lesson.id}/reading`, "Task reference reading", lesson.reading);
    if (lesson.materialIds.length) omitted.push("Linked lesson materials were not opened.");
  }
  return finishCourseReviewSnapshot(view, target, blocks, omitted, unavailable,
    submitted ? { version: submitted.version, updatedAt: submitted.updatedAt } : null);
}
