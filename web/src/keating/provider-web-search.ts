import type { Api, Model } from "@earendil-works/pi-ai";
import { loadKeatingUiSettings } from "./ui-settings";

function enabled(hasApiKey: boolean): boolean {
	return hasApiKey && loadKeatingUiSettings().webSearch !== "off";
}

function isGoogleModel(model: Model<Api>): boolean {
	return model.provider === "google"
		&& model.api === "google-generative-ai"
		&& /^gemini-(?:2(?:\.0|\.5)|3|3\.1|3\.5)/.test(model.id);
}

function hasGoogleSearch(payload: any): boolean {
	return Array.isArray(payload?.config?.tools)
		&& payload.config.tools.some((tool: any) => tool?.googleSearch || tool?.google_search);
}

export function applyGoogleSearchGrounding(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!enabled(hasApiKey) || !isGoogleModel(model)) return undefined;
	const params = payload as any;
	const existingTools = Array.isArray(params?.config?.tools) ? params.config.tools : [];
	// Gemini 2.x rejects Google grounding combined with function declarations.
	if (existingTools.length > 0 && !/^gemini-3/.test(model.id)) return undefined;
	if (hasGoogleSearch(params)) return undefined;
	return { ...params, config: { ...(params?.config ?? {}), tools: [...existingTools, { googleSearch: {} }] } };
}

function isOpenAiModel(model: Model<Api>): boolean {
	return model.provider === "openai"
		&& model.api === "openai-responses"
		&& !/codex/.test(model.id)
		&& /^(gpt-4o|gpt-4\.1|gpt-5|o[1345])/.test(model.id);
}

function openAiToolType(model: Model<Api>): "web_search" | "web_search_preview" {
	return /^(gpt-5|o3|o4|o5)/.test(model.id) ? "web_search" : "web_search_preview";
}

function hasHostedSearch(params: any): boolean {
	return Array.isArray(params?.tools)
		&& params.tools.some((tool: any) => typeof tool?.type === "string" && tool.type.startsWith("web_search"));
}

export function applyOpenAiWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!enabled(hasApiKey) || !isOpenAiModel(model)) return undefined;
	const params = payload as any;
	if (hasHostedSearch(params)) return undefined;
	const tools = Array.isArray(params?.tools) ? params.tools : [];
	return { ...params, tools: [...tools, { type: openAiToolType(model) }] };
}

function isAnthropicModel(model: Model<Api>): boolean {
	return model.provider === "anthropic"
		&& model.api === "anthropic-messages"
		&& /^claude-(?:3-5|3-7|sonnet-[45]|opus-[45]|haiku-[45]|fable-)/.test(model.id);
}

export function applyAnthropicWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	if (!enabled(hasApiKey) || !isAnthropicModel(model)) return undefined;
	const params = payload as any;
	if (hasHostedSearch(params)) return undefined;
	const tools = Array.isArray(params?.tools) ? params.tools : [];
	return { ...params, tools: [...tools, { type: "web_search_20250305", name: "web_search" }] };
}

/** Add the active provider's hosted search tool without disturbing app tools. */
export function applyProviderWebSearch(payload: unknown, model: Model<Api>, hasApiKey: boolean): unknown | undefined {
	switch (model.provider) {
		case "google": return applyGoogleSearchGrounding(payload, model, hasApiKey);
		case "openai": return applyOpenAiWebSearch(payload, model, hasApiKey);
		case "anthropic": return applyAnthropicWebSearch(payload, model, hasApiKey);
		default: return undefined;
	}
}
