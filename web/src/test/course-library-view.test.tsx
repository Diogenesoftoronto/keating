import { expect, test } from "bun:test";
import type { CourseListItem } from "../courses/contracts";
import { renderWithRouter } from "./course-render";
import { courseLibraryView, CourseCard } from "../pages/Courses";

const courses: CourseListItem[] = (["owner", "teacher", "student", "peer"] as const).map(
  (role, index) => ({
    id: role,
    title: index % 2 ? "French" : "Algebra",
    description: index % 2 ? "Past tenses" : "Equations",
    role,
    memberCount: 1,
    lessonCount: 3,
    completedLessons: 0,
    updatedAt: "",
  }),
);

test("filters the library by role and matches trimmed title or description without changing counts", () => {
  const result = courseLibraryView(courses, "Teaching", "  TENSES  ");
  expect(result.counts).toEqual({ All: 4, Teaching: 2, Learning: 2 });
  expect(result.visible.map((course) => course.role)).toEqual(["teacher"]);
  expect(courseLibraryView(courses, "Learning", "").visible.map((course) => course.role)).toEqual([
    "student",
    "peer",
  ]);
  expect(courseLibraryView(courses, "All", "ALGEBRA").visible).toHaveLength(2);
  expect(courseLibraryView(courses, "All", "missing").visible).toHaveLength(0);
});

test("course cards link to the exact next lesson and render only applicable details", async () => {
  const base = courses[0]!;
  const render = async (fields: Partial<CourseListItem>) =>
    (await renderWithRouter(<CourseCard course={{ ...base, ...fields }} />)).replaceAll("<!-- -->", "");
  const rich = await render({
    nextLesson: { id: "lesson_two", title: "Induction", moduleTitle: "Proofs", position: 2, total: 3 },
    pendingSubmissions: 4, presentCount: 2,
  });
  for (const detail of ["Owner", "1 person · 2 here", "Continue · Lesson 2 · Induction", "4 waiting on you", "/courses/owner?tab=review", "/courses/owner?lesson=lesson_two", 'role="meter"']) expect(rich).toContain(detail);
  const legacy = await render({});
  expect(legacy).toContain("Open course");
  for (const detail of ["?lesson=", "?tab=review", " here", "waiting on you", "All lessons complete"]) expect(legacy).not.toContain(detail);
  expect(await render({ completedLessons: 3 })).toContain("All lessons complete");
  const blank = await render({ lessonCount: 0, presentCount: 0, pendingSubmissions: 0 });
  expect(blank).toContain("0 waiting on you");
  expect(blank).toContain("0 here");
  expect(blank).toContain("0 of 0 lessons");
  expect(blank).not.toContain("All lessons complete");
  expect(await render({ role: "peer", pendingSubmissions: 4 })).not.toContain("?tab=review");
});
