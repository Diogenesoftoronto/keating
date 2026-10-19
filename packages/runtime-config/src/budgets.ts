/** Public reservation ceilings in micro-USD, not prices or server authorization. */
export const SPENDING_LIMITS = {
  notorganicRequestMicrousd: 100_000,
  // Deployment policy intentionally reserves less than direct browser/CLI calls.
  notorganicServerRequestMicrousd: 50_000,
} as const;
