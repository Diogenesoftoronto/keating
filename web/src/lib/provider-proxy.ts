import type { Api, Model } from "@earendil-works/pi-ai";

const PROXY_PATH = "/api/chat-proxy";

const DIRECT_HOST_SUFFIXES = [
	"api.openai.com",
	"generativelanguage.googleapis.com",
	"api.groq.com",
	"api.x.ai",
	"api.mistral.ai",
	"huggingface.co",
	"api.cerebras.ai",
	"amazonaws.com",
	"azure.com",
	"github.com",
	"openrouter.ai",
];

function currentOrigin(): string {
	return globalThis.location?.origin ?? "";
}

function hostnameMatches(hostname: string, suffix: string): boolean {
	return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function isLocalHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseUrl(value: string): URL | null {
	try {
		return new URL(value, currentOrigin() || "http://localhost");
	} catch {
		return null;
	}
}

export function chatProxyBaseUrl(): string {
	const origin = currentOrigin();
	return origin ? `${origin}${PROXY_PATH}` : PROXY_PATH;
}

export function proxyTargetHeader(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

export function shouldProxyModel(model: Model<Api>): boolean {
	if (!model.baseUrl || model.provider === "browser") return false;
	if (model.provider === "dio") return false;
	if (model.provider === "anthropic" || model.api === "anthropic-messages") return true;

	const url = parseUrl(model.baseUrl);
	if (!url) return true;

	if (url.origin === currentOrigin() && url.pathname.startsWith(PROXY_PATH)) return false;
	if (isLocalHost(url.hostname)) return true;

	return !DIRECT_HOST_SUFFIXES.some((suffix) => hostnameMatches(url.hostname, suffix));
}

export function proxiedProviderRequestUrl(targetUrl: string): { url: string; targetBaseUrl: string } {
	const parsed = new URL(targetUrl);
	return {
		url: `${chatProxyBaseUrl()}${parsed.pathname}${parsed.search}`,
		targetBaseUrl: parsed.origin,
	};
}
