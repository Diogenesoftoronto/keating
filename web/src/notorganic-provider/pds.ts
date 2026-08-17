import type { HostedCodeLanguage, HostedNotebookRun } from "./notebook";
import type { NotOrganicProductSession } from "./fetch-adapter";

const CODE_COLLECTION = "app.notorganic.codeSnapshot";
const RUN_COLLECTION = "app.notorganic.sandboxRun";

function requirePds(session: NotOrganicProductSession): NonNullable<NotOrganicProductSession["pds"]> {
	if (!session.pds?.accessToken || !session.pds.url.startsWith("https://")) {
		throw new Error("A server-held PDS write session is required for hosted code execution.");
	}
	return session.pds;
}

async function putRecord(
	session: NotOrganicProductSession,
	collection: string,
	rkey: string,
	value: Record<string, unknown>,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const pds = requirePds(session);
	const response = await fetcher(`${pds.url.replace(/\/$/, "")}/xrpc/com.atproto.repo.putRecord`, {
		method: "POST",
		headers: { authorization: `Bearer ${pds.accessToken}`, "content-type": "application/json" },
		body: JSON.stringify({ repo: session.accountId, collection, rkey, validate: false, record: value }),
	});
	if (!response.ok) throw new Error(`PDS code sync failed (${response.status}).`);
}

export async function writePdsCodeSnapshot(input: {
	session: NotOrganicProductSession;
	snapshotId: string;
	code: string;
	language: HostedCodeLanguage;
	filename: string;
	fetcher?: typeof fetch;
}): Promise<void> {
	const timestamp = new Date().toISOString();
	await putRecord(input.session, CODE_COLLECTION, input.snapshotId, {
		$type: CODE_COLLECTION,
		createdAt: timestamp,
		updatedAt: timestamp,
		language: input.language,
		filename: input.filename,
		code: input.code,
	}, input.fetcher);
}

export async function writePdsSandboxRun(input: {
	session: NotOrganicProductSession;
	snapshotId: string;
	run: HostedNotebookRun;
	fetcher?: typeof fetch;
}): Promise<void> {
	await putRecord(input.session, RUN_COLLECTION, input.run.id, {
		$type: RUN_COLLECTION,
		updatedAt: new Date().toISOString(),
		snapshotId: input.snapshotId,
		status: input.run.status,
		exitCode: input.run.exit_code,
		errorCode: input.run.error_code,
	}, input.fetcher);
}
