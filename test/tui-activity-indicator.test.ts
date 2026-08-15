import { describe, expect, test } from "bun:test";

import { activityIndicatorText, formatElapsed, spinnerFrame } from "../src/tui/activity-indicator.js";

describe("TUI activity indicator", () => {
  test("names thinking, tool, and streaming response phases with elapsed time", () => {
    expect(activityIndicatorText({ phase: "thinking", elapsedMs: 1_200, frame: 0 })).toContain("Thinking…  ·  1s");
    expect(activityIndicatorText({ phase: "tool", detail: "read", elapsedMs: 61_000, frame: 1 })).toContain("Running read…  ·  1m01s");
    expect(activityIndicatorText({ phase: "responding", elapsedMs: 0, frame: 2, glyphMode: "ascii" })).toContain("Responding...  ·  0s");
  });

  test("uses deterministic reduced glyph sets", () => {
    expect(formatElapsed(3_599_000)).toBe("59m59s");
    expect(spinnerFrame(0, "ascii")).toBe("|");
    expect(spinnerFrame(4, "ascii")).toBe("|");
  });
});
