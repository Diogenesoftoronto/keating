import { describe, expect, test } from "bun:test";
import { createTavusConversation, endTavusConversation, TavusServerError } from "../server/utils/tavus";

const ENV = {
	NOTORGANIC_ENABLED: "true",
	NOTORGANIC_ISSUER: "https://provider.test",
	NOTORGANIC_MAX_COST_MICROUSD: "100000",
};
const AUTH = { authorization: "DPoP account-capability", dpop: "proof-for-notorganic-tavus-route" };

describe("Keating Tavus proxy", () => {
	test("forwards account-bound DPoP to Not Organic without Tavus configuration", async () => {
		let request: Request | null = null;
		const conversation = await createTavusConversation({ ...AUTH, conversationalContext: "Current lesson" }, {
			env: ENV,
			fetch: (async (input, init) => {
				request = new Request(input, init);
				return Response.json({
					conversationId: "c_notorganic_123",
					embedUrl: "https://tavus.daily.co/c_notorganic_123?t=meeting-token",
					terminationToken: "account-bound-termination-token",
					status: "active",
				});
			}) as typeof fetch,
		});

		expect(conversation.status).toBe("active");
		const forwarded = request as unknown as Request;
		expect(forwarded.url).toBe("https://provider.test/v1/tavus/conversations");
		expect(forwarded.headers.get("authorization")).toBe(AUTH.authorization);
		expect(forwarded.headers.get("dpop")).toBe(AUTH.dpop);
		expect(await forwarded.json()).toEqual({ conversationalContext: "Current lesson" });
	});

	test("forwards cleanup proof and account-bound termination capability", async () => {
		let request: Request | null = null;
		await endTavusConversation("c_notorganic_123", { ...AUTH, terminationToken: "termination-token" }, {
			env: ENV,
			fetch: (async (input, init) => {
				request = new Request(input, init);
				return new Response(null, { status: 204 });
			}) as typeof fetch,
		});

		const forwarded = request as unknown as Request;
		expect(forwarded.url).toBe("https://provider.test/v1/tavus/conversations/c_notorganic_123/end");
		expect(forwarded.headers.get("x-tavus-termination-token")).toBe("termination-token");
	});

	test("fails closed on missing proof and malformed provider responses", async () => {
		await expect(createTavusConversation({}, { env: ENV })).rejects.toMatchObject({ statusCode: 401 });
		await expect(createTavusConversation(AUTH, {
			env: ENV,
			fetch: (async () => Response.json({ palId: "must-not-cross-boundary" })) as unknown as typeof fetch,
		})).rejects.toBeInstanceOf(TavusServerError);
	});

	test("preserves safe provider recovery errors", async () => {
		await expect(createTavusConversation(AUTH, {
			env: ENV,
			fetch: (async () => Response.json({ error: { message: "Reconnect with realtime access." } }, { status: 403 })) as unknown as typeof fetch,
		})).rejects.toMatchObject({ statusCode: 403, message: "Reconnect with realtime access." });
	});
});
