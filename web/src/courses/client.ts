import type {
  CourseCreateInput,
  CourseListItem,
  CourseMaterial,
  CourseOperation,
  CourseRole,
  CourseViewerSnapshot,
} from "./contracts";

export class CourseApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentRevision?: number,
  ) {
    super(message);
  }
}

async function courseJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/courses${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  return courseResponse<T>(response);
}

async function courseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.statusMessage ??
      body?.message ??
      body?.error?.message ??
      `Course request failed (${response.status})`;
    throw new CourseApiError(
      message,
      response.status,
      body?.data?.code,
      body?.data?.currentRevision,
    );
  }
  return body as T;
}

export async function listCourses(): Promise<CourseListItem[]> {
  return (await courseJson<{ courses: CourseListItem[] }>("")).courses;
}

export function getCourse(courseId: string): Promise<CourseViewerSnapshot> {
  return courseJson(`/${encodeURIComponent(courseId)}`);
}

export function createCourse(
  input: CourseCreateInput & { displayName?: string },
): Promise<CourseViewerSnapshot> {
  return courseJson("", { method: "POST", body: JSON.stringify(input) });
}

export function applyCourseOperation(operation: CourseOperation): Promise<{
  snapshot: CourseViewerSnapshot;
  applied: boolean;
}> {
  return courseJson(`/${encodeURIComponent(operation.courseId)}/operations`, {
    method: "POST",
    body: JSON.stringify(operation),
  });
}

export function createCourseInvite(
  courseId: string,
  input: {
    role: Exclude<CourseRole, "owner">;
    expiresInHours?: number;
    maxUses?: number;
  },
): Promise<{
  invite: { id: string; expiresAt: string; role: string };
  token: string;
}> {
  return courseJson(`/${encodeURIComponent(courseId)}/invites`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinCourse(
  token: string,
  displayName?: string,
  acceptTeacherAccess = false,
): Promise<CourseViewerSnapshot> {
  return courseJson(`/join/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify({ displayName, acceptTeacherAccess }),
  });
}

export function newCourseOperationId(): string {
  return `op_${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function uploadCourseMaterial(
  courseId: string,
  file: File,
  input: { title?: string; lessonId?: string } = {},
): Promise<CourseViewerSnapshot> {
  const form = new FormData();
  form.set("file", file);
  if (input.title?.trim()) form.set("title", input.title.trim());
  if (input.lessonId) form.set("lessonId", input.lessonId);
  return courseResponse(
    await fetch(`/api/courses/${encodeURIComponent(courseId)}/materials`, {
      method: "POST",
      body: form,
    }),
  );
}

export function updateCourseMaterial(
  courseId: string,
  material: Pick<CourseMaterial, "id" | "title" | "description" | "lessonId">,
): Promise<CourseViewerSnapshot> {
  return courseJson(
    `/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(material.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: material.title,
        description: material.description ?? null,
        lessonId: material.lessonId ?? null,
      }),
    },
  );
}

export function deleteCourseMaterial(
  courseId: string,
  materialId: string,
): Promise<CourseViewerSnapshot> {
  return courseJson(
    `/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`,
    { method: "DELETE" },
  );
}

export function courseMaterialUrl(
  courseId: string,
  materialId: string,
): string {
  return `/api/courses/${encodeURIComponent(courseId)}/materials/${encodeURIComponent(materialId)}`;
}

export const starterCourse: CourseCreateInput = {
  title: "Causal Inference",
  description:
    "A worked path from potential outcomes to credible identification.",
  outcomes: [
    "Distinguish intervention from observation",
    "Draw and critique causal diagrams",
    "Choose defensible identification strategies",
  ],
  modules: [
    {
      id: "module_foundations",
      title: "Foundations",
      description: "The language and logic of causal questions.",
      lessons: [
        {
          id: "lesson_correlation",
          title: "Correlation to intervention",
          summary: "Separate patterns we observe from changes we cause.",
          estimatedMinutes: 35,
          objectives: [
            "Name the estimand",
            "Generate non-causal explanations",
            "State the intervention",
          ],
          reading:
            "A correlation is a pattern in observed data. A causal claim asks what would change under an intervention. The hard part is that we cannot observe the same unit both treated and untreated at the same moment. Causal inference therefore combines a precise counterfactual question with assumptions that connect observed groups to the comparison we wish we could see.\n\nStart by naming the intervention, the outcome, the population, and the time horizon. Then ask which common causes, selection mechanisms, or measurement choices could produce the same observed association.",
          materialIds: [],
          cardIds: [],
          exercise: {
            id: "exercise_alternatives",
            prompt:
              "A city finds that neighborhoods with more bike lanes have healthier residents. Give two non-causal explanations, then describe one intervention that would sharpen the question.",
            placeholder:
              "Work through common causes, selection, and the intervention…",
            rubric: [
              "Names two distinct alternatives",
              "Defines an intervention",
              "States the outcome and time horizon",
            ],
          },
        },
        {
          id: "lesson_potential_outcomes",
          title: "Potential outcomes",
          summary:
            "Write causal effects as comparisons between counterfactual outcomes.",
          estimatedMinutes: 45,
          objectives: [
            "Define individual and average effects",
            "Explain the fundamental problem",
          ],
          reading:
            "Potential outcomes make the missing comparison explicit. Each unit has an outcome under treatment and an outcome under control, but we observe only one. Designs and assumptions determine how well other observations stand in for the missing counterfactual.",
          materialIds: [],
          cardIds: [],
        },
      ],
    },
    {
      id: "module_identification",
      title: "Identification",
      description: "Turn assumptions into defensible comparisons.",
      lessons: [
        {
          id: "lesson_dags",
          title: "Causal diagrams",
          summary: "Use graphs to make confounding assumptions visible.",
          estimatedMinutes: 50,
          objectives: ["Recognize confounders, mediators, and colliders"],
          reading:
            "A causal diagram is a compact statement of assumptions. It helps distinguish variables that should be adjusted for from variables that create bias when conditioned upon.",
          materialIds: [],
          cardIds: [],
        },
      ],
    },
  ],
  cards: [],
  artifacts: [],
  assignments: [],
  settings: {
    teacherAccessPolicy: "request",
    allowPeerDeckEdits: true,
    allowPeerComments: true,
  },
};
