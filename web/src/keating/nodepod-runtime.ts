import { Nodepod } from "@scelar/nodepod";
import { NODEPOD_BOOT_FILES } from "./nodepod-boot-files";

let nodePodInstance: Nodepod | null = null;
let nodePodBootPromise: Promise<Nodepod | null> | null = null;

// Baseline content for diff computation
const baselineContent = new Map<string, string>();

export const NODEPOD_LOCAL_ENDPOINT = "nodepod://local";

export function isNodePodActive(): boolean {
	return nodePodInstance !== null;
}

export async function getNodePod(): Promise<Nodepod | null> {
	if (nodePodInstance) return nodePodInstance;
	if (nodePodBootPromise) return nodePodBootPromise;
	return null;
}

export async function bootNodePod(): Promise<Nodepod | null> {
	if (nodePodInstance) return nodePodInstance;
	if (nodePodBootPromise) return nodePodBootPromise;

	nodePodBootPromise = (async () => {
		try {
			const pod = await Nodepod.boot({
				files: {},
				workdir: "/workspace",
			});

			// Lazy-load boot files so they code-split into their own chunk
			const { NODEPOD_BOOT_FILES } = await import("./nodepod-boot-files");

			// Populate VFS with bundled source files
			for (const [relPath, content] of Object.entries(NODEPOD_BOOT_FILES)) {
				const vPath = `/workspace/${relPath}`;
				await writeFileToVfs(pod, vPath, content);
				baselineContent.set(vPath, content);
			}

			// Create package.json and tsconfig for the workspace
			await writeFileToVfs(
				pod,
				"/workspace/package.json",
				JSON.stringify({
					name: "keating-nodepod-workspace",
					type: "module",
					dependencies: {},
					devDependencies: {},
				},
				null,
				2)
			);

			await writeFileToVfs(
				pod,
				"/workspace/tsconfig.json",
				JSON.stringify(
					{
						compilerOptions: {
							module: "NodeNext",
							moduleResolution: "NodeNext",
							target: "ES2022",
							strict: true,
							outDir: "dist",
							rootDir: ".",
						},
						include: ["src/**/*"],
					},
					null,
					2
				)
			);

			// Seed a small test runner file
			await writeFileToVfs(
				pod,
				"/workspace/run-test.js",
				`// Minimal test harness for NodePod experimentation
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}
function assertEq(a, b) {
  if (a !== b) throw new Error(\`Expected \${b}, got \${a}\`);
}
// Agent writes tests here and then runs this file
globalThis.test = test;
globalThis.assertEq = assertEq;
`
			);

			nodePodInstance = pod;
			console.log("[nodepod] Booted successfully with", Object.keys(NODEPOD_BOOT_FILES).length, "source files, instanceId:", pod.instanceId);
			return pod;
		} catch (err) {
			console.warn("[nodepod] Boot failed:", err instanceof Error ? err.message : String(err));
			return null;
		}
	})();

	return nodePodBootPromise;
}

export async function teardownNodePod(): Promise<void> {
	if (nodePodInstance) {
		nodePodInstance.teardown();
		nodePodInstance = null;
		nodePodBootPromise = null;
		baselineContent.clear();
	}
}

/* ─── VFS helpers ───────────────────────────────────────── */

async function writeFileToVfs(pod: Nodepod, path: string, content: string): Promise<void> {
	// Ensure directory exists
	const dir = path.substring(0, path.lastIndexOf("/"));
	if (dir && dir !== "/") {
		try {
			await pod.fs.mkdir(dir, { recursive: true });
		} catch {
			// may already exist
		}
	}
	await pod.fs.writeFile(path, content);
}

/* ─── Introspection ─────────────────────────────────────── */

export interface NodePodMemoryStats {
	vfs: { fileCount: number; totalBytes: number; dirCount: number; watcherCount: number };
	engine: { moduleCacheSize: number; transformCacheSize: number };
	heap: { usedMB: number; totalMB: number; limitMB: number } | null;
}

