import { describe, expect, test } from "bun:test";

import {
  activityIndicatorText,
  activityLoaderFrame,
  activityPhrase,
  formatElapsed,
  spinnerFrame,
} from "../src/tui/activity-indicator.js";

describe("TUI activity indicator", () => {
  test("names thinking, tool, and streaming response phases with elapsed time", () => {
    expect(activityIndicatorText({ phase: "thinking", elapsedMs: 1_200, frame: 0 })).toContain("Thinking — Turning the question over  ·  1s");
    expect(activityIndicatorText({ phase: "tool", detail: "read", elapsedMs: 61_000, frame: 1 })).toContain("Running read — Following the evidence  ·  1m01s");
    expect(activityIndicatorText({ phase: "responding", elapsedMs: 0, frame: 2, glyphMode: "ascii" })).toContain("Responding: Putting it into words  ·  0s");
  });

  test("uses deterministic and phase-specific reduced glyph sets", () => {
    expect(formatElapsed(3_599_000)).toBe("59m59s");
    expect(spinnerFrame(0, "ascii")).toBe("|");
    expect(spinnerFrame(4, "ascii")).toBe("|");
    expect(activityLoaderFrame("thinking", 0, "unicode")).toBe("◜");
    expect(activityLoaderFrame("tool", 2, "unicode")).toBe("▰▰▱");
    expect(activityLoaderFrame("responding", 2, "ascii")).toBe("  >");
    expect(new Set([
      activityLoaderFrame("thinking", 0),
      activityLoaderFrame("tool", 0),
      activityLoaderFrame("responding", 0),
    ]).size).toBe(3);
  });

  test("rotates phrases on a slow, stable cadence", () => {
    expect(activityPhrase("thinking", 4_499)).toBe("Turning the question over");
    expect(activityPhrase("thinking", 4_500)).toBe("Looking for the hinge");
    expect(activityPhrase("thinking", 13_500)).toBe("Turning the question over");
  });
});
