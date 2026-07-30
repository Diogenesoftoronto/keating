/**
 * Browser-compatible Keating tool facade.
 *
 * Tool implementations are grouped by capability under ./browser-tools/.
 * This module preserves the public API and the historical registration order.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createSpeechTool } from "./speech";
import type { KeatingStorage } from "./storage";
import { createAssessmentTools, createOutcomeCollector } from "./browser-tools/assessment";
import { createImprovementCapabilityTools, createImprovementTools } from "./browser-tools/improvement";
import { createMediaTools } from "./browser-tools/media";
import { createTeachingTools } from "./browser-tools/teaching";
import { createToolRegistry, type KeatingToolsOptions } from "./browser-tools/shared";
import { createWorkspaceCapabilityTools, createWorkspaceTools } from "./browser-tools/workspace";
import { AuthorizedToolExecutor, type ToolExecutionContext } from "./security";

export {
	KEATING_OPERATIONAL_PROTOCOL,
	KEATING_SYSTEM_PROMPT,
	composeKeatingSystemPrompt,
	buildKeatingSystemPrompt,
	getActiveKeatingPrompt,
} from "./browser-tools/prompt";
export {
	parseStoryboardScenes,
	__test_buildHyperframesComposition,
	__test_parseStoryboardDurationSeconds,
	__test_storyboardTitle,
} from "./browser-tools/media";
export type { KeatingToolsOptions } from "./browser-tools/shared";

export const TOOL_REGISTRATION_ORDER = [
	"agent_runtime",
	"remote_execute",
	"animate",
	"deck",
	"generate_image",
	"bench",
	"evolve",
	"quiz",
	"feedback",
	"grade_quiz",
	"policy",
	"outputs",
	"learner_state",
	"auto_improve",
	"improve",
	"trace",
	"prompt_evolve",
	"prompt_eval",
	"timeline",
	"due",
	"ask_user_question",
	"grade_question_checks",
	"remember_learner_profile",
	"set_learner_goal",
	"list_learner_goals",
	"update_goal_step",
	"source_edit",
	"source_diff",
	"run_script",
	"validate_source_edit",
	"source_snapshot",
	"source_restore",
	"list_project_files",
	"read_project_file",
	"bash",
	"write_project_file",
	"edit_project_file",
	"workspace_inspect",
	"workspace_exec",
	"workspace_change",
	"evaluate_teaching",
	"request_teaching_improvement",
] as const;

const rawToolExecutions = new WeakMap<object, (...args: any[]) => Promise<unknown>>();

/** Used by independently authorized transports so a call is not wrapped twice. */
export function executeRawKeatingTool(tool: AgentTool, args: any[]): Promise<unknown> {
	const execute = rawToolExecutions.get(tool as object);
	if (!execute) throw new Error(`No executable implementation for tool ${tool.name}.`);
	return execute(...args);
}

function preserveRegistrationOrder(groups: AgentTool[][]): AgentTool[] {
	const tools = groups.flat();
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const ordered = TOOL_REGISTRATION_ORDER.flatMap((name) => {
		const tool = byName.get(name);
		if (!tool) return [];
		byName.delete(name);
		return [tool];
	});
	return [...ordered, ...byName.values()];
}

export async function createKeatingTools(
	storage: KeatingStorage,
	options: KeatingToolsOptions = {},
): Promise<AgentTool[]> {
	const security = (options as KeatingToolsOptions & {
		security?: {
			executor: AuthorizedToolExecutor;
			getContext: () => ToolExecutionContext;
		};
	}).security;
	const collectRealOutcomes = createOutcomeCollector(storage, options.getSessionSamples);
	const tools = preserveRegistrationOrder([
		createWorkspaceTools(options),
		createMediaTools(storage),
		createTeachingTools(storage),
		createAssessmentTools(storage, collectRealOutcomes),
		createImprovementTools(storage, options, collectRealOutcomes),
	]);

	const registry = createToolRegistry(tools);
	tools.push(
		...createImprovementCapabilityTools(registry),
		...createWorkspaceCapabilityTools(registry, options),
	);

	if (options.speech?.settings.enabled) {
		tools.push(createSpeechTool(options.speech.settings, options.speech.getApiKey));
	}

	if (!security) return tools;
	return tools.map((tool) => {
		if (!tool.execute) return tool;
		const execute = tool.execute.bind(tool) as (...args: any[]) => Promise<unknown>;
		const securedTool = {
			...tool,
			execute: async (...args: any[]) => security.executor.execute({
				toolName: tool.name,
				arguments: args[1],
				context: security.getContext(),
				run: () => execute(...args),
			}),
		} as AgentTool;
		rawToolExecutions.set(securedTool as object, execute);
		return securedTool;
	});
}
