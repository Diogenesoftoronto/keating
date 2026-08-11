import type { FlashcardDeck } from "../keating/flashcard-types";
import { parseOpenUIMessageSegments } from "../keating/openui/segments";
import type { StudyPlanItem } from "../keating/openui/study-plan";
import {
  getInitPromise,
  keatingStorage,
  sessions,
} from "../hooks/keating-storage";
import type { SessionData, SessionMetadata } from "../types/session";
import type {
  Animation,
  BenchmarkResult,
  EvolutionResult,
  LessonMap,
  LessonPlan,
  PromptEvolutionResult,
  Verification,
} from "../keating/storage";
import type { Quiz } from "../keating/core";
import type {
  CourseArtifactInput,
  CourseCreateInput,
  CourseLesson,
  CourseModule,
} from "./contracts";
import { courseFromStudyPlan } from "./from-study-plan";

export interface SavedStudyPlanSource {
  id: string;
  planId: string;
  title: string;
  overview?: string;
  items: StudyPlanItem[];
  sessionId: string;
  sessionTitle: string;
  lastModified: string;
}

function markdownPlanItems(
  content: string,
  fallbackTitle: string,
): StudyPlanItem[] {
  const headings = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  if (!headings.length) {
    return [{ id: "lesson", title: fallbackTitle, detail: content.trim() }];
  }
  return headings.slice(0, 12).map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    return {
      id: `section_${index + 1}`,
      title: heading[1]?.trim() || `Section ${index + 1}`,
      detail: content.slice(start, end).trim(),
    };
  });
}

/** Adapt deterministic lesson-plan artifacts into the same selectable source shape as chat StudyPlans. */
export function studyPlanFromArtifact(plan: LessonPlan): SavedStudyPlanSource {
  return {
    id: `artifact:${plan.id}`,
    planId: `artifact_${plan.id}`,
    title: plan.topic.trim() || "Untitled lesson plan",
    overview: "Saved lesson plan from Keating.",
    items: markdownPlanItems(plan.content, plan.topic.trim() || "Lesson"),
    sessionId: plan.sessionId ?? "saved-artifacts",
    sessionTitle: "Saved lesson plans",
    lastModified: new Date(plan.updatedAt).toISOString(),
  };
}

export interface CourseAssemblySources {
  plans: SavedStudyPlanSource[];
  decks: FlashcardDeck[];
  artifacts: CourseArtifactSource[];
}

export interface CourseArtifactSource extends Omit<
  CourseArtifactInput,
  "id" | "lessonId"
> {
  id: string;
  sourceLabel: string;
  createdAt: number;
}

export interface SelectedStudyPlan {
  source: SavedStudyPlanSource;
  moduleIds?: readonly string[];
}

export interface CourseAssemblyInput {
  title?: string;
  description?: string;
  plans?: readonly SelectedStudyPlan[];
  decks?: readonly FlashcardDeck[];
  artifacts?: readonly CourseArtifactSource[];
}

interface OpenUIElement {
  typeName?: unknown;
  props?: unknown;
}

function messageText(message: unknown): string {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { role?: unknown }).role !== "assistant"
  )
    return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text =
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "";
      const result = (part as { __toolResult?: unknown }).__toolResult;
      const toolText =
        typeof result === "string"
          ? result
          : Array.isArray(result)
            ? result
                .map((item) =>
                  item &&
                  typeof item === "object" &&
                  typeof (item as { text?: unknown }).text === "string"
                    ? (item as { text: string }).text
                    : "",
                )
                .join("\n")
            : "";
      return [text, toolText];
    })
    .filter(Boolean)
    .join("\n");
}

const TAG_PAYLOAD = String.raw`("(?:[^"\\]|\\.)*"|[^>]+)`;
const COURSE_ARTIFACT_TAG = new RegExp(
  String.raw`<keating-(quiz|image)\s+json=${TAG_PAYLOAD}\s*\/>`,
  "g",
);

