import { chatSyncCanonical, mergeChatSyncStates, updateChatSyncState, type ChatSyncState } from "../../../../shared/account-sync/chat-sync-state";
import type { PersistedAppState } from "../types";
import { nativeChatIdMap, nativeSessionToSync, projectSyncedSession } from "./chat-projection";
import type { NativeChatSyncStorage } from "./storage";

export interface NativeChatReconcileOptions {
  storage: NativeChatSyncStorage;
  randomUUID(): string;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  current(): boolean;
  state(): PersistedAppState;
  /** Persists before publishing; checks the account and expected state at commit. */
  apply(next: PersistedAppState, expected: PersistedAppState): Promise<boolean>;
}

export function createNativeChatReconciler(options: NativeChatReconcileOptions) {
  return async (remote: ChatSyncState | null): Promise<ChatSyncState> => {
    const assertCurrent = () => { if (!options.current()) throw new Error("The sync account changed."); };
    assertCurrent();
    const local = await options.storage.loadLocal(options.randomUUID);
    const referencedIds = (state: ChatSyncState) => state.entries.flatMap(entry => [entry.id, ...(entry.session?.data.parentSessionId ? [entry.session.data.parentSessionId] : [])]);
    let ids = await nativeChatIdMap([...referencedIds(local.state), ...referencedIds(remote ?? { ...local.state, entries: [] })], options.sha256);
    // Retry if an in-progress generation changed local state while the DB was saving.
    for (let attempt = 0; attempt < 5; attempt++) {
      assertCurrent();
      const current = options.state();
      const owned = await options.storage.claim(current.sessions.filter(session => session.messages.length > 0 || local.baseline.some(item => (ids.get(item.data.id) ?? item.data.id) === session.id)).map(session => session.id));
      const baseline = new Map(local.baseline.map(session => [ids.get(session.data.id) ?? session.data.id, session]));
      const native = current.sessions.filter(session => owned.has(session.id));
      const wire = native.map(session => nativeSessionToSync(session, current.providerSettings, baseline.get(session.id), ids));
      let next = updateChatSyncState(local.state, wire, local.writer, local.baseline);
      if (remote) next = mergeChatSyncStates(next, remote);
      ids = await nativeChatIdMap(referencedIds(next), options.sha256);
      const remoteIds = next.entries.filter(entry => entry.session).map(entry => ids.get(entry.id)!);
      const allOwned = await options.storage.claim(remoteIds);
      // A local id belonging to another account must never be overwritten.
      const eligible = next.entries.filter(entry => allOwned.has(ids.get(entry.id)!));
      const synced = eligible.flatMap(entry => entry.session ? [entry.session] : []);
      const byId = new Map(current.sessions.map(session => [session.id, session]));
      for (const entry of eligible) {
        const projectedId = ids.get(entry.id)!;
        if (!entry.session) byId.delete(projectedId);
        else {
          const projected = projectSyncedSession(entry.session, ids);
          // Retain local attachment URIs only for the exact unchanged attachment id.
          const existing = byId.get(projectedId);
          if (existing) projected.messages = projected.messages.map(message => {
            const prior = existing.messages.find(old => old.id === message.id);
            return { ...message, ...(message.attachments ? { attachments: message.attachments.map(attachment => {
              const localAttachment = prior?.attachments?.find(old => old.id === attachment.id);
              return localAttachment?.uri ? { ...attachment, uri: localAttachment.uri, localState: undefined } : attachment;
            }) } : {}) };
          });
          byId.set(projectedId, projected);
        }
      }
      const sessions = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      // Keep the UI's empty scratch session if all synced sessions were deleted.
      if (!sessions.length) sessions.push({ id: `session-${options.randomUUID()}`, title: "New lesson", createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
      const applied: PersistedAppState = { ...current, sessions, activeSessionId: sessions.some(session => session.id === current.activeSessionId) ? current.activeSessionId : sessions[0]!.id };
      if (chatSyncCanonical(applied) !== chatSyncCanonical(current) && !await options.apply(applied, current)) continue;
      assertCurrent();
      await options.storage.saveLocal({ state: next, baseline: synced, writer: local.writer });
      return next;
    }
    throw new Error("Chat sync will retry when the current reply finishes.");
  };
}
