import { useStorage } from "nitro/storage";
import { createError } from "h3";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";

export interface StoredAttachment extends UiSubmissionAttachment { accountId: string; createdAt: string }
export const attachmentStore = () => useStorage("keating:submission-attachments");
export async function ownsAttachmentAccount(accountId: string, storedAccountId: string): Promise<boolean> {
  if (accountId === storedAccountId) return true;
  if (!accountId.startsWith("did:") || !/^local_[0-9a-f]{64}$/.test(storedAccountId)) return false;
  return await useStorage("keating:courses").getItem(`identity:adopted:${storedAccountId}`) === accountId;
}
export async function ownedAttachments(accountId: string, attachments: UiSubmissionAttachment[] = []) {
  for (const attachment of attachments) {
    const stored = await attachmentStore().getItem<StoredAttachment>(`${attachment.id}:metadata`);
    if (!stored || !await ownsAttachmentAccount(accountId, stored.accountId) || stored.name !== attachment.name
      || stored.mimeType !== attachment.mimeType || stored.sizeBytes !== attachment.sizeBytes) {
      throw createError({ statusCode: 403, statusMessage: "This attachment does not belong to your account." });
    }
  }
}
