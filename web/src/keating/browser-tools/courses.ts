import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  applyCourseOperation,
  createCourse,
  getCourse,
  listCourses,
  newCourseOperationId,
} from "../../courses/client";
import {
  normalizeCourseViewerSnapshot,
  type Course,
  type CourseArtifactFormat,
  type CourseArtifactKind,
  type CourseAssignment,
  type CourseCard,
  type CourseCreateInput,
  type CourseLesson,
  type CourseModule,
  type CourseViewerSnapshot,
} from "../../courses/contracts";
import { createTool, type KeatingToolsOptions } from "./shared";

const COURSE_ACTIONS = [
  "update_course",
  "upsert_module",
  "upsert_lesson",
  "upsert_assignment",
  "upsert_artifact",
  "upsert_card",
] as const;
const COURSE_PROMPT_START = "<!-- keating:course-collaboration:start -->";
const COURSE_PROMPT_END = "<!-- keating:course-collaboration:end -->";

type CourseAction = (typeof COURSE_ACTIONS)[number];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown): string | undefined {
  const result = text(value);
  return result || undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function courseId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function resolveCourseId(
  params: Record<string, unknown>,
  options: KeatingToolsOptions,
): string {
  const id = text(params.course_id) || options.course?.activeCourseId || "";
  if (!id) {
    throw new Error(
      "A course_id is required. Use course_list to choose a course, or open chat from a course workspace.",
    );
  }
  return id;
}

async function loadCourse(
  params: Record<string, unknown>,
  options: KeatingToolsOptions,
): Promise<CourseViewerSnapshot> {
  return normalizeCourseViewerSnapshot(
    await getCourse(resolveCourseId(params, options)),
  );
}

function courseLink(snapshot: CourseViewerSnapshot): string {
  return `[Open ${snapshot.course.title}](/courses/${encodeURIComponent(snapshot.course.id)})`;
}

function announceCourseChange(
  snapshot: CourseViewerSnapshot,
  change: string,
): string {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("keating:course-updated", {
        detail: {
          courseId: snapshot.course.id,
          revision: snapshot.course.revision,
          change,
        },
      }),
    );
  }
  return `${change} Course revision is now ${snapshot.course.revision}. ${courseLink(snapshot)}`;
}

function lessonFromDraft(
  value: Record<string, unknown>,
  fallbackTitle: string,
): CourseLesson {
  const exercisePrompt = optionalText(value.exercise_prompt);
  return {
    id: courseId("lesson"),
    title: text(value.title) || fallbackTitle,
    summary: text(value.summary),
    ...(positiveInteger(value.estimated_minutes)
      ? { estimatedMinutes: positiveInteger(value.estimated_minutes) }
      : {}),
    objectives: stringList(value.objectives),
    reading: text(value.reading),
    materialIds: [],
    cardIds: [],
    ...(exercisePrompt
      ? {
          exercise: {
            id: courseId("exercise"),
            prompt: exercisePrompt,
            rubric: stringList(value.exercise_rubric),
          },
        }
      : {}),
  };
}

function modulesFromDraft(value: unknown): CourseModule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, moduleIndex) => {
    const module = record(candidate);
    if (!module) return [];
    const title = text(module.title) || `Module ${moduleIndex + 1}`;
    const lessons = Array.isArray(module.lessons)
      ? module.lessons.flatMap((lesson, lessonIndex) => {
          const draft = record(lesson);
          return draft
            ? [lessonFromDraft(draft, `Lesson ${lessonIndex + 1}`)]
            : [];
        })
      : [];
    return [
      {
        id: courseId("module"),
        title,
        description: text(module.description),
        lessons,
      },
    ];
  });
}

