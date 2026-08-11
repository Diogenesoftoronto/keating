import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdir } from "node:fs/promises";
import type { DesktopRuntimePaths } from "./runtime-paths.js";
import { nitroEnvironment } from "./runtime-paths.js";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_READY_INTERVAL_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

type SpawnNitro = (
	command: string,
	args: readonly string[],
	options: SpawnOptions,
) => ChildProcess;

interface ReadinessResponse {
	ok: boolean;
}

export interface ReadinessOptions {
	timeoutMs?: number;
	intervalMs?: number;
	fetchImpl?: (input: string, init?: RequestInit) => Promise<ReadinessResponse>;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
}

export interface StopOptions {
	timeoutMs?: number;
	waitForExit?: (child: ChildProcess, timeoutMs: number) => Promise<void>;
}

export interface StartNitroOptions {
	executable?: string;
	spawn?: SpawnNitro;
	findPort?: () => Promise<number>;
	waitForReady?: (origin: string) => Promise<void>;
	parentEnvironment?: NodeJS.ProcessEnv;
}

export interface NitroRuntime {
	origin: string;
	child: ChildProcess;
	stop(): Promise<void>;
}

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reserve an ephemeral loopback port for the child process startup. */
export async function findAvailableLoopbackPort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen({ host: LOOPBACK_HOST, port: 0 }, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Could not resolve an ephemeral loopback port.")));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}

/**
 * Poll a same-origin health route until the child is serving requests. Each
 * probe is aborted at the remaining deadline so a stalled socket cannot make
 * startup exceed the caller's bounded timeout.
 */
export async function waitForNitroReady(
	origin: string,
	options: ReadinessOptions = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? DEFAULT_READY_INTERVAL_MS;
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? pause;
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const deadline = now() + timeoutMs;
	const healthUrl = new URL("/api/courses/session", origin).toString();
	let lastFailure = "no response";

	while (now() <= deadline) {
		const remaining = Math.max(1, deadline - now());
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), remaining);
		try {
			const response = await fetchImpl(healthUrl, { signal: controller.signal });
			if (response.ok) return;
			lastFailure = `HTTP response was not OK`;
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error);
		} finally {
			clearTimeout(timer);
		}

		if (now() >= deadline) break;
		await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
	}

	throw new Error(`Keating local server did not become ready within ${timeoutMs}ms (${lastFailure}).`);
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`Nitro child did not exit within ${timeoutMs}ms.`));
		}, timeoutMs);
		const onExit = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			clearTimeout(timer);
			child.removeListener("exit", onExit);
			child.removeListener("error", onError);
		};
		child.once("exit", onExit);
		child.once("error", onError);
	});
}

/** Stop the child gracefully, then force termination only after its deadline. */
export async function stopNitroChild(
	child: ChildProcess,
	options: StopOptions = {},
): Promise<void> {
	if (child.exitCode !== null) return;
	const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
	const waitForExit = options.waitForExit ?? waitForChildExit;
	child.kill("SIGTERM");
	try {
		await waitForExit(child, timeoutMs);
		return;
	} catch {
		if (child.exitCode !== null) return;
	}

	child.kill("SIGKILL");
	await waitForExit(child, timeoutMs);
}

/**
 * Launch the staged Nitro node-server output in an Electron-as-Node child.
 * The renderer never receives this process environment or its mutable paths.
 */
export async function startPackagedNitro(
	paths: DesktopRuntimePaths,
	options: StartNitroOptions = {},
): Promise<NitroRuntime> {
	await Promise.all([
		access(paths.serverEntry),
		mkdir(paths.stateRoot, { recursive: true }),
		mkdir(paths.coursesStorageDir, { recursive: true }),
		mkdir(paths.coursesPearStorageDir, { recursive: true }),
	]);

	const findPort = options.findPort ?? findAvailableLoopbackPort;
	const port = await findPort();
	const origin = `http://${LOOPBACK_HOST}:${port}`;
	const spawn = options.spawn ?? nodeSpawn;
	const child = spawn(options.executable ?? process.execPath, [paths.serverEntry], {
		cwd: paths.runtimeRoot,
		env: nitroEnvironment(paths, port, options.parentEnvironment),
		// Nitro is fully self-contained at this point. Ignoring its streams avoids a
		// stalled child if an unattended pipe fills before Electron can exit.
		stdio: "ignore",
	});

	const waitForReady = options.waitForReady ?? ((runtimeOrigin: string) => waitForNitroReady(runtimeOrigin));
	try {
		await waitForReady(origin);
	} catch (error) {
		await stopNitroChild(child).catch(() => {});
		throw error;
	}

	return {
		origin,
		child,
		stop: () => stopNitroChild(child),
	};
}
