/**
 * Runs a portable subagent delegation in a throwaway browser conversation and
 * returns its final assistant text.
 */
import flueRuntimeUrl from "virtual:keating-flue-runtime";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { PortableAgentInstance } from "@keating/agent-runtime";
import { FlueConversation } from "../../keating/flue/conversation";
import { toModelMessages } from "../../keating/flue/model-messages";
import type { DelegationRequest } from "../../keating/portable-agent";
import { getProviderApiKey } from "../../lib/provider-models";
import { hybridStreamFn } from "../keating-stream";

export async function runPortableBrowserDelegate(
  request: DelegationRequest,
  model: Model<Api>,
  thinkingLevel: ThinkingLevel,
  signal?: AbortSignal,
): Promise<string> {
  const instance = new PortableAgentInstance({
    id: `browser-delegate-${crypto.randomUUID()}`,
  });
  const frame = instance.render(request.subagent.agent);
  const child = new FlueConversation({
    initialState: {
      model,
      thinkingLevel,
      messages: [],
      tools: [],
      systemPrompt: frame.system,
    },
    convertToLlm: toModelMessages,
    streamFn: hybridStreamFn,
    sessionId: `delegate-${crypto.randomUUID()}`,
  }, flueRuntimeUrl);
  child.getApiKey = (provider: string) => getProviderApiKey(provider);
  const abort = () => child.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await child.send(request.task);
  } finally {
    signal?.removeEventListener("abort", abort);
    await child.dispose();
  }
  const output = lastAssistantText(child.context.messages);
  if (!output) throw new Error(`Portable subagent ${request.subagent.name} returned no text.`);
  return output;
}

export function lastAssistantText(messages: readonly AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as {
      role?: unknown;
      content?: unknown;
    };
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          Boolean(
            part &&
              typeof part === "object" &&
              (part as { type?: unknown }).type === "text" &&
              typeof (part as { text?: unknown }).text === "string",
          ),
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}
