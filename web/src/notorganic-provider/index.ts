import { DEFAULT_MODELS, NOTORGANIC_CHAT_MODEL_IDS, MODEL_CHOICES, GPT_6_LUNA_PROFILE, GPT_6_ASTRA_PROFILE, MERCURY_2_PROFILE, MERCURY_3_PROFILE, FLINT_PREVIEW_PROFILE, INKLING_2_SMALL_PROFILE, INKLING_PROFILE, notOrganicInferenceScope, hasNotOrganicInferenceScope } from "@keating/runtime-config";
import { checkoutSelection, subscriptionAvailable, subscriptionCheckoutEnabled } from "./plans";
import type { Api, Model } from "@earendil-works/pi-ai";
import { availableCreditPacks, normalizeCreditWallet } from "./credit-wallet";
import { isNotOrganicDesktop, prepareNotOrganicDesktopAuthorization } from "../keating/notorganic-desktop";
import {
	NotOrganicPublicClient,
	NotOrganicPublicClientError,
	publicClientConfig,
	type NotOrganicProviderSession,
} from "./public-client";

export const NOTORGANIC_PROVIDER_ID = "notorganic";
export const NOTORGANIC_MODEL_ALIAS = DEFAULT_MODELS.web.notorganic;
export const NOTORGANIC_IMAGE_MODEL_ALIAS = DEFAULT_MODELS.image.notorganic;
export const NOTORGANIC_FEATURE = "keating:web-chat";
export const NOTORGANIC_PROXY_BASE_PATH = "/api/notorganic/openai/v1";

export function notOrganicOpenAiBaseUrl(origin = currentOrigin()): string {
	const publicConfig = publicClientConfig();
	return publicConfig
		? `${publicConfig.issuer}/v1`
		: `${origin.replace(/\/+$/, "")}${NOTORGANIC_PROXY_BASE_PATH}`;
}

export function notOrganicOpenAiImageEndpoint(origin = currentOrigin()): string {
	return `${notOrganicOpenAiBaseUrl(origin)}/images/generations`;
}

export const NOTORGANIC_INKLING_2_SMALL_MODEL: Model<"openai-completions"> = {
	...INKLING_2_SMALL_PROFILE,
	// The public capability keeps its stable alias; Portkey owns the upstream route.
	api: "openai-completions",
	provider: NOTORGANIC_PROVIDER_ID,
	baseUrl: notOrganicOpenAiBaseUrl(),
	reasoning: true,
  // The account gateway accepts system/user/assistant/tool, not developer.
  compat: { supportsDeveloperRole: false },
  input: ["text", "image"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
};

export const NOTORGANIC_SOL_MODEL: Model<"openai-responses"> = {
	id: NOTORGANIC_CHAT_MODEL_IDS[1],
	name: MODEL_CHOICES.notorganicChat[1].label,
	api: "openai-responses",
	provider: NOTORGANIC_PROVIDER_ID,
	baseUrl: notOrganicOpenAiBaseUrl(),
	reasoning: true,
	// Sol requires reasoning; Pi otherwise emits unsupported none/minimal efforts.
	thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
	input: ["text", "image"],
	// The gateway owns credit pricing and settlement, as with Balanced.
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_050_000,
	maxTokens: 128_000,
};

export const NOTORGANIC_LUNA_MODEL: Model<"openai-responses"> = {
	...NOTORGANIC_SOL_MODEL,
	id: GPT_6_LUNA_PROFILE.id,
	name: GPT_6_LUNA_PROFILE.name,
	contextWindow: GPT_6_LUNA_PROFILE.contextWindow,
	maxTokens: GPT_6_LUNA_PROFILE.maxTokens,
	thinkingLevelMap: { off: "none", minimal: "low", xhigh: "xhigh", max: "max" },
	compat: { supportsLongCacheRetention: false },
};
export const NOTORGANIC_DEFAULT_MODEL = NOTORGANIC_LUNA_MODEL;

/** Provisional native profile; activation and actual pricing belong to the gateway. */
export const NOTORGANIC_FLINT_MODEL: Model<"openai-completions"> = {
  ...FLINT_PREVIEW_PROFILE,
  api: "openai-completions", provider: NOTORGANIC_PROVIDER_ID,
  baseUrl: notOrganicOpenAiBaseUrl(), reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false, supportsReasoningEffort: false,
    supportsUsageInStreaming: true, supportsStore: false, maxTokensField: "max_completion_tokens" },
};

