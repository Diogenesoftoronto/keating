import { ensureProjectScaffold } from "../../../core/project.js";
import { buildGoal, advanceGoalStep, type GoalStepInput } from "../../../core/goals.js";
import { goalsStatePath } from "../../../core/paths.js";
import { loadGoals, upsertGoal } from "../../../core/goal-state.js";
import { renderGoalCard, renderGoalListCard } from "../tui-components.js";
import { keatingToolMaker, getCwd } from "./shared.js";

export const goalTools = [
  keatingToolMaker(
    "set_learner_goal",
    "set_learner_goal",
    "Create or update a long-horizon learner goal with a curriculum of steps. Use when the learner wants to accomplish something over multiple sessions (a project, a skill, a milestone). If steps are omitted, a default research→practice→build→teach curriculum is scaffolded from 'topic'.",
    {
      title: { type: "string", description: "The goal title, e.g. 'Ship a personal website'." },
      description: { type: "string", description: "Optional longer description of the goal." },
      motivation: { type: "string", description: "Optional: why this goal matters to the learner." },
      target_date: { type: "string", description: "Optional target completion date." },
      topic: { type: "string", description: "Optional anchor topic used to auto-scaffold a curriculum when steps are omitted." },
      steps: {
        type: "array",
        description: "Optional agent-authored curriculum steps, in order.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            kind: { type: "string", enum: ["concept", "practice", "project", "milestone", "reflection"] },
            topic: { type: "string" },
            success_criteria: { type: "array", items: { type: "string" } }
          },
          required: ["title"]
        }
      }
    },
    async (params) => {
      const title = (params.title as string) || "";
      if (!title) return { content: [{ type: "text", text: "Goal title is required." }] };
      const stepsInput = Array.isArray(params.steps) ? (params.steps as Record<string, unknown>[]) : undefined;
      const steps: GoalStepInput[] | undefined = stepsInput
        ?.filter((s) => typeof s.title === "string" && s.title.trim().length > 0)
        .map((s) => ({
          title: s.title as string,
          description: typeof s.description === "string" ? s.description : undefined,
          kind: s.kind as GoalStepInput["kind"],
          topic: typeof s.topic === "string" ? s.topic : undefined,
          successCriteria: Array.isArray(s.success_criteria) ? (s.success_criteria as string[]) : undefined
        }));
      const goal = buildGoal({
        title,
        description: params.description as string | undefined,
        motivation: params.motivation as string | undefined,
        targetDate: params.target_date as string | undefined,
        topic: params.topic as string | undefined,
        steps
      });
      await ensureProjectScaffold(getCwd());
      await upsertGoal(goalsStatePath(getCwd()), goal);
      return {
        content: [{ type: "text", text: `Created goal "${goal.title}" (id: ${goal.id}) with ${goal.steps.length} steps.` }],
        details: { goal }
      };
    },
    { result: (result: any, _options: any, theme: any) => (result?.details?.goal ? renderGoalCard(theme, result.details.goal) : undefined) }
  ),
  keatingToolMaker(
    "list_learner_goals",
    "list_learner_goals",
    "List the learner's saved goals and their progress. Optionally filter by status.",
    { status: { type: "string", enum: ["active", "completed", "paused"], description: "Optional status filter." } },
    async (params) => {
      const goals = await loadGoals(goalsStatePath(getCwd()));
      const filtered = typeof params.status === "string" ? goals.filter((g) => g.status === params.status) : goals;
      const summary =
        filtered.length === 0
          ? "No goals found."
          : filtered.map((g) => `- ${g.id}: ${g.title} (${g.status}, ${g.steps.filter((s) => s.status === "done").length}/${g.steps.length} steps)`).join("\n");
      return {
        content: [{ type: "text", text: summary }],
        details: { goals: filtered }
      };
    },
    { result: (result: any, _options: any, theme: any) => (Array.isArray(result?.details?.goals) ? renderGoalListCard(theme, result.details.goals) : undefined) }
  ),
  keatingToolMaker(
    "update_goal_step",
    "update_goal_step",
    "Update the status of one step within a learner goal (e.g. mark it in progress or done). Use goal_id and step_id from set_learner_goal or list_learner_goals.",
    {
      goal_id: { type: "string", description: "The goal id." },
      step_id: { type: "string", description: "The step id to update." },
      status: { type: "string", enum: ["not_started", "in_progress", "done"], description: "The new status for the step." }
    },
    async (params) => {
      const goalId = (params.goal_id as string) || "";
      const stepId = (params.step_id as string) || "";
      const status = params.status as string;
      if (!goalId || !stepId || (status !== "not_started" && status !== "in_progress" && status !== "done")) {
        return { content: [{ type: "text", text: "goal_id, step_id, and a valid status ('not_started'|'in_progress'|'done') are required." }] };
      }
      const path = goalsStatePath(getCwd());
      const goals = await loadGoals(path);
      const goal = goals.find((g) => g.id === goalId);
      if (!goal) return { content: [{ type: "text", text: `No goal found with id "${goalId}".` }] };
      if (!goal.steps.some((step) => step.id === stepId)) {
        return { content: [{ type: "text", text: `No step found with id "${stepId}" in goal "${goal.title}".` }] };
      }
      const updated = advanceGoalStep(goal, stepId, status);
      await upsertGoal(path, updated);
      return {
        content: [{ type: "text", text: `Updated step to "${status}" in goal "${updated.title}".` }],
        details: { goal: updated }
      };
    },
    { result: (result: any, _options: any, theme: any) => (result?.details?.goal ? renderGoalCard(theme, result.details.goal) : undefined) }
  ),
];
