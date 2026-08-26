import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ReviewToolDisplay {
	kind: "call" | "result";
	name: string;
	callId?: string;
	status: "pending" | "succeeded" | "failed";
	input?: string;
	output?: string;
	details?: string;
	isError?: boolean;
}

export type ReviewToolOutcome = "succeeded" | "failed";

export function collectReviewToolOutcomes(messages: readonly AgentMessage[]): ReadonlyMap<string, ReviewToolOutcome> {
	const outcomes = new Map<string, ReviewToolOutcome>();
	for (const message of messages) {
		const entry = message as unknown as Record<string, unknown>;
		if (entry.role !== "toolResult" || typeof entry.toolCallId !== "string") continue;
		outcomes.set(entry.toolCallId, entry.isError === true ? "failed" : "succeeded");
	}
	return outcomes;
}

export interface ReviewMessageDisplay {
	markdown: string;
	raw: string;
	tools: ReviewToolDisplay[];
}

const DATA_URL = /^data:([^;,]+)?(?:;base64)?,/i;

function visibleValue(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value === "string") {
		const dataUrl = value.match(DATA_URL);
		if (dataUrl) return `[embedded ${dataUrl[1] || "media"}; ${value.length.toLocaleString()} characters]`;
		return value;
	}
	if (value == null || typeof value !== "object") return value;
	if (seen.has(value)) return "[Circular]";
	seen.add(value);
	if (Array.isArray(value)) return value.map((item) => visibleValue(item, seen));
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visibleValue(item, seen)]));
}

function formatted(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(visibleValue(value), null, 2) ?? "";
	} catch {
		return String(value ?? "");
	}
}

function visibleContent(content: unknown): unknown {
	if (!Array.isArray(content)) return visibleValue(content);
	return content.map((part) => {
		if (!part || typeof part !== "object") return visibleValue(part);
		const entry = part as Record<string, unknown>;
		if (entry.type === "thinking") return { type: "thinking", content: "[reasoning omitted from review]" };
		if (entry.type === "image") {
			return {
				type: "image",
				mimeType: entry.mimeType,
				encodedCharacters: typeof entry.data === "string" ? entry.data.length : 0,
			};
		}
		return visibleValue(entry);
	});
}

/**
 * Build the private review representation of a message. Tool inputs and results
 * remain inspectable, while provider reasoning and embedded media bytes do not
 * leak into the page or make the raw view unusably large.
 */
export function reviewMessageDisplay(message: AgentMessage, outcomes: ReadonlyMap<string, ReviewToolOutcome> = new Map()): ReviewMessageDisplay {
	const entry = message as unknown as Record<string, unknown>;
	const role = typeof entry.role === "string" ? entry.role : "unknown";
	const content = entry.content;
	const tools: ReviewToolDisplay[] = [];
	const markdownParts: string[] = [];

	if (Array.isArray(content)) {
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const candidate = part as Record<string, unknown>;
			if (candidate.type === "text" && typeof candidate.text === "string") markdownParts.push(candidate.text);
			if (candidate.type === "toolCall") {
				const callId = typeof candidate.id === "string" ? candidate.id : undefined;
				tools.push({
					kind: "call",
					name: typeof candidate.name === "string" ? candidate.name : "tool",
					callId,
					status: callId ? outcomes.get(callId) ?? (candidate.__toolError === true ? "failed" : candidate.__toolResult !== undefined ? "succeeded" : "pending") : "pending",
					input: formatted(candidate.arguments ?? {}),
				});
			}
		}
	} else if (typeof content === "string") {
		markdownParts.push(content);
	}

	if (role === "toolResult") {
		tools.push({
			kind: "result",
			name: typeof entry.toolName === "string" ? entry.toolName : "tool",
			callId: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
			status: entry.isError === true ? "failed" : "succeeded",
			output: markdownParts.join("\n").trim() || formatted(content),
			details: entry.details === undefined ? undefined : formatted(entry.details),
			isError: entry.isError === true,
		});
	}

	const raw: Record<string, unknown> = {
		role,
		timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
		content: visibleContent(content),
	};
	if (role === "assistant") {
		raw.provider = entry.provider;
		raw.model = entry.model;
		raw.stopReason = entry.stopReason;
	}
	if (role === "toolResult") {
		raw.toolCallId = entry.toolCallId;
		raw.toolName = entry.toolName;
		raw.isError = entry.isError;
		if (entry.details !== undefined) raw.details = visibleValue(entry.details);
	}

	return {
		markdown: markdownParts.join("\n").trim(),
		raw: JSON.stringify(raw, null, 2),
		tools,
	};
}
