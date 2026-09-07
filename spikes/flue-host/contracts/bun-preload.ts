import { plugin } from "bun";
// Run the upstream suites unchanged on this repository's test runtime.
plugin({ name: "upstream-test-runtime", setup(builder) {
  builder.onResolve({ filter: /^vitest$/ }, () => ({ path: "bun:test", external: true }));
} });
