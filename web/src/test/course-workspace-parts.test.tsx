/**
 * Behavioural tests for the workspace chrome: header, banners, status screens,
 * live-room rail, and the view switch in WorkspaceMain. They assert visible
 * text, accessible names, and enabled/disabled state, never classes or DOM shape.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { COURSE_CHANNEL } from "../components/courses/CourseDiscussion";
import { LiveRoomRail } from "../pages/course-workspace/LiveRoomRail";
import {
  ErrorBanner,
  TeacherAccessBanner,
} from "../pages/course-workspace/WorkspaceBanners";
import {
  WorkspaceHeader,
  type WorkspaceHeaderProps,
} from "../pages/course-workspace/WorkspaceHeader";
import { WorkspaceMain } from "../pages/course-workspace/WorkspaceMain";
import {
  WorkspaceLoading,
  WorkspaceUnavailable,
} from "../pages/course-workspace/WorkspaceStatus";
import { WorkspaceOverlays } from "../pages/course-workspace/WorkspaceOverlays";
import { INITIAL_WORKSPACE_STATE } from "../pages/course-workspace/state";
import { resolveLessonContext } from "../pages/course-workspace/model";
import { createWorkspaceActions } from "../pages/course-workspace/workspace-actions";
import { allCourseLessons } from "../courses/contracts";
import { deskFixture } from "./course-outline-fixtures";
import { renderWithRouter } from "./course-render";

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const textOf = (html: string) =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
interface Control { name: string; disabled: boolean; current: boolean }
function buttons(html: string): Control[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    name: decode(/aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? textOf(m[2]!)),
    disabled: /\sdisabled(=|\s|$)/.test(m[1]!),
    current: /aria-current="true"/.test(m[1]!),
  }));
}
const names = (html: string) => buttons(html).map((b) => b.name);
const labelsOfLinks = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>/g)].map((m) => /aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? "");

const noop = () => {};
const reviewer = {
  canEditCourse: true, canInvite: true, canReview: true, canEditDeck: true, canRequestTeacherAccess: true,
};
const learner = {
  canEditCourse: false, canInvite: false, canReview: false, canEditDeck: false, canRequestTeacherAccess: false,
};

async function header(over: Partial<WorkspaceHeaderProps> = {}, perms = reviewer) {
  const { snapshot } = deskFixture();
  snapshot.permissions = perms;
  return renderWithRouter(
    <WorkspaceHeader
      snapshot={snapshot}
      activeLessonId="l1"
      view="read"
      saving=""
      networkStatus="connected"
      mutate={async () => {}}
      onSnapshot={noop}
      onError={noop}
      onOpenBuilder={noop}
      onViewChange={noop}
      onOpenPalette={noop}
      onOpenInvite={noop}
      {...over}
    />,
  );
}

describe("WorkspaceHeader", () => {
  test("offers search, Keating and a way back; editors also get Review, Build and Invite", async () => {
    const html = await header();
    expect(labelsOfLinks(html)).toContain("Back to courses");
    expect(labelsOfLinks(html)).toContain("Work on this course with Keating");
    const n = names(html);
    for (const expected of ["Search ⌘K", "Read", "Discuss", "Review", "Build", "Invite"]) {
      expect(n).toContain(expected);
    }
  });
  test("learners get only Read and Discuss and no Invite", async () => {
    const n = names(await header({}, learner));
    expect(n).toContain("Read");
    expect(n).toContain("Discuss");
    expect(n).not.toContain("Review");
    expect(n).not.toContain("Build");
    expect(n).not.toContain("Invite");
  });
  test("the open view is the only tab marked current", async () => {
    const current = buttons(await header({ view: "discuss" })).filter((b) => b.current).map((b) => b.name);
    expect(current).toEqual(["Discuss"]);
  });
  test("shows the course comment count on Discuss, and the saving + network state", async () => {
    const { snapshot } = deskFixture();
    snapshot.permissions = reviewer;
    snapshot.course.comments = [{ id: "c1" }, { id: "c2" }] as never;
    const html = await renderWithRouter(
      <WorkspaceHeader snapshot={snapshot} activeLessonId="l1" view="read" saving="note" networkStatus="reconnecting"
        mutate={async () => {}} onSnapshot={noop} onError={noop} onOpenBuilder={noop} onViewChange={noop}
        onOpenPalette={noop} onOpenInvite={noop} />,
    );
    expect(names(html)).toContain("Discuss 2");
    const text = textOf(html);
    expect(text).toContain("saving…");
    expect(text).toContain("reconnecting");
    expect(textOf(await header())).not.toContain("saving…");
  });
});

describe("banners", () => {
  test("the error banner is an alert with the message and a Dismiss control", () => {
    const html = renderToStaticMarkup(<ErrorBanner error="Nope" onDismiss={noop} />);
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toBe("Nope");
    expect(names(html)).toEqual(["Dismiss"]);
  });
  test("the teacher-access banner offers approve and keep-private", () => {
    const html = renderToStaticMarkup(<TeacherAccessBanner onRespond={noop} />);
    expect(textOf(html)).toContain("Your teacher requested full access to current and future course work.");
    expect(names(html)).toEqual(["Approve once", "Keep private"]);
  });
});

describe("status screens", () => {
  test("loading shows the placeholder text", () => {
    expect(textOf(renderToStaticMarkup(<WorkspaceLoading />))).toBe("Opening course desk…");
  });
  test("unavailable shows the error or a default, and links to the library", async () => {
    const withError = await renderWithRouter(<WorkspaceUnavailable error="Boom" />);
    expect(textOf(withError)).toContain("Course unavailable");
    expect(textOf(withError)).toContain("Boom");
    expect(textOf(withError)).toContain("Course library");
    expect(withError).toContain('href="/courses"');
    expect(textOf(await renderWithRouter(<WorkspaceUnavailable error="" />))).toContain("This course could not be loaded.");
  });
});

describe("LiveRoomRail", () => {
  test("lists members (You for the viewer), roles, progress and recent activity", async () => {
    const { snapshot } = deskFixture();
    snapshot.course.members = [
      snapshot.viewer,
      { accountId: "t1", displayName: "Prof K", role: "teacher", teacherAccess: "full", joinedAt: "2026-08-03T16:00:00.000Z", progress: { completedLessonIds: [], lastActiveAt: "2026-08-03T16:00:00.000Z" } },
    ];
    snapshot.viewer.progress.completedLessonIds = ["l1"];
    snapshot.course.activity = [{ id: "a1", type: "lesson-completed", accountId: "student_1", message: "Completed a lesson", createdAt: "2026-08-03T16:00:00.000Z" }] as never;
    const html = await renderWithRouter(
      <LiveRoomRail snapshot={snapshot} onlineAccountIds={new Set(["t1"])} activeLesson={snapshot.course.modules[0]!.lessons[0]} view="read" />,
    );
    const text = textOf(html);
    expect(text).toContain("Live room");
    expect(text).toContain("You");
    expect(text).toContain("Prof K");
    expect(text).toContain("student");
    expect(text).toContain("teacher");
    expect(text).toMatch(/50\s*% complete/);
    expect(text).toContain("Completed a lesson");
    expect(text).not.toContain("Pear feed");
  });
  test("an empty feed says so, and a Pear key is offered when the network has one", async () => {
    const { snapshot } = deskFixture();
    snapshot.course.activity = [];
    snapshot.network = { mode: "pear-gateway", status: "connected", peerCount: 1, publicKey: "abc123key" };
    const text = textOf(await renderWithRouter(
      <LiveRoomRail snapshot={snapshot} onlineAccountIds={new Set()} activeLesson={undefined} view="read" />,
    ));
    expect(text).toContain("Nothing has happened here yet.");
    expect(text).toContain("Pear feed");
    expect(text).toContain("abc123key");
  });
});

describe("WorkspaceMain", () => {
  function main(view: "read" | "discuss" | "review" | "build", perms = reviewer) {
    const { snapshot } = deskFixture();
    snapshot.permissions = perms;
    const lesson = resolveLessonContext(snapshot.course, allCourseLessons(snapshot.course), "l1", snapshot.viewer.accountId);
    const mutate = async () => {};
    return renderWithRouter(
      <WorkspaceMain
        snapshot={snapshot}
        state={{ ...INITIAL_WORKSPACE_STATE, snapshot, loading: false, view, activeLessonId: "l1", discussChannel: COURSE_CHANNEL }}
        lesson={lesson}
        threadCounts={{}}
        mutate={mutate}
        actions={createWorkspaceActions(snapshot.course, mutate)}
        dispatch={noop}
        onSelectLesson={noop}
        onOpenBuilder={noop}
        onSnapshot={noop}
        onError={noop}
      />,
    );
  }
  test("read shows the lesson desk", async () => {
    const text = textOf(await main("read"));
    expect(text).toContain("Correlation");
    expect(text).toContain("Mark complete");
  });
  test("review and build render only for permitted viewers", async () => {
    expect(textOf(await main("review", learner))).toBe("");
    expect(textOf(await main("build", learner))).toBe("");
    expect(textOf(await main("review"))).not.toBe("");
    expect(textOf(await main("build"))).not.toBe("");
  });
  test("discuss shows the course thread", async () => {
    expect(textOf(await main("discuss"))).not.toBe("");
  });
});

describe("WorkspaceOverlays", () => {
  const { snapshot } = deskFixture();
  const render = (inviteOpen: boolean, paletteOpen: boolean) =>
    renderWithRouter(
      <WorkspaceOverlays courseId="course_outline" course={snapshot.course} activeLesson={undefined}
        inviteOpen={inviteOpen} paletteOpen={paletteOpen} onCloseInvite={noop} onClosePalette={noop} onSelectResult={noop} />,
    );
  test("renders nothing until opened, then the matching dialog", async () => {
    expect(textOf(await render(false, false))).toBe("");
    expect(textOf(await render(false, true))).not.toBe("");
    expect(textOf(await render(true, false))).not.toBe("");
  });
});
