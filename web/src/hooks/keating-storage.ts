import {
	AppStorage,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@earendil-works/pi-web-ui";
import { KeatingStorage } from "../keating/storage";
import { syncCustomProviderKeys } from "../lib/provider-models";
import { sessionPreview, sessionUsage } from "./session-metadata";
import type { SessionData, SessionMetadata } from "../types/session";

const settingsStore = new SettingsStore();
const providerKeys = new ProviderKeysStore();
export const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const backend = new IndexedDBStorageBackend({
	dbName: "keating",
	version: 1,
	stores: [
		settingsStore.getConfig(),
		providerKeys.getConfig(),
		sessions.getConfig(),
		SessionsStore.getMetadataConfig(),
		customProviders.getConfig(),
	],
});

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
		preview: sessionPreview(data.messages),
		aiGeneratedTitle: aiGeneratedTitle ?? data.aiGeneratedTitle,
	};

	await sessions.save({ ...data, title, lastModified: now }, metadata);
	window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
}
