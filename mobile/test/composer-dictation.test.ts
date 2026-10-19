import { describe, expect, test } from "bun:test";
import { dictationScopeKey, mergeDictation } from "../src/lib/composer-dictation";

describe("mergeDictation", () => {
  const same = { startScope: "s1:0", currentScope: "s1:0" };
  test("appends to the current draft, not a stale one", () => {
    expect(mergeDictation("hello typed later", " world ", same)).toBe("hello typed later world");
  });
  test("uses transcript alone for an empty draft", () => {
    expect(mergeDictation("  ", "hi", same)).toBe("hi");
  });
  test("ignores empty transcripts", () => {
    expect(mergeDictation("keep", "   ", same)).toBe("keep");
  });
  test("drops the transcript after a send bumped the generation", () => {
    expect(mergeDictation("", "old words", { startScope: dictationScopeKey("s1", 0), currentScope: dictationScopeKey("s1", 1) })).toBeNull();
  });
  test("drops the transcript after a session switch", () => {
    expect(mergeDictation("", "old words", { startScope: dictationScopeKey("s1", 0), currentScope: dictationScopeKey("s2", 0) })).toBeNull();
  });
});
