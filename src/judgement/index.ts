/**
 * The CLI judgement surface: transport, calibration assembly, and the
 * per-experiment backend pin.
 *
 * Every question/answer type and every pure projection lives in
 * `packages/learner-contracts/src/judgement/`, which reaches web and mobile from
 * the same file. Only the parts that differ per surface live here.
 */
export * from "./calibration.js";
export * from "./experiment.js";
export * from "./transport.js";
