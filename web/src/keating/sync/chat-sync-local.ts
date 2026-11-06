import type { StorageBackend } from "../../types";
import type { SessionData, SessionMetadata } from "../../types/session";
import type { KeatingPortableSession } from "../portable-data";
import { CHAT_SYNC_JOURNAL_KEY, type ChatSyncJournal } from "./chat-sync-journal";
import { chatSyncCanonical, emptyChatSyncState, mergeChatSyncStates, parseChatSyncState, updateChatSyncState, type ChatSyncState } from "./chat-sync-state";

export const CHAT_SYNC_IMPORTED_EVENT = "keating:chat-sync-imported";

/** Uses the same transaction as chat writes: a download cannot overwrite a save in flight. */
export class BrowserChatSyncLocalStore {
	private readonly checkpointKey: string;
	constructor(
		private readonly backend: StorageBackend,
		private readonly account: string,
		private readonly writer: string,
		private readonly isCurrent: () => boolean = () => true,
		private readonly imported: (ids: string[]) => void = () => {},
	) { this.checkpointKey = `keating:chat-sync:state:${account}`; }

	private check(): void { if (!this.isCurrent()) throw new Error("Chat sync account changed."); }

	async bind(): Promise<void> {
		const ids = await this.backend.keys("sessions");
		await this.backend.transaction(["settings"], "readwrite", async tx => {
			this.check();
			const journal = await tx.get<ChatSyncJournal>("settings", CHAT_SYNC_JOURNAL_KEY)
				?? { account: null, owners: {} };
			// Existing offline chats belong to the previously linked account. Only
			// the first connection adopts anonymous history automatically.
			const previous = journal.account ?? this.account;
			const owners: Record<string, string> = Object.assign(Object.create(null), journal.owners);
			for (const id of ids) if (!Object.hasOwn(owners, id)) owners[id] = previous;
			this.check();
			await tx.set("settings", CHAT_SYNC_JOURNAL_KEY, { account: this.account, owners });
		});
	}

	async reconcile(remote: ChatSyncState | null): Promise<ChatSyncState> {
		const ids = await this.backend.keys("sessions");
		const changed: string[] = [];
		const result = await this.backend.transaction(["settings", "sessions", "sessions-metadata"], "readwrite", async tx => {
			this.check();
			const journal = await tx.get<ChatSyncJournal>("settings", CHAT_SYNC_JOURNAL_KEY);
			if (!journal) throw new Error("Chat sync is not bound to an account.");
			const stored = await tx.get<ChatSyncState>("settings", this.checkpointKey);
			const state = stored ? parseChatSyncState(stored) : emptyChatSyncState();
			const baseline = state.entries.flatMap(entry => entry.session ? [entry.session] : []);
			const current: KeatingPortableSession[] = [];
			const owners: Record<string, string> = Object.assign(Object.create(null), journal.owners);
			// Baseline IDs are included even when deleted; they become tombstones.
			for (const id of new Set([...ids, ...state.entries.map(entry => entry.id)])) {
				if (!Object.hasOwn(owners, id) && journal.account) owners[id] = journal.account;
				if (owners[id] !== this.account) continue;
				const data = await tx.get<SessionData>("sessions", id);
				const metadata = await tx.get<SessionMetadata>("sessions-metadata", id);
				if (data && metadata) current.push({ data, metadata });
			}
			const local = updateChatSyncState(state, current, this.writer, baseline);
			const localEntries = new Map(local.entries.map(entry => [entry.id, entry]));
			let merged = local;
			if (remote) merged = mergeChatSyncStates(merged, remote);
			const existing = new Map(current.map(session => [session.data.id, session]));
			for (const entry of merged.entries) {
				this.check();
				if (Object.hasOwn(owners, entry.id) && owners[entry.id] !== this.account) {
					throw new Error("A synced chat conflicts with another account's local chat.");
				}
				owners[entry.id] = this.account;
				const before = existing.get(entry.id);
				if (entry.session) {
					if (chatSyncCanonical(localEntries.get(entry.id)?.session) === chatSyncCanonical(entry.session)) continue;
					const data = entry.session.data;
					// Device connection settings never travel through sync and are not
					// erased when that same model's conversation is updated remotely.
					const localModel = before?.data.model;
					await tx.set("sessions", entry.id, localModel?.id === data.model.id && localModel.provider === data.model.provider
						? { ...data, model: localModel } : data);
					await tx.set("sessions-metadata", entry.id, entry.session.metadata);
					changed.push(entry.id);
				} else if (before) {
					await tx.delete("sessions", entry.id);
					await tx.delete("sessions-metadata", entry.id);
					changed.push(entry.id);
				}
			}
			this.check();
			await tx.set("settings", CHAT_SYNC_JOURNAL_KEY, { ...journal, owners });
			await tx.set("settings", this.checkpointKey, merged);
			this.check();
			return merged;
		});
		if (changed.length && this.isCurrent()) this.imported(changed);
		return result;
	}
}
