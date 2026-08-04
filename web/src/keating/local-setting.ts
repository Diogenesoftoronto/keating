export function subscribeLocalSetting<T>(
	config: { event: string; load: () => T },
	callback: (value: T) => void,
): () => void {
	if (typeof window === "undefined") return () => {};
	const onCustom = (event: Event) => {
		callback((event as CustomEvent<T>).detail ?? config.load());
	};
	const onStorage = () => callback(config.load());
	window.addEventListener(config.event, onCustom);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(config.event, onCustom);
		window.removeEventListener("storage", onStorage);
	};
}

export function createLocalSetting<T>(config: {
	key: string;
	event: string;
	normalize: (raw: unknown) => T;
}): {
	load: () => T;
	save: (next: T) => void;
	subscribe: (cb: (value: T) => void) => () => void;
} {
	const load = () => {
		if (typeof localStorage === "undefined") return config.normalize(undefined);
		try {
			const raw = localStorage.getItem(config.key);
			return config.normalize(raw);
		} catch {
			return config.normalize(undefined);
		}
	};

	const save = (next: T) => {
		const normalized = config.normalize(next);
		try {
			if (typeof normalized === "string") {
				localStorage.setItem(config.key, normalized);
			} else {
				localStorage.setItem(config.key, JSON.stringify(normalized));
			}
		} catch {
			// Preserve existing callers' behavior: swallow storage write failures.
		}
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent<T>(config.event, { detail: normalized }));
		}
	};

	const subscribe = (cb: (value: T) => void) => {
		return subscribeLocalSetting({ event: config.event, load }, cb);
	};

	return { load, save, subscribe };
}