function taggedJson(payload: string): unknown {
  const parsed = JSON.parse(payload);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

function isQuiz(value: unknown): value is Quiz {
  if (!value || typeof value !== "object") return false;
  const quiz = value as Partial<Quiz>;
  return (
    typeof quiz.topic === "string" &&
    typeof quiz.slug === "string" &&
    Array.isArray(quiz.questions) &&
    quiz.questions.length > 0
  );
}

function chatArtifactsFromText(
  text: string,
  session: Pick<SessionData, "id" | "title" | "lastModified">,
  messageIndex: number,
): CourseArtifactSource[] {
  const artifacts: CourseArtifactSource[] = [];
  COURSE_ARTIFACT_TAG.lastIndex = 0;
  for (const match of text.matchAll(COURSE_ARTIFACT_TAG)) {
    const tag = match[1];
    const payload = match[2];
    if (!tag || !payload) continue;
    try {
      const parsed = taggedJson(payload);
      if (tag === "quiz" && isQuiz(parsed)) {
        artifacts.push({
          id: `chat:${session.id}:quiz:${parsed.slug}`,
          kind: "quiz",
          format: "quiz",
          title: `${parsed.topic} quiz`,
          description: `${parsed.questions.length} interactive question${parsed.questions.length === 1 ? "" : "s"} from chat.`,
          content: JSON.stringify(parsed),
          sourceId: parsed.slug,
          sourceSessionId: session.id,
          sourceLabel: `Chat · ${session.title}`,
          createdAt: Date.parse(session.lastModified),
        });
      }
      if (tag === "image" && parsed && typeof parsed === "object") {
        const image = parsed as {
          title?: unknown;
          alt?: unknown;
          dataUrl?: unknown;
          svg?: unknown;
        };
        const content =
          typeof image.dataUrl === "string"
            ? image.dataUrl
            : typeof image.svg === "string"
              ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`
              : "";
        if (content)
          artifacts.push({
            id: `chat:${session.id}:image:${messageIndex + 1}:${match.index ?? artifacts.length}`,
            kind: "image",
            format: "image",
            title:
              typeof image.title === "string"
                ? image.title
                : "Generated learning image",
            ...(typeof image.alt === "string"
              ? { description: image.alt }
              : {}),
            content,
            sourceSessionId: session.id,
            sourceLabel: `Chat · ${session.title}`,
            createdAt: Date.parse(session.lastModified),
          });
      }
    } catch {
      // Malformed historic tags stay in chat; they do not block other course sources.
    }
  }
  COURSE_ARTIFACT_TAG.lastIndex = 0;
  return artifacts;
}

/** Extract the final saved GenUI documents, legacy quizzes, and generated images from a chat. */
export function courseArtifactsFromSession(
  session: Pick<SessionData, "id" | "title" | "lastModified" | "messages">,
): CourseArtifactSource[] {
  const bySource = new Map<string, CourseArtifactSource>();
  for (const [messageIndex, message] of session.messages.entries()) {
    const text = messageText(message);
    for (const artifact of chatArtifactsFromText(text, session, messageIndex))
      bySource.set(artifact.id, artifact);
    for (const segment of parseOpenUIMessageSegments(text, session.id)) {
      if (
        segment.type !== "openui" ||
        !segment.complete ||
        !segment.program.trim()
      )
        continue;
      const kind = segment.program.includes("Quiz(")
        ? "quiz"
        : segment.program.includes("StudyPlan(")
          ? "lesson-plan"
          : "openui";
      bySource.set(`chat:${session.id}:openui:${segment.metadata.id}`, {
        id: `chat:${session.id}:openui:${segment.metadata.id}`,
        kind,
        format: "openui",
        title: `${session.title} · ${kind === "quiz" ? "interactive quiz" : kind === "lesson-plan" ? "interactive plan" : "generated interaction"}`,
        description: "Saved GenUI surface from Keating chat.",
        content: segment.program,
        sourceId: segment.metadata.id,
        sourceSessionId: session.id,
        sourceLabel: `Chat · ${session.title}`,
        createdAt: Date.parse(session.lastModified),
      });
    }
  }
  return [...bySource.values()];
}

function titled(topic: string | undefined, suffix: string): string {
  return topic?.trim()
    ? `${topic.trim()} ${suffix}`
    : suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

export interface SavedCourseArtifactCollections {
  plans: readonly LessonPlan[];
  maps: readonly LessonMap[];
  animations: readonly Animation[];
  verifications: readonly Verification[];
  benchmarks: readonly BenchmarkResult[];
  evolutions: readonly EvolutionResult[];
  promptEvolutions: readonly PromptEvolutionResult[];
}

/** Turn every learner-authored artifact store into one future-proof course tray. */
export function artifactSourcesFromSavedWork(
  saved: SavedCourseArtifactCollections,
): CourseArtifactSource[] {
  return [
    ...saved.plans.map(
      (plan): CourseArtifactSource => ({
        id: `saved:plan:${plan.id}`,
        kind: plan.metadata?.type === "quiz" ? "quiz" : "lesson-plan",
        format: "markdown",
        title:
          plan.metadata?.type === "quiz"
            ? titled(plan.topic, "quiz")
            : titled(plan.topic, "lesson plan"),
        description:
          plan.metadata?.type === "quiz"
            ? "Saved quiz and answer key."
            : "Saved deterministic lesson plan.",
        content: plan.content,
        sourceId: plan.id,
        ...(plan.sessionId ? { sourceSessionId: plan.sessionId } : {}),
        sourceLabel: "Saved artifacts · Plans",
        createdAt: plan.updatedAt,
      }),
    ),
    ...saved.maps.map(
      (map): CourseArtifactSource => ({
        id: `saved:map:${map.id}`,
        kind: "lesson-map",
        format: "mermaid",
        title: titled(map.topic, "map"),
        description: "Saved concept or lesson map.",
        content: map.mmdContent,
        sourceId: map.id,
        ...(map.sessionId ? { sourceSessionId: map.sessionId } : {}),
        sourceLabel: "Saved artifacts · Maps",
        createdAt: map.createdAt,
      }),
    ),
    ...saved.animations.map(
      (animation): CourseArtifactSource => ({
        id: `saved:animation:${animation.id}`,
        kind: "animation",
        format: "animation",
        title: titled(animation.topic, "animation"),
        description: "Saved narrated or interactive animation.",
        content: JSON.stringify({
          storyboard: animation.storyboard,
          scene: animation.scene,
          manifest: animation.manifest,
          renderer: animation.renderer,
        }),
        sourceId: animation.id,
        ...(animation.sessionId
          ? { sourceSessionId: animation.sessionId }
          : {}),
        sourceLabel: "Saved artifacts · Animations",
        createdAt: animation.createdAt,
      }),
    ),
    ...saved.verifications.map(
      (verification): CourseArtifactSource => ({
        id: `saved:verification:${verification.id}`,
        kind: "verification",
        format: "markdown",
        title: titled(verification.topic, "verification"),
        description: "Saved verification checklist.",
        content: verification.checklist,
        sourceId: verification.id,
        ...(verification.sessionId
          ? { sourceSessionId: verification.sessionId }
          : {}),
        sourceLabel: "Saved artifacts · Verifications",
        createdAt: verification.createdAt,
      }),
    ),
    ...saved.benchmarks.map(
      (benchmark): CourseArtifactSource => ({
        id: `saved:benchmark:${benchmark.id}`,
        kind: "benchmark",
        format: "markdown",
        title: titled(benchmark.topic, "benchmark"),
        description: `Saved teaching benchmark · score ${benchmark.score.toFixed(1)}.`,
        content: benchmark.trace
          ? `${benchmark.report}\n\n## Trace\n\n\`\`\`text\n${benchmark.trace}\n\`\`\``
          : benchmark.report,
        sourceId: benchmark.id,
        ...(benchmark.sessionId
          ? { sourceSessionId: benchmark.sessionId }
          : {}),
        sourceLabel: "Saved artifacts · Benchmarks",
        createdAt: benchmark.createdAt,
      }),
    ),
    ...saved.evolutions.map(
      (evolution): CourseArtifactSource => ({
        id: `saved:evolution:${evolution.id}`,
        kind: "evolution",
        format: "markdown",
        title: titled(evolution.topic, "policy evolution"),
        description: `Saved policy evolution · best score ${evolution.bestScore.toFixed(1)}.`,
        content: `${evolution.report}\n\n## Selected policy\n\n\`\`\`json\n${evolution.policy}\n\`\`\``,
        sourceId: evolution.id,
        ...(evolution.sessionId
          ? { sourceSessionId: evolution.sessionId }
          : {}),
        sourceLabel: "Saved artifacts · Evolutions",
        createdAt: evolution.createdAt,
      }),
    ),
    ...saved.promptEvolutions.map(
      (evolution): CourseArtifactSource => ({
        id: `saved:prompt-evolution:${evolution.id}`,
        kind: "prompt-evolution",
        format: "markdown",
        title: `${evolution.promptName} prompt evolution`,
        description: `Saved prompt evolution · best score ${evolution.bestScore.toFixed(1)}.`,
        content: `${evolution.report}\n\n## Evolved prompt\n\n\`\`\`text\n${evolution.bestPrompt}\n\`\`\``,
        sourceId: evolution.id,
        ...(evolution.sessionId
          ? { sourceSessionId: evolution.sessionId }
          : {}),
        sourceLabel: "Saved artifacts · Prompt evolutions",
        createdAt: evolution.createdAt,
      }),
    ),
  ].sort((left, right) => right.createdAt - left.createdAt);
}

