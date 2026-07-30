import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingAgentRuntimeConfig } from "./agent-runtime";

export type KeatingCapabilityId = "media" | "workspace" | "improvement" | "voice";
export type CapabilityAvailability = "available" | "unavailable";

export interface CapabilityBundle {
	id: KeatingCapabilityId;
	title: string;
	description: string;
	availability: CapabilityAvailability;
	reason?: string;
	tools: string[];
}

export interface CapabilityEnvironment {
	runtime?: KeatingAgentRuntimeConfig;
	speechEnabled?: boolean;
}

/**
 * These tools form the always-on teaching surface. Optional schemas are no
 * longer activated in a second turn: every environment-supported bundle is
 * added alongside this baseline before the model starts responding.
 */
export const BASELINE_TEACHING_TOOLS = new Set([
	"quiz",
	"deck",
	"feedback",
	"grade_quiz",
	"grade_question_checks",
	"remember_learner_profile",
	"set_learner_goal",
	"update_goal_step",
]);

const TOOL_NAMES: Record<KeatingCapabilityId, string[]> = {
	media: ["animate", "generate_image"],
	workspace: ["workspace_inspect", "workspace_change", "workspace_exec"],
	improvement: ["evaluate_teaching", "request_teaching_improvement"],
	voice: ["keating_voice"],
};

function availableWorkspaceTools(environment: CapabilityEnvironment): string[] {
	const runtime = environment.runtime;
	if (!runtime) return [];
	const tools = new Set<string>();
	const nodePod = runtime.mode === "browser-nodepod";
	const remote = runtime.capabilities.remoteSandbox;
	const canInspect = nodePod || remote || !!runtime.projectFilesEndpoint;
	const canExecute = nodePod || remote || !!runtime.localExecEndpoint;
	const canChange = nodePod || remote || (!!runtime.projectFilesEndpoint && !!runtime.localExecEndpoint);
	if (canInspect) tools.add("workspace_inspect");
	if (canExecute) tools.add("workspace_exec");
	if (canChange) tools.add("workspace_change");
	return [...tools];
}

export function buildCapabilityCatalog(environment: CapabilityEnvironment = {}): CapabilityBundle[] {
	const workspaceTools = availableWorkspaceTools(environment);
	return [
		{
			id: "media",
			title: "Media",
			description: "Generate images and render authored Hyperframes animations.",
			availability: "available",
			tools: [...TOOL_NAMES.media],
		},
		{
			id: "workspace",
			title: "Workspace",
			description: "Inspect, edit, validate, and execute within an attached project or sandbox.",
			availability: workspaceTools.length ? "available" : "unavailable",
			reason: workspaceTools.length ? undefined : "No workspace runtime is connected.",
			tools: workspaceTools,
		},
		{
			id: "improvement",
			title: "Teaching improvement",
			description: "Evaluate teaching evidence and evolve policy or prompts.",
			availability: "available",
			tools: [...TOOL_NAMES.improvement],
		},
		{
			id: "voice",
			title: "Voice",
			description: "Produce speech through the configured voice runtime.",
			availability: environment.speechEnabled ? "available" : "unavailable",
			reason: environment.speechEnabled ? undefined : "Voice is disabled in this session.",
			tools: environment.speechEnabled ? [...TOOL_NAMES.voice] : [],
		},
	];
}

/**
 * Expose the complete callable tool surface in one pass while omitting schemas
 * whose backing runtime is not actually connected.
 */
export function filterAvailableKeatingTools(
	tools: AgentTool[],
	environment: CapabilityEnvironment = {},
): AgentTool[] {
	const registered = new Set(tools.map((tool) => tool.name));
	const visible = new Set(BASELINE_TEACHING_TOOLS);

	for (const bundle of buildCapabilityCatalog(environment)) {
		if (bundle.availability !== "available") continue;
		for (const name of bundle.tools) {
			if (registered.has(name)) visible.add(name);
		}
	}

	return tools.filter((tool) => visible.has(tool.name));
}
