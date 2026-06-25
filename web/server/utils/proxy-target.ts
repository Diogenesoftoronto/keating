export interface ProxyTargetValidationOptions {
	allowHttp?: boolean;
	allowLocal?: boolean;
}

function normalizeHostname(hostname: string): string {
	return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseIPv4(hostname: string): number[] | null {
	const parts = hostname.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => {
		if (!/^\d+$/.test(part)) return Number.NaN;
		const value = Number(part);
		return value >= 0 && value <= 255 ? value : Number.NaN;
	});
	return octets.every(Number.isFinite) ? octets : null;
}

function isPrivateIPv4(octets: number[]): boolean {
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

function isPrivateIPv6(hostname: string): boolean {
	const host = normalizeHostname(hostname);
	if (!host.includes(":")) return false;
	if (host === "::" || host === "::1") return true;
	if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("fec0")) return true;
	if (host.startsWith("ff")) return true;
	const mappedIPv4 = host.match(/(?:::ffff:)?(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (mappedIPv4) {
		const octets = parseIPv4(mappedIPv4);
		return octets ? isPrivateIPv4(octets) : false;
	}
	return false;
}

export function isLocalOrPrivateHostname(hostname: string): boolean {
	const host = normalizeHostname(hostname);
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".lan")
	) {
		return true;
	}
	const ipv4 = parseIPv4(host);
	if (ipv4) return isPrivateIPv4(ipv4);
	return isPrivateIPv6(host);
}

export function validateProxyTargetBaseUrl(
	value: string,
	options: ProxyTargetValidationOptions = {},
): URL {
	const raw = value.trim();
	if (!raw) throw new Error("Missing x-target-url header");

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error("Invalid x-target-url header");
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("Proxy target must use http or https");
	}
	if (parsed.protocol === "http:" && !options.allowHttp) {
		throw new Error("Proxy target must use https");
	}
	if (parsed.username || parsed.password) {
		throw new Error("Proxy target credentials are not allowed");
	}
	if (parsed.search || parsed.hash) {
		throw new Error("Proxy target must be a base URL without query or fragment");
	}
	if (!parsed.hostname) {
		throw new Error("Proxy target hostname is required");
	}
	if (!options.allowLocal && isLocalOrPrivateHostname(parsed.hostname)) {
		throw new Error("Proxy target cannot be local or private");
	}

	return parsed;
}

export function buildValidatedProxyUrl(
	targetBaseUrl: string,
	proxyPath: string,
	options: ProxyTargetValidationOptions = {},
): string {
	const base = validateProxyTargetBaseUrl(targetBaseUrl, options);
	const baseHref = base.href.replace(/\/+$/, "");
	const relativePath = proxyPath.replace(/^\/+/, "");
	return new URL(`${baseHref}/${relativePath}`).toString();
}
