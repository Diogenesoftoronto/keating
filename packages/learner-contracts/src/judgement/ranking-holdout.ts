/** Authored item-level control allocation, not a calibrated model judgement. */
export const RANKING_HOLDOUT_POLICY_VERSION = "stable-item-v1" as const;

export interface RankingHoldoutAssignment {
  readonly policyVersion: typeof RANKING_HOLDOUT_POLICY_VERSION;
  readonly bucket: number;
  readonly heldOut: boolean;
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    // TextEncoder replaces unpaired surrogates, which would alias distinct keys.
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

/** Stable population allocation independent of list order, size, query or model.
 * JSON tuple encoding keeps namespace/key boundaries unambiguous; identities
 * are neither trimmed nor Unicode-normalized. FNV-1a is explicitly unsigned
 * 32-bit over UTF-8 bytes on every platform. This is not a cryptographic hash
 * or a promise of an exact quota in any particular shortlist.
 */
export function rankingHoldoutAssignment(namespace: string, itemKey: string, holdoutBasisPoints: number): RankingHoldoutAssignment {
  if (!validIdentity(namespace) || !validIdentity(itemKey)) throw new TypeError("Ranking holdout identities must be nonblank, well-formed Unicode strings");
  if (!Number.isInteger(holdoutBasisPoints) || holdoutBasisPoints < 0 || holdoutBasisPoints > 10_000) throw new RangeError("Ranking holdout basis points must be an integer from 0 to 10000");
  const identity = new TextEncoder().encode(JSON.stringify([RANKING_HOLDOUT_POLICY_VERSION, namespace, itemKey]));
  let hash = 2_166_136_261;
  for (const byte of identity) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0;
  const bucket = hash % 10_000;
  return Object.freeze({ policyVersion: RANKING_HOLDOUT_POLICY_VERSION, bucket, heldOut: bucket < holdoutBasisPoints });
}
