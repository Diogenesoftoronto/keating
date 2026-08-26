import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { sessionsDir } from "../src/core/paths.js";
import { sacredTextWidth } from "../src/tui/sacred.js";

import {
  SESSION_ACTIONS,
  forkMessageOption,
  listProjectTuiSessions,
  sessionOption,
  sessionTreeOption,
  tuiSessionItems,
  tuiSessionTreeRows,
  type TuiSessionInfo,
} from "../src/tui/session-browser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function session(overrides: Partial<TuiSessionInfo>): TuiSessionInfo {
  return {
    path: "/sessions/default.jsonl",
    id: "default",
    created: new Date("2026-08-10T10:00:00.000Z"),
    modified: new Date("2026-08-10T10:00:00.000Z"),
    messageCount: 1,
    firstMessage: "Untitled learning session",
    ...overrides,
  };
}

describe("OpenTUI session browser presentation", () => {
  test("lists the exact project-scoped Pi RPC session directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "keating-tui-project-sessions-"));
    temporaryDirectories.push(cwd);
    const manager = SessionManager.create(cwd, sessionsDir(cwd));
    manager.appendMessage({ role: "user", content: "Project-scoped turn", timestamp: Date.now() });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Project-scoped answer" }],
      api: "openai-completions",
      provider: "openai",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });

    const sessions = await listProjectTuiSessions(cwd);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ firstMessage: "Project-scoped turn", messageCount: 2 });
    expect(sessions[0]?.path.startsWith(sessionsDir(cwd))).toBe(true);
  });

  test("sorts recent sessions, marks the active session, and exposes lineage without path leakage", () => {
    const items = tuiSessionItems([
      session({ path: "/sessions/older.jsonl", id: "older", name: "Limits", modified: new Date("2026-08-10T10:00:00.000Z") }),
      session({
        path: "/sessions/fork.jsonl",
        id: "fork",
        firstMessage: "Explore the epsilon delta definition with a deliberately long prompt that must be compact",
        parentSessionPath: "/sessions/older.jsonl",
        messageCount: 4,
        modified: new Date("2026-08-11T09:30:00.000Z"),
      }),
    ], "/sessions/fork.jsonl");

    expect(items.map((item) => item.id)).toEqual(["fork", "older"]);
    expect(items[0]).toMatchObject({ active: true, title: "Explore the epsilon delta definition with a del…" });
    expect(sessionOption(items[0]!, 0, new Date("2026-08-11T10:00:00.000Z"))).toBe(
      "1. Explore the epsilon delta definition with a del… · ACTIVE · fork · 4 messages · 30m",
    );
    expect(sessionOption(items[1]!, 1, new Date("2026-08-11T10:00:00.000Z"))).toBe(
      "2. Limits · saved · 1 message · 1d",
    );
  });

  test("keeps session and turn-fork actions explicit and terminal-bounded", () => {
    expect(SESSION_ACTIONS).toEqual([
      "Resume session",
      "Resume and rename",
      "Fork whole current branch",
      "Fork from an earlier turn",
      "Cancel",
    ]);
    expect(forkMessageOption({ entryId: "entry-secret", text: "  Compare   the two approaches\ncarefully  " }, 2)).toBe(
      "3. Compare the two approaches carefully",
    );
  });

  test("threads nested forks by subtree activity and keeps opaque paths out of labels", () => {
    const now = new Date("2026-08-11T10:00:00.000Z");
    const rows = tuiSessionTreeRows([
      session({ path: "/sessions/root.jsonl", id: "root", name: "Limits", modified: new Date("2026-08-09T10:00:00.000Z") }),
      session({ path: "/sessions/child.jsonl", id: "child", name: "Formal proof", parentSessionPath: "/sessions/root.jsonl", modified: new Date("2026-08-10T10:00:00.000Z") }),
      session({ path: "/sessions/grandchild.jsonl", id: "grandchild", name: "Counterexample", parentSessionPath: "/sessions/child.jsonl", modified: new Date("2026-08-11T09:00:00.000Z") }),
      session({ path: "/sessions/recent-root.jsonl", id: "recent-root", name: "Topology", modified: new Date("2026-08-11T08:00:00.000Z") }),
    ], "/sessions/grandchild.jsonl");

    expect(rows.map((row) => [row.item.id, row.depth, row.hasChildren])).toEqual([
      ["root", 0, true],
      ["child", 1, true],
      ["grandchild", 2, false],
      ["recent-root", 0, false],
    ]);
    const labels = rows.map((row) => sessionTreeOption(row, now, "unicode", 64));
    expect(labels[0]).toContain("├───╦ Limits");
    expect(labels[1]).toContain("└───╦ Formal proof");
    expect(labels[2]).toContain("└───  Counterexample");
    expect(labels[2]).toContain("[ACTIVE] [FORK]");
    expect(labels.join("\n")).not.toContain("/sessions/");
  });

  test("keeps orphaned and cyclic sessions selectable roots with an ASCII fallback", () => {
    const rows = tuiSessionTreeRows([
      session({ path: "/sessions/orphan.jsonl", id: "orphan", name: "Orphan", parentSessionPath: "/sessions/missing.jsonl" }),
      session({ path: "/sessions/a.jsonl", id: "a", name: "Cycle A", parentSessionPath: "/sessions/b.jsonl" }),
      session({ path: "/sessions/b.jsonl", id: "b", name: "Cycle B", parentSessionPath: "/sessions/a.jsonl" }),
    ]);

    expect(new Set(rows.map((row) => row.item.id))).toEqual(new Set(["orphan", "a", "b"]));
    expect(rows.every((row) => row.depth === 0)).toBe(true);
    const ascii = rows.map((row) => sessionTreeOption(row, new Date("2026-08-11T10:00:00.000Z"), "ascii", 40));
    expect(ascii.every((label) => sacredTextWidth(label) <= 40)).toBe(true);
    expect(ascii.every((label) => /^[\x20-\x7e]*$/.test(label))).toBe(true);
    expect(ascii.some((label) => label.startsWith("|---") || label.startsWith("`---"))).toBe(true);
  });

  test("sanitizes and terminal-bounds accent, CJK, emoji, and wide tree labels", () => {
    const now = new Date("2026-08-11T10:00:00.000Z");
    const wideName = `Élodie ${"界".repeat(28)} 👩‍💻 \u001b[31mhidden-color`;
    const [item] = tuiSessionItems([
      session({ path: "/sessions/wide.jsonl", id: "wide", name: wideName, modified: now }),
    ]);
    expect(item).toBeDefined();
    expect(sacredTextWidth(item!.title)).toBeLessThanOrEqual(48);
    expect(item!.title).not.toContain("\u001b");

    const [row] = tuiSessionTreeRows([item!], item!.path);
    expect(row).toBeDefined();
    for (let width = 0; width <= 64; width += 1) {
      const unicode = sessionTreeOption(row!, now, "unicode", width);
      const ascii = sessionTreeOption(row!, now, "ascii", width);
      expect(sacredTextWidth(unicode)).toBeLessThanOrEqual(width);
      expect(sacredTextWidth(ascii)).toBeLessThanOrEqual(width);
      expect(/^[\x20-\x7e]*$/.test(ascii)).toBe(true);
      expect(`${unicode}${ascii}`).not.toContain("\u001b");
    }

    const fork = forkMessageOption({
      entryId: "opaque-entry",
      text: `Résumé ${"界".repeat(40)} 👩‍💻 \u001b]8;;https://example.invalid\u0007link`,
    }, 11);
    expect(sacredTextWidth(fork)).toBeLessThanOrEqual(72);
    expect(fork).not.toContain("\u001b");
  });
});
