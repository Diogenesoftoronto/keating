import { createError } from "h3";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import {
    resolveCwdWithinRoot,
    resolveExistingPathWithinRoot,
    resolveWritePathWithinRoot,
    runCommand,
} from "./local-exec";

function payloadRecord(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
}

function workspaceRelative(value: unknown): string {
    const path = typeof value === "string" ? value.trim() : "";
    if (path === "/workspace") return "";
    if (path.startsWith("/workspace/")) return path.slice("/workspace/".length);
    return path.replace(/^\/+/, "");
}

function requiredString(payload: Record<string, unknown>, key: string): string {
    const value = typeof payload[key] === "string" ? payload[key].trim() : "";
    if (!value) throw createError({ statusCode: 400, statusMessage: `${key} is required` });
    return value;
}

export async function executeHostAgentOperation(
    root: string,
    operation: string,
    rawPayload: unknown,
): Promise<unknown> {
    const payload = payloadRecord(rawPayload);

    switch (operation) {
        case "runtime.ping":
            return { ok: true, provider: "host", root, timestamp: Date.now() };

        case "shell.exec": {
            const command = requiredString(payload, "command");
            const args = Array.isArray(payload.args) ? payload.args.map(String) : [];
            const cwd = await resolveCwdWithinRoot(root, workspaceRelative(payload.cwd));
            const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
            const env = payload.env && typeof payload.env === "object" && !Array.isArray(payload.env)
                ? Object.fromEntries(Object.entries(payload.env as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
                : undefined;
            return runCommand({ command, args, cwd, timeoutMs, env });
        }

        case "fs.list": {
            const target = await resolveExistingPathWithinRoot(root, workspaceRelative(payload.path));
            const entries = await readdir(target, { withFileTypes: true });
            return Promise.all(entries.map(async (entry) => {
                const path = await resolveExistingPathWithinRoot(root, relative(root, `${target}/${entry.name}`));
                const info = await stat(path);
                return {
                    name: entry.name,
                    path: relative(root, path).split(/[\\/]/g).join("/"),
                    isDir: entry.isDirectory(),
                    size: info.size,
                    modTime: info.mtime.toISOString(),
                };
            }));
        }

        case "fs.read": {
            const target = await resolveExistingPathWithinRoot(root, workspaceRelative(payload.path));
            const encoding = payload.encoding === "base64" ? "base64" : "utf8";
            const content = await readFile(target, encoding);
            return { path: relative(root, target).split(/[\\/]/g).join("/"), content, encoding };
        }

        case "fs.write": {
            const target = await resolveWritePathWithinRoot(root, workspaceRelative(payload.path));
            const encoding = payload.encoding === "base64" ? "base64" : "utf8";
            const content = typeof payload.content === "string" ? payload.content : "";
            const data = encoding === "base64" ? Buffer.from(content, "base64") : content;
            await writeFile(target, data);
            return { ok: true, path: relative(root, target).split(/[\\/]/g).join("/"), bytes: Buffer.byteLength(data), encoding };
        }

        case "fs.edit": {
            const target = await resolveExistingPathWithinRoot(root, workspaceRelative(payload.path));
            const search = requiredString(payload, "search");
            const replace = typeof payload.replace === "string" ? payload.replace : "";
            const content = await readFile(target, "utf8");
            const occurrences = content.split(search).length - 1;
            if (occurrences !== 1) {
                throw createError({
                    statusCode: 409,
                    statusMessage: occurrences === 0
                        ? "search block was not found"
                        : `search block appears ${occurrences} times`,
                });
            }
            await writeFile(target, content.replace(search, replace), "utf8");
            return { ok: true, path: relative(root, target).split(/[\\/]/g).join("/") };
        }

        case "source.diff": {
            const path = workspaceRelative(payload.path);
            const args = ["diff", "--"];
            if (path) args.push(path);
            return runCommand({ command: "git", args, cwd: root });
        }

        default:
            throw createError({ statusCode: 400, statusMessage: `Unsupported host operation: ${operation}` });
    }
}
