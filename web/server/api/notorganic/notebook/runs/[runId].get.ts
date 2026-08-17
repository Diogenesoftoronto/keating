import { createError, defineEventHandler, getQuery, getRouterParam } from "h3";
import {
	getNotOrganicServerConfig,
	NotOrganicOperationalError,
	requireNotOrganicProductSession,
} from "../../../../../src/notorganic-provider/server";
import { NotOrganicFetchAdapter } from "../../../../../src/notorganic-provider/fetch-adapter";
import { writePdsSandboxRun } from "../../../../../src/notorganic-provider/pds";

function runId(event: Parameters<typeof getRouterParam>[0]): string {
	const value = getRouterParam(event, "runId");
	if (typeof value !== "string" || !/^sandbox_[a-zA-Z0-9_-]{1,128}$/.test(value)) {
		throw createError({ statusCode: 400, statusMessage: "Invalid notebook run id." });
	}
	return value;
}

export default defineEventHandler(async (event) => {
	try {
		const config = getNotOrganicServerConfig();
		if (!config.enabled) throw new NotOrganicOperationalError("Not Organic hosted access is disabled.");
		const session = await requireNotOrganicProductSession(event, "keating:notebook-read");
		const client = new NotOrganicFetchAdapter({ baseUrl: config.gatewayBaseUrl, session });
		const response = await client.request(`/v1/sandbox/runs/${encodeURIComponent(runId(event))}`);
		if (!response.ok) return response;
		const snapshotId = getQuery(event).snapshot_id;
		if (typeof snapshotId !== "string" || !/^[0-9a-f-]{36}$/i.test(snapshotId)) {
			throw createError({ statusCode: 400, statusMessage: "A valid PDS snapshot id is required." });
		}
		const run = await response.clone().json() as { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; exit_code?: number; error_code?: string };
		await writePdsSandboxRun({ session, snapshotId, run });
		return response;
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) {
			throw createError({ statusCode: error.statusCode, statusMessage: error.message, data: { code: error.code } });
		}
		throw error;
	}
});
