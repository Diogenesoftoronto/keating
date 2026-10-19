/**
 * OpenTUI host entry point. `launchOpenTui` is only composition: set up the
 * renderer and shared state, build the view, dialogs and surface, bind the
 * controller and side panel into a `HostContext`, wire the keyboard, then run
 * startup. Behaviour lives in `./host/` (shell, view, dialogs, key reducer,
 * flows); keyboard precedence is documented in `./host/interaction.ts`.
 */
import { InputRenderableEvents, createCliRenderer } from "@opentui/core";
import { spawn } from "node:child_process";
import { createCliQuizPerformanceController, exportCliQuizPerformanceEvidence } from "../judgement/cli-quiz-performance.js";
import { launchRpcClient } from "../runtime/pi.js";
import { HostController, type HostControllerOptions } from "./host-controller.js";
import type { UiActionDispatcher } from "./learner-contracts.js";
import { FileUiActionJournalStorage, RpcUiActionDispatcher, UiActionJournalStore } from "./ui/index.js";
import { createTuiPresentationProfile } from "./terminal-profile.js";
import { TuiPromptRecovery } from "./prompt-recovery.js";
import { loadTuiOnboardingState, shouldShowTuiOnboarding } from "./onboarding.js";
import { detectTuiEditorMode } from "./editor-mode.js";
import { KEATING_VERSION } from "../core/version.js";
import { loadTuiProfile } from "./profile.js";
import { listProjectTuiSessions, type TuiSessionInfo } from "./session-browser.js";
import type { OpenTuiExitResult } from "./shell-handoff.js";
import { createHostContext } from "./host/context.js";
import { createTuiDialogs } from "./host/dialogs.js";
import { refreshKnownPiCommands } from "./host/flows/common.js";
import { updateComposerHint } from "./host/flows/composer-hints.js";
import { beginOnboarding } from "./host/flows/onboarding.js";
import { submit } from "./host/flows/prompt.js";
import { attachRecoveryEvents } from "./host/flows/recovery.js";
import { createSidebarControl } from "./host/flows/sidebar.js";
import { installKeyboard } from "./host/keyboard.js";
import { createHostState, dispatchInteraction } from "./host/state.js";
import { createTuiShell } from "./host/shell.js";
import { createHostSurface } from "./host/surface.js";
import { createTuiTheme } from "./host/theme.js";
import { createHostView } from "./host/view.js";

export interface OpenTuiOptions extends Pick<HostControllerOptions, "uiActionDispatcher"> {
  /** Alias retained for direct host embedding callers. */
  uiActionDispatcher?: UiActionDispatcher;
  /** Test/integration seam; production reads Pi's project-scoped session catalog. */
  listSessions?: (cwd: string) => Promise<TuiSessionInfo[]>;
  /** Test/integration seam for opening provider authorization pages. */
  openExternalUrl?: (url: string) => void;
}

