/**
 * Model-suggested session titles: the request sent to the chat model and the
 * clean-up applied to its reply. Used for automatic titles after two learner
 * exchanges and for the session browser's "suggest title" action.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { hybridStreamFn } from "../keating-stream";
import { sessionPreview } from "../session-metadata";

export const SESSION_TITLE_SYSTEM_PROMPT =
  "You rename learning chat sessions. Return only a concise, specific title. No quotes. No punctuation-only titles. Maximum 7 words.";

export function cleanSuggestedTitle(text: string) {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^title:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function sessionTitleContext(
  messages: AgentMessage[],
  currentTitle: string,
  now: () => number = Date.now,
): Context {
  return {
    systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        timestamp: now(),
        content: `Conversation preview:\n${sessionPreview(messages).slice(0, 2400)}\n\nCurrent title: ${currentTitle}`,
      },
    ],
  };
}

/** Asks the model for a title; returns "" when the reply has no usable text. */
export async function requestSessionTitle(
  model: Model<Api>,
  apiKey: string | undefined,
  messages: AgentMessage[],
  currentTitle: string,
): Promise<string> {
  const stream = await hybridStreamFn(model, sessionTitleContext(messages, currentTitle), {
    apiKey,
    maxTokens: 32,
    temperature: 0.2,
    reasoning: "minimal",
  });
  const message = await stream.result();
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  return cleanSuggestedTitle(text);
}
