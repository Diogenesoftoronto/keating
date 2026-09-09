import type { NotOrganicPublicClient } from "./public-client";

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
		return fetcher(request, { headers });
	}) as typeof globalThis.fetch;
}
