/** Browser storage persistence: whether it is granted, and asking for it. */
import { storageBackendKind } from "../keating-storage";
import type { PersistentStorageStatus } from "../../stores/keating-agent-store";

export async function browserPersistentStorageGranted(): Promise<boolean> {
  if (storageBackendKind === "p2p") return true;
  if (typeof navigator === "undefined" || !navigator.storage?.persisted)
    return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function requestBrowserPersistentStorage(): Promise<PersistentStorageStatus> {
  if (storageBackendKind === "p2p") return "granted";
  if (typeof navigator === "undefined" || !navigator.storage) return "declined";
  try {
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return "granted";
    }
    if (!navigator.storage.persist) return "declined";
    const granted = await navigator.storage.persist();
    if (granted) return "granted";
    return (await browserPersistentStorageGranted()) ? "granted" : "declined";
  } catch {
    return "declined";
  }
}
