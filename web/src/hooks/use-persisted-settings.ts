import { useCallback, useMemo, useSyncExternalStore } from "react";

export type PersistedSettingsSubscriber = (onStoreChange: () => void) => () => void;

export function createPersistedSettingsExternalStore<T extends object>(
	load: () => T,
	subscribe: PersistedSettingsSubscriber,
) {
	let snapshot: T | undefined;
	let stale = true;

	const getSnapshot = (): T => {
		if (stale || snapshot === undefined) {
			snapshot = load();
			stale = false;
		}
		return snapshot;
	};

	const subscribeToStore: PersistedSettingsSubscriber = (onStoreChange) => {
		// Re-read once after subscribing so a change between render and effect setup
		// cannot leave React with a stale initial snapshot.
		stale = true;
		return subscribe(() => {
			stale = true;
			onStoreChange();
		});
	};

	return { getSnapshot, subscribe: subscribeToStore };
}

/**
 * React adapter for the small localStorage-backed stores used by Keating.
 * The store remains the source of truth; React only subscribes to snapshots.
 */
export function usePersistedSettings<T extends object>(
	load: () => T,
	save: (next: T) => void,
	subscribe: PersistedSettingsSubscriber,
): [T, (patch: Partial<T>) => void] {
	const store = useMemo(
		() => createPersistedSettingsExternalStore(load, subscribe),
		[load, subscribe],
	);
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const patch = useCallback((next: Partial<T>) => {
		save({ ...load(), ...next });
	}, [load, save]);

	return [snapshot, patch];
}
