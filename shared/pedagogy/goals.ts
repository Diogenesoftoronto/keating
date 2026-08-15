import type { TopicDefinition } from "./types.js";

export type GoalStepKind = "concept" | "practice" | "project" | "milestone" | "reflection";
export type GoalStepStatus = "not_started" | "in_progress" | "done";
export type GoalStatus = "active" | "completed" | "paused";

export interface GoalStep {
  id: string;
  order: number;
  title: string;
  description: string;
  kind: GoalStepKind;
  topic?: string;
  successCriteria: string[];
  status: GoalStepStatus;
  completedAt?: string;
}

export interface LearnerGoal {
  id: string;
  title: string;
  description: string;
  motivation?: string;
  targetDate?: string;
  status: GoalStatus;
  steps: GoalStep[];
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
}

export interface GoalStepInput {
  title: string;
  description?: string;
  kind?: GoalStepKind;
  topic?: string;
  successCriteria?: string[];
}

export interface GoalInput {
  title: string;
  description?: string;
  motivation?: string;
  targetDate?: string;
  steps?: GoalStepInput[];
  topic?: string;
}

export interface GoalProgress {
  done: number;
  inProgress: number;
  total: number;
  percent: number;
  nextStep?: GoalStep;
}

export type TopicResolver = (topic: string) => TopicDefinition;

const STEP_KINDS: GoalStepKind[] = ["concept", "practice", "project", "milestone", "reflection"];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKind(value: unknown): GoalStepKind {
  return typeof value === "string" && (STEP_KINDS as string[]).includes(value)
    ? (value as GoalStepKind)
    : "concept";
}

function scaffoldSteps(goalTitle: string, anchorTopic: string, resolveTopic: TopicResolver): GoalStepInput[] {
  const topic = resolveTopic(anchorTopic || goalTitle);
  const bridge = topic.interdisciplinaryHooks[0];
  return [
    {
      title: `Foundations of ${topic.title}`,
      description: `Build the vocabulary and intuition behind ${topic.title}${
        topic.prerequisites.length ? `, shoring up prerequisites (${topic.prerequisites.slice(0, 3).join(", ")})` : ""
      }.`,
      kind: "concept",
      topic: topic.title,
      successCriteria: [
        `Explain ${topic.title} in your own words`,
        ...topic.misconceptions.slice(0, 1).map((misconception) => `Avoid the misconception: ${misconception}`),
      ],
    },
    {
      title: `Work through ${topic.title} in practice`,
      description: `Solve concrete examples and exercises so ${topic.title} becomes usable, not just familiar.`,
      kind: "practice",
      topic: topic.title,
      successCriteria: [
        "Complete several worked examples with reasoning shown",
        "Score 70%+ on a timed quiz for this step",
      ],
    },
    {
      title: `Build toward: ${goalTitle}`,
      description: `Apply ${topic.title} directly to a deliverable that advances "${goalTitle}".`,
      kind: "project",
      topic: topic.title,
      successCriteria: [
        `Produce a concrete artifact that moves "${goalTitle}" forward`,
        "Identify what worked and what to improve next",
      ],
    },
    {
      title: "Teach-back & reflect",
      description: `Explain what you built and how ${topic.title}${bridge ? ` connects to ${bridge}` : ""} to consolidate transfer.`,
      kind: "reflection",
      topic: topic.title,
      successCriteria: [
        "Teach the concept to someone (or rubber-duck it)",
        "Name one open question to pursue next",
      ],
    },
  ];
}

export function buildGoalWithTopicResolver(input: GoalInput, resolveTopic: TopicResolver): LearnerGoal {
  const title = input.title.trim();
  const id = makeId("goal");
  const now = Date.now();
  const rawSteps = input.steps && input.steps.length > 0
    ? input.steps
    : scaffoldSteps(title, input.topic ?? title, resolveTopic);

  const steps: GoalStep[] = rawSteps
    .filter((step) => step && typeof step.title === "string" && step.title.trim().length > 0)
    .map((step, index) => ({
      id: makeId(`step${index + 1}`),
      order: index,
      title: step.title.trim(),
      description: (step.description ?? "").trim(),
      kind: normalizeKind(step.kind),
      topic: step.topic?.trim() || undefined,
      successCriteria: Array.isArray(step.successCriteria)
        ? step.successCriteria.filter((criterion): criterion is string => typeof criterion === "string" && criterion.trim().length > 0)
        : [],
      status: "not_started",
    }));

  return {
    id,
    title,
    description: (input.description ?? "").trim(),
    motivation: input.motivation?.trim() || undefined,
    targetDate: input.targetDate?.trim() || undefined,
    status: "active",
    steps,
    createdAt: now,
    updatedAt: now,
  };
}

export function computeGoalProgress(goal: LearnerGoal): GoalProgress {
  const total = goal.steps.length;
  const done = goal.steps.filter((step) => step.status === "done").length;
  const inProgress = goal.steps.filter((step) => step.status === "in_progress").length;
  const nextStep = goal.steps.find((step) => step.status !== "done");
  return {
    done,
    inProgress,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    nextStep,
  };
}

export function advanceGoalStep(goal: LearnerGoal, stepId: string, status: GoalStepStatus): LearnerGoal {
  const steps = goal.steps.map((step) => step.id === stepId
    ? {
        ...step,
        status,
        completedAt: status === "done" ? new Date().toISOString() : undefined,
      }
    : step);
  const allDone = steps.length > 0 && steps.every((step) => step.status === "done");
  return {
    ...goal,
    steps,
    status: allDone ? "completed" : goal.status === "completed" ? "active" : goal.status,
    updatedAt: Date.now(),
  };
}

const STATUS_MARK: Record<GoalStepStatus, string> = {
  not_started: "[ ]",
  in_progress: "[~]",
  done: "[x]",
};

export function goalToMarkdown(goal: LearnerGoal): string {
  const progress = computeGoalProgress(goal);
  const lines = [
    `# Goal: ${goal.title}`,
    "",
    goal.description || "_(no description)_",
    "",
    `**Progress:** ${progress.done}/${progress.total} steps (${progress.percent}%) · **Status:** ${goal.status}`,
  ];
  if (goal.motivation) lines.push(`**Why:** ${goal.motivation}`);
  if (goal.targetDate) lines.push(`**Target:** ${goal.targetDate}`);
  if (progress.nextStep) lines.push(`**Next up:** ${progress.nextStep.title}`);
  lines.push("", "## Curriculum", "");

  for (const step of goal.steps) {
    lines.push(`### ${STATUS_MARK[step.status]} ${step.order + 1}. ${step.title}  _(${step.kind})_`);
    if (step.description) lines.push(step.description);
    if (step.topic) lines.push(`*Topic:* ${step.topic}`);
    if (step.successCriteria.length > 0) {
      lines.push("*Success criteria:*");
      for (const criterion of step.successCriteria) lines.push(`- ${criterion}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function normalizeGoal(raw: unknown): LearnerGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.title !== "string" || !Array.isArray(value.steps)) {
    return null;
  }
  return value as unknown as LearnerGoal;
}
