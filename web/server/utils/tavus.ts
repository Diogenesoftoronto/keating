import { getNotOrganicServerConfig, NotOrganicOperationalError } from "../../src/notorganic-provider/server";

const MAX_AUTHORIZATION_LENGTH = 16_384;
const MAX_DPOP_LENGTH = 16_384;

export interface TavusConversation {
	conversationId: string;
	embedUrl: string;
	terminationToken: string;
	status: "active";
}

export class TavusServerError extends Error {
	constructor(message: string, readonly statusCode: number) {
		super(message);
		this.name = "TavusServerError";
	}
}

function credentials(input: { authorization?: string; dpop?: string }): { authorization: string; dpop: string } {
	const authorization = input.authorization?.trim() ?? "";
	const dpop = input.dpop?.trim() ?? "";
	if (!authorization.startsWith("DPoP ") || authorization.length > MAX_AUTHORIZATION_LENGTH || !dpop || dpop.length > MAX_DPOP_LENGTH) {
		throw new TavusServerError("Connect your Not Organic account to start Tavus Live.", 401);
	}
	return { authorization, dpop };
}

function gateway(options: { env?: NodeJS.ProcessEnv }): string {
	try {
		const config = getNotOrganicServerConfig(options.env);
		if (!config.enabled) throw new NotOrganicOperationalError("Not Organic hosted access is disabled.");
		return config.gatewayBaseUrl;
	} catch (error) {
		if (error instanceof NotOrganicOperationalError) throw new TavusServerError(error.message, error.statusCode);
		throw error;
	}
}

function providerMessage(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
	const message = typeof nested?.message === "string"
		? nested.message
		: typeof record.message === "string"
			? record.message
			: "";
	return message.trim().slice(0, 400) || undefined;
}

function statusCode(status: number): number {
	return [400, 401, 403, 404, 409, 429, 503].includes(status) ? status : 502;
}

async function providerRequest(
	path: string,
	input: { authorization?: string; dpop?: string; body?: unknown; terminationToken?: string },
	options: { env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch } = {},
): Promise<unknown> {
	const auth = credentials(input);
	const headers = new Headers({ authorization: auth.authorization, dpop: auth.dpop });
	if (input.body !== undefined) headers.set("content-type", "application/json");
	if (input.terminationToken) headers.set("x-tavus-termination-token", input.terminationToken);
	const response = await (options.fetch ?? globalThis.fetch)(`${gateway(options)}${path}`, {
		method: "POST",
		headers,
		...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
	});
	const payload = response.status === 204 ? null : await response.json().catch(() => null);
	if (!response.ok) {
		throw new TavusServerError(
			providerMessage(payload) ?? "Not Organic could not open the Tavus conversation.",
			statusCode(response.status),
		);
	}
	return payload;
}

function conversation(value: unknown): TavusConversation {
	if (!value || typeof value !== "object") throw new TavusServerError("Not Organic returned an incomplete Tavus conversation.", 502);
	const record = value as Record<string, unknown>;
	if (typeof record.conversationId !== "string" || typeof record.embedUrl !== "string" || typeof record.terminationToken !== "string" || record.status !== "active") {
		throw new TavusServerError("Not Organic returned an incomplete Tavus conversation.", 502);
	}
	let embedUrl: URL;
	try {
		embedUrl = new URL(record.embedUrl);
	} catch {
		throw new TavusServerError("Not Organic returned an invalid Tavus conversation URL.", 502);
	}
	if (embedUrl.protocol !== "https:" || (embedUrl.hostname !== "tavus.daily.co" && !embedUrl.hostname.endsWith(".daily.co"))) {
		throw new TavusServerError("Not Organic returned an untrusted Tavus conversation URL.", 502);
	}
	return {
		conversationId: record.conversationId,
		embedUrl: embedUrl.toString(),
		terminationToken: record.terminationToken,
		status: "active",
	};
}

export async function createTavusConversation(
	input: { authorization?: string; dpop?: string; conversationalContext?: unknown },
	options: { env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch } = {},
): Promise<TavusConversation> {
	return conversation(await providerRequest(
		"/v1/tavus/conversations",
		{ authorization: input.authorization, dpop: input.dpop, body: { conversationalContext: input.conversationalContext } },
		options,
	));
}

export async function endTavusConversation(
	conversationId: string,
	input: { authorization?: string; dpop?: string; terminationToken: string },
	options: { env?: NodeJS.ProcessEnv; fetch?: typeof globalThis.fetch } = {},
): Promise<void> {
	if (!/^c[a-zA-Z0-9_-]{5,127}$/.test(conversationId)) throw new TavusServerError("Invalid Tavus conversation id.", 400);
	await providerRequest(`/v1/tavus/conversations/${encodeURIComponent(conversationId)}/end`, input, options);
}
