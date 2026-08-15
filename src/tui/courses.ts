import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface TuiCourseLesson {
  id: string;
  title: string;
  summary?: string;
  reading?: string;
  estimatedMinutes?: number;
  objectives?: string[];
  exercise?: { prompt: string; placeholder?: string };
}

export interface TuiCourseModule {
  id: string;
  title: string;
  description?: string;
  lessons: TuiCourseLesson[];
}

export interface TuiCourse {
  id: string;
  title: string;
  description?: string;
  modules: TuiCourseModule[];
  source: "local" | "remote";
  updatedAt?: string;
}

export interface TuiCourseSearchResult {
  course: TuiCourse;
  lesson?: TuiCourseLesson;
  score: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeLesson(value: unknown, index: number): TuiCourseLesson | null {
  const item = record(value);
  const title = text(item.title) ?? text(item.name);
  if (!title) return null;
  const id = text(item.id) ?? `lesson-${index + 1}`;
  const exercise = record(item.exercise);
  return {
    id,
    title,
    ...(text(item.summary) ? { summary: text(item.summary) } : {}),
    ...(text(item.reading) ? { reading: text(item.reading) } : {}),
    ...(typeof item.estimatedMinutes === "number" ? { estimatedMinutes: item.estimatedMinutes } : {}),
    ...(stringList(item.objectives).length ? { objectives: stringList(item.objectives) } : {}),
    ...(text(exercise.prompt) ? {
      exercise: {
        prompt: text(exercise.prompt)!,
        ...(text(exercise.placeholder) ? { placeholder: text(exercise.placeholder) } : {}),
      },
    } : {}),
  };
}

function normalizeModule(value: unknown, index: number): TuiCourseModule | null {
  const item = record(value);
  const title = text(item.title) ?? text(item.name);
  if (!title) return null;
  const lessons = Array.isArray(item.lessons)
    ? item.lessons.map(normalizeLesson).filter((lesson): lesson is TuiCourseLesson => lesson !== null)
    : [];
  return {
    id: text(item.id) ?? `module-${index + 1}`,
    title,
    ...(text(item.description) ? { description: text(item.description) } : {}),
    lessons,
  };
}

export function normalizeTuiCourse(value: unknown, source: TuiCourse["source"] = "local"): TuiCourse | null {
  const item = record(value);
  const title = text(item.title) ?? text(item.name);
  const id = text(item.id) ?? text(item.courseId);
  if (!title || !id) return null;
  const modules = Array.isArray(item.modules)
    ? item.modules.map(normalizeModule).filter((module): module is TuiCourseModule => module !== null)
    : [];
  // Some course endpoints return a flat lesson list for compact summaries.
  if (modules.length === 0 && Array.isArray(item.lessons)) {
    modules.push({ id: "module-1", title: "Lessons", lessons: item.lessons.map(normalizeLesson).filter((lesson): lesson is TuiCourseLesson => lesson !== null) });
  }
  return {
    id,
    title,
    ...(text(item.description) ? { description: text(item.description) } : {}),
    modules,
    source,
    ...(text(item.updatedAt) ? { updatedAt: text(item.updatedAt) } : {}),
  };
}

async function localCourseFiles(cwd: string): Promise<string[]> {
  const root = join(cwd, ".keating", "courses");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && /\.(json|json5)$/i.test(entry.name)) files.push(path);
    if (entry.isDirectory()) {
      for (const nested of await readdir(path, { withFileTypes: true }).catch(() => [])) {
        if (nested.isFile() && /\.(json|json5)$/i.test(nested.name)) files.push(join(path, nested.name));
      }
    }
  }
  return files;
}

export async function listLocalTuiCourses(cwd: string): Promise<TuiCourse[]> {
  const courses: TuiCourse[] = [];
  for (const path of await localCourseFiles(cwd)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [record(parsed).course ?? parsed];
      for (const candidate of candidates) {
        const course = normalizeTuiCourse(candidate, "local");
        if (course) courses.push(course);
      }
    } catch {
      // A malformed course should not hide the rest of a user's local courses.
    }
  }
  return courses.sort((left, right) => left.title.localeCompare(right.title));
}

