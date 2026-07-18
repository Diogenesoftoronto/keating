const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|session|token)/i;
const SECRET_VALUE_PATTERNS = [
	/\bsk-[A-Za-z0-9_-]{12,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
	/\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g,
] as const;

export const REDACTED = "[REDACTED]";

export function redactString(value: string): string {
	return SECRET_VALUE_PATTERNS.reduce(
		(redacted, pattern) => redacted.replace(pattern, REDACTED),
		value,
	);
}

export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
	if (typeof value === "string") return redactString(value);
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[CIRCULAR]";
	seen.add(value);

	if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));

	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(item, seen);
	}
	return output;
}

export function containsLikelySecret(value: unknown): boolean {
	if (typeof value === "string") {
		return SECRET_VALUE_PATTERNS.some((pattern) => {
			pattern.lastIndex = 0;
			return pattern.test(value);
		});
	}
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(containsLikelySecret);
	return Object.entries(value as Record<string, unknown>).some(
		([key, item]) => SENSITIVE_KEY.test(key) || containsLikelySecret(item),
	);
}
