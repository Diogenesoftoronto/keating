import { describe, expect, test } from "bun:test";

import { shellHandoffArgs } from "../src/tui/shell-handoff.js";

describe("OpenTUI classic Pi handoff", () => {
  test("reopens the exact active Pi session", () => {
    expect(shellHandoffArgs({ action: "shell", sessionPath: "/project/.keating/sessions/active.jsonl" })).toEqual([
      "--session",
      "/project/.keating/sessions/active.jsonl",
    ]);
  });

  test("does not invent context when no session exists", () => {
    expect(shellHandoffArgs({ action: "shell" })).toEqual([]);
    expect(shellHandoffArgs({ action: "exit" })).toEqual([]);
  });
});
