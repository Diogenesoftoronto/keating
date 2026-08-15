import { buildGoalWithTopicResolver } from "../../../shared/pedagogy/goals";
import type { GoalInput, LearnerGoal } from "../../../shared/pedagogy/goals";
import { resolveTopic } from "./core";

export {
	advanceGoalStep,
	computeGoalProgress,
	goalToMarkdown,
	normalizeGoal,
} from "../../../shared/pedagogy/goals";

export type {
	GoalInput,
	GoalProgress,
	GoalStatus,
	GoalStep,
	GoalStepInput,
	GoalStepKind,
	GoalStepStatus,
	LearnerGoal,
} from "../../../shared/pedagogy/goals";

export function buildGoal(input: GoalInput): LearnerGoal {
	return buildGoalWithTopicResolver(input, resolveTopic);
}
