import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseDiscussion, ALL_CHANNEL, COURSE_CHANNEL } from "../components/courses/CourseDiscussion";
import { CourseReviewPanel } from "../components/courses/CourseReviewPanel";
import type { CourseViewerSnapshot } from "../courses/contracts";
import { deskFixture } from "./course-outline-fixtures";

function discussion(snapshot: CourseViewerSnapshot, channel = COURSE_CHANNEL) {
  return renderToStaticMarkup(<CourseDiscussion snapshot={snapshot} channel={channel}
    saving="" mutate={async () => {}} onSelectLesson={() => {}} onChannelChange={() => {}}/>);
}

test("course threads expose header actions, reaction counts and the post shortcut", () => {
  const { snapshot } = deskFixture();
  const { accountId, joinedAt: createdAt } = snapshot.viewer;
  snapshot.course.comments = [{ id: "question", body: "What changes?", accountId, createdAt, editedAt: createdAt }];
  snapshot.course.reactions = [{ targetKind: "comment", targetId: "question", emoji: "💡", accountId, createdAt }];
  const html = discussion(snapshot);
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain("Course-wide thread (1)");
  expect(html).toContain("Ctrl + Enter");
  expect(html).toContain("edited");
  const header = html.match(/<article[^>]*><header[^>]*>([\s\S]*?)<\/header>/)?.[1];
  for (const action of ["Reply", "Edit comment", "Delete comment"]) expect(header).toContain(action);
  expect(html).toContain("React with 💡, 1: You");
  expect(html).toContain('aria-pressed="true"');
  const everything = discussion(snapshot, ALL_CHANNEL);
  expect(everything).toContain("read-only");
  expect(everything).not.toContain('aria-label="Write a comment"');
});

test("many channels use a labelled select and peer-disabled comments suppress the composer", () => {
  const { snapshot } = deskFixture();
  const module = snapshot.course.modules[0]!;
  snapshot.course.modules = [{ ...module, lessons: [...module.lessons, {...module.lessons[0]!, id:"l3", title:"Third lesson"}] }];
  snapshot.permissions = {...snapshot.permissions, canReview:false};
  snapshot.course.settings.allowPeerComments = false;
  const html = discussion(snapshot);
  expect(html).toContain('role="combobox"');
  expect(html).toContain("Third lesson (0)");
  expect(html).toContain("Peer comments are turned off");
  expect(html).not.toContain("Post comment");
});

test("review roster names progress and access, and only offers requests for private work", () => {
  const { snapshot } = deskFixture();
  snapshot.permissions = {...snapshot.permissions, canRequestTeacherAccess:true};
  snapshot.course.members = [
    snapshot.viewer,
    {...snapshot.viewer, accountId:"b", displayName:"Bo", teacherAccess:"requested"},
    {...snapshot.viewer, accountId:"c", displayName:"Cal", teacherAccess:"full"},
  ];
  const html = renderToStaticMarkup(<CourseReviewPanel snapshot={snapshot} saving=""
    onReview={() => {}} onAssignmentReview={() => {}} onRequestAccess={() => {}}/>);
  expect(html.match(/role="meter"/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Progress for Maya"');
  for (const state of ["Private", "Requested", "Granted"]) expect(html).toContain(state);
  expect(html.match(/Request access/g)).toHaveLength(1);
  expect(html).toContain("Nothing is waiting on you");
});
