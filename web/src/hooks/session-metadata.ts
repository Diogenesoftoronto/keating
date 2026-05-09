import {
	type AgentMessage,
	type SessionMetadata,
} from "@mariozechner/pi-web-ui";

export function createSessionId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
		.slice(0, 2048);
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
