import { describe, expect, it } from "bun:test";
import {
  flattenStudyPlanItems,
  studyPlanAnchorId,
  studyPlanDependencyGraph,
  studyPlanLeafItems,
  type StudyPlanItem,
} from "../keating/openui/study-plan";
import { courseFromStudyPlan } from "../courses/from-study-plan";
import { courseCreateInputSchema } from "../courses/contracts";

const plan: StudyPlanItem[] = [
  {
    id: "foundations",
    title: "Foundations",
    children: [
      {
        id: "concepts",
        title: "Core concepts",
        children: [
          { id: "terms", title: "Core terms" },
          { id: "model", title: "Mental model", dependsOn: ["terms"] },
        ],
      },
    ],
  },
  {
    id: "application",
    title: "Application",
    dependsOn: ["foundations"],
    children: [
      {
        id: "guided-practice",
        title: "Guided practice",
        children: [
          {
            id: "worked-example",
            title: "Worked example",
            dependsOn: ["model"],
          },
        ],
      },
    ],
  },
];

describe("nested OpenUI study plans", () => {
  it("flattens nested areas while preserving author order", () => {
    expect(flattenStudyPlanItems(plan).map((item) => item.id)).toEqual([
      "foundations",
      "concepts",
      "terms",
      "model",
      "application",
      "guided-practice",
      "worked-example",
    ]);
  });

  it("counts only actionable leaves for learner progress", () => {
    expect(studyPlanLeafItems(plan).map((item) => item.id)).toEqual([
      "terms",
      "model",
      "worked-example",
    ]);
  });

  it("derives a Mermaid dependency graph from valid ids", () => {
    const graph = studyPlanDependencyGraph(plan);

    expect(graph?.edgeCount).toBe(3);
    expect(graph?.code).toContain('["Core terms"]');
    expect(graph?.code).toContain('["Mental model"]');
    expect(graph?.code).toContain("-->");
  });

  it("ignores missing and self-referential dependency ids", () => {
    expect(
      studyPlanDependencyGraph([
        { id: "only", title: "Only step", dependsOn: ["missing", "only"] },
      ]),
    ).toBeNull();
  });

  it("creates stable in-page anchors for links between plans", () => {
    expect(studyPlanAnchorId(" DNS observability / lab ")).toBe(
      "study-plan-DNS-observability-lab",
    );
    expect(studyPlanAnchorId("")).toBe("study-plan-plan");
  });

  it("turns a nested study plan into a valid course without losing its learning path", () => {
    const course = courseFromStudyPlan({
      title: "Systems thinking",
      overview: "Move from feedback loops to practical intervention design.",
      items: plan,
    });

    expect(courseCreateInputSchema.parse(course)).toEqual(course);
    expect(course.modules.map((module) => module.title)).toEqual([
      "Foundations",
      "Application",
    ]);
    expect(course.modules[0]?.lessons.map((lesson) => lesson.title)).toEqual([
      "Core terms",
      "Mental model",
    ]);
    expect(course.modules[1]?.lessons[0]?.reading).toContain(
      "Complete first: Mental model.",
    );
    expect(
      course.modules
        .flatMap((module) => module.lessons)
        .every((lesson) => lesson.reading.length > 0),
    ).toBe(true);
  });

  it("sanitizes model-authored ids for the course contract", () => {
    const course = courseFromStudyPlan({
      title: "DNS / observability",
      items: [{ id: "🔎 DNS phase one", title: "Inspect traces" }],
    });

    expect(courseCreateInputSchema.safeParse(course).success).toBe(true);
    expect(course.modules[0]?.id).toMatch(/^module_1_/);
    expect(course.modules[0]?.lessons[0]?.id).toMatch(/^lesson_1_/);
  });

  it("keeps an incomplete streamed plan valid when its labels are blank", () => {
    const course = courseFromStudyPlan({
      title: " ",
      items: [{ id: " ", title: " " }],
    });

    expect(courseCreateInputSchema.safeParse(course).success).toBe(true);
    expect(course.title).toBe("Untitled course");
    expect(course.modules[0]?.lessons[0]?.title).toBe("Lesson 1");
  });
});
