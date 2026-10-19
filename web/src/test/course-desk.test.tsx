/**
 * Behavioural tests for DeskView: what a teacher or learner sees and can do on
 * the reading desk. Assertions read the rendered text, control names and field
 * values; none depend on CSS classes or the exact element structure.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { DeskView } from "../pages/course-workspace/DeskView";
import { deskFixture } from "./course-outline-fixtures";

const noop = () => {};
type Variant = "teacher" | "learnerComplete" | "bareLesson" | "empty";

function renderDesk(variant: Variant): string {
  const { snapshot } = deskFixture();
  const lesson = snapshot.course.modules[0]!.lessons[0]!;
  const base = {
    snapshot, moduleTitle: "Counterfactuals", completed: false,
    mutate: async () => {}, saving: "", noteText: "draft note", setNoteText: noop,
    sharedNoteVersion: 2, answer: "my answer", setAnswer: noop, shareAnswer: true,
    setShareAnswer: noop, threadCount: 3, onSnapshot: noop, onError: noop,
    onToggleReaction: noop, onOpenBuilder: noop, onDiscuss: noop, onComplete: noop,
    onSaveNote: noop, onSaveAnswer: noop,
  };
  if (variant === "empty") {
    snapshot.course.modules = [];
    return renderToStaticMarkup(<DeskView {...base} />);
  }
  if (variant === "learnerComplete") {
    snapshot.permissions = { ...snapshot.permissions, canEditCourse: false };
    return renderToStaticMarkup(<DeskView {...base} lesson={lesson} completed saving="answer" />);
  }
  if (variant === "bareLesson") {
    return renderToStaticMarkup(
      <DeskView {...base} lesson={{ ...lesson, reading: " ", summary: "", objectives: [] }} threadCount={0} />,
    );
  }
  return renderToStaticMarkup(<DeskView {...base} lesson={lesson} />);
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOf = (html: string) =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

interface Control { name: string; disabled: boolean }
/** Accessible names of every <button>: aria-label, else its text. */
function buttons(html: string): Control[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const label = /aria-label="([^"]*)"/.exec(m[1]!)?.[1];
    return { name: decode(label ?? textOf(m[2]!)), disabled: /\sdisabled(=|\s|$)/.test(m[1]!) };
  });
}
const buttonNames = (html: string) => buttons(html).map((b) => b.name);
const button = (html: string, name: string) => buttons(html).find((b) => b.name === name);
function textareas(html: string): Array<{ value: string; disabled: boolean }> {
  return [...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map((m) => ({
    value: decode(m[2]!), disabled: /\sdisabled(=|\s|$)/.test(m[1]!),
  }));
}
function headings(html: string, level: number): string[] {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map((m) => textOf(m[1]!));
}
const links = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1]!)?.[1],
    target: /target="([^"]*)"/.exec(m[1]!)?.[1],
    text: textOf(m[2]!),
  }));

describe("DeskView as a teacher", () => {
  const html = renderDesk("teacher");

  test("shows the module, lesson title, summary and reading", () => {
    const text = textOf(html);
    expect(text).toContain("Counterfactuals · self paced");
    expect(headings(html, 2)).toEqual(["Correlation"]);
    expect(text).toContain("Seeing versus doing.");
    expect(text).toContain("Correlation observes.");
    expect(text).toContain("Causation intervenes.");
  });

  test("lists the lesson objectives", () => {
    const text = textOf(html);
    expect(text).toContain("By the end");
    expect(text).toContain("Name a confounder");
    expect(text).toContain("Contrast intervention and observation");
  });

  test("offers editing actions and the discussion count", () => {
    const names = buttonNames(html);
    expect(names).toContain("Discuss · 3");
    expect(names).toContain("Add document");
    expect(names).toContain("Edit");
    expect(html).toContain('type="file"');
  });

  test("shows the lesson answer field with its value and share state", () => {
    expect(textOf(html)).toContain("Worked exercise");
    expect(textareas(html).map((t) => t.value)).toContain("my answer");
    expect(textOf(html)).toContain("Share with peers");
    expect(/<input type="checkbox" checked=""\/>Share with peers/.test(html)).toBe(true);
    expect(button(html, "Save work")).toEqual({ name: "Save work", disabled: false });
  });

  test("shows the shared notes with version and draft text", () => {
    const text = textOf(html);
    expect(text).toContain("Shared notes · version 2");
    expect(text).toContain("The margin everyone can write in.");
    const note = textareas(html).find((t) => t.value === "draft note");
    expect(note).toBeDefined();
    expect(note!.disabled).toBe(false);
    expect(buttonNames(html)).toContain("Save shared notes");
  });

  test("links the lesson source to its URL in a new tab", () => {
    expect(textOf(html)).toContain("Lesson sources");
    expect(links(html)).toEqual([
      { href: "https://example.com/a", target: "_blank", text: "Lesson source https://example.com/a" },
    ]);
  });

  test("shows the lesson assignment and a collapsed course-wide one", () => {
    const text = textOf(html);
    expect(headings(html, 3)).toEqual(
      expect.arrayContaining(["Lesson task", "Course task", "The margin everyone can write in."]),
    );
    expect(text).toContain("Write it.");
    expect(text).toContain("Judged on Clear");
    expect(text).toContain("A page");
    expect(text).toContain("Course-wide assignments · 1");
    expect(text).toContain("Reflect.");
    expect(text).toContain("No fixed due date");
  });

  test("assignment submission controls are named and inert for the owner", () => {
    expect(html).toContain('aria-label="Choose files to attach"');
    expect(button(html, "Attach files")?.disabled).toBe(true);
    expect(button(html, "Save draft")?.disabled).toBe(true);
    expect(button(html, "Submit")?.disabled).toBe(true);
    expect(textareas(html).filter((t) => t.disabled)).toHaveLength(2);
  });

  test("offers reactions and an incomplete completion action", () => {
    expect(buttonNames(html).filter((n) => n === "Add a reaction").length).toBeGreaterThan(0);
    expect(buttonNames(html)).toContain("Mark complete");
    expect(buttonNames(html)).not.toContain("Lesson complete");
  });
});

