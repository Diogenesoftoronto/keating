import { afterEach, expect, test } from "bun:test";
import { publicClientConfig } from "../notorganic-provider/public-client";
import { subscribeDesktopOAuthCallback } from "../keating/oauth";
import { NOTORGANIC_DESKTOP_CALLBACK, NOTORGANIC_DESKTOP_ORIGIN, notOrganicDesktopCallbackPath, prepareNotOrganicDesktopAuthorization } from "../keating/notorganic-desktop";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
});
const env = { VITE_NOTORGANIC_PUBLIC_ISSUER: "https://api.notorganic.info", VITE_NOTORGANIC_AUTHORIZATION_URL: "https://id.notorganic.info/authorize" };
const state = "a".repeat(43);

test("desktop callback is independent of renderer ports and web deployment overrides", () => {
	for (const origin of ["http://127.0.0.1:39127", "http://127.0.0.1:50234", "http://localhost:3000"]) {
		expect(publicClientConfig({ ...env, VITE_NOTORGANIC_CLIENT_ID: "https://keating.help", VITE_NOTORGANIC_REDIRECT_URI: "https://keating.help/notorganic/callback" }, origin, true)).toMatchObject({ clientId: NOTORGANIC_DESKTOP_ORIGIN, redirectUri: NOTORGANIC_DESKTOP_CALLBACK });
		expect(publicClientConfig(env, origin, false)?.clientId).toBe(origin);
	}
});

test("prepares native receiver with the exact PKCE state and fails closed if unavailable", async () => {
	const calls: unknown[] = [];
	Object.defineProperty(globalThis, "window", { configurable: true, value: { keatingDesktop: {
		prepareOAuthCallback: async (...args: unknown[]) => { calls.push(args); return { available: true }; },
	} } });
	await prepareNotOrganicDesktopAuthorization(`https://id.notorganic.info/authorize?state=${state}`);
	expect(calls).toEqual([[state, "notorganic"]]);
	window.keatingDesktop!.prepareOAuthCallback = async () => ({ available: false });
	await expect(prepareNotOrganicDesktopAuthorization(`https://id.notorganic.info/authorize?state=${state}`)).rejects.toThrow("Could not open desktop sign-in");
});

test("routes approved and denied native callbacks only to the local callback page", () => {
	for (const result of ["code=one-time-code", "error=access_denied"]) {
		expect(notOrganicDesktopCallbackPath(`${NOTORGANIC_DESKTOP_CALLBACK}?${result}&state=${state}`)).toBe(`/notorganic/callback?${result}&state=${state}`);
	}
	for (const url of [
		`http://127.0.0.1:53694/notorganic/callback?code=x&state=${state}`,
		`https://evil.test/notorganic/callback?code=x&state=${state}`,
		`${NOTORGANIC_DESKTOP_CALLBACK}?code=x&state=${state}&state=${state}`,
		`${NOTORGANIC_DESKTOP_CALLBACK}?code=x&error=denied&state=${state}`,
		`${NOTORGANIC_DESKTOP_CALLBACK}?code=x&state=${state}#fragment`,
		`${NOTORGANIC_DESKTOP_CALLBACK}?code=x`,
	]) expect(notOrganicDesktopCallbackPath(url)).toBeNull();
});

test("the app callback subscription routes Not Organic without consuming model-provider OAuth", () => {
	let callback: ((url: string) => void) | undefined;
	const navigations: string[] = [];
	const modelResults: unknown[] = [];
	Object.defineProperty(globalThis, "window", { configurable: true, value: {
		location: { assign: (path: string) => navigations.push(path) },
		keatingDesktop: { onOAuthCallback: (listener: (url: string) => void) => { callback = listener; return () => {}; } },
	} });
	const unsubscribe = subscribeDesktopOAuthCallback(result => modelResults.push(result));
	callback!(`${NOTORGANIC_DESKTOP_CALLBACK}?code=proof&state=${state}`);
	expect(navigations).toEqual([`/notorganic/callback?code=proof&state=${state}`]);
	expect(modelResults).toEqual([]);
	unsubscribe();
});
