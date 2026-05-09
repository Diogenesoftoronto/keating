import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import {
	AssistantRuntimeProvider,
	AuiIf,
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	type AppendMessage,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { Send, Square, Bot, User } from "lucide-react";
import type { ChatPanelHandle, ChatPanelSetupCallbacks } from "../types/chat-panel";

interface AssistantChatPanelProps {
	className?: string;
}

function TextPart({ text }: { text: string }) {
	return <span>{text}</span>;
}

function ReasoningPart({ text }: { text: string }) {
	if (!text.trim()) return null;
	return (
		<details className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			<summary className="cursor-pointer font-medium">Reasoning</summary>
			<div className="mt-2 whitespace-pre-wrap">{text}</div>
		</details>
	);
}

function ToolPart({ toolName, args, result, isError }: { toolName: string; args?: unknown; result?: unknown; isError?: boolean }) {
	return (
		<div className={`my-3 rounded-md border px-3 py-2 text-xs ${isError ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}>
			<div className="font-medium text-muted-foreground">Tool: {toolName}</div>
			{args !== undefined && (
				<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground">{JSON.stringify(args, null, 2)}</pre>
			)}
			{result !== undefined && (
				<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-foreground">{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre>
			)}
		</div>
	);
}

const messagePartComponents = {
	Text: TextPart,
	Reasoning: ReasoningPart,
	tools: {
		Fallback: ToolPart,
	},
};

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (part?.type === "text" && typeof part.text === "string") return part.text;
			if (part?.type === "thinking" && typeof part.thinking === "string") return part.thinking;
			if (part?.type === "image") return "[image]";
			if (part?.type === "toolCall") return `[tool: ${part.name ?? "unknown"}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

function toAssistantMessage(message: AgentMessage, index: number, isRunning: boolean): ThreadMessageLike {
	const msg = message as any;
	const timestamp = typeof msg.timestamp === "number" ? new Date(msg.timestamp) : new Date();
	const status = isRunning && msg.role === "assistant"
		? { type: "running" as const }
		: msg.stopReason === "error"
			? { type: "incomplete" as const, reason: "error" as const, error: msg.errorMessage ?? "Assistant response failed" }
			: msg.stopReason === "aborted"
				? { type: "incomplete" as const, reason: "cancelled" as const }
				: { type: "complete" as const, reason: "stop" as const };

	if (msg.role === "assistant") {
		const content = Array.isArray(msg.content)
			? msg.content.map((part: any) => {
				if (part?.type === "thinking") return { type: "reasoning" as const, text: part.thinking ?? "" };
				if (part?.type === "toolCall") {
					return {
						type: "tool-call" as const,
						toolCallId: part.id ?? `tool-${index}`,
						toolName: part.name ?? "tool",
						args: part.arguments ?? {},
						argsText: JSON.stringify(part.arguments ?? {}),
					};
				}
				return { type: "text" as const, text: part?.text ?? "" };
			})
			: [{ type: "text" as const, text: textFromContent(msg.content) }];
		return { id: `assistant-${index}-${msg.timestamp ?? ""}`, role: "assistant", createdAt: timestamp, status, content };
	}

	if (msg.role === "toolResult") {
		const summary = textFromContent(msg.content) || JSON.stringify(msg.details ?? {}, null, 2);
		return {
			id: `tool-${index}-${msg.toolCallId ?? ""}`,
			role: "assistant",
			createdAt: timestamp,
			status: msg.isError ? { type: "incomplete", reason: "error", error: summary } : { type: "complete", reason: "stop" },
			content: [{ type: "text", text: `Tool ${msg.toolName ?? "result"}:\n${summary}` }],
		};
	}

	return {
		id: `user-${index}-${msg.timestamp ?? ""}`,
		role: "user",
		createdAt: timestamp,
		content: textFromContent(msg.content),
	};
}

function textFromAppendMessage(message: AppendMessage): string {
	return message.content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "image") return "[image]";
			if (part.type === "file") return `[file: ${part.filename ?? "attachment"}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

function AssistantThread({ agent, callbacks, version }: { agent: Agent | null; callbacks: ChatPanelSetupCallbacks; version: number }) {
	const messages = useMemo(() => [...(agent?.state.messages ?? [])], [agent, version]);
	const runtime = useExternalStoreRuntime<AgentMessage>({
		messages,
		isRunning: agent?.state.isStreaming ?? false,
		convertMessage: (message, index) => toAssistantMessage(message, index, agent?.state.isStreaming ?? false),
		onNew: async (message) => {
			if (!agent) return;
			const text = textFromAppendMessage(message);
			if (!text) return;
			const provider = agent.state.model.provider;
			if (callbacks.onApiKeyRequired && !(await callbacks.onApiKeyRequired(provider))) return;
			await callbacks.onBeforeSend?.();
			await agent.prompt(text);
		},
		onCancel: async () => {
			agent?.abort();
		},
	});
	const modelLabel = agent?.state.model.name ?? agent?.state.model.id ?? "Model";

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background text-foreground">
				<ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
					<AuiIf condition={(state) => state.thread.isEmpty}>
						<div className="mx-auto flex h-full max-w-2xl items-center justify-center text-sm text-muted-foreground">
							Start a conversation with Keating.
						</div>
					</AuiIf>
					<ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
					<ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-background/95 pt-3 backdrop-blur">
						<ComposerPrimitive.Root className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-border bg-background p-2 shadow-sm">
							<button
								type="button"
								className="mb-1 max-w-36 truncate rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
								disabled={!callbacks.onModelSelect}
								onClick={() => callbacks.onModelSelect?.()}
								title={modelLabel}
							>
								{modelLabel}
							</button>
							<ComposerPrimitive.Input
								className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
								placeholder="Message Keating"
								rows={1}
							/>
							<ComposerPrimitive.Cancel className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
								<Square size={16} />
							</ComposerPrimitive.Cancel>
							<ComposerPrimitive.Send className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50">
								<Send size={16} />
							</ComposerPrimitive.Send>
						</ComposerPrimitive.Root>
					</ThreadPrimitive.ViewportFooter>
				</ThreadPrimitive.Viewport>
			</ThreadPrimitive.Root>
		</AssistantRuntimeProvider>
	);
}

function UserMessage() {
	return (
		<MessagePrimitive.Root className="mx-auto mb-4 flex max-w-3xl justify-end">
			<div className="flex max-w-[82%] gap-3 rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground">
				<User className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0 whitespace-pre-wrap leading-6">
					<MessagePrimitive.Content components={messagePartComponents} />
				</div>
			</div>
		</MessagePrimitive.Root>
	);
}

function AssistantMessage() {
	return (
		<MessagePrimitive.Root className="mx-auto mb-4 flex max-w-3xl justify-start">
			<div className="flex max-w-[90%] gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-card-foreground">
				<Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
				<div className="min-w-0 whitespace-pre-wrap leading-6">
					<MessagePrimitive.Content components={messagePartComponents} />
				</div>
			</div>
		</MessagePrimitive.Root>
	);
}

export const AssistantChatPanel = forwardRef<ChatPanelHandle, AssistantChatPanelProps>(({ className }, ref) => {
	const [agent, setAgentState] = useState<Agent | null>(null);
	const [callbacks, setCallbacks] = useState<ChatPanelSetupCallbacks>({});
	const [version, setVersion] = useState(0);

	const refresh = useCallback(() => setVersion((current) => current + 1), []);

	useImperativeHandle(ref, () => ({
		async setAgent(nextAgent, nextCallbacks = {}) {
			setAgentState(nextAgent);
			setCallbacks(nextCallbacks);
			refresh();
		},
	}), [refresh]);

	return (
		<div className={className}>
			<AgentSubscription agent={agent} onChange={refresh} />
			<AssistantThread agent={agent} callbacks={callbacks} version={version} />
		</div>
	);
});

AssistantChatPanel.displayName = "AssistantChatPanel";

function AgentSubscription({ agent, onChange }: { agent: Agent | null; onChange: () => void }) {
	useEffect(() => {
		if (!agent) return undefined;
		const unsubscribe = agent.subscribe(() => onChange());
		onChange();
		return unsubscribe;
	}, [agent, onChange]);
	return null;
}
