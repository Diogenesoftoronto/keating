import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingAgentRuntimeConfig } from "./agent-runtime";

export type KeatingCapabilityId = "learner-details" | "media" | "workspace" | "improvement" | "voice";
export type CapabilityAvailability = "available" | "unavailable" | "approval-required";

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

export interface CapabilityActivationResult {
	activated: KeatingCapabilityId[];
	alreadyActive: KeatingCapabilityId[];
	unavailable: Array<{ id: KeatingCapabilityId; reason: string }>;
	unknown: string[];
}

/**
 * Transitional baseline while the OpenUI renderer replaces legacy teaching
 * cards. These remain available so capability loading can ship independently
 * without breaking current conversations.
 *
 * Lesson plans, concept maps, and verification checklists are no longer
 * teaching tools: stream them as OpenUI components (`StudyPlan`,
 * `ConceptMap`, `SharedNotes`, `Explanation`) inside `LearningSurface` so
 * the model can iterate without bouncing through a one-shot tool call.
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
	"learner-details": ["inspect_learning_context"],
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
	const canExecute = nodePod || runtime.capabilities.remoteSandbox || !!runtime.localExecEndpoint;
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
			id: "learner-details",
			title: "Learner details",
			description: "Inspect deeper learner history, goals, review timing, or progress when the automatically loaded summary is insufficient.",
			availability: "available",
			tools: [...TOOL_NAMES["learner-details"]],
		},
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
			reason: workspaceTools.length ? undefined : "No NodePod, remote sandbox, host-project, or local execution backend is connected.",
			tools: workspaceTools,
		},
		{
			id: "improvement",
			title: "Teaching improvement",
			description: "Evaluate teaching evidence and evolve policy or prompts outside the active teaching moment.",
			availability: "available",
			tools: [...TOOL_NAMES.improvement],
		},
		{
			id: "voice",
			title: "Voice",
			description: "Produce speech through the configured voice runtime.",
			availability: environment.speechEnabled ? "available" : "unavailable",
			reason: environment.speechEnabled ? undefined : "Voice is disabled in this session.",
			tools: [...TOOL_NAMES.voice],
		},
	];
}

export function capabilityCatalogPrompt(catalog: CapabilityBundle[]): string {
	const rows = catalog.map((bundle) => {
		const suffix = bundle.availability === "available"
			? "available"
			: `${bundle.availability}: ${bundle.reason ?? "not configured"}`;
		return `- ${bundle.id}: ${bundle.description} (${suffix})`;
	});
	return [
		"### Optional capability bundles",
		"Normal teaching uses the baseline interaction capabilities. Optional tool schemas are loaded only when needed. Call `activate_capabilities` with one or more available bundle ids before using them.",
		...rows,
	].join("\n");
}

function activationTool(controller: KeatingCapabilityController): AgentTool {
	return {
		name: "activate_capabilities",
		label: "activate_capabilities",
		description: "Load one or more optional capability bundles for subsequent work. Activate all bundles you expect to need in one call.",
		executionMode: "sequential",
		parameters: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string", enum: ["learner-details", "media", "workspace", "improvement", "voice"] },
					minItems: 1,
					uniqueItems: true,
					description: "Capability bundle ids to load.",
				},
			},
			required: ["ids"],
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: unknown) => {
			const ids = Array.isArray((params as { ids?: unknown })?.ids)
				? (params as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string")
				: [];
			const result = controller.activate(ids);
			const lines = ["# Capability activation"];
			if (result.activated.length) lines.push(`- activated: ${result.activated.join(", ")}`);
			if (result.alreadyActive.length) lines.push(`- already active: ${result.alreadyActive.join(", ")}`);
			for (const item of result.unavailable) lines.push(`- unavailable ${item.id}: ${item.reason}`);
			if (result.unknown.length) lines.push(`- unknown: ${result.unknown.join(", ")}`);
			if (result.activated.length) lines.push("- status: activated tools will be available in the automatic continuation");
			controller.notifyActivation(result);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { tool: "activate_capabilities", ...result },
				terminate: result.activated.length > 0,
			};
		},
	} as AgentTool;
}

export class KeatingCapabilityController {
	private environment: CapabilityEnvironment;
	private allTools: AgentTool[] = [];
	private readonly active = new Set<KeatingCapabilityId>();
	private listener?: (tools: AgentTool[]) => void;
	private activationListener?: (result: CapabilityActivationResult) => void;
	private readonly activationTool: AgentTool;

	constructor(environment: CapabilityEnvironment = {}) {
		this.environment = environment;
		this.activationTool = activationTool(this);
	}

	setListener(listener: (tools: AgentTool[]) => void): void {
		this.listener = listener;
	}

	setActivationListener(listener: (result: CapabilityActivationResult) => void): void {
		this.activationListener = listener;
	}

	setEnvironment(environment: CapabilityEnvironment): void {
		this.environment = environment;
		this.dropUnavailableCapabilities();
		this.notify();
	}

	setAllTools(tools: AgentTool[]): AgentTool[] {
		this.allTools = [...tools];
		const selected = this.tools();
		this.listener?.(selected);
		return selected;
	}

	catalog(): CapabilityBundle[] {
		const registered = new Set(this.allTools.map((tool) => tool.name));
		return buildCapabilityCatalog(this.environment).map((bundle) => {
			if (bundle.availability !== "available") return bundle;
			const missing = bundle.tools.filter((name) => !registered.has(name));
			if (missing.length === 0) return bundle;
			return {
				...bundle,
				availability: "unavailable",
				reason: `Tool schemas are not registered: ${missing.join(", ")}.`,
			};
		});
	}

	activeIds(): KeatingCapabilityId[] {
		return [...this.active];
	}

	activate(ids: string[]): CapabilityActivationResult {
		const catalog = new Map(this.catalog().map((bundle) => [bundle.id, bundle]));
		const result: CapabilityActivationResult = { activated: [], alreadyActive: [], unavailable: [], unknown: [] };
		for (const rawId of ids) {
			const bundle = catalog.get(rawId as KeatingCapabilityId);
			if (!bundle) {
				result.unknown.push(rawId);
				continue;
			}
			if (bundle.availability !== "available") {
				result.unavailable.push({ id: bundle.id, reason: bundle.reason ?? "Capability is not available." });
				continue;
			}
			if (this.active.has(bundle.id)) result.alreadyActive.push(bundle.id);
			else {
				this.active.add(bundle.id);
				result.activated.push(bundle.id);
			}
		}
		if (result.activated.length) this.notify();
		return result;
	}

	tools(): AgentTool[] {
		const activeToolNames = new Set(BASELINE_TEACHING_TOOLS);
		for (const bundle of this.catalog()) {
			if (this.active.has(bundle.id) && bundle.availability === "available") {
				for (const name of bundle.tools) activeToolNames.add(name);
			}
		}
		return [this.activationTool, ...this.allTools.filter((tool) => activeToolNames.has(tool.name))];
	}

	private dropUnavailableCapabilities(): void {
		const catalog = new Map(this.catalog().map((bundle) => [bundle.id, bundle]));
		for (const id of this.active) {
			if (catalog.get(id)?.availability !== "available") this.active.delete(id);
		}
	}

	private notify(): void {
		this.listener?.(this.tools());
	}

	notifyActivation(result: CapabilityActivationResult): void {
		this.activationListener?.(result);
	}
}
