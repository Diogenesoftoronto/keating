/** Targeted and repository-wide mutation configuration contracts. */
import { expect, test } from "bun:test";
import { buildStrykerConfig } from "../scripts/ops/mutate.js";

const base = {
  mutate: ["src/core/**/*.ts"],
  mutator: { excludedMutations: ["ArithmeticOperator", "StringLiteral"] },
  commandRunner: { command: "bun test ./test/*.test.ts" },
  ignorePatterns: ["reports", "/web/dist"],
};

const options = {
  targets: ["packages/learner-contracts/src/diagram.ts"],
  tests: ["packages/learner-contracts/test/system-design.test.ts"],
  threshold: 60,
  directory: "/tmp/ops-mutation-config-test",
};

test("targeted mutation configs enable every mutator without changing the repository baseline", () => {
  const before = structuredClone(base);
  const config = buildStrykerConfig(base, options);
  expect(config.mutator?.excludedMutations).toBeUndefined();
  expect(config.mutate).toEqual(options.targets);
  expect(config.commandRunner?.command).toBe(
    "bun test './packages/learner-contracts/test/system-design.test.ts'",
  );
  expect(base).toEqual(before);
});

test("repository-wide mutation configs preserve their configured operator exclusions and tests", () => {
  const config = buildStrykerConfig(base, { ...options, targets: [], tests: [] });
  expect(config.mutator?.excludedMutations).toEqual(base.mutator.excludedMutations);
  expect(config.mutate).toEqual(base.mutate);
  expect(config.commandRunner).toEqual(base.commandRunner);
});