export interface NodePodInfo {
	instanceId: string;
	sabEnabled: boolean;
	memoryStats: NodePodMemoryStats | null;
	bootFileCount: number;
}

export async function nodePodInfo(): Promise<NodePodInfo | null> {
	const pod = await getNodePod();
	if (!pod) return null;
	let memoryStats: NodePodMemoryStats | null = null;
	try {
		memoryStats = pod.memoryStats();
	} catch {
		// memoryStats may throw in some nodepod versions
	}
	return { instanceId: pod.instanceId, sabEnabled: pod.isSharedArrayBufferEnabled, memoryStats, bootFileCount: Object.keys(NODEPOD_BOOT_FILES).length };
}

/* ─── VFS ───────────────────────────────────────────────── */

export interface VfsEntry {
	name: string;
	path: string;
	isDir: boolean;
	size: number;
}

export async function nodePodReaddir(dirPath: string): Promise<VfsEntry[]> {
	const pod = await getNodePod();
	if (!pod) return [];

	const names: string[] = await pod.fs.readdir(dirPath);

	const entries = await Promise.all(
		names.map(async (name) => {
			const fullPath = dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`;
			try {
				const stat = await pod!.fs.stat(fullPath);
				return {
					name,
					path: fullPath,
					isDir: !!stat.isDirectory,
					size: typeof stat.size === "number" ? stat.size : 0,
				};
			} catch {
				return { name, path: fullPath, isDir: false, size: 0 };
			}
		})
	);

	return entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

export async function nodePodReadTextFile(path: string): Promise<string> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	return pod.fs.readFile(path, "utf8");
}

export async function nodePodWriteTextFile(path: string, content: string): Promise<void> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	await writeFileToVfs(pod, path, content);
}

export async function nodePodDeletePath(path: string, recursive = false): Promise<void> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");

	let isDir = false;
	try {
		const stat = await pod.fs.stat(path);
		isDir = !!stat.isDirectory;
	} catch {
		// stat may fail on some paths; fall through to file-first
	}

	try {
		if (isDir) {
			await pod.fs.rmdir(path, { recursive });
		} else {
			await pod.fs.unlink(path);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("ENOENT")) {
			throw new Error(`Path not found: ${path}`);
		} else if (isDir && msg.includes("ENOTEMPTY")) {
			throw new Error(`Directory not empty: ${path}. Use recursive delete.`, { cause: e });
		} else {
			throw e;
		}
	}
}

export async function nodePodCreatePath(parent: string, name: string, isDir: boolean): Promise<void> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	const path = parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
	if (isDir) {
		await pod.fs.mkdir(path, { recursive: true });
	} else {
		await writeFileToVfs(pod, path, "");
	}
}

export async function nodePodExists(path: string): Promise<boolean> {
	try {
		const pod = await getNodePod();
		if (!pod) return false;
		await pod.fs.stat(path);
		return true;
	} catch {
		return false;
	}
}

/* ─── Source editing ────────────────────────────────────── */

export interface SourceEdit {
	file: string;
	search: string;
	replace: string;
	reason?: string;
}

export interface EditResult {
	success: boolean;
	file: string;
	message: string;
	diff?: {
		linesRemoved: number;
		linesAdded: number;
		charDelta: number;
	};
}

/**
 * Apply a single search/replace edit to a file in the NodePod VFS.
 * The search block must match exactly (including whitespace).
 */
export async function nodePodApplyEdit(edit: SourceEdit): Promise<EditResult> {
	const pod = await getNodePod();
	if (!pod) {
		return { success: false, file: edit.file, message: "NodePod is not available" };
	}

	let original: string;
	try {
		original = await pod.fs.readFile(edit.file, "utf8");
	} catch (error) {
		return {
			success: false,
			file: edit.file,
			message: `Cannot read file: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const searchNormalized = edit.search.replace(/\r\n/g, "\n");
	const contentNormalized = original.replace(/\r\n/g, "\n");

	if (!contentNormalized.includes(searchNormalized)) {
		return {
			success: false,
			file: edit.file,
			message:
				`Search block not found in file. Ensure the search text matches exactly, including ` +
				`indentation and newlines. File: ${edit.file}`,
		};
	}

	const occurrences = contentNormalized.split(searchNormalized).length - 1;
	if (occurrences > 1) {
		return {
			success: false,
			file: edit.file,
			message:
				`Search block appears ${occurrences} times in the file. ` +
				`Edit rejected for safety — include more surrounding context to make the search unique.`,
		};
	}

	const nextContent = contentNormalized.replace(searchNormalized, edit.replace);
	await pod.fs.writeFile(edit.file, nextContent);

	const linesRemoved = searchNormalized.split("\n").length;
	const linesAdded = edit.replace.split("\n").length;

	return {
		success: true,
		file: edit.file,
		message: `Edited ${edit.file}: ${linesRemoved} lines removed, ${linesAdded} lines added. Reason: ${edit.reason || "unspecified"}`,
		diff: {
			linesRemoved,
			linesAdded,
			charDelta: edit.replace.length - searchNormalized.length,
		},
	};
}

/**
 * Apply multiple edits in sequence. Stops on first failure.
 */
export async function nodePodApplyEdits(edits: SourceEdit[]): Promise<{ results: EditResult[]; rollbackSnapshots: Map<string, string> }> {
	const results: EditResult[] = [];
	const rollbackSnapshots = new Map<string, string>();

	for (const edit of edits) {
		const pod = await getNodePod();
		if (!pod) {
			results.push({ success: false, file: edit.file, message: "NodePod unavailable" });
			break;
		}

		let currentContent: string;
		try {
			currentContent = await pod.fs.readFile(edit.file, "utf8");
		} catch {
			currentContent = "";
		}

		if (!rollbackSnapshots.has(edit.file)) {
			rollbackSnapshots.set(edit.file, currentContent);
		}

		const result = await nodePodApplyEdit(edit);
		results.push(result);

		if (!result.success) {
			break;
		}
	}

	return { results, rollbackSnapshots };
}

/**
 * Rollback files in NodePod VFS to their pre-edit state.
 */
export async function nodePodRollbackEdits(snapshots: Map<string, string>): Promise<void> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	for (const [file, content] of snapshots) {
		await pod.fs.writeFile(file, content);
	}
}

/**
 * Compute diff between the current VFS content and the baseline.
 */
export function nodePodComputeDiff(): Array<{ file: string; baseline: string; current: string; changed: boolean; charDelta: number }> {
	const diffs: Array<{ file: string; baseline: string; current: string; changed: boolean; charDelta: number }> = [];
	for (const [file, baseline] of baselineContent) {
		// We can't read current from sync context; this is a placeholder for async diff
		// The actual diff is done by source_diff tool which reads async
	}
	return diffs;
}

/**
 * Async diff for a single file.
 */
export async function nodePodDiffFile(file: string): Promise<{ baseline: string | undefined; current: string; changed: boolean; charDelta: number } | null> {
	const pod = await getNodePod();
	if (!pod) return null;
	const baseline = baselineContent.get(file);
	let current: string;
	try {
		current = await pod.fs.readFile(file, "utf8");
	} catch {
		return null;
	}
	return {
		baseline,
		current,
		changed: current !== baseline,
		charDelta: current.length - (baseline?.length ?? 0),
	};
}

/**
 * Get a list of all files that differ from baseline.
 */
export async function nodePodChangedFiles(): Promise<Array<{ file: string; charDelta: number }>> {
	const pod = await getNodePod();
	if (!pod) return [];
	const changed: Array<{ file: string; charDelta: number }> = [];
	for (const [file, baseline] of baselineContent) {
		try {
			const current = await pod.fs.readFile(file, "utf8");
			if (current !== baseline) {
				changed.push({ file, charDelta: current.length - baseline.length });
			}
		} catch {
			// file deleted or unreadable
		}
	}
	return changed;
}

/* ─── Shell ─────────────────────────────────────────────── */

export interface ShellSession {
	id: string;
	command: string;
	args: string[];
	stdout: string;
	stderr: string;
	exitCode: number | null;
	running: boolean;
	startedAt: number;
	durationMs: number | null;
	ok: boolean;
	result: string;
}

export async function nodePodRunCapturing(command: string, args: string[] = []): Promise<ShellSession> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");

	const id = crypto.randomUUID?.() ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const startedAt = performance.now();

	const session: ShellSession = {
		id,
		command,
		args,
		stdout: "",
		stderr: "",
		exitCode: null,
		running: true,
		startedAt,
		durationMs: null,
		ok: false,
		result: "",
	};

	try {
		const proc = await pod.spawn(command, args, { cwd: "/workspace" });
		proc.on("output", (text: string) => {
			session.stdout += text;
		});
		proc.on("error", (text: string) => {
			session.stderr += text;
		});
		proc.on("exit", (code: number) => {
			session.exitCode = code;
		});
		await proc.completion;
	} catch (e) {
		session.stderr += `\n[spawn error: ${e instanceof Error ? e.message : String(e)}]`;
		session.exitCode = session.exitCode ?? -1;
	} finally {
		session.running = false;
		session.durationMs = Math.round(performance.now() - startedAt);
		session.ok = session.exitCode === 0;
		session.result = session.stdout || session.stderr;
	}
	return session;
}

/**
 * Run a Node.js script by writing it to a temp file and executing it.
 */
export async function nodePodRunScript(code: string, filename = "/workspace/_agent_script.js"): Promise<ShellSession> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	await writeFileToVfs(pod, filename, code);
	return nodePodRunCapturing("node", [filename]);
}

