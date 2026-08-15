import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  commandSuggestions,
  composerReferenceErrors,
  parseComposerInput,
  resolveComposerInput,
} from "../src/tui/composer.js";

describe("TUI composer grammar", () => {
  test("distinguishes prompts, slash commands, and explicit shell mode", () => {
    expect(parseComposerInput("Explain limits").mode).toBe("prompt");
    expect(parseComposerInput("/courses").commandName).toBe("courses");
    expect(parseComposerInput("! git status")).toMatchObject({ mode: "shell", shellCommand: "git status" });
  });

  test("ranks slash completions without requiring an exact prefix", () => {
    const suggestions = commandSuggestions("/set", [{ name: "sessions" }, { name: "settings" }, { name: "courses" }]);
    expect(suggestions[0]?.name).toBe("settings");
  });

  test("expands bounded text references and preserves failures", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-composer-"));
    await mkdir(join(cwd, "notes"));
    await writeFile(join(cwd, "notes", "limits.md"), "# Limits\n\nA limit describes approach.", "utf8");
    const resolved = await resolveComposerInput(parseComposerInput("Explain @notes/limits.md"), cwd);
    expect(resolved.prompt).toContain("<file path=\"notes/limits.md\">");
    expect(resolved.prompt).toContain("A limit describes approach.");
    expect(composerReferenceErrors(resolved)).toEqual([]);

    const missing = await resolveComposerInput(parseComposerInput("Explain @missing.md"), cwd);
    expect(composerReferenceErrors(missing)).toHaveLength(1);
    expect(missing.prompt).toBe("Explain @missing.md");
  });
});
