import { StringDecoder } from "node:string_decoder";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve, relative, dirname, isAbsolute, join, sep } from "node:path";

export const MAX_NATIVE_BODY = 2 * 1024 * 1024;
const MAX_OUTPUT = 1024 * 1024;
const MAX_FILE = 1024 * 1024;
const MAX_PROCESSES = 8;
const MAX_JOBS = 64;
const MAX_TIMEOUT = 30 * 60 * 1000;
const inheritedEnvironment = [
	"PATH",
	"HOME",
	"USERPROFILE",
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"TMP",
	"TEMP",
	"SystemRoot",
	"SYSTEMROOT",
	"COMSPEC",
	"PATHEXT",
	"LANG",
	"LC_ALL",
	"TERM",
];

function object(value: unknown): Record<string, unknown> {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error("Native payload must be an object.");
	return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = MAX_FILE): string {
	if (
		typeof value !== "string" ||
		value.includes("\0") ||
		Buffer.byteLength(value) > max
	)
		throw new Error(`${label} is invalid or too large.`);
	return value;
}
function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
/** File operations are workspace-contained. Native processes deliberately are not a sandbox. */
export async function nativeWorkspacePath(
	root: string,
	value: unknown,
	allowRoot = true,
): Promise<string> {
	let path = value === undefined ? "." : string(value, "Path", 8192);
	if (path === "/workspace" || path.startsWith("/workspace/"))
		path = `.${path.slice(10)}`;
	const target = resolve(root, path);
	if (!within(root, target) || (!allowRoot && target === root))
		throw new Error("Path must stay inside the desktop workspace.");
	let ancestor = target;
	while (true) {
		try {
			const real = await fs.realpath(ancestor);
			if (!within(root, real))
				throw new Error("Symlink points outside the desktop workspace.");
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			// A dangling symlink must not become an escape when its target is created.
			try {
				if ((await fs.lstat(ancestor)).isSymbolicLink())
					throw new Error("Dangling symlinks are not allowed.");
			} catch (statError) {
				if ((statError as NodeJS.ErrnoException).code !== "ENOENT")
					throw statError;
			}
			if (ancestor === root) throw new Error("Workspace is unavailable.");
			ancestor = dirname(ancestor);
		}
	}
	return target;
}

export function nativeProcessEnvironment(extra: unknown): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of inheritedEnvironment)
		if (process.env[key] !== undefined) env[key] = process.env[key];
	const values = object(extra);
	if (Object.keys(values).length > 64)
		throw new Error("Too many environment entries.");
	for (const [key, value] of Object.entries(values)) {
		if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key))
			throw new Error("Environment key is invalid.");
		env[key] = string(value, "Environment value", 8192);
	}
	return env;
}

interface Job {
	id: string;
	child: ChildProcessWithoutNullStreams;
	stdout: string;
	stderr: string;
	bytes: number;
	exitCode: number | null;
	running: boolean;
	timedOut: boolean;
	truncated: boolean;
	command: string;
	args: string[];
	startedAt: number;
	endedAt?: number;
	signal: string | null;
	stdoutTruncated: boolean;
	stderrTruncated: boolean;
	done: Promise<void>;
	timer: ReturnType<typeof setTimeout>;
}
function result(job: Job) {
	return {
		processId: job.id,
		stdout: job.stdout,
		stderr: job.stderr,
		exitCode: job.exitCode,
		running: job.running,
		timedOut: job.timedOut,
		truncated: job.truncated,
		command: job.command,
		args: job.args,
		durationMs: (job.endedAt ?? Date.now()) - job.startedAt,
		signal: job.signal,
		stdoutTruncated: job.stdoutTruncated,
		stderrTruncated: job.stderrTruncated,
	};
}
function killTree(job: Job): void {
	if (!job.child.pid) return;
	if (process.platform === "win32") {
		const killer = spawn(
			"taskkill",
			["/pid", String(job.child.pid), "/T", "/F"],
			{
				env: nativeProcessEnvironment(undefined),
				stdio: "ignore",
				windowsHide: true,
			},
		);
		killer.on("error", () => {
			job.child.kill("SIGKILL");
		});
	} else {
		try {
			process.kill(-job.child.pid, "SIGKILL");
		} catch {
			job.child.kill("SIGKILL");
		}
	}
}

