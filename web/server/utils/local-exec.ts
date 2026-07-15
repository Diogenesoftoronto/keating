import type { H3Event } from "h3";
import { createError, getHeader, getRequestURL } from "h3";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { lstat, realpath, stat } from "node:fs/promises";

/** Max bytes captured per stream before truncation. */
export const MAX_STREAM_BYTES = 512 * 1024; // 512 KiB
/** Default command timeout when the caller does not specify one. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Hard cap on command timeout regardless of caller request. */
export const MAX_TIMEOUT_MS = 120_000;

export function localExecEnabled(): boolean {
    return process.env.KEATING_WEB_LOCAL_EXEC === "1" || process.env.KEATING_WEB_LOCAL_EXEC === "true";
}

export function localExecProjectRoot(): string | null {
    const value = process.env.KEATING_WEB_PROJECT_ROOT?.trim();
    if (!value) return null;
    return resolve(value);
}

/**
 * Local exec is host command execution triggered from a web page. It is only
 * ever allowed for loopback clients so a shared/remote deployment cannot reach
 * the host even if the flag is mistakenly set.
 */
export function assertLoopbackRequest(event: H3Event): void {
    const remote = event.node?.req?.socket?.remoteAddress ?? "";
    const normalized = remote.replace(/^::ffff:/, "");
    const isLoopback =
        normalized === "127.0.0.1" ||
        normalized === "::1" ||
        normalized.startsWith("127.");
    if (!isLoopback) {
        throw createError({
            statusCode: 403,
            statusMessage: "Local exec is only available to loopback (localhost) clients.",
        });
    }
}

function requestOrigin(event: H3Event): string {
    const url = getRequestURL(event);
    return `${url.protocol}//${url.host}`;
}

function assertTrustedBrowserRequest(event: H3Event): void {
    const contentType = getHeader(event, "content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        throw createError({
            statusCode: 415,
            statusMessage: "Local exec requires an application/json request body.",
        });
    }

    const secFetchSite = getHeader(event, "sec-fetch-site")?.toLowerCase();
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
        throw createError({
            statusCode: 403,
            statusMessage: "Local exec rejects cross-site browser requests.",
        });
    }

    const origin = getHeader(event, "origin");
    if (origin && origin !== requestOrigin(event)) {
        throw createError({
            statusCode: 403,
            statusMessage: "Local exec requires a same-origin request.",
        });
    }
}

/** Throws unless local exec is enabled, a root is configured, and the caller is loopback. */
export async function requireLocalExec(event: H3Event): Promise<string> {
    if (!localExecEnabled()) {
        throw createError({
            statusCode: 403,
            statusMessage: "Local exec is disabled. Launch `keating web --allow-local-exec` to enable it.",
        });
    }
    assertLoopbackRequest(event);
    assertTrustedBrowserRequest(event);
    const root = localExecProjectRoot();
    if (!root) {
        throw createError({
            statusCode: 503,
            statusMessage: "No project root configured. Launch `keating web` from a project directory or pass `--root=PATH`.",
        });
    }
    try {
        const info = await stat(root);
        if (!info.isDirectory()) {
            throw createError({ statusCode: 503, statusMessage: `Project root is not a directory: ${root}` });
        }
    } catch (err) {
        if ((err as { statusCode?: number }).statusCode) throw err;
        throw createError({ statusCode: 503, statusMessage: `Project root is not accessible: ${root}` });
    }
    return root;
}

function escapesRoot(relPath: string): boolean {
    return relPath === ".." || relPath.startsWith(`..${sep}`) || relPath.split(sep).includes("..");
}

/**
 * Resolve a relative directory to an absolute path that must exist inside the
 * project root. Follows symlinks and re-checks the real target stays in-root.
 */
export async function resolveCwdWithinRoot(root: string, relDir: string): Promise<string> {
    const rel = (relDir ?? "").replace(/^\/+/, "");
    if (isAbsolute(rel)) {
        throw createError({ statusCode: 400, statusMessage: "cwd must be relative to the project root" });
    }
    const target = resolve(root, rel);
    if (escapesRoot(relative(root, target))) {
        throw createError({ statusCode: 400, statusMessage: "cwd escapes project root" });
    }
    let realRoot: string;
    let realTarget: string;
    try {
        [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    } catch {
        throw createError({ statusCode: 404, statusMessage: `cwd not found: ${rel || "."}` });
    }
    if (escapesRoot(relative(realRoot, realTarget))) {
        throw createError({ statusCode: 400, statusMessage: "cwd escapes project root" });
    }
    return realTarget;
}

/** Resolve an existing file or directory and verify its real target stays in-root. */
export async function resolveExistingPathWithinRoot(root: string, relPath: string): Promise<string> {
    const rel = (relPath ?? "").replace(/^\/+/, "");
    const target = resolve(root, rel);
    if (escapesRoot(relative(root, target))) {
        throw createError({ statusCode: 400, statusMessage: "path escapes project root" });
    }
    try {
        const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
        if (escapesRoot(relative(realRoot, realTarget))) {
            throw createError({ statusCode: 400, statusMessage: "path escapes project root" });
        }
        return realTarget;
    } catch (err) {
        if ((err as { statusCode?: number }).statusCode) throw err;
        throw createError({ statusCode: 404, statusMessage: `path not found: ${rel || "."}` });
    }
}

/**
 * Resolve a relative file path for writing. The file itself need not exist, but
 * its (real) parent directory must exist and stay inside the project root.
 */
export async function resolveWritePathWithinRoot(root: string, relFile: string): Promise<string> {
    const rel = (relFile ?? "").replace(/^\/+/, "");
    if (!rel) throw createError({ statusCode: 400, statusMessage: "path is required" });
    if (isAbsolute(rel)) {
        throw createError({ statusCode: 400, statusMessage: "path must be relative to the project root" });
    }
    const target = resolve(root, rel);
    if (escapesRoot(relative(root, target))) {
        throw createError({ statusCode: 400, statusMessage: "path escapes project root" });
    }
    const parent = dirname(target);
    let realRoot: string;
    let realParent: string;
    try {
        [realRoot, realParent] = await Promise.all([realpath(root), realpath(parent)]);
    } catch {
        throw createError({ statusCode: 404, statusMessage: `Parent directory not found for: ${rel}` });
    }
    const parentRel = relative(realRoot, realParent);
    if (parentRel !== "" && escapesRoot(parentRel)) {
        throw createError({ statusCode: 400, statusMessage: "path escapes project root" });
    }
    try {
        const targetInfo = await lstat(target);
        if (targetInfo.isSymbolicLink()) {
            throw createError({ statusCode: 400, statusMessage: "path must not be a symlink" });
        }
        const realTarget = await realpath(target);
        const targetRel = relative(realRoot, realTarget);
        if (targetRel !== "" && escapesRoot(targetRel)) {
            throw createError({ statusCode: 400, statusMessage: "path escapes project root" });
        }
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            return target;
        }
        if ((err as { statusCode?: number }).statusCode) throw err;
        throw createError({ statusCode: 503, statusMessage: `Write path is not accessible: ${rel}` });
    }
    return target;
}

