import type { StorageTransaction } from "../../types";

export const CHAT_SYNC_JOURNAL_KEY = "keating:chat-sync:ownership:v1";
export const CHAT_SYNC_LOCAL_CHANGE_EVENT = "keating:chat-sync-local-change";

export interface ChatSyncJournal {
	account: string | null;
	owners: Record<string, string>;
}

export async function recordChatSyncMutation(tx: StorageTransaction, id: string, account?: string): Promise<void> {
	const journal = await tx.get<ChatSyncJournal>("settings", CHAT_SYNC_JOURNAL_KEY);
	const owner = account ?? journal?.account;
	if (!journal || !owner || Object.hasOwn(journal.owners, id)) return;
	await tx.set("settings", CHAT_SYNC_JOURNAL_KEY, {
		...journal, owners: { ...journal.owners, [id]: owner },
	});
}

export function notifyChatSyncMutation(): void {
	if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_SYNC_LOCAL_CHANGE_EVENT));
}