/** Retain the previous explicit choice and persisted balanced sessions. */
export const NOTORGANIC_BALANCED_MODEL: Model<"openai-completions"> = {
  ...NOTORGANIC_INKLING_2_SMALL_MODEL, id: "balanced", name: "Inkling Small", input: ["text"], contextWindow: 256_000,
};
export const NOTORGANIC_MERCURY_2_MODEL: Model<"openai-completions"> = {
  ...MERCURY_2_PROFILE,
  api: "openai-completions", provider: NOTORGANIC_PROVIDER_ID,
  baseUrl: notOrganicOpenAiBaseUrl(), cost: NOTORGANIC_INKLING_2_SMALL_MODEL.cost,
};

export const NOTORGANIC_MERCURY_3_MODEL: Model<"openai-completions"> = {
  ...NOTORGANIC_MERCURY_2_MODEL,
  id: MERCURY_3_PROFILE.id, name: MERCURY_3_PROFILE.name,
  contextWindow: MERCURY_3_PROFILE.contextWindow, maxTokens: MERCURY_3_PROFILE.maxTokens,
};
/** Astra accepts the same low-to-max reasoning efforts as Sol. */
export const NOTORGANIC_ASTRA_MODEL: Model<"openai-responses"> = { ...NOTORGANIC_SOL_MODEL, ...GPT_6_ASTRA_PROFILE };
export const NOTORGANIC_INKLING_MODEL: Model<"openai-completions"> = { ...NOTORGANIC_INKLING_2_SMALL_MODEL, ...INKLING_PROFILE };

/** How to call each hosted chat alias, in picker order. Which of them are offered is the gateway's answer. */
export const NOTORGANIC_CHAT_MODELS: Array<Model<Api>> = [
  NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_SOL_MODEL, NOTORGANIC_ASTRA_MODEL, NOTORGANIC_INKLING_2_SMALL_MODEL, NOTORGANIC_INKLING_MODEL,
  NOTORGANIC_FLINT_MODEL, NOTORGANIC_BALANCED_MODEL, NOTORGANIC_MERCURY_2_MODEL, NOTORGANIC_MERCURY_3_MODEL,
];
/** Without a gateway answer (signed out, or never listed), offer only the default, which leads to sign-in or consent. */
export const NOTORGANIC_UNLISTED_CHAT_MODELS: Array<Model<Api>> = [NOTORGANIC_DEFAULT_MODEL];

type ModelListSession = Pick<NotOrganicProviderSession, "scope" | "id">;
export type NotOrganicModelListClient = { getSession(): ModelListSession | null; request(path: string): Promise<Response> };
type ModelListStorage = Pick<Storage, "getItem" | "setItem">;
type StoredListing = { key: string; ids: string[]; at: number };

const MODEL_LIST_STORAGE_KEY = "keating.notorganic.chat-models.v1";
const MODEL_LIST_FRESH_MS = 60_000;

function browserModelListStorage(): ModelListStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The gateway's own model IDs, or null when it gave no usable answer. */
async function advertisedModelIds(client: NotOrganicModelListClient): Promise<string[] | null> {
  try {
    const response = await client.request("/v1/models");
    if (!response.ok) return null;
    const body = await response.json();
    if (!Array.isArray(body?.data)) return null;
    return body.data.flatMap((model: { id?: unknown } | null) => typeof model?.id === "string" ? [model.id] : []);
  } catch {
    return null;
  }
}

function knownChatModels(ids: readonly string[]): Array<Model<Api>> {
  const advertised = new Set(ids);
  // The list also carries image, speech and embedding aliases; only aliases with a chat profile are selectable.
  return NOTORGANIC_CHAT_MODELS.filter(model => advertised.has(model.id));
}

/**
 * The gateway's /v1/models answer per account session. It already applies deployment
 * enablement and the token's consent, so the client adds no model list of its own.
 * A fresh answer is reused briefly; an older one only while the gateway cannot answer.
 */
