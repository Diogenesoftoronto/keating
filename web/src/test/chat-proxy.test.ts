import { afterEach, expect, test } from "bun:test";
import { H3 } from "h3";
import chatProxy from "../../server/api/chat-proxy/[...slug]";

const app = new H3().all("/api/chat-proxy/**", chatProxy);
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("Codex proxy isolates cookies while preserving OAuth headers and streaming", async () => {
	const payload = JSON.stringify({ model: "gpt-5.4", instructions: "Teach clearly.", input: [{ role: "user", content: "Hello" }], stream: true, store: false });
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({ start(value) {
		controller = value;
		controller.enqueue(encoder.encode("data: first\n\n"));
	} });
	globalThis.fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
		expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/responses");
		const headers = new Headers(init?.headers);
		expect(await new Response(init?.body).text()).toBe(payload);
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("accept")).toBe("text/event-stream");
		expect(headers.get("originator")).toBe("pi");
		expect(headers.get("openai-beta")).toBe("responses=experimental");
		expect(headers.get("authorization")).toBe("Bearer test-subscription-token");
		expect(headers.get("chatgpt-account-id")).toBe("test-account");
		for (const name of ["cookie", "origin", "referer", "x-target-url", "x-stainless-os"]) expect(headers.has(name)).toBe(false);
		const upstream = new Headers({
			"content-type": "text/event-stream", "x-request-id": "request-test",
			connection: "keep-alive, x-upstream-socket", "keep-alive": "timeout=5",
			"x-upstream-socket": "private", trailer: "x-checksum", upgrade: "h2c",
		});
		upstream.append("set-cookie", "__cf_bm=test; Domain=.chatgpt.com; Secure; HttpOnly");
		upstream.append("set-cookie", "upstream_session=test; Secure; HttpOnly");
		return new Response(stream, { headers: upstream });
	}, { preconnect: originalFetch.preconnect }) as typeof fetch;
	const response = await app.request("http://localhost:3000/api/chat-proxy/codex/responses", {
		method: "POST", body: payload, headers: {
			"content-type": "application/json", authorization: "Bearer test-subscription-token",
			accept: "text/event-stream", originator: "pi", "openai-beta": "responses=experimental",
			"chatgpt-account-id": "test-account", cookie: "keating_course_account=private; analytics=private",
			origin: "http://localhost:3000", referer: "http://localhost:3000/chat",
			"x-target-url": "https://chatgpt.com/backend-api", "x-stainless-os": "unknown",
		},
	});
	expect(response.status).toBe(200);
	expect(response.headers.has("set-cookie")).toBe(false);
	for (const name of ["connection", "keep-alive", "x-upstream-socket", "trailer", "upgrade"]) {
		expect(response.headers.has(name)).toBe(false);
	}
	expect(response.headers.get("x-request-id")).toBe("request-test");
	const reader = response.body!.getReader();
	try {
		// This read must complete before the upstream stream closes.
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
	} finally {
		controller.close();
		await reader.cancel();
	}
});

test("upstream rejection stays a rejection without setting cookies", async () => {
	globalThis.fetch = Object.assign(async () => new Response('{"error":"unauthorized"}', {
		status: 401, headers: { "content-type": "application/json", "set-cookie": "__cf_bm=test; Domain=.chatgpt.com", connection: "keep-alive", "keep-alive": "timeout=5" },
	}), { preconnect: originalFetch.preconnect }) as typeof fetch;
	const response = await app.request("http://localhost:3000/api/chat-proxy/responses", {
		method: "POST", headers: { "x-target-url": "https://chatgpt.com/backend-api/codex" },
	});
	expect(response.status).toBe(401);
	expect(response.headers.has("set-cookie")).toBe(false);
	expect(response.headers.has("connection")).toBe(false);
	expect(response.headers.has("keep-alive")).toBe(false);
	expect(await response.json()).toEqual({ error: "unauthorized" });
});
