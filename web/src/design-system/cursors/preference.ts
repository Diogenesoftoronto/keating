import { useSyncExternalStore } from "react";

/** Whether this device uses Keating cursors or the system ones. On unless switched off. */
export const cursorPreferenceKey = "keating.cursors.v1";
const changed = "keating:cursors-changed";

export function readCursorPreference(store?: Pick<Storage, "getItem">): boolean {
	try {
		return (store ?? window.localStorage).getItem(cursorPreferenceKey) !== "system";
	} catch {
		/* Private browsing or server render. */
		return true;
	}
}
/** "always" also turns the cursors on where no hovering pointer is reported. */
export function cursorPreferenceForced(store?: Pick<Storage, "getItem">): boolean {
	try {
		return (store ?? window.localStorage).getItem(cursorPreferenceKey) === "always";
	} catch {
		return false;
	}
}
export function saveCursorPreference(on: boolean, store?: Pick<Storage, "setItem">) {
	try {
		(store ?? window.localStorage).setItem(cursorPreferenceKey, on ? "keating" : "system");
	} catch {
		return;
	}
	if (typeof window !== "undefined") window.dispatchEvent(new Event(changed));
}
function subscribe(notify: () => void) {
	const storage = (e: StorageEvent) => {
		if (!e.key || e.key === cursorPreferenceKey) notify();
	};
	window.addEventListener(changed, notify);
	window.addEventListener("storage", storage);
	return () => {
		window.removeEventListener(changed, notify);
		window.removeEventListener("storage", storage);
	};
}
export function useCursorPreference(): boolean {
	return useSyncExternalStore(subscribe, readCursorPreference, () => true);
}

/** True while Keating is writing a reply; the resting pixel turns in steps. */
let busy = false;
const busyListeners = new Set<() => void>();
export function setCursorBusy(next: boolean) {
	if (busy === next) return;
	busy = next;
	busyListeners.forEach(listener => listener());
}
export function cursorBusy(): boolean {
	return busy;
}
export function onCursorBusy(listener: () => void): () => void {
	busyListeners.add(listener);
	return () => busyListeners.delete(listener);
}
