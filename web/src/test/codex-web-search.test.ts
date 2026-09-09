import { zstdDecompressSync } from "node:zlib";
import { expect, test } from "bun:test";
import { getModels, streamSimple } from "@earendil-works/pi-ai/compat";
import { withProviderWebSearch } from "../hooks/keating-stream";
import { applyProviderWebSearch, resolveProviderWebSearchRoute, shouldExposeClientWebSearch } from "../keating/provider-web-search";
import { createCodexSearchFetch } from "../keating/search/codex-search-fetch";

const model = getModels("openai-codex").find(m => m.id === "gpt-5.3-codex-spark")!;

test("Codex requests native search with its existing login and keeps app tools", async () => {
  expect(model).toBeDefined();
  expect(resolveProviderWebSearchRoute(model, true).kind).toBe("native");
  expect(shouldExposeClientWebSearch(model)).toBe(false);
  expect(applyProviderWebSearch({}, model, false)).toBeUndefined();
  const fn = { type: "function", name: "quiz" };
  const payload = applyProviderWebSearch({ tools: [fn], include: ["reasoning.encrypted_content"] }, model, true) as any;
  expect(payload.tools).toEqual([fn, { type: "web_search", external_web_access: true }]);
  expect(payload.include).toEqual(["reasoning.encrypted_content"]);
  expect(applyProviderWebSearch(payload, model, true)).toBeUndefined();
});

test("real Codex SDK sends native search and retains cited findings from chunked SSE", async () => {
  const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.test`;
  const item = { id: "msg_search", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "A sourced finding.", annotations: [{ type: "url_citation", url: "https://example.com/paper", title: "Paper", start_index: 0, end_index: 17 }] }] };
  const events = [
    { type: "response.created", response: { id: "resp_search", status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { id: "ws_1", type: "web_search_call", status: "in_progress" } },
    { type: "response.output_item.done", output_index: 0, item: { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "paper" } } },
    { type: "response.output_item.added", output_index: 1, item: { ...item, content: [] } },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "A sourced finding." },
    { type: "response.output_item.done", output_index: 1, item },
    { type: "response.completed", response: { id: "resp_search", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } },
  ];
  let requests = 0;
  const fakeFetch = (async (url: any, init: any) => {
    requests++;
    expect(String(url)).toContain("/codex/responses");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(new Headers(init.headers).get("chatgpt-account-id")).toBe("test-account");
    expect(JSON.parse(typeof init.body === "string" ? init.body : zstdDecompressSync(init.body).toString()).tools).toContainEqual({ type: "web_search", external_web_access: true });
    const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""));
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const options = withProviderWebSearch({ apiKey: token, fetch: fakeFetch, maxRetries: 0 }, model, true, false);
  const result = await streamSimple(model, { messages: [{ role: "user", content: "Find the paper", timestamp: 1 }] }, options).result();
  expect(result.errorMessage).toBeUndefined();
  expect(result.stopReason).not.toBe("error");
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: "A sourced finding.\n\nSources: [Paper](<https://example.com/paper>)" })]));
  expect(requests).toBe(1);
});

test("authentication failures pass through unchanged without search retries or fallback", async () => {
  const original = new Response("invalid token", { status: 401 });
  const fetcher = createCodexSearchFetch(model, (async () => original) as unknown as typeof fetch);
  expect(await fetcher("https://example.com")).toBe(original);
});
