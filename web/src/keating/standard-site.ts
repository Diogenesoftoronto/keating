export const STANDARD_SITE_DOCUMENT_COLLECTION = "site.standard.document";
export const STANDARD_SITE_PUBLICATION_COLLECTION = "site.standard.publication";
export const MARKPUB_MARKDOWN_TYPE = "at.markpub.markdown";

export interface AtprotoRecordEnvelope {
	uri: string;
	cid: string;
	value: unknown;
}

export interface StandardSiteBlob {
	$type?: string;
	ref?: { $link?: string };
	mimeType?: string;
	size?: number;
}

export interface StandardSiteDocumentRecord {
	$type: typeof STANDARD_SITE_DOCUMENT_COLLECTION;
	site: string;
	title: string;
	publishedAt: string;
	path?: string;
	description?: string;
	coverImage?: StandardSiteBlob;
	content?: unknown;
	textContent?: string;
	tags?: string[];
	updatedAt?: string;
	bskyPostRef?: { uri?: string; cid?: string };
}

export interface StandardSitePublicationRecord {
	$type: typeof STANDARD_SITE_PUBLICATION_COLLECTION;
	url: string;
	name: string;
	description?: string;
	icon?: StandardSiteBlob;
}

export interface AtprotoBlogPost {
	uri: string;
	cid: string;
	rkey: string;
	slug: string;
	path: string;
	title: string;
	description: string;
	publishedAt: string;
	updatedAt?: string;
	tags: string[];
	body: string;
	bodyFormat: "markdown" | "plaintext";
	coverImageUrl?: string;
	bskyPostUri?: string;
}

export interface AtprotoBlogPublication {
	uri: string;
	name: string;
	url: string;
	description?: string;
}

export interface AtprotoBlogFeed {
	publication: AtprotoBlogPublication;
	posts: AtprotoBlogPost[];
	source: {
		repo: string;
		did: string;
		pds: string;
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
	return nonEmptyString(value) ? value.trim() : undefined;
}

function validDateTime(value: unknown): value is string {
	return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function atprotoRkey(uri: string): string | null {
	const match = /^at:\/\/[^/]+\/[^/]+\/([^/?#]+)$/.exec(uri);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function standardSiteSlug(path: string | undefined, rkey: string): string | null {
	if (!path) return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rkey) ? rkey : null;
	const match = /^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path.trim());
	return match?.[1] ?? null;
}

export function parseStandardSitePublication(value: unknown): StandardSitePublicationRecord | null {
	if (!isObject(value)) return null;
	if (value.$type !== STANDARD_SITE_PUBLICATION_COLLECTION) return null;
	if (!nonEmptyString(value.url) || !nonEmptyString(value.name)) return null;
	try {
		const url = new URL(value.url);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		return {
			$type: STANDARD_SITE_PUBLICATION_COLLECTION,
			url: url.toString().replace(/\/$/, ""),
			name: value.name.trim(),
			description: optionalString(value.description),
			icon: isObject(value.icon) ? (value.icon as StandardSiteBlob) : undefined,
		};
	} catch {
		return null;
	}
}

export function parseStandardSiteDocument(value: unknown): StandardSiteDocumentRecord | null {
	if (!isObject(value)) return null;
	if (value.$type !== STANDARD_SITE_DOCUMENT_COLLECTION) return null;
	if (!nonEmptyString(value.site) || !nonEmptyString(value.title) || !validDateTime(value.publishedAt)) {
		return null;
	}

	return {
		$type: STANDARD_SITE_DOCUMENT_COLLECTION,
		site: value.site.trim().replace(/\/$/, ""),
		title: value.title.trim(),
		publishedAt: value.publishedAt,
		path: optionalString(value.path),
		description: optionalString(value.description),
		coverImage: isObject(value.coverImage) ? (value.coverImage as StandardSiteBlob) : undefined,
		content: isObject(value.content) ? value.content : undefined,
		textContent: optionalString(value.textContent),
		tags: Array.isArray(value.tags) ? value.tags.filter(nonEmptyString).map((tag) => tag.trim()) : undefined,
		updatedAt: validDateTime(value.updatedAt) ? value.updatedAt : undefined,
		bskyPostRef: isObject(value.bskyPostRef)
			? {
					uri: optionalString(value.bskyPostRef.uri),
					cid: optionalString(value.bskyPostRef.cid),
				}
			: undefined,
	};
}

export function documentBody(record: StandardSiteDocumentRecord): {
	body: string;
	format: "markdown" | "plaintext";
} {
	if (isObject(record.content)) {
		if (record.content.$type === MARKPUB_MARKDOWN_TYPE && isObject(record.content.text)) {
			const markdown = optionalString(record.content.text.markdown);
			if (markdown) return { body: markdown, format: "markdown" };
		}

		// Early Standard.site adopters used this unregistered shape before the
		// Markpub lexicon stabilized. Reading it keeps those records portable.
		if (record.content.$type === "site.standard.content.markdown") {
			const markdown = optionalString(record.content.text);
			if (markdown) return { body: markdown, format: "markdown" };
		}
	}

	return { body: record.textContent ?? "", format: "plaintext" };
}

export function blobCid(blob: StandardSiteBlob | undefined): string | null {
	const cid = blob?.ref?.$link;
	return nonEmptyString(cid) ? cid : null;
}

export function blueskyPostUrl(uri: string | undefined): string | null {
	if (!uri) return null;
	const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(uri);
	return match ? `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}` : null;
}

export function plainTextFromMarkdown(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ""))
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/[>*_~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function stableBlogSlug(title: string): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120)
		.replace(/-+$/g, "");
	return slug || "post";
}
