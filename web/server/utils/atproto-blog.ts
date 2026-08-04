import {
	STANDARD_SITE_DOCUMENT_COLLECTION,
	STANDARD_SITE_PUBLICATION_COLLECTION,
	atprotoRkey,
	blobCid,
	documentBody,
	parseStandardSiteDocument,
	parseStandardSitePublication,
	standardSiteSlug,
	type AtprotoBlogFeed,
	type AtprotoBlogPost,
	type AtprotoRecordEnvelope,
} from "../../src/keating/standard-site";

const DEFAULT_CANONICAL_URL = "https://keating.help";
const DEFAULT_HANDLE_RESOLVER = "https://public.api.bsky.app";
const DEFAULT_PLC_DIRECTORY = "https://plc.directory";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RECORDS = 1_000;
const CACHE_TTL_MS = 60_000;

interface BlogEnvironment extends NodeJS.ProcessEnv {
	KEATING_BLOG_ATPROTO_REPO?: string;
	KEATING_BLOG_PUBLICATION_URI?: string;
	KEATING_BLOG_CANONICAL_URL?: string;
	KEATING_BLOG_PDS_URL?: string;
	KEATING_BLOG_HANDLE_RESOLVER?: string;
	KEATING_BLOG_PLC_DIRECTORY?: string;
}

export interface AtprotoBlogConfig {
	repo: string;
	publicationUri?: string;
	canonicalUrl: string;
	pdsOverride?: string;
	handleResolver: string;
	plcDirectory: string;
}

interface DidDocument {
	id?: string;
	service?: Array<{
		id?: string;
		type?: string | string[];
		serviceEndpoint?: string;
	}>;
}

interface ListRecordsResponse {
	cursor?: string;
	records?: AtprotoRecordEnvelope[];
}

interface ResolvedBlogSource {
	did: string;
	pds: string;
}

export class AtprotoBlogError extends Error {
	constructor(
		message: string,
		readonly code: "not_configured" | "not_found" | "upstream_unavailable" | "invalid_data",
	) {
		super(message);
		this.name = "AtprotoBlogError";
	}
}

let cachedFeed: { key: string; expiresAt: number; feed: AtprotoBlogFeed } | null = null;

function configuredString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeOrigin(value: string, label: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new AtprotoBlogError(`${label} is not a valid URL`, "invalid_data");
	}
	const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		throw new AtprotoBlogError(`${label} must use HTTPS`, "invalid_data");
	}
	return url.origin;
}

export function readAtprotoBlogConfig(env: BlogEnvironment = process.env): AtprotoBlogConfig {
	const repo = configuredString(env.KEATING_BLOG_ATPROTO_REPO);
	if (!repo) {
		throw new AtprotoBlogError(
			"The AT Protocol blog source is not configured",
			"not_configured",
		);
	}

	return {
		repo: repo.toLowerCase(),
		publicationUri: configuredString(env.KEATING_BLOG_PUBLICATION_URI),
		canonicalUrl: normalizeOrigin(
			configuredString(env.KEATING_BLOG_CANONICAL_URL) ?? DEFAULT_CANONICAL_URL,
			"KEATING_BLOG_CANONICAL_URL",
		),
		pdsOverride: configuredString(env.KEATING_BLOG_PDS_URL)
			? normalizeOrigin(env.KEATING_BLOG_PDS_URL!, "KEATING_BLOG_PDS_URL")
			: undefined,
		handleResolver: normalizeOrigin(
			configuredString(env.KEATING_BLOG_HANDLE_RESOLVER) ?? DEFAULT_HANDLE_RESOLVER,
			"KEATING_BLOG_HANDLE_RESOLVER",
		),
		plcDirectory: normalizeOrigin(
			configuredString(env.KEATING_BLOG_PLC_DIRECTORY) ?? DEFAULT_PLC_DIRECTORY,
			"KEATING_BLOG_PLC_DIRECTORY",
		),
	};
}

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
	let response: Response;
	try {
		response = await fetcher(url, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		throw new AtprotoBlogError("The AT Protocol blog source could not be reached", "upstream_unavailable");
	}
	if (!response.ok) {
		throw new AtprotoBlogError(
			response.status === 404
				? "The configured AT Protocol record was not found"
				: "The AT Protocol blog source returned an error",
			response.status === 404 ? "not_found" : "upstream_unavailable",
		);
	}
	try {
		return await response.json() as T;
	} catch {
		throw new AtprotoBlogError("The AT Protocol blog source returned invalid JSON", "invalid_data");
	}
}

