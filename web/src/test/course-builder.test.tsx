import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseArtifactCard } from "../components/courses/CourseArtifactCard";
import { SaveTaskToCourse } from "../components/courses/SaveTaskToCourse";
import { CourseBuilder, type CourseBuilderSection } from "../components/courses/CourseBuilder";
import { deskFixture } from "./course-outline-fixtures";
import { renderAsServer } from "./server-render-env";

renderAsServer();

function render({title = "Transfer", prompt = "Explain the change", saving = "", section = "outline" as CourseBuilderSection} = {}) {
  const {snapshot} = deskFixture();
  const first = snapshot.course.modules[0]!;
  const lesson = {...first.lessons[0]!, id:"l3", title, exercise:{id:"ex3", prompt, rubric:[]}};
  snapshot.course.modules = [first, {...snapshot.course.modules[1]!, lessons:[lesson]}];
  const noop = () => {};
  return renderToStaticMarkup(<CourseBuilder snapshot={snapshot} section={section} activeLesson={lesson} saving={saving}
    mutate={async () => {}} onSectionChange={noop} onSelectLesson={noop} onInvite={noop} onSnapshot={noop} onError={noop}/>);
}

function disabled(html: string, name: string) {
  const button = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find(([,attrs,content]) =>
    attrs!.includes(`aria-label="${name}"`) || content!.replace(/<[^>]*>/g, "").trim() === name);
  expect(button).toBeDefined();
  return /\sdisabled(?:=|\s|$)/.test(button![1]!);
}

test("numbers across modules while move controls respect each module's boundaries", () => {
  const html = render();
  expect(html).toMatch(/<small>3<\/small><button[^>]*>Transfer<\/button>/);
  expect(disabled(html, "Move Correlation up")).toBe(true);
  expect(disabled(html, "Move Correlation down")).toBe(false);
  expect(disabled(html, "Move Intervention up")).toBe(false);
  expect(disabled(html, "Move Intervention down")).toBe(true);
  expect(disabled(html, "Move Transfer up")).toBe(true);
  expect(disabled(html, "Move Transfer down")).toBe(true);
});

test("save bar explains invalid fields, disables clean and saving states", () => {
  expect(disabled(render(), "Discard")).toBe(true);
  expect(disabled(render(), "Save lesson")).toBe(true);
  expect(render({title:" "})).toContain("Enter a lesson title to save.");
  expect(render({prompt:""})).toContain("Enter a question prompt to save.");
  expect(disabled(render({saving:"lesson-edit-l3"}), "Saving…")).toBe(true);
});

test("attachment entry points keep their target and editable metadata", () => {
  expect(render()).toContain("Attach</span>");
  expect(render({section:"documents"})).toContain("Attach new sources to");
  expect(render({section:"assignments"})).toContain("Work type");
  expect(render({section:"artifacts"})).toContain("New quiz title");
  expect(render({section:"cards"})).toContain("Import from Anki");
  expect(render({section:"access"})).toContain('role="switch"');
  const card = renderToStaticMarkup(<CourseArtifactCard courseWide artifact={{
    id:"a", title:"Timeline", kind:"other", format:"json", content:"{}", updatedBy:"teacher", updatedAt:"2026-11-19T12:00:00Z",
  }}/>);
  expect(card).toContain("Course artifact");
  expect(card).toContain("View source");
  const task = renderToStaticMarkup(<SaveTaskToCourse task={{type:"task", kind:"assignment", id:"work", title:"Exercise", brief:"Explain."}}/>);
  expect(task).toContain("Save to course");
});
