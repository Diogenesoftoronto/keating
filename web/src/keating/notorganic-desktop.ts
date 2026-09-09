/** Dedicated loopback receiver, independent of the packaged renderer's port. */
export const NOTORGANIC_DESKTOP_ORIGIN = "http://127.0.0.1:53693";
export const NOTORGANIC_DESKTOP_CALLBACK = `${NOTORGANIC_DESKTOP_ORIGIN}/notorganic/callback`;

export function isNotOrganicDesktop(): boolean {
	return typeof window !== "undefined" && !!window.keatingDesktop;
}

/** Only the native receiver's exact route may enter the account callback page. */
export function notOrganicDesktopCallbackPath(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.origin !== NOTORGANIC_DESKTOP_ORIGIN || url.pathname !== "/notorganic/callback"
			|| url.username || url.password || url.hash || value.length > 4096) return null;
		const states = url.searchParams.getAll("state");
		const codes = url.searchParams.getAll("code");
		const errors = url.searchParams.getAll("error");
		if (states.length !== 1 || !/^[A-Za-z0-9_-]{32,512}$/.test(states[0]!)) return null;
		if (!((codes.length === 1 && !!codes[0] && errors.length === 0)
			|| (errors.length === 1 && !!errors[0] && codes.length === 0))) return null;
		return `${url.pathname}${url.search}`;
	} catch { return null; }
}

export async function prepareNotOrganicDesktopAuthorization(authorizationUrl: string): Promise<void> {
	const bridge = window.keatingDesktop;
	if (!bridge?.prepareOAuthCallback) throw new Error("Update Keating desktop to connect your Not Organic account.");
	const state = new URL(authorizationUrl).searchParams.get("state");
	if (!state) throw new Error("Could not prepare account sign-in. Try again.");
	const receiver = await bridge.prepareOAuthCallback(state, "notorganic");
	if (!receiver.available) throw new Error("Could not open desktop sign-in. Close other Keating sign-in attempts and try again.");
}
