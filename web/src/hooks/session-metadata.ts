import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionData, SessionMetadata } from "../types/session";
import { learnerResponseReviewText } from "../keating/learner-response";

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
// a clean, continuable branch point. An explicit stale point is rejected rather
// than silently branching from a different transcript position.
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
	if (assistantIdx === -1) {
		throw new Error("The selected fork point is no longer present in this session. Reload the session and choose the message again.");
	}
	let boundary = messages.length;
	for (let i = assistantIdx + 1; i < messages.length; i++) {
		if ((messages[i] as { role?: string }).role === "user") {
			boundary = i;
			break;
		}
	}
	return messages.slice(0, boundary);
}

export function buildForkSession(
	source: SessionData,
	allMetadata: SessionMetadata[],
	forkPoint: number | undefined,
	now: string,
	id: string,
): { data: SessionData; metadata: SessionMetadata } {
	const messages = truncateAtForkPoint(cloneMessages(source.messages), forkPoint);
	const siblingNumber = allMetadata.filter(
		(entry) => entry.parentSessionId === source.id && !entry.generatedAlternative,
	).length + 1;
	const title = `${source.title || sessionTitle(messages)} (fork ${siblingNumber})`;
	const data: SessionData = {
		id,
		title,
		parentSessionId: source.id,
		forkedAt: now,
		forkedFromMessageTimestamp: forkPoint,
		model: source.model,
		thinkingLevel: source.thinkingLevel,
		messages,
		createdAt: now,
		lastModified: now,
		aiGeneratedTitle: false,
	};
	const metadata: SessionMetadata = {
		id,
		title,
		parentSessionId: source.id,
		forkedAt: now,
		forkedFromMessageTimestamp: forkPoint,
		createdAt: now,
		lastModified: now,
		messageCount: messages.length,
		usage: sessionUsage(messages),
		thinkingLevel: source.thinkingLevel,
		...sessionModelMetadata(source.model),
		preview: sessionPreview(messages),
		searchText: sessionSearchText(messages),
		aiGeneratedTitle: false,
	};
	return { data, metadata };
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
	if (typeof content === "string") return learnerResponseReviewText(content);
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => learnerResponseReviewText(part.text))
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

export function sessionSearchText(messages: AgentMessage[]) {
	return messages
		.map(messageText)
		.filter(Boolean)
		.join("\n");
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
