import type { StarterPrompt } from "./starter-prompts";

export interface CourseChatContext {
  mode: "create" | "edit";
  activeCourseId?: string;
}

export function courseChatContext(search: {
  course?: unknown;
  courseMode?: unknown;
}): CourseChatContext | undefined {
  const activeCourseId =
    typeof search.course === "string" && search.course.trim()
      ? search.course.trim()
      : undefined;
  if (activeCourseId) return { mode: "edit", activeCourseId };
  return search.courseMode === "create" ? { mode: "create" } : undefined;
}

export function courseCollaborationStarterPrompts(
  context: CourseChatContext,
): StarterPrompt[] {
  if (context.mode === "edit") {
    return [
      {
        label: "Plan",
        domain: "course",
        text: "Inspect this course with me. Identify the most important gap, then ask before changing anything.",
      },
      {
        label: "Plan",
        domain: "course",
        text: "Help me revise this course's sequence, prerequisites, and pacing. Start by showing me what is there now.",
      },
      {
        label: "Create",
        domain: "course",
        text: "Help me add the right quiz, artifact, or assignment to this course. Ask what it should assess first.",
      },
    ];
  }
  return [
    {
      label: "Plan",
      domain: "course",
      text: "Help me design a course. Start by asking about the learners, outcomes, pace, and material I already have.",
    },
    {
      label: "Plan",
      domain: "course",
      text: "Turn what we have discussed into a course outline. Show me the outline and let me revise it before creating the course.",
    },
    {
      label: "Create",
      domain: "course",
      text: "Help me assemble a course from my saved lesson plans, quizzes, visuals, documents, and flashcards.",
    },
  ];
}
