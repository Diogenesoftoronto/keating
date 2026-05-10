import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
import ReactMarkdown from "react-markdown";
import { Bot, ChevronRight, CircleAlert, CircleCheck, CopyPlus, LibraryBig, Loader2, Send, Square, ThumbsDown, ThumbsUp, User, Wrench, X } from "lucide-react";
import type { ChatPanelHandle, ChatPanelSetupCallbacks } from "../types/chat-panel";
import { loadKeatingUiSettings, subscribeKeatingUiSettings } from "../keating/ui-settings";

interface AssistantChatPanelProps {
	className?: string;
}

function StreamingTextPart({ text, status }: { text: string; status?: { type: string } }) {
	const [visibleText, setVisibleText] = useState(text);
	const visibleLengthRef = useRef(text.length);
	const previousTextRef = useRef(text);

	useEffect(() => {
		const isGrowing = text.startsWith(previousTextRef.current);
		const shouldAnimate = status?.type === "running" && text.length > visibleLengthRef.current && isGrowing;

		previousTextRef.current = text;

		if (!shouldAnimate) {
			visibleLengthRef.current = text.length;
			setVisibleText(text);
			return;
		}

		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			visibleLengthRef.current = Math.min(text.length, visibleLengthRef.current + 3);
			setVisibleText(text.slice(0, visibleLengthRef.current));
			if (visibleLengthRef.current < text.length) {
				window.setTimeout(tick, 18);
			}
		};
		tick();

		return () => {
			cancelled = true;
		};
	}, [status?.type, text]);

	return <MarkdownText text={visibleText} isRunning={status?.type === "running" && visibleText.length >= text.length} />;
}

const artifactLinkPattern = /\[artifact:\/\/([^/]+)\/([^\]]+)\]/g;

function stripArtifactLinks(text: string): string {
	return text.replace(artifactLinkPattern, "").trim();
}

function ArtifactChips({ text }: { text: string }) {
	const matches = Array.from(text.matchAll(artifactLinkPattern));
	if (matches.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 mb-3">
			{matches.map((m, i) => {
				const type = m[1];
				const id = m[2];
				const label = type.replace(/-/g, " ");
				return (
					<button
						key={i}
						className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
						onClick={() => window.dispatchEvent(new CustomEvent("keating:open-artifact", { detail: { type, id } }))}
						title={`View ${label}`}
					>
						<LibraryBig size={12} />
						<span className="capitalize">{label}</span>
					</button>
				);
			})}
		</div>
	);
}

function MarkdownText({ text, isRunning }: { text: string; isRunning?: boolean }) {
	const cleanText = stripArtifactLinks(text);
	return (
		<div className="break-words text-sm leading-6">
			<ArtifactChips text={text} />
			{cleanText ? (
				<ReactMarkdown
					components={{
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						pre: ({ children }: any) => <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						code: ({ className, children, ...props }: any) => {
							const isInline = !className?.includes("language-");
							if (isInline) {
								return <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono" {...props}>{children}</code>;
							}
							return <code className="font-mono text-sm" {...props}>{children}</code>;
						},
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						p: ({ children }: any) => <p className="mb-3 last:mb-0">{children}</p>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						ul: ({ children }: any) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						ol: ({ children }: any) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						li: ({ children }: any) => <li className="mb-1">{children}</li>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						h1: ({ children }: any) => <h1 className="mb-2 mt-4 text-lg font-semibold">{children}</h1>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						h2: ({ children }: any) => <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						h3: ({ children }: any) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						em: ({ children }: any) => <em className="italic">{children}</em>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						a: ({ children, href }: any) => <a href={href} className="text-primary underline" target="_blank" rel="noreferrer">{children}</a>,
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						blockquote: ({ children }: any) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
					}}
				>
					{cleanText}
				</ReactMarkdown>
			) : null}
			{isRunning ? <span className="ml-0.5 animate-pulse">|</span> : null}
		</div>
	);
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

function formatToolResult(result: unknown) {
	if (result === undefined) return "";
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		const text = result
			.map((part) => {
				if (part?.type === "text" && typeof part.text === "string") return part.text;
				return "";
			})
			.filter(Boolean)
			.join("\n");
		if (text) return text;
	}
	return JSON.stringify(result, null, 2);
}

