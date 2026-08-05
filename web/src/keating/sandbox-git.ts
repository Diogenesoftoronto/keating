/**
 * Browser-native version control for the Keating sandbox, backed by isomorphic-git.
 *
 * Git is a side-car history here, not the live filesystem: nodepod remains the
 * source of truth for sandbox files. Commits receive a file list, write it into
 * the git worktree, and record it. Restoring reads a commit back out and writes
 * it into nodepod.
 *
 * The repository lives on an injectable filesystem so the logic is testable off
 * the browser: production uses LightningFS over IndexedDB, tests pass node's fs
 * against a temp directory.
 */

import git from "isomorphic-git";

const FS_NAME = "keating-sandbox-git";
const REPO_DIR = "/sandbox";

const AUTHOR = {
	name: "Keating Sandbox",
	email: "sandbox@keating.local",
} as const;

/**
 * Minimal shape isomorphic-git needs. LightningFS exposes a promise-based
 * `flush` on `promises` (the top-level `flush` is callback-based); node's fs
 * has neither, hence optional.
 */
export interface SandboxGitFs {
	promises: { flush?: () => Promise<void> } & Record<string, unknown>;
}

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

export interface SandboxGitExport {
	schemaVersion: 2;
	generatedAt: string;
	/** Every file under .git, as path -> base64 content. The faithful history. */
	objects: Record<string, string>;
	/**
	 * Denormalized commit summary derived from `objects` at export time, so
	 * consumers (fine-tune export, import counts) can read the log without
	 * standing up a git repository. `objects` remains the source of truth.
	 */
	commits: SandboxCommit[];
}

export type SandboxDiffStatus = "added" | "removed" | "modified" | "unchanged";

export interface SandboxDiffChange {
	path: string;
	fromHash?: string;
	toHash?: string;
	status: SandboxDiffStatus;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}

