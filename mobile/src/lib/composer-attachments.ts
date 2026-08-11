import { Directory, File, Paths } from "expo-file-system";
import { createId, type ChatAttachment, type ChatAttachmentKind } from "./types";
import {
  attachmentEncoding,
  MAX_COMPOSER_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  validateComposerAttachment,
} from "./composer-attachment-contract";

export { MAX_COMPOSER_ATTACHMENTS } from "./composer-attachment-contract";

export interface PickComposerAttachmentsOptions {
  kind: ChatAttachmentKind;
  remainingSlots: number;
  existingBytes: number;
}

function safeFileName(name: string): string {
  const compact = name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (compact || "attachment").slice(-120);
}

export async function pickComposerAttachments({
  kind,
  remainingSlots,
  existingBytes,
}: PickComposerAttachmentsOptions): Promise<ChatAttachment[]> {
  if (remainingSlots <= 0) throw new Error(`You can attach up to ${MAX_COMPOSER_ATTACHMENTS} files.`);
  const mimeTypes = kind === "image"
    ? "image/*"
    : ["text/*", "application/pdf", "application/json", "application/xml", "application/yaml"];
  const result = remainingSlots > 1
    ? await File.pickFileAsync({ multipleFiles: true, mimeTypes })
    : await File.pickFileAsync({ multipleFiles: false, mimeTypes });
  if (result.canceled) return [];
  const picked = Array.isArray(result.result) ? result.result : [result.result];
  if (picked.length > remainingSlots) {
    throw new Error(`Choose no more than ${remainingSlots} more attachment${remainingSlots === 1 ? "" : "s"}.`);
  }

  const validated = picked.map((file) => ({ file, ...validateComposerAttachment(file, kind) }));
  const totalBytes = existingBytes + validated.reduce((total, entry) => total + entry.file.size, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("Attachments can total up to 16 MB. Remove a file or choose smaller ones.");
  }
  const directory = new Directory(Paths.document, "composer-attachments");
  directory.create({ idempotent: true, intermediates: true });

  const attachments: ChatAttachment[] = [];
  try {
    for (const entry of validated) {
      const id = createId("attachment");
      const destination = new File(directory, `${id}-${safeFileName(entry.file.name)}`);
      await entry.file.copy(destination);
      attachments.push({
        id,
        kind: entry.kind,
        name: entry.file.name,
        mimeType: entry.mimeType,
        size: entry.file.size,
        uri: destination.uri,
      });
    }
    return attachments;
  } catch (error) {
    for (const attachment of attachments) {
      if (!attachment.uri) continue;
      const stored = new File(attachment.uri);
      if (stored.exists) stored.delete();
    }
    throw error;
  }
}

export async function hydrateMessageAttachments(attachments: readonly ChatAttachment[]): Promise<ChatAttachment[]> {
  return Promise.all(attachments.map(async (attachment) => {
    if (!attachment.uri || attachment.localState === "missing") {
      throw new Error(`${attachment.name} was imported without its file. Attach the original file again before retrying this message.`);
    }
    const file = new File(attachment.uri);
    if (!file.exists) throw new Error(`${attachment.name} is no longer available on this device. Remove it and attach it again.`);
    const encoding = attachmentEncoding(attachment);
    const data = encoding === "text" ? await file.text() : await file.base64();
    return { ...attachment, encoding, data };
  }));
}

export function removeComposerAttachmentFile(attachment: ChatAttachment): void {
  if (!attachment.uri || attachment.localState === "missing") return;
  const file = new File(attachment.uri);
  if (file.exists) file.delete();
}

export function clearComposerAttachmentFiles(): void {
  const directory = new Directory(Paths.document, "composer-attachments");
  if (directory.exists) directory.delete();
}