/* ─── Snapshots ─────────────────────────────────────────── */

// In-memory snapshot log for the visualizer to persist across probes
const snapshotLog: Array<{ id: string; instanceId: string; createdAt: string; data: unknown }> = [];

export function getSnapshotLog(): typeof snapshotLog {
	return [...snapshotLog];
}

export async function nodePodCreateSnapshot(name?: string): Promise<{ id: string; instanceId: string; createdAt: string; data: unknown }> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	const snap = pod.snapshot();
	const entry = {
		id: name ?? `snapshot-${Date.now()}`,
		instanceId: pod.instanceId,
		createdAt: new Date().toISOString(),
		data: snap,
	};
	snapshotLog.unshift(entry);
	// cap to 20
	snapshotLog.splice(20);
	return entry;
}

export async function nodePodRestoreSnapshot(data: unknown): Promise<void> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");
	await pod.restore(data as ReturnType<typeof pod.snapshot>);
}

/* ─── Validation Bridge ─────────────────────────────────── */

/** Track the most recent snapshot per file path for rollback. */
const preEditSnapshotByFile = new Map<string, { id: string; data: unknown }>();

/**
 * Transpile TypeScript source to JavaScript using a fast regex-based
 * transpiler suitable for the Keating core modules.
 *
 * This handles:
 *   - Type annotations on vars, params, returns
 *   - Interface / type declarations
 *   - Generic parameters
 *   - Import type / export type
 *   - ESM import extensions (.ts → .js)
 */
