const RECOVERY_PREFIX = "keating:stale-build-recovery";

function appVersion(): string {
	return String(import.meta.env.APP_VERSION ?? "dev");
}

function recoveryKey(): string {
	return `${RECOVERY_PREFIX}:${appVersion()}:${window.location.pathname}`;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return `${error.name} ${error.message}`.trim();
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

export function isStaleBuildError(error: unknown): boolean {
	const message = errorMessage(error).toLowerCase();
	return (
		message.includes("failed to fetch dynamically imported module") ||
		message.includes("importing a module script failed") ||
		message.includes("error loading dynamically imported module") ||
		message.includes("mime type") ||
		message.includes("text/html") ||
		message.includes("chunkloaderror") ||
		message.includes("loading chunk")
	);
}

async function clearBrowserBuildState(): Promise<void> {
	const registrations =
		"serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
	await Promise.allSettled(registrations.map((registration) => registration.unregister()));

	if ("caches" in window) {
		const cacheNames = await caches.keys();
		await Promise.allSettled(cacheNames.map((name) => caches.delete(name)));
	}
}

function reloadWithCacheBuster(): void {
	const url = new URL(window.location.href);
	url.searchParams.set("keating-refresh", Date.now().toString(36));
	window.location.replace(url.toString());
}

export async function recoverFromStaleBuild(error: unknown): Promise<boolean> {
	if (typeof window === "undefined" || typeof navigator === "undefined") return false;
	if (!isStaleBuildError(error)) return false;

	const key = recoveryKey();
	if (sessionStorage.getItem(key)) return false;
	sessionStorage.setItem(key, Date.now().toString());

	await clearBrowserBuildState();
	reloadWithCacheBuster();
	return true;
}

export async function loadRouteChunk<T>(loader: () => Promise<T>): Promise<T> {
	try {
		return await loader();
	} catch (error) {
		if (await recoverFromStaleBuild(error)) {
			return new Promise<T>(() => {
				// The page is being replaced with a cache-busted URL.
			});
		}
		throw error;
	}
}

export function installStaleBuildRecovery(): void {
	if (typeof window === "undefined") return;

	window.addEventListener("vite:preloadError", (event) => {
		event.preventDefault();
		const payload = (event as Event & { payload?: unknown }).payload;
		void recoverFromStaleBuild(payload ?? new Error("Vite preload failed"));
	});

	window.addEventListener("unhandledrejection", (event) => {
		if (!isStaleBuildError(event.reason)) return;
		event.preventDefault();
		void recoverFromStaleBuild(event.reason);
	});
}
