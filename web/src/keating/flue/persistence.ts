export interface FlueCheckpoint {
  bytes: Uint8Array;
  savedAt: number;
  interrupted: boolean;
  legacyMessages?: unknown[];
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("keating-flue-runtime-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("checkpoints");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readCheckpoint(
  sessionId: string,
): Promise<FlueCheckpoint | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readonly");
      const request = tx.objectStore("checkpoints").get(sessionId);
      tx.oncomplete = () =>
        request.result?.deleted
          ? reject(
              new Error("This chat was deleted. Start a new conversation."),
            )
          : resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Checkpoint read aborted"));
    });
  } finally {
    db.close();
  }
}
export async function writeCheckpoint(
  sessionId: string,
  checkpoint: FlueCheckpoint,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite");
      const store = tx.objectStore("checkpoints");
      const current = store.get(sessionId);
      current.onsuccess = () => {
        if (current.result?.deleted) {
          tx.abort();
          return;
        }
        store.put(checkpoint, sessionId);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Checkpoint write aborted"));
    });
  } finally {
    db.close();
  }
}

/** Erase conversation bytes; the marker also prevents a running tab recreating them. */
export async function deleteCheckpoint(sessionId: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite");
      tx.objectStore("checkpoints").put({ deleted: true }, sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Checkpoint deletion aborted"));
    });
  } finally {
    db.close();
  }
}
