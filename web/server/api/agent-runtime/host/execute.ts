import { createError, defineEventHandler, readBody } from "h3";
import { executeHostAgentOperation } from "../../../utils/host-agent-runtime";
import { requireLocalExec } from "../../../utils/local-exec";

export default defineEventHandler(async (event) => {
    if (event.method !== "POST") {
        throw createError({ statusCode: 405, statusMessage: "Use POST for host agent execution." });
    }

    const root = await requireLocalExec(event);
    const body = (await readBody(event).catch(() => null)) as
        | { operation?: unknown; payload?: unknown }
        | null;
    const operation = typeof body?.operation === "string" ? body.operation.trim() : "";
    if (!operation) {
        throw createError({ statusCode: 400, statusMessage: "operation is required" });
    }

    return executeHostAgentOperation(root, operation, body?.payload);
});
