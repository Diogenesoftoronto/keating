import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { AppState } from "react-native";
import { ChatRecordSyncController } from "../../../shared/account-sync/chat-record-sync-controller";
import { ChatSyncRecordsClient } from "../../../shared/account-sync/chat-sync-records";
import { deriveAccountSyncNamespace } from "../../../shared/account-sync/device-identity";
import { notOrganicSyncRequest } from "../lib/notorganic-account/client";
import { defaultNotOrganicAccountConfig } from "../lib/notorganic-account/contracts";
import { loadNativeSyncBridge, nativeSyncCrypto, unlockNativeSyncKey } from "../lib/account-sync/native-crypto";
import { NativeChatSyncStorage } from "../lib/account-sync/storage";
import { createNativeChatReconciler } from "../lib/account-sync/reconcile";
import { replaceSyncedLearnerData } from "../lib/account-sync/guarded-write";
import { reconcileNativeStateIntoPortable } from "../lib/learner-repository/portable-native-state";
import { useNotOrganicAccount } from "./NotOrganicAccountProvider";
import { enqueueRepositoryWrite } from "./repository-writes";
import type { SessionStore } from "./use-session-store";
import type { LearnerRepositoryState } from "./use-learner-repository";

/** Account lifecycle, durable reconciliation, foreground polling and local-change debounce. */
export function useAccountChatSync(
  store: SessionStore, repo: LearnerRepositoryState, busy: MutableRefObject<boolean>,
  setStorageError: Dispatch<SetStateAction<string | null>>,
): void {
  const account = useNotOrganicAccount();
  const did = account.status === "signed-in" && typeof account.account?.did === "string" ? account.account.did : null;
  const issuer = account.session?.issuer;
  const identity = did && issuer ? `${issuer}:${did}` : null;
  const latest = useRef({ identity, store, repo, busy });
  latest.current = { identity, store, repo, busy };
  const controllerRef = useRef<ChatRecordSyncController | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const lastError = useRef<string | null>(null);

  useEffect(() => {
    const repository = repo.refs.repository.current;
    if (!did || !identity || !repository || !repo.repositoryReady) return;
    const config = defaultNotOrganicAccountConfig();
    if (issuer !== config.issuer) return;
    let disposed = false;
    let opening = false;
    let pollDelay = 15_000;
    let lastCursor = "0";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => Promise<void>) | undefined;
    const current = () => !disposed && latest.current.identity === identity
      && latest.current.repo.refs.repository.current === repository && !latest.current.repo.refs.clearing.current;
    const error = (failure: unknown) => {
      if (!current()) return;
      const message = `Chat sync: ${failure instanceof Error ? failure.message : "Could not sync conversations."}`;
      lastError.current = message;
      setStorageError(message);
    };
    const tick = async () => {
      if (!current() || latest.current.busy.current || AppState.currentState === "background") return;
      if (controllerRef.current) { await controllerRef.current.request(); return; }
      if (opening) return;
      opening = true;
      try {
        const bridge = loadNativeSyncBridge();
        const crypto = nativeSyncCrypto(bridge);
        const request = (path: string, init: RequestInit = {}) => notOrganicSyncRequest(path, init, did, current, config);
        const verified = await request("/v1/account", { signal: AbortSignal.timeout(15_000) });
        const accountBody = await verified.json() as { account?: { did?: unknown } };
        if (!verified.ok || accountBody.account?.did !== did || !current()) throw new Error("The sync account could not be verified.");
        const unlocked = await unlockNativeSyncKey(bridge, did, request, current);
        release = unlocked.release;
        if (!current()) { await release(); return; }
        const namespace = await deriveAccountSyncNamespace(did, crypto);
        const storage = new NativeChatSyncStorage(repository.database, namespace, current);
        await storage.initialize();
        const reconcile = createNativeChatReconciler({
          storage, randomUUID: crypto.randomUUID, sha256: crypto.sha256, current,
          state: () => latest.current.store.stateRef.current,
          apply: (next, expected, newSessionIds) => enqueueRepositoryWrite(latest.current.repo.refs.writeTail, async () => {
            if (!current() || latest.current.busy.current || latest.current.store.stateRef.current !== expected) return false;
            const snapshot = await repository.records.snapshot();
            const locations = await repository.records.getLocalAttachments();
            if (!current() || latest.current.busy.current || latest.current.store.stateRef.current !== expected) return false;
            const reconciled = reconcileNativeStateIntoPortable(snapshot, next, locations);
            if (!await replaceSyncedLearnerData(repository.database, reconciled.data, reconciled.localAttachments,
              () => current() && !latest.current.busy.current && latest.current.store.stateRef.current === expected,
              { namespace, sessionIds: newSessionIds })) return false;
            if (!current() || latest.current.store.stateRef.current !== expected) return false;
            latest.current.store.commitState(next);
            latest.current.repo.setLearnerData(reconciled.data);
            return true;
          }),
        });
        if (!current()) { await release(); return; }
        controllerRef.current = new ChatRecordSyncController({
          remote: new ChatSyncRecordsClient({ request }), key: unlocked.key,
          keys: { get: async keyId => keyId === unlocked.key.keyId && current() ? unlocked.key : null },
          namespace, crypto, local: { reconcile },
          loadCheckpoint: () => storage.loadCheckpoint(), saveCheckpoint: async value => {
            if (value.cursor !== lastCursor) { pollDelay = 15_000; lastCursor = value.cursor; }
            await storage.saveCheckpoint(value);
          }, isCurrent: current,
          onStatus: (status, failure) => {
            if (!current()) return;
            if (status === "error") error(failure);
            if (status === "synced") {
              const previous = lastError.current;
              setStorageError(value => value === previous ? null : value);
              lastError.current = null;
            }
          },
        });
        await controllerRef.current.request();
      } catch (failure) { await release?.().catch(() => undefined); release = undefined; error(failure); }
      finally { opening = false; }
    };
    const schedule = () => {
      if (!current() || AppState.currentState === "background") return;
      clearTimeout(timer);
      timer = setTimeout(() => { void tick().finally(schedule); }, pollDelay);
      pollDelay = Math.min(60_000, pollDelay * 2);
    };
    const wake = () => {
      if (!current()) return;
      pollDelay = 15_000;
      clearTimeout(timer);
      void tick().finally(schedule);
    };
    wakeRef.current = wake;
    wake();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") wake();
      else clearTimeout(timer);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      wakeRef.current = null;
      subscription.remove();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      void release?.().catch(() => undefined);
    };
  }, [did, identity, issuer, repo.repositoryReady, setStorageError]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!latest.current.busy.current && AppState.currentState !== "background") wakeRef.current?.();
    }, 2_000);
    return () => clearTimeout(timer);
  }, [store.state.sessions]);
}
