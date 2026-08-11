import type { ChatMessage } from "./types";

/** Keep meaningful trace-only assistant turns while hiding an empty streaming placeholder. */
export function isChatMessageVisible(message: ChatMessage): boolean {
  return message.content.length > 0
    || Boolean(message.attachments?.length)
    || Boolean(message.agentEvents?.length);
}
