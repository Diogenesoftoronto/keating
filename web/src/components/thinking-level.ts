import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai/compat";

/** The full ladder, in order, with the words the learner sees. */
export const THINKING_LEVEL_OPTIONS: readonly { value: ThinkingLevel; label: string }[] = [
	{ value: "off", label: "Off" },
	{ value: "minimal", label: "Minimal" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra high" },
	{ value: "max", label: "Maximum" },
];

export function thinkingLevelLabel(level: ThinkingLevel): string {
	return THINKING_LEVEL_OPTIONS.find(option => option.value === level)?.label ?? level;
}

/** Levels this model accepts. With no model known yet, the whole ladder stays on offer. */
export function supportedThinkingLevels(model: Model<Api> | null | undefined): ThinkingLevel[] {
	if (!model) return THINKING_LEVEL_OPTIONS.map(option => option.value);
	return getSupportedThinkingLevels(model) as ThinkingLevel[];
}

export function supportedThinkingOptions(model: Model<Api> | null | undefined) {
	const supported = new Set(supportedThinkingLevels(model));
	return THINKING_LEVEL_OPTIONS.filter(option => supported.has(option.value));
}

/** The level a request will really use: the runtime clamps an unsupported choice to the nearest supported one. */
export function effectiveThinkingLevel(model: Model<Api> | null | undefined, level: ThinkingLevel): ThinkingLevel {
	return model ? clampThinkingLevel(model, level) as ThinkingLevel : level;
}

/** Short state for a trigger or row, e.g. "Thinking: Medium" or "No thinking step". */
export function thinkingLevelSummary(model: Model<Api> | null | undefined, level: ThinkingLevel): string {
	if (model && !model.reasoning) return "No thinking step";
	const effective = effectiveThinkingLevel(model, level);
	return effective === "off" ? "Thinking off" : `Thinking: ${thinkingLevelLabel(effective)}`;
}
