import type { ChatAttachment, ChatAttachmentKind } from "./types";

export const MAX_COMPOSER_ATTACHMENTS = 4;
export const MAX_BINARY_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "html", "css",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h",
  "hpp", "toml", "yaml", "yml",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", json: "application/json", jsonl: "application/x-ndjson",
  csv: "text/csv", tsv: "text/tab-separated-values", md: "text/markdown",
  markdown: "text/markdown", xml: "application/xml", html: "text/html", css: "text/css",
  js: "text/javascript", jsx: "text/javascript", ts: "text/typescript", tsx: "text/typescript",
  yaml: "application/yaml", yml: "application/yaml", toml: "application/toml",
};

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

export function attachmentMimeType(name: string, reportedType: string): string {
  const normalized = reportedType.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return MIME_BY_EXTENSION[extensionOf(name)] ?? (TEXT_EXTENSIONS.has(extensionOf(name)) ? "text/plain" : normalized);
}

export function attachmentEncoding(attachment: Pick<ChatAttachment, "kind" | "name" | "mimeType">): "text" | "base64" {
  return attachment.kind === "image" || attachment.mimeType === "application/pdf" ? "base64" : "text";
}

export function validateComposerAttachment(
  file: { name: string; type: string; size: number },
  requestedKind: ChatAttachmentKind,
): { kind: ChatAttachmentKind; mimeType: string } {
  const mimeType = attachmentMimeType(file.name, file.type);
  const extension = extensionOf(file.name);
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf" || extension === "pdf";
  const isText = mimeType.startsWith("text/")
    || TEXT_EXTENSIONS.has(extension)
    || ["application/json", "application/xml", "application/yaml", "application/toml", "application/x-ndjson"].includes(mimeType);

  if (requestedKind === "image" && !isImage) throw new Error(`${file.name} is not an image.`);
  if (requestedKind === "document" && !isPdf && !isText) {
    throw new Error(`${file.name} is not a readable text or PDF document.`);
  }

  const maxBytes = isText && !isPdf ? MAX_TEXT_ATTACHMENT_BYTES : MAX_BINARY_ATTACHMENT_BYTES;
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(`${file.name} is empty or could not be read.`);
  if (file.size > maxBytes) {
    throw new Error(`${file.name} is too large. The limit is ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }
  return { kind: isImage ? "image" : "document", mimeType: isPdf ? "application/pdf" : mimeType };
}
