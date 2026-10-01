import { afterEach, beforeEach, expect, test } from "bun:test";
import { H3 } from "h3";
import chatProxy from "../../server/api/chat-proxy/[...slug]";
import { MemoryPublicAbuseStore, setPublicAbuseStoreForTests } from "../../server/utils/public-abuse";

const app = new H3().all("/api/chat-proxy/**", chatProxy);
const originalFetch = globalThis.fetch;
beforeEach(() => { setPublicAbuseStoreForTests(new MemoryPublicAbuseStore()); });
afterEach(() => { globalThis.fetch = originalFetch; setPublicAbuseStoreForTests(); });

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
	expect(response.headers.get("cache-control")).toBe("no-store");
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


test("hosted proxy refuses arbitrary destinations before fetching", async () => {
  let fetched = false;
  globalThis.fetch = Object.assign(async () => { fetched = true; return new Response("unexpected"); }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  for (const target of ["https://example.com", "https://api.anthropic.com.evil.invalid", "https://api.anthropic.com:444", "https://api.anthropic.com/other"]) {
    const response = await app.request("http://localhost/api/chat-proxy/messages", { method: "POST", headers: { "x-target-url": target } });
    expect(response.status).toBe(403);
  }
  expect(fetched).toBe(false);
});

test("hosted proxy never follows upstream redirects", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    calls++;
    expect(init?.redirect).toBe("manual");
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const response = await app.request("http://localhost/api/chat-proxy/v1/messages", { method: "POST", headers: { "x-target-url": "https://api.anthropic.com" } });
  expect(response.status).toBe(502);
  expect(calls).toBe(1);
});

test("oversized chat request is rejected without contacting provider", async () => {
  let fetched = false;
  globalThis.fetch = Object.assign(async () => { fetched = true; return new Response("unexpected"); }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const response = await app.request("http://localhost/api/chat-proxy/v1/messages", {
    method: "POST", headers: { "x-target-url": "https://api.anthropic.com", "content-length": String(8 * 1024 * 1024 + 1) }, body: "small",
  });
  expect(response.status).toBe(413);
  expect(fetched).toBe(false);
});

test("stream cancellation releases admission once and aborts upstream", async () => {
  const { guardedProxyBody } = await import("../../server/utils/chat-proxy-policy");
  let releases = 0;
  let cancelled = false;
  const controller = new AbortController();
  const stream = guardedProxyBody(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), controller, async () => { releases++; });
  await stream.cancel();
  expect(controller.signal.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(releases).toBe(1);
});

test("stream timeout releases admission and errors the client", async () => {
  const { guardedProxyBody } = await import("../../server/utils/chat-proxy-policy");
  let releases = 0;
  const controller = new AbortController();
  const stream = guardedProxyBody(new ReadableStream<Uint8Array>(), controller, async () => { releases++; }, 5);
  const reader = stream.getReader();
  await expect(reader.read()).rejects.toThrow("Provider stream timed out");
  expect(controller.signal.aborted).toBe(true);
  expect(releases).toBe(1);
});


test("provider policy preserves standard targets and controls custom gateways", async () => {
  const { assertChatProxyTarget } = await import("../../server/utils/chat-proxy-policy");
  for (const url of ["https://api.anthropic.com/v1/messages", "https://api.minimax.io/anthropic/v1/messages", "https://api.minimaxi.com/v1/chat/completions", "https://api.deepseek.com/chat/completions", "https://opencode.ai/zen/go/v1/chat/completions", "https://api.business.githubcopilot.com/chat/completions", "https://api.openai.com/v1/audio/transcriptions", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent"]) {
    expect(() => assertChatProxyTarget(new URL(url), false, "")).not.toThrow();
  }
  expect(() => assertChatProxyTarget(new URL("https://custom.example/v1/messages"), false, "")).toThrow();
  expect(() => assertChatProxyTarget(new URL("https://custom.example/v1/messages"), false, "https://custom.example")).not.toThrow();
  expect(() => assertChatProxyTarget(new URL("https://custom.example.evil/v1/messages"), false, "https://custom.example")).toThrow();
  expect(() => assertChatProxyTarget(new URL("http://localhost:11434/v1/chat/completions"), true)).not.toThrow();
});

test("stream completion and upstream failure both release admission", async () => {
  const { guardedProxyBody } = await import("../../server/utils/chat-proxy-policy");
  for (const fail of [false, true]) {
    let releases = 0;
    const stream = guardedProxyBody(new ReadableStream<Uint8Array>({ start(value) {
      if (fail) value.error(new Error("provider disconnected")); else value.close();
    } }), new AbortController(), async () => { releases++; });
    if (fail) await expect(stream.getReader().read()).rejects.toThrow("provider disconnected");
    else expect((await stream.getReader().read()).done).toBe(true);
    expect(releases).toBe(1);
  }
});


test("proxy concurrency rejects excess streams and cancellation opens a slot", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>(), { headers: { "content-type": "text/event-stream" } });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  const request = () => app.request("http://localhost/api/chat-proxy/v1/messages", { method: "POST", headers: { "x-target-url": "https://api.anthropic.com" } });
  const responses: Response[] = [];
  try {
    for (let i = 0; i < 8; i++) { const response = await request(); expect(response.status).toBe(200); responses.push(response); }
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.has("retry-after")).toBe(true);
    expect(calls).toBe(8);
    await responses.shift()!.body!.cancel();
    const replacement = await request();
    expect(replacement.status).toBe(200);
    responses.push(replacement);
  } finally { await Promise.all(responses.map(response => response.body!.cancel())); }
});


test("stream byte ceiling aborts oversized upstream and releases admission", async () => {
  const { guardedProxyBody } = await import("../../server/utils/chat-proxy-policy");
  let releases = 0;
  let cancelled = false;
  const controller = new AbortController();
  const upstream = new ReadableStream<Uint8Array>({ start(value) {
    value.enqueue(new Uint8Array(8)); value.enqueue(new Uint8Array(8));
  }, cancel() { cancelled = true; } });
  const reader = guardedProxyBody(upstream, controller, async () => { releases++; }, 1000, 10).getReader();
  expect((await reader.read()).value?.byteLength).toBe(8);
  await expect(reader.read()).rejects.toThrow("Provider response is too large");
  expect(controller.signal.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(releases).toBe(1);
});

test("advertised oversized upstream is rejected without passing its body", async () => {
  let cancelled = false;
  globalThis.fetch = Object.assign(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { "content-length": String(32 * 1024 * 1024 + 1), "cache-control": "public, max-age=3600" },
  }), { preconnect: originalFetch.preconnect }) as typeof fetch;
  const response = await app.request("http://localhost/api/chat-proxy/v1/messages", { method: "POST", headers: { "x-target-url": "https://api.anthropic.com" } });
  expect(response.status).toBe(502);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(cancelled).toBe(true);
});
