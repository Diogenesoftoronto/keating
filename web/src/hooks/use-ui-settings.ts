import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	subscribeKeatingUiSettings,
	type KeatingUiSettings,
} from "../keating/ui-settings";
import { usePersistedSettings } from "./use-persisted-settings";

/**
 * React hook for reading and patching the persisted Keating UI settings.
 * Subscribes to storage changes so multiple components stay in sync without
 * each having to reload after the helper mutations in `ui-settings.ts`.
 */
export function useKeatingUiSettings(): [KeatingUiSettings, (patch: Partial<KeatingUiSettings>) => void] {
	return usePersistedSettings(loadKeatingUiSettings, saveKeatingUiSettings, subscribeKeatingUiSettings);
}
