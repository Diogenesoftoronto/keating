/** Stable related-record identities shared by native migration and reconciliation. */
export function stableRelatedId(prefix: string, ...parts: string[]): string {
  const raw = `${prefix}.${parts.join(".")}`;
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw)) return raw;
  let hash = 0x811c9dc5;
  for (const character of raw) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(16).padStart(8, "0");
  const shortened = raw.slice(0, 118 - suffix.length).replace(/[^A-Za-z0-9._-]/g, "-");
  return `${shortened}.${suffix}`;
}

