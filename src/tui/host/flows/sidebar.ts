/**
 * Side-panel wiring: builds the layered sidebar, keeps its session list fresh
 * (latest refresh wins), routes navigation entries to commands, resumes a
 * session on activation, and toggles the panel. The panel is mounted at the
 * front of the workspace row.
 */
import { RGBA, type Renderable } from "@opentui/core";
import { createSacredSidebar, type SacredSidebarNavigationItem } from "../../sacred-sidebar.js";
import { sessionTreeOption, tuiSessionTreeRows } from "../../session-browser.js";
import { TUI_COMMANDS } from "../../view-model.js";
import type { HostContext, HostSidebarControl } from "../context.js";
import { terminalCanShowSidebar } from "../shell.js";
import { runCommand, type CommandDeps } from "./commands.js";
import { showCommandPalette, type PickerDeps } from "./pickers.js";

/** Hints are the real leader keys; Profile has none, so it shows none. */
export const SIDEBAR_NAVIGATION: readonly SacredSidebarNavigationItem[] = [
  { id: "commands", label: "Commands", hint: ":p" },
  { id: "new-session", label: "New session", hint: ":n" },
  { id: "model", label: "Model", hint: ":m" },
  { id: "library", label: "Library", hint: ":l" },
  { id: "courses", label: "Courses", hint: ":o" },
  { id: "review", label: "Review" },
  { id: "setup", label: "Profile" },
];

export type SidebarDeps = CommandDeps & PickerDeps & Pick<HostContext, "theme">;

/** Where the panel mounts; the shell's workspace box satisfies this. */
export interface SidebarMount {
  add(child: Renderable, index: number): unknown;
}

/**
 * Create the panel, mount it, and return the control the rest of the host
 * uses. The caller binds the control into the context before any flow can
 * request a refresh.
 */
export function createSidebarControl(deps: SidebarDeps, mount: SidebarMount): HostSidebarControl {
  const { controller, listSessions, renderer, state, theme, cwd } = deps;
  const { appendEntry, status, statusLine, synchronizeFocusArea, setFocusArea, renderTranscript } = deps.view;
  const presentationProfile = theme.profile;
  const { textColor, mutedColor, accentColor, borderColor, sidebarSurfaceColor } = theme;
  let sessionRequest = 0;

  const paintSessions = () => {
    const sidebar = state.sidebar;
    if (!sidebar) return;
    const displayWidth = sidebar.sessionTextWidth;
    sidebar.setSessions(state.sidebarSessionTree.map((row) => ({
      display: sessionTreeOption(row, new Date(), "unicode", displayWidth),
      asciiDisplay: sessionTreeOption(row, new Date(), "ascii", displayWidth),
      value: row.item.path,
    })));
  };
  const refreshSessions = async () => {
    const request = ++sessionRequest;
    try {
      const sessions = await listSessions(cwd);
      if (request !== sessionRequest) return;
      state.sidebarSessionTree = tuiSessionTreeRows(sessions, controller.getCurrentSessionPath());
      paintSessions();
    } catch {
      if (request !== sessionRequest) return;
      state.sidebarSessionTree = [];
      state.sidebar?.setSessions([]);
    }
  };
  const activateNavigation = (item: SacredSidebarNavigationItem) => {
    synchronizeFocusArea("sidebar");
    void (async () => {
      if (item.id === "commands") {
        await showCommandPalette(deps);
        return;
      }
      const command = TUI_COMMANDS.find((candidate) => candidate.id === item.id);
      if (command) await runCommand(deps, command);
      if (!state.settled && state.sidebar?.visible) setFocusArea("sidebar");
    })();
  };
  const activateSession = (path: string) => {
    synchronizeFocusArea("sidebar");
    void (async () => {
      if (state.busy) {
        appendEntry({
          id: `sidebar-session-busy-${Date.now()}`,
          kind: "notice",
          title: "Session switch waits for the response",
          body: "Stop the active response with Ctrl+X, then activate this session again.",
        });
        return;
      }
      status.content = "Resuming selected session…";
      await controller.resumeSession(path);
      await refreshSessions();
      setFocusArea("composer");
    })();
  };

  const sidebar = createSacredSidebar(renderer, {
    id: "keating-open-tui-sacred-sidebar",
    width: state.sidebarWidth,
    minWidth: 20,
    maxWidth: 44,
    height: "100%",
    glyphMode: presentationProfile.design.glyphMode,
    surface: sidebarSurfaceColor,
    colors: {
      text: textColor ?? RGBA.defaultForeground(),
      muted: mutedColor ?? RGBA.defaultForeground(),
      accent: accentColor ?? RGBA.defaultForeground(),
      border: borderColor ?? RGBA.defaultForeground(),
      focus: accentColor ?? RGBA.defaultForeground(),
      selection: accentColor ?? RGBA.defaultForeground(),
      onSelection: sidebarSurfaceColor,
    },
    identity: { label: state.tuiProfile.displayName },
    navigation: SIDEBAR_NAVIGATION,
    sessions: [],
    activity: [`${presentationProfile.marks.notice} Nothing yet`],
    activityRows: 3,
    maxNavigationRows: 7,
    labels: { navigation: "Actions", sessions: "Sessions", recent: "Recent" },
    onNavigationSelection() {
      synchronizeFocusArea("sidebar");
      status.content = statusLine("↵ open · tab sessions · esc back");
    },
    onNavigate: activateNavigation,
    onSessionSelection(path) {
      synchronizeFocusArea("sidebar");
      const title = state.sidebarSessionTree.find((candidate) => candidate.item.path === path)?.item.title ?? "Session";
      status.content = statusLine(`${title} · ↵ resume · esc back`);
    },
    onSessionActivate: activateSession,
    onResizeRequest(requestedWidth) {
      state.sidebarWasResized = true;
      state.sidebarWidth = state.sidebar?.setWidth(requestedWidth) ?? requestedWidth;
      paintSessions();
      renderTranscript();
    },
    onFocusChange(target) {
      if (target) synchronizeFocusArea("sidebar");
    },
    onFocusEscape(direction) {
      setFocusArea(direction === "forward" ? "composer" : "transcript");
    },
  });
  state.sidebar = sidebar;
  mount.add(sidebar.root, 0);

  const toggle = () => {
    if (!terminalCanShowSidebar(renderer.terminalWidth, renderer.terminalHeight)) {
      status.content = "The side panel needs at least 88 columns × 22 rows. Sessions remain available with :s.";
      return;
    }
    state.sidebarExpanded = !state.sidebarExpanded;
    deps.view.updateResponsiveLayout();
    if (state.sidebarExpanded) setFocusArea("sidebar");
    else setFocusArea("composer");
  };
  return { refreshSessions, toggle };
}
