import { createError, defineEventHandler, readBody } from "h3";
import { writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { requireLocalExec, resolveWritePathWithinRoot } from "../../utils/local-exec";

export default defineEventHandler(async (event) => {
    if (event.method !== "POST") {
        throw createError({ statusCode: 405, statusMessage: "Use POST for local file writes." });
    }

    const root = await requireLocalExec(event);

    const body = (await readBody(event).catch(() => null)) as
        | { path?: unknown; content?: unknown; encoding?: unknown }
        | null;
    if (!body || typeof body !== "object") {
        throw createError({ statusCode: 400, statusMessage: "JSON body required." });
    }
    const relPath = typeof body.path === "string" ? body.path : "";
    const encoding = body.encoding === "base64" ? "base64" : "utf8";
    const content = typeof body.content === "string" ? body.content : "";
    const target = await resolveWritePathWithinRoot(root, relPath);
    const data = encoding === "base64" ? Buffer.from(content, "base64") : content;

    await writeFile(target, data);

    return {
        ok: true,
        path: relative(root, target).split(/[\\/]/g).join("/"),
        bytes: Buffer.byteLength(data),
        encoding,
    };
});
