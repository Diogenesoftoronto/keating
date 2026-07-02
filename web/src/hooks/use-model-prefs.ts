import { useCallback, useEffect, useState } from "react";
import {
	loadModelPrefs,
	saveModelPrefs,
	subscribeModelPrefs,
	type ModelPrefs,
} from "../keating/model-prefs";

export function useModelPrefs(): [ModelPrefs, (patch: Partial<ModelPrefs>) => void] {
	const [prefs, setPrefs] = useState<ModelPrefs>(() => loadModelPrefs());

	useEffect(() => subscribeModelPrefs(setPrefs), []);

	const patch = useCallback((next: Partial<ModelPrefs>) => {
		setPrefs((prev) => {
			const merged: ModelPrefs = {
				...prev,
				...loadModelPrefs(),
				...next,
			};
			saveModelPrefs(merged);
			return merged;
		});
	}, []);

	return [prefs, patch];
}
