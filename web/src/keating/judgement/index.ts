/**
 * Web judgement transport.
 *
 * Transport only. Questions, projections, thresholds, and the router are pure
 * and live in `@keating/learner-contracts`, so web and mobile share one
 * definition and only the wire differs.
 */
export * from "./transport";
