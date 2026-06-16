import type { Api, Model } from "@earendil-works/pi-ai";

export const DIO_PROVIDER_ID = "dio";
export const DIO_BASE_URL = "https://bifrost.dio.computer/v1";
export const DIO_GATEWAY_BASE_URL = "https://bifrost.dio.computer";
export const DIO_DEFAULT_MODEL_ID = "kimi-k2.6";
export const DIO_MODEL_ALIAS_OVERRIDE = "kimi-k2.6";

export interface DioProviderDefinition {
	id: string;
	label: string;
	baseUrl: string;
	api: "openai-completions";
}

export const dioProviderDefinition: DioProviderDefinition = {
	id: DIO_PROVIDER_ID,
	label: "Dio",
	baseUrl: DIO_BASE_URL,
	api: "openai-completions",
};

export const DIO_DEFAULT_MODEL: Model<"openai-completions"> = {
	id: DIO_MODEL_ALIAS_OVERRIDE,
	name: "Kimi K2.6",
	api: "openai-completions",
	provider: DIO_PROVIDER_ID,
	baseUrl: DIO_BASE_URL,
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 256_000,
	maxTokens: 8192,
};

export interface DioAccessStatus {
	hasKey: boolean;
}

export interface DioCheckoutResult {
	checkoutUrl: string;
	purchaseReference: string;
}

export interface DioClaimResult {
	success: boolean;
	apiKey?: string;
	pending?: boolean;
	requiresOtp?: boolean;
	devCode?: string;
	error?: string;
}

export async function getDioAccessStatus(): Promise<DioAccessStatus> {
	const { getAppStorage } = await import("@earendil-works/pi-web-ui");
	const key = await getAppStorage().providerKeys.get(DIO_PROVIDER_ID);
	return { hasKey: typeof key === "string" && key.length > 0 };
}

export async function startDioCheckout(email: string): Promise<DioCheckoutResult> {
	const response = await fetch("/api/dio/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: normalizeEmail(email) }),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof body.error === "string" ? body.error : `Checkout failed (${response.status})`);
	}
	return body as DioCheckoutResult;
}

export async function claimDioAccess(email: string, purchaseReference?: string): Promise<DioClaimResult> {
	const response = await fetch("/api/dio/claim", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: normalizeEmail(email), purchaseReference }),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof body.error === "string" ? body.error : `Claim failed (${response.status})`);
	}
	return body as DioClaimResult;
}

export async function recoverDioAccess(email: string, otp?: string): Promise<DioClaimResult> {
	const response = await fetch("/api/dio/recover", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: normalizeEmail(email), otp }),
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(typeof body.error === "string" ? body.error : `Recovery failed (${response.status})`);
	}
	return body as DioClaimResult;
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isDioProvider(provider: string): boolean {
	return provider === DIO_PROVIDER_ID;
}

/**
 * Check whether the Dio credit-purchase flow is enabled. In a Vite build this
 * reads VITE_DIO_ENABLED and defaults to true in dev mode. Outside Vite (e.g.
 * unit tests or the Nitro server) it falls back to process.env.VITE_DIO_ENABLED.
 */
export function isDioFeatureEnabled(): boolean {
	let envValue: string | undefined;
	let isDev = false;
	if (typeof import.meta.env !== "undefined") {
		envValue = import.meta.env.VITE_DIO_ENABLED;
		isDev = import.meta.env.DEV === true;
	} else if (typeof process !== "undefined" && process.env) {
		envValue = process.env.VITE_DIO_ENABLED;
		isDev = process.env.NODE_ENV === "development";
	}
	if (envValue === "false") return false;
	if (envValue === "true") return true;
	return isDev;
}
