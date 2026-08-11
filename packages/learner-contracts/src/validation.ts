/** Small runtime guards shared by all dependency-free contract boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A versioned portable shape is closed: unknown fields must never cross a boundary. */
export function hasOnlyKeys(value: unknown, allowedKeys: ReadonlySet<string>): boolean {
  return isRecord(value) && Reflect.ownKeys(value).every((key) =>
    typeof key === "string" && allowedKeys.has(key));
}

export function isContractId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

export function isBoundedString(value: unknown, maximumLength: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maximumLength && (allowEmpty || value.trim().length > 0);
}

export function isBoundedArray(value: unknown, maximumItems: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maximumItems;
}

export function isContractTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  return parsed.toISOString() === canonical;
}

/** Chronological comparison that remains correct across optional millisecond precision. */
export function compareContractTimestamps(left: string, right: string): number {
  const difference = Date.parse(left) - Date.parse(right);
  return difference === 0 ? 0 : difference < 0 ? -1 : 1;
}

export function hasUniqueIds(entries: ReadonlyArray<{ id: string }>): boolean {
  return new Set(entries.map((entry) => entry.id)).size === entries.length;
}

export function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SECRET_KEY_PARTS = [
  "apikey", "apikeys", "accesstoken", "authtoken", "authorization", "bearertoken", "clientsecret", "cookie",
  "credential", "dpop", "idtoken", "password", "privatekey", "refreshtoken", "secret", "sessiontoken", "token",
  "assertion",
] as const;
const CREDENTIAL_LIKE_TEXT = [
  /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/i,
  /\b(?:Bearer|DPoP)\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  /\b(?:sk|pk|rk|ghp|github_pat|xox[bap])-?[A-Za-z0-9_-]{16,}\b/i,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

export function hasSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SECRET_KEY_PARTS.some((part) => normalized.includes(part));
}

/** Bounded JSON-only metadata with no credential-like material for portable boundaries. */
export function isBoundedJsonValue(
  value: unknown,
  options: { maximumDepth?: number; maximumItems?: number; maximumStringLength?: number } = {},
): boolean {
  const maximumDepth = options.maximumDepth ?? 8;
  const maximumItems = options.maximumItems ?? 128;
  const maximumStringLength = options.maximumStringLength ?? 16_384;
  const visit = (candidate: unknown, depth: number): boolean => {
    if (candidate === null || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") {
      return candidate.length <= maximumStringLength && !CREDENTIAL_LIKE_TEXT.some((pattern) => pattern.test(candidate));
    }
    if (depth >= maximumDepth) return false;
    if (Array.isArray(candidate)) return candidate.length <= maximumItems && candidate.every((entry) => visit(entry, depth + 1));
    if (!isRecord(candidate)) return false;
    const entries = Object.entries(candidate);
    return entries.length <= maximumItems
      && entries.every(([key, entry]) => key.length <= 128 && !hasSensitiveKey(key) && visit(entry, depth + 1));
  };
  return visit(value, 0);
}
