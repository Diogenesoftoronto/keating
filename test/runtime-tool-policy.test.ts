import { describe, expect, test } from "bun:test";

import {
  CLASSIC_PI_TOOL_POLICY,
  OPEN_TUI_TOOL_POLICY,
  runtimeToolList,
} from "../src/runtime/tool-policy.js";

describe("surface-specific Pi tool policy", () => {
  test("keeps OpenTUI read-only until it has a confirmed mutation protocol", () => {
    expect(runtimeToolList(OPEN_TUI_TOOL_POLICY)).toBe("read,grep,find,ls");
    expect(OPEN_TUI_TOOL_POLICY).toMatchObject({
      read: true,
      execute: false,
      sourceMutation: false,
      recovery: "shell-handoff",
    });
    expect(OPEN_TUI_TOOL_POLICY.tools).not.toContain("bash");
    expect(OPEN_TUI_TOOL_POLICY.tools).not.toContain("edit");
    expect(OPEN_TUI_TOOL_POLICY.tools).not.toContain("write");
  });

  test("retains full code tools on the exact-session classic Pi handoff", () => {
    expect(CLASSIC_PI_TOOL_POLICY).toMatchObject({ read: true, execute: true, sourceMutation: true });
    expect(CLASSIC_PI_TOOL_POLICY.tools).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
  });
});