export function transpileTsToJs(source: string): string {
	let js = source;

	// Remove `import type` and `export type` lines
	js = js.replace(/^\s*import\s+type\s+[^;]+;/gm, "");
	js = js.replace(/^\s*export\s+type\s+[^;]+;/gm, "");

	// Remove standalone type aliases
	js = js.replace(/^\s*type\s+\w+[^=;]*=\s*[^;]+;?\s*$/gm, "");

	// Remove interface declarations (simple single-line and multi-line)
	js = js.replace(/^\s*interface\s+\w+\s*\{[^}]*\}\s*$/gm, "");
	js = js.replace(/\binterface\s+\w+\s*\{[\s\S]*?\n\}\s*$/gm, "");

	// Remove generic type parameters from functions, classes, methods
	js = js.replace(/(function|class|method)\s+(\w+)<[^>]+>/g, "$1 $2");

	// Remove variable type annotations: const x: number = 5 → const x = 5
	// Be careful not to match inside strings — this is best-effort
	js = js.replace(/(\b(?:const|let|var)\s+\w+)\s*:\s*[^=;]+(?=[=;])/g, "$1");

	// Remove parameter type annotations in function signatures
	// (conservative: only match simple identifiers, not destructuring)
	js = js.replace(/(\(|,)\s*(\w+)\s*:\s*[^,)\]]+/g, "$1$2");

	// Remove return type annotations: ): SomeType { → ) {
	js = js.replace(/\)\s*:\s*[^{]+\{/g, ") {");

	// Remove `as` type assertions
	js = js.replace(/\s+as\s+\w+/g, "");

	// Convert .ts import extensions to .js
	js = js.replace(/from\s+["']([^"']+)\.ts["']/g, 'from "$1.js"');
	js = js.replace(/require\(["']([^"']+)\.ts["']\)/g, 'require("$1.js")');

	// Remove access modifiers and declare keywords
	js = js.replace(/\b(declare|readonly|private|protected|public)\b/g, "");

	// Clean up excess blank lines
	js = js.replace(/\n{3,}/g, "\n\n");

	return js;
}

