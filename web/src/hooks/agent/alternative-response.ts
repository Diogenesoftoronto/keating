/**
 * Occasional counterfactual replies for preference learning. After a turn, a
 * configurable fraction of replies are regenerated from the same branch and
 * stored as a hidden alternative session the learner can compare against.
 */
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { FlueConversation } from "../../keating/flue/conversation";
import {
  branchBeforeAssistantTurn,
  canGenerateAlternativeFromBranch,
  lastAssistantTimestamp,
  shouldGenerateAlternativeResponse,
} from "../../keating/alternative-responses";
import {
  buildPendingResponseComparison,
  type PendingResponseComparison,
} from "../../keating/response-comparison";
import { loadKeatingUiSettings } from "../../keating/ui-settings";
import { getProviderApiKey } from "../../lib/provider-models";
import type { SessionData, SessionMetadata } from "../../types/session";
import { hybridStreamFn } from "../keating-stream";
import { sessions } from "../keating-storage";
import {
  cloneMessages,
  createSessionId,
  sessionModelMetadata,
  sessionPreview,
  sessionSearchText,
  sessionTitle,
  sessionUsage,
} from "../session-metadata";
import { loadBrowserModel } from "./browser-model";

/** Visible text of a generated reply, or "" when it failed or has none. */
export function usableAlternativeText(alternative: AgentMessage): string {
  const alternativeContent = (alternative as any).content;
  const text = Array.isArray(alternativeContent)
    ? alternativeContent
        .filter(
          (part: any) =>
            part?.type === "text" && typeof part.text === "string",
        )
        .map((part: any) => part.text)
        .join("")
        .trim()
    : "";
  if (
    (alternative as any).stopReason === "error" ||
    (alternative as any).stopReason === "aborted"
  )
    return "";
  return text;
}

/** The hidden alternative session: the shared branch plus the regenerated reply. */
export function alternativeSessionRecord({
  id,
  now,
  sourceSessionId,
  branchMessages,
  alternative,
  assistantTimestamp,
  model,
  thinkingLevel,
}: {
  id: string;
  now: string;
  sourceSessionId: string;
  branchMessages: AgentMessage[];
  alternative: AgentMessage;
  assistantTimestamp: number;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
}): { data: SessionData; metadata: SessionMetadata } {
  const messages = [...branchMessages, alternative];
  const title = `${sessionTitle(branchMessages) || "Alternative response"} (alternative)`;
  const metadata: SessionMetadata = {
    id,
    title,
    parentSessionId: sourceSessionId,
    forkedAt: now,
    forkedFromMessageTimestamp: assistantTimestamp,
    createdAt: now,
    lastModified: now,
    messageCount: messages.length,
    usage: sessionUsage(messages),
    thinkingLevel,
    ...sessionModelMetadata(model),
    preview: sessionPreview(messages),
    searchText: sessionSearchText(messages),
    aiGeneratedTitle: false,
    generatedAlternative: true,
    hiddenAlternative: true,
    alternativeForMessageTimestamp: assistantTimestamp,
  };
  const data: SessionData = {
    id,
    title,
    parentSessionId: sourceSessionId,
    forkedAt: now,
    forkedFromMessageTimestamp: assistantTimestamp,
    model,
    thinkingLevel,
    messages,
    createdAt: now,
    lastModified: now,
    aiGeneratedTitle: false,
    generatedAlternative: true,
    hiddenAlternative: true,
    alternativeForMessageTimestamp: assistantTimestamp,
  };
  return { data, metadata };
}

/**
 * Generates and stores at most one alternative per reply. `generated` holds
 * the `${session}:${timestamp}` keys already attempted by this hook instance.
 */
export async function maybeGenerateAlternativeResponse({
  agent,
  sourceSessionId,
  isActiveSession,
  generated,
  onComparison,
}: {
  agent: FlueConversation;
  sourceSessionId: string;
  isActiveSession: () => boolean;
  generated: Set<string>;
  onComparison: (comparison: PendingResponseComparison | null) => void;
}): Promise<void> {
  if (!isActiveSession()) return;
  const settings = loadKeatingUiSettings();
  if (
    !shouldGenerateAlternativeResponse(settings.alternativeResponseChance)
  )
    return;

  const sourceMessages = cloneMessages(agent.context.messages);
  const assistantTimestamp = lastAssistantTimestamp(sourceMessages);
  if (assistantTimestamp == null) return;
  const generationKey = `${sourceSessionId}:${assistantTimestamp}`;
  if (generated.has(generationKey)) return;

  const branchMessages = branchBeforeAssistantTurn(
    sourceMessages,
    assistantTimestamp,
  );
  if (!canGenerateAlternativeFromBranch(branchMessages)) return;
  generated.add(generationKey);

  const model = agent.context.model as Model<Api>;
  try {
    if (model.provider === "browser") {
      await loadBrowserModel(model.id);
    } else if (!(await getProviderApiKey(model.provider))) {
      return;
    }
    const stream = await hybridStreamFn(
      model,
      {
        systemPrompt: agent.context.systemPrompt,
        messages: branchMessages as unknown as Context["messages"],
      },
      {
        temperature: 0.85,
      },
    );
    const streamedAlternative = (await stream.result()) as AgentMessage;
    const alternative =
      typeof (streamedAlternative as { timestamp?: unknown }).timestamp ===
      "number"
        ? streamedAlternative
        : ({
            ...streamedAlternative,
            timestamp: Date.now(),
          } as AgentMessage);
    if (!usableAlternativeText(alternative)) return;

    const now = new Date().toISOString();
    const id = createSessionId();
    const { data, metadata } = alternativeSessionRecord({
      id,
      now,
      sourceSessionId,
      branchMessages,
      alternative,
      assistantTimestamp,
      model: agent.context.model,
      thinkingLevel: agent.context.thinkingLevel,
    });
    await sessions.save(data, metadata);
    const source = (await sessions.loadSession(
      sourceSessionId,
    )) as SessionData | null;
    if (source)
      onComparison(buildPendingResponseComparison(source, data));
    window.dispatchEvent(
      new CustomEvent("keating:sessions-changed", {
        detail: {
          sessionId: id,
          parentSessionId: sourceSessionId,
          generatedAlternative: true,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("keating:dpo-alternative-created", {
        detail: { sessionId: id, parentSessionId: sourceSessionId },
      }),
    );
  } catch (error) {
    console.warn("Failed to generate DPO alternative response:", error);
  }
}
