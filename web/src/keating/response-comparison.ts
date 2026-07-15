import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionData } from "../types/session";

export type ResponsePreference = "original" | "alternative";
export type ResponseComparisonDecision = ResponsePreference | "skipped";

export interface PendingResponseComparison {
	sourceSessionId: string;
	alternativeSessionId: string;
	topic: string;
	originalResponse: string;
	alternativeResponse: string;
	originalMessageTimestamp: number;
	alternativeMessageTimestamp: number;
}

function messageText(message: AgentMessage | undefined): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => (
			Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
		))
		.map((part) => part.text)
		.join("")
		.trim();
}

function assistantAtTimestamp(messages: AgentMessage[], timestamp: number | undefined): AgentMessage | undefined {
	if (timestamp === undefined) return undefined;
	return messages.find((message) => {
		const candidate = message as { role?: unknown; timestamp?: unknown };
		return candidate.role === "assistant" && candidate.timestamp === timestamp;
	});
}

function lastAssistant(messages: AgentMessage[]): AgentMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if ((messages[index] as { role?: unknown }).role === "assistant") return messages[index];
	}
	return undefined;
}

export function buildPendingResponseComparison(
	source: SessionData,
	alternative: SessionData,
): PendingResponseComparison | null {
	if (!alternative.generatedAlternative || alternative.responsePreference) return null;
	if (alternative.parentSessionId !== source.id) return null;
	const original = assistantAtTimestamp(source.messages, alternative.alternativeForMessageTimestamp);
	const alternate = lastAssistant(alternative.messages);
	const originalResponse = messageText(original);
	const alternativeResponse = messageText(alternate);
	const originalMessageTimestamp = (original as { timestamp?: unknown } | undefined)?.timestamp;
	const alternativeMessageTimestamp = (alternate as { timestamp?: unknown } | undefined)?.timestamp;
	if (!originalResponse || !alternativeResponse) return null;
	if (typeof originalMessageTimestamp !== "number" || typeof alternativeMessageTimestamp !== "number") return null;
	return {
		sourceSessionId: source.id,
		alternativeSessionId: alternative.id,
		topic: source.title,
		originalResponse,
		alternativeResponse,
		originalMessageTimestamp,
		alternativeMessageTimestamp,
	};
}
