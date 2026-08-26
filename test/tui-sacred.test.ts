import { describe, expect, test } from "bun:test";

import {
  flattenSacredTree,
  renderSacredActionBar,
  renderSacredActionButton,
  renderSacredAvatar,
  renderSacredBadge,
  renderSacredMessageHeader,
  renderSacredMessageViewerHeader,
  sacredFitText,
  sacredInitialsFor,
  sacredSanitizeText,
  sacredTextWidth,
  sacredTruncateText,
} from "../src/tui/sacred.js";

const ASCII_ONLY = /^[\x20-\x7e]*$/;

describe("Sacred terminal presentation", () => {
  test("sanitizes and truncates accents, CJK, and emoji by terminal cells", () => {
    expect(sacredTextWidth("e\u0301")).toBe(1);
    expect(sacredTextWidth("界")).toBe(2);
    expect(sacredTextWidth("👩‍💻")).toBe(2);
    expect(sacredTextWidth("©️")).toBe(2);
    expect(sacredSanitizeText("\u001b[31m  Élo\u202edie\n界👩‍💻  \u001b[0m")).toBe("Élodie 界👩‍💻");
    expect(sacredTruncateText("Élodie界👩‍💻", 9)).toBe("Élodie界…");
    expect(sacredTextWidth(sacredFitText("界👩‍💻", 7))).toBe(7);
    expect(ASCII_ONLY.test(sacredTruncateText("Élodie 界 👩‍💻", 10, "ascii"))).toBe(true);
  });

  test("keeps inferred and supplied Unicode initials in a fixed two-cell slot", () => {
    expect(sacredInitialsFor("Élodie Brontë", undefined)).toBe("ÉB");
    expect(sacredInitialsFor("周 界", undefined)).toBe("周");
    expect(sacredInitialsFor("Ada", "e\u0301")).toBe("É ");
    expect(sacredInitialsFor("Emoji Tutor", "👩‍💻")).toBe("👩‍💻");
    for (const initials of [
      sacredInitialsFor("Élodie Brontë", undefined),
      sacredInitialsFor("周 界", undefined),
      sacredInitialsFor("Ada", "e\u0301"),
      sacredInitialsFor("Emoji Tutor", "👩‍💻"),
    ]) {
      expect(sacredTextWidth(initials)).toBe(2);
    }
  });

  test("renders a four-column, two-row avatar beside bounded identity text", () => {
    const exactValue = "/private/sessions/never-render-this.jsonl";
    const avatar = renderSacredAvatar({
      value: exactValue,
      label: "Keating Tutor",
      detail: "Socratic guide with a deliberately long detail",
      width: 18,
    });

    expect(avatar.value).toBe(exactValue);
    expect(avatar.label).toBe("Keating Tutor");
    expect(avatar.avatar.map(sacredTextWidth)).toEqual([4, 4]);
    expect(avatar.lines).toHaveLength(2);
    expect(avatar.lines.every((line) => sacredTextWidth(line) <= 18)).toBe(true);
    expect(avatar.lines[0]).toContain("KT");
    expect(avatar.lines.join("\n")).not.toContain(exactValue);

    const ascii = renderSacredAvatar({
      value: exactValue,
      label: "Élodie Teacher",
      detail: "révision",
      width: 13,
      glyphMode: "ascii",
    });
    expect(ascii.lines.every((line) => ASCII_ONLY.test(line))).toBe(true);
    expect(ascii.avatar).toEqual(["[ET]", "+--+"]);
  });

  test("keeps badges flat, uppercase, padded by one column, and bounded", () => {
    const badge = renderSacredBadge({
      value: { state: "active" },
      label: "in progress",
      width: 10,
      glyphMode: "ascii",
    });

    expect(badge.text).toMatch(/^ [A-Z ~]+ $/);
    expect(badge.text.startsWith(" ")).toBe(true);
    expect(badge.text.endsWith(" ")).toBe(true);
    expect(sacredTextWidth(badge.text)).toBe(10);
    expect(badge.label).toBe("in progress");
    expect(badge.displayLabel).not.toBe(badge.label);
  });

  test("formats selected actions and aligns left and right action-bar groups", () => {
    const button = renderSacredActionButton({
      value: "save-exact",
      label: "Save session",
      hotkey: "⌘+S",
      selected: true,
      width: 18,
    });
    expect(button.text).toBe("▸ ⌘+S SAVE SESSION");
    expect(button.value).toBe("save-exact");
    expect(renderSacredActionButton({ value: "save", label: "Save", selected: true, width: 2 }).text).toBe("▸…");

    const bar = renderSacredActionBar({
      width: 32,
      glyphMode: "ascii",
      left: [{ value: "sessions", label: "Sessions", hotkey: "1", selected: true }],
      right: [{ value: "quit", label: "Quit", hotkey: "Q" }],
    });
    expect(sacredTextWidth(bar.text)).toBe(32);
    expect(bar.text).toStartWith("> 1 SESSIONS");
    expect(bar.text).toEndWith("Q QUIT");
    expect(ASCII_ONLY.test(bar.text)).toBe(true);
  });

  test("mirrors Message and MessageViewer chrome around compact avatar markers", () => {
    const hidden = "/private/messages/turn-42";
    const incoming = renderSacredMessageHeader({
      value: hidden,
      label: "Keating Tutor",
      width: 28,
    });
    const outgoing = renderSacredMessageViewerHeader({
      value: hidden,
      label: "Learner",
      initials: "ME",
      width: 28,
    });

    expect(incoming.text).toStartWith("◀[KT]");
    expect(incoming.text).toEndWith("┐");
    expect(outgoing.text).toStartWith("┌");
    expect(outgoing.text).toEndWith("[ME]▶");
    expect(sacredTextWidth(incoming.text)).toBe(28);
    expect(sacredTextWidth(outgoing.text)).toBe(28);
    expect(`${incoming.text}${outgoing.text}`).not.toContain(hidden);

    const ascii = renderSacredMessageViewerHeader({
      value: hidden,
      label: "Élodie",
      width: 14,
      glyphMode: "ascii",
    });
    expect(ASCII_ONLY.test(ascii.text)).toBe(true);
    expect(ascii.text).toStartWith("+");
    expect(ascii.text).toEndWith(">");
    expect(renderSacredMessageViewerHeader({ value: hidden, label: "Learner", width: 7 }).text).toEndWith("▶");
  });

  test("flattens expanded trees with Sacred branches and ancestor continuations", () => {
    const rootId = "/private/sessions/root.jsonl";
    const rows = flattenSacredTree([
      { id: rootId, value: { path: "/exact/root" }, label: "Root session" },
      { id: "child-a", parentId: rootId, value: { path: "/exact/a" }, label: "First fork" },
      { id: "grandchild", parentId: "child-a", value: { path: "/exact/grand" }, label: "Nested fork" },
      { id: "child-b", parentId: rootId, value: { path: "/exact/b" }, label: "Second fork" },
      { id: "orphan", parentId: "/missing/private-parent", value: { path: "/exact/orphan" }, label: "Recovered" },
    ], { width: 38 });

    expect(rows.map((row) => [row.sourceId, row.depth])).toEqual([
      [rootId, 0],
      ["child-a", 1],
      ["grandchild", 2],
      ["child-b", 1],
      ["orphan", 0],
    ]);
    expect(rows[0]?.text).toStartWith("├───╦ Root session");
    expect(rows[1]?.text).toStartWith("│ . ├───╦ First fork");
    expect(rows[2]?.text).toStartWith("│ . │ . └─── Nested fork");
    expect(rows[3]?.text).toStartWith("│ . └─── Second fork");
    expect(rows[4]).toMatchObject({ orphaned: true, text: "└─── Recovered" });
    expect(rows.every((row) => sacredTextWidth(row.text) <= 38)).toBe(true);
  });

  test("breaks rootless cycles deterministically and emits every source once", () => {
    const rows = flattenSacredTree([
      { id: "alpha", parentId: "beta", value: "exact-alpha", label: "Alpha" },
      { id: "beta", parentId: "alpha", value: "exact-beta", label: "Beta" },
      { id: "child", parentId: "beta", value: "exact-child", label: "Child" },
    ], { width: 24, glyphMode: "ascii" });

    expect(rows.map((row) => row.sourceId)).toEqual(["alpha", "beta", "child"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.cyclic)).toEqual([true, true, false]);
    expect(rows.every((row) => ASCII_ONLY.test(row.text))).toBe(true);
    expect(rows[0]?.text).toStartWith("`---+ Alpha");
    expect(rows[1]?.text).toStartWith(". . `---+ Beta");
  });

  test("never derives visible labels from exact ids, paths, or values", () => {
    const secret = "/home/person/.keating/private/session-8.jsonl";
    const avatar = renderSacredAvatar({ value: secret, label: "Session", width: 11 });
    const badge = renderSacredBadge({ value: secret, label: "Fork", width: 8 });
    const action = renderSacredActionButton({ value: secret, label: "Resume", width: 10 });
    const message = renderSacredMessageHeader({ value: secret, label: "Tutor", width: 18 });
    const tree = flattenSacredTree([
      { id: secret, value: secret, label: "Safe session" },
      { id: "empty-label", parentId: secret, value: secret, label: "" },
    ], { width: 18 });
    const visible = [
      ...avatar.lines,
      badge.text,
      action.text,
      message.text,
      ...tree.map((row) => row.text),
    ].join("\n");

    expect(visible).not.toContain(secret);
    expect(tree[1]?.text).toContain("Untitled");
    expect(tree[0]?.value).toBe(secret);
    expect(tree[0]?.sourceId).toBe(secret);
  });

  test("bounds every presentation at zero through narrow terminal widths", () => {
    for (let width = 0; width <= 16; width += 1) {
      const avatar = renderSacredAvatar({ value: 1, label: "界面 Tutor", detail: "wide detail", width });
      const badge = renderSacredBadge({ value: 1, label: "界面 active", width });
      const action = renderSacredActionButton({ value: 1, label: "Open sessions", hotkey: "⌘+O", width });
      const bar = renderSacredActionBar({
        width,
        left: [{ value: 1, label: "Sessions", hotkey: "1" }],
        right: [{ value: 2, label: "Quit", hotkey: "Q" }],
      });
      const message = renderSacredMessageHeader({ value: 1, label: "界面 Tutor", width });
      const tree = flattenSacredTree([
        { id: "root", value: 1, label: "界面 root" },
        { id: "child", parentId: "root", value: 2, label: "child" },
      ], { width });

      expect(avatar.lines.every((line) => sacredTextWidth(line) <= width)).toBe(true);
      expect(sacredTextWidth(badge.text)).toBeLessThanOrEqual(width);
      expect(sacredTextWidth(action.text)).toBeLessThanOrEqual(width);
      expect(sacredTextWidth(bar.text)).toBe(width);
      expect(sacredTextWidth(message.text)).toBe(width);
      expect(tree.every((row) => sacredTextWidth(row.text) <= width)).toBe(true);
    }
  });
});
