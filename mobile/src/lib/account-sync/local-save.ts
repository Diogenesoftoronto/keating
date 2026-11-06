import { deriveAccountSyncNamespace } from "../../../../shared/account-sync/device-identity";
import type { SyncCrypto } from "../../../../shared/account-sync/crypto";
import { reconcileNativeStateIntoPortable } from "../learner-repository/portable-native-state";
import type { LearnerRecordStore } from "../learner-repository/records";
import type { PersistedAppState } from "../types";

/** Capture the account synchronously, before the serialized SQLite save can wait. */
export function saveNativeState(options: {
  records: LearnerRecordStore;
  state: PersistedAppState;
  account(): string | undefined;
  crypto: SyncCrypto;
  enqueue(task: () => Promise<void>): Promise<void>;
  beforeWrite(): boolean;
  saved(data: ReturnType<typeof reconcileNativeStateIntoPortable>["data"]): void;
}): Promise<void> {
  const did = options.account();
  return options.enqueue(async () => {
    if (!options.beforeWrite()) return;
    const current = await options.records.snapshot();
    const locations = await options.records.getLocalAttachments();
    const reconciled = reconcileNativeStateIntoPortable(current, options.state, locations);
    const existing = new Set(current.sessions.map(session => session.id));
    const namespace = did ? await deriveAccountSyncNamespace(did, options.crypto) : null;
    const owner = namespace ? { namespace, sessionIds: options.state.sessions.filter(session => !existing.has(session.id)).map(session => session.id) } : undefined;
    await options.records.replaceWithLocalAttachments(reconciled.data, reconciled.localAttachments, owner);
    options.saved(reconciled.data);
  });
}
