import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { KeatingAgentRuntimeConfig } from "../agent-runtime";
import type { BenchSessionSample, BrowserLearnerOutcome } from "../core";
import type { WebSpeechSettings } from "../speech";

export interface KeatingToolsOptions {
	agentRuntime?: KeatingAgentRuntimeConfig;
	speech?: {
		settings: WebSpeechSettings;
		getApiKey: (provider: string) => Promise<string | undefined>;
	};
	setSystemPrompt?: (basePrompt: string) => void;
	/** Loads stored chat sessions so benchmarks can mine real transcripts and attribute signals to the model that taught them. */
	getSessionSamples?: () => Promise<BenchSessionSample[]>;
}

export type OutcomeCollector = () => Promise<BrowserLearnerOutcome[]>;

export interface ToolRegistry {
	has(name: string): boolean;
	invoke(name: string, params: Record<string, unknown>): Promise<string>;
}

/** Create a Pi-compatible tool with Keating's text-result contract. */
export function createTool(
	name: string,
	description: string,
	parameters: Record<string, unknown>,
	execute: (params: Record<string, unknown>) => Promise<string>,
	required?: string[],
): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: {
			type: "object",
			properties: parameters,
			...(required?.length ? { required } : {}),
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: Record<string, unknown>) => {
			const result = await execute(params as Record<string, unknown>);
			return {
				content: [{ type: "text", text: result }],
				details: { tool: name },
			};
		},
	} as unknown as AgentTool;
}

export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
	return {
		has: (name) => tools.some((candidate) => candidate.name === name),
		invoke: async (name, params) => {
			const tool = tools.find((candidate) => candidate.name === name);
			if (!tool) return `Capability unavailable: ${name} is not connected in this runtime.`;
			const result = await (tool.execute as any)(`keating-composed-${name}`, params, undefined, () => {});
			const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
			return Array.isArray(content)
				? content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n")
				: String(result ?? "");
		},
	};
}
