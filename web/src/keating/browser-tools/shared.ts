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

export class KeatingToolError extends Error {
	constructor(
		public readonly toolName: string,
		message: string,
		public readonly code: "invalid-arguments" | "unavailable" | "execution-failed" = "execution-failed",
	) {
		super(message);
		this.name = "KeatingToolError";
	}
}

export interface ToolRegistry {
	has(name: string): boolean;
	invoke(name: string, params: Record<string, unknown>): Promise<string>;
}

type JsonSchema = Record<string, any>;

function propertyTypeLabel(schema: JsonSchema): string {
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
	}
	if (schema.type === "array") {
		return `array<${propertyTypeLabel(schema.items ?? { type: "value" })}>`;
	}
	return typeof schema.type === "string" ? schema.type : "value";
}

function describeParameter(name: string, schema: JsonSchema, required: Set<string>): string {
	const requirement = required.has(name) ? "required" : "optional";
	const defaultValue = Object.hasOwn(schema, "default") ? ` Default: ${JSON.stringify(schema.default)}.` : "";
	const description = typeof schema.description === "string" && schema.description.trim()
		? schema.description.trim()
		: "No additional description.";
	return `- \`${name}\` (${requirement}, ${propertyTypeLabel(schema)}): ${description}${defaultValue}`;
}

export function describeToolParameters(parameters: Record<string, unknown>, required: string[] = []): string {
	const entries = Object.entries(parameters);
	if (entries.length === 0) return "Parameters: none.";
	const requiredSet = new Set(required);
	return [
		"Parameters:",
		...entries.map(([name, schema]) => describeParameter(name, schema as JsonSchema, requiredSet)),
	].join("\n");
}

function parameterError(path: string, message: string): string {
	return `${path || "arguments"} ${message}`;
}

function validateSchema(value: unknown, schema: JsonSchema, path: string): string | null {
	if (value === undefined) return null;
	if (schema.type === "string" && typeof value !== "string") return parameterError(path, "must be a string.");
	if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return parameterError(path, "must be a finite number.");
	if (schema.type === "integer" && (!Number.isInteger(value))) return parameterError(path, "must be an integer.");
	if (schema.type === "boolean" && typeof value !== "boolean") return parameterError(path, "must be a boolean.");
	if (schema.type === "array") {
		if (!Array.isArray(value)) return parameterError(path, "must be an array.");
		if (typeof schema.minItems === "number" && value.length < schema.minItems) {
			return parameterError(path, `must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`);
		}
		if (schema.items) {
			for (let index = 0; index < value.length; index += 1) {
				const error = validateSchema(value[index], schema.items, `${path}[${index}]`);
				if (error) return error;
			}
		}
	}
	if (schema.type === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value)) return parameterError(path, "must be an object.");
		const objectValue = value as Record<string, unknown>;
		const required = Array.isArray(schema.required) ? schema.required : [];
		for (const name of required) {
			if (
				(objectValue[name] === undefined || objectValue[name] === null || objectValue[name] === "")
				&& schema["x-keating-drop-invalid-item"] !== true
			) {
				return parameterError(`${path}.${name}`, "is required.");
			}
		}
		for (const [name, childSchema] of Object.entries(schema.properties ?? {})) {
			const error = validateSchema(objectValue[name], childSchema as JsonSchema, `${path}.${name}`);
			if (error) return error;
		}
		if (schema.additionalProperties === false) {
			const allowed = new Set(Object.keys(schema.properties ?? {}));
			const unknown = Object.keys(objectValue).find((name) => !allowed.has(name));
			if (unknown) return parameterError(`${path}.${unknown}`, "is not supported.");
		}
	}
	if (Array.isArray(schema.enum) && !schema.enum.includes(value) && schema["x-keating-normalize-invalid-enum"] !== true) {
		return parameterError(path, `must be one of ${schema.enum.map((item: unknown) => JSON.stringify(item)).join(", ")}.`);
	}
	return null;
}

function validateToolArguments(
	name: string,
	params: Record<string, unknown>,
	parameters: Record<string, unknown>,
	required: string[],
): void {
	const schema = { type: "object", properties: parameters, required, additionalProperties: false };
	const validationError = validateSchema(params, schema, "arguments");
	if (!validationError) return;
	throw new KeatingToolError(
		name,
		`${validationError}\n\n${describeToolParameters(parameters, required)}`,
		"invalid-arguments",
	);
}

const FAILURE_RESULT_PATTERNS = [
	/^error:/i,
	/^#\s+.+\bfailed\b/i,
	/^capability unavailable:/i,
	/^[^\n]*\bis not (?:active|available|connected)\b/i,
	/^no (?:image generation model|valid .+ supplied)\b/i,
	/^not ready to\b/i,
	/^author the\b/i,
	/^pick a valid\b/i,
	/^choose a valid\b/i,
	/^[^\n]*\b(?:is|are) required\b/i,
	/^[^\n]*\bmust be\b/i,
];

export function toolFailureMessage(result: string): string | null {
	const trimmed = result.trim();
	if (!trimmed) return "Tool returned an empty result.";
	return FAILURE_RESULT_PATTERNS.some((pattern) => pattern.test(trimmed)) ? trimmed : null;
}

/** Create a Pi-compatible tool with Keating's text-result contract. */
export function createTool(
	name: string,
	description: string,
	parameters: Record<string, unknown>,
	execute: (params: Record<string, unknown>) => Promise<string>,
	required?: string[],
): AgentTool {
	const requiredParameters = required ?? [];
	const parameterGuide = describeToolParameters(parameters, requiredParameters);
	return {
		name,
		label: name,
		description: `${description.trim()}\n\n${parameterGuide}`,
		parameters: {
			type: "object",
			properties: parameters,
			...(requiredParameters.length ? { required: requiredParameters } : {}),
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: Record<string, unknown>) => {
			validateToolArguments(name, params, parameters, requiredParameters);
			try {
				const result = await execute(params as Record<string, unknown>);
				const failure = toolFailureMessage(result);
				if (failure) throw new KeatingToolError(name, failure, "execution-failed");
				return {
					content: [{ type: "text", text: result }],
					details: { tool: name },
				};
			} catch (error) {
				if (error instanceof KeatingToolError) throw error;
				throw new KeatingToolError(
					name,
					error instanceof Error ? error.message : String(error),
					"execution-failed",
				);
			}
		},
	} as unknown as AgentTool;
}

export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
	return {
		has: (name) => tools.some((candidate) => candidate.name === name),
		invoke: async (name, params) => {
			const tool = tools.find((candidate) => candidate.name === name);
			if (!tool) throw new KeatingToolError(name, `${name} is not connected in this runtime.`, "unavailable");
			const result = await (tool.execute as any)(`keating-composed-${name}`, params, undefined, () => {});
			const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
			return Array.isArray(content)
				? content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n")
				: String(result ?? "");
		},
	};
}
