/**
 * Browse local or hosted courses and prepare a lesson.
 */
import { type TuiCourseLesson, type TuiCourseModule, courseLessonOption, courseLessonPrompt, courseMarkdown, courseOption, listTuiCourses } from "../../courses.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, restoreIdleStatus } from "./common.js";

export type CoursesDeps = Pick<HostContext, "cwd" | "dialogs" | "state" | "view">;

export async function showCourses(deps: CoursesDeps): Promise<void> {
  const { cwd, dialogs } = deps;
  const { appendEntry, idleStatus, status, composer: input } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Courses")) return;
  status.content = "Loading courses…";
  try {
    const courses = await listTuiCourses(cwd);
    if (courses.length === 0) {
      appendEntry({
        id: `courses-empty-${Date.now()}`,
        kind: "notice",
        title: "No courses available",
        body: "Add a course JSON snapshot under .keating/courses/ or set KEATING_COURSES_ORIGIN for a hosted read-through. The web course workspace remains available through /shell or keating web.",
      });
      return;
    }
    const courseOptions = courses.map(courseOption);
    const selected = await presentSelect("Courses", courseOptions);
    if (selected === undefined) return;
    const course = courses[courseOptions.indexOf(selected)];
    if (!course) return;
    appendEntry({ id: `course-${Date.now()}`, kind: "artifact", title: course.title, body: courseMarkdown(course), detail: course.source === "remote" ? "Hosted course snapshot" : "Local course snapshot" });
    const lessons = course.modules.flatMap((module): Array<{ module: TuiCourseModule; lesson: TuiCourseLesson }> => module.lessons.map((lesson) => ({ module, lesson })));
    if (lessons.length === 0) {
      status.content = idleStatus();
      return;
    }
    const lessonOptions = lessons.map(({ module, lesson }, index) => courseLessonOption(module, lesson, index));
    const lessonSelection = await presentSelect(`${course.title} · choose a lesson`, lessonOptions);
    if (lessonSelection === undefined) return;
    const lessonIndex = lessonOptions.indexOf(lessonSelection);
    const selectedLesson = lessons[lessonIndex]?.lesson;
    if (!selectedLesson) return;
    const action = await presentSelect(`${selectedLesson.title} · ${course.title}`, ["Start lesson in composer", "Show lesson here", "Cancel"]);
    if (action === "Start lesson in composer") {
      input.value = courseLessonPrompt(course, selectedLesson);
      appendEntry({ id: `course-prompt-${Date.now()}`, kind: "notice", title: "Lesson prepared", body: "The lesson prompt is in the composer. Edit it, then press Enter." });
    } else if (action === "Show lesson here") {
      appendEntry({ id: `course-lesson-${Date.now()}`, kind: "artifact", title: selectedLesson.title, body: [selectedLesson.summary, selectedLesson.reading, selectedLesson.exercise ? `**Exercise:** ${selectedLesson.exercise.prompt}` : ""].filter(Boolean).join("\n\n") });
    }
  } catch (error) {
    appendEntry({ id: `courses-error-${Date.now()}`, kind: "error", title: "Courses unavailable", body: `${sanitizeDiagnostic(error)}\n\nNo course state was changed. Add a local snapshot or use /shell for the hosted course workspace.` });
  } finally {
    restoreIdleStatus(deps);
  }
}
