/**
 * IndexedDB snapshot persistence for NodePod.
 * Stores NodePod snapshot data so it survives page reloads and reboots.
 */

const DB_NAME = "keating-nodepod";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";

export interface SnapshotRecord {
	id: string;
	instanceId: string;
	createdAt: string;
	label?: string;
	data: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

async function open(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
				db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
			}
		};
	});
	return dbPromise;
}

export async function persistSnapshot(record: SnapshotRecord): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
		const store = tx.objectStore(SNAPSHOT_STORE);
		const req = store.put(record);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function loadSnapshots(): Promise<SnapshotRecord[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SNAPSHOT_STORE, "readonly");
		const store = tx.objectStore(SNAPSHOT_STORE);
		const req = store.openCursor();
		const results: SnapshotRecord[] = [];
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				results.push(cursor.value);
				cursor.continue();
			} else {
				// sort newest first
				results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				resolve(results);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

export async function deleteSnapshot(id: string): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
		const store = tx.objectStore(SNAPSHOT_STORE);
		const req = store.delete(id);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function clearSnapshots(): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
		const store = tx.objectStore(SNAPSHOT_STORE);
		const req = store.clear();
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}
