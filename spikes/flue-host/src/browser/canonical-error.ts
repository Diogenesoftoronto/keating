/** Only Flue's canonical invariant metadata; never serialize error objects or records. */
export function canonicalInvariantMetadata(error: unknown): { operation?: string; path?: string; reason?: string } | null {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object" || seen.has(current)) return null;
    seen.add(current);
    const value = current as { type?: unknown; meta?: unknown; cause?: unknown };
    if (value.type === "conversation_record_invariant" || value.type === "conversation_stream_store_failure") {
      if (!value.meta || typeof value.meta !== "object") return null;
      const meta = value.meta as Record<string, unknown>;
      const result: { operation?: string; path?: string; reason?: string } = {};
      for (const key of ["operation", "path", "reason"] as const) {
        if (typeof meta[key] === "string") result[key] = meta[key].replace(/[\r\n\t]/g, " ").slice(0, key === "reason" ? 512 : 160);
      }
      return Object.keys(result).length ? result : null;
    }
    current = value.cause;
  }
  return null;
}
