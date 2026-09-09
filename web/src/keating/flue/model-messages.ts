import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

/** Persisted formats from older Keating sessions, independent of any UI kit. */
export interface SavedAttachment {
  type: "image" | "document";
  content: string;
  mimeType: string;
  fileName: string;
  extractedText?: string;
}

export interface SavedAttachmentMessage {
  role: "user-with-attachments";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
  attachments?: SavedAttachment[];
}

export interface SavedArtifactMessage {
  role: "artifact";
  action: "create" | "update" | "delete";
  filename: string;
  content?: string;
  title?: string;
  timestamp: string;
}

declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    "user-with-attachments": SavedAttachmentMessage;
    artifact: SavedArtifactMessage;
  }
}

/** Prepare a provider request without modifying the saved conversation. */
export function toModelMessages(messages: AgentMessage[]): Message[] {
  const result: Message[] = [];
  for (const message of messages) {
    if (message.role === "user-with-attachments") {
      const content: (TextContent | ImageContent)[] = typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [...message.content];
      for (const attachment of message.attachments ?? []) {
        if (attachment.type === "image") {
          content.push({ type: "image", data: attachment.content, mimeType: attachment.mimeType });
        } else if (attachment.extractedText) {
          content.push({ type: "text", text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}` });
        }
      }
      result.push({ role: "user", content, timestamp: message.timestamp });
    } else if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      result.push(message);
    }
    // Artifacts and other UI-only records never become provider messages.
  }
  return result;
}
