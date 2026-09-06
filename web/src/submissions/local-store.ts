import type { UiSubmissionAttachment } from "@keating/learner-contracts";

let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("keating-submissions", 1);
    request.onupgradeneeded = () => {
      for (const name of ["files", "outbox", "tasks", "uploads"]) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function localRead<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function localList<T>(store: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function localWrite(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    transaction.objectStore(store).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Local save was interrupted."));
  });
}
export interface LocalFile { metadata: UiSubmissionAttachment; blob: Blob }
export async function saveLocalAttachment(file: File): Promise<UiSubmissionAttachment> {
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error("Choose a nonempty file up to 25 MB.");
  const metadata = { id: `attachment_${crypto.randomUUID().replaceAll("-", "")}`, name: file.name.slice(0, 255), mimeType: file.type || "application/octet-stream", sizeBytes: file.size };
  await localWrite("files", metadata.id, { metadata, blob: file } satisfies LocalFile);
  return metadata;
}
