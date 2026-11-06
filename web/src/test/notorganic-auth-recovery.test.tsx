import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { promptKeatingApiKey } from "../components/KeatingApiKeyPromptDialog";
import { changeChatModel } from "../hooks/agent/chat-model";
import { NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_SOL_MODEL, notOrganicModelScopes } from "../notorganic-provider";
import {
	closeNotOrganicPrompt,
	connectNotOrganicPrompt,
	getActiveNotOrganicPrompt,
	NotOrganicAccessPromptDialog,
	promptNotOrganicAccess,
} from "../components/NotOrganicAccessPromptDialog";

const settings = {
	VITE_NOTORGANIC_ENABLED: "true",
	VITE_NOTORGANIC_PUBLIC_ISSUER: "https://provider.test",
	VITE_NOTORGANIC_AUTHORIZATION_URL: "https://portal.test/authorize",
	VITE_NOTORGANIC_CLIENT_ID: "https://keating.help",
	VITE_NOTORGANIC_REDIRECT_URI: "https://keating.help/notorganic/callback",
	VITE_NOTORGANIC_SCOPE: "wallet:read infer:balanced infer:gpt-6.1-sol web:search web:fetch",
};
const originalSettings = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
const globalKeys = ["window", "location", "localStorage", "sessionStorage"] as const;
const originals = Object.fromEntries(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalFetch = globalThis.fetch;
let authorizedUrl: string | undefined;

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, value); },
		removeItem: (key: string) => { values.delete(key); },
	};
}

beforeEach(() => {
	Object.assign(process.env, settings);
	authorizedUrl = undefined;
	const location = { origin: "https://chat.keating.help", pathname: "/", search: "?session=learner-session", assign: (url: string) => { authorizedUrl = url; } };
	const window = Object.assign(new EventTarget(), { location });
	for (const [key, value] of Object.entries({ window, location, localStorage: storage(), sessionStorage: storage() })) {
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	// This credential still looks locally current, but the provider has rejected it.
	localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "revoked-access", expiresAt: Date.now() + 300_000 }));
});

afterEach(() => {
	if (getActiveNotOrganicPrompt()) closeNotOrganicPrompt(false);
	globalThis.fetch = originalFetch;
	for (const [key, value] of Object.entries(originalSettings)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const key of globalKeys) {
		if (originals[key]) Object.defineProperty(globalThis, key, originals[key]!);
		else Reflect.deleteProperty(globalThis, key);
	}
});

describe("Not Organic auth recovery", () => {
	for (const model of [NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_SOL_MODEL]) {
		it(`carries ${model.id} permission from model selection through sign-in, then stops prompting`, async () => {
			localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000, scope: "infer:balanced web:search web:fetch" }));
			const refs = {
				selectedModelRef: { current: NOTORGANIC_DEFAULT_MODEL }, agentRef: { current: null }, panelRef: { current: null },
				sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
				explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
			} as unknown as Parameters<typeof changeChatModel>[0]["refs"];
			const change = () => changeChatModel({ refs, model, posthog: { capture: () => undefined },
				selectModel: selected => { refs.selectedModelRef.current = selected; }, createAgent: async () => { throw new Error("No active conversation"); } });
			await change();
			const prompt = getActiveNotOrganicPrompt()!;
			expect(prompt.requiredScopes).toEqual(notOrganicModelScopes(model));
			await connectNotOrganicPrompt(prompt);
			const scope = new URL(authorizedUrl!).searchParams.get("scope")!;
			expect(scope.split(" ")).toContain(`infer:${model.id}`);
			closeNotOrganicPrompt(false);
			localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "approved-access", expiresAt: Date.now() + 300_000, scope }));
			authorizedUrl = undefined;
			await change();
			expect(getActiveNotOrganicPrompt()).toBeNull();
			expect(authorizedUrl).toBeUndefined();
		});
	}

	it("carries selected model consent through the send-time credential prompt", async () => {
		const result = promptKeatingApiKey("notorganic", { force: true, requiredScopes: notOrganicModelScopes(NOTORGANIC_DEFAULT_MODEL) });
		await connectNotOrganicPrompt(getActiveNotOrganicPrompt()!);
		expect(new URL(authorizedUrl!).searchParams.get("scope")!.split(" ")).toContain("infer:inkling-2-small");
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
	});

	it("starts fresh same-origin authorization instead of accepting a rejected stored session", async () => {
		const result = promptKeatingApiKey("notorganic", { force: true });
		const request = getActiveNotOrganicPrompt();
		expect(request?.reconnect).toBe(true);
		const html = renderToStaticMarkup(<NotOrganicAccessPromptDialog />);
		expect(html).toContain("Sign in to Not Organic");
		expect(html).toContain("Sign in / Sign up</button>");
		expect(html).not.toContain("Continue</button>");
		expect(html).not.toContain("Inkling Small");
		await connectNotOrganicPrompt(request!);
		const authorization = new URL(authorizedUrl!);
		expect(authorization.origin).toBe("https://portal.test");
		expect(authorization.searchParams.get("client_id")).toBe("https://chat.keating.help");
		expect(authorization.searchParams.get("redirect_uri")).toBe("https://chat.keating.help/notorganic/callback");
		expect(authorization.searchParams.get("return_to")).toBe("/?session=learner-session");
		expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
		expect(getActiveNotOrganicPrompt()?.id).toBe(request!.id);
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
	});

	it("keeps ordinary connected account prompts working without reauthorizing", async () => {
		expect(await promptKeatingApiKey("notorganic")).toBe(true);
		expect(getActiveNotOrganicPrompt()).toBeNull();
		expect(authorizedUrl).toBeUndefined();
	});

	it("still continues an existing session when force only requests the ordinary account dialog", async () => {
		const result = promptNotOrganicAccess({ force: true, allowSignIn: true });
		await connectNotOrganicPrompt(getActiveNotOrganicPrompt()!);
		expect(await result).toBe(true);
		expect(authorizedUrl).toBeUndefined();
	});
});
