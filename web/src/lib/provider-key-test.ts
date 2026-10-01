import { proxiedProviderRequestUrl } from "./provider-proxy";

export type KeyTestResult =
	| { status: "ok"; detail?: string }
	| { status: "invalid"; detail: string }
	| { status: "error"; detail: string }
	| { status: "unsupported"; detail: string };

export interface KeyTestTarget {
	provider: string;
	api: string;
	baseUrl: string;
}

interface ProbeRequest {
	url: string;
	headers: Record<string, string>;
}

/**
 * Build the cheapest authenticated, read-only request (list models) for a
 * provider, or null when the API shape has no such probe we can trust.
 */
export function buildKeyProbe(target: KeyTestTarget, key: string): ProbeRequest | null {
	const base = target.baseUrl.replace(/\/+$/, "");
	if (!base || /[{}]/.test(base)) return null;
	switch (target.api) {
		case "openai-completions":
		case "openai-responses":
			return { url: `${base}/models`, headers: { Authorization: `Bearer ${key}` } };
		case "mistral-conversations":
			return { url: `${base}/v1/models`, headers: { Authorization: `Bearer ${key}` } };
		case "google-generative-ai":
			return { url: `${base}/models?key=${encodeURIComponent(key)}`, headers: {} };
		case "anthropic-messages":
			if (target.provider !== "anthropic") return null;
			return {
				url: `${base}/v1/models`,
				headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
			};
		default:
			return null;
	}
}

export function interpretProbeStatus(status: number): KeyTestResult {
	if (status >= 200 && status < 300) return { status: "ok" };
	if (status === 401 || status === 403) return { status: "invalid", detail: "The provider rejected this key." };
	// The key was accepted; the account is just throttled right now.
	if (status === 429) return { status: "ok", detail: "Key accepted (provider is rate limiting)." };
	return { status: "error", detail: `The provider answered with HTTP ${status}.` };
}

export async function testProviderKey(
	target: KeyTestTarget,
	key: string,
	options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<KeyTestResult> {
	const trimmed = key.trim();
	if (!trimmed) return { status: "error", detail: "Enter a key first." };
	const probe = buildKeyProbe(target, trimmed);
	if (!probe) return { status: "unsupported", detail: "This provider can't be checked automatically; send a message to try it." };
	const proxied = proxiedProviderRequestUrl(probe.url);
	try {
		const response = await (options.fetchImpl ?? fetch)(proxied.url, {
			method: "GET",
			headers: { ...probe.headers, "x-target-url": proxied.targetBaseUrl },
			signal: options.signal,
		});
		return interpretProbeStatus(response.status);
	} catch (error) {
		if (options.signal?.aborted) throw error;
		return { status: "error", detail: "Couldn't reach the provider. Check your connection and try again." };
	}
}
