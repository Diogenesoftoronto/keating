import type { AtprotoBlogFeed } from "../keating/standard-site";

let cachedFeed: AtprotoBlogFeed | null = null;
let pendingFeed: Promise<AtprotoBlogFeed> | null = null;

export class BlogApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
		this.name = "BlogApiError";
	}
}

function isBlogFeed(value: unknown): value is AtprotoBlogFeed {
	if (!value || typeof value !== "object") return false;
	const feed = value as Partial<AtprotoBlogFeed>;
	return Boolean(
		feed.publication
		&& typeof feed.publication.name === "string"
		&& typeof feed.publication.uri === "string"
		&& Array.isArray(feed.posts)
		&& feed.source
		&& typeof feed.source.did === "string",
	);
}

async function requestBlogFeed(signal?: AbortSignal): Promise<AtprotoBlogFeed> {
	const response = await fetch("/api/blog", { headers: { accept: "application/json" }, signal });
	const payload = await response.json().catch(() => null) as {
		statusMessage?: string;
		message?: string;
	} | null;
	if (!response.ok) {
		throw new BlogApiError(
			payload?.statusMessage ?? payload?.message ?? "The AT Protocol blog is unavailable.",
			response.status,
		);
	}
	if (!isBlogFeed(payload)) {
		throw new BlogApiError("The AT Protocol blog returned an invalid response.", 502);
	}
	return payload;
}

export function loadBlogFeed(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<AtprotoBlogFeed> {
	if (!options.force && cachedFeed) return Promise.resolve(cachedFeed);
	if (!options.force && pendingFeed) return pendingFeed;
	const request = requestBlogFeed(options.signal).then((feed) => {
		cachedFeed = feed;
		return feed;
	});
	pendingFeed = request;
	return request.finally(() => {
		if (pendingFeed === request) pendingFeed = null;
	});
}

export function clearBlogFeedCache(): void {
	cachedFeed = null;
}
