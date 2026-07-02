import { useCallback, useEffect, useState } from "react";
import {
	loadKeatingUiSettings,
	saveKeatingUiSettings,
	subscribeKeatingUiSettings,
	type KeatingUiSettings,
} from "../keating/ui-settings";
import {
	loadModelPrefs,
	saveModelPrefs,
	subscribeModelPrefs,
	type ModelPrefs,
} from "../keating/model-prefs";
import {
	loadPersona,
	savePersona,
	subscribePersona,
} from "../keating/persona";
import {
	loadWebSpeechSettings,
	saveWebSpeechSettings,
	subscribeWebSpeechSettings,
	type WebSpeechSettings,
} from "../keating/speech";

/**
 * Registry of every persisted user-facing setting that should be reachable
 * through the unified `useKeatingSetting(key)` facade. Each entry exposes the
 * same three operations so callers don't need to know which underlying store
 * (localStorage today, IndexedDB/SettingsStore when P2P sync ships) holds
 * the data.
 */
export interface SettingAdapter<T> {
	load: () => T;
	save: (next: T) => void;
	subscribe: (callback: (value: T) => void) => () => void;
}

const uiAdapter: SettingAdapter<KeatingUiSettings> = {
	load: loadKeatingUiSettings,
	save: saveKeatingUiSettings,
	subscribe: subscribeKeatingUiSettings,
};

const modelPrefsAdapter: SettingAdapter<ModelPrefs> = {
	load: loadModelPrefs,
	save: saveModelPrefs,
	subscribe: subscribeModelPrefs,
};

const personaAdapter: SettingAdapter<string> = {
	load: loadPersona,
	save: savePersona,
	subscribe: subscribePersona,
};

const speechAdapter: SettingAdapter<WebSpeechSettings> = {
	load: loadWebSpeechSettings,
	save: saveWebSpeechSettings,
	subscribe: subscribeWebSpeechSettings,
};

const adapters = {
	ui: uiAdapter,
	modelPrefs: modelPrefsAdapter,
	persona: personaAdapter,
	speech: speechAdapter,
} as const;

export type SettingKey = keyof typeof adapters;

type Patch<T> = T extends object ? Partial<T> | ((prev: T) => Partial<T>) : never;

/**
 * Unified React hook for the user-facing settings that currently live in
 * localStorage. Today every adapter persists to localStorage via the
 * `createLocalSetting`/`normalizeUiSettings` helpers; the registry shape is
 * deliberately compatible with the IndexedDB-backed `SettingsStore` so we can
 * flip individual adapters to SettingsStore (and unlock P2P sync) without
 * touching call sites.
 *
 * Returns the current value and a patch function. `patch` accepts either a
 * partial object (shallow-merged into the previous value) or a function that
 * receives the previous value and returns a partial patch.
 */
export function useKeatingSetting<K extends SettingKey>(
	key: K,
): [
	typeof adapters[K] extends SettingAdapter<infer T> ? T : never,
	(next: Patch<NonNullable<typeof adapters[K] extends SettingAdapter<infer T> ? T : never>>) => void,
] {
	type Value = typeof adapters[K] extends SettingAdapter<infer T> ? T : never;
	const adapter = adapters[key] as unknown as SettingAdapter<Value>;

	const [value, setValue] = useState<Value>(() => adapter.load());

	useEffect(() => adapter.subscribe(setValue), [adapter]);

	const patch = useCallback(
		(next: Patch<Value>) => {
			setValue((prev) => {
				const partial =
					typeof next === "function"
						? (next as (prev: Value) => Partial<Value>)(prev)
						: next;
				const merged =
					prev && typeof prev === "object"
						? ({ ...prev, ...partial } as Value)
						: ((partial as unknown) as Value);
				adapter.save(merged);
				return merged;
			});
		},
		[adapter],
	);

	return [value, patch];
}

export const KEATING_SETTING_KEYS = Object.keys(adapters) as SettingKey[];