import type { NotOrganicPublicClient } from "./public-client";
import { hostedInklingBillingCode, isTinkerBillingBlock } from "./provider-billing";

/** One logical inference request; each transport attempt gets a fresh DPoP proof. */
export function createNotOrganicInferenceFetch(
	client: Pick<NotOrganicPublicClient, "headersFor">,
	requestUrl: string,
	options: { fetch?: typeof globalThis.fetch; idempotencyKey: string; maxCostMicrousd: number },
): typeof globalThis.fetch {
	const fetcher = !options.fetch || options.fetch === globalThis.fetch
		? globalThis.fetch.bind(globalThis)
		: options.fetch;
	const expectedUrl = new URL(requestUrl).href;
	return (async (input, init) => {
		const request = new Request(input, init);
		if (request.url !== expectedUrl || request.method !== "POST") {
			throw new Error("Unexpected Not Organic inference request target");
		}
		const headers = await client.headersFor(request.method, request.url, request.headers);
		headers.set("idempotency-key", options.idempotencyKey);
		headers.set("x-notorganic-max-cost-microusd", String(options.maxCostMicrousd));
		// Firefox permits SDKs to set this header, triggering unnecessary preflights.
		headers.delete("user-agent");
		// Pi adds upstream session-affinity headers that the account gateway does
		// not accept in CORS preflights. Keep prompt_cache_key in the body.
		for (const name of ["session_id", "x-client-request-id", "x-session-affinity", "x-session-id"]) {
			headers.delete(name);
		}
		const response = await fetcher(request, { headers });
		if (response.status !== 402) return response;

		// The chat SDK only reads the OpenAI error envelope. Tinker returns a
		// top-level detail that also contains private billing-account metadata.
		const body = await response.clone().json().catch(() => null);
		if (typeof body?.detail !== "string" || !isTinkerBillingBlock(body.detail)) return response;
		const responseHeaders = new Headers(response.headers);
		for (const name of ["content-encoding", "content-length", "etag"]) responseHeaders.delete(name);
		return Response.json({ error: {
			code: hostedInklingBillingCode,
			type: "provider_billing_error",
			message: "Keating’s hosted Inkling provider account is blocked by a billing issue.",
		} }, { status: response.status, statusText: response.statusText, headers: responseHeaders });
	}) as typeof globalThis.fetch;
}
