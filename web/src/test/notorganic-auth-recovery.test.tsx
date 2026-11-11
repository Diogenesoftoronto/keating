import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IDBFactory } from "fake-indexeddb";
import { promptKeatingApiKey } from "../components/KeatingApiKeyPromptDialog";
import { changeChatModel } from "../hooks/agent/chat-model";
import { sessionPanelCallbacks, reattachedPanelCallbacks } from "../hooks/agent/panel-callbacks";
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
const globalKeys = ["window", "location", "localStorage", "sessionStorage", "indexedDB"] as const;
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

function callbackRefs(agent: Parameters<typeof sessionPanelCallbacks>[0]["agent"]) {
  return {
    agentRef: { current: agent }, sessionIdRef: { current: "learner-session" },
    sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
  } as unknown as Parameters<typeof sessionPanelCallbacks>[0]["refs"];
}

beforeEach(() => {
	Object.assign(process.env, settings);
	authorizedUrl = undefined;
	const location = { origin: "https://chat.keating.help", pathname: "/", search: "?session=learner-session", assign: (url: string) => { authorizedUrl = url; } };
	const window = Object.assign(new EventTarget(), { location });
	for (const [key, value] of Object.entries({ window, location, localStorage: storage(), sessionStorage: storage(), indexedDB: new IDBFactory() })) {
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
		it(`carries ${model.id} permission from model selection through account consent, then stops prompting`, async () => {
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
			expect(prompt.consent).toBe(true);
			expect(prompt.reconnect).not.toBe(true);
			const html = renderToStaticMarkup(<NotOrganicAccessPromptDialog />);
			expect(html).toContain("Approve model access");
			expect(html).toContain("Review access</button>");
			expect(html).not.toContain("Sign up");
			expect(html).not.toContain("Sign in");
			await connectNotOrganicPrompt(prompt);
			const scope = new URL(authorizedUrl!).searchParams.get("scope")!;
			expect(scope.split(" ")).toContain("infer:text");
			expect(new URL(authorizedUrl!).searchParams.has("prompt")).toBe(false);
			closeNotOrganicPrompt(false);
			localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "approved-access", expiresAt: Date.now() + 300_000, scope }));
			authorizedUrl = undefined;
			await change();
			expect(getActiveNotOrganicPrompt()).toBeNull();
			expect(authorizedUrl).toBeUndefined();
		});
	}

  for (const migrated of [true, false]) {
    it(`uses provider refresh before model switching, migration enabled: ${migrated}`, async () => {
      localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000,
        refreshToken: "old-refresh", refreshExpiresAt: Date.now() + 300_000, scope: "infer:balanced" }));
      let refreshes = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://provider.test/v1/public/device/token");
        expect(JSON.parse(String(init?.body))).toEqual({ grant_type: "refresh_token", refresh_token: "old-refresh" });
        refreshes++;
        return Response.json({ access_token: "renewed", token_type: "DPoP", expires_in: 300,
          scope: migrated ? "infer:balanced infer:text" : "infer:balanced", refresh_token: "new-refresh", refresh_expires_in: 86400 });
      }) as unknown as typeof fetch;
      const refs = {
        selectedModelRef: { current: NOTORGANIC_SOL_MODEL }, agentRef: { current: null }, panelRef: { current: null },
        sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
        explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
      } as unknown as Parameters<typeof changeChatModel>[0]["refs"];
      await changeChatModel({ refs, model: NOTORGANIC_DEFAULT_MODEL, posthog: { capture: () => undefined },
        selectModel: selected => { refs.selectedModelRef.current = selected; }, createAgent: async () => { throw new Error("No active conversation"); } });
      expect(refreshes).toBe(1);
      expect(authorizedUrl).toBeUndefined();
      expect(refs.selectedModelRef.current).toBe(NOTORGANIC_DEFAULT_MODEL);
      if (migrated) expect(getActiveNotOrganicPrompt()).toBeNull();
      else expect(getActiveNotOrganicPrompt()?.requiredScopes).toEqual(["infer:text"]);
      expect(JSON.parse(localStorage.getItem("keating.notorganic.session")!).scope).toBe(migrated ? "infer:balanced infer:text" : "infer:balanced");
    });
  }

  it("keeps the chosen model without a misleading permission prompt when renewal is temporarily unavailable", async () => {
    localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000,
      refreshToken: "old-refresh", refreshExpiresAt: Date.now() + 300_000, scope: "infer:balanced" }));
    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    const refs = {
      selectedModelRef: { current: NOTORGANIC_SOL_MODEL }, agentRef: { current: null }, panelRef: { current: null },
      sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
      explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
    } as unknown as Parameters<typeof changeChatModel>[0]["refs"];
    await changeChatModel({ refs, model: NOTORGANIC_DEFAULT_MODEL, posthog: { capture: () => undefined },
      selectModel: selected => { refs.selectedModelRef.current = selected; }, createAgent: async () => { throw new Error("No active conversation"); } });
    expect(refs.selectedModelRef.current).toBe(NOTORGANIC_DEFAULT_MODEL);
    expect(getActiveNotOrganicPrompt()).toBeNull();
    expect(authorizedUrl).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("keating.notorganic.session")!).scope).toBe("infer:balanced");
  });

  it("admits the send callback after the provider migrates a legacy session without opening consent", async () => {
    localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000,
      refreshToken: "old-refresh", refreshExpiresAt: Date.now() + 300_000, scope: "infer:balanced" }));
    let refreshes = 0;
    globalThis.fetch = (async () => {
      refreshes++;
      return Response.json({ access_token: "renewed", token_type: "DPoP", expires_in: 300, scope: "infer:balanced infer:text",
        refresh_token: "new-refresh", refresh_expires_in: 86400 });
    }) as unknown as typeof fetch;
    const agent = { context: { model: NOTORGANIC_DEFAULT_MODEL, messages: [] } } as unknown as Parameters<typeof sessionPanelCallbacks>[0]["agent"];
    const callbacks = sessionPanelCallbacks({
      refs: callbackRefs(agent), agent,
      posthog: { capture: () => undefined }, conversationRuntime: () => null,
      applyThinkingLevel: () => {}, openModelSelector: () => {}, openImageModelSelector: () => {},
      forkSession: async () => {}, sessionId: "learner-session", ensureSessionStartContext: async () => {},
      persistSnapshot: async () => { throw new Error("No redirect should be prepared"); }, saveLocalMessages: async () => {},
    });
    expect(await callbacks.onApiKeyRequired!("notorganic")).toBe(true);
    expect(refreshes).toBe(1);
    expect(getActiveNotOrganicPrompt()).toBeNull();
    expect(authorizedUrl).toBeUndefined();
  });

  it("does not open stale consent when the selected model changes during a capability refresh", async () => {
    localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000,
      refreshToken: "old-refresh", refreshExpiresAt: Date.now() + 300_000, scope: "infer:balanced" }));
    let started!: () => void;
    let finish!: (response: Response) => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = (async () => { started(); return await new Promise<Response>(resolve => { finish = resolve; }); }) as unknown as typeof fetch;
    const refs = {
      selectedModelRef: { current: NOTORGANIC_SOL_MODEL }, agentRef: { current: null }, panelRef: { current: null },
      sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
      explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
    } as unknown as Parameters<typeof changeChatModel>[0]["refs"];
    const changing = changeChatModel({ refs, model: NOTORGANIC_DEFAULT_MODEL, posthog: { capture: () => undefined },
      selectModel: selected => { refs.selectedModelRef.current = selected; }, createAgent: async () => { throw new Error("No active conversation"); } });
    await pending;
    refs.selectedModelRef.current = NOTORGANIC_SOL_MODEL;
    finish(Response.json({ access_token: "renewed", token_type: "DPoP", expires_in: 300, scope: "infer:balanced",
      refresh_token: "new-refresh", refresh_expires_in: 86400 }));
    await changing;
    expect(getActiveNotOrganicPrompt()).toBeNull();
  });

  for (const change of ["cancel", "session", "agent", "signout"] as const) {
    it(`does not persist or prompt a stale send after ${change} during refresh`, async () => {
      localStorage.setItem("keating.notorganic.session", JSON.stringify({ id: "account-session", accessToken: "old-access", expiresAt: Date.now() + 300_000,
        refreshToken: "old-refresh", refreshExpiresAt: Date.now() + 300_000, scope: "infer:balanced" }));
      let started!: () => void;
      let finish!: (response: Response) => void;
      const pending = new Promise<void>(resolve => { started = resolve; });
      globalThis.fetch = (async () => { started(); return await new Promise<Response>(resolve => { finish = resolve; }); }) as unknown as typeof fetch;
      const agent = { context: { model: NOTORGANIC_DEFAULT_MODEL, messages: [] } } as unknown as Parameters<typeof sessionPanelCallbacks>[0]["agent"];
      const refs = callbackRefs(agent);
      let persisted = false;
      const callbacks = reattachedPanelCallbacks({
        refs, agent, posthog: { capture: () => undefined }, conversationRuntime: () => null,
        applyThinkingLevel: () => {}, openModelSelector: () => {}, openImageModelSelector: () => {},
        forkSession: async () => {}, persistCurrentSnapshot: async () => {},
        persistTurn: async () => { persisted = true; }, saveLocalMessages: async () => {},
      });
      const controller = new AbortController();
      const result = callbacks.onApiKeyRequired!("notorganic", controller.signal).then(value => ({ value }), error => ({ error }));
      await pending;
      if (change === "cancel") controller.abort();
      if (change === "session") refs.sessionIdRef.current = "new-session";
      if (change === "agent") refs.agentRef.current = null;
      if (change === "signout") localStorage.removeItem("keating.notorganic.session");
      finish(Response.json({ access_token: "renewed", token_type: "DPoP", expires_in: 300, scope: "infer:balanced",
        refresh_token: "new-refresh", refresh_expires_in: 86400 }));
      const outcome = await result;
      if (change === "signout") expect(outcome).toHaveProperty("error");
      else expect(outcome).toEqual({ value: false });
      expect(persisted).toBe(false);
      expect(getActiveNotOrganicPrompt()).toBeNull();
      expect(sessionStorage.getItem("keating:notorganic-pending-chat-turn")).toBeNull();
      expect(authorizedUrl).toBeUndefined();
    });
  }

	it("keeps send-time permission approval separate from rejected-credential recovery", async () => {
		localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000, scope: "infer:balanced web:search web:fetch" }));
		const result = promptKeatingApiKey("notorganic", { force: true, consent: true, requiredScopes: notOrganicModelScopes(NOTORGANIC_DEFAULT_MODEL) });
		const request = getActiveNotOrganicPrompt()!;
		expect(request.consent).toBe(true);
		expect(request.reconnect).not.toBe(true);
		expect(renderToStaticMarkup(<NotOrganicAccessPromptDialog />)).toContain("Review access</button>");
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
		await connectNotOrganicPrompt(request);
		expect(authorizedUrl).toBeUndefined();
	});


	it("gates the actual send callback on consent and preserves the turn when dismissed", async () => {
		localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000, scope: "infer:balanced web:search web:fetch" }));
		let persisted = false;
		const agent = { context: { model: NOTORGANIC_DEFAULT_MODEL, messages: [{ role: "user", content: "Help me learn", timestamp: 123 }] } } as Parameters<typeof sessionPanelCallbacks>[0]["agent"];
		const callbacks = sessionPanelCallbacks({
			refs: callbackRefs(agent), agent,
			posthog: { capture: () => undefined }, conversationRuntime: () => null,
			applyThinkingLevel: () => {}, openModelSelector: () => {}, openImageModelSelector: () => {},
			forkSession: async () => {}, sessionId: "learner-session", ensureSessionStartContext: async () => {},
			persistSnapshot: async () => { persisted = true; }, saveLocalMessages: async () => {},
		});
		const opened = new Promise<void>(resolve => window.addEventListener("keating:notorganic-prompt-changed", () => resolve(), { once: true }));
		const admitted = callbacks.onApiKeyRequired!("notorganic");
		await opened;
		expect(persisted).toBe(true);
		expect(getActiveNotOrganicPrompt()?.consent).toBe(true);
		expect(getActiveNotOrganicPrompt()?.reconnect).not.toBe(true);
		closeNotOrganicPrompt(false);
		expect(await admitted).toBe(false);
		expect(JSON.parse(sessionStorage.getItem("keating:notorganic-pending-chat-turn")!)).toMatchObject({ sessionId: "learner-session", ready: false });
	});

	for (const newer of ["model", "session"]) it(`does not show old consent after a newer ${newer} was selected`, async () => {
		localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "old-access", expiresAt: Date.now() + 300_000, scope: "infer:gpt-6.1-sol web:search web:fetch" }));
		let finishCreation!: () => void;
		const pendingCreation = new Promise<void>(resolve => { finishCreation = resolve; });
		let currentRequest = 1;
		const refs = {
			selectedModelRef: { current: NOTORGANIC_SOL_MODEL },
			agentRef: { current: { context: { isStreaming: false, messages: [] } } }, panelRef: { current: {} },
			sessionSwitchRequestsRef: { current: { current: 1, isCurrent: (request: number) => request === currentRequest } },
			explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
		} as unknown as Parameters<typeof changeChatModel>[0]["refs"];
		const change = changeChatModel({ refs, model: NOTORGANIC_DEFAULT_MODEL, posthog: { capture: () => undefined },
			selectModel: selected => { refs.selectedModelRef.current = selected; },
			createAgent: (async () => { await pendingCreation; }) as Parameters<typeof changeChatModel>[0]["createAgent"] });
		if (newer === "model") refs.selectedModelRef.current = NOTORGANIC_SOL_MODEL;
		else currentRequest++;
		finishCreation();
		await change;
		expect(getActiveNotOrganicPrompt()).toBeNull();
	});



	for (const replacement of [false, true]) {
		it(`does not redirect after a connecting prompt is ${replacement ? "replaced" : "dismissed"}`, async () => {
			const result = promptNotOrganicAccess({ allowSignIn: true, reconnect: true });
			const request = getActiveNotOrganicPrompt()!;
			const connecting = connectNotOrganicPrompt(request);
			let next: Promise<boolean> | undefined;
			if (replacement) next = promptNotOrganicAccess({ force: true, allowSignIn: true });
			else closeNotOrganicPrompt(false);
			await connecting;
			expect(authorizedUrl).toBeUndefined();
			expect(await result).toBe(false);
			if (next) { closeNotOrganicPrompt(false); expect(await next).toBe(false); }
		});
	}

	it("does not reopen account setup for a fully approved, refreshable signed-in session", async () => {
		localStorage.setItem("keating.notorganic.session", JSON.stringify({ accessToken: "expired-access", expiresAt: Date.now() - 1,
			refreshToken: "renewable-session", refreshExpiresAt: Date.now() + 300_000,
			scope: notOrganicModelScopes(NOTORGANIC_DEFAULT_MODEL).join(" ") }));
		const refs = {
			selectedModelRef: { current: NOTORGANIC_SOL_MODEL }, agentRef: { current: null }, panelRef: { current: null },
			sessionSwitchRequestsRef: { current: { current: 1, isCurrent: () => true } },
			explicitModelSelectionRef: { current: false }, sessionIdRef: { current: "learner-session" },
		} as unknown as Parameters<typeof changeChatModel>[0]["refs"];
		for (let repeat = 0; repeat < 2; repeat++) {
			await changeChatModel({ refs, model: NOTORGANIC_DEFAULT_MODEL, posthog: { capture: () => undefined },
				selectModel: selected => { refs.selectedModelRef.current = selected; }, createAgent: async () => { throw new Error("No active conversation"); } });
			expect(getActiveNotOrganicPrompt()).toBeNull();
			expect(authorizedUrl).toBeUndefined();
		}
	});

	it("keeps the signed-out signup flow and account chooser", async () => {
		localStorage.removeItem("keating.notorganic.session");
		const result = promptNotOrganicAccess({ allowSignIn: true });
		// The ordinary session check completes before opening its prompt.
		await Promise.resolve();
		const request = getActiveNotOrganicPrompt()!;
		expect(renderToStaticMarkup(<NotOrganicAccessPromptDialog />)).toContain("Sign up / Sign in</button>");
		await connectNotOrganicPrompt(request);
		expect(new URL(authorizedUrl!).searchParams.get("prompt")).toBe("select_account");
		closeNotOrganicPrompt(false);
		expect(await result).toBe(false);
	});

	it("carries selected model consent through the send-time credential prompt", async () => {
		const result = promptKeatingApiKey("notorganic", { force: true, requiredScopes: notOrganicModelScopes(NOTORGANIC_DEFAULT_MODEL) });
		await connectNotOrganicPrompt(getActiveNotOrganicPrompt()!);
		expect(new URL(authorizedUrl!).searchParams.get("scope")!.split(" ")).toContain("infer:text");
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
