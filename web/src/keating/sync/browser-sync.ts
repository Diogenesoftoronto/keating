import {
	buildKeatingPortableDataBundle,
	importKeatingPortableDataBundle,
	type KeatingPortableImportResult,
} from "../portable-data";
import {
	applySourceRevision,
	buildSourceRevision,
	type SourceTreeFile,
} from "./source-revision";
import type { SourceRevision } from "./contracts";
import {
	importAccountSyncRecoveryCode,
	IndexedDbAccountSyncKeyStore,
} from "./device-identity";
import { unlockAccountSyncKeyWithLogin } from "./account-key-broker";
import {
	createBrowserGunLearnerSyncTransport,
	parseGunPeerUrls,
} from "./gun-transport";
import { KeatingSyncCoordinator } from "./sync-coordinator";

export interface BrowserGunSyncSession {
	coordinator: KeatingSyncCoordinator;
}

export async function createBrowserGunSyncSession(options: {
	did: string;
	peers?: string[];
	recoveryCode?: string;
	fetch?: typeof globalThis.fetch;
}): Promise<BrowserGunSyncSession> {
	const peers = options.peers ?? parseGunPeerUrls(import.meta.env.VITE_KEATING_GUN_PEERS);
	const transport = await createBrowserGunLearnerSyncTransport({ peers });
	const keys = new IndexedDbAccountSyncKeyStore();
	if (options.recoveryCode) {
		await keys.save(await importAccountSyncRecoveryCode(options.recoveryCode), { active: true });
	} else if (!await keys.getActive()) {
		await keys.save(await unlockAccountSyncKeyWithLogin({ did: options.did, fetch: options.fetch }), { active: true });
	}
	return {
		coordinator: await KeatingSyncCoordinator.create({ did: options.did, transport, keys }),
	};
}

export async function pushCurrentLearnerData(session: BrowserGunSyncSession): Promise<void> {
	const bundle = await buildKeatingPortableDataBundle({ includeSandbox: false });
	await session.coordinator.publishLearnerBundle(bundle);
}

export async function restoreCurrentLearnerData(session: BrowserGunSyncSession): Promise<KeatingPortableImportResult | null> {
	const bundle = await session.coordinator.restoreLatestLearnerBundle();
	return bundle ? importKeatingPortableDataBundle(bundle) : null;
}

export async function pushSourceChanges(session: BrowserGunSyncSession, input: {
	id: string;
	parentId?: string;
	before: SourceTreeFile[];
	after: SourceTreeFile[];
	createdAt?: string;
}): Promise<SourceRevision> {
	const revision = await buildSourceRevision(input);
	await session.coordinator.publishSourceRevision(revision);
	return revision;
}

/** Returns staged files; the caller still controls when they replace sandbox files. */
export async function stageLatestSourceChanges(
	session: BrowserGunSyncSession,
	currentFiles: SourceTreeFile[],
): Promise<{ revision: SourceRevision; files: SourceTreeFile[] } | null> {
	const revision = await session.coordinator.restoreLatestSourceRevision();
	if (!revision) return null;
	return { revision, files: await applySourceRevision(currentFiles, revision) };
}
