import { readFileSync } from "node:fs";
import { toolResultToUiDocument } from "../tui/ui/adapter.js";
import { uiDocumentPresentation } from "../tui/ui/render.js";

/**
 * Theme-free card renderers shared by RPC hosts (keating tui, e2e tests).
 * The classic Pi shell keeps its themed equivalents in
 * src/pi/hyper-teacher/tui-components.ts; these emit plain strings so they
 * survive JSON transport and render in any terminal without pi-tui.
 *
 * Tool results that cross the RPC boundary are JSON-serialized, so Maps
 * (e.g. quiz.answerKey) arrive as plain objects or empty objects — every
 * accessor here tolerates both.
 */

const DEFAULT_CARD_WIDTH = 76;

function wrapPlain(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= width) {
      lines.push(raw);
      continue;
    }
    let rest = raw;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }
  return lines;
}

function padPlain(text: string, width: number): string {
  if (text.length > width) return width > 1 ? `${text.slice(0, width - 1)}…` : text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

export function cardLines(heading: string, body: string[], width = DEFAULT_CARD_WIDTH): string[] {
  const cardWidth = Math.max(20, width);
  const innerWidth = cardWidth - 4;
  const lines: string[] = [];
  lines.push(`╭${"─".repeat(cardWidth - 2)}╮`);
  lines.push(`│ ${padPlain(heading, innerWidth)} │`);
  lines.push(`├${"─".repeat(cardWidth - 2)}┤`);
  for (const raw of body) {
    const wrapped = raw.length === 0 ? [""] : wrapPlain(raw, innerWidth);
    for (const line of wrapped) {
      lines.push(`│ ${padPlain(line, innerWidth)} │`);
    }
  }
  lines.push(`╰${"─".repeat(cardWidth - 2)}╯`);
  return lines;
}

export function artifactPreviewLines(title: string, filePath: string, maxLines = 40): string[] {
  let body: string[];
  try {
    const raw = readFileSync(filePath, "utf8");
    const allLines = raw.split("\n");
    body = allLines.slice(0, maxLines);
    if (allLines.length > maxLines) {
      body.push("", `… ${allLines.length - maxLines} more lines (see ${filePath})`);
    }
  } catch {
    body = [`(could not read ${filePath})`];
  }
  return cardLines(title, body);
}

/** Read `map.get(key)` whether `map` is a Map or a JSON-deserialized plain object. */
function lookup<T>(map: unknown, key: string): T | undefined {
  if (map instanceof Map) return map.get(key) as T | undefined;
  if (map && typeof map === "object") return (map as Record<string, T>)[key];
  return undefined;
}

interface QuizQuestionish {
  id: string;
  level?: string;
  type?: string;
  question: string;
}

interface Quizish {
  topic: string;
  questions: QuizQuestionish[];
}

export interface QuizCardStateish {
  answers?: unknown;
  objectiveResults?: unknown;
  openEndedGrades?: unknown;
}

const QUESTION_GLYPH = {
  unanswered: "○",
  answered: "●",
  correct: "✓",
  incorrect: "✗",
  pending_grade: "…",
} as const;

function questionStatus(q: QuizQuestionish, state: QuizCardStateish): keyof typeof QUESTION_GLYPH {
  const graded = lookup<{ verdict?: string }>(state.openEndedGrades, q.id);
  if (graded?.verdict) {
    if (graded.verdict === "correct") return "correct";
    if (graded.verdict === "incorrect") return "incorrect";
    return "answered";
  }
  const objective = lookup<boolean>(state.objectiveResults, q.id);
  if (objective !== undefined) return objective ? "correct" : "incorrect";
  const answer = lookup<string>(state.answers, q.id);
  const isOpenEnded = q.type === "short_answer" || q.type === "transfer";
  if (isOpenEnded && answer !== undefined) return "pending_grade";
  return answer !== undefined ? "answered" : "unanswered";
}

export function quizCardLines(quiz: Quizish, state: QuizCardStateish = {}): string[] {
  const body: string[] = [];
  let correct = 0;
  let graded = 0;
  for (const q of quiz.questions ?? []) {
    const status = questionStatus(q, state);
    if (status === "correct") correct++;
    if (status === "correct" || status === "incorrect") graded++;
    body.push(`${QUESTION_GLYPH[status]} ${q.level ? `[${q.level}] ` : ""}${q.question}`);
    const answer = lookup<string>(state.answers, q.id);
    if (answer) body.push(`   your answer: ${answer}`);
    const note = lookup<{ note?: string }>(state.openEndedGrades, q.id)?.note;
    if (note) body.push(`   feedback: ${note}`);
  }
  if (graded > 0) body.unshift(`Score: ${correct}/${graded}`, "");
  return cardLines(`Quiz: ${quiz.topic}`, body);
}

interface GoalStepish {
  order: number;
  title: string;
  kind?: string;
  status: string;
}

interface Goalish {
  title: string;
  description?: string;
  status: string;
  steps: GoalStepish[];
  id?: string;
}

const GOAL_STEP_GLYPH: Record<string, string> = {
  not_started: "[ ]",
  in_progress: "[~]",
  done: "[x]",
};

export function goalCardLines(goal: Goalish): string[] {
  return cardLines(`Goal: ${goal.title}`, goalCardBodyLines(goal));
}

/** Shared goal-card content; callers choose plain or themed progress rendering. */
export function goalCardBodyLines(
  goal: Goalish,
  formatProgress: (percent: number) => string = (percent) => `${percent}%`,
): string[] {
  const total = goal.steps?.length ?? 0;
  const done = (goal.steps ?? []).filter((s) => s.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const nextStep = (goal.steps ?? []).find((s) => s.status !== "done");

  const body: string[] = [];
  if (goal.description) body.push(goal.description, "");
  body.push(`Progress: ${formatProgress(percent)} (${done}/${total})`, `Status: ${goal.status}`);
  if (nextStep) body.push(`Next: ${nextStep.title}`);
  body.push("");
  for (const step of goal.steps ?? []) {
    body.push(`${GOAL_STEP_GLYPH[step.status] ?? "[ ]"} ${step.order + 1}. ${step.title}${step.kind ? ` (${step.kind})` : ""}`);
  }
  return body;
}

export function goalListCardLines(goals: Goalish[]): string[] {
  if (!goals || goals.length === 0) return cardLines("Learner Goals", ["No goals yet."]);
  const body = goals.map((g) => {
    const total = g.steps?.length ?? 0;
    const done = (g.steps ?? []).filter((s) => s.status === "done").length;
    return `${g.status === "completed" ? "✓" : "•"} ${g.id ? `[${g.id}] ` : ""}${g.title} — ${done}/${total} steps (${g.status})`;
  });
  return cardLines("Learner Goals", body);
}

const ARTIFACT_TOOL_CARDS: Record<string, { title: string; pathKey: string }> = {
  plan: { title: "Lesson Plan", pathKey: "planPath" },
  map: { title: "Concept Map", pathKey: "mmdPath" },
  verify: { title: "Verification Checklist", pathKey: "checklistPath" },
  animate: { title: "Animation Storyboard", pathKey: "storyboardPath" },
};

/**
 * Map a finished tool execution to card lines. Returns undefined when the
 * tool has no card representation (callers fall back to plain text).
 */
export function toolResultCardLines(toolName: string, result: unknown): string[] | undefined {
  const direct = result as { protocol?: unknown } | undefined;
  if (direct?.protocol === "keating.ui") {
    const presentation = uiDocumentPresentation(toolResultToUiDocument(toolName, result));
    return cardLines(presentation.heading, presentation.body);
  }
  const details = (result as { details?: Record<string, unknown> } | undefined)?.details;
  if (!details) return undefined;

  if ((toolName === "quiz" || toolName === "grade_quiz") && details.quiz) {
    return quizCardLines(details.quiz as Quizish, {
      answers: details.answers,
      objectiveResults: details.objectiveResults,
      openEndedGrades: details.openEndedGrades,
    });
  }

  const artifact = ARTIFACT_TOOL_CARDS[toolName];
  if (artifact) {
    const path = details[artifact.pathKey];
    if (typeof path === "string") return artifactPreviewLines(artifact.title, path);
  }

  if (details.goal && typeof details.goal === "object") {
    return goalCardLines(details.goal as Goalish);
  }
  if (Array.isArray(details.goals)) {
    return goalListCardLines(details.goals as Goalish[]);
  }

  if (toolName === "web_search" && Array.isArray(details.citations)) {
    const citations = details.citations as Array<{ title?: string; url?: string }>;
    const body = citations.map((c, i) => `${i + 1}. ${c.title ?? c.url ?? ""}${c.title && c.url ? ` — ${c.url}` : ""}`);
    const query = typeof details.query === "string" ? details.query : "";
    return cardLines(`Web Search: ${query}`, body.length > 0 ? body : ["(no sources)"]);
  }

  const presentation = uiDocumentPresentation(toolResultToUiDocument(toolName, result));
  return cardLines(presentation.heading, presentation.body);
}

/** A card as Markdown: the heading becomes the transcript entry's title. */
export interface MarkdownCard {
  heading: string;
  body: string[];
}

function previewBody(filePath: string, fence?: string, maxLines = 40): string[] {
  let lines: string[];
  try {
    lines = readFileSync(filePath, "utf8").replace(/\s+$/, "").split("\n");
  } catch {
    return [`*Could not read ${filePath}.*`];
  }
  const shown = lines.slice(0, maxLines);
  const more = lines.length > maxLines ? [`*${lines.length - maxLines} more lines in ${filePath}*`] : [`*${filePath}*`];
  return [...(fence ? [`\`\`\`${fence}`, ...shown, "```"] : shown), "", ...more];
}

export function quizCardMarkdown(quiz: Quizish, state: QuizCardStateish = {}): MarkdownCard {
  const body: string[] = [];
  let correct = 0;
  let graded = 0;
  for (const [index, q] of (quiz.questions ?? []).entries()) {
    const status = questionStatus(q, state);
    if (status === "correct") correct++;
    if (status === "correct" || status === "incorrect") graded++;
    body.push(`${index + 1}. ${QUESTION_GLYPH[status]} ${q.question}${q.level ? `  *${q.level}*` : ""}`);
    const answer = lookup<string>(state.answers, q.id);
    if (answer) body.push(`   → ${answer}`);
    const note = lookup<{ note?: string }>(state.openEndedGrades, q.id)?.note;
    if (note) body.push(`   *${note}*`);
  }
  if (graded > 0) body.unshift(`**${correct} of ${graded} correct**`, "");
  return { heading: `Quiz: ${quiz.topic}`, body };
}

export function goalCardMarkdown(goal: Goalish): MarkdownCard {
  const steps = goal.steps ?? [];
  const done = steps.filter((s) => s.status === "done").length;
  const next = steps.find((s) => s.status !== "done");
  const facts = [`${done} of ${steps.length} steps`, goal.status !== "active" ? goal.status : "", next ? `next: ${next.title}` : ""]
    .filter(Boolean).join(" · ");
  return {
    heading: `Goal: ${goal.title}`,
    body: [
      ...(goal.description ? [goal.description, ""] : []),
      `*${facts}*`,
      ...steps.map((step) => `${step.status === "done" ? "- [x]" : "- [ ]"} ${step.title}${step.status === "in_progress" ? "  *in progress*" : ""}`),
    ],
  };
}

/**
 * Map a finished tool execution to a Markdown card for the terminal
 * transcript. Returns undefined when the tool has no card representation.
 */
export function toolResultCard(toolName: string, result: unknown): MarkdownCard | undefined {
  const direct = result as { protocol?: unknown } | undefined;
  if (direct?.protocol === "keating.ui") return uiDocumentPresentation(toolResultToUiDocument(toolName, result));
  const details = (result as { details?: Record<string, unknown> } | undefined)?.details;
  if (!details) return undefined;

  if ((toolName === "quiz" || toolName === "grade_quiz") && details.quiz) {
    return quizCardMarkdown(details.quiz as Quizish, {
      answers: details.answers,
      objectiveResults: details.objectiveResults,
      openEndedGrades: details.openEndedGrades,
    });
  }

  const artifact = ARTIFACT_TOOL_CARDS[toolName];
  if (artifact) {
    const path = details[artifact.pathKey];
    if (typeof path === "string") return { heading: artifact.title, body: previewBody(path, toolName === "map" ? "mermaid" : undefined) };
  }

  if (details.goal && typeof details.goal === "object") return goalCardMarkdown(details.goal as Goalish);
  if (Array.isArray(details.goals)) {
    const goals = details.goals as Goalish[];
    return {
      heading: "Goals",
      body: goals.length === 0 ? ["*No goals yet.*"] : goals.map((g) => {
        const steps = g.steps ?? [];
        const done = steps.filter((s) => s.status === "done").length;
        return `${g.status === "completed" ? "- [x]" : "- [ ]"} ${g.title}  *${done}/${steps.length}${g.status === "paused" ? " · paused" : ""}*`;
      }),
    };
  }

  if (toolName === "web_search" && Array.isArray(details.citations)) {
    const citations = details.citations as Array<{ title?: string; url?: string }>;
    const query = typeof details.query === "string" ? details.query : "";
    return {
      heading: query ? `Search: ${query}` : "Search",
      body: citations.length === 0
        ? ["*No sources found.*"]
        : citations.flatMap((c, i) => [`${i + 1}. ${c.title ?? c.url ?? ""}`, ...(c.title && c.url ? [`   <${c.url}>`] : [])]),
    };
  }

  return uiDocumentPresentation(toolResultToUiDocument(toolName, result));
}
