/**
 * A `useSyncExternalStore` subscription for a preference kept in localStorage:
 * fires on `changedEvent` (a change made in this tab) and on a storage event for
 * `key` from another tab, or one that cleared all storage.
 */
export function subscribeStoredPreference(key: string, changedEvent: string) {
	return (notify: () => void) => {
		const storage = (event: StorageEvent) => {
			if (!event.key || event.key === key) notify();
		};
		window.addEventListener(changedEvent, notify);
		window.addEventListener("storage", storage);
		return () => {
			window.removeEventListener(changedEvent, notify);
			window.removeEventListener("storage", storage);
		};
	};
}