export class NativeWorkspaceService {
	private readonly jobs = new Map<string, Job>();
	private stopped = false;
	private starting = 0;
	constructor(readonly projectRoot: string) {}
	private job(payload: Record<string, unknown>): Job {
		const job = this.jobs.get(string(payload.processId, "Process id", 128));
		if (!job) throw new Error("Native process no longer exists.");
		return job;
	}
	private async start(payload: Record<string, unknown>): Promise<Job> {
		if (this.stopped) throw new Error("Native runtime is shutting down.");
		if (
			[...this.jobs.values()].filter((job) => job.running).length +
				this.starting >=
			MAX_PROCESSES
		)
			throw new Error(
				"Too many native processes. Stop a process before starting another.",
			);
		this.starting++;
		try {
			const command = string(payload.command, "Command", 65536);
			if (!command.trim()) throw new Error("Command must not be empty.");
			const args = payload.args;
			if (args !== undefined && (!Array.isArray(args) || args.length > 256))
				throw new Error("Command arguments are invalid.");
			const argv =
				args === undefined
					? []
					: (args as unknown[]).map((arg) => string(arg, "Argument", 65536));
			const cwd = await nativeWorkspacePath(this.projectRoot, payload.cwd);
			const requestedTimeout = payload.timeoutMs ?? 120000;
			if (
				typeof requestedTimeout !== "number" ||
				!Number.isFinite(requestedTimeout) ||
				requestedTimeout < 1 ||
				requestedTimeout > MAX_TIMEOUT
			)
				throw new Error("Timeout must be between 1 and 1800000 milliseconds.");
			const env = nativeProcessEnvironment(payload.env);
			if (this.stopped) throw new Error("Native runtime is shutting down.");
			while (this.jobs.size >= MAX_JOBS) {
				const old = [...this.jobs.values()].find((job) => !job.running);
				if (!old) break;
				this.jobs.delete(old.id);
			}
			// Shell interpretation is explicit; structured commands execute their binary directly.
			if (
				payload.stdinClosed !== undefined &&
				typeof payload.stdinClosed !== "boolean"
			)
				throw new Error("stdinClosed must be boolean.");
			if (payload.shell !== undefined && typeof payload.shell !== "boolean")
				throw new Error("Shell mode must be boolean.");
			if (payload.shell === true && argv.length)
				throw new Error("Shell command cannot also provide arguments.");
			const child =
				payload.shell === true
					? spawn(
							process.platform === "win32"
								? (env.COMSPEC ?? "cmd.exe")
								: "/bin/sh",
							process.platform === "win32"
								? ["/d", "/s", "/c", command]
								: ["-c", command],
							{
								cwd,
								env,
								detached: process.platform !== "win32",
								windowsHide: true,
								stdio: "pipe",
							},
						)
					: spawn(command, argv, {
							cwd,
							env,
							detached: process.platform !== "win32",
							windowsHide: true,
							stdio: "pipe",
						});
			let complete!: () => void;
			const done = new Promise<void>((resolve) => {
				complete = resolve;
			});
			const job: Job = {
				id: randomBytes(16).toString("hex"),
				child,
				stdout: "",
				stderr: "",
				bytes: 0,
				exitCode: null,
				running: true,
				timedOut: false,
				truncated: false,
				command,
				args: argv,
				startedAt: Date.now(),
				signal: null,
				stdoutTruncated: false,
				stderrTruncated: false,
				done,
				timer: setTimeout(() => {
					job.timedOut = true;
					killTree(job);
				}, requestedTimeout),
			};
			const decoders = {
				stdout: new StringDecoder("utf8"),
				stderr: new StringDecoder("utf8"),
			};
			const append = (channel: "stdout" | "stderr", chunk: Buffer) => {
				const available = MAX_OUTPUT - job.bytes;
				if (chunk.length > available) {
					job.truncated = true;
					job[channel === "stdout" ? "stdoutTruncated" : "stderrTruncated"] =
						true;
				}
				const clipped = chunk.subarray(0, Math.max(available, 0));
				job[channel] += decoders[channel].write(clipped);
				job.bytes += clipped.length;
			};
			child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
			child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
			child.stdin.on("error", () => {});
			child.once("error", (error) =>
				append("stderr", Buffer.from(error.message)),
			);
			child.once("exit", () => killTree(job)); // Do not leave detached grandchildren behind.
			child.once("close", (code, signal) => {
				// A byte limit may cut through a character; do not fabricate replacement
				// characters for that intentionally discarded suffix.
				if (!job.stdoutTruncated) job.stdout += decoders.stdout.end();
				if (!job.stderrTruncated) job.stderr += decoders.stderr.end();
				job.running = false;
				job.endedAt = Date.now();
				job.signal = signal;
				job.exitCode = code ?? -1;
				clearTimeout(job.timer);
				complete();
			});
			this.jobs.set(job.id, job);
			await new Promise<void>((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", reject);
			});
			if (payload.stdinClosed === true) child.stdin.end();
			return job;
		} finally {
			this.starting--;
		}
	}
	async execute(operation: string, value: unknown): Promise<unknown> {
		if (this.stopped) throw new Error("Native runtime is shutting down.");
		const payload = object(value);
		switch (operation) {
			case "runtime.ping":
				return {
					ok: true,
					projectRoot: this.projectRoot,
					kind: "desktop-native",
					timestamp: Date.now(),
				};
			case "shell.exec": {
				const job = await this.start(payload);
				job.child.stdin.end();
				await job.done;
				const output = result(job);
				this.jobs.delete(job.id);
				return output;
			}
			case "process.start": {
				const job = await this.start(payload);
				return { processId: job.id };
			}
			case "process.list":
				return [...this.jobs.values()].map((job) => {
					const { stdout: _stdout, stderr: _stderr, ...metadata } = result(job);
					return metadata;
				});
			case "process.poll":
				return result(this.job(payload));
			case "process.write": {
				const job = this.job(payload);
				if (!job.running) throw new Error("Process has exited.");
				const input = string(payload.input, "Process input", 65536);
				if (job.child.stdin.writableLength + Buffer.byteLength(input) > 65536)
					throw new Error("Process input buffer is full.");
				job.child.stdin.write(input);
				return { ok: true };
			}
			case "process.stop": {
				const job = this.job(payload);
				if (job.running) killTree(job);
				await job.done;
				return result(job);
			}
			case "fs.list": {
				const path = await nativeWorkspacePath(this.projectRoot, payload.path);
				const entries = [];
				const dir = await fs.opendir(path);
				for await (const entry of dir) {
					if (entries.length >= 2000)
						throw new Error(
							"Directory has too many entries; select a smaller directory.",
						);
					const childPath = await nativeWorkspacePath(
						this.projectRoot,
						join(path, entry.name),
					);
					const stat = await fs.stat(childPath);
					entries.push({
						name: entry.name,
						path: relative(this.projectRoot, childPath).split(sep).join("/"),
						isDir: stat.isDirectory(),
						size: stat.size,
					});
				}
				return entries.sort((a, b) => a.name.localeCompare(b.name));
			}
			case "fs.read": {
				const path = await nativeWorkspacePath(
					this.projectRoot,
					payload.path,
					false,
				);
				const stat = await fs.stat(path);
				if (!stat.isFile() || stat.size > MAX_FILE)
					throw new Error("Read requires a regular file at most 1 MiB.");
				const content = await fs.readFile(path);
				if (content.length > MAX_FILE)
					throw new Error("File grew beyond the read limit.");
				const encoding = payload.encoding === "base64" ? "base64" : "utf8";
				return {
					path: relative(this.projectRoot, path).split(sep).join("/"),
					content:
						encoding === "base64"
							? content.toString("base64")
							: new TextDecoder("utf-8", { fatal: true }).decode(content),
					encoding,
				};
			}
			case "fs.write": {
				const path = await nativeWorkspacePath(
					this.projectRoot,
					payload.path,
					false,
				);
				const content = Buffer.from(
					string(payload.content, "File content", MAX_NATIVE_BODY),
					payload.encoding === "base64" ? "base64" : "utf8",
				);
				if (content.length > MAX_FILE)
					throw new Error("File exceeds 1 MiB write limit.");
				await fs.mkdir(dirname(path), { recursive: true });
				await nativeWorkspacePath(this.projectRoot, path, false);
				await fs.writeFile(path, content, {
					mode: 0o600,
					flag: payload.exclusive === true ? "wx" : "w",
				});
				return {
					ok: true,
					path: relative(this.projectRoot, path).split(sep).join("/"),
					bytes: content.length,
				};
			}
			case "fs.edit": {
				const path = await nativeWorkspacePath(
					this.projectRoot,
					payload.path,
					false,
				);
				const read = (await this.execute("fs.read", {
					path,
					encoding: "utf8",
				})) as { content: string };
				const search = string(payload.search, "Search");
				const replacement = string(payload.replace, "Replacement");
				if (
					!search ||
					read.content.indexOf(search) < 0 ||
					read.content.indexOf(search) !== read.content.lastIndexOf(search)
				)
					throw new Error("Edit search must match exactly once.");
				return this.execute("fs.write", {
					path,
					content: read.content.replace(search, () => replacement),
				});
			}
			case "fs.mkdir": {
				const path = await nativeWorkspacePath(this.projectRoot, payload.path);
				await fs.mkdir(path, { recursive: true });
				return {
					ok: true,
					path: relative(this.projectRoot, path).split(sep).join("/"),
				};
			}
			case "fs.delete": {
				const path = await nativeWorkspacePath(
					this.projectRoot,
					payload.path,
					false,
				);
				await fs.rm(path, { recursive: payload.recursive === true });
				return {
					ok: true,
					path: relative(this.projectRoot, path).split(sep).join("/"),
				};
			}
			case "source.diff": {
				const path = await nativeWorkspacePath(this.projectRoot, payload.path);
				return this.execute("shell.exec", {
					command: "git",
					args: [
						"diff",
						"--no-ext-diff",
						"--no-textconv",
						"--",
						relative(this.projectRoot, path) || ".",
					],
					timeoutMs: 30000,
				});
			}
			default:
				throw new Error("Unsupported native operation.");
		}
	}
	async stop(): Promise<void> {
		this.stopped = true;
		const jobs = [...this.jobs.values()];
		for (const job of jobs) if (job.running) killTree(job);
		let deadline: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.all(jobs.map((job) => job.done)),
			new Promise<void>((resolve) => {
				deadline = setTimeout(resolve, 2500);
			}),
		]);
		if (deadline) clearTimeout(deadline);
		for (const job of jobs) {
			clearTimeout(job.timer);
			if (job.running) {
				killTree(job);
				job.child.stdin.destroy();
				job.child.stdout.destroy();
				job.child.stderr.destroy();
				job.child.unref();
			}
		}
		this.jobs.clear();
	}
}

