import type { H3Event } from "h3";
import {
	NotOrganicFetchAdapter,
	type NotOrganicProductSession,
} from "./fetch-adapter";

export const NOTORGANIC_SESSION_ADAPTER_CONTEXT_KEY = "notOrganicSessionAdapter";
export const NOTORGANIC_AUTH_OPERATIONAL_BLOCKER =
	"Not Organic hosted access requires a deployment-owned ATProto/Better Auth product-session adapter. Keating does not yet have durable server auth, so browser DID or email claims are intentionally rejected.";

export class NotOrganicOperationalError extends Error {
	readonly statusCode = 503;
	readonly code = "notorganic_auth_adapter_unavailable";

	constructor(message = NOTORGANIC_AUTH_OPERATIONAL_BLOCKER) {
		super(message);
	}
}

export interface NotOrganicSessionRequest {
	feature: string;
}

export interface NotOrganicSessionAdapter {
	/**
	 * Resolve a product capability from a server-validated session. Implementors
	 * own assertion signing/exchange, refresh, revocation, and DPoP key custody.
	 */
	getProductSession(
		event: H3Event,
		request: NotOrganicSessionRequest,
	): Promise<NotOrganicProductSession | null>;
}

type NotOrganicEventContext = H3Event["context"] & {
	[NOTORGANIC_SESSION_ADAPTER_CONTEXT_KEY]?: NotOrganicSessionAdapter;
};

export function getNotOrganicSessionAdapter(event: H3Event): NotOrganicSessionAdapter {
	const adapter = (event.context as NotOrganicEventContext)[NOTORGANIC_SESSION_ADAPTER_CONTEXT_KEY];
	if (!adapter) throw new NotOrganicOperationalError();
	return adapter;
}

export async function requireNotOrganicProductSession(
	event: H3Event,
	feature: string,
): Promise<NotOrganicProductSession> {
	const session = await getNotOrganicSessionAdapter(event).getProductSession(event, { feature });
	if (!session) {
		throw new NotOrganicOperationalError(
			"Sign in through the deployment-owned Keating product session before using Not Organic hosted access.",
		);
	}
	return session;
}

export interface NotOrganicServerConfig {
	enabled: boolean;
	gatewayBaseUrl: string;
	maxCostMicrousd: number;
}

function positiveIntegerEnv(name: string, env: NodeJS.ProcessEnv): number {
	const value = Number(env[name]);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new NotOrganicOperationalError(`${name} must be configured as a positive integer.`);
	}
	return value;
}

export function isNotOrganicHostedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.NOTORGANIC_ENABLED?.trim().toLowerCase();
	return value === "1" || value === "true";
}

export function getNotOrganicServerConfig(env: NodeJS.ProcessEnv = process.env): NotOrganicServerConfig {
	if (!isNotOrganicHostedEnabled(env)) {
		return {
			enabled: false,
			gatewayBaseUrl: "",
			maxCostMicrousd: 0,
		};
	}
	const gatewayBaseUrl = env.NOTORGANIC_ISSUER?.trim().replace(/\/+$/, "");
	if (!gatewayBaseUrl || !gatewayBaseUrl.startsWith("https://")) {
		throw new NotOrganicOperationalError(
			"NOTORGANIC_ISSUER must be configured as an HTTPS server-only URL.",
		);
	}
	let gatewayUrl: URL;
	try {
		gatewayUrl = new URL(gatewayBaseUrl);
	} catch {
		throw new NotOrganicOperationalError(
			"NOTORGANIC_ISSUER must be a valid HTTPS gateway origin.",
		);
	}
	if (gatewayUrl.pathname !== "/" || gatewayUrl.search || gatewayUrl.hash) {
		throw new NotOrganicOperationalError(
			"NOTORGANIC_ISSUER must be the gateway origin without a /v1 path, query, or fragment.",
		);
	}
	return {
		enabled: true,
		gatewayBaseUrl: gatewayUrl.origin,
		maxCostMicrousd: positiveIntegerEnv("NOTORGANIC_MAX_COST_MICROUSD", env),
	};
}

export async function createNotOrganicServerClient(
	event: H3Event,
	feature: string,
	config = getNotOrganicServerConfig(),
): Promise<NotOrganicFetchAdapter> {
	if (!config.enabled) {
		throw new NotOrganicOperationalError("Not Organic hosted access is disabled.");
	}
	return new NotOrganicFetchAdapter({
		baseUrl: config.gatewayBaseUrl,
		session: await requireNotOrganicProductSession(event, feature),
	});
}