function inspectCourse(snapshot: CourseViewerSnapshot): string {
  const { course, permissions, viewer } = snapshot;
  const modules = course.modules.length
    ? course.modules
        .map((module) => {
          const lessons = module.lessons.length
            ? module.lessons
                .map(
                  (lesson) =>
                    `  - ${lesson.title} \`${lesson.id}\` (${lesson.estimatedMinutes ?? "unscheduled"} min)`,
                )
                .join("\n")
            : "  - No lessons yet";
          return `- **${module.title}** \`${module.id}\`\n${lessons}`;
        })
        .join("\n")
    : "- No modules yet";
  const artifacts = course.artifacts.length
    ? course.artifacts
        .map(
          (artifact) =>
            `- ${artifact.title} (${artifact.kind}/${artifact.format}) \`${artifact.id}\`${artifact.lessonId ? ` → lesson \`${artifact.lessonId}\`` : ""}`,
        )
        .join("\n")
    : "- None";
  const assignments = course.assignments.length
    ? course.assignments
        .map(
          (assignment) =>
            `- ${assignment.title} \`${assignment.id}\`${assignment.lessonId ? ` → lesson \`${assignment.lessonId}\`` : ""}`,
        )
        .join("\n")
    : "- None";

  return [
    `# ${course.title}`,
    "",
    `Course ID: \`${course.id}\``,
    `Revision: ${course.revision}`,
    `Your role: ${viewer.role}`,
    `Can edit course: ${permissions.canEditCourse ? "yes" : "no"}`,
    course.description
      ? `Description: ${course.description}`
      : "Description: not set",
    "",
    "## Outcomes",
    course.outcomes.length
      ? course.outcomes.map((outcome) => `- ${outcome}`).join("\n")
      : "- None yet",
    "",
    "## Outline",
    modules,
    "",
    "## Artifacts",
    artifacts,
    "",
    "## Assignments",
    assignments,
    "",
    `Cards: ${course.cards.length}. Materials: ${course.materials.length}.`,
    courseLink(snapshot),
  ].join("\n");
}

async function applyMutation(
  snapshot: CourseViewerSnapshot,
  operation: Parameters<typeof applyCourseOperation>[0],
  change: string,
): Promise<string> {
  const result = await applyCourseOperation(operation);
  return announceCourseChange(
    normalizeCourseViewerSnapshot(result.snapshot),
    change,
  );
}

