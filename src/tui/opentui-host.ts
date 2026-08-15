import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  InputRenderableEvents,
  MarkdownRenderable,
  RGBA,
  SelectRenderable,
  SelectRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  SyntaxStyle,
  createCliRenderer,
  type ColorInput,
} from "@opentui/core";
import { launchRpcClient } from "../runtime/pi.js";
import { flashcardsTopicArtifact } from "../core/project.js";
import { HostController, type HostControllerOptions, type HostSurface, type UiDocumentControl } from "./host-controller.js";
import { formatDueIn, type SrsRating, type UiActionDispatcher, type UiDocument } from "./learner-contracts.js";
import { FileUiActionJournalStorage, RpcUiActionDispatcher, UiActionJournalStore } from "./ui/index.js";
import {
  EMPTY_HEADER_STATE,
  TUI_COMMANDS,
  activityText,
  commandOption,
  headerText,
  sanitizeDiagnostic,
  transcriptMarkdown,
  type TranscriptEntry,
  type TuiCommand,
  type TuiHeaderState,
} from "./view-model.js";
import {
  createTuiPresentationProfile,
  terminalLayoutProfile,
  terminalSurfaceColor,
  type TuiPresentationProfile,
} from "./terminal-profile.js";
import { TuiPromptRecovery, type TuiPromptSendOutcome } from "./prompt-recovery.js";
import {
  exportTuiArtifact,
  libraryArtifactOption,
  listTuiLibraryArtifacts,
  previewTuiArtifact,
  trashTuiArtifact,
} from "./library.js";
import { loadTuiReviewDashboard, rateTuiReviewCard, reviewCardOption } from "./review.js";
import { TUI_SETTINGS_ACTIONS, tuiRuntimeSettings, tuiSettingsMarkdown } from "./settings.js";
import type { OpenTuiExitResult } from "./shell-handoff.js";
import {
  SESSION_ACTIONS,
  forkMessageOption,
  listProjectTuiSessions,
  sessionOption,
  tuiSessionItems,
  type TuiSessionInfo,
} from "./session-browser.js";
import {
  commandSuggestions,
  composerReferenceErrors,
  parseComposerInput,
  resolveComposerInput,
  type ComposerCommand,
} from "./composer.js";
import { filterSearchOptions, type SearchOption } from "./search.js";
import {
  courseLessonOption,
  courseLessonPrompt,
  courseMarkdown,
  courseOption,
  listTuiCourses,
  type TuiCourse,
  type TuiCourseLesson,
  type TuiCourseModule,
} from "./courses.js";
import { onboardingMarkdown, loadTuiOnboardingState, markTuiOnboardingSeen, shouldShowTuiOnboarding } from "./onboarding.js";
import { keatingLogoFrame, keatingWordmarkHeight, keatingWordmarkWidth, shouldAnimateLogo } from "./logo.js";
import { tryCreateThreeLogo } from "./three-logo.js";
import {
  SPINNER_INTERVAL_MS,
  activityIndicatorText,
  type ActivityPhase,
} from "./activity-indicator.js";
import { detectTuiEditorMode, editorModeLabel, vimNormalAction, type TuiEditorMode, type VimState } from "./editor-mode.js";
import { modelChoices, modelPickerTitle, modelProviderChoices } from "./model-picker.js";
import { publishTuiSession } from "./share.js";
import { isTuiLeaderKey, TUI_LEADER_HINT, tuiLeaderAction } from "./leader.js";
import { KEATING_VERSION } from "../core/version.js";
import { overlayResponseTone, overlayTitleLines, truncateOverlayLabel } from "./overlay.js";

export interface OpenTuiOptions extends Pick<HostControllerOptions, "uiActionDispatcher"> {
  /** Alias retained for direct host embedding callers. */
  uiActionDispatcher?: UiActionDispatcher;
  /** Test/integration seam; production reads Pi's project-scoped session catalog. */
  listSessions?: (cwd: string) => Promise<TuiSessionInfo[]>;
}

type TerminalColorRole = keyof TuiPresentationProfile["design"]["colors"];

interface SelectPresentationOptions {
  /** Keep the filter field focused so typing immediately narrows the list. */
  initialFocus?: "filter" | "list";
  descriptions?: ReadonlyMap<string, string>;
  showDescription?: boolean;
}

const ASCII_BORDER_CHARS = {
  topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+",
  horizontal: "-", vertical: "|", topT: "+", bottomT: "+",
  leftT: "+", rightT: "+", cross: "+",
} as const;

function openTuiColor(profile: TuiPresentationProfile, role: TerminalColorRole): ColorInput | undefined {
  if (profile.design.colorMode === "none") return RGBA.defaultForeground();
  const token = profile.design.colors[role];
  if (!token) return undefined;
  if (profile.design.colorMode === "truecolor") return token.truecolor;
  const index = profile.design.colorMode === "ansi256" ? token.ansi256 : token.ansi16;
  return index === undefined ? undefined : RGBA.fromIndex(index);
}

function markdownSyntaxStyle(profile: TuiPresentationProfile): SyntaxStyle {
  const style = (role: TerminalColorRole, attributes: Record<string, boolean> = {}) => {
    const fg = openTuiColor(profile, role);
    return { ...(fg ? { fg } : {}), ...attributes };
  };
  const heading = style("accent", { bold: true });
  return SyntaxStyle.fromStyles({
    default: style("text"),
    "markup.heading": heading,
    "markup.heading.1": style("accent", { bold: true }),
    "markup.heading.2": style("info", { bold: true }),
    "markup.heading.3": style("warning", { bold: true }),
    "markup.heading.4": style("success", { bold: true }),
    "markup.heading.5": style("mutedText", { bold: true }),
    "markup.heading.6": style("danger", { bold: true }),
    "markup.strong": style("text", { bold: true }),
    "markup.italic": style("text", { italic: true }),
    "markup.strikethrough": style("mutedText", { dim: true }),
    "markup.raw": style("info"),
    "markup.raw.block": style("info"),
    "markup.link": style("info", { underline: true }),
    "markup.link.label": style("info", { underline: true }),
    "markup.link.url": style("mutedText", { underline: true }),
    "markup.list": style("accent"),
    "markup.list.checked": style("success", { bold: true }),
    "markup.list.unchecked": style("mutedText"),
    "markup.quote": style("mutedText", { italic: true }),
    label: style("mutedText"),
    "punctuation.special": style("mutedText"),
  });
}

