/**
 * Builds learner turns for the agent from assistant-ui composer messages, and
 * decides which attachments the selected model can accept before a send.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AppendMessage } from "@assistant-ui/react";
import type { KeatingAudioContent } from "../../keating/flue/conversation";
import { modelSupportsAudio } from "../../lib/provider-models";
import { recordingHasTranscript } from "../../lib/recording-transcripts";

export type PromptContent = TextContent | ImageContent | KeatingAudioContent;

export function dataUrlToImageContent(dataUrl: string): ImageContent | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
}

export function modelSupportsImages(model: unknown): boolean {
  const input = (model as { input?: unknown })?.input;
  return Array.isArray(input) && input.includes("image");
}

export function modelDisplayName(model: unknown): string {
  const m = model as { name?: string; id?: string };
  return m?.name ?? m?.id ?? "The selected model";
}

export function visionCapabilityError(model: unknown): string {
  return `${modelDisplayName(model)} cannot read image attachments. Choose a vision-capable model from the model selector, such as Gemini Flash/Pro or GPT-4o, then send the image again.`;
}

export function audioCapabilityError(model: unknown): string {
  return `${modelDisplayName(model)} cannot listen to audio. Choose an audio-capable model, or configure transcription in Settings → Speech and transcribe the recording. To send a transcript you typed yourself, remove the audio attachment first. Your recording is kept here.`;
}

export function contentFromAppendMessage(message: AppendMessage): PromptContent[] {
  const content: PromptContent[] = [];
  for (const part of message.content) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      const image = dataUrlToImageContent(part.image);
      if (image) content.push(image);
    } else if (part.type === "file" && part.mimeType.startsWith("audio/")) {
      content.push({type: "audio", mimeType: part.mimeType, data: part.data.replace(/^data:[^,]+,/, ""), filename: part.filename});
    } else if (part.type === "file") {
      content.push({
        type: "text",
        text: `[file: ${part.filename ?? "attachment"}]\n${part.data}`,
      });
    }
  }

  for (const attachment of message.attachments ?? []) {
    for (const part of attachment.content ?? []) {
      if (part.type === "text" && part.text.trim()) {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        const image = dataUrlToImageContent(part.image);
        if (image) content.push(image);
      } else if (part.type === "file" && part.mimeType.startsWith("audio/")) {
        const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        content.push({type: "audio", mimeType: part.mimeType, data: part.data.replace(/^data:[^,]+,/, ""), filename: part.filename,
          sendToModel: recordingHasTranscript(attachment.file, text) ? false : undefined});
      } else if (part.type === "file") {
        content.push({
          type: "text",
          text: `[file: ${part.filename ?? attachment.name}]\n${part.data}`,
        });
      }
    }
  }

  return content;
}

export function makeUserMessageFromAppend(
  message: AppendMessage,
): AgentMessage | null {
  const content = contentFromAppendMessage(message);
  if (content.length === 0) return null;
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  } as AgentMessage;
}

/** A composer-shaped text message, as the send path receives it. */
export function userTextMessage(text: string): AppendMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
  } as unknown as AppendMessage;
}

export function makeUserTextMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

/**
 * Checks a learner turn against the model's inputs, in send order. Audio the
 * model can hear is marked for delivery (the message is mutated in place);
 * returns the local error to show instead of sending, or null to send.
 */
export function prepareAttachmentsForModel(
  userMessage: AgentMessage,
  model: unknown,
): string | null {
  const content = (userMessage as any).content;
  const audioParts = Array.isArray(content) ? content.filter((part: any) => part?.type === "audio") : [];
  if (audioParts.length && !modelSupportsAudio(model)) {
    if (audioParts.some((part: KeatingAudioContent) => part.sendToModel !== false)) {
      return audioCapabilityError(model);
    }
  } else if (audioParts.length) {
    for (const part of audioParts) part.sendToModel = true;
  }
  const hasImage =
    Array.isArray(content) &&
    content.some((part: any) => part?.type === "image");
  if (hasImage && !modelSupportsImages(model)) return visionCapabilityError(model);
  return null;
}
