/**
 * Lightweight, browser-native version control for the Keating sandbox.
 *
 * This replaces the Lix SDK dependency (which requires Node.js native addons
 * and cannot run in the browser). It provides the same surface:
 * - branches, commits, diffs
 * - SQL-like queryability via IndexedDB
 *
 * When @lix-js/sdk gains browser/WASM support, we can swap this out.
 */

const DB_NAME = "keating-vc";
const DB_VERSION = 1;

interface DBBranch {
	id: string;
	name: string;
	commitId: string | null;
	hidden: boolean;
	createdAt: string;
}

interface DBCommit {
	id: string;
	branchId: string;
	parentId: string | null;
	message: string;
	createdAt: string;
}

interface DBCommitFile {
	commitId: string;
	path: string;
	contentHash: string;
}

export interface SandboxVcExport {
	schemaVersion: 1;
	generatedAt: string;
	activeBranchId: string;
	branches: DBBranch[];
	commits: DBCommit[];
	commitFiles: DBCommitFile[];
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
			if (!db.objectStoreNames.contains("branches")) {
				const bs = db.createObjectStore("branches", { keyPath: "id" });
				bs.createIndex("name", "name", { unique: false });
			}
			if (!db.objectStoreNames.contains("commits")) {
				const cs = db.createObjectStore("commits", { keyPath: "id" });
				cs.createIndex("branchId", "branchId", { unique: false });
				cs.createIndex("createdAt", "createdAt", { unique: false });
			}
			if (!db.objectStoreNames.contains("commitFiles")) {
				db.createObjectStore("commitFiles", { keyPath: ["commitId", "path"] });
			}
		};
	});
	return dbPromise;
}

