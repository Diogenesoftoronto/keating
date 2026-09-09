import { describe, expect, test } from "bun:test";
import { CodexDeviceAuthError, pollCodexDeviceAuth, startCodexDeviceAuth } from "../../server/api/oauth/openai-codex-device-flow";

const input = { device_code: "device-code", user_code: "ABCD-EFGH" };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function mockFetch(...responses: Response[]) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		const response = responses.shift();
		if (!response) throw new Error("Unexpected request");
		return response;
	}) as typeof fetch;
	return { fetcher, calls };
}

describe("Codex device authorization server", () => {
	test("starts only at OpenAI and normalizes numeric-string intervals", async () => {
		const { fetcher, calls } = mockFetch(jsonResponse({ device_auth_id: input.device_code, user_code: input.user_code, interval: "5" }));
		expect(await startCodexDeviceAuth(fetcher)).toEqual({ ...input, verification_uri: "https://auth.openai.com/codex/device", interval: 5, expires_in: 900 });
		expect(calls[0]?.url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
		expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ client_id: expect.any(String) });
		expect(calls[0]!.init).toMatchObject({ method: "POST", redirect: "error" });
		expect(calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
	});

	test.each([403, 404])("treats HTTP %s as awaiting approval", async (status) => {
		const { fetcher, calls } = mockFetch(new Response("", { status }));
		expect(await pollCodexDeviceAuth(input, fetcher)).toEqual({ status: "pending" });
		expect(calls).toHaveLength(1);
	});

	test.each(["authorization_pending", "deviceauth_authorization_pending"])("accepts explicit %s", async (code) => {
		const { fetcher } = mockFetch(jsonResponse({ error: { code } }, 400));
		expect(await pollCodexDeviceAuth(input, fetcher)).toEqual({ status: "pending" });
	});

	test("honors slow_down including a pending HTTP status", async () => {
		const { fetcher } = mockFetch(jsonResponse({ error: "slow_down" }, 403));
		expect(await pollCodexDeviceAuth(input, fetcher)).toEqual({ status: "slow_down" });
	});

	test("reports denial without forwarding provider details", async () => {
		const { fetcher } = mockFetch(jsonResponse({ error: "access_denied", error_description: "sensitive upstream detail" }, 403));
		expect(await pollCodexDeviceAuth(input, fetcher)).toEqual({ status: "denied", error: "OpenAI sign-in was declined." });
	});

	test("reports expiration", async () => {
		const { fetcher } = mockFetch(jsonResponse({ error: "expired_token" }, 400));
		expect((await pollCodexDeviceAuth(input, fetcher)).status).toBe("expired");
	});

	test("exchanges successful authorization server-side and preserves the ChatGPT token", async () => {
		const { fetcher, calls } = mockFetch(
			jsonResponse({ authorization_code: "authorization-secret", code_verifier: "verifier-secret" }),
			jsonResponse({ access_token: "chatgpt.raw.jwt", refresh_token: "refresh-secret", expires_in: 3600, id_token: "not-returned" }),
		);
		expect(await pollCodexDeviceAuth(input, fetcher)).toEqual({ status: "complete", access_token: "chatgpt.raw.jwt", refresh_token: "refresh-secret", expires_in: 3600 });
		expect(calls.map(({ url }) => url)).toEqual(["https://auth.openai.com/api/accounts/deviceauth/token", "https://auth.openai.com/oauth/token"]);
		expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ device_auth_id: input.device_code, user_code: input.user_code });
		const params = new URLSearchParams(calls[1]!.init!.body as string);
		expect(Object.fromEntries(params)).toEqual({ grant_type: "authorization_code", code: "authorization-secret", code_verifier: "verifier-secret", client_id: expect.any(String), redirect_uri: "https://auth.openai.com/deviceauth/callback" });
		expect(calls[1]!.init!.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
	});

	test.each([null, [], {}, { ...input, device_code: 123 }, { ...input, user_code: "x".repeat(65) }, { ...input, device_code: "x".repeat(1025) }])("rejects malformed input before contacting OpenAI: %j", async (body) => {
		const { fetcher, calls } = mockFetch();
		try {
			await pollCodexDeviceAuth(body, fetcher);
			throw new Error("Expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(CodexDeviceAuthError);
			expect((error as CodexDeviceAuthError).statusCode).toBe(400);
		}
		expect(calls).toHaveLength(0);
	});

	test.each([null, [], { device_auth_id: {}, user_code: "CODE", interval: 5 }, { device_auth_id: "id", user_code: "CODE", interval: "garbage" }, { device_auth_id: "id", user_code: "CODE", interval: 61 }])("rejects malformed start response: %j", async (response) => {
		const { fetcher } = mockFetch(jsonResponse(response));
		await expect(startCodexDeviceAuth(fetcher)).rejects.toThrow("invalid sign-in response");
	});

	test("rejects oversized upstream responses", async () => {
		const { fetcher } = mockFetch(jsonResponse({ extra: "x".repeat(65_536) }));
		await expect(startCodexDeviceAuth(fetcher)).rejects.toThrow("invalid sign-in response");
	});

	test("does not expose malformed authorization response values", async () => {
		const { fetcher, calls } = mockFetch(jsonResponse({ authorization_code: "do-not-leak", code_verifier: { secret: "secret" } }));
		await expect(pollCodexDeviceAuth(input, fetcher)).rejects.toThrow("OpenAI returned an invalid sign-in response.");
		expect(calls).toHaveLength(1);
	});

	test("does not expose failed token exchange response values", async () => {
		const { fetcher } = mockFetch(jsonResponse({ authorization_code: "secret", code_verifier: "secret" }), jsonResponse({ secret: "do-not-leak" }, 500));
		await expect(pollCodexDeviceAuth(input, fetcher)).rejects.toThrow("OpenAI could not finish sign-in. Start sign-in again.");
	});

	test("rejects malformed tokens rather than completing sign-in", async () => {
		const { fetcher } = mockFetch(jsonResponse({ authorization_code: "secret", code_verifier: "secret" }), jsonResponse({ access_token: {}, refresh_token: "refresh", expires_in: 3600 }));
		await expect(pollCodexDeviceAuth(input, fetcher)).rejects.toThrow("invalid sign-in credentials");
	});
});