async function updateCourse(
  params: Record<string, unknown>,
  options: KeatingToolsOptions,
): Promise<string> {
  const snapshot = await loadCourse(params, options);
  const action = text(params.action) as CourseAction;
  const base = {
    id: newCourseOperationId(),
    courseId: snapshot.course.id,
    baseRevision: snapshot.course.revision,
  };

  if (action === "update_course") {
    const patch: {
      title?: string;
      description?: string;
      outcomes?: string[];
    } = {};
    if (params.title !== undefined) patch.title = text(params.title);
    if (params.description !== undefined)
      patch.description = text(params.description);
    if (params.outcomes !== undefined)
      patch.outcomes = stringList(params.outcomes);
    if (Object.keys(patch).length === 0) {
      throw new Error(
        "Provide at least one of title, description, or outcomes for update_course.",
      );
    }
    return applyMutation(
      snapshot,
      { ...base, type: "course.update", patch },
      "Updated the course details.",
    );
  }

  if (action === "upsert_module") {
    const requestedId = optionalText(params.module_id);
    const existing = requestedId
      ? snapshot.course.modules.find((module) => module.id === requestedId)
      : undefined;
    const title = optionalText(params.title) ?? existing?.title;
    if (!title) throw new Error("A title is required for a new module.");
    const module: CourseModule = {
      id: existing?.id ?? requestedId ?? courseId("module"),
      title,
      description:
        params.description !== undefined
          ? text(params.description)
          : (existing?.description ?? ""),
      lessons: existing?.lessons ?? [],
    };
    return applyMutation(
      snapshot,
      { ...base, type: "module.upsert", module },
      `${existing ? "Updated" : "Added"} module “${module.title}”.`,
    );
  }

  if (action === "upsert_lesson") {
    const moduleId = text(params.module_id);
    const module = snapshot.course.modules.find(
      (candidate) => candidate.id === moduleId,
    );
    if (!module) {
      throw new Error(
        "Choose an existing module_id from course_inspect before adding a lesson.",
      );
    }
    const requestedId = optionalText(params.lesson_id);
    const existing = requestedId
      ? module.lessons.find((lesson) => lesson.id === requestedId)
      : undefined;
    const title = optionalText(params.title) ?? existing?.title;
    if (!title) throw new Error("A title is required for a new lesson.");
    const exercisePrompt = optionalText(params.exercise_prompt);
    const lesson: CourseLesson = {
      id: existing?.id ?? requestedId ?? courseId("lesson"),
      title,
      summary:
        params.summary !== undefined
          ? text(params.summary)
          : (existing?.summary ?? ""),
      ...((positiveInteger(params.estimated_minutes) ??
      existing?.estimatedMinutes)
        ? {
            estimatedMinutes:
              positiveInteger(params.estimated_minutes) ??
              existing?.estimatedMinutes,
          }
        : {}),
      objectives:
        params.objectives !== undefined
          ? stringList(params.objectives)
          : (existing?.objectives ?? []),
      reading:
        params.reading !== undefined
          ? text(params.reading)
          : (existing?.reading ?? ""),
      materialIds: existing?.materialIds ?? [],
      cardIds: existing?.cardIds ?? [],
      ...(exercisePrompt || existing?.exercise
        ? {
            exercise: {
              id: existing?.exercise?.id ?? courseId("exercise"),
              prompt:
                exercisePrompt ??
                existing?.exercise?.prompt ??
                "Apply what this lesson teaches.",
              ...((optionalText(params.exercise_placeholder) ??
              existing?.exercise?.placeholder)
                ? {
                    placeholder:
                      optionalText(params.exercise_placeholder) ??
                      existing?.exercise?.placeholder,
                  }
                : {}),
              rubric:
                params.rubric !== undefined
                  ? stringList(params.rubric)
                  : (existing?.exercise?.rubric ?? []),
            },
          }
        : {}),
    };
    return applyMutation(
      snapshot,
      { ...base, type: "lesson.update", moduleId, lesson },
      `${existing ? "Updated" : "Added"} lesson “${lesson.title}”.`,
    );
  }

  if (action === "upsert_assignment") {
    const requestedId = optionalText(params.assignment_id);
    const existing = requestedId
      ? snapshot.course.assignments.find(
          (assignment) => assignment.id === requestedId,
        )
      : undefined;
    const title = optionalText(params.title) ?? existing?.title;
    const brief = optionalText(params.brief) ?? existing?.brief;
    if (!title || !brief) {
      throw new Error("A title and brief are required for a new assignment.");
    }
    const assignment: Omit<CourseAssignment, "updatedAt" | "updatedBy"> = {
      id: existing?.id ?? requestedId ?? courseId("assignment"),
      title,
      brief,
      deliverables:
        params.deliverables !== undefined
          ? stringList(params.deliverables)
          : (existing?.deliverables ?? []),
      rubric:
        params.rubric !== undefined
          ? stringList(params.rubric)
          : (existing?.rubric ?? []),
      ...((optionalText(params.lesson_id) ?? existing?.lessonId)
        ? { lessonId: optionalText(params.lesson_id) ?? existing?.lessonId }
        : {}),
      ...((optionalText(params.due_at) ?? existing?.dueAt)
        ? { dueAt: optionalText(params.due_at) ?? existing?.dueAt }
        : {}),
      ...((positiveNumber(params.estimated_hours) ?? existing?.estimatedHours)
        ? {
            estimatedHours:
              positiveNumber(params.estimated_hours) ??
              existing?.estimatedHours,
          }
        : {}),
    };
    return applyMutation(
      snapshot,
      { ...base, type: "assignment.upsert", assignment },
      `${existing ? "Updated" : "Added"} assignment “${assignment.title}”.`,
    );
  }

  if (action === "upsert_artifact") {
    const requestedId = optionalText(params.artifact_id);
    const existing = requestedId
      ? snapshot.course.artifacts.find(
          (artifact) => artifact.id === requestedId,
        )
      : undefined;
    const title = optionalText(params.title) ?? existing?.title;
    const content =
      params.content !== undefined ? String(params.content) : existing?.content;
    if (!title || !content) {
      throw new Error("A title and content are required for a new artifact.");
    }
    const kind = (optionalText(params.artifact_kind) ??
      existing?.kind ??
      "other") as CourseArtifactKind;
    const format = (optionalText(params.artifact_format) ??
      existing?.format ??
      "markdown") as CourseArtifactFormat;
    const artifact = {
      id: existing?.id ?? requestedId ?? courseId("artifact"),
      kind,
      format,
      title,
      ...((optionalText(params.description) ?? existing?.description)
        ? {
            description:
              optionalText(params.description) ?? existing?.description,
          }
        : {}),
      content,
      ...((optionalText(params.lesson_id) ?? existing?.lessonId)
        ? { lessonId: optionalText(params.lesson_id) ?? existing?.lessonId }
        : {}),
      ...(existing?.sourceId ? { sourceId: existing.sourceId } : {}),
      ...(existing?.sourceSessionId
        ? { sourceSessionId: existing.sourceSessionId }
        : {}),
    };
    return applyMutation(
      snapshot,
      { ...base, type: "artifact.upsert", artifact },
      `${existing ? "Updated" : "Added"} ${kind.replaceAll("-", " ")} “${artifact.title}”.`,
    );
  }

  if (action === "upsert_card") {
    const requestedId = optionalText(params.card_id);
    const existing = requestedId
      ? snapshot.course.cards.find((card) => card.id === requestedId)
      : undefined;
    const front = optionalText(params.front) ?? existing?.front;
    const back = optionalText(params.back) ?? existing?.back;
    if (!front || !back) {
      throw new Error("A front and back are required for a new card.");
    }
    const card: Omit<CourseCard, "updatedAt" | "updatedBy"> = {
      id: existing?.id ?? requestedId ?? courseId("card"),
      front,
      back,
      tags:
        params.tags !== undefined
          ? stringList(params.tags)
          : (existing?.tags ?? []),
      ...((optionalText(params.lesson_id) ?? existing?.lessonId)
        ? { lessonId: optionalText(params.lesson_id) ?? existing?.lessonId }
        : {}),
    };
    return applyMutation(
      snapshot,
      { ...base, type: "card.upsert", card },
      `${existing ? "Updated" : "Added"} a flashcard.`,
    );
  }

  throw new Error(`Unsupported course action: ${action || "missing action"}.`);
}

