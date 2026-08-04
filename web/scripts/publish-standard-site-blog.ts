import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LEGACY_BLOG_POSTS } from "../src/pages/Blog";
import {
	MARKPUB_MARKDOWN_TYPE,
	STANDARD_SITE_DOCUMENT_COLLECTION,
	STANDARD_SITE_PUBLICATION_COLLECTION,
	plainTextFromMarkdown,
	stableBlogSlug,
} from "../src/keating/standard-site";

interface PublishRecord {
	collection: string;
	rkey: string;
	record: Record<string, unknown>;
}

interface SessionResponse {
	did?: string;
	accessJwt?: string;
	error?: string;
	message?: string;
}

const DEFAULT_OUTPUT = resolve(import.meta.dir, "../../.keating/outputs/standard-site-blog.json");
const CANONICAL_URL = process.env.KEATING_BLOG_CANONICAL_URL?.trim() || "https://keating.help";

function decodeHtmlEntities(value: string): string {
	const named: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: '"',
	};
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
		if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
		if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
		return named[entity.toLowerCase()] ?? `&${entity};`;
	});
}

function stripTags(value: string): string {
	return decodeHtmlEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function fence(code: string): string {
	const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((ticks) => ticks.length));
	const ticks = "`".repeat(Math.max(3, longest + 1));
	return `${ticks}\n${decodeHtmlEntities(code).trim()}\n${ticks}`;
}

/** Convert the controlled, server-rendered historical JSX into portable GFM. */
export function legacyHtmlToMarkdown(html: string): string {
	const blocks: string[] = [];
	const inlineCode: string[] = [];
	let markdown = html
		.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code: string) => {
			const token = `\u0000BLOCK${blocks.length}\u0000`;
			blocks.push(fence(stripTags(code)));
			return `\n\n${token}\n\n`;
		})
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_match, code: string) => {
			const token = `\u0000INLINE${inlineCode.length}\u0000`;
			const value = stripTags(code);
			const ticks = value.includes("`") ? "``" : "`";
			inlineCode.push(`${ticks}${value}${ticks}`);
			return token;
		})
		.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
		.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
		.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => `[${stripTags(label)}](${decodeHtmlEntities(href)})`)
		.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src: string) => {
			const alt = /\salt=["']([^"']*)["']/i.exec(match)?.[1] ?? "";
			return `![${decodeHtmlEntities(alt)}](${decodeHtmlEntities(src)})`;
		})
		.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, body: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(body)}\n\n`)
		.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, body: string) => `\n\n${stripTags(body).split("\n").map((line) => `> ${line}`).join("\n")}\n\n`)
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, body: string) => `\n- ${stripTags(body)}`)
		.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (_match, body: string) => `| ${stripTags(body)} `)
		.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_match, body: string) => `\n${body}|`)
		.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_match, body: string) => `\n\n${stripTags(body)}\n\n`)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	markdown = decodeHtmlEntities(markdown);
	blocks.forEach((block, index) => {
		markdown = markdown.replace(`\u0000BLOCK${index}\u0000`, block);
	});
	inlineCode.forEach((code, index) => {
		markdown = markdown.replace(`\u0000INLINE${index}\u0000`, code);
	});
	return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

function publicationRecord(): PublishRecord {
	return {
		collection: STANDARD_SITE_PUBLICATION_COLLECTION,
		rkey: "self",
		record: {
			$type: STANDARD_SITE_PUBLICATION_COLLECTION,
			url: CANONICAL_URL,
			name: "Keating Blog",
			description: "Release notes, engineering essays, and field notes from Keating's teaching system.",
			preferences: { showInDiscover: true },
		},
	};
}

export function buildLegacyStandardSiteRecords(did: string): PublishRecord[] {
	const publicationUri = `at://${did}/${STANDARD_SITE_PUBLICATION_COLLECTION}/self`;
	const documents = LEGACY_BLOG_POSTS.map((post): PublishRecord => {
		const slug = stableBlogSlug(post.title);
		const markdown = legacyHtmlToMarkdown(renderToStaticMarkup(post.body));
		return {
			collection: STANDARD_SITE_DOCUMENT_COLLECTION,
			rkey: slug,
			record: {
				$type: STANDARD_SITE_DOCUMENT_COLLECTION,
				site: publicationUri,
				path: `/blog/${slug}`,
				title: post.title,
				description: post.summary,
				publishedAt: `${post.date}T12:00:00.000Z`,
				tags: [post.badge.label.toLowerCase(), ...(post.version ? [`version:${post.version}`] : [])],
				textContent: plainTextFromMarkdown(markdown),
				content: {
					$type: MARKPUB_MARKDOWN_TYPE,
					flavor: "gfm",
					text: { $type: "at.markpub.text", markdown },
				},
			},
		};
	});
	return [publicationRecord(), ...documents];
}

