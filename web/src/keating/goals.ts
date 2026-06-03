/**
 * Learner Goals — long-horizon curriculum building.
 *
 * A goal captures something the learner wants to *accomplish* (a task or
 * project), then scaffolds an ordered curriculum of steps that build toward it.
 * Goals are persisted and their progress is tracked across sessions, so the
 * agent can pick up where the learner left off and sequence work over days or
 * weeks rather than a single chat.
 */

import { resolveTopic } from "./core";

export type GoalStepKind = "concept" | "practice" | "project" | "milestone" | "reflection";
export type GoalStepStatus = "not_started" | "in_progress" | "done";
export type GoalStatus = "active" | "completed" | "paused";

export interface GoalStep {
	id: string;
	order: number;
	title: string;
	description: string;
	kind: GoalStepKind;
	/** Optional topic this step centers on (drives plan/quiz tooling). */
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
	/** Agent-designed curriculum steps. When omitted, a scaffold is generated. */
	steps?: GoalStepInput[];
	/** Anchor topic used to auto-scaffold a curriculum when steps are omitted. */
	topic?: string;
}

const STEP_KINDS: GoalStepKind[] = ["concept", "practice", "project", "milestone", "reflection"];

function makeId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeKind(value: unknown): GoalStepKind {
	return typeof value === "string" && (STEP_KINDS as string[]).includes(value)
		? (value as GoalStepKind)
		: "concept";
}

/**
 * Auto-generate a long-horizon curriculum from an anchor topic when the agent
 * does not supply explicit steps. Mirrors the research → practice → build →
 * teach arc used elsewhere in Keating, but framed around the learner's goal.
 */
function scaffoldSteps(goalTitle: string, anchorTopic: string): GoalStepInput[] {
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
				...topic.misconceptions.slice(0, 1).map((m) => `Avoid the misconception: ${m}`),
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

/** Build a persistable LearnerGoal from agent/learner input. */
export function buildGoal(input: GoalInput): LearnerGoal {
	const title = input.title.trim();
	const id = makeId("goal");
	const now = Date.now();

	const rawSteps =
		input.steps && input.steps.length > 0
			? input.steps
			: scaffoldSteps(title, input.topic ?? title);

	const steps: GoalStep[] = rawSteps
		.filter((s) => s && typeof s.title === "string" && s.title.trim().length > 0)
		.map((s, index) => ({
			id: makeId(`step${index + 1}`),
			order: index,
			title: s.title.trim(),
			description: (s.description ?? "").trim(),
			kind: normalizeKind(s.kind),
			topic: s.topic?.trim() || undefined,
			successCriteria: Array.isArray(s.successCriteria)
				? s.successCriteria.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
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

export interface GoalProgress {
	done: number;
	inProgress: number;
	total: number;
	percent: number;
	/** The first step that is not yet done — the learner's next focus. */
	nextStep?: GoalStep;
}

export function computeGoalProgress(goal: LearnerGoal): GoalProgress {
	const total = goal.steps.length;
	const done = goal.steps.filter((s) => s.status === "done").length;
	const inProgress = goal.steps.filter((s) => s.status === "in_progress").length;
	const nextStep = goal.steps.find((s) => s.status !== "done");
	return {
		done,
		inProgress,
		total,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
		nextStep,
	};
}

/** Return a new goal with one step's status changed and goal status recomputed. */
export function advanceGoalStep(goal: LearnerGoal, stepId: string, status: GoalStepStatus): LearnerGoal {
	const steps = goal.steps.map((step) =>
		step.id === stepId
			? {
					...step,
					status,
					completedAt: status === "done" ? new Date().toISOString() : undefined,
				}
			: step,
	);
	const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
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
			for (const c of step.successCriteria) lines.push(`- ${c}`);
		}
		lines.push("");
	}

	return lines.join("\n") + "\n";
}

/** Parse an unknown payload into a LearnerGoal (used by the UI renderer). */
export function normalizeGoal(raw: unknown): LearnerGoal | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== "string" || typeof obj.title !== "string" || !Array.isArray(obj.steps)) {
		return null;
	}
	return obj as unknown as LearnerGoal;
}
