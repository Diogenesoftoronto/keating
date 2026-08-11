import type { StudyPlanItem } from "../keating/openui/study-plan";
import type {
  CourseCreateInput,
  CourseLesson,
  CourseModule,
} from "./contracts";

export interface StudyPlanCourseSource {
  title: string;
  overview?: string;
  items: readonly StudyPlanItem[];
}

function compactText(value: string | undefined, maximum: number): string {
  return (value ?? "").trim().slice(0, maximum);
}

function requiredText(
  value: string | undefined,
  fallback: string,
  maximum: number,
): string {
  return compactText(value, maximum) || fallback;
}

function safeId(prefix: string, value: string, index: number): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return `${prefix}_${index + 1}_${slug || "step"}`.slice(0, 96);
}

function leafItems(
  item: StudyPlanItem,
  parents: readonly StudyPlanItem[] = [],
): Array<{
  item: StudyPlanItem;
  parents: readonly StudyPlanItem[];
}> {
  if (!item.children?.length) return [{ item, parents }];
  return item.children.flatMap((child) => leafItems(child, [...parents, item]));
}

function unique(values: readonly string[], maximum: number): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, maximum);
}

function lessonReading(
  item: StudyPlanItem,
  parents: readonly StudyPlanItem[],
  itemTitles: ReadonlyMap<string, string>,
): string {
  const sections: string[] = [];
  if (item.detail?.trim()) sections.push(item.detail.trim());

  const context = parents
    .slice(1)
    .map((parent) => parent.title)
    .filter(Boolean);
  if (context.length)
    sections.push(`Course path: ${context.join(" → ")} → ${item.title}.`);

  const dependencies = unique(
    (item.dependsOn ?? [])
      .map((id) => itemTitles.get(id) ?? "")
      .filter(Boolean),
    12,
  );
  if (dependencies.length)
    sections.push(`Complete first: ${dependencies.join(", ")}.`);

  if (item.outcomes?.length) {
    sections.push(
      `Evidence of completion:\n${unique(item.outcomes, 8)
        .map((outcome) => `• ${outcome}`)
        .join("\n")}`,
    );
  }

  return compactText(
    sections.join("\n\n") ||
      `Work through ${item.title} and record the questions or examples that need another pass.`,
    120_000,
  );
}

/** Converts the learner-owned StudyPlan shown in chat into a durable course. */
export function courseFromStudyPlan(
  source: StudyPlanCourseSource,
): CourseCreateInput {
  const itemTitles = new Map<string, string>();
  const visit = (items: readonly StudyPlanItem[]) => {
    for (const item of items) {
      itemTitles.set(item.id, item.title);
      visit(item.children ?? []);
    }
  };
  visit(source.items);

  let lessonIndex = 0;
  const modules: CourseModule[] = source.items
    .slice(0, 48)
    .map((moduleItem, moduleIndex) => {
      const lessons: CourseLesson[] = leafItems(moduleItem)
        .slice(0, 64)
        .map(({ item, parents }) => {
          const id = safeId("lesson", item.id || item.title, lessonIndex++);
          return {
            id,
            title: requiredText(item.title, `Lesson ${lessonIndex}`, 240),
            summary: compactText(item.detail, 2_000),
            estimatedMinutes: item.estimatedMinutes,
            objectives: unique(item.outcomes ?? [], 16),
            reading: lessonReading(item, parents, itemTitles),
            materialIds: [],
            cardIds: [],
          };
        });
      return {
        id: safeId("module", moduleItem.id || moduleItem.title, moduleIndex),
        title: requiredText(moduleItem.title, `Module ${moduleIndex + 1}`, 240),
        description: compactText(moduleItem.detail, 2_000),
        lessons,
      };
    });

  const outcomes = unique(
    source.items.flatMap((item) => [
      ...(item.outcomes ?? []),
      ...leafItems(item).flatMap(({ item: leaf }) => leaf.outcomes ?? []),
    ]),
    24,
  );

  return {
    title: requiredText(source.title, "Untitled course", 240),
    description: compactText(
      source.overview ||
        `Course created from the “${source.title}” study plan in Keating chat.`,
      4_000,
    ),
    outcomes,
    modules,
    cards: [],
    artifacts: [],
    assignments: [],
    settings: {
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: true,
      allowPeerComments: true,
    },
  };
}
