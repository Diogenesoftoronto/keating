import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flashcardsDir, plansDir } from "../src/core/paths.js";
import { showCourses } from "../src/tui/host/flows/courses.js";
import { showLibrary } from "../src/tui/host/flows/library.js";
import { showReview } from "../src/tui/host/flows/review.js";
import { showSessions } from "../src/tui/host/flows/sessions.js";
import { showShareSession } from "../src/tui/host/flows/share.js";
import type { TuiSessionInfo } from "../src/tui/session-browser.js";
import { SESSION_ACTIONS } from "../src/tui/session-browser.js";
import { choose, createFlowHarness, type FlowHarness } from "./tui-host-harness.js";

let harness: FlowHarness | undefined;
afterEach(async () => { await harness?.destroy(); harness = undefined; });

const session = (name: string, minutesAgo: number, extra: Partial<TuiSessionInfo> = {}): TuiSessionInfo => ({
  path: `/sessions/${name}.jsonl`,
  id: name,
  name,
  created: new Date(Date.now() - (minutesAgo + 5) * 60_000),
  modified: new Date(Date.now() - minutesAgo * 60_000),
  messageCount: 4,
  firstMessage: `first message of ${name}`,
  ...extra,
});

describe("showSessions", () => {
  const sessions = [session("older", 30), session("newer", 5)];

  test("lists sessions newest first and offers the five session actions", async () => {
    harness = await createFlowHarness({ listSessions: async () => sessions });
    harness.script(choose("newer"), choose("Cancel"));
    await showSessions(harness.ctx);
    const [list, actions] = harness.dialogs;
    expect(list!.title).toBe("Sessions · active and fork lineage are labelled");
    expect(list!.kind === "select" && list.options[0]).toContain("newer");
    expect(actions!.kind === "select" && actions.options).toEqual([...SESSION_ACTIONS]);
    expect(harness.calls.controller.filter(([name]) => name === "resumeSession")).toEqual([]);
  });

  test("Resume session resumes the chosen path and refreshes the sidebar", async () => {
    harness = await createFlowHarness({ listSessions: async () => sessions });
    harness.script(choose("older"), choose("Resume session"));
    await showSessions(harness.ctx);
    expect(harness.calls.controller).toContainEqual(["resumeSession", "/sessions/older.jsonl"]);
    expect(harness.calls.sidebar).toEqual(["refreshSessions"]);
  });

  test("Resume and rename prefills the current name and renames the resumed session", async () => {
    harness = await createFlowHarness({ listSessions: async () => sessions });
    harness.script(choose("older"), choose("Resume and rename"), "Renamed");
    await showSessions(harness.ctx);
    const rename = harness.dialogs[2]!;
    expect(rename.kind === "text" && rename.title).toBe("Rename active session");
    expect(rename.kind === "text" && rename.prefill).toBe("older");
    expect(harness.calls.controller).toContainEqual(["renameCurrentSession", "Renamed"]);
  });

  test("a refused resume skips the rename dialog", async () => {
    harness = await createFlowHarness({ listSessions: async () => sessions, controller: { resumeSession: async () => false } });
    harness.script(choose("older"), choose("Resume and rename"));
    await showSessions(harness.ctx);
    expect(harness.dialogs).toHaveLength(2);
    expect(harness.calls.sidebar).toEqual([]);
  });

  test("Fork whole current branch clones after resuming", async () => {
    harness = await createFlowHarness({ listSessions: async () => sessions });
    harness.script(choose("older"), choose("Fork whole current branch"));
    await showSessions(harness.ctx);
    expect(harness.calls.controller.map(([name]) => name)).toEqual(["getCurrentSessionPath", "resumeSession", "cloneCurrentSession"]);
  });

  test("Fork from an earlier turn lists turns and forks from the chosen entry", async () => {
    harness = await createFlowHarness({
      listSessions: async () => sessions,
      controller: { forkMessages: async () => [{ entryId: "e1", text: "first turn" }, { entryId: "e2", text: "second turn" }] },
    });
    harness.script(choose("older"), choose("Fork from an earlier turn"), choose("second turn"));
    await showSessions(harness.ctx);
    expect(harness.dialogs[2]!.title).toBe("Fork from earlier turn · original remains saved");
    expect(harness.calls.controller).toContainEqual(["forkFromMessage", "e2"]);
  });

  test("an empty project explains instead of opening a dialog", async () => {
    harness = await createFlowHarness();
    await showSessions(harness.ctx);
    expect(harness.dialogs).toEqual([]);
    expect(harness.entryTitles()).toEqual(["No saved sessions"]);
  });

  test("refuses while a response streams, and reports listing failures", async () => {
    harness = await createFlowHarness({ listSessions: async () => { throw new Error("disk"); } });
    await showSessions(harness.ctx);
    expect(harness.entryTitles()).toEqual(["Could not load sessions"]);
    harness.state.busy = true;
    await showSessions(harness.ctx);
    expect(harness.entryTitles().at(-1)).toBe("Sessions unavailable while responding");
  });
});

