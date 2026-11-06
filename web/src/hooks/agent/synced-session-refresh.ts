export interface SyncedSessionTarget {
	id: string;
	token: unknown;
	navigation: number;
	ready: boolean;
}

/** Wait for local saves, and fence every asynchronous restore against navigation. */
export function createSyncedSessionRefresher<T>(options: {
	current(): SyncedSessionTarget | null;
	read(id: string): Promise<T | null>;
	apply(session: T, isCurrent: () => boolean): Promise<boolean>;
	deleted(isCurrent: () => boolean): void;
	onError(error: unknown): void;
}) {
	const pending = new Map<string, number>();
	let revision = 0;
	let running = false;
	let disposed = false;
	const flush = async () => {
		if (disposed || running) return;
		const observed = options.current();
		const target = observed ? { ...observed } : null;
		if (!target?.ready || !pending.has(target.id)) return;
		const expected = pending.get(target.id)!;
		const isCurrent = () => {
			const current = options.current();
			return !disposed && pending.get(target.id) === expected && current?.ready === true
				&& current.id === target.id && current.token === target.token && current.navigation === target.navigation;
		};
		running = true;
		try {
			const session = await options.read(target.id);
			if (!isCurrent()) return;
			if (!session) {
				options.deleted(isCurrent);
				if (pending.get(target.id) === expected) pending.delete(target.id);
			} else if (await options.apply(session, isCurrent) && pending.get(target.id) === expected) {
				pending.delete(target.id);
			}
		} catch (error) {
			if (!disposed) options.onError(error);
		} finally {
			running = false;
			// A newer import during preparation must not be swallowed by this run.
			if (!disposed && pending.has(target.id) && pending.get(target.id) !== expected) void flush();
		}
	};
	return {
		imported(ids: readonly string[]) {
			for (const id of ids) pending.set(id, ++revision);
			return flush();
		},
		flush,
		dispose() { disposed = true; pending.clear(); },
	};
}
