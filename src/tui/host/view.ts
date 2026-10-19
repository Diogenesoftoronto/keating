/**
 * Painting for the OpenTUI host: status line, focus hints, splash, onboarding
 * page, transcript, header, responsive layout and the busy indicator. It is
 * the only module that writes to the shell's renderables on behalf of flows;
 * flows call `HostView` methods instead of touching widgets.
 */
import { KEATING_VERSION } from "../../core/version.js";
import { SPINNER_INTERVAL_MS, activityIndicatorText } from "../activity-indicator.js";
import { type VimInputAction, type VimState, editorModeLabel } from "../editor-mode.js";
import { keatingLogoFrame, keatingLogoLabel, keatingObjectFrame, keatingSplashMode, keatingWordmarkHeight, shouldAnimateLogo } from "../logo.js";
import { tuiOnboardingLayout, tuiOnboardingPages } from "../onboarding.js";
import { terminalLayoutProfile } from "../terminal-profile.js";
import { type TranscriptEntry, activityText, headerText } from "../view-model.js";
import { CliRenderEvents, RGBA, RenderableEvents, type CliRenderer } from "@opentui/core";
import { currentSidebarWidth, terminalCanShowSidebar, type TuiShell } from "./shell.js";
import { applyVimEdit } from "./vim-edit.js";
import type { TuiPromptRecovery } from "../prompt-recovery.js";
import type { TuiTheme } from "./theme.js";
import { dispatchInteraction, type HostState } from "./state.js";
import type { TuiFocusArea } from "./interaction.js";

/** The composer surface flows use; the real `InputRenderable` satisfies it. */
export interface HostComposer {
  value: string;
  focus(): void;
  blur(): void;
}

/** Write-only status line; reading yields the visible text. */
export interface HostStatusLine {
  content: string;
}

export interface HostView {
  readonly composer: HostComposer;
  readonly status: HostStatusLine;
  appendEntry(entry: TranscriptEntry): void;
  renderTranscript(coalesce?: boolean): void;
  renderHeader(): void;
  idleStatus(): string;
  statusLine(hints: string): string;
  synchronizeFocusArea(next: TuiFocusArea): void;
  applyFocusArea(area: TuiFocusArea): void;
  setFocusArea(next: TuiFocusArea): void;
  paintVimMode(mode: VimState): void;
  setVimState(next: VimState): void;
  /** Apply a Vim normal-mode edit to the composer. */
  vimEdit(action: VimInputAction): void;
  renderOnboarding(): void;
  /** Rewind the onboarding mark to its first frame. */
  resetOnboardingObject(): void;
  paintIndicator(): void;
  updateResponsiveLayout(): void;
  refreshSidebarIdentity(): void;
  refreshSidebarActivity(): void;
  /** Scroll the transcript to entry `index` of the committed entries. */
  revealEntry(index: number): void;
}

export interface HostViewDeps {
  renderer: CliRenderer;
  theme: TuiTheme;
  parts: TuiShell;
  state: HostState;
  cwd: string;
  /** Source of the `^R retry` hint. */
  promptRecovery: Pick<TuiPromptRecovery, "draft">;
}

