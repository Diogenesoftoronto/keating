// Root-runtime bridge: tsc emits shared contracts under dist/packages so the
// standalone Node CLI does not depend on an unpublished workspace package.
export * from "../../packages/learner-contracts/src/index.js";