async function resolveRepoDid(config: AtprotoBlogConfig, fetcher: typeof fetch): Promise<string> {
	if (config.repo.startsWith("did:")) return config.repo;
	const url = new URL("/xrpc/com.atproto.identity.resolveHandle", config.handleResolver);
	url.searchParams.set("handle", config.repo);
	const payload = await getJson<{ did?: string }>(url.toString(), fetcher);
	if (typeof payload.did !== "string" || !payload.did.startsWith("did:")) {
		throw new AtprotoBlogError("The configured blog handle did not resolve to a DID", "invalid_data");
	}
	return payload.did;
}

function didWebDocumentUrl(did: string): string {
	const segments = did.slice("did:web:".length).split(":").map((segment) => decodeURIComponent(segment));
	const hostname = segments.shift();
	if (!hostname || segments.some((segment) => !segment || segment === "." || segment === "..")) {
		throw new AtprotoBlogError("The configured did:web identifier is invalid", "invalid_data");
	}
	const path = segments.length > 0
		? `/${segments.map(encodeURIComponent).join("/")}/did.json`
		: "/.well-known/did.json";
	return `https://${hostname}${path}`;
}

async function resolveDidDocument(
	did: string,
	config: AtprotoBlogConfig,
	fetcher: typeof fetch,
): Promise<DidDocument> {
	if (did.startsWith("did:plc:")) {
		return getJson<DidDocument>(`${config.plcDirectory}/${encodeURIComponent(did)}`, fetcher);
	}
	if (did.startsWith("did:web:")) {
		return getJson<DidDocument>(didWebDocumentUrl(did), fetcher);
	}
	throw new AtprotoBlogError("The blog account uses an unsupported DID method", "invalid_data");
}

function isPdsServiceType(type: string | string[] | undefined): boolean {
	return Array.isArray(type)
		? type.includes("AtprotoPersonalDataServer")
		: type === "AtprotoPersonalDataServer";
}

export async function resolveAtprotoBlogSource(
	config: AtprotoBlogConfig,
	fetcher: typeof fetch = globalThis.fetch,
): Promise<ResolvedBlogSource> {
	const did = await resolveRepoDid(config, fetcher);
	if (config.pdsOverride) return { did, pds: config.pdsOverride };

	const document = await resolveDidDocument(did, config, fetcher);
	if (document.id && document.id !== did) {
		throw new AtprotoBlogError("The resolved DID document did not match the blog account", "invalid_data");
	}
	const service = document.service?.find((entry) =>
		entry.id?.endsWith("#atproto_pds") || isPdsServiceType(entry.type),
	);
	if (typeof service?.serviceEndpoint !== "string") {
		throw new AtprotoBlogError("The blog account DID does not declare a PDS", "invalid_data");
	}
	return { did, pds: normalizeOrigin(service.serviceEndpoint, "AT Protocol PDS endpoint") };
}

async function listRecords(
	pds: string,
	did: string,
	collection: string,
	fetcher: typeof fetch,
): Promise<AtprotoRecordEnvelope[]> {
	const records: AtprotoRecordEnvelope[] = [];
	let cursor: string | undefined;
	do {
		const url = new URL("/xrpc/com.atproto.repo.listRecords", pds);
		url.searchParams.set("repo", did);
		url.searchParams.set("collection", collection);
		url.searchParams.set("limit", "100");
		url.searchParams.set("reverse", "true");
		if (cursor) url.searchParams.set("cursor", cursor);
		const payload = await getJson<ListRecordsResponse>(url.toString(), fetcher);
		if (!Array.isArray(payload.records)) {
			throw new AtprotoBlogError("The PDS returned an invalid record list", "invalid_data");
		}
		records.push(...payload.records);
		cursor = configuredString(payload.cursor);
	} while (cursor && records.length < MAX_RECORDS);
	return records.slice(0, MAX_RECORDS);
}