export function createHostView(deps: HostViewDeps): HostView {
  const { renderer, theme, parts, state, cwd, promptRecovery } = deps;
  const presentationProfile = theme.profile;
  const { accentColor, mutedColor } = theme;
  const {
    shell, header, onboarding, onboardingObject, onboardingCopy, onboardingProgress,
    splash, logo, splashHint, indicator, status, workspace, scroll, transcript,
    activityRail, activity, inputPrompt, inputFrame, input,
  } = parts;
  let activeSplashMode: ReturnType<typeof keatingSplashMode> = "hidden";
  state.currentLayout = terminalLayoutProfile(renderer.terminalWidth, renderer.terminalHeight);
  state.sidebarWidth = currentSidebarWidth(renderer.terminalWidth);
  const refreshSidebarIdentity = () => {
    // The model already sits in the header; the panel only names the learner.
    state.sidebar?.setIdentity({ label: state.tuiProfile.displayName });
  };
  const refreshSidebarActivity = () => {
    if (!state.sidebar) return;
    // Conversation turns are already on screen; Recent lists what happened around them.
    const recent = state.entries
      .filter((entry) => entry.kind !== "user" && entry.kind !== "assistant")
      .slice(-3)
      .reverse()
      .map((entry) => `${presentationProfile.marks[entry.kind]} ${entry.title.replace(/\s+/g, " ").trim() || entry.kind}`);
    state.sidebar.setActivity(recent.length > 0 ? recent : [`${presentationProfile.marks.notice} Nothing yet`]);
  };
  const retryHint = () => promptRecovery.draft === null ? "" : " · ^R retry";
  // Emacs is the default and goes unsaid; Vim states earn their place.
  const statusLine = (hints: string) => {
    const mode = state.editorMode === "vim" ? `${editorModeLabel(state.editorMode, state.interaction.vimState)} · ` : "";
    return `${mode}${hints}`;
  };
  const idleStatus = () => {
    const shortcuts = state.currentLayout.compactStatus
      ? state.activeUiDocument
        ? `^U ${state.activeUiControls.length} actions · :p commands${retryHint()}`
        : `:p commands · :m model${retryHint()}`
      : state.activeUiDocument
        ? `^U ${state.activeUiControls.length} actions · :p commands · :m model · :s sessions · ^B panel${retryHint()}`
        : `:p commands · :m model · :s sessions · :n new · ^B panel${retryHint()}`;
    return statusLine(shortcuts);
  };
  const synchronizeFocusArea = (next: TuiFocusArea) => {
    dispatchInteraction(state, { type: "focus-observed", area: next });
    // Focus moves the composer's prompt colour and the status line, never a box:
    // assigning borderColor on a borderless OpenTUI box switches its border on.
    inputPrompt.fg = next === "composer" ? accentColor ?? RGBA.defaultForeground() : mutedColor ?? RGBA.defaultForeground();
    if (next === "composer") {
      if (!state.busy) status.content = idleStatus();
    } else if (next === "transcript") {
      status.content = statusLine(`↑/↓ scroll · ^F search · tab ${state.sidebar?.visible ? "panel" : "composer"}`);
    } else {
      status.content = statusLine("↵ open · tab next · esc back");
    }
  };
  /** Blur everything, focus the renderable behind `area`, then repaint the hints. */
  const applyFocusArea = (area: TuiFocusArea) => {
    if (area === "sidebar") {
      state.sidebar?.focusNavigation();
    } else {
      state.sidebar?.navigationSelect.blur();
      state.sidebar?.sessionSelect.blur();
      state.sidebar?.resizeHandle.blur();
      if (area === "composer") input.focus();
      else scroll.focus();
    }
    synchronizeFocusArea(area);
  };
  const setFocusArea = (next: TuiFocusArea) => {
    // A focus request always resolves to one focus-apply for the area it settled on.
    const { state: resolved } = dispatchInteraction(state, {
      type: "focus-request",
      area: next,
      sidebarVisible: state.sidebar?.visible === true,
    });
    applyFocusArea(resolved.focusArea);
  };
  input.on(RenderableEvents.FOCUSED, () => {
    if (state.interaction.modal === null) synchronizeFocusArea("composer");
  });
  scroll.on(RenderableEvents.FOCUSED, () => {
    if (state.interaction.modal === null) synchronizeFocusArea("transcript");
  });
  const paintVimMode = (mode: VimState) => {
    input.cursorStyle = { style: mode === "normal" ? "block" : "line", blinking: true };
    if (state.interaction.focusArea === "composer" && !state.busy) status.content = idleStatus();
  };
  const setVimState = (next: VimState) => {
    dispatchInteraction(state, { type: "vim-mode", mode: next });
    paintVimMode(next);
  };
  /** The welcome mark owns the workspace until the transcript has something in it. */
  const updateSplash = () => {
    const empty = state.entries.length === 0 && state.streaming === null && !state.suppressEmptySplash;
    const hintLines = 2;
    const mode = keatingSplashMode({
      width: renderer.terminalWidth,
      height: renderer.terminalHeight,
      glyphMode: presentationProfile.design.glyphMode,
      shellPadding: state.currentLayout.shellPadding,
      hintLines,
    });
    activeSplashMode = mode;
    logo.content = mode === "full"
      ? keatingLogoFrame(0, presentationProfile.design.glyphMode)
      : keatingLogoLabel(presentationProfile.design.glyphMode);
    logo.height = mode === "full"
      ? keatingWordmarkHeight(presentationProfile.design.glyphMode)
      : 1;
    splashHint.height = hintLines;
    splash.visible = !state.interaction.onboarding.active && empty && mode !== "hidden";
    workspace.visible = !state.interaction.onboarding.active && !splash.visible;
    inputFrame.visible = !state.interaction.onboarding.active;
    status.visible = !state.interaction.onboarding.active;
    indicator.visible = !state.interaction.onboarding.active && state.busy;
  };

  const renderOnboarding = () => {
    const pages = tuiOnboardingPages({ version: KEATING_VERSION, hasProvider: state.firstRunHasProvider });
    const page = pages[Math.min(state.interaction.onboarding.pageIndex, pages.length - 1)]!;
    const layout = tuiOnboardingLayout(renderer.terminalWidth, renderer.terminalHeight);
    onboarding.visible = state.interaction.onboarding.active;
    onboardingObject.visible = state.interaction.onboarding.active && layout === "full";
    onboardingObject.height = 10;
    onboardingCopy.width = layout === "minimal" ? "100%" : layout === "compact" ? "94%" : "82%";
    onboardingProgress.width = Math.max(20, Math.min(72, renderer.terminalWidth - (2 * state.currentLayout.shellPadding)));
    onboardingCopy.content = layout === "minimal"
      ? `${page.title.toUpperCase()}\n\nResize to at least 42 × 15 to read this step.`
      : `${page.title.toUpperCase()}\n\n${page.body.join("\n\n")}`;
    const finalPage = state.interaction.onboarding.pageIndex === pages.length - 1;
    onboardingProgress.content = [
      `${state.interaction.onboarding.pageIndex + 1}/${pages.length}`,
      `${finalPage ? "Space  choose name + image" : "Space  continue"}  ·  Backspace/←  back  ·  S/Esc  ${finalPage ? "skip to prompt" : "skip"}`,
    ].join("\n");
    updateSplash();
  };
  /**
   * Re-parsing the whole transcript on every token is the expensive part of
   * state.streaming, so deltas coalesce onto one trailing frame instead.
   */
  let transcriptDirty = false;
  const paintTranscript = () => {
    transcriptDirty = false;
    const panelWidth = state.sidebar?.visible ? state.sidebar.width + 1 : 0;
    const legacyRailWidth = activityRail.visible ? state.currentLayout.activityRailWidth + 1 : 0;
    const transcriptWidth = renderer.terminalWidth
      - (2 * state.currentLayout.shellPadding)
      - panelWidth
      - legacyRailWidth
      - 4;
    transcript.reconcile(state.entries, state.streaming, transcriptWidth);
    activity.content = activityText(state.entries, state.headerState, presentationProfile, state.currentLayout.activityRailWidth);
    refreshSidebarActivity();
    updateSplash();
    scroll.scrollTo({ y: scroll.scrollHeight, x: 0 });
  };
  const renderTranscript = (coalesce = false) => {
    if (!coalesce) {
      paintTranscript();
      return;
    }
    transcriptDirty = true;
  };
  const renderHeader = () => {
    header.content = headerText(state.headerState, presentationProfile, {
      width: Math.max(20, renderer.terminalWidth - 2 * state.currentLayout.shellPadding),
      label: state.headerLabel,
    });
  };
  const appendEntry = (entry: TranscriptEntry) => {
    state.entries.push(entry);
    if (state.busy && entry.kind === "tool") {
      state.activityPhase = "tool";
      state.activityDetail = entry.title;
    }
    renderTranscript();
  };
  const updateResponsiveLayout = () => {
    state.currentLayout = terminalLayoutProfile(renderer.terminalWidth, renderer.terminalHeight);
    const sidebarEligible = terminalCanShowSidebar(renderer.terminalWidth, renderer.terminalHeight);
    const showSidebar = sidebarEligible && state.sidebarExpanded;
    state.sidebar?.setVisible(showSidebar);
    if (!showSidebar && state.interaction.focusArea === "sidebar") setFocusArea("composer");
    if (!state.sidebarWasResized) state.sidebarWidth = currentSidebarWidth(renderer.terminalWidth);
    if (state.sidebar) state.sidebarWidth = state.sidebar.setWidth(state.sidebarWidth);
    // Recent activity now lives in the layered side panel. The legacy rail is
    // retained as a construction fallback, but never competes for width.
    activityRail.visible = state.currentLayout.showActivityRail && !sidebarEligible;
    activityRail.width = state.currentLayout.activityRailWidth;
    shell.padding = state.currentLayout.shellPadding;
    transcript.tableOptions = {
      ...transcript.tableOptions,
      style: state.currentLayout.transcriptTableStyle,
      borders: presentationProfile.design.colorMode !== "none"
        && presentationProfile.design.glyphMode === "unicode"
        && state.currentLayout.size === "wide",
    };
    splashHint.content = [
      `${cwd}`,
      state.currentLayout.compactStatus
        ? "Ctrl+P commands  ·  Ctrl+M model"
        : "Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+M model  ·  Ctrl+T thinking",
    ].join("\n");
    renderOnboarding();
    renderHeader();
    if (!state.busy) status.content = idleStatus();
    renderTranscript();
  };
  updateResponsiveLayout();
  renderer.on(CliRenderEvents.RESIZE, updateResponsiveLayout);

  const motion = shouldAnimateLogo(process.env, process.stdout.isTTY === true);
  let spinnerElapsed = 0;
  let logoElapsed = 0;
  let logoFrame = 0;
  const paintIndicator = () => {
    indicator.visible = !state.interaction.onboarding.active && state.busy;
    if (!state.busy) return;
    indicator.content = activityIndicatorText({
      phase: state.activityPhase,
      detail: state.activityDetail,
      elapsedMs: state.busyStartedAt === null ? 0 : Date.now() - state.busyStartedAt,
      frame: state.spinnerFrame,
      glyphMode: presentationProfile.design.glyphMode,
      hint: "Ctrl+X stops",
    });
  };
  renderer.setFrameCallback(async (deltaTime) => {
    if (transcriptDirty) paintTranscript();
    if (state.busy) {
      spinnerElapsed += deltaTime;
      if (spinnerElapsed >= SPINNER_INTERVAL_MS) {
        spinnerElapsed = 0;
        if (motion) state.spinnerFrame += 1;
        paintIndicator();
      }
    }
    if (motion && state.interaction.onboarding.active && onboardingObject.visible) {
      state.onboardingElapsed += deltaTime;
      if (state.onboardingElapsed >= 180) {
        state.onboardingElapsed = 0;
        state.onboardingFrame += 1;
        onboardingObject.content = keatingObjectFrame(state.onboardingFrame, presentationProfile.design.glyphMode);
      }
    }
    if (!motion || !splash.visible || activeSplashMode !== "full") return;
    logoElapsed += deltaTime;
    if (logoElapsed < 900) return;
    logoElapsed = 0;
    logoFrame += 1;
    logo.content = keatingLogoFrame(logoFrame, presentationProfile.design.glyphMode);
  });

  const revealEntry = (index: number) => {
    const entries = state.entries;
    const matchedEntry = transcript.getEntryRenderable(entries[index]!.id);
    // Reconciled message layers expose their measured content position. The
    // proportional fallback covers the first frame before layout has measured.
    const target = matchedEntry && matchedEntry.y > 0
      ? matchedEntry.y
      : entries.length <= 1 ? 0 : Math.round((index / (entries.length - 1)) * scroll.scrollHeight);
    scroll.scrollTo({ y: target, x: 0 });
  };
  const resetOnboardingObject = () => {
    state.onboardingFrame = 0;
    state.onboardingElapsed = 0;
    onboardingObject.content = keatingObjectFrame(0, presentationProfile.design.glyphMode);
  };
  const statusProxy: HostStatusLine = {
    get content() { return status.plainText; },
    set content(text: string) { status.content = text; },
  };

  return {
    composer: input,
    status: statusProxy,
    appendEntry, renderTranscript, renderHeader, idleStatus, statusLine,
    synchronizeFocusArea, applyFocusArea, setFocusArea, paintVimMode, setVimState,
    vimEdit: (action) => applyVimEdit(input, action),
    renderOnboarding, resetOnboardingObject, paintIndicator, updateResponsiveLayout,
    refreshSidebarIdentity, refreshSidebarActivity, revealEntry,
  };
}