export function createNotOrganicModelListing(options: { storage?: ModelListStorage | null; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? browserModelListStorage() : options.storage;
  let latest: StoredListing | null = null;
  const pending = new Map<string, Promise<Array<Model<Api>>>>();
  const keyOf = (session: ModelListSession) => `${session.id ?? ""}\n${session.scope}`;
  const read = (key: string): StoredListing | null => {
    if (latest?.key === key) return latest;
    try {
      const stored = JSON.parse(storage?.getItem(MODEL_LIST_STORAGE_KEY) ?? "null") as Partial<StoredListing> | null;
      if (stored?.key === key && Array.isArray(stored.ids) && stored.ids.every(id => typeof id === "string") && typeof stored.at === "number") {
        latest = { key, ids: stored.ids, at: stored.at };
        return latest;
      }
    } catch { /* An unreadable listing is the same as none. */ }
    return null;
  };
  const write = (listing: StoredListing) => {
    latest = listing;
    try { storage?.setItem(MODEL_LIST_STORAGE_KEY, JSON.stringify(listing)); } catch { /* Memory still holds it. */ }
  };
  return {
    /** What to show before the gateway answers. */
    snapshot(client: NotOrganicModelListClient | null): Array<Model<Api>> {
      const session = client?.getSession();
      const listing = session ? read(keyOf(session)) : null;
      return listing ? knownChatModels(listing.ids) : NOTORGANIC_UNLISTED_CHAT_MODELS;
    },
    list(client: NotOrganicModelListClient | null): Promise<Array<Model<Api>>> {
      const session = client?.getSession();
      if (!client || !session) return Promise.resolve(NOTORGANIC_UNLISTED_CHAT_MODELS);
      const key = keyOf(session);
      const cached = read(key);
      if (cached && now() - cached.at < MODEL_LIST_FRESH_MS) return Promise.resolve(knownChatModels(cached.ids));
      let request = pending.get(key);
      if (!request) {
        request = advertisedModelIds(client).then(ids => {
          if (ids) write({ key, ids, at: now() });
          const listing = ids ?? read(key)?.ids;
          return listing ? knownChatModels(listing) : NOTORGANIC_UNLISTED_CHAT_MODELS;
        }).finally(() => pending.delete(key));
        pending.set(key, request);
      }
      return request;
    },
  };
}

const notOrganicModelListing = createNotOrganicModelListing();

/** Hosted chat models exactly as the account gateway lists them for this session. */
export function getAvailableNotOrganicChatModels(
  client: NotOrganicModelListClient | null = notOrganicPublicClient(),
  listing: ReturnType<typeof createNotOrganicModelListing> = notOrganicModelListing,
): Promise<Array<Model<Api>>> {
  return listing.list(client);
}

/** The last gateway answer for this session, without a request. */
export function notOrganicChatModelsSnapshot(
  client: NotOrganicModelListClient | null = notOrganicPublicClient(),
  listing: ReturnType<typeof createNotOrganicModelListing> = notOrganicModelListing,
): Array<Model<Api>> {
  return listing.snapshot(client);
}

export function notOrganicModelScopes(model: Pick<Model<Api>, "id" | "provider">): string[] {
	return model.provider === NOTORGANIC_PROVIDER_ID ? [notOrganicInferenceScope(model.id)] : [];
}

/** Stable text access covers ordinary choices; exact legacy and privacy-specific grants remain valid. */
export function notOrganicModelNeedsConsent(
	model: Pick<Model<Api>, "id" | "provider">,
	session: Pick<NotOrganicProviderSession, "scope"> | null | undefined = notOrganicPublicClient()?.getSession(),
): boolean {
	if (model.provider !== NOTORGANIC_PROVIDER_ID || !session) return false;
	const granted = new Set(session.scope.split(/\s+/));
	return !hasNotOrganicInferenceScope(granted, model.id);
}


/** Ask only the provider to renew its grant before showing a legacy upgrade prompt.
 * The client neither adds scopes nor requests a wider refresh scope. A reviewed,
 * enabled first-party provider migration may issue infer:text; otherwise the
 * existing exact grant is preserved and one explicit authorization is needed.
 */
export async function notOrganicModelNeedsConsentAfterRefresh(
  model: Pick<Model<Api>, "id" | "provider">,
): Promise<boolean> {
  const client = notOrganicPublicClient();
  if (!notOrganicModelNeedsConsent(model, client?.getSession())) return false;
  const before = client?.getSession();
  if (before?.refreshToken) {
    const refreshed = await client!.activeSession({ refresh: true });
    if (!refreshed || refreshed.id !== before.id) {
      throw new NotOrganicPublicClientError("Your Not Organic session changed. Sign in again or retry to continue.");
    }
  }
  return notOrganicModelNeedsConsent(model, client?.getSession());
}

export interface NotOrganicAccount {
	id: string;
	did?: string;
	[key: string]: unknown;
}

export interface NotOrganicWallet {
	balance_microusd?: number;
	[key: string]: unknown;
}

export interface NotOrganicUsage {
	object: string;
	data: unknown[];
	[key: string]: unknown;
}

export interface NotOrganicCheckout {
	url?: string;
	checkout_url?: string;
	[key: string]: unknown;
}

async function providerJson<T>(
	path: string,
	init?: RequestInit,
	fetcher: typeof fetch = fetch,
): Promise<T> {
	const publicConfig = fetcher === fetch ? publicClientConfig() : null;
	const response = publicConfig
		? await new NotOrganicPublicClient(publicConfig, fetcher).request(
			path === "checkout" ? "/v1/billing/checkout" : `/v1/${path}`,
			init,
		)
		: await fetcher(`/api/notorganic/provider/${path}`, init);
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message =
			typeof body?.error?.message === "string"
				? body.error.message
				: typeof body?.message === "string"
					? body.message
					: `Not Organic request failed (${response.status})`;
		throw new Error(message);
	}
	return body as T;
}