export interface TuiCourseFetchOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
}

/** Optional hosted course read-through. Authentication remains the web app's job. */
export async function listRemoteTuiCourses(options: TuiCourseFetchOptions = {}): Promise<TuiCourse[]> {
  const origin = options.origin ?? process.env.KEATING_COURSES_ORIGIN;
  if (!origin) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(new URL("/api/courses", origin), { headers: { accept: "application/json" } });
    if (!response.ok) return [];
    const body = await response.json() as unknown;
    const values = Array.isArray(body) ? body : record(body).courses;
    if (!Array.isArray(values)) return [];
    return values.map((value) => normalizeTuiCourse(value, "remote")).filter((course): course is TuiCourse => course !== null);
  } catch {
    return [];
  }
}

export async function listTuiCourses(cwd: string, options: TuiCourseFetchOptions = {}): Promise<TuiCourse[]> {
  const local = await listLocalTuiCourses(cwd);
  const remote = await listRemoteTuiCourses(options);
  const byId = new Map<string, TuiCourse>();
  for (const course of [...remote, ...local]) byId.set(course.id, course);
  return [...byId.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function courseLessons(course: TuiCourse): Array<{ module: TuiCourseModule; lesson: TuiCourseLesson }> {
  return course.modules.flatMap((module) => module.lessons.map((lesson) => ({ module, lesson })));
}

export function searchTuiCourses(courses: readonly TuiCourse[], query: string, limit = 25): TuiCourseSearchResult[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return courses.slice(0, limit).map((course) => ({ course, score: 0 }));
  const results: TuiCourseSearchResult[] = [];
  for (const course of courses) {
    const courseText = `${course.title} ${course.description ?? ""}`.toLowerCase();
    const courseMatches = tokens.every((token) => courseText.includes(token));
    if (courseMatches) results.push({ course, score: 100 + (course.title.toLowerCase().startsWith(tokens[0]!) ? 20 : 0) });
    for (const { lesson, module } of courseLessons(course)) {
      const lessonText = `${lesson.title} ${lesson.summary ?? ""} ${lesson.reading ?? ""} ${module.title}`.toLowerCase();
      if (!tokens.every((token) => lessonText.includes(token))) continue;
      results.push({ course, lesson, score: 70 + (lesson.title.toLowerCase().startsWith(tokens[0]!) ? 20 : 0) });
    }
  }
  return results.sort((left, right) => right.score - left.score || left.course.title.localeCompare(right.course.title)).slice(0, limit);
}

export function courseOption(course: TuiCourse, index: number): string {
  const lessons = courseLessons(course).length;
  const source = course.source === "remote" ? "hosted" : "local";
  return `${index + 1}. ${course.title} · ${lessons} lesson${lessons === 1 ? "" : "s"} · ${source}`;
}

export function courseLessonOption(module: TuiCourseModule, lesson: TuiCourseLesson, index: number): string {
  const duration = lesson.estimatedMinutes ? ` · ${lesson.estimatedMinutes}m` : "";
  return `${index + 1}. ${lesson.title} · ${module.title}${duration}`;
}

export function courseMarkdown(course: TuiCourse): string {
  const lines = [`# ${course.title}`, "", course.description ?? "No course description.", ""];
  for (const [moduleIndex, module] of course.modules.entries()) {
    lines.push(`## ${moduleIndex + 1}. ${module.title}`);
    if (module.description) lines.push("", module.description);
    for (const lesson of module.lessons) {
      lines.push("", `### ${lesson.title}`);
      if (lesson.summary) lines.push(lesson.summary);
      if (lesson.objectives?.length) lines.push("", "Objectives:", ...lesson.objectives.map((objective) => `- ${objective}`));
      if (lesson.exercise) lines.push("", `Exercise: ${lesson.exercise.prompt}`);
    }
  }
  return lines.join("\n");
}

export function courseLessonPrompt(course: TuiCourse, lesson: TuiCourseLesson): string {
  return `Continue the course “${course.title}”. Teach lesson “${lesson.title}” Socratically.\n\n${lesson.summary ?? lesson.reading ?? "Begin with a diagnostic question."}`;
}
