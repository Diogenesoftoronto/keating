import {
	AppStorage,
	CustomProvidersStore,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@earendil-works/pi-web-ui";
import { KeatingStorage } from "../keating/storage";
import { IndexedDBStorageBackend } from "../lib/cloud-storage-backend";
import {
	P2PStorageBackend,
	hasP2PBackend,
} from "../lib/p2p-storage-backend";
import { syncCustomProviderKeys } from "../lib/provider-models";
import { sessionModelMetadata, sessionPreview, sessionSearchText, sessionUsage } from "./session-metadata";
import type { SessionData, SessionMetadata } from "../types/session";

const settingsStore = new SettingsStore();
const providerKeys = new ProviderKeysStore();
export const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const backend = hasP2PBackend() && window.keatingP2P
	? new P2PStorageBackend(window.keatingP2P)
	: new IndexedDBStorageBackend({
	dbName: "keating",
	version: 2,
	stores: [
		settingsStore.getConfig(),
		providerKeys.getConfig(),
		sessions.getConfig(),
		SessionsStore.getMetadataConfig(),
		customProviders.getConfig(),
	],
});

export const storageBackendKind = backend.kind;

settingsStore.setBackend(backend);
providerKeys.setBackend(backend);
sessions.setBackend(backend);
customProviders.setBackend(backend);

const storage = new AppStorage(settingsStore, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

export const keatingStorage = new KeatingStorage();

let initPromise: Promise<void> | null = null;

export function getInitPromise() {
	if (!initPromise) {
		initPromise = Promise.all([
			syncCustomProviderKeys(),
			keatingStorage.init(),
		]).then(() => {});
	}
	return initPromise;
}

/** Update a session title while preserving metadata fields (including aiGeneratedTitle). */
export async function updateSessionTitle(
	id: string,
	title: string,
	aiGeneratedTitle?: boolean,
): Promise<void> {
	const data = await sessions.loadSession(id) as SessionData | null;
	if (!data) throw new Error("Session not found");

	const now = new Date().toISOString();
	const metadata: SessionMetadata = {
		id: data.id,
		title,
		parentSessionId: data.parentSessionId,
		forkedAt: data.forkedAt,
		createdAt: data.createdAt,
		lastModified: now,
		messageCount: data.messages.length,
		usage: sessionUsage(data.messages),
		thinkingLevel: data.thinkingLevel,
		...sessionModelMetadata(data.model),
		preview: sessionPreview(data.messages),
		searchText: sessionSearchText(data.messages),
		aiGeneratedTitle: aiGeneratedTitle ?? data.aiGeneratedTitle,
		generatedAlternative: data.generatedAlternative,
		hiddenAlternative: data.hiddenAlternative,
		alternativeForMessageTimestamp: data.alternativeForMessageTimestamp,
		responsePreference: data.responsePreference,
	};

	const nextData: SessionData = {
		...data,
		title,
		lastModified: now,
		aiGeneratedTitle: metadata.aiGeneratedTitle,
	};
	await sessions.save(nextData, metadata);
	window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
}
