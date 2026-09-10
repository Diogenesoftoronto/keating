import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FlueConversation } from "../keating/flue/conversation";

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string")
        return part.text;
      if (part?.type === "thinking" && typeof part.thinking === "string")
        return part.thinking;
      if (part?.type === "reasoning" && typeof part.text === "string")
        return part.text;
      if (part?.type === "image") return "[image]";
      if (part?.type === "toolCall") return `[tool: ${part.name ?? "unknown"}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

type AssistantTextPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string };

const THINK_TAG_PATTERN = /<\/?think(?:ing)?>/gi;

export function assistantTextParts(text: string): AssistantTextPart[] {
  if (!text) return [{ type: "text", text: "" }];

  // Some OpenAI-compatible reasoning models leak malformed closing tags without
  // a matching opening tag. When that happens, the safest behavior is to treat
  // everything before the final closing tag as hidden reasoning and only render
  // the post-close tail as the learner-visible answer.
  if (!/<think(?:ing)?>/i.test(text) && /<\/think(?:ing)?>/i.test(text)) {
    const matches = [...text.matchAll(/<\/think(?:ing)?>/gi)];
    const last = matches.at(-1);
    if (last && typeof last.index === "number") {
      const reasoning = text.slice(0, last.index).trim();
      const visible = text.slice(last.index + last[0].length).trim();
      const parts: AssistantTextPart[] = [];
      if (reasoning) parts.push({ type: "reasoning", text: reasoning });
      if (visible) parts.push({ type: "text", text: visible });
      return parts.length > 0 ? parts : [{ type: "text", text: "" }];
    }
  }

  const parts: AssistantTextPart[] = [];
  let cursor = 0;
  let reasoningStart: number | null = null;

  for (const match of text.matchAll(THINK_TAG_PATTERN)) {
    const tag = match[0].toLowerCase();
    const tagIndex = match.index ?? 0;
    if (!tag.startsWith("</")) {
      if (reasoningStart === null) {
        const visible = text.slice(cursor, tagIndex);
        if (visible) parts.push({ type: "text", text: visible });
        reasoningStart = tagIndex + match[0].length;
        cursor = reasoningStart;
      }
      continue;
    }

    if (reasoningStart !== null) {
      const reasoning = text.slice(reasoningStart, tagIndex);
      if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning });
      cursor = tagIndex + match[0].length;
      reasoningStart = null;
    }
  }

  if (reasoningStart !== null) {
    const reasoning = text.slice(reasoningStart);
    if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning });
    return parts.length > 0 ? parts : [{ type: "text", text: "" }];
  }

  const tail = text.slice(cursor);
  if (tail) parts.push({ type: "text", text: tail });
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

export function hasUserTextMessage(messages: AgentMessage[], text: string): boolean {
  const normalized = text.trim();
  return messages.some((message) => {
    const msg = message as any;
    if (msg.role !== "user" && msg.role !== "user-with-attachments")
      return false;
    return textFromContent(msg.content).trim() === normalized;
  });
}

export function makeAttachmentErrorMessage(
  agent: FlueConversation,
  errorMessage: string,
): AgentMessage {
  return {
    role: "assistant",
    content: [],
    api: agent.context.model.api,
    provider: agent.context.model.provider,
    model: agent.context.model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  } as AgentMessage;
}

function errorMessageText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function makePromptErrorMessage(agent: FlueConversation, error: unknown): AgentMessage {
  return makeAttachmentErrorMessage(agent, errorMessageText(error));
}

export function recordCredentialBlockedSend(
  agent: FlueConversation,
  userMessage: AgentMessage,
  provider: string,
): void {
  const userText = textFromContent((userMessage as any).content);
  if (!userText || !hasUserTextMessage(agent.context.messages, userText)) {
    agent.context.messages.push(userMessage);
  }
  agent.context.messages.push(
    makePromptErrorMessage(
      agent,
      new Error(
        `Authentication error: no credentials are available for ${provider}. Open Settings → Providers & Models, connect the provider, then retry this message.`,
      ),
    ),
  );
}

export function mergeConsecutiveAssistantMessages(
  messages: AgentMessage[],
): AgentMessage[] {
  const merged: AgentMessage[] = [];
  for (const message of messages) {
    const msg = message as any;
    if (msg.role === "assistant" && merged.length > 0) {
      const last = merged[merged.length - 1] as any;
      if (last.role === "assistant") {
        const left = Array.isArray(last.content)
          ? last.content.map((p: any) => ({ ...p }))
          : [{ type: "text", text: textFromContent(last.content) }];
        const right = Array.isArray(msg.content)
          ? msg.content.map((p: any) => ({ ...p }))
          : [{ type: "text", text: textFromContent(msg.content) }];
        last.content = [...left, ...right];
        if (msg.timestamp) last.timestamp = msg.timestamp;
        if (msg.stopReason !== undefined) last.stopReason = msg.stopReason;
        if (msg.errorMessage) {
          last.errorMessage = msg.errorMessage;
          last.stopReason = msg.stopReason ?? last.stopReason;
        }
        if (msg.__keatingStreaming)
          last.__keatingStreaming = msg.__keatingStreaming;
        continue;
      }
    }
    merged.push({ ...msg, ...(Array.isArray(msg.content) ? { content: msg.content.map((part: any) => ({ ...part })) } : {}) });
  }
  return merged;
}
