import { describe, expect, test } from "bun:test";

import { goalCardBodyLines, goalCardLines } from "../src/core/cards.js";

const goal = {
  title: "Learn limits",
  description: "Build intuition before formal proofs.",
  status: "active",
  steps: [
    { order: 0, title: "Explore graphs", kind: "lesson", status: "done" },
    { order: 1, title: "Prove a limit", kind: "exercise", status: "in_progress" },
  ],
};

describe("goal card rendering", () => {
  test("builds shared goal content with progress, next step, and glyphs", () => {
    expect(goalCardBodyLines(goal)).toEqual([
      "Build intuition before formal proofs.",
      "",
      "Progress: 50% (1/2)",
      "Status: active",
      "Next: Prove a limit",
      "",
      "[x] 1. Explore graphs (lesson)",
      "[~] 2. Prove a limit (exercise)",
    ]);
  });

  test("lets themed callers customize only the progress display", () => {
    expect(goalCardBodyLines(goal, (percent) => `[${percent}]`)).toContain("Progress: [50] (1/2)");
    expect(goalCardLines(goal)[1]).toContain("Goal: Learn limits");
  });
});
