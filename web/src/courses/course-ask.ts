/**
 * Concrete requests a course workspace can hand to Keating. The workspace links
 * into chat with `ask=…`; chat drops the text into the composer so the learner
 * still reads and sends it themselves.
 */

export type CourseAskView = "read" | "discuss" | "review" | "build";

export interface CourseAskAction {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export interface CourseAskContext {
  courseTitle: string;
  lessonTitle?: string;
  lessonId?: string;
  view: CourseAskView;
}

const MAX_ASK_LENGTH = 2_000;

export function courseAskActions(context: CourseAskContext): CourseAskAction[] {
  const course = `“${context.courseTitle}”`;
  const lesson = context.lessonTitle ? `“${context.lessonTitle}”` : null;
  const lessonRef = context.lessonId ? ` (lesson id \`${context.lessonId}\`)` : "";
  const actions: CourseAskAction[] = [];

  if (lesson && (context.view === "read" || context.view === "build")) {
    actions.push(
      {
        id: "lesson-review",
        label: "Review this lesson",
        description: "Find what is missing, unclear, or out of order",
        prompt: `Inspect ${course} and read the lesson ${lesson}${lessonRef}. Tell me the two weakest parts of it and why, then wait for me to choose before changing anything.`,
      },
      {
        id: "lesson-sources",
        label: "Find sources for it",
        description: "Search for readings worth attaching",
        prompt: `Search for three reliable, current sources that would strengthen the lesson ${lesson}${lessonRef} in ${course}. For each one give the link, what it adds, and where in the lesson it belongs. Ask me before adding anything.`,
      },
      {
        id: "lesson-quiz",
        label: "Draft a quiz",
        description: "Post-lesson questions that test transfer",
        prompt: `Draft a short quiz for the lesson ${lesson}${lessonRef} in ${course} that tests transfer rather than recall. Show me the questions first; add it to the course only once I agree.`,
      },
      {
        id: "lesson-practice",
        label: "Write a practice question",
        description: "One exercise with a rubric",
        prompt: `Write one practice question with a three-point rubric for the lesson ${lesson}${lessonRef} in ${course}. Explain what a wrong answer would reveal, then wait for my go-ahead.`,
      },
    );
  }

  if (context.view === "discuss") {
    actions.push(
      {
        id: "discussion-summary",
        label: "Read the discussion with me",
        description: "Surface the real question underneath",
        prompt: `Look at the discussion in ${course}${lesson ? ` for the lesson ${lesson}` : ""}. What is the question people keep circling? Suggest how the course should answer it.`,
      },
      {
        id: "discussion-followup",
        label: "Suggest a follow-up",
        description: "A prompt that moves the thread forward",
        prompt: `Based on the discussion in ${course}${lesson ? ` on ${lesson}` : ""}, propose one follow-up question I could post that would make people think rather than agree.`,
      },
    );
  }

  if (context.view === "review") {
    actions.push({
      id: "review-help",
      label: "Help me review work",
      description: "Turn a rubric into useful feedback",
      prompt: `Help me review learner submissions in ${course}. Ask to see one submission at a time, then draft feedback that names what is working before what is missing.`,
    });
  }

  actions.push(
    {
      id: "course-gaps",
      label: "Find the course's gaps",
      description: "Sequence, prerequisites, and pacing",
      prompt: `Inspect ${course} and tell me where the sequence, prerequisites, or pacing break down. Give me the single most important fix first, and ask before you change anything.`,
    },
    {
      id: "course-next",
      label: "Plan what comes next",
      description: "The next module or lesson",
      prompt: `Based on what is already in ${course}, propose the next module or lesson: its outcome, its practice, and why it belongs there. Wait for my changes before writing it into the course.`,
    },
  );

  return actions;
}

/** The palette's “ask Keating to search for X” hand-off. */
export function courseSearchAsk(
  query: string,
  context: Pick<CourseAskContext, "courseTitle" | "lessonTitle">,
): string {
  const where = context.lessonTitle
    ? ` I am on the lesson “${context.lessonTitle}”.`
    : "";
  return `I searched “${query}” inside my course “${context.courseTitle}” and did not find enough.${where} Search for it properly — in the course and on the web — and tell me what is worth adding, with links. Ask before changing the course.`;
}

export function truncateAsk(ask: string): string {
  return ask.length > MAX_ASK_LENGTH ? `${ask.slice(0, MAX_ASK_LENGTH - 1)}…` : ask;
}

/** Search params for a chat link that opens with the course loaded. */
export function courseChatSearch(
  courseId: string,
  ask?: string,
): { course: string; courseMode: "edit"; ask?: string } {
  return {
    course: courseId,
    courseMode: "edit",
    ...(ask ? { ask: truncateAsk(ask) } : {}),
  };
}