function collectStudyPlans(value: unknown, result: OpenUIElement[]): void {
  if (!value || typeof value !== "object") return;
  const element = value as OpenUIElement;
  if (element.typeName === "StudyPlan") result.push(element);
  if (Array.isArray(value)) {
    for (const item of value) collectStudyPlans(item, result);
    return;
  }
  for (const child of Object.values(value)) collectStudyPlans(child, result);
}

function asStudyPlanSource(
  element: OpenUIElement,
  session: Pick<SessionData, "id" | "title" | "lastModified">,
): SavedStudyPlanSource | null {
  if (!element.props || typeof element.props !== "object") return null;
  const props = element.props as {
    id?: unknown;
    title?: unknown;
    overview?: unknown;
    items?: unknown;
  };
  if (
    typeof props.id !== "string" ||
    typeof props.title !== "string" ||
    !Array.isArray(props.items)
  )
    return null;
  return {
    id: `${session.id}:${props.id}`,
    planId: props.id,
    title: props.title,
    ...(typeof props.overview === "string" ? { overview: props.overview } : {}),
    items: props.items as StudyPlanItem[],
    sessionId: session.id,
    sessionTitle: session.title,
    lastModified: session.lastModified,
  };
}

/** Extract the final version of each StudyPlan authored in a saved chat. */
export async function studyPlansFromSession(
  session: Pick<SessionData, "id" | "title" | "lastModified" | "messages">,
): Promise<SavedStudyPlanSource[]> {
  const [{ createParser }, { keatingOpenUILibrary }] = await Promise.all([
    import("@openuidev/react-lang"),
    import("../keating/openui/library"),
  ]);
  const parser = createParser(keatingOpenUILibrary.toJSONSchema());
  const plans = new Map<string, SavedStudyPlanSource>();

  for (const message of session.messages) {
    const text = messageText(message);
    if (!text.includes("StudyPlan(")) continue;
    for (const segment of parseOpenUIMessageSegments(text, session.id)) {
      if (
        segment.type !== "openui" ||
        !segment.complete ||
        !segment.program.includes("StudyPlan(")
      )
        continue;
      try {
        const parsed = parser.parse(segment.program);
        if (parsed.meta.errors.length > 0 || parsed.meta.unresolved.length > 0)
          continue;
        const elements: OpenUIElement[] = [];
        collectStudyPlans(parsed.root, elements);
        for (const element of elements) {
          const source = asStudyPlanSource(element, session);
          if (source) plans.set(source.planId, source);
        }
      } catch {
        // A malformed historic assistant message should not make course creation unavailable.
      }
    }
  }
  return [...plans.values()];
}

