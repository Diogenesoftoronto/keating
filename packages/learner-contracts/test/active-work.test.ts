import { describe, expect, test } from "bun:test";
import { ACTIVE_WORK_LIMITS, formatActiveWork, projectActiveWork, type ActiveWorkPresentation } from "../src/judgement/active-work.js";
import type { UiDocument, UiStudyPlanItem } from "../src/ui.js";

const planDoc = (items: UiStudyPlanItem[]): UiDocument => ({
  schemaVersion: 1 as UiDocument["schemaVersion"], id: "plan-doc", revision: 2, lifecycle: "ready", supportedSurfaces: ["web"],
  title: "Fractions", nodes: [{ type: "study-plan", id: "plan", title: "Fractions path", items }],
  createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
});
const present = (nodeId: string, planItemId: string | null, presentedAt = 1, component = "question"): ActiveWorkPresentation =>
  ({ documentId: "q-doc", nodeId, component, presentedAt, planDocumentId: planItemId ? "plan-doc" : null, planItemId });

describe("projectActiveWork", () => {
  test("no plan and no presentations yields an empty view", () => {
    const work = projectActiveWork({ plan: null, presentations: [], attempts: [] });
    expect(work).toEqual({ plan: null, focus: null, openInteractions: [], truncated: false });
    expect(formatActiveWork(work)).toBe("");
  });

  test("focus prefers the in-progress leaf over the first unstarted one", () => {
    const work = projectActiveWork({ plan: planDoc([
      { id: "a", title: "Parts", status: "not_started" },
      { id: "b", title: "Equivalence", status: "in_progress" },
    ]), presentations: [], attempts: [] });
    expect(work.focus?.itemId).toBe("b");
  });

  test("focus skips items whose dependencies are not done", () => {
    const work = projectActiveWork({ plan: planDoc([
      { id: "a", title: "Parts", status: "done" },
      { id: "c", title: "Adding", dependsOn: ["b"] },
      { id: "b", title: "Equivalence", dependsOn: ["a"] },
    ]), presentations: [], attempts: [] });
    expect(work.focus?.itemId).toBe("b");
    expect(work.focus?.dependsOn).toEqual([{ id: "a", title: "Parts", status: "done", evidence: expect.objectContaining({ presented: 0 }) }]);
  });

  test("nested leaves are candidates and parents derive status from children", () => {
    const work = projectActiveWork({ plan: planDoc([
      { id: "p", title: "Basics", children: [{ id: "p1", title: "One", status: "done" }, { id: "p2", title: "Two" }] },
    ]), presentations: [], attempts: [] });
    expect(work.focus?.itemId).toBe("p2");
    expect(work.plan?.outline).toEqual([
      { id: "p", title: "Basics", status: "in_progress", depth: 0 },
      { id: "p1", title: "One", status: "done", depth: 1 },
      { id: "p2", title: "Two", status: "not_started", depth: 1 },
    ]);
  });

  test("evidence joins attempts through presentations; unlinked attempts do not count", () => {
    const work = projectActiveWork({
      plan: planDoc([{ id: "a", title: "Parts", status: "in_progress" }]),
      presentations: [present("n1", "a", 10), present("n2", "a", 20), present("n3", null, 30)],
      attempts: [
        { documentId: "q-doc", nodeId: "n1", createdAt: 11, grading: "auto", score: 1 },
        { documentId: "q-doc", nodeId: "n2", createdAt: 21, grading: "pending" },
        { documentId: "q-doc", nodeId: "n3", createdAt: 31, grading: "auto", score: 0 },
        { documentId: "other", nodeId: "n1", createdAt: 40, grading: "auto", score: 0 },
      ],
    });
    expect(work.focus?.evidence).toEqual({ presented: 2, attempted: 2, correct: 1, incorrect: 0, pendingGrade: 1, lastAttemptAt: 21, independence: "unknown" });
    expect(work.openInteractions.map(interaction => [interaction.nodeId, interaction.state, interaction.itemId])).toEqual([["n2", "pending-grade", "a"]]);
  });

  test("open interactions include awaiting assessable nodes only, newest first and capped", () => {
    const presentations = [
      ...Array.from({ length: 7 }, (_, index) => present(`n${index}`, null, index)),
      present("sim", null, 99, "simulation"),
    ];
    const work = projectActiveWork({ plan: null, presentations, attempts: [] });
    expect(work.openInteractions).toHaveLength(ACTIVE_WORK_LIMITS.openInteractions);
    expect(work.openInteractions[0]?.nodeId).toBe("n6");
    expect(work.truncated).toBe(true);
  });

  test("outline and text fields are capped deterministically", () => {
    const items = Array.from({ length: 45 }, (_, index) => ({ id: `i${index}`, title: "t".repeat(index === 0 ? 500 : 5), detail: index === 0 ? "d".repeat(5_000) : undefined }));
    const work = projectActiveWork({ plan: planDoc(items), presentations: [], attempts: [] });
    expect(work.plan?.outline).toHaveLength(ACTIVE_WORK_LIMITS.outlineItems);
    expect(work.focus?.title.length).toBe(ACTIVE_WORK_LIMITS.title);
    expect(work.focus?.detail?.length).toBe(ACTIVE_WORK_LIMITS.detail);
    expect(work.truncated).toBe(true);
  });

  test("a document without a populated study plan is not a plan", () => {
    const work = projectActiveWork({ plan: planDoc([]), presentations: [], attempts: [] });
    expect(work.plan).toBeNull();
    expect(work.focus).toBeNull();
  });

  test("format renders plan, focus and open work", () => {
    const text = formatActiveWork(projectActiveWork({ plan: planDoc([{ id: "a", title: "Parts", outcomes: ["name a numerator"] }]), presentations: [present("n1", "a")], attempts: [] }));
    expect(text).toContain("Current focus: Parts");
    expect(text).toContain("Outcomes: name a numerator");
    expect(text).toContain("Open question n1: awaiting (current focus)");
  });
});