function publicationFromRecords(
	records: AtprotoRecordEnvelope[],
	config: AtprotoBlogConfig,
): { envelope: AtprotoRecordEnvelope; value: NonNullable<ReturnType<typeof parseStandardSitePublication>> } {
	const publications = records.flatMap((envelope) => {
		const value = parseStandardSitePublication(envelope.value);
		return value ? [{ envelope, value }] : [];
	});
	const configured = config.publicationUri
		? publications.find(({ envelope }) => envelope.uri === config.publicationUri)
		: publications.find(({ value }) => value.url === config.canonicalUrl);
	const publication = configured ?? (publications.length === 1 ? publications[0] : undefined);
	if (!publication) {
		throw new AtprotoBlogError("The Keating Standard.site publication record was not found", "not_found");
	}
	return publication;
}

function postFromEnvelope(
	envelope: AtprotoRecordEnvelope,
	publicationUri: string,
	did: string,
	pds: string,
): AtprotoBlogPost | null {
	const record = parseStandardSiteDocument(envelope.value);
	const rkey = atprotoRkey(envelope.uri);
	if (!record || !rkey || record.site !== publicationUri) return null;
	const slug = standardSiteSlug(record.path, rkey);
	if (!slug) return null;
	const content = documentBody(record);
	const cid = blobCid(record.coverImage);
	const coverImageUrl = cid
		? `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
		: undefined;
	const description = record.description
		?? record.textContent?.replace(/\s+/g, " ").trim().slice(0, 280)
		?? "";

	return {
		uri: envelope.uri,
		cid: envelope.cid,
		rkey,
		slug,
		path: `/blog/${slug}`,
		title: record.title,
		description,
		publishedAt: record.publishedAt,
		updatedAt: record.updatedAt,
		tags: record.tags ?? [],
		body: content.body,
		bodyFormat: content.format,
		coverImageUrl,
		bskyPostUri: record.bskyPostRef?.uri,
	};
}

function cacheKey(config: AtprotoBlogConfig): string {
	return JSON.stringify(config);
}

export async function loadAtprotoBlogFeed(
	config: AtprotoBlogConfig = readAtprotoBlogConfig(),
	fetcher: typeof fetch = globalThis.fetch,
	now: number = Date.now(),
): Promise<AtprotoBlogFeed> {
	const key = cacheKey(config);
	if (fetcher === globalThis.fetch && cachedFeed?.key === key && cachedFeed.expiresAt > now) {
		return cachedFeed.feed;
	}

	const source = await resolveAtprotoBlogSource(config, fetcher);
	const [publicationRecords, documentRecords] = await Promise.all([
		listRecords(source.pds, source.did, STANDARD_SITE_PUBLICATION_COLLECTION, fetcher),
		listRecords(source.pds, source.did, STANDARD_SITE_DOCUMENT_COLLECTION, fetcher),
	]);
	const publication = publicationFromRecords(publicationRecords, config);
	const posts = documentRecords
		.map((envelope) => postFromEnvelope(envelope, publication.envelope.uri, source.did, source.pds))
		.filter((post): post is AtprotoBlogPost => post !== null)
		.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

	const feed: AtprotoBlogFeed = {
		publication: {
			uri: publication.envelope.uri,
			name: publication.value.name,
			url: publication.value.url,
			description: publication.value.description,
		},
		posts,
		source: { repo: config.repo, did: source.did, pds: source.pds },
	};
	if (fetcher === globalThis.fetch) cachedFeed = { key, expiresAt: now + CACHE_TTL_MS, feed };
	return feed;
}

export function clearAtprotoBlogCache(): void {
	cachedFeed = null;
}
