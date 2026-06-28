import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionMetadata } from "../types/session";

export function createSessionId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cloneMessages(messages: AgentMessage[]): AgentMessage[] {
	return structuredClone(messages);
}

// Truncate a stored message list to end at the forked assistant turn. `forkPoint`
// is the timestamp of the clicked assistant message (encoded in its rendered id).
// We keep everything up to and including that assistant message plus the tool
// results that belong to its turn, and drop the next user message onward — giving
// a clean, continuable branch point. If nothing matches, the full list is kept.
export function truncateAtForkPoint(
	messages: AgentMessage[],
	forkPoint: number | undefined,
): AgentMessage[] {
	if (forkPoint == null) return messages;
	let assistantIdx = -1;
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i] as { role?: string; timestamp?: number };
		if (msg.role === "assistant" && msg.timestamp === forkPoint) assistantIdx = i;
	}
	if (assistantIdx === -1) return messages;
	let boundary = messages.length;
	for (let i = assistantIdx + 1; i < messages.length; i++) {
		if ((messages[i] as { role?: string }).role === "user") {
			boundary = i;
			break;
		}
	}
	return messages.slice(0, boundary);
}

const emptyUsage: SessionMetadata["usage"] = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function messageText(message: AgentMessage): string {
	const msg = message as any;
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join(" ");
	}
	return "";
}

export function sessionTitle(messages: AgentMessage[]) {
	const firstUserText = messages
		.filter((message) => (message as any).role === "user" || (message as any).role === "user-with-attachments")
		.map(messageText)
		.find((text) => text.trim().length > 0);
	if (!firstUserText) return "New session";
	return firstUserText.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function sessionPreview(messages: AgentMessage[]) {
	return messages
		.map(messageText)
		.filter(Boolean)
		.join("\n")
		.slice(0, 8192);
}

export function sessionUsage(messages: AgentMessage[]): SessionMetadata["usage"] {
	return messages.reduce<SessionMetadata["usage"]>((usage, message) => {
		const messageUsage = (message as any).usage;
		if (!messageUsage) return usage;
		usage.input += messageUsage.input ?? 0;
		usage.output += messageUsage.output ?? 0;
		usage.cacheRead += messageUsage.cacheRead ?? 0;
		usage.cacheWrite += messageUsage.cacheWrite ?? 0;
		usage.totalTokens += messageUsage.totalTokens ?? 0;
		usage.cost.input += messageUsage.cost?.input ?? 0;
		usage.cost.output += messageUsage.cost?.output ?? 0;
		usage.cost.cacheRead += messageUsage.cost?.cacheRead ?? 0;
		usage.cost.cacheWrite += messageUsage.cost?.cacheWrite ?? 0;
		usage.cost.total += messageUsage.cost?.total ?? 0;
		return usage;
	}, structuredClone(emptyUsage));
}

export function sessionModelMetadata(model: Model<any> | undefined): Pick<SessionMetadata, "modelProvider" | "modelId" | "modelName" | "modelApi" | "modelReasoning"> {
	return {
		modelProvider: model?.provider,
		modelId: model?.id,
		modelName: model?.name,
		modelApi: typeof model?.api === "string" ? model.api : undefined,
		modelReasoning: typeof model?.reasoning === "boolean" ? model.reasoning : undefined,
	};
}
