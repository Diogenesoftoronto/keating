import { createError, defineEventHandler, readBody } from "h3";
import {
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
	requireNotOrganicProductSession,
} from "../../../../../src/notorganic-provider/server";
import { NotOrganicFetchAdapter } from "../../../../../src/notorganic-provider/fetch-adapter";
import { writePdsCodeSnapshot, writePdsSandboxRun } from "../../../../../src/notorganic-provider/pds";
import type { HostedCodeLanguage } from "../../../../../src/notorganic-provider/notebook";

const filename = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:py|ts)$/;
const languages = new Set(["python", "typescript"]);

export default defineEventHandler(async (event) => {
	try {
		const input = await readBody<{
			code?: unknown;
			filename?: unknown;
			language?: unknown;
			execution?: { device_class?: unknown; network_class?: unknown; code_bytes?: unknown };
		}>(event);
		if (typeof input?.code !== "string" || input.code.length === 0 || input.code.length > 256_000) {
			throw createError({ statusCode: 400, statusMessage: "Code must be between 1 and 256000 characters." });
		}
		if (typeof input.language !== "string" || !languages.has(input.language)) {
			throw createError({ statusCode: 400, statusMessage: "language must be python or typescript." });
		}
		const language = input.language as HostedCodeLanguage;
		if (input.filename !== undefined && (typeof input.filename !== "string" || !filename.test(input.filename))) {
			throw createError({ statusCode: 400, statusMessage: "filename must be a simple .py or .ts filename." });
		}
		const extension = language === "python" ? ".py" : ".ts";
		const targetFilename = input.filename ?? `notebook${extension}`;
		if (!targetFilename.endsWith(extension)) throw createError({ statusCode: 400, statusMessage: "filename does not match language." });
		const execution = input.execution;
		if (
			!execution ||
			!(["mobile", "desktop", "unknown"] as const).includes(execution.device_class as never) ||
			!(["slow", "normal", "unknown"] as const).includes(execution.network_class as never) ||
			!Number.isSafeInteger(execution.code_bytes) || execution.code_bytes !== new TextEncoder().encode(input.code).byteLength
		) throw createError({ statusCode: 400, statusMessage: "Invalid execution telemetry." });
		const config = getNotOrganicServerConfig();
		if (!config.enabled) throw new NotOrganicOperationalError("Not Organic hosted access is disabled.");
		const session = await requireNotOrganicProductSession(event, "keating:notebook-run");
		const client = new NotOrganicFetchAdapter({ baseUrl: config.gatewayBaseUrl, session });
		const snapshotId = crypto.randomUUID();
		await writePdsCodeSnapshot({
			session,
			snapshotId,
			code: input.code,
			language,
			filename: targetFilename,
		});
		const response = await client.request("/v1/sandbox/runs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				project_id: "keating-chat",
				code: input.code,
				filename: targetFilename,
				language,
				max_cost_microusd: config.maxCostMicrousd,
				execution: { executor: "cloud", ...execution },
			}),
			maxCostMicrousd: config.maxCostMicrousd,
		});
		if (!response.ok) return response;
		const run = await response.clone().json() as { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; exit_code?: number; error_code?: string };
		await writePdsSandboxRun({ session, snapshotId, run });
		response.headers.set("x-keating-pds-snapshot", snapshotId);
		return response;
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
		}
		throw error;
	}
});
