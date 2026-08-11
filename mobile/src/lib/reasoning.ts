/**
 * Maps the shared reasoning ladder onto each provider's own thinking control.
 * Pure so `bun test` can pin the mapping without a React Native runtime.
 */
import type { ReasoningLevel } from "./ui-settings";

/** Effort names the OpenAI Responses API and its compatible gateways accept. */
export type OpenAiEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export function openAiReasoningEffort(level: ReasoningLevel): OpenAiEffort | null {
  switch (level) {
    case "off":
      return null;
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "xhigh";
  }
}

/** OpenRouter names the top cross-provider effort tier `max`. */
export function openRouterReasoningEffort(level: ReasoningLevel): OpenAiEffort | "max" | null {
  const effort = openAiReasoningEffort(level);
  return effort === "xhigh" ? "max" : effort;
}

/**
 * Anthropic bills thinking as a token budget and rejects anything under 1024,
 * so `minimal` and `low` both land on the floor.
 */
export function anthropicThinkingBudget(level: ReasoningLevel): number | null {
  switch (level) {
    case "off":
      return null;
    case "minimal":
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    default:
      return 16384;
  }
}

/** Gemini takes a thinking budget in tokens; 0 disables it entirely. */
export function googleThinkingBudget(level: ReasoningLevel): number | null {
  switch (level) {
    case "off":
      return null;
    case "minimal":
      return 512;
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 8192;
    default:
      return 16384;
  }
}

/**
 * Anthropic requires room for the visible reply on top of the thinking budget,
 * and rejects a `max_tokens` that does not exceed it.
 */
export function anthropicMaxTokens(thinkingBudget: number | null, replyBudget = 4096): number {
  return thinkingBudget === null ? replyBudget : thinkingBudget + replyBudget;
}
