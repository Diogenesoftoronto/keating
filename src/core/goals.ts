import { buildGoalWithTopicResolver } from "../../shared/pedagogy/goals.js";
import type { GoalInput, LearnerGoal } from "../../shared/pedagogy/goals.js";
import { resolveTopic } from "./topics.js";

export {
  advanceGoalStep,
  computeGoalProgress,
  goalToMarkdown,
  normalizeGoal,
} from "../../shared/pedagogy/goals.js";

export type {
  GoalInput,
  GoalProgress,
  GoalStatus,
  GoalStep,
  GoalStepInput,
  GoalStepKind,
  GoalStepStatus,
  LearnerGoal,
} from "../../shared/pedagogy/goals.js";

export function buildGoal(input: GoalInput): LearnerGoal {
  return buildGoalWithTopicResolver(input, resolveTopic);
}
