import type { ChatMessage } from "./types";

export const OFFLINE_MODEL = {
  id: "minicpm5-2b-int4",
  name: "MiniCPM5 2B",
  bytes: 1_553_670_064,
  sha256: "9858563beafbc6d5e0d25fcee3827541515296a9302ed3d088b16a58d4fbe7b8",
  url: "https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT/resolve/02e8a867ae318e633f2372ac81fc78dc4d8448e7/MiniCPM5-2B_int4.litertlm",
  runtimeVersion: "0.16.0",
} as const;

export const GEMMA_OFFLINE_MODEL = {
  id: "gemma-4-e4b", name: "Gemma 4 E4B", bytes: 3_659_530_240,
  sha256: "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0",
  url: "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it.litertlm",
  runtimeVersion: "0.16.0",
} as const;
export const OFFLINE_MODELS = [OFFLINE_MODEL, GEMMA_OFFLINE_MODEL] as const;
export type OfflineModelSpec = typeof OFFLINE_MODELS[number];
export function getOfflineModel(id: string): OfflineModelSpec {
  const model = OFFLINE_MODELS.find(model => model.id === id);
  if (!model) throw new Error("Choose MiniCPM5 or Gemma 4 E4B from the offline model options in Settings.");
  return model;
}
/** Validate before attachment hydration; keep MiniCPM's existing modality boundary. */
export function assertOfflineModelMedia(messages: readonly ChatMessage[], modelId: string): void {
  if (getOfflineModel(modelId).id === OFFLINE_MODEL.id) { assertOfflineMedia(messages); return; }
  let mediaBytes = 0; let mediaCount = 0; let images = 0;
  for (const message of messages) for (const file of message.attachments ?? []) {
    if (file.mimeType.startsWith("image/") || file.mimeType.startsWith("audio/")) {
      mediaBytes += file.size; mediaCount++; if (file.mimeType.startsWith("image/")) images++;
      if (!Number.isFinite(file.size) || file.size <= 0 || mediaBytes > 16 * 1024 * 1024 || mediaCount > 4 || images > 2) throw new Error("The offline phone lesson supports up to 2 images, 4 media attachments and 16 MiB of media in total. Start a new lesson or use smaller files.");
      if (file.data !== undefined && (file.encoding !== "base64" || file.data.length > Math.ceil(file.size / 3) * 4 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(file.data))) throw new Error("Offline media bytes do not match their saved size. Reattach the file and retry.");
    }
    if (file.mimeType === "application/pdf" || (!file.mimeType.startsWith("image/") && !file.mimeType.startsWith("audio/") && file.encoding === "base64")) {
      throw new Error("Gemma can read images, audio and text documents offline. Extract this document as text before attaching it.");
    }
    if (file.mimeType.startsWith("audio/") && !["audio/wav", "audio/x-wav", "audio/wave"].includes(file.mimeType)) throw new Error("Attach WAV audio for Gemma offline listening on this phone.");
    if ((file.mimeType.startsWith("image/") || file.mimeType.startsWith("audio/")) && file.size > 16 * 1024 * 1024) {
      throw new Error("Use an image or audio recording under 16 MiB for the offline tutor on a phone.");
    }
  }
}
export type OfflineContent = { type: "text"; text: string } | { type: "image" | "audio"; blob: string };
export function offlineMultimodalMessages(messages: readonly ChatMessage[]): Array<{ role: "user" | "assistant"; content: OfflineContent[] }> {
  assertOfflineModelMedia(messages, GEMMA_OFFLINE_MODEL.id);
  return messages.map(message => ({ role: message.role, content: [
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...(message.attachments ?? []).map((file): OfflineContent => {
      if (file.data === undefined) throw new Error(`${file.name} could not be read. Reattach it and retry.`);
      if (file.mimeType.startsWith("image/") || file.mimeType.startsWith("audio/")) {
        if (file.encoding !== "base64") throw new Error(`${file.name} requires encoded image or audio bytes.`);
        return { type: file.mimeType.startsWith("image/") ? "image" : "audio", blob: file.data };
      }
      return { type: "text", text: `<attachment name=${JSON.stringify(file.name)}>\n${file.data}\n</attachment>` };
    }),
  ] })).filter(message => message.content.length);
}

export type OfflinePhase = "unavailable" | "checking" | "absent" | "downloading" | "paused" | "verifying" | "ready" | "error";
export interface OfflineState {
  phase: OfflinePhase;
  bytes: number;
  freeBytes: number;
  error: string | null;
}

/** Fail before loading attachment bytes; never silently discard a modality. */
export function assertOfflineMedia(messages: readonly ChatMessage[]): void {
  for (const message of messages) for (const file of message.attachments ?? []) {
    if (file.kind === "image" || file.mimeType.startsWith("image/")) {
      throw new Error("MiniCPM5 is text only and cannot read images. Choose a vision model in the model selector, or remove the image and describe it in text. Your attachment is saved for retry.");
    }
    if (file.mimeType.startsWith("audio/")) {
      throw new Error("MiniCPM5 is text only and cannot hear audio. Configure OpenAI or Google transcription in Settings and dictate the message, or type it instead.");
    }
    if (file.mimeType === "application/pdf" || file.encoding === "base64") {
      throw new Error("MiniCPM5 can read text documents, but cannot read this file directly. Attach extracted text or choose a model that supports this document.");
    }
  }
}

export function offlineMessages(messages: readonly ChatMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  assertOfflineMedia(messages);
  return messages.map((message) => ({
    role: message.role,
    content: [message.content, ...(message.attachments ?? []).map((file) => {
      if (file.encoding !== "text" || file.data === undefined) throw new Error(`${file.name} could not be read. Reattach the text document and retry.`);
      return `<attachment name=${JSON.stringify(file.name)}>\n${file.data}\n</attachment>`;
    })].filter(Boolean).join("\n\n"),
  })).filter((message) => message.content.trim());
}

export function validateRangeResponse(status: number, header: string | null, start: number, end: number, total: number): void {
  // Refuse a server that ignored Range before reading a possible 1.55 GB body.
  if (status !== 206 || header !== `bytes ${start}-${end}/${total}`) {
    throw new Error("The download server did not resume the requested bytes. Your saved download is intact; try again later.");
  }
}
