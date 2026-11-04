import type { CourseViewerSnapshot } from "./contracts";
import {
  getPrivateForkSessionWriter,
  PRIVATE_FORK_CONTEXT_MAX_CHARS,
  privateForkId,
  quotePrivateForkText,
  resolvePrivateForkPassage,
  type PrivateForkSeed,
  type PrivateForkSessionOptions,
  type PrivateForkSessionWriter,
} from "../keating/private-fork-provenance";

export type LessonPrivateForkContext = {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  revision: number;
  reading: string;
  selectedText?: string;
  start?: number;
  end?: number;
  sourceHash?: string;
};

const MAX_CONTENT_LENGTH = PRIVATE_FORK_CONTEXT_MAX_CHARS - 3_200;

/** Revalidate the displayed reading before persisting a private study seed. */
export function createLessonPrivateForkSessionAdapter(dependencies: {
  writer: PrivateForkSessionWriter;
  getCourse: (courseId: string) => Promise<CourseViewerSnapshot>;
}): (
  context: LessonPrivateForkContext,
  options?: PrivateForkSessionOptions,
) => Promise<string> {
  return async (context, options) => {
    // Capture the displayed source and selection before the authoritative read.
    const { revision, reading, selectedText, start, end, sourceHash } = context;
    const courseId = privateForkId(context.courseId);
    const lessonId = privateForkId(context.lessonId);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("A valid course revision is required for private study.");
    }
    if (typeof reading !== "string" || !reading.trim()) {
      throw new Error("Lesson reading is required for private study.");
    }

    const { course } = await dependencies.getCourse(courseId);
    if (!course || course.id !== courseId) {
      throw new Error("The source course could not be verified.");
    }
    if (course.revision !== revision) {
      throw new Error(
        "The course has changed. Refresh the lesson before private study.",
      );
    }
    const lessons = course.modules
      .flatMap((module) => module.lessons)
      .filter((lesson) => lesson.id === lessonId);
    if (lessons.length === 0) {
      throw new Error("The source lesson is no longer available.");
    }
    if (lessons.length !== 1) {
      throw new Error("The source lesson is ambiguous.");
    }
    const lesson = lessons[0];
    if (lesson.reading !== reading) {
      throw new Error(
        "The lesson reading has changed. Refresh it before private study.",
      );
    }

    const passage = resolvePrivateForkPassage(lesson.reading, {
      selectedText,
      start,
      end,
      sourceHash,
    });
    const url = `/courses/${courseId}?lesson=${lessonId}#lesson-reading-${lessonId}`;
    const metadata = JSON.stringify(
      {
        courseId,
        courseTitle: course.title,
        lessonId,
        lessonTitle: lesson.title,
        revision,
        field: "reading",
        start: passage.start,
        end: passage.end,
        sourceHash: passage.sourceHash,
        ...(passage.truncated ? { truncated: true } : {}),
      },
      null,
      2,
    )
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    const content = [
      "# Private study from a lesson",
      "",
      `Source: [Open lesson reading](${url})`,
      "",
      "## Lesson source",
      "",
      "```json",
      metadata,
      "```",
      "",
      "## Reading excerpt",
      "",
      quotePrivateForkText(passage.quote),
    ].join("\n");
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new Error("Select a shorter lesson passage for private study.");
    }

    const seed: PrivateForkSeed = {
      title: Array.from(
        `Private study: ${lesson.title.replace(/\s+/g, " ").trim()}`,
      )
        .slice(0, 120)
        .join(""),
      content,
      source: {
        kind: "lesson",
        courseId,
        lessonId,
        revision,
        field: "reading",
        url,
        passage,
      },
    };
    return dependencies.writer(seed, options);
  };
}

export async function createLessonPrivateForkSession(
  context: LessonPrivateForkContext,
  options?: PrivateForkSessionOptions,
): Promise<string> {
  const { getCourse } = await import("./client");
  return createLessonPrivateForkSessionAdapter({
    getCourse,
    writer: async (seed, writerOptions) => {
      const writer = await getPrivateForkSessionWriter();
      return writer(seed, writerOptions);
    },
  })(context, options);
}
