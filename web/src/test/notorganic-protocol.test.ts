/** External protocol assertions intentionally use literal wire names and values. */
import { describe, expect, test } from "bun:test";
import { NotOrganicFetchAdapter, type NotOrganicDpopInput } from "../notorganic-provider/fetch-adapter";

describe("Not Organic DPoP request binding", () => {
	test("binds the proof to the exact outgoing method, absolute URL, and bearer token", async () => {
		const proofInputs: NotOrganicDpopInput[] = [];
		let observed: { url: string; init?: RequestInit } | undefined;
		const accessToken = "capability-token-bound-to-this-request";
		const adapter = new NotOrganicFetchAdapter({
			baseUrl: "https://gateway.example.test/root/",
			session: {
				accountId: "did:plc:fixture",
				accessToken,
				createDpopProof: async input => {
					proofInputs.push(input);
					return "signed-proof-for-captured-input";
				},
			},
			fetch: (async (url, init) => {
				observed = { url: String(url), init };
				return Response.json({ ok: true });
			}) as typeof fetch,
		});

		await adapter.request("/v1/chat/completions?mode=balanced", {
			method: "POST",
			body: "{}",
			maxCostMicrousd: 37,
			idempotencyKey: "request-37",
		});

		expect(proofInputs).toEqual([{
			method: "POST",
			url: "https://gateway.example.test/root/v1/chat/completions?mode=balanced",
			accessToken,
		}]);
		expect(observed?.url).toBe("https://gateway.example.test/root/v1/chat/completions?mode=balanced");
		expect(observed?.init?.method).toBe("POST");
		const headers = new Headers(observed?.init?.headers);
		expect(headers.get("authorization")).toBe(`DPoP ${accessToken}`);
		expect(headers.get("dpop")).toBe("signed-proof-for-captured-input");
		expect(headers.get("x-notorganic-max-cost-microusd")).toBe("37");
		expect(headers.get("idempotency-key")).toBe("request-37");
	});
});
