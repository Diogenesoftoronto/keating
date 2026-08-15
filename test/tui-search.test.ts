import { describe, expect, test } from "bun:test";
import { filterSearchOptions, searchTranscript } from "../src/tui/search.js";

describe("TUI search primitives", () => {
  test("filters selector options by label and description", () => {
    const results = filterSearchOptions([
      { label: "Sessions", description: "Resume a saved branch" },
      { label: "Courses", description: "Continue a lesson" },
    ], "lesson");
    expect(results.map((result) => result.label)).toEqual(["Courses"]);
  });

  test("returns transcript matches with a useful excerpt", () => {
    const results = searchTranscript([
      { id: "a", kind: "assistant", title: "Keating", body: "Limits describe approach.", },
      { id: "b", kind: "notice", title: "Settings", body: "Provider is ready.", },
    ], "limits");
    expect(results).toHaveLength(1);
    expect(results[0]?.entry.id).toBe("a");
    expect(results[0]?.excerpt).toContain("Limits");
  });
});