function tryOpenExternalUrl(url: string): void {
  try {
    const command = process.platform === "darwin"
      ? { executable: "open", args: [url] }
      : process.platform === "win32"
        ? { executable: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
        : { executable: "xdg-open", args: [url] };
    const child = spawn(command.executable, command.args, { stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL remains visible in the terminal when no desktop opener exists.
  }
}

/**
 * The pieces of the Pi RPC client's ownership that outlive the renderer: the
 * quiz-prediction controller, the recovery subscription and the UI-action
 * dispatcher are released when the renderer is destroyed.
 */
interface HostTeardown {
  disposeQuizPredictions?: () => void;
  detachRecoveryEvents?: () => void;
}

/** Run the alternate OpenTUI host over Pi RPC. `keating shell` remains intact. */
export async function launchOpenTui(cwd: string, initialPrompt?: string, options: OpenTuiOptions = {}): Promise<OpenTuiExitResult> {
  const theme = createTuiTheme(createTuiPresentationProfile());
  const state = createHostState({
    cwd,
    tuiProfile: await loadTuiProfile(cwd),
    editorMode: detectTuiEditorMode(process.env),
  });
  const client = await launchRpcClient(cwd);
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

  // --- renderer and shared state -------------------------------------------
  const teardown: HostTeardown = {};
  const result = new Promise<OpenTuiExitResult>((resolve) => { state.settle = resolve; });
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    // Disambiguate Ctrl+M from Enter on terminals that support the Kitty
    // keyboard protocol. Legacy terminals still retain the normal Enter path.
    useKittyKeyboard: { disambiguate: true, alternateKeys: true, allKeysAsEscapes: true },
    ...(theme.surfaceColor ? { backgroundColor: theme.surfaceColor } : {}),
    onDestroy: () => {
      teardown.disposeQuizPredictions?.();
      state.sidebar?.destroy();
      state.sidebar = null;
      teardown.detachRecoveryEvents?.();
      if (!state.settled) {
        state.settled = true;
        state.settle?.({ action: "exit" });
      }
      rpcUiActionDispatcher?.dispose();
      void client.stop();
    },
  });
  const parts = await createTuiShell(renderer, theme);
  const promptRecovery = new TuiPromptRecovery(client);

  // --- view, dialogs, surface ----------------------------------------------
  const view = createHostView({ renderer, theme, parts, state, cwd, promptRecovery });
  const dialogs = createTuiDialogs({
    renderer,
    theme,
    shell: parts.shell,
    input: parts.input,
    status: parts.status,
    getFocusArea: () => state.interaction.focusArea,
    setFocusArea: view.setFocusArea,
    isSidebarVisible: () => state.sidebar?.visible === true,
    onOpen: (scrollable) => { dispatchInteraction(state, { type: "modal-open", scrollable }); },
    onClose: () => { dispatchInteraction(state, { type: "modal-close" }); },
  });
  const surface = createHostSurface({ state, view, dialogs });

  // --- context: everything flows may depend on ------------------------------
  const { context, bindController, bindSidebar } = createHostContext({
    cwd,
    renderer,
    client,
    state,
    theme,
    view,
    dialogs,
    surface,
    promptRecovery,
    listSessions: options.listSessions ?? listProjectTuiSessions,
    openExternalUrl: options.openExternalUrl ?? tryOpenExternalUrl,
  });
  teardown.detachRecoveryEvents = attachRecoveryEvents(context);
  const controller = new HostController(client, surface, {
    uiActionDispatcher,
    createQuizPerformance: (document, nodeId, isCurrent) => createCliQuizPerformanceController({ cwd, document, nodeId, isCurrent }),
    exportQuizPerformanceEvidence: (documentId) => exportCliQuizPerformanceEvidence(cwd, documentId),
    async restoreUiDocument(document) {
      const journal = await new FileUiActionJournalStorage(cwd, "receiver").load(document.id);
      return journal?.receipts.reduce((latest, receipt) => {
        const candidate = receipt.result?.resultingDocument;
        return candidate && candidate.createdAt === document.createdAt && candidate.revision > latest.revision ? candidate : latest;
      }, document) ?? document;
    },
  });
  bindController(controller);
  teardown.disposeQuizPredictions = () => controller.dispose();
  controller.attach();
  await controller.initialize();
  await refreshKnownPiCommands(context);

  // --- wiring: side panel, composer, keyboard -------------------------------
  bindSidebar(createSidebarControl(context, parts.workspace));
  view.refreshSidebarIdentity();
  view.refreshSidebarActivity();
  view.updateResponsiveLayout();
  void context.sidebar.refreshSessions();
  parts.input.on(InputRenderableEvents.INPUT, () => updateComposerHint(context));
  parts.input.on(InputRenderableEvents.ENTER, () => { void submit(context, parts.input.value); });
  installKeyboard(context);

  // --- startup ---------------------------------------------------------------
  view.setVimState("insert");
  if (!initialPrompt?.trim() && state.entries.length === 0) {
    const onboarding = await loadTuiOnboardingState(cwd);
    if (shouldShowTuiOnboarding(onboarding, { version: KEATING_VERSION, hasSavedSession: false })) {
      await beginOnboarding(context);
    }
  }
  if (state.interaction.onboarding.active) parts.input.blur();
  else view.setFocusArea("composer");
  renderer.start();
  if (initialPrompt?.trim()) void submit(context, initialPrompt);

  return result;
}