function ToolPart({ toolName, args, result, isError, status, showDetails }: { toolName: string; args?: unknown; result?: unknown; isError?: boolean; status?: { type: string }; showDetails?: boolean }) {
	const resultText = formatToolResult(result);
	const state = status?.type === "running" && result === undefined ? "running" : isError ? "error" : "success";
	const stateClass = state === "error"
		? "border-destructive/60 bg-destructive/10 text-destructive"
		: state === "running"
			? "border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-300"
			: "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
	const StateIcon = state === "error" ? CircleAlert : state === "running" ? Loader2 : CircleCheck;
	return (
		<div className={`my-2 rounded-md border-l-4 px-3 py-2 text-xs ${stateClass}`}>
			<div className="flex items-center gap-2">
				<StateIcon size={14} className={state === "running" ? "animate-spin" : ""} />
				<Wrench size={13} />
				<span className="font-medium">Tool</span>
				<span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-foreground">{toolName}</span>
				<span className="ml-auto uppercase tracking-wide">{state}</span>
			</div>
			{showDetails && args !== undefined && Object.keys(args as Record<string, unknown>).length > 0 ? (
				<details className="mt-2 text-foreground/80">
					<summary className="flex cursor-pointer list-none items-center gap-1">
						<ChevronRight size={13} />
						Arguments
					</summary>
					<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground">{JSON.stringify(args, null, 2)}</pre>
				</details>
			) : null}
			{showDetails && resultText ? (
				<div className="mt-2 text-foreground">
					<pre className="max-h-44 overflow-auto whitespace-pre-wrap font-sans leading-5">{resultText}</pre>
				</div>
			) : null}
		</div>
	);
}

function messagePartComponents(showToolUi: boolean) {
	return {
		Text: StreamingTextPart,
		Reasoning: ReasoningPart,
		tools: {
			Fallback: (props: Parameters<typeof ToolPart>[0]) => <ToolPart {...props} showDetails={showToolUi} />,
		},
	};
}

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

function foldToolResults(messages: AgentMessage[]): AgentMessage[] {
	const folded: AgentMessage[] = [];
	const assistantByToolCallId = new Map<string, any>();

	for (const message of messages) {
		const msg = message as any;
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			const clone = {
				...msg,
				content: msg.content.map((part: any) => ({ ...part })),
			};
			for (const part of clone.content) {
				if (part?.type === "toolCall" && part.id) {
					assistantByToolCallId.set(part.id, part);
				}
			}
			folded.push(clone as AgentMessage);
			continue;
		}

		if (msg.role === "toolResult") {
			const toolCall = assistantByToolCallId.get(msg.toolCallId);
			if (toolCall) {
				toolCall.__toolResult = msg.content;
				toolCall.__toolDetails = msg.details;
				toolCall.__toolError = msg.isError;
				continue;
			}
		}

		folded.push(message);
	}

	return folded;
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
						result: part.__toolResult ?? part.__toolDetails,
						isError: part.__toolError,
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

const SUGGESTED_PROMPT_GROUPS = [
	{
		label: "Learn",
		prompts: [
			"Explain quantum entanglement like I'm 12 years old.",
			"Why does gradient descent work? Walk me through the intuition.",
		],
	},
	{
		label: "Plan",
		prompts: [
			"Plan a 4-week course on machine learning fundamentals.",
			"Create a study roadmap for passing the AWS Solutions Architect exam.",
		],
	},
	{
		label: "Map",
		prompts: [
			"Draw a concept map connecting probability, statistics, and linear algebra.",
			"Map the evolution of web development from HTML to modern React frameworks.",
		],
	},
	{
		label: "Assess",
		prompts: [
			"Quiz me on the Krebs cycle. Test deeper understanding, not memorization.",
			"Evaluate my understanding of async/await in JavaScript from scratch.",
		],
	},
	{
		label: "Create",
		prompts: [
			"Animate how DNS resolution works step by step.",
			"Generate spaced-repetition flashcards for Spanish verb conjugations.",
		],
	},
];

