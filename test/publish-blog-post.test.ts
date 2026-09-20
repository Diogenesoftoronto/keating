import { describe, expect, test } from "bun:test";
import { prepareBlogPost, publishBlogPost } from "../scripts/publish-blog-post.js";

const post = () => prepareBlogPost({ file: "post.md", slug: "hello" }, "# Hello\n\nA **new** post.", "2026-09-19T12:00:00Z");
const env = { KEATING_BLOG_APP_PASSWORD: "test-only" };
function server(responses: Array<[number, unknown]>) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const request = (async (url: string | URL | Request, init: RequestInit = {}) => {
		calls.push({ url: String(url), init });
		const [status, body] = responses.shift()!;
		return Response.json(body, { status });
	}) as typeof fetch;
	return { calls, request };
}
const session = () => [200, { did: post().repo, accessJwt: "test-token" }] as [number, unknown];

describe("single Markdown blog publisher", () => {
	test("creates a portable post and rejects unsafe slugs and empty bodies", () => {
		expect(post().record.content.text.markdown).toBe("A **new** post.");
		expect(post().record.textContent).toBe("A new post.");
		expect(() => prepareBlogPost({ file: "x", slug: "../bad" }, "# Title\nBody")).toThrow();
		expect(() => prepareBlogPost({ file: "x" } as never, "# Title\nBody")).toThrow();
		expect(() => prepareBlogPost({ file: "x", slug: "ok" }, "# Title")).toThrow();
	});
	test("creates only when absence is confirmed and uses a null compare-and-swap", async () => {
		const fake = server([session(), [400, { error: "RecordNotFound" }], [200, {}]]);
		expect(await publishBlogPost(post(), env, fake.request)).toBe("https://blog.keating.help/blog/hello");
		expect(JSON.parse(String(fake.calls[2]!.init.body)).swapRecord).toBeNull();
		expect(fake.calls).toHaveLength(3);
	});
	test("edits preserve the date and metadata and guard against concurrent writes", async () => {
		const old = { ...post().record, publishedAt: "2025-01-01T00:00:00Z", tags: ["release"] };
		const fake = server([session(), [200, { cid: "old-cid", value: old }], [200, {}]]);
		await publishBlogPost(post(), env, fake.request);
		const written = JSON.parse(String(fake.calls[2]!.init.body));
		expect(written.swapRecord).toBe("old-cid");
		expect(written.record.publishedAt).toBe(old.publishedAt);
		expect(written.record.tags).toEqual(["release"]);
	});
	test("wrong account and failed reads never write", async () => {
		const wrong = server([[200, { did: "did:plc:wrong", accessJwt: "test-token" }]]);
		await expect(publishBlogPost(post(), env, wrong.request)).rejects.toThrow("does not match");
		expect(wrong.calls).toHaveLength(1);
		const failed = server([session(), [503, { error: "Unavailable" }]]);
		await expect(publishBlogPost(post(), env, failed.request)).rejects.toThrow("nothing was written");
		expect(failed.calls).toHaveLength(2);
	});
	test("reports conflicts without retrying over another edit", async () => {
		const fake = server([session(), [404, { error: "RecordNotFound" }], [400, { error: "InvalidSwap" }]]);
		await expect(publishBlogPost(post(), env, fake.request)).rejects.toThrow("concurrent edit");
		expect(fake.calls).toHaveLength(3);
	});
});