export interface RunCommandOptions {
    command: string;
    args?: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}

export interface RunCommandResult {
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    durationMs: number;
    timedOut: boolean;
}

/**
 * Run a command WITHOUT a shell (shell: false) so argument values cannot inject
 * shell syntax. To run a shell script, the caller must explicitly invoke
 * `bash -lc "..."`.
 */
export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
    const command = String(options.command ?? "").trim();
    if (!command) {
        throw createError({ statusCode: 400, statusMessage: "command is required" });
    }
    const args = Array.isArray(options.args) ? options.args.map((a) => String(a)) : [];
    const timeoutMs = Math.min(
        Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
        MAX_TIMEOUT_MS,
    );
    const childEnv = { ...process.env, ...(options.env ?? {}) };

    // Bun's Node child_process compatibility currently does not reliably emit
    // stdout/stderr "data" events in these tests. Use Bun.spawn when available;
    // Nitro's node-server runtime still takes the Node branch below.
    const maybeBun = (globalThis as typeof globalThis & {
        Bun?: {
            spawnSync: (args: string[], options: {
                cwd: string;
                env: Record<string, string | undefined>;
                timeout: number;
            }) => {
                stdout: Uint8Array;
                stderr: Uint8Array;
                exitCode: number | null;
                signalCode?: string | null;
            };
        };
    }).Bun;
    if (maybeBun) {
        const started = Date.now();
        const result = maybeBun.spawnSync([command, ...args], {
            cwd: options.cwd,
            env: childEnv,
            timeout: timeoutMs,
        });
        const rawStdout = new TextDecoder().decode(result.stdout);
        const rawStderr = new TextDecoder().decode(result.stderr);
        const timedOut = result.exitCode === null && !!result.signalCode;
        const stdoutTruncated = rawStdout.length > MAX_STREAM_BYTES;
        const stderrTruncated = rawStderr.length > MAX_STREAM_BYTES;
        return {
            command,
            args,
            cwd: options.cwd,
            exitCode: result.exitCode,
            signal: result.signalCode ?? null,
            stdout: rawStdout.slice(0, MAX_STREAM_BYTES),
            stderr: rawStderr.slice(0, MAX_STREAM_BYTES),
            stdoutTruncated,
            stderrTruncated,
            durationMs: Date.now() - started,
            timedOut,
        };
    }

    return await new Promise<RunCommandResult>((resolvePromise) => {
        const started = Date.now();
        let stdout = "";
        let stderr = "";
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let timedOut = false;
        let settled = false;

        let child;
        try {
            child = spawn(command, args, {
                cwd: options.cwd,
                env: childEnv,
                shell: false,
            });
        } catch (err) {
            resolvePromise({
                command,
                args,
                cwd: options.cwd,
                exitCode: null,
                signal: null,
                stdout: "",
                stderr: err instanceof Error ? err.message : String(err),
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: Date.now() - started,
                timedOut: false,
            });
            return;
        }

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
            if (stdout.length >= MAX_STREAM_BYTES) {
                stdoutTruncated = true;
                return;
            }
            stdout += chunk.toString("utf8");
            if (stdout.length > MAX_STREAM_BYTES) {
                stdout = stdout.slice(0, MAX_STREAM_BYTES);
                stdoutTruncated = true;
            }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            if (stderr.length >= MAX_STREAM_BYTES) {
                stderrTruncated = true;
                return;
            }
            stderr += chunk.toString("utf8");
            if (stderr.length > MAX_STREAM_BYTES) {
                stderr = stderr.slice(0, MAX_STREAM_BYTES);
                stderrTruncated = true;
            }
        });

        const finish = (exitCode: number | null, signal: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolvePromise({
                command,
                args,
                cwd: options.cwd,
                exitCode,
                signal,
                stdout,
                stderr,
                stdoutTruncated,
                stderrTruncated,
                durationMs: Date.now() - started,
                timedOut,
            });
        };

        child.on("error", (err) => {
            if (!stderr) stderr = err instanceof Error ? err.message : String(err);
            finish(null, null);
        });
        child.on("close", (code, signal) => finish(code, signal));
    });
}