function SuggestedPrompts({ onSelect }: { onSelect: (text: string) => void }) {
	return (
		<div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 px-4">
			<div className="text-sm text-muted-foreground font-terminal mb-2">Start a conversation</div>
			<div className="flex flex-wrap justify-center gap-2">
				{SUGGESTED_PROMPT_GROUPS.map((group) =>
					group.prompts.map((prompt) => (
						<button
							key={prompt}
							type="button"
							onClick={() => onSelect(prompt)}
							className="rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-colors text-left max-w-xs"
							title={prompt}
						>
							<span className="font-medium uppercase tracking-wide mr-1.5 text-[10px]">{group.label}</span>
							{prompt}
						</button>
					))
				)}
			</div>
		</div>
	);
}

function AssistantThread({ agent, callbacks, version }: { agent: Agent | null; callbacks: ChatPanelSetupCallbacks; version: number }) {
	const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
	const messages = useMemo(() => foldToolResults([...(agent?.state.messages ?? [])]), [agent, version]);
	const components = useMemo(() => messagePartComponents(uiSettings.showToolUi), [uiSettings.showToolUi]);
	const isRunning = agent?.state.isStreaming ?? false;
	const modelRef = useRef(agent?.state.model);
	if (agent) modelRef.current = agent.state.model;

	const convertMessage = useCallback(
		(message: AgentMessage, index: number) => toAssistantMessage(message, index, isRunning),
		[isRunning],
	);

	const sendText = useCallback(
		async (text: string) => {
			if (!agent || !text.trim()) return;
			const provider = agent.state.model.provider;
			if (callbacks.onApiKeyRequired && !(await callbacks.onApiKeyRequired(provider))) return;
			await callbacks.onBeforeSend?.();
			await agent.prompt(text);
		},
		[agent, callbacks],
	);

	const onNew = useCallback(
		async (message: AppendMessage) => {
			const text = textFromAppendMessage(message);
			if (text) await sendText(text);
		},
		[sendText],
	);

	const onCancel = useCallback(async () => {
		agent?.abort();
	}, [agent]);

	const storeAdapter = useMemo(
		() => ({
			messages,
			isRunning,
			convertMessage,
			onNew,
			onCancel,
		}),
		[messages, isRunning, convertMessage, onNew, onCancel],
	);

	const runtime = useExternalStoreRuntime<AgentMessage>(storeAdapter);
	const modelLabel = modelRef.current?.name ?? modelRef.current?.id ?? "Model";

	useEffect(() => subscribeKeatingUiSettings(setUiSettings), []);

	const UserMessageComponent = useCallback(() => <UserMessage components={components} />, [components]);
	const AssistantMessageComponent = useCallback(
		() => <AssistantMessage components={components} onFork={callbacks.onFork} />,
		[components, callbacks.onFork],
	);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background text-foreground">
				<ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
					<AuiIf condition={(state) => state.thread.isEmpty}>
						<SuggestedPrompts onSelect={sendText} />
					</AuiIf>
					<ThreadPrimitive.Messages components={{ UserMessage: UserMessageComponent, AssistantMessage: AssistantMessageComponent }} />
					<ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-background/95 pt-3 backdrop-blur">
						<ComposerPrimitive.Root className="composer-root mx-auto flex w-full max-w-3xl items-end gap-1.5 sm:gap-2 rounded-lg border border-border bg-background p-2 shadow-sm">
							<button
								type="button"
								className="mb-1 inline-flex max-w-20 shrink-0 truncate rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:max-w-36"
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

function UserMessage({ components }: { components: ReturnType<typeof messagePartComponents> }) {
	return (
		<MessagePrimitive.Root className="mx-auto mb-4 flex max-w-3xl justify-end">
			<div className="flex max-w-[88%] gap-3 rounded-lg border-2 border-primary bg-primary px-4 py-3 text-sm text-primary-foreground sm:max-w-[82%]">
				<User className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0 whitespace-pre-wrap leading-6">
					<MessagePrimitive.Content components={components} />
				</div>
			</div>
		</MessagePrimitive.Root>
	);
}

function FeedbackModal({
	open,
	type,
	onClose,
	onSubmit,
}: {
	open: boolean;
	type: "up" | "down";
	onClose: () => void;
	onSubmit: (type: "up" | "down", comment: string) => void;
}) {
	const [comment, setComment] = useState("");

	useEffect(() => {
		if (open) setComment("");
	}, [open]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
			<div
				className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-semibold text-foreground">
						{type === "up" ? "What was helpful?" : "What could be improved?"}
					</h3>
					<button
						type="button"
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						onClick={onClose}
						aria-label="Close"
					>
						<X size={14} />
					</button>
				</div>
				<textarea
					className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground resize-none"
					rows={4}
					placeholder="Optional comment..."
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					autoFocus
				/>
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						onClick={onClose}
					>
						Skip
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
						onClick={() => onSubmit(type, comment)}
					>
						Submit
					</button>
				</div>
			</div>
		</div>
	);
}

function AssistantMessage({
	components,
	onFork,
}: {
	components: ReturnType<typeof messagePartComponents>;
	onFork?: () => void | Promise<void>;
}) {
	const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
	const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
	const [feedbackType, setFeedbackType] = useState<"up" | "down">("up");

	const handleFeedbackClick = (type: "up" | "down") => {
		setFeedbackType(type);
		setFeedbackModalOpen(true);
	};

	const handleFeedbackSubmit = (type: "up" | "down", comment: string) => {
		setFeedback(type);
		setFeedbackModalOpen(false);
		try {
			window.dispatchEvent(
				new CustomEvent("keating:message-feedback", {
					detail: { type, comment },
				}),
			);
		} catch {
			/* noop */
		}
	};

	return (
		<>
			<MessagePrimitive.Root className="group mx-auto mb-4 flex max-w-3xl justify-start">
				<div className="flex max-w-[94%] gap-3 rounded-lg border-2 border-border bg-muted/30 px-4 py-3 text-sm text-foreground shadow-sm sm:max-w-[90%]">
					<Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
					<div className="min-w-0 leading-6 flex-1">
						<MessagePrimitive.Content components={components} />
						<div className="mt-2 flex items-center gap-1">
							<button
								type="button"
								className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
									feedback === "up"
										? "bg-primary/20 text-primary"
										: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
								title="Helpful"
								onClick={() => handleFeedbackClick("up")}
								aria-pressed={feedback === "up"}
							>
								<ThumbsUp size={13} />
							</button>
							<button
								type="button"
								className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
									feedback === "down"
										? "bg-destructive/20 text-destructive"
										: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
								}`}
								title="Not helpful"
								onClick={() => handleFeedbackClick("down")}
								aria-pressed={feedback === "down"}
							>
								<ThumbsDown size={13} />
							</button>
							{onFork && (
								<button
									type="button"
									className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all opacity-0 group-hover:opacity-100"
									title="Fork session"
									onClick={onFork}
									aria-label="Fork session"
								>
									<CopyPlus size={13} />
								</button>
							)}
						</div>
					</div>
				</div>
			</MessagePrimitive.Root>
			<FeedbackModal
				open={feedbackModalOpen}
				type={feedbackType}
				onClose={() => setFeedbackModalOpen(false)}
				onSubmit={handleFeedbackSubmit}
			/>
		</>
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
