import type { ChatMessage } from "./types";

export const OFFLINE_MODEL = {
  id: "minicpm5-2b-int4",
  name: "MiniCPM5 2B",
  bytes: 1_553_670_064,
  sha256: "9858563beafbc6d5e0d25fcee3827541515296a9302ed3d088b16a58d4fbe7b8",
  url: "https://huggingface.co/mlboydaisuke/MiniCPM5-2B-LiteRT/resolve/02e8a867ae318e633f2372ac81fc78dc4d8448e7/MiniCPM5-2B_int4.litertlm",
  runtimeVersion: "0.16.0",
} as const;

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