/**
 * Given a .ts path in the VFS, transpile it to .js and write the JS
 * counterpart so NodePod's `require()` can load it.
 */
export async function writeJsCounterpart(tsPath: string): Promise<string> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");

	const jsPath = tsPath.replace(/\.ts$/, ".js");
	const tsContent = await nodePodReadTextFile(tsPath);
	const jsContent = transpileTsToJs(tsContent);
	await writeFileToVfs(pod, jsPath, jsContent);
	return jsPath;
}

export interface ValidationResult {
	passed: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	restored: boolean;
	message: string;
}

/**
 * Validate a source edit by running a test script inside NodePod.
 * If the test fails and a pre-edit snapshot exists for the file,
 * automatically rolls back to that snapshot.
 */
export async function nodePodValidateEdit(
	tsFilePath: string,
	testScript: string,
	options: { autoRollback?: boolean; snapshotLabel?: string } = {}
): Promise<ValidationResult> {
	const pod = await getNodePod();
	if (!pod) throw new Error("NodePod unavailable");

	const { autoRollback = true } = options;

	// Step 1: snapshot current state (if not already snapshotted)
	let snapId: string | null = null;
	if (autoRollback && !preEditSnapshotByFile.has(tsFilePath)) {
		try {
			const snap = await nodePodCreateSnapshot(`validate-${Date.now()}`);
			preEditSnapshotByFile.set(tsFilePath, { id: snap.id, data: snap.data });
			snapId = snap.id;
		} catch {
			// snapshot failed, continue without rollback safety
		}
	}

	// Step 2: transpile the TS file to JS so require() works
	let jsPath: string;
	try {
		jsPath = await writeJsCounterpart(tsFilePath);
	} catch (e) {
		return {
			passed: false,
			exitCode: null,
			stdout: "",
			stderr: `Transpile failed: ${e instanceof Error ? e.message : String(e)}`,
			durationMs: 0,
			restored: false,
			message: `Could not transpile ${tsFilePath} to JS.`,
		};
	}

	// Step 3: run the test script
	const started = performance.now();
	const filename = `/workspace/_validate_${Date.now()}.js`;
	const session = await nodePodRunScript(testScript, filename);
	const durationMs = Math.round(performance.now() - started);

	const passed = session.exitCode === 0;

	// Step 4: rollback on failure if snapshot exists
	let restored = false;
	if (!passed && autoRollback) {
		const saved = preEditSnapshotByFile.get(tsFilePath);
		if (saved) {
			try {
				await nodePodRestoreSnapshot(saved.data);
				restored = true;
			} catch {
				// restore failed, leave partial state
			}
		}
	}

	const message = passed
		? `Validation passed. (${durationMs}ms)`
		: restored
			? `Validation failed (exit ${session.exitCode}). Automatic rollback to snapshot ${snapId ?? "unknown"} completed. Edit was reverted.`
			: `Validation failed (exit ${session.exitCode}). No snapshot available for rollback — edit remains in place.`;

	return {
		passed,
		exitCode: session.exitCode,
		stdout: session.stdout,
		stderr: session.stderr,
		durationMs,
		restored,
		message,
	};
}

