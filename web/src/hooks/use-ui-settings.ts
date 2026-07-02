import { useCallback, useEffect, useState } from "react";
import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	subscribeKeatingUiSettings,
	type KeatingUiSettings,
} from "../keating/ui-settings";

/**
 * React hook for reading and patching the persisted Keating UI settings.
 * Subscribes to storage changes so multiple components stay in sync without
 * each having to reload after the helper mutations in `ui-settings.ts`.
 */
export function useKeatingUiSettings(): [KeatingUiSettings, (patch: Partial<KeatingUiSettings>) => void] {
	const [settings, setSettings] = useState<KeatingUiSettings>(() => loadKeatingUiSettings());

	useEffect(() => subscribeKeatingUiSettings(setSettings), []);

	const patch = useCallback((next: Partial<KeatingUiSettings>) => {
		setSettings((prev) => {
			const merged: KeatingUiSettings = {
				...prev,
				...loadKeatingUiSettings(),
				...next,
			};
			saveKeatingUiSettings(merged);
			return merged;
		});
	}, []);

	return [settings, patch];
}
