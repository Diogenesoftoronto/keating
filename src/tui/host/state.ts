/**
 * Mutable state shared by the OpenTUI host's view, surface and flows.
 *
 * One plain record replaces the pile of `let` bindings that used to close
 * over `launchOpenTui`. Flows read and write it through `HostContext.state`;
 * the keyboard reducer's own state lives in `state.interaction` and is only
 * advanced by `dispatchInteraction`.
 */
import type { UiDocument } from "../learner-contracts.js";
import type { UiDocumentControl } from "../host-controller.js";
import type { ComposerCommand } from "../composer.js";
import type { ActivityPhase } from "../activity-indicator.js";
import type { SacredSidebar } from "../sacred-sidebar.js";
import type { TuiProfile } from "../profile.js";
import type { OpenTuiExitResult } from "../shell-handoff.js";
import type { tuiSessionTreeRows } from "../session-browser.js";
import { terminalLayoutProfile, type TuiLayoutProfile } from "../terminal-profile.js";
import { EMPTY_HEADER_STATE, type TranscriptEntry, type TuiHeaderState } from "../view-model.js";
import type { TuiDebugEvent } from "../debug.js";
import type { TuiEditorMode } from "../editor-mode.js";
import {
  initialTuiInteractionState,
  tuiInteractionReducer,
  type TuiInteractionAction,
  type TuiInteractionResult,
  type TuiInteractionState,
} from "./interaction.js";
import { currentSidebarWidth } from "./shell.js";

export interface HostState {
  readonly cwd: string;
  /** Committed transcript; mutated in place so renderers can hold the array. */
  readonly entries: TranscriptEntry[];
  streaming: TranscriptEntry | null;
  headerState: TuiHeaderState;
  headerLabel: string;
  busy: boolean;
  busyStartedAt: number | null;
  activityPhase: ActivityPhase;
  activityDetail: string | undefined;
  spinnerFrame: number;
  /** Slash commands Pi advertised, for composer hints and the palette. */
  knownPiCommands: ComposerCommand[];
  /** Bounded ring of recent RPC events for the debug service. */
  readonly runtimeDebugEvents: TuiDebugEvent[];
  /** Set while an interactive provider login is in flight. */
  activeProviderLoginAbort: AbortController | null;
  /** Focus, Vim, leader, onboarding and modal state owned by the key reducer. */
  interaction: TuiInteractionState;
  readonly editorMode: TuiEditorMode;
  activeUiDocument: UiDocument | null;
  activeUiControls: UiDocumentControl[];
  suppressEmptySplash: boolean;
  firstRunHasProvider: boolean | undefined;
  /** Onboarding mark animation, reset whenever the tour begins. */
  onboardingFrame: number;
  onboardingElapsed: number;
  tuiProfile: TuiProfile;
  sidebar: SacredSidebar<string> | null;
  sidebarSessionTree: ReturnType<typeof tuiSessionTreeRows>;
  sidebarExpanded: boolean;
  sidebarWidth: number;
  sidebarWasResized: boolean;
  currentLayout: TuiLayoutProfile;
  /** True once the host has resolved its exit promise. */
  settled: boolean;
  settle: ((result: OpenTuiExitResult) => void) | null;
}

export interface HostStateInit {
  cwd: string;
  tuiProfile: TuiProfile;
  editorMode: TuiEditorMode;
}

export function createHostState(init: HostStateInit): HostState {
  return {
    cwd: init.cwd,
    entries: [],
    streaming: null,
    headerState: { ...EMPTY_HEADER_STATE },
    headerLabel: "keating",
    busy: false,
    busyStartedAt: null,
    activityPhase: "thinking",
    activityDetail: undefined,
    spinnerFrame: 0,
    knownPiCommands: [],
    runtimeDebugEvents: [],
    activeProviderLoginAbort: null,
    interaction: initialTuiInteractionState(init.editorMode),
    editorMode: init.editorMode,
    activeUiDocument: null,
    activeUiControls: [],
    suppressEmptySplash: false,
    firstRunHasProvider: undefined,
    onboardingFrame: 0,
    onboardingElapsed: 0,
    tuiProfile: init.tuiProfile,
    sidebar: null,
    sidebarSessionTree: [],
    sidebarExpanded: false,
    // Placeholders: the view measures the real terminal when it is created.
    sidebarWidth: currentSidebarWidth(80),
    sidebarWasResized: false,
    currentLayout: terminalLayoutProfile(80, 24),
    settled: false,
    settle: null,
  };
}

/** Run the reducer, adopt its state, and hand back the verdict for the caller to apply. */
export function dispatchInteraction(state: HostState, action: TuiInteractionAction): TuiInteractionResult {
  const result = tuiInteractionReducer(state.interaction, action);
  state.interaction = result.state;
  return result;
}
