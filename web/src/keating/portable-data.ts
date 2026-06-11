import type { SessionData, SessionMetadata } from "../types/session";
import { sessionPreview, sessionUsage } from "../hooks/session-metadata";
import type { KeatingStorageImportResult, KeatingStoragePortableData } from "./storage";
import type { KeatingSandboxPortableBundle } from "./sandbox-export";

export interface KeatingPortableSession {
	data: SessionData;
	metadata: SessionMetadata;
}

export interface KeatingPortableDataBundle {
	schemaVersion: 1;
	kind: "keating-portable-data";
	generatedAt: string;
	sessions: KeatingPortableSession[];
	storage: KeatingStoragePortableData;
	sandbox?: KeatingSandboxPortableBundle;
}

export interface KeatingPortableDataSources {
	sessions: KeatingPortableSession[];
	storage: KeatingStoragePortableData;
	sandbox?: KeatingSandboxPortableBundle;
	generatedAt?: string;
}

export interface KeatingPortableImportResult extends KeatingStorageImportResult {
	sessions: number;
	sandboxFilesImported: number;
	sandboxSnapshotsImported: number;
	sandboxCommitsImported: number;
}

function metadataForSession(data: SessionData, existing?: Partial<SessionMetadata>): SessionMetadata {
	return {
		id: data.id,
		title: data.title,
		parentSessionId: data.parentSessionId,
		forkedAt: data.forkedAt,
		createdAt: data.createdAt,
		lastModified: data.lastModified,
		messageCount: data.messages.length,
		usage: existing?.usage ?? sessionUsage(data.messages),
		thinkingLevel: data.thinkingLevel,
		preview: existing?.preview ?? sessionPreview(data.messages),
		aiGeneratedTitle: existing?.aiGeneratedTitle ?? data.aiGeneratedTitle,
	};
}

export function parseKeatingPortableDataBundle(value: unknown): KeatingPortableDataBundle {
	const bundle = value && typeof value === "object" ? value as KeatingPortableDataBundle : null;
	if (!bundle || bundle.schemaVersion !== 1 || bundle.kind !== "keating-portable-data") {
		throw new Error("Unsupported Keating portable data bundle.");
	}
	return bundle;
}

export function buildKeatingPortableDataBundleFromSources(sources: KeatingPortableDataSources): KeatingPortableDataBundle {
	return {
		schemaVersion: 1,
		kind: "keating-portable-data",
		generatedAt: sources.generatedAt ?? new Date().toISOString(),
		sessions: sources.sessions.map((session) => ({
			data: session.data,
			metadata: metadataForSession(session.data, session.metadata),
		})),
		storage: sources.storage,
		sandbox: sources.sandbox,
	};
}

export async function buildKeatingPortableDataBundle(options: { includeSandbox?: boolean } = {}): Promise<KeatingPortableDataBundle> {
	const { sessions, keatingStorage, getInitPromise } = await import("../hooks/keating-storage");
	await getInitPromise();
	const metadata = await sessions.getAllMetadata();
	const loaded = await Promise.all(metadata.map(async (entry) => {
		const data = await sessions.loadSession(entry.id) as SessionData | null;
		return data ? { data, metadata: metadataForSession(data, entry) } : null;
	}));
	const sandbox = options.includeSandbox === false
		? undefined
		: await import("./sandbox-export").then((module) => module.buildSandboxPortableBundle()).catch(() => undefined);
	return buildKeatingPortableDataBundleFromSources({
		sessions: loaded.filter((entry): entry is KeatingPortableSession => Boolean(entry)),
		storage: await keatingStorage.exportPortableData(),
		sandbox,
	});
}

export async function importKeatingPortableDataBundle(bundle: KeatingPortableDataBundle): Promise<KeatingPortableImportResult> {
	const parsed = parseKeatingPortableDataBundle(bundle);
	const { sessions, keatingStorage, getInitPromise } = await import("../hooks/keating-storage");
	await getInitPromise();
	let sessionCount = 0;
	for (const session of parsed.sessions ?? []) {
		await sessions.save(session.data, metadataForSession(session.data, session.metadata));
		sessionCount += 1;
	}
	const storageResult = await keatingStorage.importPortableData(parsed.storage);
	let sandboxFilesImported = 0;
	let sandboxSnapshotsImported = 0;
	let sandboxCommitsImported = 0;
	if (parsed.sandbox) {
		const sandboxResult = await import("./sandbox-export").then((module) => module.importSandboxPortableBundle(parsed.sandbox!));
		sandboxFilesImported = sandboxResult.filesImported;
		sandboxSnapshotsImported = sandboxResult.snapshotsImported;
		sandboxCommitsImported = sandboxResult.commitsImported;
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
	}
	return {
		...storageResult,
		sessions: sessionCount,
		sandboxFilesImported,
		sandboxSnapshotsImported,
		sandboxCommitsImported,
	};
}