/** Clear the pre-edit snapshot tracker (e.g. after a successful session). */
export function clearPreEditSnapshots(): void {
	preEditSnapshotByFile.clear();
}

/* ─── Virtual servers ───────────────────────────────────── */

export function nodePodGetPreviewUrl(port: number): string | null {
	if (!nodePodInstance) return null;
	return nodePodInstance.port(port) ?? null;
}

/* ─── execute bridge (for tools + visualizer probes) ─────── */

export async function nodePodExecute(operation: string, payload: unknown): Promise<unknown> {
	const pod = await getNodePod();
	if (!pod) {
		throw new Error("NodePod is not available");
	}

	switch (operation) {
		case "runtime.ping": {
			const info = await nodePodInfo();
			return { ok: true, ...info, timestamp: Date.now() };
		}

		case "shell.exec": {
			const p = (payload || {}) as Record<string, unknown>;
			const command = typeof p.command === "string" ? p.command : "";
			const args = Array.isArray(p.args) ? p.args.map(String) : [];
			const session = await nodePodRunCapturing(command, args);
			return session;
		}

		case "script.run": {
			const p = (payload || {}) as Record<string, unknown>;
			const code = String(p.code ?? "");
			const filename = typeof p.filename === "string" ? p.filename : "/workspace/_agent_script.js";
			if (!code.trim()) throw new Error("script.run requires payload.code");
			return await nodePodRunScript(code, filename);
		}

		case "fs.read": {
			const p = (payload || {}) as Record<string, unknown>;
			const path = String(p.path ?? "");
			if (p.encoding === "utf8") {
				const content = await nodePodReadTextFile(path);
				return { content, encoding: "utf8" };
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const content: Uint8Array = await (pod.fs.readFile(path) as any);
			return { content: uint8ArrayToBase64(content), encoding: "base64" };
		}

		case "fs.write": {
			const p = (payload || {}) as Record<string, unknown>;
			const path = String(p.path ?? "");
			const encoding = p.encoding === "base64" ? "base64" : "utf8";
			const contentStr = String(p.content ?? "");
			const data: string | Uint8Array = encoding === "base64" ? base64ToUint8Array(contentStr) : contentStr;
			await pod.fs.writeFile(path, data);
			return { ok: true, path };
		}

		case "snapshot.create": {
			const p = (payload || {}) as Record<string, unknown>;
			const result = await nodePodCreateSnapshot(typeof p.label === "string" ? p.label : undefined);
			return result;
		}

		case "snapshot.restore": {
			const p = (payload || {}) as Record<string, unknown>;
			const data = p.data;
			if (!data) throw new Error("snapshot.restore requires payload.data");
			await nodePodRestoreSnapshot(data);
			return { ok: true, instanceId: pod.instanceId };
		}

		default:
			throw new Error(`Unsupported NodePod operation: ${operation}`);
	}
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	const binary = Array.from(bytes)
		.map((b) => String.fromCharCode(b))
		.join("");
	return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