/** Load learner-owned plans and decks that can be assembled into a course. */
export async function loadCourseAssemblySources(): Promise<CourseAssemblySources> {
  await getInitPromise();
  const [
    metadata,
    decks,
    plans,
    maps,
    animations,
    verifications,
    benchmarks,
    evolutions,
    promptEvolutions,
  ] = await Promise.all([
    sessions.getAllMetadata() as Promise<SessionMetadata[]>,
    keatingStorage.getDecks(),
    keatingStorage.getLessonPlans(),
    keatingStorage.getLessonMaps(),
    keatingStorage.getAnimations(),
    keatingStorage.getVerifications(),
    keatingStorage.getBenchmarks(),
    keatingStorage.getEvolutions(),
    keatingStorage.getPromptEvolutions(),
  ]);
  const candidates = metadata
    .filter((entry) => !entry.hiddenAlternative)
    .filter(
      (entry) =>
        entry.searchText === undefined ||
        entry.searchText.includes("StudyPlan(") ||
        entry.searchText.includes("```openui") ||
        entry.searchText.includes("<keating-quiz") ||
        entry.searchText.includes("<keating-image"),
    )
    .sort((left, right) => right.lastModified.localeCompare(left.lastModified));
  const loaded = await Promise.all(
    candidates.map(
      (entry) => sessions.loadSession(entry.id) as Promise<SessionData | null>,
    ),
  );
  const savedSessions = loaded.filter((session): session is SessionData =>
    Boolean(session),
  );
  const chatPlans = (
    await Promise.all(savedSessions.map(studyPlansFromSession))
  ).flat();
  const artifactPlans = plans
    .filter((plan) => plan.metadata?.type !== "quiz")
    .map(studyPlanFromArtifact)
    .sort((left, right) => right.lastModified.localeCompare(left.lastModified));
  return {
    plans: [...chatPlans, ...artifactPlans],
    decks: [...decks].sort((left, right) => right.updatedAt - left.updatedAt),
    artifacts: [
      ...savedSessions.flatMap(courseArtifactsFromSession),
      ...artifactSourcesFromSavedWork({
        plans,
        maps,
        animations,
        verifications,
        benchmarks,
        evolutions,
        promptEvolutions,
      }),
    ].sort((left, right) => right.createdAt - left.createdAt),
  };
}

