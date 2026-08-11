import { createServer, request } from "node:http";
import { once } from "node:events";
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_OAUTH_CALLBACK_HEADERS_TIMEOUT_MS,
	DEFAULT_OAUTH_CALLBACK_PORT,
	DEFAULT_OAUTH_CALLBACK_REQUEST_TIMEOUT_MS,
	MAX_OAUTH_CALLBACK_QUERY_BYTES,
	OAUTH_CALLBACK_HOST,
	OAUTH_CALLBACK_PATH,
	startOAuthCallbackReceiver,
	type OAuthCallbackReceiver,
} from "../src/oauth-callback.js";

interface HttpResult {
	statusCode: number | undefined;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

function get(origin: string, path: string, method = "GET"): Promise<HttpResult> {
	return new Promise((resolve, reject) => {
		const responseChunks: Buffer[] = [];
		const sent = request(`${origin}${path}`, { method }, (response) => {
			response.on("data", (chunk: Buffer) => responseChunks.push(chunk));
			response.on("end", () => resolve({
				statusCode: response.statusCode,
				headers: response.headers,
				body: Buffer.concat(responseChunks).toString("utf8"),
			}));
		});
		sent.once("error", reject);
		sent.end();
	});
}

async function receiver(onCallback: (callback: { url: URL; code: string; state: string }) => void | Promise<void>): Promise<OAuthCallbackReceiver> {
	const result = await startOAuthCallbackReceiver({ port: 0, onCallback });
	if (!result.available) throw new Error(result.message);
	return result.receiver;
}

describe("desktop OAuth loopback callback receiver", () => {
	test("uses the documented default port while allowing isolated ephemeral tests", () => {
		expect(DEFAULT_OAUTH_CALLBACK_PORT).toBe(1455);
	});

	test("accepts one bounded callback and gives the consumer a canonical loopback URL", async () => {
		const seen: Array<{ url: URL; code: string; state: string }> = [];
		const callbackReceiver = await receiver((callback) => seen.push(callback));
		try {
			const result = await get(callbackReceiver.origin, `${OAUTH_CALLBACK_PATH}?code=proof-code&state=proof-state`);
			expect(result.statusCode).toBe(200);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toMatchObject({ code: "proof-code", state: "proof-state" });
			expect(seen[0]?.url.origin).toBe(callbackReceiver.origin);
			expect(seen[0]?.url.hostname).toBe(OAUTH_CALLBACK_HOST);
			expect(seen[0]?.url.pathname).toBe(OAUTH_CALLBACK_PATH);
			const repeated = await get(callbackReceiver.origin, `${OAUTH_CALLBACK_PATH}?code=second&state=second`);
			expect(repeated.statusCode).toBe(410);
			expect(seen).toHaveLength(1);
		} finally {
			await callbackReceiver.stop();
		}
	});

	test("requires exactly one non-empty code and state and rejects wrong paths and methods", async () => {
		let calls = 0;
		const callbackReceiver = await receiver(() => { calls += 1; });
		try {
			for (const path of [
				`${OAUTH_CALLBACK_PATH}?state=present`,
				`${OAUTH_CALLBACK_PATH}?code=present`,
				`${OAUTH_CALLBACK_PATH}?code=&state=present`,
				`${OAUTH_CALLBACK_PATH}?code=one&code=two&state=present`,
				`${OAUTH_CALLBACK_PATH}?code=%zz&state=present`,
				"/not-auth/callback?code=present&state=present",
			]) {
				expect((await get(callbackReceiver.origin, path)).statusCode).toBe(400);
			}
			expect((await get(callbackReceiver.origin, `${OAUTH_CALLBACK_PATH}?code=present&state=present`, "POST")).statusCode).toBe(405);
			expect(calls).toBe(0);
		} finally {
			await callbackReceiver.stop();
		}
	});

	test("rejects oversized queries and never reflects OAuth values into response HTML", async () => {
		let calls = 0;
		const callbackReceiver = await receiver(() => { calls += 1; });
		try {
			const secret = "sensitive-code-value";
			const accepted = await get(callbackReceiver.origin, `${OAUTH_CALLBACK_PATH}?code=${secret}&state=opaque-state`);
			expect(accepted.statusCode).toBe(200);
			expect(accepted.body).not.toContain(secret);
			expect(accepted.headers["content-security-policy"]).toContain("default-src 'none'");
			expect(accepted.headers["referrer-policy"]).toBe("no-referrer");
			expect(accepted.body).toContain("Return to Keating");
			expect(calls).toBe(1);
		} finally {
			await callbackReceiver.stop();
		}

		const oversizedReceiver = await receiver(() => { calls += 1; });
		try {
			const oversized = await get(
				oversizedReceiver.origin,
				`${OAUTH_CALLBACK_PATH}?code=${"a".repeat(MAX_OAUTH_CALLBACK_QUERY_BYTES)}&state=state`,
			);
			expect(oversized.statusCode).toBe(400);
			expect(calls).toBe(1);
		} finally {
			await oversizedReceiver.stop();
		}
	});

	test("binds only to loopback and applies bounded HTTP timeouts", async () => {
		const callbackReceiver = await receiver(() => {});
		try {
			expect(callbackReceiver.origin).toStartWith(`http://${OAUTH_CALLBACK_HOST}:`);
			expect(callbackReceiver.configuration).toEqual({
				host: OAUTH_CALLBACK_HOST,
				port: Number(new URL(callbackReceiver.origin).port),
				requestTimeoutMs: DEFAULT_OAUTH_CALLBACK_REQUEST_TIMEOUT_MS,
				headersTimeoutMs: DEFAULT_OAUTH_CALLBACK_HEADERS_TIMEOUT_MS,
				keepAliveTimeoutMs: 1_000,
				maxHeaderBytes: 8 * 1024,
			});
		} finally {
			await callbackReceiver.stop();
		}
	});

	test("returns an actionable unavailable result on port conflict", async () => {
		const occupied = createServer();
		occupied.listen({ host: OAUTH_CALLBACK_HOST, port: 0 });
		await once(occupied, "listening");
		const address = occupied.address();
		if (!address || typeof address === "string") throw new Error("Could not reserve a test loopback port.");
		try {
			const result = await startOAuthCallbackReceiver({ port: address.port, onCallback: () => {} });
			expect(result).toMatchObject({
				available: false,
				reason: "port-unavailable",
				action: "manual-paste",
			});
		} finally {
			await new Promise<void>((resolve) => occupied.close(() => resolve()));
		}
	});

	test("stops idempotently and releases the port for a later receiver", async () => {
		const first = await receiver(() => {});
		const port = Number(new URL(first.origin).port);
		await Promise.all([first.stop(), first.stop()]);
		const restarted = await startOAuthCallbackReceiver({ port, onCallback: () => {} });
		expect(restarted.available).toBe(true);
		if (restarted.available) await restarted.receiver.stop();
	});
});
