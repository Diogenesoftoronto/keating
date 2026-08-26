import { describe, expect, test } from "bun:test";
import { parseColor, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";

import {
  SacredSidebar,
  createSacredSidebar,
  type SacredSidebarOptions,
} from "../src/tui/sacred-sidebar.js";

const COLORS = {
  text: "#f4efe6",
  muted: "#9f998f",
  accent: "#d9a85f",
  border: "#5e584f",
  focus: "#7dc8b6",
  selection: "#614b32",
  onSelection: "#fff9ef",
} as const;

interface SessionValue {
  id: string;
  lineage: readonly string[];
}

const SESSION_VALUES: readonly SessionValue[] = [
  { id: "root-session-opaque", lineage: [] },
  { id: "fork-session-opaque", lineage: ["root-session-opaque"] },
];

function sidebarOptions(overrides: Partial<SacredSidebarOptions<SessionValue>> = {}): SacredSidebarOptions<SessionValue> {
  return {
    id: "test-sacred-sidebar",
    width: 34,
    minWidth: 18,
    maxWidth: 38,
    glyphMode: "unicode",
    surface: "#191714",
    colors: COLORS,
    identity: {
      label: "Keating",
      detail: "local tutor",
      avatarLines: ["╭K─╮", "╰──╯"],
      asciiAvatarLines: ["+K-+", "+--+"],
    },
    navigation: [
      { id: "new", label: "New lesson" },
      { id: "settings", label: "Settings" },
    ],
    sessions: [
      { display: "Root session", value: SESSION_VALUES[0]! },
      { display: "└─ Forked session", asciiDisplay: "+- Forked session", value: SESSION_VALUES[1]! },
    ],
    activity: ["tool finished", "quiz ready"],
    activityRows: 2,
    zIndex: 7,
    ...overrides,
  };
}

describe("SacredSidebar", () => {
  test("renders the identity, layered handle, action list, tree rows, and recent activity", async () => {
    const setup = await createTestRenderer({ width: 60, height: 22, kittyKeyboard: true, exitOnCtrlC: false });
    const sidebar = createSacredSidebar(setup.renderer, sidebarOptions());
    setup.renderer.root.add(sidebar.root);

    try {
      await setup.flush();
      const frame = setup.captureCharFrame();

      expect(sidebar.root.zIndex).toBe(7);
      expect(sidebar.resizeHandle.zIndex).toBe(8);
      expect(sidebar.resizeHandle.width).toBe(2);
      expect(setup.renderer.root.findDescendantById("test-sacred-sidebar-avatar")).toMatchObject({ width: 4, height: 2 });
      expect(frame).toContain("Keating");
      expect(frame).toContain("local tutor");
      expect(frame).toContain("Actions");
      expect(frame).toContain("New lesson");
      expect(frame).toContain("Sessions");
      expect(frame).toContain("Root session");
      expect(frame).toContain("Forked session");
      expect(frame).toContain("Recent");
      expect(frame).toContain("tool finished");
      expect(frame).toContain("┊");
      expect(frame).toContain("┌");

      sidebar.setVisible(false);
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain("Keating");
      sidebar.setVisible(true);
      expect(sidebar.setWidth(36)).toBe(36);
      await setup.flush();
      expect(sidebar.root.width).toBe(36);
      expect(setup.captureCharFrame()).toContain("Keating");
    } finally {
      sidebar.destroy();
      setup.renderer.destroy();
    }
  });

  test("moves keyboard focus between lists and activates exact selected values with Enter", async () => {
    const navigationSelections: string[] = [];
    const navigationActivations: string[] = [];
    const sessionSelections: SessionValue[] = [];
    const sessionActivations: SessionValue[] = [];
    const focusEscapes: string[] = [];
    const setup = await createTestRenderer({ width: 58, height: 20, kittyKeyboard: true, exitOnCtrlC: false });
    const sidebar = new SacredSidebar(setup.renderer, sidebarOptions({
      onNavigationSelection: (item) => navigationSelections.push(item.id),
      onNavigate: (item) => navigationActivations.push(item.id),
      onSessionSelection: (value) => sessionSelections.push(value),
      onSessionActivate: (value) => sessionActivations.push(value),
      onFocusEscape: (direction) => focusEscapes.push(direction),
    }));
    setup.renderer.root.add(sidebar.root);

    try {
      sidebar.focusNavigation();
      setup.mockInput.pressArrow("down");
      await setup.flush();
      expect(sidebar.focusedArea).toBe("navigation");
      expect(sidebar.selectedNavigationItem?.id).toBe("settings");
      expect(navigationSelections).toEqual(["settings"]);
      setup.mockInput.pressEnter();
      await setup.flush();
      expect(navigationActivations).toEqual(["settings"]);

      setup.mockInput.pressTab();
      await setup.flush();
      expect(sidebar.focusedArea).toBe("sessions");
      expect(setup.captureCharFrame()).toContain("◆ Sessions");
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressEnter();
      await setup.flush();
      expect(sessionSelections).toEqual([SESSION_VALUES[1]]);
      expect(sessionActivations).toEqual([SESSION_VALUES[1]]);
      expect(sidebar.selectedSession?.value).toBe(SESSION_VALUES[1]);

      setup.mockInput.pressTab({ shift: true });
      await setup.flush();
      expect(sidebar.focusedArea).toBe("navigation");

      setup.mockInput.pressTab({ shift: true });
      await setup.flush();
      expect(focusEscapes).toEqual(["backward"]);
      setup.mockInput.pressTab();
      setup.mockInput.pressTab();
      await setup.flush();
      expect(focusEscapes).toEqual(["backward", "forward"]);
    } finally {
      sidebar.destroy();
      setup.renderer.destroy();
    }
  });

  test("preserves the exact selected session value when refreshed rows reorder", async () => {
    const setup = await createTestRenderer({ width: 58, height: 20, kittyKeyboard: true, exitOnCtrlC: false });
    const sidebar = createSacredSidebar(setup.renderer, sidebarOptions());
    setup.renderer.root.add(sidebar.root);

    try {
      sidebar.sessionSelect.setSelectedIndex(1);
      expect(sidebar.selectedSession?.value).toBe(SESSION_VALUES[1]);
      sidebar.setSessions([
        { display: "Forked session moved first", value: SESSION_VALUES[1]! },
        { display: "Root session moved second", value: SESSION_VALUES[0]! },
      ]);
      await setup.flush();

      expect(sidebar.sessionSelect.getSelectedIndex()).toBe(0);
      expect(sidebar.selectedSession?.value).toBe(SESSION_VALUES[1]);
      expect(setup.captureCharFrame()).toContain("› Forked session moved f");
    } finally {
      sidebar.destroy();
      setup.renderer.destroy();
    }
  });

  test("supports click activation and reports clamped drag requests without applying host layout", async () => {
    const activated: SessionValue[] = [];
    const requestedWidths: number[] = [];
    const longDisplay = "└─ A fork label that is intentionally much longer than the sidebar";
    const setup = await createTestRenderer({ width: 60, height: 20, kittyKeyboard: true, exitOnCtrlC: false });
    const sidebar = createSacredSidebar(setup.renderer, sidebarOptions({
      width: 28,
      minWidth: 18,
      maxWidth: 36,
      sessions: [
        { display: longDisplay, value: SESSION_VALUES[0]! },
        { display: "└─ Click target", value: SESSION_VALUES[1]! },
      ],
      onSessionActivate: (value) => activated.push(value),
      onResizeRequest: (width) => requestedWidths.push(width),
    }));
    setup.renderer.root.add(sidebar.root);

    try {
      await setup.flush();
      expect(setup.captureCharFrame()).not.toContain(longDisplay);

      await setup.mockMouse.click(sidebar.sessionSelect.screenX + 3, sidebar.sessionSelect.screenY + 1);
      await setup.flush();
      expect(activated).toEqual([SESSION_VALUES[1]]);
      expect(sidebar.selectedSession?.value).toBe(SESSION_VALUES[1]);

      const handleX = sidebar.resizeHandle.screenX;
      const handleY = sidebar.resizeHandle.screenY + 2;
      await setup.mockMouse.drag(handleX, handleY, handleX + 30, handleY);
      await setup.flush();
      expect(requestedWidths.at(-1)).toBe(36);
      expect(sidebar.width).toBe(28);

      expect(sidebar.requestWidth(-100)).toBe(18);
      expect(requestedWidths.at(-1)).toBe(18);
      expect(sidebar.setWidth(100)).toBe(36);
      expect(sidebar.width).toBe(36);

      const handleGlyph = sidebar.root.findDescendantById("test-sacred-sidebar-resize-glyph") as TextRenderable;
      sidebar.resizeHandle.focus();
      expect(handleGlyph.fg.toInts()).toEqual(parseColor(COLORS.focus).toInts());
    } finally {
      sidebar.destroy();
      setup.renderer.destroy();
    }
  });

  test("uses ASCII chrome and removes renderables plus global keyboard listeners on teardown", async () => {
    const setup = await createTestRenderer({ width: 48, height: 18, kittyKeyboard: true, exitOnCtrlC: false });
    const listenerCount = setup.renderer.keyInput.listenerCount("keypress");
    const sidebar = createSacredSidebar(setup.renderer, sidebarOptions({
      id: "ascii-sacred-sidebar",
      width: 30,
      glyphMode: "ascii",
      identity: { label: "Kéating 界面", detail: "révision", avatarLines: ["╭K─╮", "╰──╯"] },
      sessions: [{ display: "└─ fork… 界面 🚀", value: SESSION_VALUES[0]! }],
      activity: ["· vérifying 界面"],
    }));
    setup.renderer.root.add(sidebar.root);

    try {
      await setup.flush();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("+K-+");
      expect(frame).toContain("+- fork...");
      expect(frame).toContain("|||");
      expect(frame).not.toMatch(/[^\x00-\x7f]/);
      expect(setup.renderer.keyInput.listenerCount("keypress")).toBe(listenerCount + 1);

      sidebar.destroy();
      sidebar.destroy();
      await setup.flush();
      expect(sidebar.isDestroyed).toBe(true);
      expect(setup.renderer.keyInput.listenerCount("keypress")).toBe(listenerCount);
      expect(setup.renderer.root.findDescendantById("ascii-sacred-sidebar")).toBeUndefined();
      expect(setup.captureCharFrame()).not.toContain("Keating");
    } finally {
      sidebar.destroy();
      setup.renderer.destroy();
    }
  });
});
