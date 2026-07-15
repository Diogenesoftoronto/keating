import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const INTERRUPTED_RESPONSE_MESSAGE =
	"The response was interrupted before it finished. Retry to generate it again.";

type AssistantLike = AgentMessage & {
	role?: unknown;
	content?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
};

function cloneMessage(message: AgentMessage): AgentMessage {
	const content = (message as AssistantLike).content;
	return {
		...message,
		...(Array.isArray(content)
			? { content: content.map((part) => (part && typeof part === "object" ? { ...part } : part)) }
			: {}),
	} as AgentMessage;
}

export function isRetryableAssistantMessage(message: AgentMessage | undefined): boolean {
	if (!message) return false;
	const entry = message as AssistantLike;
	return entry.role === "assistant" && (entry.stopReason === "error" || entry.stopReason === "aborted");
}

export function messagesForSessionSnapshot(
	messages: AgentMessage[],
	streamingMessage: AgentMessage | undefined,
): { messages: AgentMessage[]; interrupted: boolean } {
	const stableMessages = messages.map(cloneMessage);
	if (!streamingMessage || (streamingMessage as AssistantLike).role !== "assistant") {
		return { messages: stableMessages, interrupted: false };
	}

	const interrupted = cloneMessage(streamingMessage) as AssistantLike;
	interrupted.stopReason = "aborted";
	interrupted.errorMessage = INTERRUPTED_RESPONSE_MESSAGE;
	return {
		messages: [...stableMessages, interrupted as AgentMessage],
		interrupted: true,
	};
}

export function prepareMessagesForRetry(messages: AgentMessage[]): AgentMessage[] | null {
	if (!isRetryableAssistantMessage(messages.at(-1))) return null;
	const remaining = messages.slice(0, -1).map(cloneMessage);
	const hasUserTurn = remaining.some((message) => {
		const role = (message as { role?: unknown }).role;
		return role === "user" || role === "user-with-attachments";
	});
	return hasUserTurn ? remaining : null;
}