const courseIdParameter = {
  type: "string",
  description:
    "Course id. Optional when chat was opened from a course workspace.",
};

export function createCourseTools(
  options: KeatingToolsOptions = {},
): AgentTool[] {
  return [
    createTool(
      "course_list",
      "List the learner's courses before choosing an existing workspace. This reads only the signed-in learner's course library.",
      {},
      async () => {
        const courses = await listCourses();
        if (!courses.length) {
          return "No courses exist yet. Collaborate on an outline, then use course_create once the learner agrees.";
        }
        return [
          "## Courses",
          "",
          ...courses.map(
            (course) =>
              `- [${course.title}](/courses/${encodeURIComponent(course.id)}) · ${course.lessonCount} lessons · ${course.role} · \`${course.id}\``,
          ),
        ].join("\n");
      },
    ),
    createTool(
      "course_inspect",
      "Inspect an existing course before proposing changes. Returns its revision, outcomes, module and lesson ids, artifact ids, assignment ids, and edit permission without exposing private peer work.",
      { course_id: courseIdParameter },
      (params) => loadCourse(params, options).then(inspectCourse),
    ),
    createTool(
      "course_create",
      "Create the first durable version of a course after the learner has agreed on its audience, outcomes, pace, and outline. Do not use this as the first response to a vague request. Modules and lessons are optional, so an agreed empty course is valid and can be assembled together afterward.",
      {
        title: { type: "string", description: "Agreed course title." },
        description: {
          type: "string",
          description:
            "Who the course is for, its scope, and the intended learning arc.",
        },
        outcomes: {
          type: "array",
          items: { type: "string" },
          description: "Observable outcomes agreed with the learner.",
        },
        modules: {
          type: "array",
          description:
            "Optional agreed outline. Each module may contain initial lessons.",
          items: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              lessons: {
                type: "array",
                items: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                    objectives: {
                      type: "array",
                      items: { type: "string" },
                    },
                    reading: { type: "string" },
                    estimated_minutes: { type: "integer" },
                    exercise_prompt: { type: "string" },
                    exercise_rubric: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (params) => {
        const input: CourseCreateInput = {
          title: text(params.title),
          description: text(params.description),
          outcomes: stringList(params.outcomes),
          modules: modulesFromDraft(params.modules),
          cards: [],
          artifacts: [],
          assignments: [],
          settings: {
            teacherAccessPolicy: "request",
            allowPeerDeckEdits: true,
            allowPeerComments: true,
          },
        };
        const snapshot = normalizeCourseViewerSnapshot(
          await createCourse(input),
        );
        return announceCourseChange(
          snapshot,
          `Created “${snapshot.course.title}” with ${snapshot.course.modules.length} modules and ${snapshot.course.modules.reduce((total, module) => total + module.lessons.length, 0)} lessons.`,
        );
      },
      ["title"],
    ),
    createTool(
      "course_update",
      "Make one agreed, recoverable addition or revision to a course. Inspect first when ids or current content are unclear. Supported actions are update_course, upsert_module, upsert_lesson, upsert_assignment, upsert_artifact, and upsert_card. Existing ids revise; omitted item ids create. Never remove course content with this tool.",
      {
        action: {
          type: "string",
          enum: [...COURSE_ACTIONS],
          description: "The single course change to apply.",
        },
        course_id: courseIdParameter,
        module_id: {
          type: "string",
          description:
            "Existing module id for upsert_lesson, or optional module id to revise.",
        },
        lesson_id: {
          type: "string",
          description:
            "Optional existing lesson id to revise, or lesson attachment target for content.",
        },
        assignment_id: { type: "string" },
        artifact_id: { type: "string" },
        card_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        outcomes: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        objectives: { type: "array", items: { type: "string" } },
        reading: { type: "string" },
        estimated_minutes: { type: "integer" },
        exercise_prompt: { type: "string" },
        exercise_placeholder: { type: "string" },
        brief: { type: "string" },
        deliverables: { type: "array", items: { type: "string" } },
        rubric: { type: "array", items: { type: "string" } },
        due_at: {
          type: "string",
          description: "Optional ISO 8601 assignment due date.",
        },
        estimated_hours: { type: "number" },
        artifact_kind: {
          type: "string",
          enum: [
            "quiz",
            "openui",
            "lesson-plan",
            "lesson-map",
            "animation",
            "verification",
            "benchmark",
            "evolution",
            "prompt-evolution",
            "image",
            "infographic",
            "document",
            "other",
          ],
        },
        artifact_format: {
          type: "string",
          enum: [
            "markdown",
            "mermaid",
            "quiz",
            "openui",
            "animation",
            "image",
            "json",
            "text",
          ],
        },
        content: {
          type: "string",
          description:
            "Artifact body. Quiz and OpenUI artifacts use their complete JSON source; images use an HTTP(S) or image data URL.",
        },
        front: { type: "string" },
        back: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      (params) => updateCourse(params, options),
      ["action"],
    ),
  ];
}

export function courseCollaborationPrompt(
  course?: KeatingToolsOptions["course"],
): string {
  const active = course?.activeCourseId
    ? `The active course is \`${course.activeCourseId}\`. Use it by default and inspect it before proposing edits.`
    : course?.mode === "create"
      ? "The learner opened chat from the new-course flow. Begin by shaping a course together."
      : "Course tools are available whenever the learner wants to create or revise a course.";
  return `${COURSE_PROMPT_START}
## Course collaboration

${active}

Treat course creation as a conversation, not a one-shot generation task. Establish the intended learners, current level, observable outcomes, pace or time constraints, and which existing plans or artifacts matter. Offer a compact outline and invite corrections before calling course_create, unless the learner explicitly asks you to create immediately. After creation, use course_inspect and make small, agreed changes with course_update so the learner can steer the structure. You can add modules, lessons, quizzes, other artifacts, assignments, and flashcards. Never claim a course changed unless the tool call succeeded, and always return the course link after a successful change.
${COURSE_PROMPT_END}`;
}

export function appendCourseCollaborationPrompt(
  systemPrompt: string,
  course?: KeatingToolsOptions["course"],
): string {
  const start = systemPrompt.indexOf(COURSE_PROMPT_START);
  let base = systemPrompt;
  if (start >= 0) {
    const end = systemPrompt.indexOf(COURSE_PROMPT_END, start);
    base =
      end >= 0
        ? `${systemPrompt.slice(0, start)}${systemPrompt.slice(end + COURSE_PROMPT_END.length)}`
        : systemPrompt.slice(0, start);
  }
  return `${base.trimEnd()}\n\n${courseCollaborationPrompt(course)}`;
}
