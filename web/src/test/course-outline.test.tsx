import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { OUTLINE_FIXTURES } from "./course-outline-fixtures";
import { CourseOutline } from "../pages/course-workspace/CourseOutline";
import {
  courseWorkspaceReducer,
  INITIAL_WORKSPACE_STATE,
} from "../pages/course-workspace/state";
import { COURSE_CHANNEL } from "../components/courses/CourseDiscussion";

function render(name: keyof typeof OUTLINE_FIXTURES): string {
  const f = OUTLINE_FIXTURES[name];
  return renderToStaticMarkup(
    <CourseOutline
      course={f.course}
      viewer={{
        progress: { completedLessonIds: f.completedLessonIds, lastActiveAt: "2026-08-03T16:00:00.000Z" },
      }}
      permissions={f.permissions}
      threadCounts={f.threadCounts}
      activeLessonId={f.activeLessonId || undefined}
      view={f.view}
      onSelectLesson={() => {}}
      onOpenBuilder={() => {}}
      onOpenCourseThread={() => {}}
    />,
  );
}

const decode = (v: string) => v.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
const textOf = (html: string) =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

interface Row { text: string; done: boolean; active: boolean; badge?: string }
/** Every button in the markup, in document order. */
function buttons(html: string): Array<Row & { label: string }> {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const inner = m[2]!;
    return {
      label: textOf(inner),
      text: textOf(inner),
      done: /<svg/.test(inner.split("</span>")[0]!),
      // Assistive technology learns which lesson is open from aria-current.
      active: /\saria-current="page"/.test(m[1]!),
      badge: /title="(\d+) comments"/.exec(inner)?.[1],
    };
  });
}
const lessonRows = (html: string) => {
  const shelf = ["Documents", "Assignments", "Artifacts", "Cards", "Course thread"];
  return buttons(html).filter(
    (b) => b.label !== "edit" && !shelf.some((l) => b.label.startsWith(l)),
  );
};
const shelfRow = (html: string, label: string) =>
  buttons(html).find((b) => b.label.startsWith(label));
const moduleTitles = (html: string) =>
  [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => textOf(m[1]!));

describe("CourseOutline", () => {
  test("lists modules and lessons in course order with numbers", () => {
    const html = render("teacherWithProgress");
    expect(textOf(html)).toContain("Course outline");
    expect(moduleTitles(html)).toEqual(["Counterfactuals", "Empty module"]);
    const rows = lessonRows(html);
    expect(rows.map((r) => r.text.replace(/\s*\d+$/, ""))).toEqual([
      "Correlation",
      "2 Intervention",
    ]);
  });

  test("marks completed lessons with a check and leaves others numbered", () => {
    const [first, second] = lessonRows(render("teacherWithProgress"));
    expect(first!.done).toBe(true);
    expect(first!.text).not.toMatch(/^1\b/);
    expect(second!.done).toBe(false);
    expect(second!.text).toMatch(/^2 Intervention/);
    const none = lessonRows(render("learnerBuildView"));
    expect(none.map((r) => r.done)).toEqual([false, false]);
    expect(none.map((r) => r.text)).toEqual(["1 Correlation", "2 Intervention"]);
  });

  test("highlights only the active lesson", () => {
    expect(lessonRows(render("teacherWithProgress")).map((r) => r.active)).toEqual([false, true]);
    expect(lessonRows(render("learnerBuildView")).map((r) => r.active)).toEqual([true, false]);
  });

  test("shows a comment count only for lessons that have threads", () => {
    const rows = lessonRows(render("teacherWithProgress"));
    expect(rows.map((r) => r.badge)).toEqual(["3", undefined]);
    expect(lessonRows(render("learnerBuildView")).map((r) => r.badge)).toEqual([undefined, undefined]);
  });

  test("says when a module has no lessons", () => {
    expect(textOf(render("teacherWithProgress"))).toContain("No lessons yet");
  });

  test("shows the blank-course message instead of an outline", () => {
    const html = render("blankCourse");
    expect(textOf(html)).toContain("No modules yet. A blank course is valid");
    expect(moduleTitles(html)).toEqual([]);
    expect(lessonRows(html)).toEqual([]);
    expect(textOf(html)).not.toContain("No lessons yet");
  });

  test("shows the course shelf with counts", () => {
    const html = render("teacherWithProgress");
    expect(textOf(html)).toContain("Course shelf");
    expect(
      ["Documents", "Assignments", "Artifacts", "Cards", "Course thread"].map(
        (l) => shelfRow(html, l)?.text,
      ),
    ).toEqual([
      "Documents 0",
      "Assignments 0",
      "Artifacts 0",
      "Cards 0",
      "Course thread 2",
    ]);
  });

  test("only editors see the edit link", () => {
    expect(buttons(render("teacherWithProgress")).map((b) => b.label)).toContain("edit");
    expect(buttons(render("learnerBuildView")).map((b) => b.label)).not.toContain("edit");
  });

  test("shelf rows are actionable for editors, read-only for learners", () => {
    const teacher = render("teacherWithProgress");
    for (const l of ["Documents", "Assignments", "Artifacts", "Cards", "Course thread"]) {
      expect(shelfRow(teacher, l)).toBeDefined();
    }
    const learner = render("learnerBuildView");
    for (const l of ["Documents", "Assignments", "Artifacts", "Cards"]) {
      expect(shelfRow(learner, l)).toBeUndefined();
      expect(textOf(learner)).toContain(l);
    }
    // The course thread stays reachable for everyone.
    expect(shelfRow(learner, "Course thread")).toBeDefined();
  });
});

describe("courseWorkspaceReducer", () => {
  test("selecting a lesson also retargets the discussion channel", () => {
    const next = courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
      type: "lesson.selected",
      lessonId: "l2",
      view: "review",
    });
    expect(next).toMatchObject({
      activeLessonId: "l2",
      discussChannel: "l2",
      view: "review",
    });
  });

  test("opening the builder switches to the build view", () => {
    const next = courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
      type: "builder.section",
      section: "cards",
    });
    expect(next).toMatchObject({ builderSection: "cards", view: "build" });
  });

  test("no-op actions preserve state identity", () => {
    const state = courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
      type: "error.changed",
      message: "",
    });
    expect(state).toBe(INITIAL_WORKSPACE_STATE);
    expect(
      courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
        type: "view.changed",
        view: "read",
      }),
    ).toBe(INITIAL_WORKSPACE_STATE);
    expect(INITIAL_WORKSPACE_STATE.discussChannel).toBe(COURSE_CHANNEL);
  });

  test("a first empty snapshot opens the builder only for course editors", () => {
    const { course } = OUTLINE_FIXTURES.blankCourse;
    const snapshot = (canEditCourse: boolean) => ({
      course,
      viewer: {} as never,
      permissions: { ...OUTLINE_FIXTURES.blankCourse.permissions, canEditCourse },
    });
    expect(
      courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
        type: "snapshot.received",
        snapshot: snapshot(true),
      }).view,
    ).toBe("build");
    expect(
      courseWorkspaceReducer(INITIAL_WORKSPACE_STATE, {
        type: "snapshot.received",
        snapshot: snapshot(false),
      }).view,
    ).toBe("read");
  });
});
