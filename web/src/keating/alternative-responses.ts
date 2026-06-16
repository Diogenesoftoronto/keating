import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function shouldGenerateAlternativeResponse(chance: number, random = Math.random): boolean {
	if (!Number.isFinite(chance) || chance <= 0) return false;
	if (chance >= 1) return true;
	return random() < chance;
}

export function lastAssistantTimestamp(messages: AgentMessage[]): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: unknown; timestamp?: unknown };
		if (message.role === "assistant" && typeof message.timestamp === "number") {
			return message.timestamp;
		}
	}
	return undefined;
}

export function branchBeforeAssistantTurn(
	messages: AgentMessage[],
	assistantTimestamp: number | undefined = lastAssistantTimestamp(messages),
): AgentMessage[] {
	if (assistantTimestamp == null) return messages;
	const index = messages.findIndex((message) => {
		const entry = message as { role?: unknown; timestamp?: unknown };
		return entry.role === "assistant" && entry.timestamp === assistantTimestamp;
	});
	return index >= 0 ? messages.slice(0, index) : messages;
}

export function canGenerateAlternativeFromBranch(messages: AgentMessage[]): boolean {
	const last = messages[messages.length - 1] as { role?: unknown } | undefined;
	return last?.role === "user" || last?.role === "user-with-attachments";
}
