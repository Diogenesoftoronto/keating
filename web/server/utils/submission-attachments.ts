import { useStorage } from "nitro/storage";
import { createError } from "h3";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";

export interface StoredAttachment extends UiSubmissionAttachment { accountId: string; createdAt: string }
export const attachmentStore = () => useStorage("keating:submission-attachments");
export async function ownedAttachments(accountId: string, attachments: UiSubmissionAttachment[] = []) {
  for (const attachment of attachments) {
    const stored = await attachmentStore().getItem<StoredAttachment>(`${attachment.id}:metadata`);
    if (!stored || stored.accountId !== accountId || stored.name !== attachment.name
      || stored.mimeType !== attachment.mimeType || stored.sizeBytes !== attachment.sizeBytes) {
      throw createError({ statusCode: 403, statusMessage: "This attachment does not belong to your account." });
    }
  }
}