export function nativeRequestAuthorized(
	request: Pick<IncomingMessage, "headers" | "method" | "url">,
	host: string,
	token: string,
): boolean {
	const auth = request.headers.authorization;
	if (
		request.method !== "POST" ||
		request.url !== "/execute" ||
		request.headers.host !== host ||
		request.headers.origin !== undefined ||
		typeof auth !== "string"
	)
		return false;
	const actual = Buffer.from(auth);
	const expected = Buffer.from(`Bearer ${token}`);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export interface NativeRuntime {
	projectRoot: string;
	execute(operation: string, payload: unknown): Promise<unknown>;
	stop(): Promise<void>;
}
/** The port and bearer credential stay exclusively in Electron's main process. */
export async function startNativeRuntime(
	projectRoot: string,
): Promise<NativeRuntime> {
	await fs.mkdir(projectRoot, { recursive: true, mode: 0o700 });
	projectRoot = await fs.realpath(projectRoot);
	const service = new NativeWorkspaceService(projectRoot);
	const token = randomBytes(32).toString("hex");
	let host = "";
	let activeRequests = 0;
	const server = createServer(async (request, response) => {
		response.setHeader("Content-Type", "application/json");
		response.setHeader("Cache-Control", "no-store");
		if (!nativeRequestAuthorized(request, host, token)) {
			response.writeHead(403).end('{"error":"Unauthorized native request."}');
			return;
		}
		if (activeRequests >= 16) {
			response.writeHead(429).end('{"error":"Native runtime is busy."}');
			return;
		}
		activeRequests++;
		try {
			const chunks: Buffer[] = [];
			let bytes = 0;
			for await (const chunk of request) {
				bytes += chunk.length;
				if (bytes > MAX_NATIVE_BODY)
					throw new Error("Native request is too large.");
				chunks.push(chunk);
			}
			const input = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			const result = await service.execute(
				string(input.operation, "Operation", 64),
				input.payload,
			);
			response.end(JSON.stringify({ ok: true, result }));
		} catch (error) {
			response.writeHead(400).end(
				JSON.stringify({
					ok: false,
					error:
						error instanceof Error ? error.message : "Native operation failed.",
				}),
			);
		} finally {
			activeRequests--;
		}
	});
	server.requestTimeout = 10000;
	server.headersTimeout = 5000;
	server.keepAliveTimeout = 1000;
	server.maxConnections = 32;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Native runtime did not bind loopback.");
	host = `127.0.0.1:${address.port}`;
	let stopping: Promise<void> | null = null;
	return {
		projectRoot,
		async execute(operation, payload) {
			const body = JSON.stringify({ operation, payload });
			if (Buffer.byteLength(body) > MAX_NATIVE_BODY)
				throw new Error("Native request is too large.");
			const response = await fetch(`http://${host}/execute`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body,
				signal: AbortSignal.timeout(MAX_TIMEOUT + 10000),
			});
			const result = (await response.json()) as {
				ok?: boolean;
				result?: unknown;
				error?: string;
			};
			if (!response.ok || !result.ok)
				throw new Error(result.error ?? "Native operation failed.");
			return result.result;
		},
		stop() {
			return (stopping ??= (async () => {
				const closed = new Promise<void>((resolve) =>
					server.close(() => resolve()),
				);
				await service.stop();
				server.closeAllConnections();
				await closed;
			})());
		},
	};
}
