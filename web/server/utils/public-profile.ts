/**
 * Loads a learner's published profile from their own PDS for the public page.
 *
 * Trust boundary: the DID comes from a URL anyone can type, and it decides
 * which hosts this server contacts. Every outbound address is therefore
 * derived from the DID alone, must be public HTTPS (no private, loopback or
 * link-local host), redirects are refused, and responses are size-bounded.
 * The record is re-validated with the same contract the editor publishes
 * with, so a hand-written PDS record cannot reach visitors with anything the
 * editor could not have produced.
 */
import { isLocalOrPrivateHostname } from "./proxy-target";
import {
	LEARNING_PROFILE_COLLECTION,
	isProfileDid,
	readPublicProfile,
	type FullLearningProfile,
} from "../../src/keating/public-profile-contract";

const PLC_DIRECTORY = "https://plc.directory";
const FETCH_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 96_000;
const FOUND_TTL_MS = 60_000;
const MISSING_TTL_MS = 20_000;
const MAX_CACHE_ENTRIES = 500;

export type PublicProfileResult =
	| { status: "public"; did: string; handle?: string; profile: FullLearningProfile }
	| { status: "not_public"; did: string }
	| { status: "hidden"; did: string };

export class PublicProfileError extends Error {
	constructor(message: string, readonly code: "invalid_did" | "unresolvable" | "upstream_unavailable" | "invalid_data") {
		super(message);
		this.name = "PublicProfileError";
	}
}

export type ProfileFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Public HTTPS only. The DID picks the host, so a private address must never be reachable through it. */
export function publicHttpsOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new PublicProfileError("The identity points to an invalid address.", "invalid_data");
	}
	if (url.protocol !== "https:" || url.username || url.password || isLocalOrPrivateHostname(url.hostname)) {
		throw new PublicProfileError("The identity points to an address Keating will not contact.", "invalid_data");
	}
	return url.origin;
}

function didWebDocumentUrl(did: string): string {
	const segments = did.slice("did:web:".length).split(":").map((segment) => decodeURIComponent(segment));
	const host = segments[0] ?? "";
	// A did:web host may carry a port as %3A; reject anything that is not a plain hostname.
	if (!/^[a-zA-Z0-9.-]+$/u.test(host) || segments.slice(1).some((segment) => !/^[a-zA-Z0-9._-]+$/u.test(segment))) {
		throw new PublicProfileError("This did:web identity is not supported.", "invalid_did");
	}
	const origin = publicHttpsOrigin(`https://${host}`);
	return segments.length > 1 ? `${origin}/${segments.slice(1).join("/")}/did.json` : `${origin}/.well-known/did.json`;
}

