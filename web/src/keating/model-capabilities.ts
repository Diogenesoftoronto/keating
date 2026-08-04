import type { Api, Model } from "@earendil-works/pi-ai/compat";

export const LONG_CONTEXT_THRESHOLD = 256_000;

export const CHAT_CAPABILITY_FILTERS = [
	{ value: "thinking", label: "Thinking" },
	{ value: "vision", label: "Vision" },
	{ value: "long-context", label: "Long context" },
] as const;

export type ChatCapabilityFilter = (typeof CHAT_CAPABILITY_FILTERS)[number]["value"];

export function modelHasCapability(model: Model<Api>, capability: ChatCapabilityFilter): boolean {
	switch (capability) {
		case "thinking":
			return model.reasoning === true;
		case "vision":
			return model.input.includes("image");
		case "long-context":
			return model.contextWindow >= LONG_CONTEXT_THRESHOLD;
		default:
			return true;
	}
}

export function modelHasCapabilities(model: Model<Api>, capabilities: readonly ChatCapabilityFilter[]): boolean {
	return capabilities.every((capability) => modelHasCapability(model, capability));
}

export function modelCapabilityBadges(model: Model<Api>): string[] {
	return [
		model.input.includes("image") ? "Vision" : "",
		model.reasoning ? "Thinking" : "",
		model.contextWindow >= LONG_CONTEXT_THRESHOLD ? "Long context" : "",
	].filter(Boolean);
}
