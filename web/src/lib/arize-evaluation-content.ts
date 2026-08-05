import type { AgentMessage } from "@earendil-works/pi-agent-core";

function visibleMessageText(message: AgentMessage | undefined): string {
	if (!message || !Array.isArray((message as { content?: unknown }).content)) return "";
	return ((message as { content: Array<{ type?: unknown; text?: unknown }> }).content)
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("\n")
		.slice(0, 16_000);
}

/** Only pair an assistant reply that follows the most recent user message. */
export function currentTurnEvaluationContent(
	messages: readonly AgentMessage[],
): { input: string; output: string } | undefined {
	let userIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			userIndex = index;
			break;
		}
	}
	if (userIndex < 0) return undefined;
	const currentAssistant = [...messages.slice(userIndex + 1)]
		.reverse()
		.find((message) => message.role === "assistant");
	const input = visibleMessageText(messages[userIndex]);
	const output = visibleMessageText(currentAssistant);
	return input && output ? { input, output } : undefined;
}
