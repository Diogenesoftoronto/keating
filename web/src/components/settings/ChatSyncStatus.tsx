import { useState, useSyncExternalStore } from "react";
import { beginNotOrganicAuthorization } from "../../notorganic-provider";
import { CHAT_SYNC_RETRY_EVENT, getChatSyncStatus, subscribeChatSyncStatus } from "../../keating/sync/chat-sync-status";

export function ChatSyncStatus({ className, buttonClassName }: { className?: string; buttonClassName?: string }) {
	const status = useSyncExternalStore(subscribeChatSyncStatus, getChatSyncStatus, getChatSyncStatus);
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState(false);
	if (status.phase === "signed-out") return null;
	const message = {
		reconnect: "Reconnect Not Organic once to enable encrypted chat sync on this device.",
		syncing: "Syncing your chats…",
		synced: "Your saved chats are synced across devices using this Not Organic account.",
		error: "Chat sync couldn't connect. Your chats remain saved on this device; we'll retry automatically.",
	}[status.phase];
	return <div className={className}>
		<p role="status">{message}</p>
		{status.phase === "reconnect" && <button className={buttonClassName} type="button" disabled={opening} onClick={() => {
			setOpening(true); setError(false);
			void beginNotOrganicAuthorization().catch(() => { setOpening(false); setError(true); });
		}}>{opening ? "Opening sign-in…" : "Enable chat sync"}</button>}
		{status.phase === "error" && <button className={buttonClassName} type="button" onClick={() => window.dispatchEvent(new Event(CHAT_SYNC_RETRY_EVENT))}>Retry chat sync</button>}
		{error && <p role="alert">Sign-in couldn't open. Please try again.</p>}
	</div>;
}
