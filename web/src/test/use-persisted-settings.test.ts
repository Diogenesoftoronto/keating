import { describe, expect, it } from "bun:test";
import {
	createPersistedSettingsExternalStore,
	type PersistedSettingsSubscriber,
} from "../hooks/use-persisted-settings";

describe("persisted settings external store", () => {
	it("keeps the snapshot reference stable until the store changes", () => {
		let state = { enabled: false };
		let loadCount = 0;
		const listeners = new Set<() => void>();
		const subscribe: PersistedSettingsSubscriber = (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		};
		const store = createPersistedSettingsExternalStore(
			() => {
				loadCount += 1;
				return { ...state };
			},
			subscribe,
		);

		const first = store.getSnapshot();
		expect(store.getSnapshot()).toBe(first);
		expect(loadCount).toBe(1);

		const unsubscribe = store.subscribe(() => {});
		const afterSubscription = store.getSnapshot();
		expect(afterSubscription).not.toBe(first);
		expect(store.getSnapshot()).toBe(afterSubscription);
		expect(loadCount).toBe(2);

		state = { enabled: true };
		for (const listener of listeners) listener();
		const changed = store.getSnapshot();
		expect(changed.enabled).toBe(true);
		expect(changed).not.toBe(afterSubscription);
		expect(store.getSnapshot()).toBe(changed);
		expect(loadCount).toBe(3);

		unsubscribe();
	});

	it("forwards store notifications and stops after unsubscribe", () => {
		let notifyStore: (() => void) | undefined;
		let notifications = 0;
		const store = createPersistedSettingsExternalStore(
			() => ({ value: "current" }),
			(listener) => {
				notifyStore = listener;
				return () => {
					notifyStore = undefined;
				};
			},
		);

		const unsubscribe = store.subscribe(() => {
			notifications += 1;
		});
		notifyStore?.();
		expect(notifications).toBe(1);

		unsubscribe();
		notifyStore?.();
		expect(notifications).toBe(1);
	});
});