export async function loadCourseArtifactSources(): Promise<
  CourseArtifactSource[]
> {
  return (await loadCourseAssemblySources()).artifacts;
}

export function safeCourseId(
  prefix: string,
  parts: readonly (string | number)[],
): string {
  const slug = parts
    .join("_")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, Math.max(2, 95 - prefix.length));
  return `${prefix}_${slug || "item"}`.slice(0, 96);
}

function remapLesson(
  lesson: CourseLesson,
  planIndex: number,
  moduleIndex: number,
  lessonIndex: number,
): CourseLesson {
  const id = safeCourseId("lesson", [
    planIndex + 1,
    moduleIndex + 1,
    lessonIndex + 1,
    lesson.title,
  ]);
  return {
    ...lesson,
    id,
    materialIds: [],
    cardIds: [],
    ...(lesson.exercise
      ? {
          exercise: {
            ...lesson.exercise,
            id: safeCourseId("exercise", [
              planIndex + 1,
              moduleIndex + 1,
              lessonIndex + 1,
            ]),
          },
        }
      : {}),
  };
}

function selectedModules(
  selection: SelectedStudyPlan,
  planIndex: number,
): CourseModule[] {
  const selected = selection.moduleIds ? new Set(selection.moduleIds) : null;
  const source = selected
    ? {
        ...selection.source,
        items: selection.source.items.filter((item) => selected.has(item.id)),
      }
    : selection.source;
  return courseFromStudyPlan(source).modules.map((module, moduleIndex) => ({
    ...module,
    id: safeCourseId("module", [planIndex + 1, moduleIndex + 1, module.title]),
    lessons: module.lessons.map((lesson, lessonIndex) =>
      remapLesson(lesson, planIndex, moduleIndex, lessonIndex),
    ),
  }));
}

function unique(values: readonly string[], maximum: number): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, maximum);
}

/** Produce one valid course payload from any mix of blank, chat-plan, and deck sources. */
export function assembleCourseInput(
  input: CourseAssemblyInput,
): CourseCreateInput {
  const plans = input.plans ?? [];
  const decks = input.decks ?? [];
  const artifactSources = input.artifacts ?? [];
  const oversizedArtifact = artifactSources.find(
    (artifact) => artifact.content.length > 8_000_000,
  );
  if (oversizedArtifact) {
    throw new Error(
      `“${oversizedArtifact.title}” is too large to copy into a new course. Create the course first, then add it as a document or image upload.`,
    );
  }
  const modules = plans.flatMap(selectedModules).slice(0, 48);
  const outcomes = unique(
    plans.flatMap(({ source }) => courseFromStudyPlan(source).outcomes),
    24,
  );
  const cards = decks
    .flatMap((deck, deckIndex) =>
      deck.cards.map((card, cardIndex) => ({
        id: safeCourseId("card", [deckIndex + 1, cardIndex + 1, card.id]),
        front: card.front.slice(0, 10_000),
        back: card.back.slice(0, 20_000),
        tags: unique(card.tags ?? [], 24).map((tag) => tag.slice(0, 64)),
      })),
    )
    .slice(0, 10_000);
  const artifacts = artifactSources.slice(0, 1_000).map(
    (artifact, artifactIndex): CourseArtifactInput => ({
      id: safeCourseId("artifact", [
        artifactIndex + 1,
        artifact.kind,
        artifact.sourceId ?? artifact.id,
      ]),
      kind: artifact.kind,
      format: artifact.format,
      title: artifact.title.slice(0, 240),
      ...(artifact.description
        ? { description: artifact.description.slice(0, 2_000) }
        : {}),
      content: artifact.content,
      ...(artifact.sourceId ? { sourceId: artifact.sourceId } : {}),
      ...(artifact.sourceSessionId
        ? { sourceSessionId: artifact.sourceSessionId }
        : {}),
    }),
  );
  const firstPlan = plans[0]?.source;
  return {
    title:
      input.title?.trim().slice(0, 240) ||
      firstPlan?.title.slice(0, 240) ||
      "Untitled course",
    description:
      input.description?.trim().slice(0, 4_000) ||
      firstPlan?.overview?.slice(0, 4_000) ||
      "A course ready to assemble.",
    outcomes,
    modules,
    cards,
    artifacts,
    assignments: [],
    settings: {
      teacherAccessPolicy: "request",
      allowPeerDeckEdits: true,
      allowPeerComments: true,
    },
  };
}
