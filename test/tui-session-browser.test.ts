import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { sessionsDir } from "../src/core/paths.js";

import {
  SESSION_ACTIONS,
  forkMessageOption,
  listProjectTuiSessions,
  sessionOption,
  tuiSessionItems,
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
});
