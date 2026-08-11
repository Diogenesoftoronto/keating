import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
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

export interface OpenTuiOptions extends Pick<HostControllerOptions, "uiActionDispatcher"> {
  /** Alias retained for direct host embedding callers. */
  uiActionDispatcher?: UiActionDispatcher;
  /** Test/integration seam; production reads Pi's project-scoped session catalog. */
  listSessions?: (cwd: string) => Promise<TuiSessionInfo[]>;
}

type TerminalColorRole = keyof TuiPresentationProfile["design"]["colors"];

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
    "markup.heading.1": heading,
    "markup.heading.2": heading,
    "markup.heading.3": heading,
    "markup.heading.4": heading,
    "markup.heading.5": heading,
    "markup.heading.6": heading,
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
    fg: accentColor,
    height: 1,
  });
  const status = new TextRenderable(renderer, {
    id: "keating-open-tui-status",
    content: "Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+M model  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop",
    fg: mutedColor,
    height: 1,
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
    border: true,
    borderStyle: "single",
    customBorderChars,
    borderColor,
    padding: 1,
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
    border: true,
    borderStyle: "single",
    customBorderChars,
    borderColor,
    padding: 1,
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
    borderStyle: "single",
    customBorderChars,
    borderColor: accentColor,
    paddingLeft: 1,
    paddingRight: 1,
  });
  const input = new InputRenderable(renderer, {
    id: "keating-open-tui-input",
    width: "100%",
    placeholder: "Message Keating…",
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
  inputFrame.add(input);
  shell.add(header);
  shell.add(status);
  shell.add(workspace);
  shell.add(inputFrame);
  renderer.root.add(shell);

  const entries: TranscriptEntry[] = [];
  let streaming: TranscriptEntry | null = null;
  let headerState: TuiHeaderState = { ...EMPTY_HEADER_STATE };
  let headerLabel = "KEATING";
  let busy = false;
  let dialogCancel: (() => void) | null = null;
  let activeUiDocument: UiDocument | null = null;
  let activeUiControls: UiDocumentControl[] = [];
  const promptRecovery = new TuiPromptRecovery(client);
  let currentLayout = terminalLayoutProfile(renderer.terminalWidth, renderer.terminalHeight);
  const retryHint = () => promptRecovery.draft === null ? "" : " · Ctrl+R retry preserved prompt";
  const idleStatus = () => currentLayout.compactStatus
    ? activeUiDocument
      ? `Ctrl+U actions (${activeUiControls.length}) · Ctrl+P commands${retryHint()}`
      : `Ctrl+P commands · Ctrl+S sessions · /shell classic Pi${retryHint()}`
    : activeUiDocument
      ? `Ctrl+U document actions (${activeUiControls.length})  ·  Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+M model  ·  Ctrl+T thinking  ·  Ctrl+N new${retryHint()}`
      : `Ctrl+P commands  ·  Ctrl+S sessions  ·  Ctrl+M model  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop${retryHint()}`;
  const renderTranscript = () => {
    transcript.streaming = streaming !== null;
    transcript.content = transcriptMarkdown(entries, streaming, presentationProfile);
    activity.content = activityText(entries, headerState, presentationProfile);
    scroll.scrollTo({ y: scroll.scrollHeight, x: 0 });
  };
  const renderHeader = () => {
    header.content = headerText(headerState, presentationProfile).replace(/^KEATING/, headerLabel.toUpperCase());
  };
  const appendEntry = (entry: TranscriptEntry) => {
    entries.push(entry);
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
    if (!busy) status.content = idleStatus();
  };
  updateResponsiveLayout();
  renderer.on(CliRenderEvents.RESIZE, updateResponsiveLayout);

  const presentSelect = (title: string, options: string[]): Promise<string | undefined> =>
    new Promise((resolve) => {
      const modal = new BoxRenderable(renderer, {
        id: `keating-dialog-${Date.now()}`,
        width: "100%",
        height: Math.min(Math.max(options.length + 4, 6), 16),
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        customBorderChars,
        borderColor: accentColor,
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, { content: `${title}  ·  Esc cancels`, fg: accentColor, height: 1 });
      const select = new SelectRenderable(renderer, {
        id: `keating-select-${Date.now()}`,
        flexGrow: 1,
        options: options.map((option) => ({ name: option, description: "", value: option })),
        showDescription: false,
        wrapSelection: true,
        selectedBackgroundColor: accentColor,
        selectedTextColor: surfaceColor ?? textColor,
      });
      modal.add(titleView);
      modal.add(select);
      shell.add(modal, 3);
      let done = false;
      const finish = (value?: string) => {
        if (done) return;
        done = true;
        dialogCancel = null;
        shell.remove(modal);
        renderer.focusRenderable(input);
        resolve(value);
      };
      dialogCancel = () => finish(undefined);
      select.on(SelectRenderableEvents.ITEM_SELECTED, () => finish(select.getSelectedOption()?.value as string | undefined));
      renderer.focusRenderable(select);
    });

  const presentTextInput = (title: string, prefill?: string, placeholder?: string): Promise<string | undefined> =>
    new Promise((resolve) => {
      const modal = new BoxRenderable(renderer, {
        id: `keating-input-dialog-${Date.now()}`,
        width: "100%",
        height: 5,
        flexDirection: "column",
        border: true,
        borderStyle: "single",
        customBorderChars,
        borderColor: accentColor,
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: `${title}  ·  Enter submits  ·  Esc cancels`,
        fg: accentColor,
        height: 1,
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
        shell.remove(modal);
        if (value === undefined && preserveInComposer && dialogInput.value) {
          input.value = dialogInput.value;
          status.content = "Draft preserved in composer. Edit it or reopen document actions with Ctrl+U.";
        }
        renderer.focusRenderable(input);
        resolve(value);
      };
      dialogCancel = () => finish(undefined, true);
      dialogInput.onSubmit = () => finish(dialogInput.value);
      renderer.focusRenderable(dialogInput);
    });

  const surface: HostSurface = {
    hydrateEntries(next) { entries.splice(0, entries.length, ...next); renderTranscript(); },
    appendEntry,
    setStreaming(entry) { streaming = entry; renderTranscript(); },
    setStatus(text) { status.content = text; },
    setHeaderState(next) {
      headerState = { ...headerState, ...next };
      busy = headerState.busy;
      renderHeader();
      renderTranscript();
      status.content = busy
        ? "Keating is thinking…  ·  Enter queues a follow-up  ·  Ctrl+X stops  ·  Ctrl+U document actions"
        : idleStatus();
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
    } | null;
    if (!candidate || typeof candidate !== "object") return;
    if (candidate.type === "agent_start") {
      terminalResponseError = null;
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

  const exitToShell = async () => {
    settled = true;
    settle?.({ action: "shell", sessionPath: controller.getCurrentSessionPath() || undefined });
    renderer.destroy();
    await client.stop();
  };

  const runCommand = async (command: TuiCommand): Promise<void> => {
    switch (command.id) {
      case "sessions":
        await showSessions();
        return;
      case "library":
        await showLibrary();
        return;
      case "review":
        await showReview();
        return;
      case "settings":
        await showSettings();
        return;
      case "model":
        await controller.cycleModel();
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
      if (action === "Cycle model") await controller.cycleModel();
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

  const showCommandPalette = async () => {
    const options = TUI_COMMANDS.map(commandOption);
    const selected = await presentSelect("Keating commands", options);
    const index = selected === undefined ? -1 : options.indexOf(selected);
    if (index >= 0) await runCommand(TUI_COMMANDS[index]!);
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

  const submit = async (raw: string) => {
    const message = raw.trim();
    if (!message) return;
    input.value = "";
    if (message === "/shell") {
      await exitToShell();
      return;
    }
    const slashCommands: Record<string, TuiCommand["id"] | "palette"> = {
      "/commands": "palette",
      "/sessions": "sessions",
      "/library": "library",
      "/review": "review",
      "/settings": "settings",
      "/model": "model",
      "/thinking": "thinking",
      "/new": "new-session",
      "/abort": "abort",
      "/retry": "retry",
      "/actions": "palette",
    };
    const commandId = slashCommands[message];
    if (message === "/actions") {
      await showUiActions();
      return;
    }
    if (commandId) {
      if (commandId === "palette") await showCommandPalette();
      else {
        const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
        if (command) await runCommand(command);
      }
      return;
    }
    appendEntry({ id: `user-${Date.now()}`, kind: "user", title: "You", body: raw });
    presentPromptOutcome(await promptRecovery.send(raw, busy, message), false);
  };

  input.onSubmit = () => { void submit(input.value); };
  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "escape" && dialogCancel) {
      key.preventDefault();
      dialogCancel();
      return;
    }
    if (dialogCancel || !key.ctrl) return;
    const commandByKey: Partial<Record<string, TuiCommand["id"] | "palette">> = {
      p: "palette",
      s: "sessions",
      l: "library",
      m: "model",
      t: "thinking",
      n: "new-session",
      x: "abort",
      r: "retry",
    };
    const commandId = commandByKey[key.name];
    if (key.name === "u") {
      key.preventDefault();
      key.stopPropagation();
      void showUiActions();
      return;
    }
    if (!commandId) return;
    key.preventDefault();
    key.stopPropagation();
    if (commandId === "palette") void showCommandPalette();
    else {
      const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
      if (command) void runCommand(command);
    }
  });
  renderer.focusRenderable(input);
  renderer.start();
  if (initialPrompt?.trim()) void submit(initialPrompt);

  return result;
}
