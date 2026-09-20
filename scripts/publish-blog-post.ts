import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStandardSiteDocument, plainTextFromMarkdown } from "../web/src/keating/standard-site.js";

const DID = "did:plc:tiyely2inmhsmp6g6gmqsgm3";
const PDS = "https://pds.notorganic.info";
const COLLECTION = "site.standard.document";
const SITE = `at://${DID}/site.standard.publication/self`;

export interface BlogPostInput {
	file: string;
	slug: string;
	title?: string;
	description?: string;
}

export function prepareBlogPost(input: BlogPostInput, markdown: string, now = new Date().toISOString()) {
	if (typeof input.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
		throw new Error("Provide a stable lowercase slug, for example keating-4-0-0.");
	}
	const heading = /^#\s+(.+)$/m.exec(markdown);
	const title = input.title?.trim() || heading?.[1]?.trim();
	if (!title) throw new Error("Provide input title or a Markdown # title.");
	const body = markdown.replace(/^#\s+[^\n]+\n?/, "").trim();
	if (!body) throw new Error("The post body is empty.");
	const description = input.description?.trim()
		|| plainTextFromMarkdown(body.split(/\n\s*\n/)[0]!).slice(0, 280);
	return {
		repo: DID,
		collection: COLLECTION,
		rkey: input.slug,
		record: {
			$type: COLLECTION,
			site: SITE,
			path: `/blog/${input.slug}`,
			title,
			description,
			publishedAt: now,
			textContent: plainTextFromMarkdown(body),
			content: {
				$type: "at.markpub.markdown",
				flavor: "gfm",
				text: { $type: "at.markpub.text", markdown: body },
			},
		},
	};
}

/** Only --write calls this boundary. Tokens and provider error bodies never reach logs. */
export async function publishBlogPost(
	post: ReturnType<typeof prepareBlogPost>,
	env: Record<string, string | undefined> = process.env,
	request: typeof fetch = fetch,
) {
	const pds = new URL(env.KEATING_BLOG_PDS_URL || PDS);
	if (pds.protocol !== "https:" || pds.username || pds.password || pds.search || pds.hash || pds.pathname !== "/") {
		throw new Error("KEATING_BLOG_PDS_URL must be an HTTPS origin.");
	}
	const password = env.KEATING_BLOG_APP_PASSWORD;
	if (!password) throw new Error("Load KEATING_BLOG_APP_PASSWORD from the secret store before publishing.");
	const call = (method: string, init: RequestInit) => request(`${pds.origin}/xrpc/${method}`, {
		...init, redirect: "error", signal: AbortSignal.timeout(30_000),
	});
	const sessionResponse = await call("com.atproto.server.createSession", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ identifier: env.KEATING_BLOG_IDENTIFIER || DID, password }),
	});
	if (!sessionResponse.ok) throw new Error(`Blog sign-in failed (HTTP ${sessionResponse.status}).`);
	const session = await sessionResponse.json() as { did?: string; accessJwt?: string };
	if (session.did !== DID || !session.accessJwt) throw new Error("Publisher session does not match the Keating blog account.");
	const headers = { authorization: `Bearer ${session.accessJwt}`, "content-type": "application/json" };
	const query = new URLSearchParams({ repo: DID, collection: COLLECTION, rkey: post.rkey });
	const existingResponse = await call(`com.atproto.repo.getRecord?${query}`, { headers });
	let record: Record<string, unknown> = post.record;
	let swapRecord: string | null = null;
	if (existingResponse.ok) {
		const existing = await existingResponse.json() as { cid?: string; value?: Record<string, unknown> };
		const parsed = parseStandardSiteDocument(existing.value);
		if (!existing.cid || !parsed || parsed.site !== SITE || parsed.path !== post.record.path) {
			throw new Error("Existing record is not the expected Keating post; refusing to overwrite it.");
		}
		swapRecord = existing.cid;
		record = { ...existing.value, ...post.record, publishedAt: parsed.publishedAt };
	} else {
		const error = await existingResponse.json().catch(() => null) as { error?: string } | null;
		if (existingResponse.status !== 400 && existingResponse.status !== 404 || error?.error !== "RecordNotFound") {
			throw new Error(`Cannot read existing post (HTTP ${existingResponse.status}); nothing was written.`);
		}
	}
	const response = await call("com.atproto.repo.putRecord", {
		method: "POST", headers,
		body: JSON.stringify({ ...post, record, swapRecord, validate: false }),
	});
	if (!response.ok) throw new Error(`Blog publish failed (HTTP ${response.status}); a concurrent edit may require retrying.`);
	return `https://blog.keating.help${post.record.path}`;
}

if (import.meta.main) {
	try {
		const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}") as BlogPostInput;
		if (typeof input.file !== "string" || !input.file.trim()) throw new Error("Provide --input file=path/to/post.md and --input slug=stable-slug.");
		const post = prepareBlogPost(input, await Bun.file(resolve(input.file)).text());
		if (process.argv.includes("--write")) {
			console.log(`Published ${await publishBlogPost(post)}`);
		} else {
			const output = resolve(".keating/outputs/blog", `${post.rkey}.json`);
			await mkdir(resolve(".keating/outputs/blog"), { recursive: true });
			await Bun.write(output, `${JSON.stringify(post, null, 2)}\n`);
			console.log(`Preview: ${output}\nNo network requests or publication. Updates preserve the remote publication date and metadata.`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Blog publishing failed.");
		process.exitCode = 1;
	}
}