async function xrpcJson<T>(url: string, init: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const payload = await response.json().catch(() => null) as T & { error?: string; message?: string } | null;
	if (!response.ok || !payload) {
		const reason = payload?.message || payload?.error || response.statusText;
		throw new Error(`PDS request failed (${response.status}): ${reason}`);
	}
	return payload;
}

async function createSession(pds: string, identifier: string, password: string): Promise<Required<Pick<SessionResponse, "did" | "accessJwt">>> {
	const session = await xrpcJson<SessionResponse>(`${pds}/xrpc/com.atproto.server.createSession`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ identifier, password }),
	});
	if (!session.did || !session.accessJwt) throw new Error("The PDS session response omitted its DID or access token");
	return { did: session.did, accessJwt: session.accessJwt };
}

async function putRecord(pds: string, did: string, accessJwt: string, item: PublishRecord): Promise<void> {
	await xrpcJson(`${pds}/xrpc/com.atproto.repo.putRecord`, {
		method: "POST",
		headers: { authorization: `Bearer ${accessJwt}`, "content-type": "application/json" },
		body: JSON.stringify({
			repo: did,
			collection: item.collection,
			rkey: item.rkey,
			record: item.record,
			validate: false,
		}),
	});
}

function argumentValue(prefix: string): string | undefined {
	return process.argv.find((argument) => argument.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
}

async function main(): Promise<void> {
	const shouldWrite = process.argv.includes("--write");
	const only = argumentValue("--only");
	const output = resolve(argumentValue("--output") ?? DEFAULT_OUTPUT);
	let did = process.env.KEATING_BLOG_DID?.trim() || "did:plc:replace-me";
	let accessJwt: string | undefined;
	let pds: string | undefined;

	if (shouldWrite) {
		pds = process.env.KEATING_BLOG_PDS_URL?.trim().replace(/\/$/, "");
		const identifier = process.env.KEATING_BLOG_IDENTIFIER?.trim();
		const password = process.env.KEATING_BLOG_APP_PASSWORD;
		if (!pds || !identifier || !password) {
			throw new Error("--write requires KEATING_BLOG_PDS_URL, KEATING_BLOG_IDENTIFIER, and KEATING_BLOG_APP_PASSWORD");
		}
		const session = await createSession(pds, identifier, password);
		did = session.did;
		accessJwt = session.accessJwt;
	}

	const allRecords = buildLegacyStandardSiteRecords(did);
	const records = only
		? allRecords.filter((item) => item.collection === STANDARD_SITE_PUBLICATION_COLLECTION || item.rkey === only)
		: allRecords;
	if (only && records.length === 1) throw new Error(`No legacy post matched --only=${only}`);

	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify({ did, records }, null, 2)}\n`, "utf8");

	if (shouldWrite && pds && accessJwt) {
		for (const item of records) await putRecord(pds, did, accessJwt, item);
		console.log(`Published ${records.length} records to ${pds} for ${did}.`);
	} else {
		console.log(`Dry run: prepared ${records.length} records for ${did}.`);
	}
	console.log(`Record payloads: ${output}`);
	console.log(`Publication URI: at://${did}/${STANDARD_SITE_PUBLICATION_COLLECTION}/self`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : "Blog publishing failed");
		process.exitCode = 1;
	});
}
