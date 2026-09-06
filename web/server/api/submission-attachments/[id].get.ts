import { createError, defineEventHandler, getRouterParam, getQuery, setResponseHeaders } from "h3";
import { requireCourseProductSession } from "../../utils/course-session";
import { attachmentStore, type StoredAttachment } from "../../utils/submission-attachments";
import { getCourseForAccount } from "../../utils/course-repository";

export default defineEventHandler(async (event) => {
  const session = await requireCourseProductSession(event);
  const id = getRouterParam(event, "id") ?? "";
  if (!/^attachment_[a-f0-9]{32}$/.test(id)) throw createError({ statusCode: 404 });
  const storage = attachmentStore();
  const metadata = await storage.getItem<StoredAttachment>(`${id}:metadata`);
  let allowed = metadata?.accountId === session.accountId;
  const courseId = getQuery(event).courseId;
  if (metadata && !allowed && typeof courseId === "string") {
    // This projection already enforces teacher consent and peer-sharing rules.
    const snapshot = await getCourseForAccount(courseId, session.accountId);
    allowed = !!snapshot?.course.assignmentSubmissions.some((submission) => submission.attachments?.some((attachment) => attachment.id === id));
  }
  if (!metadata || !allowed) throw createError({ statusCode: 404, statusMessage: "Attachment not found." });
  const bytes = await storage.getItemRaw(`${id}:bytes`);
  if (!bytes) throw createError({ statusCode: 404, statusMessage: "Attachment not found." });
  setResponseHeaders(event, {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox",
  });
  return Buffer.from(bytes);
});
