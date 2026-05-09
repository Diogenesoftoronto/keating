import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

export interface SessionUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export interface SessionMetadata {
	id: string;
	title: string;
	createdAt: string;
	lastModified: string;
	messageCount: number;
	usage: SessionUsage;
	thinkingLevel: ThinkingLevel;
	preview: string;
}

export interface SessionData {
	id: string;
	title: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	createdAt: string;
	lastModified: string;
}

