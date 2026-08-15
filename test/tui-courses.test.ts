import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  courseLessonPrompt,
  courseMarkdown,
  listLocalTuiCourses,
  normalizeTuiCourse,
  searchTuiCourses,
} from "../src/tui/courses.js";

describe("TUI courses", () => {
  test("normalizes flat course snapshots and searches lessons", () => {
    const course = normalizeTuiCourse({ id: "limits", title: "Limits", lessons: [{ id: "intro", title: "Approach", summary: "How limits work" }] });
    expect(course).not.toBeNull();
    expect(searchTuiCourses([course!], "approach")[0]?.lesson?.id).toBe("intro");
    expect(courseMarkdown(course!)).toContain("### Approach");
    expect(courseLessonPrompt(course!, course!.modules[0]!.lessons[0]!).toLowerCase()).toContain("socratically");
  });

  test("loads local JSON snapshots without hiding malformed neighbors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-courses-"));
    await mkdir(join(cwd, ".keating", "courses"), { recursive: true });
    await writeFile(join(cwd, ".keating", "courses", "good.json"), JSON.stringify({ id: "good", title: "Good course", modules: [] }), "utf8");
    await writeFile(join(cwd, ".keating", "courses", "bad.json"), "not-json", "utf8");
    const courses = await listLocalTuiCourses(cwd);
    expect(courses.map((course) => course.id)).toEqual(["good"]);
  });
});
