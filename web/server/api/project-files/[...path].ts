import { defineEventHandler, getRouterParam, createError } from "h3";
import { resolve, sep, relative } from "node:path";
import { stat, readFile, readdir, realpath } from "node:fs/promises";
import ignore from "ignore";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB

// Always-blocked dirs that should never be served even with --no-ignore.
// These are security-critical (secrets, build artifacts that could be huge).
const HARD_BLOCKED_DIRS = new Set([".git", "node_modules"]);

function envProjectRoot(): string | null {
    const value = process.env.KEATING_WEB_PROJECT_ROOT?.trim();
    if (!value) return null;
    return resolve(value);
}

function noIgnoreEnabled(): boolean {
    return process.env.KEATING_WEB_PROJECT_NO_IGNORE === "1" ||
        process.env.KEATING_WEB_PROJECT_NO_IGNORE === "true";
}

// Cache the ignore instance so we don't re-read .gitignore on every request.
// Invalidated when .gitignore/.ignore mtime changes, so edits are picked up live.
let cachedIgnore: ignore.Ignore | null = null;
let cachedRoot: string | null = null;
let cachedMtime = 0;

async function buildIgnoreFilter(root: string): Promise<ignore.Ignore> {
    // Check mtime of .gitignore and .ignore to invalidate cache on edit
    let newestMtime = 0;
    for (const filename of [".gitignore", ".ignore"]) {
        try {
            const info = await stat(resolve(root, filename));
            if (info.mtimeMs > newestMtime) newestMtime = info.mtimeMs;
        } catch {
            // File doesn't exist
        }
    }

    if (cachedIgnore && cachedRoot === root && newestMtime === cachedMtime) {
        return cachedIgnore;
    }

    const ig = ignore();
    for (const filename of [".gitignore", ".ignore"]) {
        try {
            const content = await readFile(resolve(root, filename), "utf8");
            ig.add(content);
        } catch {
            // File doesn't exist — skip
        }
    }
    cachedIgnore = ig;
    cachedRoot = root;
    cachedMtime = newestMtime;
    return ig;
}

function isHardBlocked(relPath: string): boolean {
    for (const segment of relPath.split(sep)) {
        if (HARD_BLOCKED_DIRS.has(segment)) return true;
    }
    return false;
}

function toPosix(p: string): string {
    return p.split(sep).join("/");
}

function pathEscapesRoot(relPath: string): boolean {
    return relPath === ".." || relPath.startsWith(`..${sep}`) || relPath.split(sep).includes("..");
}

export async function resolveProjectPath(
    root: string,
    relPath: string
): Promise<{ lexicalRel: string; resolvedRel: string; realTarget: string }> {
    const target = resolve(root, relPath);
    const lexicalRel = relative(root, target);
    if (pathEscapesRoot(lexicalRel)) {
        throw createError({ statusCode: 400, statusMessage: "Path escapes project root" });
    }

    let realRoot: string;
    let realTarget: string;
    try {
        [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    } catch {
        throw createError({ statusCode: 404, statusMessage: `File not found: ${relPath}` });
    }

    const resolvedRel = relative(realRoot, realTarget);
    if (pathEscapesRoot(resolvedRel)) {
        throw createError({ statusCode: 400, statusMessage: "Path escapes project root" });
    }

    return { lexicalRel, resolvedRel, realTarget };
}

function enforcePathFilters(relPath: string, ig: ignore.Ignore | null): void {
    const relPosix = toPosix(relPath);

    if (isHardBlocked(relPath)) {
        throw createError({
            statusCode: 403,
            statusMessage: `Access to "${relPosix}" is blocked for safety`,
        });
    }

    if (ig && relPosix && ig.ignores(relPosix)) {
        throw createError({
            statusCode: 403,
            statusMessage: `"${relPosix}" is ignored by .gitignore/.ignore. Use --no-ignore to access ignored paths.`,
        });
    }
}

async function listDirectory(
    root: string,
    relDir: string,
    ig: ignore.Ignore | null
): Promise<{ entries: Array<{ path: string; isDir: boolean; size: number }> }> {
    const { lexicalRel, realTarget, resolvedRel } = await resolveProjectPath(root, relDir);
    enforcePathFilters(lexicalRel, ig);
    if (resolvedRel !== lexicalRel) enforcePathFilters(resolvedRel, ig);

    const entries = await readdir(realTarget, { withFileTypes: true });
    const out: Array<{ path: string; isDir: boolean; size: number }> = [];
    for (const entry of entries) {
        const childRel = lexicalRel ? `${lexicalRel}${sep}${entry.name}` : entry.name;
        const childPosix = toPosix(childRel);

        // Hard-blocked dirs are always filtered
        if (isHardBlocked(childRel)) continue;

        // If ignore filtering is active, skip ignored entries
        if (ig && ig.ignores(childPosix)) continue;

        out.push({ path: childPosix, isDir: entry.isDirectory(), size: 0 });
    }
    out.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.path.localeCompare(b.path);
    });
    return { entries: out };
}

export default defineEventHandler(async (event) => {
    const root = envProjectRoot();
    if (!root) {
        throw createError({
            statusCode: 503,
            statusMessage: "No project root configured. Launch `keating web` (defaults to $CWD) or pass `--root=PATH`.",
        });
    }

    try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
            throw createError({ statusCode: 503, statusMessage: `Project root is not a directory: ${root}` });
        }
    } catch (err) {
        if ((err as { statusCode?: number }).statusCode) throw err;
        throw createError({ statusCode: 503, statusMessage: `Project root is not accessible: ${root}` });
    }

    const skipIgnore = noIgnoreEnabled();
    const ig = skipIgnore ? null : await buildIgnoreFilter(root);

    const rawPath = getRouterParam(event, "path") ?? "";
    const cleanPath = rawPath.replace(/^\/+/, "");

    if (!cleanPath || cleanPath.endsWith("/")) {
        const dirPath = cleanPath.replace(/\/+$/, "");
        return await listDirectory(root, dirPath, ig);
    }

    const { lexicalRel, realTarget, resolvedRel } = await resolveProjectPath(root, cleanPath);
    const safePosix = toPosix(lexicalRel);

    // Hard-blocked and ignored paths refuse both the requested path and the
    // resolved symlink target when it differs.
    enforcePathFilters(lexicalRel, ig);
    if (resolvedRel !== lexicalRel) enforcePathFilters(resolvedRel, ig);

    let info;
    try {
        info = await stat(realTarget);
    } catch {
        throw createError({ statusCode: 404, statusMessage: `File not found: ${cleanPath}` });
    }

    if (info.isDirectory()) {
        return await listDirectory(root, lexicalRel, ig);
    }

    if (!info.isFile()) {
        throw createError({ statusCode: 400, statusMessage: `Not a regular file: ${cleanPath}` });
    }

    if (info.size > MAX_FILE_BYTES) {
        throw createError({
            statusCode: 413,
            statusMessage: `File exceeds ${MAX_FILE_BYTES} byte limit (size=${info.size}).`,
        });
    }

    const content = await readFile(realTarget, "utf8");
    return {
        path: safePosix,
        size: info.size,
        mtimeMs: info.mtimeMs,
        content,
    };
});