async function getAll<T>(store: string, index?: string): Promise<T[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const s = tx.objectStore(store);
		const source = index ? s.index(index) : s;
		const req = source.openCursor();
		const out: T[] = [];
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				out.push(cursor.value);
				cursor.continue();
			} else {
				resolve(out);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

async function getByKey<T>(store: string, key: IDBValidKey | IDBKeyRange): Promise<T | undefined> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const req = tx.objectStore(store).get(key);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function put(store: string, value: unknown): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readwrite");
		const req = tx.objectStore(store).put(value);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

async function del(store: string, key: IDBValidKey | IDBKeyRange): Promise<void> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readwrite");
		const req = tx.objectStore(store).delete(key);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

async function getByIndex<T>(store: string, indexName: string, value: IDBValidKey | IDBKeyRange): Promise<T[]> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const req = tx.objectStore(store).index(indexName).openCursor(value);
		const out: T[] = [];
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				out.push(cursor.value);
				cursor.continue();
			} else {
				resolve(out);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------
async function hashContent(content: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(content);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Ensure a main branch exists
// ---------------------------------------------------------------------------
async function ensureMainBranch(): Promise<DBBranch> {
	const existing = await getByKey<DBBranch>("branches", "main");
	if (existing) return existing;
	const main: DBBranch = {
		id: "main",
		name: "main",
		commitId: null,
		hidden: false,
		createdAt: new Date().toISOString(),
	};
	await put("branches", main);
	return main;
}

// ---------------------------------------------------------------------------
// Public API — mirrors what SandboxView expects from Lix
// ---------------------------------------------------------------------------

export interface SandboxCommit {
	id: string;
	branchId: string;
	message: string;
	createdAt: string;
	fileCount: number;
	files: Array<{ path: string; hash: string }>;
}

export interface SandboxBranch {
	id: string;
	name: string;
	commitId: string | null;
	hidden: boolean;
}

let inited = false;
async function ensureInit() {
	if (inited) return;
	await ensureMainBranch();
	inited = true;
}

export async function lixCommit(
	files: Array<{ path: string; content: string }>,
	message: string
): Promise<string> {
	await ensureInit();
	const main = await ensureMainBranch();
	const commitId = `commit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

	const commit: DBCommit = {
		id: commitId,
		branchId: main.id,
		parentId: main.commitId,
		message,
		createdAt: new Date().toISOString(),
	};

	await put("commits", commit);

	for (const file of files) {
		const contentHash = await hashContent(file.content);
		await put("commitFiles", {
			commitId,
			path: file.path,
			contentHash,
		} as DBCommitFile);
	}

	// advance branch head
	main.commitId = commitId;
	await put("branches", main);

	return commitId;
}

export async function lixListBranches(): Promise<SandboxBranch[]> {
	await ensureInit();
	const rows = await getAll<DBBranch>("branches");
	return rows
		.filter((b) => !b.hidden)
		.map((b) => ({
			id: b.id,
			name: b.name,
			commitId: b.commitId,
			hidden: b.hidden,
		}));
}

export async function lixListCommits(branchId?: string): Promise<SandboxCommit[]> {
	await ensureInit();
	const target = branchId ?? "main";
	const rows = await getByIndex<DBCommit>("commits", "branchId", target);
	// newest first
	rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

	return Promise.all(
		rows.map(async (c) => {
			const files = await getByIndex<DBCommitFile>("commitFiles", "commitId", c.id);
			return {
				id: c.id,
				branchId: c.branchId,
				message: c.message,
				createdAt: c.createdAt,
				fileCount: files.length,
				files: files.map((f) => ({ path: f.path, hash: f.contentHash })),
			};
		})
	);
}

export async function lixCreateBranch(name: string): Promise<SandboxBranch> {
	await ensureInit();
	const id = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const main = await ensureMainBranch();
	const branch: DBBranch = {
		id,
		name,
		commitId: main.commitId,
		hidden: false,
		createdAt: new Date().toISOString(),
	};
	await put("branches", branch);
	return { id: branch.id, name: branch.name, commitId: branch.commitId, hidden: branch.hidden };
}

export async function lixSwitchBranch(branchId: string): Promise<void> {
	await ensureInit();
	// lightweight impl: just update the "active" branch ref in a simple meta store
	await put("branches", { ...(await getByKey<DBBranch>("branches", branchId) ?? await ensureMainBranch()), name: (await getByKey<DBBranch>("branches", branchId))?.name ?? "main" });
	// Store active branch in localStorage for persistence
	localStorage.setItem("keating-vc-active-branch", branchId);
}

export async function lixDiffCommits(
	fromCommitId: string,
	toCommitId: string
): Promise<Array<{ path: string; fromHash?: string; toHash?: string; status: "added" | "removed" | "modified" | "unchanged" }>> {
	const [fromFiles, toFiles] = await Promise.all([
		getByIndex<DBCommitFile>("commitFiles", "commitId", fromCommitId),
		getByIndex<DBCommitFile>("commitFiles", "commitId", toCommitId),
	]);

	const fromMap = new Map(fromFiles.map((f) => [f.path, f.contentHash]));
	const toMap = new Map(toFiles.map((f) => [f.path, f.contentHash]));
	const allPaths = new Set([...fromMap.keys(), ...toMap.keys()]);

	const changes: Array<{
		path: string;
		fromHash?: string;
		toHash?: string;
		status: "added" | "removed" | "modified" | "unchanged";
	}> = [];

	for (const path of allPaths) {
		const fh = fromMap.get(path);
		const th = toMap.get(path);
		if (!fh) changes.push({ path, toHash: th, status: "added" });
		else if (!th) changes.push({ path, fromHash: fh, status: "removed" });
		else if (fh !== th) changes.push({ path, fromHash: fh, toHash: th, status: "modified" });
		else changes.push({ path, fromHash: fh, toHash: th, status: "unchanged" });
	}
	return changes;
}

export async function exportSandboxVc(): Promise<SandboxVcExport> {
	await ensureInit();
	const [branches, commits, commitFiles] = await Promise.all([
		getAll<DBBranch>("branches"),
		getAll<DBCommit>("commits"),
		getAll<DBCommitFile>("commitFiles"),
	]);
	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		activeBranchId: localStorage.getItem("keating-vc-active-branch") ?? "main",
		branches,
		commits,
		commitFiles,
	};
}

export async function importSandboxVc(payload: SandboxVcExport): Promise<void> {
	if (!payload || payload.schemaVersion !== 1) {
		throw new Error("Unsupported Keating sandbox VC export.");
	}
	await ensureInit();
	for (const branch of payload.branches ?? []) {
		await put("branches", branch);
	}
	for (const commit of payload.commits ?? []) {
		await put("commits", commit);
	}
	for (const file of payload.commitFiles ?? []) {
		await put("commitFiles", file);
	}
	localStorage.setItem("keating-vc-active-branch", payload.activeBranchId || "main");
}

export async function getSandboxLix() {
	await ensureInit();
	return {
		activeBranchId: async () => localStorage.getItem("keating-vc-active-branch") ?? "main",
	};
}

export async function openSandboxLix() {
	await ensureInit();
}

export function closeSandboxLix() {
	/* no-op for browser-native impl */
}