export function notOrganicPublicClient(): NotOrganicPublicClient | null {
	const config = publicClientConfig();
	return config ? new NotOrganicPublicClient(config) : null;
}

export async function beginNotOrganicAuthorization(
	returnTo = `${window.location.pathname}${window.location.search}`,
	requiredScopes: readonly string[] = [],
	isCurrent: () => boolean = () => true,
): Promise<void> {
	const client = notOrganicPublicClient();
	if (!client) throw new Error("This Keating deployment has not enabled Not Organic sign-in.");
	const url = await client.authorizationUrl(returnTo, requiredScopes);
	if (!isCurrent()) return;
	if (isNotOrganicDesktop()) await prepareNotOrganicDesktopAuthorization(url);
	if (!isCurrent()) return;
	// Electron externalizes this navigation while preserving this renderer's
	// session storage and DPoP key. The native receiver returns the callback.
	window.location.assign(url);
}

export async function getNotOrganicAccount(fetcher?: typeof fetch): Promise<NotOrganicAccount> {
	const response = await providerJson<unknown>("account", undefined, fetcher);
	if (!response || typeof response !== "object") throw new Error("Your Not Organic account could not be verified.");
	const envelope = response as Record<string, unknown>;
	const value = "account" in envelope ? envelope.account : response;
	if (!value || typeof value !== "object") throw new Error("Your Not Organic account could not be verified.");
	const account = value as Record<string, unknown>;
	const did = typeof account.did === "string" && account.did.trim() ? account.did : undefined;
	const id = typeof account.id === "string" && account.id.trim() ? account.id
		: typeof account._id === "string" && account._id.trim() ? account._id : did;
	if (!id) throw new Error("Your Not Organic account could not be verified.");
	return { ...account, id, ...(did ? { did } : {}) };
}

export function getNotOrganicWallet(fetcher?: typeof fetch): Promise<NotOrganicWallet> {
	return providerJson("wallet", undefined, fetcher);
}

export function getNotOrganicUsage(
	options: { after?: string; limit?: number } = {},
	fetcher?: typeof fetch,
): Promise<NotOrganicUsage> {
	const query = new URLSearchParams();
	if (options.after) query.set("after", options.after);
	if (options.limit !== undefined) query.set("limit", String(options.limit));
	return providerJson(`usage${query.size ? `?${query}` : ""}`, undefined, fetcher);
}

export async function createNotOrganicCheckout(
	packId: string,
	returnUrl: string,
	fetcher?: typeof fetch,
): Promise<NotOrganicCheckout> {
	if (!fetcher && import.meta.env?.VITE_NOTORGANIC_CHECKOUT_ENABLED !== "true") {
		throw new Error("Hosted credit purchases are not available yet.");
	}
	const returnDestination = new URL(returnUrl);
	if (returnDestination.protocol !== "https:" || returnDestination.username || returnDestination.password) throw new Error("Checkout requires a secure return address.");
	const wallet = normalizeCreditWallet(await getNotOrganicWallet(fetcher));
	if (!availableCreditPacks(wallet, true).some(pack => pack.id === packId)) {
		throw new Error("This credit pack is not available for checkout yet.");
	}
	return providerJson(
		"checkout",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pack_id: packId, return_url: returnUrl }),
		},
		fetcher,
	);
}

export async function createNotOrganicSubscriptionCheckout(
  planId: string,
  returnUrl: string,
  fetcher?: typeof fetch,
  env: Record<string, string | undefined> = import.meta.env,
): Promise<NotOrganicCheckout> {
  const selection = checkoutSelection({ plan_id: planId }, subscriptionCheckoutEnabled(env));
  const destination = new URL(returnUrl);
  if (destination.protocol !== "https:" || destination.username || destination.password) throw new Error("Checkout requires a secure return address.");
  const wallet = normalizeCreditWallet(await getNotOrganicWallet(fetcher));
  if (!subscriptionAvailable(wallet, true)) throw new Error("This subscription is not available for checkout yet.");
  return providerJson("checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...selection, return_url: destination.toString() }),
  }, fetcher);
}

export function isNotOrganicProvider(provider: string): boolean {
	return provider === NOTORGANIC_PROVIDER_ID;
}

export function isNotOrganicFeatureEnabled(): boolean {
	let configured: string | undefined;
	if (typeof import.meta.env !== "undefined") {
		configured = import.meta.env.VITE_NOTORGANIC_ENABLED;
	} else if (typeof process !== "undefined") {
		configured = process.env.VITE_NOTORGANIC_ENABLED;
	}
	if (configured === "true") return true;
	if (configured === "false") return false;
	return false;
}

function currentOrigin(): string {
	return typeof globalThis.location?.origin === "string" && globalThis.location.origin
		? globalThis.location.origin
		: "http://localhost";
}