async function boundedJson(url: string, fetcher: ProfileFetch): Promise<{ status: number; body: unknown }> {
	let response: Response;
	try {
		response = await fetcher(url, {
			headers: { accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch {
		throw new PublicProfileError("The learner's data server could not be reached.", "upstream_unavailable");
	}
	const declared = Number(response.headers.get("content-length") ?? "0");
	if (declared > MAX_RESPONSE_BYTES) throw new PublicProfileError("The learner's data server sent too much data.", "invalid_data");
	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new PublicProfileError("The learner's data server could not be read.", "upstream_unavailable");
	}
	if (text.length > MAX_RESPONSE_BYTES) throw new PublicProfileError("The learner's data server sent too much data.", "invalid_data");
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		if (response.ok) throw new PublicProfileError("The learner's data server sent unreadable data.", "invalid_data");
	}
	return { status: response.status, body };
}

interface DidDocument {
	id?: unknown;
	alsoKnownAs?: unknown;
	service?: unknown;
}

function pdsFrom(document: DidDocument, did: string): { pds: string; handle?: string } {
	if (document.id !== did) throw new PublicProfileError("The identity document does not match this profile.", "invalid_data");
	const services = Array.isArray(document.service) ? document.service as Array<Record<string, unknown>> : [];
	const service = services.find((entry) => entry && typeof entry === "object"
		&& (typeof entry.id === "string" && entry.id.endsWith("#atproto_pds") || entry.type === "AtprotoPersonalDataServer"));
	if (typeof service?.serviceEndpoint !== "string") throw new PublicProfileError("This identity has no data server.", "unresolvable");
	const aliases = Array.isArray(document.alsoKnownAs) ? document.alsoKnownAs : [];
	const handle = aliases
		.filter((alias): alias is string => typeof alias === "string" && alias.startsWith("at://"))
		.map((alias) => alias.slice(5))
		.find((alias) => /^[a-zA-Z0-9.-]{3,253}$/u.test(alias));
	return { pds: publicHttpsOrigin(service.serviceEndpoint), ...(handle ? { handle } : {}) };
}

async function resolvePds(did: string, fetcher: ProfileFetch): Promise<{ pds: string; handle?: string }> {
	const url = did.startsWith("did:plc:") ? `${PLC_DIRECTORY}/${encodeURIComponent(did)}` : didWebDocumentUrl(did);
	const { status, body } = await boundedJson(url, fetcher);
	if (status === 404) throw new PublicProfileError("This identity does not exist.", "unresolvable");
	if (status < 200 || status >= 300 || !body || typeof body !== "object") {
		throw new PublicProfileError("The identity could not be resolved.", "upstream_unavailable");
	}
	return pdsFrom(body as DidDocument, did);
}

const cache = new Map<string, { expiresAt: number; result: PublicProfileResult }>();

export function clearPublicProfileCache(): void {
	cache.clear();
}

/**
 * `not_public` covers both "never published" and "withdrawn": a visitor learns
 * nothing about which. Upstream failures throw so they are never shown as
 * "this learner has no profile".
 */
export async function loadPublicProfile(
	didInput: string,
	options: { fetcher?: ProfileFetch; now?: () => number; isHidden?: (did: string) => Promise<boolean> } = {},
): Promise<PublicProfileResult> {
	if (!isProfileDid(didInput)) throw new PublicProfileError("That is not a valid learner identity.", "invalid_did");
	const did = didInput;
	const now = options.now ?? Date.now;
	if (await options.isHidden?.(did)) return { status: "hidden", did };

	const cached = cache.get(did);
	if (cached && cached.expiresAt > now()) return cached.result;

	const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
	const { pds, handle } = await resolvePds(did, fetcher);
	const query = new URLSearchParams({ repo: did, collection: LEARNING_PROFILE_COLLECTION, rkey: "self" });
	const { status, body } = await boundedJson(`${pds}/xrpc/com.atproto.repo.getRecord?${query}`, fetcher);
	const envelope = (body && typeof body === "object" ? body : {}) as { error?: unknown; value?: unknown; uri?: unknown };

	let result: PublicProfileResult;
	if ((status === 400 || status === 404) && envelope.error === "RecordNotFound") {
		result = { status: "not_public", did };
	} else if (status < 200 || status >= 300) {
		throw new PublicProfileError("The learner's data server returned an error.", "upstream_unavailable");
	} else if (envelope.uri !== `at://${did}/${LEARNING_PROFILE_COLLECTION}/self`) {
		throw new PublicProfileError("The learner's data server returned a different record.", "invalid_data");
	} else if ((envelope.value as { visibility?: unknown } | undefined)?.visibility === "private") {
		result = { status: "not_public", did };
	} else {
		let profile: FullLearningProfile;
		try {
			profile = readPublicProfile(envelope.value);
		} catch {
			throw new PublicProfileError("This profile is in a format Keating cannot display.", "invalid_data");
		}
		result = { status: "public", did, ...(handle ? { handle } : {}), profile };
	}

	if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
	cache.set(did, { expiresAt: now() + (result.status === "public" ? FOUND_TTL_MS : MISSING_TTL_MS), result });
	return result;
}
