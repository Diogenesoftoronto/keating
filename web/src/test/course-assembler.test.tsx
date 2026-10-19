/**
 * Behavioural tests for the CourseAssembler form: what the learner sees and can
 * do before saved sources load. Section-level behaviour (plans, decks,
 * artifacts, summary, footer) is covered in course-assembler-sections.test.tsx.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseAssembler } from "../components/courses/CourseAssembler";

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOf = (html: string) =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const html = renderToStaticMarkup(
  <CourseAssembler
    account={{ mode: "local", displayName: "Maya" } as never}
    onCreated={() => {}}
    onClose={() => {}}
  />,
);

describe("CourseAssembler (before saved work loads)", () => {
  test("is a labelled dialog region with the heading and intro", () => {
    expect(html).toContain('aria-labelledby="course-assembler-title"');
    expect(html).toContain('id="course-assembler-title"');
    const text = textOf(html);
    expect(text).toContain("New course");
    expect(text).toContain("Assemble the course you want.");
    expect(text).toContain("Everything stays editable.");
  });
  test("offers a close control, title and description fields with defaults", () => {
    expect(html).toContain('aria-label="Close course assembler"');
    expect(html).toMatch(/<input[^>]*value="Untitled course"[^>]*maxLength="240"|<input[^>]*maxLength="240"[^>]*value="Untitled course"/);
    expect(html).toContain('placeholder="Optional. You can change this later."');
    expect(textOf(html)).toContain("Course title");
    expect(textOf(html)).toContain("What this course is for");
  });
  test("the review opt-in starts unchecked and explains itself", () => {
    expect(textOf(html)).toContain("Review course design after saving");
    expect(textOf(html)).toContain("Creating the course does not wait for review.");
    const box = /<input type="checkbox"([^>]*)\/>\s*Review course design/.exec(html);
    expect(box?.[1]).not.toContain("checked");
  });
  test("starts as an enabled blank course with the blank summary", () => {
    const create = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Create blank course<\/button>/.exec(html);
    expect(create).not.toBeNull();
    expect(/<button\b([^>]*)>/.exec(create![0])![1]).not.toMatch(/(^|\s)disabled(=""|\s|$)/);
    const text = textOf(html);
    expect(text).toContain("Blank start");
    expect(text).toContain("No template content.");
  });
  test("shows the loading note instead of source sections and no errors", () => {
    const text = textOf(html);
    expect(text).toContain("Looking through your saved work…");
    expect(text).not.toContain("Plans from your chats");
    expect(html).not.toContain('role="alert"');
  });
});
