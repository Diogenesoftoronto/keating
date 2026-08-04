import {
	loadModelPrefs,
	saveModelPrefs,
	subscribeModelPrefs,
	type ModelPrefs,
} from "../keating/model-prefs";
import { usePersistedSettings } from "./use-persisted-settings";

export function useModelPrefs(): [ModelPrefs, (patch: Partial<ModelPrefs>) => void] {
	return usePersistedSettings(loadModelPrefs, saveModelPrefs, subscribeModelPrefs);
}
