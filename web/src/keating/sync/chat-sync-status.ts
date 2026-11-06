export type ChatSyncStatus = {
	phase: "signed-out" | "reconnect" | "syncing" | "synced" | "error";
	lastSyncedAt?: number;
};
let state: ChatSyncStatus = { phase: "signed-out" };
const listeners = new Set<() => void>();
export const getChatSyncStatus = (): ChatSyncStatus => state;
export function subscribeChatSyncStatus(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
export function setChatSyncStatus(next: ChatSyncStatus): void {
	state = next;
	for (const listener of listeners) listener();
}
export const CHAT_SYNC_RETRY_EVENT = "keating:chat-sync-retry";
