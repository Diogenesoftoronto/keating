import {
	AppStorage,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { KeatingStorage } from "../keating/storage";
import { syncCustomProviderKeys } from "../lib/provider-models";

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
