import type { ContentTrust, ToolProvenance } from "./types";

export function combineContentTrust(values: readonly ContentTrust[]): ContentTrust {
	if (values.length === 0) return "unknown";
	const distinct = new Set(values);
	if (distinct.size === 1) return values[0] ?? "unknown";
	if (distinct.has("untrusted-web") || distinct.has("mixed")) return "mixed";
	return distinct.has("unknown") ? "unknown" : "mixed";
}

export function provenanceFromWeb(sourceIds: readonly string[] = []): ToolProvenance {
	return { trust: "untrusted-web", sourceIds, userAuthorized: false };
}

export function isUntrustedProvenance(provenance: ToolProvenance): boolean {
	return provenance.trust === "untrusted-web" || provenance.trust === "mixed";
}

/** Web content can supply data, but can never itself grant permission to act. */
export function hasIndependentUserAuthorization(provenance: ToolProvenance): boolean {
	return provenance.userAuthorized === true;
}
