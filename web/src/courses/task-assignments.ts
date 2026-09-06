import type { UiTaskNode } from "@keating/learner-contracts";
import { courseAssignmentInputSchema, type CourseAssignment, type CourseAssignmentInput } from "./contracts";

export function taskToCourseAssignment(task: UiTaskNode, id: string, lessonId?: string): CourseAssignmentInput {
  return courseAssignmentInputSchema.parse({
    id, title: task.title, brief: task.brief, rubric: task.criteria ?? [],
    deliverables: [], taskKind: task.kind,
    taskItems: task.items?.map(({ id, title, detail }) => ({ id, title, detail })),
    dueAt: task.dueAt, availableFrom: task.availableFrom,
    estimatedHours: task.estimatedMinutes ? task.estimatedMinutes / 60 : undefined,
    targetWords: task.submission?.targetWords, round: task.round, lessonId,
  });
}

export function courseAssignmentToTask(assignment: CourseAssignment): UiTaskNode {
  return {
    type: "task", kind: assignment.taskKind ?? "assignment", id: assignment.id,
    title: assignment.title, brief: assignment.brief, criteria: assignment.rubric,
    items: assignment.taskItems ?? assignment.deliverables.map((title, index) => ({ id: `deliverable-${index}`, title })),
    dueAt: assignment.dueAt, availableFrom: assignment.availableFrom,
    estimatedMinutes: assignment.estimatedHours === undefined ? undefined : assignment.estimatedHours * 60,
    round: assignment.round,
    submission: { format: "text", targetWords: assignment.targetWords },
  };
}
