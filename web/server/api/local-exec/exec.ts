import { defineEventHandler, readBody, createError } from "h3";
import { requireLocalExec, resolveCwdWithinRoot, runCommand } from "../../utils/local-exec";

export default defineEventHandler(async (event) => {
    if (event.method !== "POST") {
        throw createError({ statusCode: 405, statusMessage: "Use POST for local exec." });
    }

    const root = await requireLocalExec(event);

    const body = (await readBody(event).catch(() => null)) as
        | { command?: unknown; args?: unknown; cwd?: unknown; env?: unknown; timeoutMs?: unknown }
        | null;
    if (!body || typeof body !== "object") {
        throw createError({ statusCode: 400, statusMessage: "JSON body required." });
    }

    const command = typeof body.command === "string" ? body.command : "";
    if (!command.trim()) {
        throw createError({ statusCode: 400, statusMessage: "command is required." });
    }
    const args = Array.isArray(body.args) ? body.args.map((a) => String(a)) : [];
    const relCwd = typeof body.cwd === "string" ? body.cwd : "";
    const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;
    const envOverride =
        body.env && typeof body.env === "object" && !Array.isArray(body.env)
            ? Object.fromEntries(Object.entries(body.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
            : undefined;

    const cwd = await resolveCwdWithinRoot(root, relCwd);
    const result = await runCommand({ command, args, cwd, env: envOverride, timeoutMs });
    return result;
});
