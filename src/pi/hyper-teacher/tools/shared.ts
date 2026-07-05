import { renderArtifactPreview } from "../tui-components.js";
import type { Quiz } from "../../../core/quiz.js";
import type { loadLearnerState } from "../../../core/learner-state.js";

let activeCtx: any = null;

export function setActiveCtx(ctx: any): void {
  activeCtx = ctx;
}

export function getCwd(): string {
  return activeCtx?.cwd ?? process.cwd();
}

export interface PendingQuizResult {
  quiz: Quiz;
  answers: Record<string, string>;
  objectiveResults: Record<string, boolean>;
}
export const pendingQuizResults = new Map<string, PendingQuizResult>();

export function feedbackOnlyTopics(state: Awaited<ReturnType<typeof loadLearnerState>>): string[] {
  const covered = new Set(state.coveredTopics.map((topic) => topic.slug));
  return [...new Set(
    state.feedback
      .map((feedback) => feedback.topic.trim())
      .filter((topic) => topic && topic !== "general" && !covered.has(topic))
  )].slice(-10);
}

export const pick = (a: string) => a.toLowerCase().trim();
export const up = "thumbs-up";
export const down = "thumbs-down";
export const confused = "confused";

export function keatingToolMaker(
  name: string,
  label: string,
  description: string,
  parameters: Record<string, unknown>,
  exec: (params: Record<string, unknown>, ctx: any) => Promise<Record<string, unknown>>,
  render?: { result?: (result: any, options: any, theme: any, context: any) => any }
) {
  return {
    name,
    label,
    description,
    parameters: { type: "object" as const, additionalProperties: false, properties: parameters },
    async execute(_toolCallId: string, params: Record<string, unknown>, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
      return exec(params, ctx);
    },
    ...(render?.result ? { renderResult: render.result } : {})
  };
}

/** renderResult factory for artifact tools (plan/map/animate/verify): preview the just-written file from disk. */
export function artifactPreviewRenderer(title: string, pathKey: string) {
  return (result: any, _options: any, theme: any) => {
    const path = result?.details?.[pathKey];
    if (typeof path !== "string" || !path) return undefined;
    return renderArtifactPreview(theme, title, path);
  };
}
