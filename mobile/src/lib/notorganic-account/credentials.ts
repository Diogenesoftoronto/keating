import type * as SecureStoreModule from "expo-secure-store";
import type { NotOrganicDeviceSession, PendingAuthorization } from "./contracts";

const PENDING_KEY = "keating.notorganic.pending.v1";
const SESSION_KEY = "keating.notorganic.device-session.v1";

export interface AccountCredentialStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

function nativeSecureStore(): typeof SecureStoreModule {
  return require("expo-secure-store") as typeof SecureStoreModule;
}

const nativeStore: AccountCredentialStore = {
  getItem: (key) => nativeSecureStore().getItemAsync(key),
  setItem: (key, value) => {
    const secureStore = nativeSecureStore();
    return secureStore.setItemAsync(key, value, { keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  deleteItem: (key) => nativeSecureStore().deleteItemAsync(key),
};

let store: AccountCredentialStore = nativeStore;

export function setAccountCredentialStoreForTests(next: AccountCredentialStore | null): void {
  store = next ?? nativeStore;
}

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await store.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { await store.deleteItem(key); return null; }
}

export const loadPendingAuthorization = () => readJson<PendingAuthorization>(PENDING_KEY);
export const savePendingAuthorization = (pending: PendingAuthorization) => store.setItem(PENDING_KEY, JSON.stringify(pending));
export const clearPendingAuthorization = () => store.deleteItem(PENDING_KEY);
export const loadDeviceSession = () => readJson<NotOrganicDeviceSession>(SESSION_KEY);
export const saveDeviceSession = (session: NotOrganicDeviceSession) => store.setItem(SESSION_KEY, JSON.stringify(session));
export const clearDeviceSession = () => store.deleteItem(SESSION_KEY);

export const accountCredentialKeysForTests = () => ({ pending: PENDING_KEY, session: SESSION_KEY });
