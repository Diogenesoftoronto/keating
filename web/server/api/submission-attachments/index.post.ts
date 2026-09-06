import { createError, defineEventHandler, getHeader, getRequestURL, readMultipartFormData } from "h3";
import { requireCourseProductSession } from "../../utils/course-session";
import { attachmentStore, type StoredAttachment } from "../../utils/submission-attachments";

export default defineEventHandler(async (event) => {
  const origin = getHeader(event, "origin");
  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, statusMessage: "Cross-origin uploads are not allowed." });
  const session = await requireCourseProductSession(event);
  const length = Number(getHeader(event, "content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) throw createError({ statusCode: 411, statusMessage: "Upload length is required." });
  if (length > 25 * 1024 * 1024 + 65536) throw createError({ statusCode: 413, statusMessage: "Files must be 25 MB or smaller." });
  const parts = await readMultipartFormData(event);
  const files = parts?.filter((part) => part.filename);
  const file = files?.[0];
  if (files?.length !== 1 || !file?.data.byteLength || file.data.byteLength > 25 * 1024 * 1024) throw createError({ statusCode: 400, statusMessage: "Choose one nonempty file, up to 25 MB." });
  const id = `attachment_${crypto.randomUUID().replaceAll("-", "")}`;
  const attachment = {
    id, name: (file.filename ?? "submission").replace(/[\\/\x00-\x1f]/g, "_").slice(0, 255) || "submission",
    mimeType: file.type?.slice(0, 160) || "application/octet-stream", sizeBytes: file.data.byteLength,
  };
  const storage = attachmentStore();
  await storage.setItemRaw(`${id}:bytes`, file.data);
  try {
    await storage.setItem<StoredAttachment>(`${id}:metadata`, { ...attachment, accountId: session.accountId, createdAt: new Date().toISOString() });
  } catch (error) { await storage.removeItem(`${id}:bytes`); throw error; }
  return attachment;
});