describe("showShareSession", () => {
  test("declining the confirmation publishes nothing", async () => {
    harness = await createFlowHarness();
    harness.script(choose("No"));
    await showShareSession(harness.ctx);
    expect(harness.dialogs[0]!.title).toBe("Publish a read-only session?");
    expect(harness.calls.client.map(([name]) => name)).not.toContain("getMessages");
  });

  test("a failed publish is reported and leaves the composer untouched", async () => {
    harness = await createFlowHarness({ client: { getMessages: async () => { throw new Error("offline"); } } });
    harness.script(choose("Yes"));
    await showShareSession(harness.ctx);
    expect(harness.entryTitles()).toContain("Session was not shared");
    expect(harness.composer.value).toBe("");
  });
});

describe("showReview", () => {
  test("with nothing saved it reports the queue and that nothing is due", async () => {
    harness = await createFlowHarness();
    await showReview(harness.ctx);
    expect(harness.dialogs).toEqual([]);
    expect(harness.entryTitles()).toEqual(["Review queue", "Nothing due"]);
  });

  test("a due card walks question, answer and rating, and records the review", async () => {
    harness = await createFlowHarness();
    await mkdir(flashcardsDir(harness.cwd), { recursive: true });
    await writeFile(join(flashcardsDir(harness.cwd), "bio.md"), [
      "# Flash Cards: Biology", "", "## c1 [easy]", "**Front:** What is ATP?", "", "**Back:** The cell's energy currency.", "",
    ].join("\n"));
    harness.script(choose("What is ATP?"), "Reveal answer", choose("Good"));
    await showReview(harness.ctx);
    const [queue, question, answer] = harness.dialogs;
    expect(queue!.title).toBe("Due cards · schedule order");
    expect(question!.title).toBe("Question\nWhat is ATP?");
    expect(question!.kind === "select" && question.options).toEqual(["Reveal answer", "Cancel"]);
    expect(answer!.title).toBe("Answer\nThe cell's energy currency.");
    expect(answer!.kind === "select" && answer.options).toEqual(["0 · Again", "1 · Hard", "2 · Good", "3 · Easy", "Cancel"]);
    expect(harness.entryTitles()).toEqual(["Review queue", "Review recorded"]);
    expect(harness.entries().at(-1)!.body).toContain("Rating: Good");
  });

  test("refuses while busy", async () => {
    harness = await createFlowHarness();
    harness.state.busy = true;
    await showReview(harness.ctx);
    expect(harness.entryTitles()).toEqual(["Review unavailable while responding"]);
  });
});

describe("showLibrary", () => {
  test("an empty library says so", async () => {
    harness = await createFlowHarness();
    await showLibrary(harness.ctx);
    expect(harness.entryTitles()).toEqual(["Library is empty"]);
  });

  test("Copy path puts the artifact path in the composer; Open preview renders it", async () => {
    harness = await createFlowHarness();
    await mkdir(plansDir(harness.cwd), { recursive: true });
    await writeFile(join(plansDir(harness.cwd), "lesson.md"), "# Lesson plan\n\nBody");
    harness.script(choose("lesson"), choose("Copy path"));
    await showLibrary(harness.ctx);
    const actions = harness.dialogs[1]!;
    expect(actions.kind === "select" && actions.options).toEqual([
      "Open preview", "Copy path to composer", "Export copy", "Move to recoverable trash", "Cancel",
    ]);
    expect(harness.composer.value).toContain("lesson.md");
    expect(harness.entryTitles()).toContain("Artifact path prepared");

    harness.script(choose("lesson"), choose("Open preview"));
    await showLibrary(harness.ctx);
    expect(harness.entries().at(-1)!.body).toContain("Lesson plan");
  });

  test("declining the trash confirmation keeps the artifact", async () => {
    harness = await createFlowHarness();
    await mkdir(plansDir(harness.cwd), { recursive: true });
    await writeFile(join(plansDir(harness.cwd), "keep.md"), "keep");
    harness.script(choose("keep"), choose("Move to recoverable trash"), choose("No"));
    await showLibrary(harness.ctx);
    expect(harness.dialogs[2]!.title).toBe("Move artifact to trash?");
    expect(harness.entryTitles()).not.toContain("Artifact moved to trash");
  });
});

describe("showCourses", () => {
  test("no courses points at the local snapshot folder", async () => {
    harness = await createFlowHarness();
    await showCourses(harness.ctx);
    expect(harness.entryTitles()).toEqual(["No courses available"]);
  });

  test("Start lesson in composer writes the lesson prompt and shows the course", async () => {
    harness = await createFlowHarness();
    await mkdir(join(harness.cwd, ".keating", "courses"), { recursive: true });
    await writeFile(join(harness.cwd, ".keating", "courses", "algebra.json"), JSON.stringify({
      id: "alg", title: "Algebra",
      modules: [{ id: "m1", title: "Basics", lessons: [{ id: "l1", title: "Variables", summary: "x is unknown" }] }],
    }));
    harness.script(choose("Algebra"), choose("Variables"), choose("Start lesson in composer"));
    await showCourses(harness.ctx);
    expect(harness.dialogs.map((call) => call.title)).toEqual(["Courses", "Algebra · choose a lesson", "Variables · Algebra"]);
    expect(harness.composer.value).toContain("Variables");
    expect(harness.entryTitles()).toEqual(["Algebra", "Lesson prepared"]);
  });
});
