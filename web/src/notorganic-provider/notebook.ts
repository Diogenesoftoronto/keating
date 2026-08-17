export interface HostedNotebookRun {
	id: string;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	exit_code?: number;
	stdout?: string;
	stderr?: string;
	error_code?: string;
	/** Internal same-origin PDS source-record pointer; never a gateway credential. */
	pds_snapshot_id?: string;
}

export type HostedCodeLanguage = "python" | "typescript";
export interface HostedExecutionTelemetry {
	executor: "cloud";
	device_class: "mobile" | "desktop" | "unknown";
	network_class: "slow" | "normal" | "unknown";
	code_bytes: number;
}

interface NotebookRequest {
	code: string;
	filename?: string;
	language: HostedCodeLanguage;
	execution: HostedExecutionTelemetry;
}

async function request<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
	const response = await fetcher(path, init);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(body || `Hosted notebook request failed (${response.status}).`);
	}
	return await response.json() as T;
}

/** Same-origin only: Nitro replaces this request with a server-held capability. */
export async function createHostedCodeRun(input: NotebookRequest, fetcher?: typeof fetch): Promise<HostedNotebookRun> {
	const activeFetcher = fetcher ?? fetch;
	const response = await activeFetcher("/api/notorganic/notebook/runs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw new Error((await response.text()) || `Hosted notebook request failed (${response.status}).`);
	return {
		...await response.json() as HostedNotebookRun,
		pds_snapshot_id: response.headers.get("x-keating-pds-snapshot") ?? undefined,
	};
}

export async function getHostedNotebookRun(runId: string, snapshotId: string | undefined, fetcher?: typeof fetch): Promise<HostedNotebookRun> {
	if (!snapshotId) throw new Error("Hosted run is missing its PDS source record.");
	return {
		...await request<HostedNotebookRun>(`/api/notorganic/notebook/runs/${encodeURIComponent(runId)}?snapshot_id=${encodeURIComponent(snapshotId)}`, undefined, fetcher),
		pds_snapshot_id: snapshotId,
	};
}
