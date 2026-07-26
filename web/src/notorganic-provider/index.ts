import type { Model } from "@earendil-works/pi-ai";

export const NOTORGANIC_PROVIDER_ID = "notorganic";
export const NOTORGANIC_MODEL_ALIAS = "balanced";
export const NOTORGANIC_FEATURE = "keating:web-chat";
export const NOTORGANIC_PROXY_BASE_PATH = "/api/notorganic/openai/v1";

export function notOrganicOpenAiBaseUrl(origin = currentOrigin()): string {
	return `${origin.replace(/\/+$/, "")}${NOTORGANIC_PROXY_BASE_PATH}`;
}

export const NOTORGANIC_DEFAULT_MODEL: Model<"openai-completions"> = {
	id: NOTORGANIC_MODEL_ALIAS,
	name: "Not Organic Balanced",
	api: "openai-completions",
	provider: NOTORGANIC_PROVIDER_ID,
	baseUrl: notOrganicOpenAiBaseUrl(),
	reasoning: true,
  input: ["text"],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
	contextWindow: 256_000,
	maxTokens: 16_384,
};

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
	const response = await fetcher(`/api/notorganic/provider/${path}`, init);
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

export function getNotOrganicAccount(fetcher?: typeof fetch): Promise<NotOrganicAccount> {
	return providerJson("account", undefined, fetcher);
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

export function createNotOrganicCheckout(
	productId: string,
	returnUrl: string,
	fetcher?: typeof fetch,
): Promise<NotOrganicCheckout> {
	return providerJson(
		"checkout",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ product_id: productId, return_url: returnUrl }),
		},
		fetcher,
	);
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