/** Run the alternate OpenTUI host over Pi RPC. `keating shell` remains intact. */
export async function launchOpenTui(cwd: string, initialPrompt?: string, options: OpenTuiOptions = {}): Promise<OpenTuiExitResult> {
  const presentationProfile = createTuiPresentationProfile();
  const configuredSurfaceColor = terminalSurfaceColor(presentationProfile);
  const surfaceColor: ColorInput | undefined = presentationProfile.design.colorMode === "none"
    ? RGBA.defaultBackground()
    : configuredSurfaceColor;
  const customBorderChars = presentationProfile.design.glyphMode === "ascii" ? ASCII_BORDER_CHARS : undefined;
  const textColor = openTuiColor(presentationProfile, "text");
  const mutedColor = openTuiColor(presentationProfile, "mutedText");
  const accentColor = openTuiColor(presentationProfile, "accent");
  const borderColor = mutedColor;
  const client = await launchRpcClient(cwd);
  const listSessions = options.listSessions ?? listProjectTuiSessions;
  const rpcUiActionDispatcher = options.uiActionDispatcher ? undefined : new RpcUiActionDispatcher(client);
  const journalStore = rpcUiActionDispatcher
    ? new UiActionJournalStore({ storage: new FileUiActionJournalStorage(cwd), dispatcher: rpcUiActionDispatcher })
    : undefined;
  const uiActionDispatcher: UiActionDispatcher | undefined = options.uiActionDispatcher ?? (journalStore ? {
    async dispatch(action, sourceDocument) {
      const outcome = await journalStore.dispatch(action, sourceDocument);
      if (!outcome.ok) throw new Error(outcome.recovery.message);
      return outcome.result;
    },
  } : undefined);
  let settle: ((result: OpenTuiExitResult) => void) | null = null;
  let settled = false;
  let detachRecoveryEvents: (() => void) | undefined;
  const result = new Promise<OpenTuiExitResult>((resolve) => { settle = resolve; });
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    // Disambiguate Ctrl+M from Enter on terminals that support the Kitty
    // keyboard protocol. Legacy terminals still retain the normal Enter path.
    useKittyKeyboard: { disambiguate: true, alternateKeys: true, allKeysAsEscapes: true },
    ...(surfaceColor ? { backgroundColor: surfaceColor } : {}),
    onDestroy: () => {
      detachRecoveryEvents?.();
      if (!settled) {
        settled = true;
        settle?.({ action: "exit" });
      }
      rpcUiActionDispatcher?.dispose();
      void client.stop();
    },
  });

  const shell = new BoxRenderable(renderer, {
    id: "keating-open-tui",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 0,
    ...(surfaceColor ? { backgroundColor: surfaceColor } : {}),
  });
  const header = new TextRenderable(renderer, {
    id: "keating-open-tui-header",
    content: headerText(EMPTY_HEADER_STATE, presentationProfile),
    fg: mutedColor,
    height: 1,
    width: "100%",
  });
  // Welcome state: the brand mark owns the empty workspace, then steps aside.
  const splash = new BoxRenderable(renderer, {
    id: "keating-open-tui-splash",
    flexGrow: 1,
    width: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 1,
  });
  const logo = new TextRenderable(renderer, {
    id: "keating-open-tui-logo",
    content: keatingLogoFrame(0, presentationProfile.design.glyphMode),
    fg: accentColor,
    height: keatingWordmarkHeight(presentationProfile.design.glyphMode),
  });
  const splashHint = new TextRenderable(renderer, {
    id: "keating-open-tui-splash-hint",
    content: "",
    fg: mutedColor,
    height: 2,
  });
  const indicator = new TextRenderable(renderer, {
    id: "keating-open-tui-indicator",
    content: "",
    fg: accentColor,
    height: 1,
    width: "100%",
    visible: false,
  });
  const status = new TextRenderable(renderer, {
    id: "keating-open-tui-status",
    content: "Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop",
    fg: mutedColor,
    height: 1,
    width: "100%",
  });
  const workspace = new BoxRenderable(renderer, {
    id: "keating-open-tui-workspace",
    flexGrow: 1,
    width: "100%",
    flexDirection: "row",
    gap: 1,
  });
  const scroll = new ScrollBoxRenderable(renderer, {
    id: "keating-open-tui-transcript-scroll",
    flexGrow: 1,
    border: false,
    paddingLeft: 1,
    paddingRight: 1,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    scrollbarOptions: presentationProfile.design.glyphMode === "ascii"
      ? { visible: false }
      : undefined,
  });
  const transcript = new MarkdownRenderable(renderer, {
    id: "keating-open-tui-transcript",
    content: "Ask a question, continue a learning goal, or type /shell for the classic Pi interface.",
    syntaxStyle: markdownSyntaxStyle(presentationProfile),
    fg: textColor,
    width: "100%",
    conceal: true,
    concealCode: false,
    streaming: false,
    tableOptions: {
      style: "columns",
      widthMode: "full",
      columnFitter: "proportional",
      wrapMode: "word",
      borders: false,
      borderColor,
    },
  });
  const activityRail = new BoxRenderable(renderer, {
    id: "keating-open-tui-activity-rail",
    width: 30,
    height: "100%",
    border: ["left"],
    borderStyle: "single",
    customBorderChars,
    borderColor,
    paddingLeft: 2,
    paddingTop: 1,
  });
  const activity = new TextRenderable(renderer, {
    id: "keating-open-tui-activity",
    content: "SESSION\nnew session\n\nACTIVITY\n· No tool activity yet",
    fg: mutedColor,
    width: "100%",
  });
  const inputFrame = new BoxRenderable(renderer, {
    id: "keating-open-tui-input-frame",
    width: "100%",
    height: 3,
    border: true,
    borderStyle: presentationProfile.design.glyphMode === "ascii" ? "single" : "rounded",
    customBorderChars,
    borderColor: accentColor,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    gap: 1,
  });
  const inputPrompt = new TextRenderable(renderer, {
    id: "keating-open-tui-input-prompt",
    content: presentationProfile.design.glyphMode === "ascii" ? ">" : "›",
    fg: accentColor,
    width: 1,
    height: 1,
  });
  const input = new InputRenderable(renderer, {
    id: "keating-open-tui-input",
    flexGrow: 1,
    placeholder: presentationProfile.design.glyphMode === "ascii" ? "Message Keating..." : "Message Keating…",
    textColor,
    placeholderColor: mutedColor,
    backgroundColor: surfaceColor,
    focusedBackgroundColor: surfaceColor,
    focusedTextColor: textColor,
  });

  scroll.add(transcript);
  activityRail.add(activity);
  workspace.add(scroll);
  workspace.add(activityRail);
  inputFrame.add(inputPrompt);
  inputFrame.add(input);
  splash.add(logo);
  splash.add(splashHint);
  shell.add(header);
  shell.add(splash);
  shell.add(workspace);
  shell.add(indicator);
  shell.add(inputFrame);
  shell.add(status);
  renderer.root.add(shell);
  /**
   * The Three.js mark needs a WebGPU device. When there is none the flat
   * wordmark in `logo` already carries the splash, so a null result is silent.
   */
  const threeLogo = await tryCreateThreeLogo(renderer, {
    id: "keating-open-tui-three-logo",
    height: 8,
    edgeColor: presentationProfile.design.colors.accent?.truecolor ?? "#e7a04f",
    fillColor: configuredSurfaceColor ?? "#12160f",
  });
  if (threeLogo) splash.add(threeLogo, 0);

  const entries: TranscriptEntry[] = [];
  let streaming: TranscriptEntry | null = null;
  let headerState: TuiHeaderState = { ...EMPTY_HEADER_STATE };
  let headerLabel = "keating";
  let busy = false;
  let busyStartedAt: number | null = null;
  let activityPhase: ActivityPhase = "thinking";
  let activityDetail: string | undefined;
  let dialogCancel: (() => void) | null = null;
  let dialogFocusNext: (() => void) | null = null;
  let dialogFocusPrevious: (() => void) | null = null;
  let dialogSearchInput: InputRenderable | null = null;
  let dialogSelect: SelectRenderable | null = null;
  let knownPiCommands: ComposerCommand[] = [];
  const editorMode: TuiEditorMode = detectTuiEditorMode(process.env);
  let vimState: VimState = "insert";
  let focusArea: "composer" | "transcript" = "composer";
  let activeUiDocument: UiDocument | null = null;
  let activeUiControls: UiDocumentControl[] = [];
  let leaderActive = false;
  const promptRecovery = new TuiPromptRecovery(client);
  let currentLayout = terminalLayoutProfile(renderer.terminalWidth, renderer.terminalHeight);
  const retryHint = () => promptRecovery.draft === null ? "" : " · Ctrl+R retry preserved prompt";
  const idleStatus = () => {
    const shortcuts = currentLayout.compactStatus
      ? activeUiDocument
        ? `Ctrl+U actions (${activeUiControls.length}) · :m model · :p commands${retryHint()}`
        : `:m model · :p commands · :s sessions · /shell classic Pi${retryHint()}`
      : activeUiDocument
        ? `Ctrl+U document actions (${activeUiControls.length})  ·  :m model  ·  :p commands  ·  :s sessions  ·  :t thinking  ·  :n new${retryHint()}`
        : `:m model  ·  :p commands  ·  :s sessions  ·  :t thinking  ·  :n new  ·  :x stop${retryHint()}`;
    return `${editorModeLabel(editorMode, vimState)}  ·  ${shortcuts}`;
  };
  const setFocusArea = (next: "composer" | "transcript") => {
    focusArea = next;
    if (next === "composer") {
      input.focus();
      inputFrame.borderColor = accentColor ?? RGBA.defaultForeground();
      scroll.borderColor = borderColor ?? RGBA.defaultForeground();
      if (!busy) status.content = idleStatus();
    } else {
      scroll.focus();
      inputFrame.borderColor = borderColor ?? RGBA.defaultForeground();
      scroll.borderColor = accentColor ?? RGBA.defaultForeground();
      status.content = `${editorModeLabel(editorMode, vimState)}  ·  Transcript focused · Tab returns to composer · ↑/↓ scroll · Ctrl+F searches`;
    }
  };
  const setVimState = (next: VimState) => {
    vimState = next;
    input.cursorStyle = { style: next === "normal" ? "block" : "line", blinking: true };
    if (focusArea === "composer" && !busy) status.content = idleStatus();
  };
  const handleVimNormalKey = (keyName: string): boolean => {
    const action = vimNormalAction(keyName);
    if (!action) return false;
    switch (action) {
      case "insert":
        setVimState("insert");
        return true;
      case "append":
        input.moveCursorRight();
        setVimState("insert");
        return true;
      case "open-line":
        // The composer is intentionally single-line; `o` enters insert mode
        // at the current cursor instead of creating an impossible new line.
        setVimState("insert");
        return true;
      case "escape":
        return true;
      case "move-left":
        input.moveCursorLeft();
        return true;
      case "move-right":
        input.moveCursorRight();
        return true;
      case "move-up":
        input.moveCursorUp();
        return true;
      case "move-down":
        input.moveCursorDown();
        return true;
      case "line-home":
        input.gotoLineHome();
        return true;
      case "line-end":
        input.gotoLineEnd();
        return true;
      case "word-forward":
        input.moveWordForward();
        return true;
      case "word-backward":
        input.moveWordBackward();
        return true;
      case "delete":
        input.deleteChar();
        return true;
      case "undo":
        input.undo();
        return true;
    }
  };
  /** The welcome mark owns the workspace until the transcript has something in it. */
  const updateSplash = () => {
    const empty = entries.length === 0 && streaming === null;
    const roomForSplash = renderer.terminalHeight >= 16
      && renderer.terminalWidth >= keatingWordmarkWidth(presentationProfile.design.glyphMode) + 6;
    splash.visible = empty && roomForSplash;
    workspace.visible = !splash.visible;
  };
  /**
   * Re-parsing the whole transcript on every token is the expensive part of
   * streaming, so deltas coalesce onto one trailing frame instead.
   */
  let transcriptDirty = false;
  const paintTranscript = () => {
    transcriptDirty = false;
    transcript.streaming = streaming !== null;
    const transcriptWidth = renderer.terminalWidth
      - (2 * currentLayout.shellPadding)
      - (currentLayout.showActivityRail ? currentLayout.activityRailWidth + 1 : 0)
      - 4;
    transcript.content = transcriptMarkdown(entries, streaming, presentationProfile, transcriptWidth);
    activity.content = activityText(entries, headerState, presentationProfile, currentLayout.activityRailWidth);
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
    header.content = headerText(headerState, presentationProfile, {
      width: Math.max(20, renderer.terminalWidth - 2 * currentLayout.shellPadding),
      label: headerLabel,
    });
  };
  const appendEntry = (entry: TranscriptEntry) => {
    entries.push(entry);
    if (busy && entry.kind === "tool") {
      activityPhase = "tool";
      activityDetail = entry.title;
    }
    renderTranscript();
  };
  const updateResponsiveLayout = () => {
    currentLayout = terminalLayoutProfile(renderer.terminalWidth, renderer.terminalHeight);
    activityRail.visible = currentLayout.showActivityRail;
    activityRail.width = currentLayout.activityRailWidth;
    shell.padding = currentLayout.shellPadding;
    transcript.tableOptions = {
      ...transcript.tableOptions,
      style: currentLayout.transcriptTableStyle,
      borders: presentationProfile.design.colorMode !== "none"
        && presentationProfile.design.glyphMode === "unicode"
        && currentLayout.size === "wide",
    };
    splashHint.content = [
      `${cwd}`,
      currentLayout.compactStatus
        ? "Ctrl+P commands  ·  Ctrl+M model"
        : "Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+M model  ·  Ctrl+T thinking",
    ].join("\n");
    updateSplash();
    renderHeader();
    if (!busy) status.content = idleStatus();
  };
  updateResponsiveLayout();
  renderer.on(CliRenderEvents.RESIZE, updateResponsiveLayout);

  const motion = shouldAnimateLogo(process.env);
  let spinnerFrameIndex = 0;
  let spinnerElapsed = 0;
  let logoElapsed = 0;
  let logoFrame = 0;
  const paintIndicator = () => {
    indicator.visible = busy;
    if (!busy) return;
    indicator.content = activityIndicatorText({
      phase: activityPhase,
      detail: activityDetail,
      elapsedMs: busyStartedAt === null ? 0 : Date.now() - busyStartedAt,
      frame: spinnerFrameIndex,
      glyphMode: presentationProfile.design.glyphMode,
      hint: "Ctrl+X stops",
    });
  };
  renderer.setFrameCallback(async (deltaTime) => {
    if (transcriptDirty) paintTranscript();
    if (busy) {
      spinnerElapsed += deltaTime;
      if (spinnerElapsed >= SPINNER_INTERVAL_MS) {
        spinnerElapsed = 0;
        if (motion) spinnerFrameIndex += 1;
        paintIndicator();
      }
    }
    if (!motion || !splash.visible) return;
    logoElapsed += deltaTime;
    if (logoElapsed < 900) return;
    logoElapsed = 0;
    logoFrame += 1;
    logo.content = keatingLogoFrame(logoFrame, presentationProfile.design.glyphMode);
  });

  const presentSelect = (title: string, options: string[], presentation: SelectPresentationOptions = {}): Promise<string | undefined> =>
    new Promise((resolve) => {
      const overlayWidth = Math.max(24, Math.floor(renderer.terminalWidth * 0.8));
      const innerWidth = Math.max(12, overlayWidth - 4);
      const titleLines = overlayTitleLines(title, innerWidth, 2);
      const hint = truncateOverlayLabel("type to filter · Tab/↑/↓ or j/k navigate · Enter selects · Esc cancels", innerWidth);
      const optionName = (option: string) => truncateOverlayLabel(option, Math.max(8, innerWidth - 2));
      const modal = new BoxRenderable(renderer, {
        id: `keating-dialog-${Date.now()}`,
        width: "80%",
        height: Math.min(Math.max(options.length + titleLines.length + 5, 8), Math.max(10, renderer.terminalHeight - 6)),
        position: "absolute",
        top: "10%",
        left: "10%",
        zIndex: 30,
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        customBorderChars,
        borderColor: accentColor,
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: [...titleLines, hint].join("\n"),
        fg: accentColor,
        height: titleLines.length + 1,
      });
      const filterInput = new InputRenderable(renderer, {
        id: `keating-select-filter-${Date.now()}`,
        width: "100%",
        placeholder: "Filter options…",
        textColor,
        placeholderColor: mutedColor,
        backgroundColor: surfaceColor,
        focusedBackgroundColor: surfaceColor,
        focusedTextColor: textColor,
      });
      const select = new SelectRenderable(renderer, {
        id: `keating-select-${Date.now()}`,
        flexGrow: 1,
        options: options.map((option) => ({ name: optionName(option), description: presentation.descriptions?.get(option) ?? "", value: option })),
        showDescription: presentation.showDescription ?? false,
        wrapSelection: true,
        selectedBackgroundColor: accentColor,
        selectedTextColor: surfaceColor ?? RGBA.defaultBackground(),
      });
      const paintSelectedResponse = () => {
        const value = select.getSelectedOption()?.value;
        const role = overlayResponseTone(typeof value === "string" ? value : "");
        select.selectedBackgroundColor = openTuiColor(presentationProfile, role) ?? RGBA.defaultForeground();
      };
      modal.add(titleView);
      modal.add(filterInput);
      modal.add(select);
      shell.add(modal);
      let done = false;
      const finish = (value?: string) => {
        if (done) return;
        done = true;
        dialogCancel = null;
        dialogFocusNext = null;
        dialogFocusPrevious = null;
        dialogSearchInput = null;
        dialogSelect = null;
        shell.remove(modal);
        setFocusArea("composer");
        resolve(value);
      };
      const updateOptions = () => {
        const ranked = filterSearchOptions(options.map((option): SearchOption => ({ label: option, value: option })), filterInput.value);
        select.options = ranked.length > 0
          ? ranked.map((option) => ({ name: optionName(option.label), description: presentation.descriptions?.get(option.label) ?? "", value: option.value }))
          : [{ name: "No matching options", description: "Clear the filter or press Esc", value: undefined }];
        select.setSelectedIndex(0);
        paintSelectedResponse();
      };
      filterInput.on(InputRenderableEvents.INPUT, updateOptions);
      filterInput.on(InputRenderableEvents.ENTER, () => select.focus());
      dialogCancel = () => finish(undefined);
      dialogSearchInput = filterInput;
      dialogSelect = select;
      dialogFocusNext = () => select.focus();
      dialogFocusPrevious = () => filterInput.focus();
      select.on(SelectRenderableEvents.SELECTION_CHANGED, paintSelectedResponse);
      select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
        const value = select.getSelectedOption()?.value;
        if (typeof value === "string") finish(value);
      });
      paintSelectedResponse();
      if (presentation.initialFocus === "list") select.focus();
      else filterInput.focus();
    });

  const presentTextInput = (title: string, prefill?: string, placeholder?: string): Promise<string | undefined> =>
    new Promise((resolve) => {
      const overlayWidth = Math.max(24, Math.floor(renderer.terminalWidth * 0.8));
      const innerWidth = Math.max(12, overlayWidth - 4);
      const titleLines = overlayTitleLines(title, innerWidth, 2);
      const hint = truncateOverlayLabel("Enter submits · Esc cancels", innerWidth);
      const modal = new BoxRenderable(renderer, {
        id: `keating-input-dialog-${Date.now()}`,
        width: "80%",
        height: titleLines.length + 4,
        position: "absolute",
        top: "30%",
        left: "10%",
        zIndex: 30,
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        customBorderChars,
        borderColor: accentColor,
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: [...titleLines, hint].join("\n"),
        fg: accentColor,
        height: titleLines.length + 1,
      });
      const dialogInput = new InputRenderable(renderer, {
        id: `keating-dialog-input-${Date.now()}`,
        width: "100%",
        value: prefill ?? "",
        placeholder: placeholder ?? "Type a response…",
        textColor,
        placeholderColor: mutedColor,
        backgroundColor: surfaceColor,
        focusedBackgroundColor: surfaceColor,
        focusedTextColor: textColor,
      });
      modal.add(titleView);
      modal.add(dialogInput);
      shell.add(modal, 3);
      let done = false;
      const finish = (value?: string, preserveInComposer = false) => {
        if (done) return;
        done = true;
        dialogCancel = null;
        dialogFocusNext = null;
        dialogFocusPrevious = null;
        dialogSearchInput = null;
        dialogSelect = null;
        shell.remove(modal);
        if (value === undefined && preserveInComposer && dialogInput.value) {
          input.value = dialogInput.value;
          status.content = "Draft preserved in composer. Edit it or reopen document actions with Ctrl+U.";
        }
        setFocusArea("composer");
        resolve(value);
      };
      dialogCancel = () => finish(undefined, true);
      dialogFocusNext = () => dialogInput.focus();
      dialogFocusPrevious = () => dialogInput.focus();
      dialogInput.on(InputRenderableEvents.ENTER, () => finish(dialogInput.value));
      dialogInput.focus();
    });

  const surface: HostSurface = {
    hydrateEntries(next) { entries.splice(0, entries.length, ...next); renderTranscript(); },
    appendEntry,
    setStreaming(entry) {
      streaming = entry;
      if (entry) {
        activityPhase = "responding";
        activityDetail = undefined;
      }
      renderTranscript();
      paintIndicator();
    },
    setStatus(text) { status.content = text; },
    setHeaderState(next) {
      headerState = { ...headerState, ...next };
      const wasBusy = busy;
      busy = headerState.busy;
      if (busy && !wasBusy) {
        busyStartedAt = Date.now();
        activityPhase = "thinking";
        activityDetail = undefined;
        spinnerFrameIndex = 0;
      } else if (!busy) {
        busyStartedAt = null;
        activityDetail = undefined;
        indicator.visible = false;
      }
      renderHeader();
      renderTranscript();
      status.content = busy
        ? "Keating is thinking…  ·  Enter queues a follow-up  ·  Ctrl+X stops  ·  Ctrl+U document actions"
        : idleStatus();
      paintIndicator();
    },
    setEditorText(text) { input.value = text; },
    setWidget(key, lines, placement) {
      if (lines?.length) appendEntry({
        id: `widget-${key}-${Date.now()}`,
        kind: "artifact",
        title: key,
        body: lines.join("\n"),
        detail: placement,
      });
    },
    setTitle(title) { headerLabel = title || "KEATING"; renderHeader(); },
    setUiDocument(document, controls) {
      activeUiDocument = document;
      activeUiControls = [...controls];
      if (!busy) status.content = document
        ? `Document ready: ${document.title || document.id}. Ctrl+U opens ${activeUiControls.length} action${activeUiControls.length === 1 ? "" : "s"}.`
        : idleStatus();
    },
    presentSelect,
    presentConfirm(title, message) { return presentSelect(`${title}\n${message}`, ["Yes", "No"]).then((value) => value === undefined ? undefined : value === "Yes"); },
    presentInput(title, placeholder) { return presentTextInput(title, undefined, placeholder); },
    presentEditor(title, prefill) { return presentTextInput(title, prefill, "Edit response…"); },
  };
  const restorePendingDraft = (reason: string, title = "Exact draft restored"): string | null => {
    const restored = promptRecovery.failPending();
    if (restored === null) return null;
    input.value = restored;
    appendEntry({
      id: `prompt-recovery-${Date.now()}`,
      kind: "notice",
      title,
      body: `${sanitizeDiagnostic(reason)}\n\nEdit the restored composer text, press Ctrl+R to retry, open /settings, or use /shell with this same session.`,
    });
    status.content = "Response did not complete. Exact draft restored · Ctrl+R retries · /settings or /shell repairs access.";
    return restored;
  };
  let terminalResponseError: string | null = null;
  detachRecoveryEvents = client.onEvent((event) => {
    const candidate = event as {
      type?: string;
      message?: { role?: string; stopReason?: string; errorMessage?: string };
      toolName?: string;
    } | null;
    if (!candidate || typeof candidate !== "object") return;
    if (candidate.type === "agent_start") {
      terminalResponseError = null;
      activityPhase = "thinking";
      activityDetail = undefined;
      return;
    }
    if (candidate.type === "message_update" && candidate.message?.role === "assistant") {
      activityPhase = "responding";
      activityDetail = undefined;
      return;
    }
    if (candidate.type === "tool_execution_start") {
      activityPhase = "tool";
      activityDetail = candidate.toolName || "tool";
      return;
    }
    if (candidate.type === "tool_execution_end") {
      activityPhase = "thinking";
      activityDetail = undefined;
      return;
    }
    if (candidate.type === "message_end" && candidate.message?.role === "assistant") {
      terminalResponseError = candidate.message.stopReason === "error" || candidate.message.stopReason === "aborted"
        ? candidate.message.errorMessage || candidate.message.stopReason
        : null;
      return;
    }
    if (candidate.type !== "agent_end") return;
    if (!terminalResponseError) {
      promptRecovery.completePending();
      return;
    }
    restorePendingDraft(terminalResponseError);
  });
  const controller = new HostController(client, surface, { uiActionDispatcher });
  controller.attach();
  await controller.initialize();
  try {
    knownPiCommands = (await client.getCommands?.() ?? []).map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      ...(command.source ? { source: command.source } : {}),
    }));
  } catch {
    knownPiCommands = [];
  }

  const exitToShell = async () => {
    settled = true;
    settle?.({ action: "shell", sessionPath: controller.getCurrentSessionPath() || undefined });
    renderer.destroy();
    await client.stop();
  };

  const runCommand = async (command: TuiCommand): Promise<void> => {
    switch (command.id) {
      case "setup":
        await showSetupWizard();
        return;
      case "sessions":
        await showSessions();
        return;
      case "library":
        await showLibrary();
        return;
      case "review":
        await showReview();
        return;
      case "courses":
        await showCourses();
        return;
      case "share":
        await showShareSession();
        return;
      case "settings":
        await showSettings();
        return;
      case "model":
        await showModelPicker();
        return;
      case "thinking":
        await controller.cycleThinking();
        return;
      case "new-session": {
        const confirmed = entries.length === 0
          ? true
          : await surface.presentConfirm("Start a new session?", "Your current session remains saved and can be reopened in Pi.");
        if (confirmed) await controller.newSession();
        return;
      }
      case "abort":
        await controller.abort();
        restorePendingDraft("The response was stopped before completion.", "Stopped draft restored");
        return;
      case "retry":
        await retryLastPrompt();
        return;
      case "shell":
        await exitToShell();
    }
  };
  const runCommandAndRefocus = async (command: TuiCommand): Promise<void> => {
    await runCommand(command);
    if (!settled) setFocusArea("composer");
  };

  const showShareSession = async (): Promise<void> => {
    if (busySurfaceNotice("Session sharing")) return;
    const confirmed = await surface.presentConfirm(
      "Publish a read-only session?",
      "This sends the user and assistant text in the current session to the configured Keating share server. Tool calls, credentials, and local files are excluded.",
    );
    if (!confirmed) return;
    status.content = "Publishing read-only session…";
    try {
      const shared = await publishTuiSession(await client.getMessages(), {
        model: headerState.model,
        thinking: headerState.thinking,
      });
      input.value = shared.url;
      appendEntry({
        id: `share-${shared.id}`,
        kind: "artifact",
        title: "Session shared",
        body: `${shared.url}\n\n${shared.messageCount} text message${shared.messageCount === 1 ? "" : "s"} published as a read-only web session. The link is also in the composer for copying.`,
      });
    } catch (error) {
      appendEntry({
        id: `share-error-${Date.now()}`,
        kind: "error",
        title: "Session was not shared",
        body: `${sanitizeDiagnostic(error)}\n\nNo public link was created. Set KEATING_SHARE_ORIGIN to a reachable Keating web deployment, then retry from Ctrl+P.`,
      });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showModelPicker = async (): Promise<void> => {
    if (busySurfaceNotice("Model selection")) return;
    status.content = "Loading authenticated Pi models…";
    try {
      const models = await client.getAvailableModels();
      if (models.length === 0) {
        appendEntry({
          id: `models-empty-${Date.now()}`,
          kind: "notice",
          title: "No authenticated models",
          body: "Pi returned no models with configured credentials. Use /shell or /settings to repair provider access, then reopen the model picker.",
        });
        return;
      }
      const current = models.find((model) => `${model.provider}/${model.id}` === headerState.model);
      const providers = modelProviderChoices(models, current?.provider);
      const connectProvider = "+ Connect or repair a provider";
      const providerLabels = [...providers.map((provider) => provider.label), connectProvider];
      const selectedProvider = await presentSelect(modelPickerTitle(models), providerLabels, {
        descriptions: new Map(providers.map((provider) => [provider.label, provider.description])),
        showDescription: true,
        initialFocus: "list",
      });
      if (selectedProvider === undefined) return;
      if (selectedProvider === connectProvider) {
        const target = await presentSelect("Provider sign-in", ["anthropic", "openai-codex", "openai", "google", "openrouter", "zyphra", "minimax", "Cancel"]);
        if (!target || target === "Cancel") return;
        input.value = "/shell";
        appendEntry({
          id: `provider-login-${Date.now()}`,
          kind: "notice",
          title: `Connect ${target}`,
          body: `/shell is ready in the composer. Submit it, then run /login ${target}. Return to OpenTUI and use :m; the complete authenticated catalog will refresh without exposing credentials here.`,
        });
        return;
      }
      const provider = providers.find((candidate) => candidate.label === selectedProvider);
      if (!provider) return;
      const choices = modelChoices(models.filter((model) => model.provider === provider.provider), current);
      const selected = await presentSelect(`${provider.provider} · all ${choices.length} configured model${choices.length === 1 ? "" : "s"}`, choices.map((choice) => choice.label), {
        descriptions: new Map(choices.map((choice) => [choice.label, choice.description])),
        showDescription: false,
      });
      if (selected === undefined) return;
      const choice = choices.find((candidate) => candidate.label === selected);
      if (!choice) return;
      await controller.setModel(choice.model.provider, choice.model.id);
    } catch (error) {
      appendEntry({
        id: `models-error-${Date.now()}`,
        kind: "error",
        title: "Model picker unavailable",
        body: `${sanitizeDiagnostic(error)}\n\nNo model was changed. Use /shell or /settings for provider recovery, then retry.`,
      });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showSetupWizard = async (): Promise<void> => {
    if (busySurfaceNotice("Setup")) return;
    const begin = await surface.presentConfirm(
      "Set up Keating?",
      "This checks connected providers, lets you choose from the complete authenticated model catalog, and applies runtime preferences. Secrets stay in Pi's /login flow.",
    );
    if (!begin) return;
    const models = await client.getAvailableModels();
    if (models.length === 0) {
      const recovery = await presentSelect("No connected provider", ["Prepare secure /login in classic Pi", "Continue with local interface tour", "Cancel"]);
      if (recovery === "Prepare secure /login in classic Pi") {
        input.value = "/shell";
        appendEntry({ id: `setup-provider-${Date.now()}`, kind: "notice", title: "Provider sign-in prepared", body: "Submit /shell, then run /login for your provider. Reopen /setup afterward; credentials are never entered into this unmasked composer." });
        return;
      }
      if (recovery !== "Continue with local interface tour") return;
    } else {
      await showModelPicker();
    }
    const thinking = await presentSelect("Thinking effort", ["off", "minimal", "low", "medium", "high", "xhigh"]);
    if (thinking) await client.setThinkingLevel(thinking);
    const defaults = await presentSelect("Runtime behavior", ["Recommended · retry on, compaction on, queues all", "Keep current runtime behavior"]);
    if (defaults?.startsWith("Recommended")) {
      await Promise.all([
        client.setAutoRetry(true),
        client.setAutoCompaction(true),
        client.setSteeringMode("all"),
        client.setFollowUpMode("all"),
      ]);
    }
    await markTuiOnboardingSeen(cwd, KEATING_VERSION);
    appendEntry({
      id: `setup-complete-${Date.now()}`,
      kind: "notice",
      title: "Keating setup complete",
      body: [
        `${models.length} authenticated model${models.length === 1 ? "" : "s"} detected.`,
        thinking ? `Thinking set to ${thinking}.` : "Thinking was not changed.",
        "Use :m for models, :p for every command, @path for files, and /setup to run this again.",
        "Share publishes only after explicit confirmation and requires KEATING_SHARE_ORIGIN.",
      ].join("\n\n"),
    });
  };

  const showSessions = async (): Promise<void> => {
    if (busy) {
      appendEntry({
        id: `sessions-busy-${Date.now()}`,
        kind: "notice",
        title: "Sessions unavailable while responding",
        body: "Stop the active response with Ctrl+X, then open Sessions again. Your conversation remains saved.",
      });
      return;
    }
    status.content = "Loading project sessions…";
    try {
      const items = tuiSessionItems(await listSessions(cwd), controller.getCurrentSessionPath());
      if (items.length === 0) {
        appendEntry({
          id: `sessions-empty-${Date.now()}`,
          kind: "notice",
          title: "No saved sessions",
          body: "This project has no persisted Pi sessions yet. Send a prompt to create one.",
        });
        return;
      }
      const sessionOptions = items.map((item, index) => sessionOption(item, index));
      const selected = await presentSelect("Sessions · active and fork lineage are labelled", sessionOptions);
      if (selected === undefined) return;
      const item = items[sessionOptions.indexOf(selected)];
      if (!item) return;

      const action = await presentSelect(
        `${item.title}${item.parentSessionPath ? " · forked session" : " · original session"}`,
        [...SESSION_ACTIONS],
      );
      if (action === undefined || action === "Cancel") return;
      if (action === "Resume session") {
        await controller.resumeSession(item.path);
        return;
      }
      if (action === "Resume and rename") {
        if (!await controller.resumeSession(item.path)) return;
        const name = await presentTextInput("Rename active session", item.name || item.title, "Session name…");
        if (name !== undefined) await controller.renameCurrentSession(name);
        return;
      }
      if (action === "Fork whole current branch") {
        if (await controller.resumeSession(item.path)) await controller.cloneCurrentSession();
        return;
      }
      if (action === "Fork from an earlier turn") {
        if (!await controller.resumeSession(item.path)) return;
        const messages = await controller.forkMessages();
        if (messages.length === 0) {
          appendEntry({
            id: `fork-empty-${Date.now()}`,
            kind: "notice",
            title: "No forkable turns",
            body: "This session does not yet contain an earlier learner turn that Pi can fork.",
          });
          return;
        }
        const messageOptions = messages.map(forkMessageOption);
        const selectedMessage = await presentSelect("Fork from earlier turn · original remains saved", messageOptions);
        if (selectedMessage === undefined) return;
        const message = messages[messageOptions.indexOf(selectedMessage)];
        if (message) await controller.forkFromMessage(message.entryId);
      }
    } catch (error) {
      appendEntry({
        id: `sessions-error-${Date.now()}`,
        kind: "error",
        title: "Could not load sessions",
        body: `${sanitizeDiagnostic(error)}\n\nThe active session and composer were not changed. Retry or use /shell.`,
      });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const busySurfaceNotice = (surfaceName: string): boolean => {
    if (!busy) return false;
    appendEntry({
      id: `${surfaceName.toLowerCase()}-busy-${Date.now()}`,
      kind: "notice",
      title: `${surfaceName} unavailable while responding`,
      body: `Stop the active response with Ctrl+X, then open ${surfaceName} again. Your conversation remains saved.`,
    });
    return true;
  };

  const sourceBlock = (label: string, source: string): string => {
    const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    return `Source-only preview (${label}); terminal did not execute it.\n\n${fence}\n${source}\n${fence}`;
  };

  const showLibrary = async (): Promise<void> => {
    if (busySurfaceNotice("Library")) return;
    status.content = "Loading artifact library…";
    try {
      const artifacts = await listTuiLibraryArtifacts(cwd);
      if (artifacts.length === 0) {
        appendEntry({ id: `library-empty-${Date.now()}`, kind: "notice", title: "Library is empty", body: "Generated plans, maps, decks, exports, benchmarks, and other artifacts will appear here." });
        return;
      }
      const artifactOptions = artifacts.map(libraryArtifactOption);
      const selected = await presentSelect("Library · newest artifacts first", artifactOptions);
      if (selected === undefined) return;
      const artifact = artifacts[artifactOptions.indexOf(selected)];
      if (!artifact) return;
      const action = await presentSelect(artifact.path, ["Open preview", "Copy path to composer", "Export copy", "Move to recoverable trash", "Cancel"]);
      if (action === undefined || action === "Cancel") return;
      if (action === "Open preview") {
        const preview = await previewTuiArtifact(cwd, artifact.path);
        appendEntry({
          id: `library-preview-${Date.now()}`,
          kind: "artifact",
          title: artifact.path,
          body: preview.kind === "text"
            ? preview.sourceOnly ? sourceBlock(artifact.path, preview.content) : preview.content
            : `${preview.message}\n\nSaved path: ${preview.path}`,
          detail: preview.kind === "text" && !preview.sourceOnly ? "Rendered through terminal Markdown" : "Safe handoff",
        });
        return;
      }
      if (action === "Copy path to composer") {
        input.value = artifact.path;
        appendEntry({
          id: `library-copy-${Date.now()}`,
          kind: "notice",
          title: "Artifact path prepared",
          body: `${artifact.path}\n\nThe path is in the composer. Edit or send it when ready.`,
        });
        return;
      }
      if (action === "Export copy") {
        const exported = await exportTuiArtifact(cwd, artifact.path);
        appendEntry({ id: `library-export-${Date.now()}`, kind: "notice", title: "Artifact exported", body: `Saved a separate copy at ${exported}. The source remains unchanged.` });
        return;
      }
      if (action === "Move to recoverable trash") {
        const confirmed = await surface.presentConfirm("Move artifact to trash?", `${artifact.path}\n\nThe file leaves the Library but remains recoverable under .keating/state/trash/.`);
        if (!confirmed) return;
        const trashPath = await trashTuiArtifact(cwd, artifact.path);
        appendEntry({ id: `library-trash-${Date.now()}`, kind: "notice", title: "Artifact moved to trash", body: `Recoverable path: ${trashPath}` });
      }
    } catch (error) {
      appendEntry({ id: `library-error-${Date.now()}`, kind: "error", title: "Library action failed", body: `${sanitizeDiagnostic(error)}\n\nNo successful-looking fallback was applied. Retry or use /shell with the preserved path.` });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showReview = async (): Promise<void> => {
    if (busySurfaceNotice("Review")) return;
    status.content = "Loading review queue…";
    try {
      const now = new Date().toISOString();
      const dashboard = await loadTuiReviewDashboard(cwd, now);
      appendEntry({
        id: `review-summary-${Date.now()}`,
        kind: "artifact",
        title: "Review queue",
        body: [
          `${dashboard.dueCards.length} observed card${dashboard.dueCards.length === 1 ? "" : "s"} due across ${dashboard.cards.length} saved card${dashboard.cards.length === 1 ? "" : "s"}.`,
          `${dashboard.dueTopics.length} topic${dashboard.dueTopics.length === 1 ? "" : "s"} estimated due from local learner history.`,
          "",
          dashboard.provenance,
        ].join("\n"),
      });

      if (dashboard.dueCards.length > 0) {
        const cardOptions = dashboard.dueCards.map((card, index) => reviewCardOption(card, index, now));
        const selected = await presentSelect("Due cards · schedule order", cardOptions);
        if (selected === undefined) return;
        const card = dashboard.dueCards[cardOptions.indexOf(selected)];
        if (!card) return;
        const reveal = await presentSelect(`Question\n${card.front}`, ["Reveal answer", "Cancel"]);
        if (reveal !== "Reveal answer") return;
        const ratingOption = await presentSelect(`Answer\n${card.back}`, ["0 · Again", "1 · Hard", "2 · Good", "3 · Easy", "Cancel"]);
        if (!ratingOption || ratingOption === "Cancel") return;
        const rating = Number(ratingOption[0]) as SrsRating;
        const outcome = await rateTuiReviewCard(cwd, card, rating, now);
        appendEntry({
          id: `review-rated-${Date.now()}`,
          kind: "notice",
          title: "Review recorded",
          body: `${card.front}\n\nRating: ${ratingOption.slice(4)} · next review ${formatDueIn(outcome.next.dueAt, now)}.`,
        });
        return;
      }

      if (dashboard.dueTopics.length > 0) {
        const topicOptions = dashboard.dueTopics.map((topic, index) => `${index + 1}. ${topic.title} · estimated retention ${(topic.estimatedRetention * 100).toFixed(0)}% · ${Math.floor(topic.daysSinceLastSeen)}d since seen`);
        const selected = await presentSelect("No saved due cards · generate a deck for an estimated-due topic", topicOptions);
        if (selected === undefined) return;
        const topic = dashboard.dueTopics[topicOptions.indexOf(selected)];
        if (!topic) return;
        const confirmed = await surface.presentConfirm("Generate review cards?", `Generate a deterministic local deck for ${topic.title}? Topic urgency is estimated, not proven mastery.`);
        if (!confirmed) return;
        const generated = await flashcardsTopicArtifact(cwd, topic.slug);
        appendEntry({ id: `review-generated-${Date.now()}`, kind: "artifact", title: "Review deck generated", body: `Saved ${generated.flashcardsPath}. Reopen Review to begin the now-due cards.` });
        return;
      }

      appendEntry({ id: `review-empty-${Date.now()}`, kind: "notice", title: "Nothing due", body: "No saved cards or locally estimated topics need review right now." });
    } catch (error) {
      appendEntry({ id: `review-error-${Date.now()}`, kind: "error", title: "Review unavailable", body: `${sanitizeDiagnostic(error)}\n\nNo review state was changed. Repair the local schedule or use /shell, then retry.` });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showSettings = async (): Promise<void> => {
    if (busySurfaceNotice("Settings")) return;
    status.content = "Loading runtime settings…";
    try {
      const [stateResult, modelsResult, commandsResult] = await Promise.allSettled([
        client.getState(), client.getAvailableModels(), client.getCommands(),
      ]);
      const settings = tuiRuntimeSettings(
        stateResult.status === "fulfilled" ? stateResult.value : {},
        modelsResult.status === "fulfilled" ? modelsResult.value.length : 0,
        commandsResult.status === "fulfilled" ? commandsResult.value.map((command) => command.name) : [],
      );
      appendEntry({ id: `settings-summary-${Date.now()}`, kind: "artifact", title: "Settings", body: tuiSettingsMarkdown(settings) });
      const action = await presentSelect("Terminal settings · changes apply to the real Pi runtime", [...TUI_SETTINGS_ACTIONS]);
      if (action === undefined || action === "Close settings") return;
      if (action === "Select model") await showModelPicker();
      else if (action === "Cycle thinking") await controller.cycleThinking();
      else if (action === "Toggle automatic retry") {
        await client.setAutoRetry(!settings.autoRetry);
        appendEntry({ id: `settings-retry-${Date.now()}`, kind: "notice", title: "Automatic retry changed", body: settings.autoRetry ? "Off" : "On" });
      } else if (action === "Toggle automatic compaction") {
        await client.setAutoCompaction(!settings.autoCompaction);
        appendEntry({ id: `settings-compaction-${Date.now()}`, kind: "notice", title: "Automatic compaction changed", body: settings.autoCompaction ? "Off" : "On" });
      } else if (action === "Toggle steering queue mode") {
        const mode = settings.steeringMode === "all" ? "one-at-a-time" : "all";
        await client.setSteeringMode(mode);
        appendEntry({ id: `settings-steering-${Date.now()}`, kind: "notice", title: "Steering queue changed", body: mode });
      } else if (action === "Toggle follow-up queue mode") {
        const mode = settings.followUpMode === "all" ? "one-at-a-time" : "all";
        await client.setFollowUpMode(mode);
        appendEntry({ id: `settings-followup-${Date.now()}`, kind: "notice", title: "Follow-up queue changed", body: mode });
      } else if (action === "Prepare /shell provider or code handoff") {
        input.value = "/shell";
        appendEntry({
          id: `settings-shell-${Date.now()}`,
          kind: "notice",
          title: "Classic Pi handoff prepared",
          body: "/shell is in the composer. Submit when ready; OpenTUI has not mutated source or credentials.",
        });
      }
    } catch (error) {
      appendEntry({ id: `settings-error-${Date.now()}`, kind: "error", title: "Settings change failed", body: `${sanitizeDiagnostic(error)}\n\nThe prior runtime setting remains in effect. Retry or prepare /shell for provider recovery.` });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showTranscriptSearch = async (): Promise<void> => {
    if (entries.length === 0) {
      appendEntry({ id: `search-empty-${Date.now()}`, kind: "notice", title: "Transcript is empty", body: "Send a prompt first, then press Ctrl+F to search titles and Markdown bodies." });
      return;
    }
    const options = entries.map((entry, index) => `${index + 1}. ${entry.title} · ${entry.body.replace(/\s+/g, " ").slice(0, 100)}`);
    const selected = await presentSelect("Transcript search · Enter jumps to a matching turn", options);
    if (selected === undefined) return;
    const index = options.indexOf(selected);
    if (index < 0) return;
    // MarkdownRenderable owns exact geometry, so use its scroll height as a
    // safe proportional target instead of pretending every entry is one row.
    const target = entries.length <= 1 ? 0 : Math.round((index / (entries.length - 1)) * scroll.scrollHeight);
    scroll.scrollTo({ y: target, x: 0 });
    setFocusArea("transcript");
    status.content = `Showing transcript match ${index + 1}/${entries.length} · Ctrl+F searches again`;
  };

  const showCourses = async (): Promise<void> => {
    if (busySurfaceNotice("Courses")) return;
    status.content = "Loading courses…";
    try {
      const courses = await listTuiCourses(cwd);
      if (courses.length === 0) {
        appendEntry({
          id: `courses-empty-${Date.now()}`,
          kind: "notice",
          title: "No courses available",
          body: "Add a course JSON snapshot under .keating/courses/ or set KEATING_COURSES_ORIGIN for a hosted read-through. The web course workspace remains available through /shell or keating web.",
        });
        return;
      }
      const courseOptions = courses.map(courseOption);
      const selected = await presentSelect("Courses · type to filter", courseOptions);
      if (selected === undefined) return;
      const course = courses[courseOptions.indexOf(selected)];
      if (!course) return;
      appendEntry({ id: `course-${Date.now()}`, kind: "artifact", title: course.title, body: courseMarkdown(course), detail: course.source === "remote" ? "Hosted course snapshot" : "Local course snapshot" });
      const lessons = course.modules.flatMap((module): Array<{ module: TuiCourseModule; lesson: TuiCourseLesson }> => module.lessons.map((lesson) => ({ module, lesson })));
      if (lessons.length === 0) {
        status.content = idleStatus();
        return;
      }
      const lessonOptions = lessons.map(({ module, lesson }, index) => courseLessonOption(module, lesson, index));
      const lessonSelection = await presentSelect(`${course.title} · choose a lesson`, lessonOptions);
      if (lessonSelection === undefined) return;
      const lessonIndex = lessonOptions.indexOf(lessonSelection);
      const selectedLesson = lessons[lessonIndex]?.lesson;
      if (!selectedLesson) return;
      const action = await presentSelect(`${selectedLesson.title} · ${course.title}`, ["Start lesson in composer", "Show lesson here", "Cancel"]);
      if (action === "Start lesson in composer") {
        input.value = courseLessonPrompt(course, selectedLesson);
        appendEntry({ id: `course-prompt-${Date.now()}`, kind: "notice", title: "Lesson prepared", body: "The lesson prompt is in the composer. Edit it, then press Enter." });
      } else if (action === "Show lesson here") {
        appendEntry({ id: `course-lesson-${Date.now()}`, kind: "artifact", title: selectedLesson.title, body: [selectedLesson.summary, selectedLesson.reading, selectedLesson.exercise ? `**Exercise:** ${selectedLesson.exercise.prompt}` : ""].filter(Boolean).join("\n\n") });
      }
    } catch (error) {
      appendEntry({ id: `courses-error-${Date.now()}`, kind: "error", title: "Courses unavailable", body: `${sanitizeDiagnostic(error)}\n\nNo course state was changed. Add a local snapshot or use /shell for the hosted course workspace.` });
    } finally {
      if (!busy && !dialogCancel) status.content = idleStatus();
    }
  };

  const showCommandPalette = async () => {
    const localOptions = TUI_COMMANDS.map(commandOption);
    const piCommands = knownPiCommands
      .filter((command) => !TUI_COMMANDS.some((local) => local.id === command.name.replace(/^\//, "")))
    const piOptions = piCommands.map((command) => `/${command.name.replace(/^\//, "")}  —  ${command.description ?? "Pi command"}`);
    const options = [...localOptions, ...piOptions];
    const selected = await presentSelect("Keating commands", options);
    const index = selected === undefined ? -1 : options.indexOf(selected);
    if (index < 0) return;
    if (index < TUI_COMMANDS.length) {
      await runCommandAndRefocus(TUI_COMMANDS[index]!);
      return;
    }
    const command = piCommands[index - TUI_COMMANDS.length];
    if (command) {
      input.value = `/${command.name.replace(/^\//, "")} `;
      setFocusArea("composer");
    }
  };

  const showUiActions = async () => {
    if (!activeUiDocument) {
      appendEntry({ id: `ui-none-${Date.now()}`, kind: "notice", title: "No active document", body: "Interactive document controls appear here when Keating sends a canonical UI document." });
      return;
    }
    if (activeUiControls.length === 0) {
      appendEntry({ id: `ui-readonly-${Date.now()}`, kind: "notice", title: "Document is read-only", body: "This document has no applicable terminal actions in its current lifecycle." });
      return;
    }
    const options = activeUiControls.map((control, index) => `${index + 1}. ${control.label}${control.description ? ` — ${control.description}` : ""}`);
    const selected = await presentSelect(`${activeUiDocument.title || "Document"} actions`, options);
    if (selected === undefined) return;
    const index = options.indexOf(selected);
    const control = activeUiControls[index];
    if (control) await control.run();
  };

  const presentPromptOutcome = (outcome: TuiPromptSendOutcome, appendUser: boolean): void => {
    if (outcome.message === null) {
      appendEntry({
        id: `retry-none-${Date.now()}`,
        kind: "notice",
        title: "No failed prompt",
        body: "There is no preserved failed send to retry.",
      });
      return;
    }
    if (appendUser) {
      appendEntry({ id: `user-${Date.now()}`, kind: "user", title: "You", body: outcome.message });
    }
    if (outcome.ok) {
      input.value = "";
      if (!busy) status.content = idleStatus();
      return;
    }
    input.value = outcome.message;
    appendEntry({
      id: `submit-error-${Date.now()}`,
      kind: "error",
      title: "Message not sent",
      body: `${sanitizeDiagnostic(outcome.error)}\n\nYour exact draft is restored below. Edit it or press Ctrl+R to retry.`,
    });
    status.content = "Message not sent. Exact draft restored · Ctrl+R retries it · /settings or /shell can repair provider access.";
  };

  async function retryLastPrompt(): Promise<void> {
    const preserved = promptRecovery.draft;
    if (preserved !== null) {
      status.content = "Retrying the exact preserved prompt…";
    }
    presentPromptOutcome(await promptRecovery.retry(busy), false);
  }

  const runExplicitShell = async (command: string, draft: string): Promise<void> => {
    if (!command.trim()) {
      input.value = draft;
      status.content = "Shell mode needs a command. Edit the draft or press Esc.";
      setFocusArea("composer");
      return;
    }
    if (!client.bash) {
      input.value = draft;
      appendEntry({ id: `shell-unavailable-${Date.now()}`, kind: "error", title: "Shell unavailable", body: "This RPC host does not expose the shell runner. Your exact command remains in the composer." });
      setFocusArea("composer");
      return;
    }
    appendEntry({ id: `shell-command-${Date.now()}`, kind: "user", title: "Shell", body: `$ ${command}` });
    status.content = `Running shell command…  ·  ${command.slice(0, 80)}`;
    try {
      const result = await client.bash(command);
      const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const output = typeof record.output === "string" ? record.output : sanitizeDiagnostic(result);
      const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
      const cancelled = record.cancelled === true;
      const detail = cancelled ? "Cancelled" : exitCode === undefined ? "Completed" : `Exit code ${exitCode}`;
      appendEntry({
        id: `shell-result-${Date.now()}`,
        kind: cancelled || (exitCode !== undefined && exitCode !== 0) ? "error" : "tool",
        title: cancelled ? "Shell command cancelled" : exitCode !== undefined && exitCode !== 0 ? `Shell command failed (${exitCode})` : "Shell output",
        body: output || "(no output)",
        detail,
      });
      setFocusArea("composer");
    } catch (error) {
      input.value = draft;
      appendEntry({ id: `shell-error-${Date.now()}`, kind: "error", title: "Shell command failed", body: `${sanitizeDiagnostic(error)}\n\nThe exact command is back in the composer.` });
      status.content = "Shell command failed. Edit the preserved command and retry.";
      setFocusArea("composer");
    }
  };

  const submit = async (raw: string) => {
    const message = raw.trim();
    if (!message) return;
    const localComposerCommands: ComposerCommand[] = [
      ...TUI_COMMANDS.map((command) => ({ name: command.id, description: command.description })),
      { name: "models", description: "Search and select an authenticated Pi model" },
    ];
    const parsed = parseComposerInput(raw, [...localComposerCommands, ...knownPiCommands]);
    input.value = "";
    if (parsed.mode === "shell") {
      await runExplicitShell(parsed.shellCommand ?? "", raw);
      return;
    }
    if (parsed.mode === "command" && parsed.commandName === "shell") {
      await exitToShell();
      return;
    }
    const slashCommands: Record<string, TuiCommand["id"] | "palette" | "search"> = {
      setup: "setup",
      commands: "palette",
      sessions: "sessions",
      library: "library",
      review: "review",
      courses: "courses",
      settings: "settings",
      model: "model",
      models: "model",
      thinking: "thinking",
      new: "new-session",
      abort: "abort",
      retry: "retry",
      actions: "palette",
      find: "search",
      search: "search",
    };
    const commandId = parsed.mode === "command" && parsed.commandName ? slashCommands[parsed.commandName] : undefined;
    if (commandId === "search") {
      await showTranscriptSearch();
      return;
    }
    if (parsed.mode === "command" && parsed.commandName === "actions") {
      await showUiActions();
      return;
    }
    if (commandId) {
      if (commandId === "palette") await showCommandPalette();
      else {
        const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
        if (command) await runCommandAndRefocus(command);
      }
      return;
    }
    const resolved = await resolveComposerInput(parsed, cwd);
    const referenceErrors = composerReferenceErrors(resolved);
    if (referenceErrors.length > 0) {
      input.value = raw;
      appendEntry({ id: `composer-reference-error-${Date.now()}`, kind: "error", title: "File reference not sent", body: `${referenceErrors.join("\n")}\n\nYour exact draft is preserved. Fix the @ path and press Enter again.` });
      status.content = "File reference failed. The draft remains in the composer.";
      return;
    }
    appendEntry({ id: `user-${Date.now()}`, kind: "user", title: "You", body: raw });
    presentPromptOutcome(await promptRecovery.send(raw, busy, resolved.prompt), false);
  };

  input.on(InputRenderableEvents.INPUT, () => {
    if (dialogCancel || busy) return;
    const parsed = parseComposerInput(input.value, [
      ...TUI_COMMANDS.map((command) => ({ name: command.id, description: command.description })),
      { name: "models", description: "Search and select an authenticated Pi model" },
      ...knownPiCommands,
    ]);
    if (parsed.mode === "command" && !parsed.commandArgument) {
      const suggestions = commandSuggestions(parsed.commandName ?? "", [
        ...TUI_COMMANDS.map((command) => ({ name: command.id, description: command.description })),
        { name: "models", description: "Search and select an authenticated Pi model" },
        ...knownPiCommands,
      ]);
      status.content = suggestions.length > 0
        ? `${suggestions.slice(0, 5).map((suggestion) => `/${suggestion.name}`).join("  ·  ")}  ·  Enter sends`
        : "Unknown / command will be passed to Pi · Ctrl+P opens local commands";
    } else if (parsed.mode === "shell") {
      status.content = "Shell mode · Enter runs exactly what follows ! · Ctrl+X stops an active response";
    } else {
      status.content = idleStatus();
    }
  });
  input.on(InputRenderableEvents.ENTER, () => { void submit(input.value); });
  renderer.keyInput.on("keypress", (key) => {
    if (dialogCancel) {
      // Ctrl+P is a toggle for the command palette. Treat it as a modal close
      // for any selector/input dialog so the same muscle memory always exits.
      if (key.ctrl && key.name === "p") {
        key.preventDefault();
        key.stopPropagation();
        dialogCancel();
      } else if (key.name === "escape") {
        key.preventDefault();
        dialogCancel();
      } else if (key.name === "tab") {
        key.preventDefault();
        if (key.shift) dialogFocusPrevious?.();
        else dialogFocusNext?.();
      } else if (key.name === "down" && dialogSearchInput?.focused) {
        key.preventDefault();
        dialogFocusNext?.();
        dialogSelect?.moveDown();
      }
      return;
    }
    const normalizedKeyName = key.name.toLowerCase();
    if (leaderActive) {
      key.preventDefault();
      key.stopPropagation();
      leaderActive = false;
      input.value = "";
      if (normalizedKeyName === "escape") {
        status.content = idleStatus();
        return;
      }
      const action = tuiLeaderAction(normalizedKeyName);
      if (!action) {
        status.content = `Unknown :${normalizedKeyName} command · ${TUI_LEADER_HINT}`;
        return;
      }
      if (action === "palette") void showCommandPalette();
      else if (action === "actions") void showUiActions();
      else if (action === "search") void showTranscriptSearch();
      else {
        const command = TUI_COMMANDS.find((candidate) => candidate.id === action);
        if (command) void runCommandAndRefocus(command);
      }
      return;
    }
    if (!key.ctrl && !key.meta && focusArea === "composer" && (input.value.length === 0 || input.value === ":") && isTuiLeaderKey(normalizedKeyName)) {
      key.preventDefault();
      key.stopPropagation();
      leaderActive = true;
      input.value = "";
      status.content = TUI_LEADER_HINT;
      return;
    }
    if (key.name === "tab" && !key.ctrl && !key.meta) {
      key.preventDefault();
      key.stopPropagation();
      setFocusArea(focusArea === "composer" ? "transcript" : "composer");
      return;
    }
    if (editorMode === "vim" && focusArea === "composer") {
      if (vimState === "insert" && key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setVimState("normal");
        return;
      }
      if (vimState === "normal" && !key.ctrl && !key.meta) {
        if (handleVimNormalKey(key.name)) {
          key.preventDefault();
          key.stopPropagation();
          return;
        }
      }
    }
    if (!key.ctrl) return;
    const commandByKey: Partial<Record<string, TuiCommand["id"] | "palette">> = {
      p: "palette",
      s: "sessions",
      l: "library",
      o: "courses",
      m: "model",
      t: "thinking",
      n: "new-session",
      x: "abort",
      r: "retry",
    };
    const commandId = commandByKey[normalizedKeyName]
      ?? (key.code?.toLowerCase() === "keym" || key.baseCode === 109 ? "model" : undefined);
    if (key.name === "u") {
      key.preventDefault();
      key.stopPropagation();
      void showUiActions();
      return;
    }
    if (key.name === "f") {
      key.preventDefault();
      key.stopPropagation();
      void showTranscriptSearch();
      return;
    }
    // Ctrl+M is encoded as Ctrl+Return when Kitty/modifyOtherKeys is active.
    // Raw legacy terminals cannot distinguish it from Enter, so they retain
    // the ordinary submit behavior.
    if (normalizedKeyName === "return" || normalizedKeyName === "enter") {
      key.preventDefault();
      key.stopPropagation();
      void runCommandAndRefocus(TUI_COMMANDS.find((candidate) => candidate.id === "model")!);
      return;
    }
    if (!commandId) return;
    key.preventDefault();
    key.stopPropagation();
    if (commandId === "palette") void showCommandPalette();
    else {
      const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
      if (command) void runCommandAndRefocus(command);
    }
  });
  setVimState(editorMode === "vim" ? "insert" : "insert");
  setFocusArea("composer");
  renderer.start();
  if (initialPrompt?.trim()) {
    void submit(initialPrompt);
  } else if (entries.length === 0) {
    void (async () => {
      const state = await loadTuiOnboardingState(cwd);
      if (!shouldShowTuiOnboarding(state, { version: KEATING_VERSION, hasProvider: headerState.model !== "model unavailable" })) return;
      appendEntry({ id: `onboarding-${Date.now()}`, kind: "notice", title: "Welcome", body: onboardingMarkdown({ version: KEATING_VERSION, hasProvider: headerState.model !== "model unavailable" }) });
      await showSetupWizard();
    })();
  }

  return result;
}