describe("DeskView as a completed learner", () => {
  const html = renderDesk("learnerComplete");

  test("hides teacher-only editing controls but keeps discussion", () => {
    const names = buttonNames(html);
    expect(names).toContain("Discuss · 3");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("Add document");
    expect(/<input type="file"\/>/.test(html)).toBe(false);
  });

  test("labels the lesson as complete", () => {
    expect(buttonNames(html)).toContain("Lesson complete");
    expect(buttonNames(html)).not.toContain("Mark complete");
  });

  test("shows a disabled saving state while the answer is being saved", () => {
    expect(button(html, "Saving…")).toEqual({ name: "Saving…", disabled: true });
    expect(buttonNames(html)).not.toContain("Save work");
    expect(textareas(html).map((t) => t.value)).toContain("my answer");
  });

  test("still shows the lesson content and the source link", () => {
    expect(headings(html, 2)).toEqual(["Correlation"]);
    expect(textOf(html)).toContain("Seeing versus doing.");
    expect(links(html)[0]?.href).toBe("https://example.com/a");
  });
});

describe("DeskView with a bare lesson", () => {
  const html = renderDesk("bareLesson");

  test("explains that the lesson has no reading and omits summary and objectives", () => {
    const text = textOf(html);
    expect(text).toContain("This lesson has no reading yet. Open Build → Lesson to write it.");
    expect(text).not.toContain("By the end");
    expect(text).not.toContain("Seeing versus doing.");
    expect(text).not.toContain("Correlation observes.");
  });

  test("omits the discussion count when there are no threads", () => {
    expect(buttonNames(html)).toContain("Discuss");
    expect(buttonNames(html).some((n) => n.startsWith("Discuss ·"))).toBe(false);
  });

  test("keeps the exercise, sources and completion action", () => {
    expect(headings(html, 2)).toEqual(["Correlation"]);
    expect(buttonNames(html)).toContain("Mark complete");
    expect(button(html, "Save work")?.disabled).toBe(false);
    expect(links(html)).toHaveLength(1);
  });
});

describe("DeskView for a course with no lessons", () => {
  const html = renderDesk("empty");

  test("shows the empty-state message and a way to build the outline", () => {
    expect(headings(html, 2)).toEqual(["Nothing to read yet."]);
    const text = textOf(html);
    expect(text).toContain("Reading desk");
    expect(text).toContain("This course has no lessons.");
    expect(text).toContain("That is a valid state");
    expect(buttonNames(html)).toContain("Build the outline");
    expect(buttonNames(html)).toContain("Add document");
  });

  test("still surfaces course-level documents and assignments", () => {
    expect(links(html)).toEqual([
      { href: "/api/courses/course_outline/materials/mat_c", target: "_blank", text: "Course source Course document" },
    ]);
    expect(headings(html, 3)).toEqual(["Course task"]);
    expect(textOf(html)).toContain("Course assignment");
  });

  test("renders no lesson-only content", () => {
    const text = textOf(html);
    expect(text).not.toContain("Worked exercise");
    expect(text).not.toContain("Shared notes");
    expect(buttonNames(html)).not.toContain("Mark complete");
    expect(buttonNames(html)).not.toContain("Edit");
  });
});
