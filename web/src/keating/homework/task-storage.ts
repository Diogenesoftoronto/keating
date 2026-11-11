import type { UiSubmissionAttachment } from "@keating/learner-contracts";

/**
 * Keys and shapes for the on-device copies of a task's work, kept in the
 * `tasks` object store of `keating-submissions` (see submissions/local-store).
 * The submission key predates this module; the Task card has written it since
 * submissions became durable, so it must not change.
 */
export interface SavedTaskSubmission {
	intent: { type: "submit-task"; nodeId: string; submission: string; attachments?: UiSubmissionAttachment[]; round?: number };
	savedAt: string;
}

/** Unsent work in progress: what the learner has typed but not handed in. */
export interface SavedTaskDraft {
	submission: string;
	notes: Record<string, string>;
	savedAt: string;
}

export function taskSubmissionKey(documentId: string, nodeId: string, round: number | undefined): string {
	return JSON.stringify([documentId, nodeId, round ?? 0]);
}

export function taskDraftKey(documentId: string, nodeId: string, round: number | undefined): string {
	return JSON.stringify(["draft", documentId, nodeId, round ?? 0]);
}

export function draftHasContent(draft: SavedTaskDraft | undefined): boolean {
	if (!draft) return false;
	return draft.submission.trim().length > 0 || Object.values(draft.notes ?? {}).some((note) => note.trim().length > 0);
}
