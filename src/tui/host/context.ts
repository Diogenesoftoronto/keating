/**
 * The explicit dependency bundle every OpenTUI host flow receives.
 *
 * Flows never close over `launchOpenTui`; each takes the slice of
 * `HostContext` it needs (declared as `Pick<HostContext, ...>` in the flow
 * module) so a test can hand it fakes. `controller` and `sidebar` exist only
 * after the host has built them, so the context exposes them through late
 * binding: reading `controller` before `bindController` is a programming
 * error and throws.
 */
import type { CliRenderer } from "@opentui/core";
import type { KeatingRpcClient } from "../../runtime/pi.js";
import type { HostController, HostSurface } from "../host-controller.js";
import type { TuiPromptRecovery } from "../prompt-recovery.js";
import type { TuiSessionInfo } from "../session-browser.js";
import type { TuiDialogs } from "./dialogs.js";
import type { HostState } from "./state.js";
import type { TuiTheme } from "./theme.js";
import type { HostView } from "./view.js";

/** What the rest of the host needs from the side panel. */
export interface HostSidebarControl {
  /** Re-read the project's sessions and repaint the panel (latest call wins). */
  refreshSessions(): Promise<void>;
  /** Show or hide the panel, or explain why the terminal is too small. */
  toggle(): void;
}

export interface HostContext {
  readonly cwd: string;
  readonly renderer: CliRenderer;
  readonly client: KeatingRpcClient;
  readonly state: HostState;
  readonly theme: TuiTheme;
  readonly view: HostView;
  readonly dialogs: TuiDialogs;
  readonly surface: HostSurface;
  readonly controller: HostController;
  readonly sidebar: HostSidebarControl;
  readonly promptRecovery: TuiPromptRecovery;
  readonly listSessions: (cwd: string) => Promise<TuiSessionInfo[]>;
  readonly openExternalUrl: (url: string) => void;
}

export type HostContextInit = Omit<HostContext, "controller" | "sidebar">;

export interface HostContextHandle {
  readonly context: HostContext;
  bindController(controller: HostController): void;
  bindSidebar(sidebar: HostSidebarControl): void;
}

/**
 * Build the context with `controller` and `sidebar` unbound. The sidebar
 * starts as a no-op so an early RPC event can request a refresh before the
 * panel exists, exactly as the pre-panel host tolerated.
 */
export function createHostContext(init: HostContextInit): HostContextHandle {
  let controller: HostController | null = null;
  let sidebar: HostSidebarControl = { refreshSessions: async () => {}, toggle: () => {} };
  const context: HostContext = {
    ...init,
    get controller() {
      if (!controller) throw new Error("HostContext.controller read before bindController()");
      return controller;
    },
    get sidebar() {
      return sidebar;
    },
  };
  return {
    context,
    bindController(next) { controller = next; },
    bindSidebar(next) { sidebar = next; },
  };
}