/** Git tracks paths without a leading slash; the sandbox hands us absolute ones. */
function toRepoPath(path: string): string {
	return path.replace(/^\/+/, "");
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------
export interface SandboxGit {
	commit(files: Array<{ path: string; content: string }>, message: string): Promise<string>;
	listBranches(): Promise<SandboxBranch[]>;
	listCommits(branchId?: string): Promise<SandboxCommit[]>;
	createBranch(name: string): Promise<SandboxBranch>;
	checkoutBranch(branchId: string): Promise<void>;
	diffCommits(fromCommitId: string, toCommitId: string): Promise<SandboxDiffChange[]>;
	readCommitFiles(commitId: string): Promise<Array<{ path: string; content: string }>>;
	activeBranchId(): Promise<string>;
	open(): Promise<void>;
	export(): Promise<SandboxGitExport>;
	import(payload: SandboxGitExport): Promise<void>;
}

export function createSandboxGit(options: { fs: SandboxGitFs; dir?: string }): SandboxGit {
	const fs = options.fs as never;
	const dir = options.dir ?? REPO_DIR;
	const base = { fs, dir } as const;

	let initialized: Promise<void> | null = null;

	async function flush(): Promise<void> {
		// LightningFS may apply writes out of order; flushing bounds the window
		// in which a crash could leave the repository inconsistent. Absent on
		// node's fs, which needs no such bounding.
		await (options.fs.promises.flush?.() ?? Promise.resolve());
	}

	async function ensureRepo(): Promise<void> {
		if (initialized) return initialized;
		initialized = (async () => {
			const promises = options.fs.promises as { mkdir(p: string): Promise<void> };
			try {
				await promises.mkdir(dir);
			} catch {
				// already exists
			}
			// init is idempotent: on an existing repo it leaves refs and objects alone.
			await git.init({ ...base, defaultBranch: "main" });
		})();
		try {
			return await initialized;
		} catch (error) {
			initialized = null;
			throw error;
		}
	}

	/** Files recorded in a commit, as path -> blob oid. */
	async function treeFiles(commitOid: string): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		await git.walk({
			...base,
			trees: [git.TREE({ ref: commitOid })],
			map: async (filepath, entries) => {
				if (filepath === ".") return;
				const entry = entries?.[0];
				if (!entry) return;
				if ((await entry.type()) !== "blob") return;
				out.set(filepath, await entry.oid());
			},
		});
		return out;
	}

	async function headOid(ref: string): Promise<string | null> {
		try {
			return await git.resolveRef({ ...base, ref });
		} catch {
			return null;
		}
	}

	return {
		async open() {
			await ensureRepo();
		},

		async activeBranchId() {
			await ensureRepo();
			return (await git.currentBranch({ ...base, fullname: false })) ?? "main";
		},

		async commit(files, message) {
			await ensureRepo();
			const promises = options.fs.promises as {
				writeFile(p: string, d: Uint8Array): Promise<void>;
				mkdir(p: string): Promise<void>;
			};

			const desired = new Set<string>();
			for (const file of files) {
				const repoPath = toRepoPath(file.path);
				desired.add(repoPath);

				// Materialize parent directories before writing.
				const segments = repoPath.split("/");
				segments.pop();
				let current = dir;
				for (const segment of segments) {
					current = `${current}/${segment}`;
					try {
						await promises.mkdir(current);
					} catch {
						// already exists
					}
				}

				await promises.writeFile(`${dir}/${repoPath}`, encoder.encode(file.content));
				await git.add({ ...base, filepath: repoPath });
			}

			// Stage removals for anything tracked previously but absent now.
			const tracked = await git.statusMatrix({ ...base });
			for (const [filepath, head] of tracked) {
				if (head === 0) continue;
				if (desired.has(filepath)) continue;
				await git.remove({ ...base, filepath });
			}

			const oid = await git.commit({
				...base,
				message,
				author: { ...AUTHOR },
				committer: { ...AUTHOR },
			});
			await flush();
			return oid;
		},

		async listBranches() {
			await ensureRepo();
			const names = await git.listBranches({ ...base });
			const active = await this.activeBranchId();
			const branches = names.length > 0 ? names : [active];
			return Promise.all(
				branches.map(async (name) => ({
					id: name,
					name,
					commitId: await headOid(name),
					hidden: false,
				})),
			);
		},

		async listCommits(branchId) {
			await ensureRepo();
			const ref = branchId ?? (await this.activeBranchId());
			let entries: Awaited<ReturnType<typeof git.log>>;
			try {
				entries = await git.log({ ...base, ref });
			} catch {
				// Unborn branch: no commits yet.
				return [];
			}

			return Promise.all(
				entries.map(async (entry) => {
					const files = [...(await treeFiles(entry.oid))].map(([path, hash]) => ({ path, hash }));
					return {
						id: entry.oid,
						branchId: ref,
						message: entry.commit.message.trim(),
						createdAt: new Date(entry.commit.author.timestamp * 1000).toISOString(),
						fileCount: files.length,
						files,
					};
				}),
			);
		},

		async createBranch(name) {
			await ensureRepo();
			await git.branch({ ...base, ref: name, checkout: false });
			await flush();
			return { id: name, name, commitId: await headOid(name), hidden: false };
		},

		async checkoutBranch(branchId) {
			await ensureRepo();
			await git.checkout({ ...base, ref: branchId });
			await flush();
		},

		async diffCommits(fromCommitId, toCommitId) {
			await ensureRepo();
			const [from, to] = await Promise.all([treeFiles(fromCommitId), treeFiles(toCommitId)]);
			const paths = new Set([...from.keys(), ...to.keys()]);

			const changes: SandboxDiffChange[] = [];
			for (const path of paths) {
				const fromHash = from.get(path);
				const toHash = to.get(path);
				if (!fromHash) changes.push({ path, toHash, status: "added" });
				else if (!toHash) changes.push({ path, fromHash, status: "removed" });
				else if (fromHash !== toHash) changes.push({ path, fromHash, toHash, status: "modified" });
				else changes.push({ path, fromHash, toHash, status: "unchanged" });
			}
			return changes;
		},

		async readCommitFiles(commitId) {
			await ensureRepo();
			const files = await treeFiles(commitId);
			return Promise.all(
				[...files.keys()].map(async (path) => {
					const { blob } = await git.readBlob({ ...base, oid: commitId, filepath: path });
					return { path: `/${path}`, content: decoder.decode(blob) };
				}),
			);
		},

		async export() {
			await ensureRepo();
			const promises = options.fs.promises as {
				readdir(p: string): Promise<string[]>;
				readFile(p: string): Promise<Uint8Array>;
				stat(p: string): Promise<{ isDirectory(): boolean }>;
			};

			const objects: Record<string, string> = {};
			async function walkDir(absolute: string, relative: string): Promise<void> {
				const entries = await promises.readdir(absolute);
				for (const entry of entries) {
					const childAbs = `${absolute}/${entry}`;
					const childRel = relative ? `${relative}/${entry}` : entry;
					const stat = await promises.stat(childAbs);
					if (stat.isDirectory()) await walkDir(childAbs, childRel);
					else objects[childRel] = bytesToBase64(await promises.readFile(childAbs));
				}
			}
			await walkDir(`${dir}/.git`, "");

			// Summarize every branch's log, not just the active one, so the
			// export describes the whole history it carries.
			const branches = await git.listBranches({ ...base });
			const commits: SandboxCommit[] = [];
			const seen = new Set<string>();
			for (const branch of branches) {
				for (const commit of await this.listCommits(branch)) {
					if (seen.has(commit.id)) continue;
					seen.add(commit.id);
					commits.push(commit);
				}
			}

			return {
				schemaVersion: 2 as const,
				generatedAt: new Date().toISOString(),
				objects,
				commits,
			};
		},

		async import(payload) {
			if (!payload || payload.schemaVersion !== 2) {
				throw new Error("Unsupported sandbox git export.");
			}
			await ensureRepo();
			const promises = options.fs.promises as {
				writeFile(p: string, d: Uint8Array): Promise<void>;
				mkdir(p: string): Promise<void>;
			};

			for (const [relative, encoded] of Object.entries(payload.objects)) {
				const segments = relative.split("/");
				segments.pop();
				let current = `${dir}/.git`;
				for (const segment of segments) {
					current = `${current}/${segment}`;
					try {
						await promises.mkdir(current);
					} catch {
						// already exists
					}
				}
				await promises.writeFile(`${dir}/.git/${relative}`, base64ToBytes(encoded));
			}

			await flush();
			// Bring the worktree in line with the imported history.
			try {
				await git.checkout({ ...base, ref: await this.activeBranchId(), force: true });
			} catch {
				// An imported repo with no commits has nothing to check out.
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Default browser-backed instance
// ---------------------------------------------------------------------------
let instance: SandboxGit | null = null;

async function defaultInstance(): Promise<SandboxGit> {
	if (instance) return instance;
	const { default: LightningFS } = await import("@isomorphic-git/lightning-fs");
	instance = createSandboxGit({ fs: new LightningFS(FS_NAME) as unknown as SandboxGitFs });
	return instance;
}

export async function sandboxCommit(
	files: Array<{ path: string; content: string }>,
	message: string,
): Promise<string> {
	return (await defaultInstance()).commit(files, message);
}

export async function sandboxListBranches(): Promise<SandboxBranch[]> {
	return (await defaultInstance()).listBranches();
}

export async function sandboxListCommits(branchId?: string): Promise<SandboxCommit[]> {
	return (await defaultInstance()).listCommits(branchId);
}

export async function sandboxCreateBranch(name: string): Promise<SandboxBranch> {
	return (await defaultInstance()).createBranch(name);
}

export async function sandboxCheckoutBranch(branchId: string): Promise<void> {
	return (await defaultInstance()).checkoutBranch(branchId);
}

export async function sandboxDiffCommits(
	fromCommitId: string,
	toCommitId: string,
): Promise<SandboxDiffChange[]> {
	return (await defaultInstance()).diffCommits(fromCommitId, toCommitId);
}

/** Files recorded at a commit, ready to be written back into nodepod. */
export async function sandboxReadCommitFiles(
	commitId: string,
): Promise<Array<{ path: string; content: string }>> {
	return (await defaultInstance()).readCommitFiles(commitId);
}

export async function getSandboxRepo(): Promise<{ activeBranchId: () => Promise<string> }> {
	const repo = await defaultInstance();
	return { activeBranchId: () => repo.activeBranchId() };
}

export async function openSandboxRepo(): Promise<void> {
	await (await defaultInstance()).open();
}

export function closeSandboxRepo(): void {
	instance = null;
}

export async function exportSandboxGit(): Promise<SandboxGitExport> {
	return (await defaultInstance()).export();
}

export async function importSandboxGit(payload: SandboxGitExport): Promise<void> {
	return (await defaultInstance()).import(payload);
}
