import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";

import { launchRpcClient } from "../runtime/pi.js";
import { HostController, type HostSurface } from "./host-controller.js";
import {
  EMPTY_HEADER_STATE,
  TUI_COMMANDS,
  activityText,
  commandOption,
  headerText,
  sanitizeDiagnostic,
  showActivityRail,
  transcriptText,
  type TranscriptEntry,
  type TuiCommand,
  type TuiHeaderState,
} from "./view-model.js";

export type OpenTuiExitAction = "exit" | "shell";

/** Run the alternate OpenTUI host over Pi RPC. `keating shell` remains intact. */
export async function launchOpenTui(cwd: string, initialPrompt?: string): Promise<OpenTuiExitAction> {
  const client = await launchRpcClient(cwd);
  let settle: ((action: OpenTuiExitAction) => void) | null = null;
  let settled = false;
  const result = new Promise<OpenTuiExitAction>((resolve) => { settle = resolve; });
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    backgroundColor: "#11100e",
    onDestroy: () => {
      if (!settled) {
        settled = true;
        settle?.("exit");
      }
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
    backgroundColor: "#11100e",
  });
  const header = new TextRenderable(renderer, {
    id: "keating-open-tui-header",
    content: headerText(EMPTY_HEADER_STATE),
    fg: "#d6a84d",
    height: 1,
  });
  const status = new TextRenderable(renderer, {
    id: "keating-open-tui-status",
    content: "Ctrl+P commands  ·  Ctrl+M model  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop",
    fg: "#9d9485",
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
    borderColor: "#4c463d",
    padding: 1,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
  });
  const transcript = new TextRenderable(renderer, {
    id: "keating-open-tui-transcript",
    content: "Ask a question, continue a learning goal, or type /shell for the classic Pi interface.",
    fg: "#eee8dc",
    width: "100%",
  });
  const activityRail = new BoxRenderable(renderer, {
    id: "keating-open-tui-activity-rail",
    width: 30,
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: "#4c463d",
    padding: 1,
  });
  const activity = new TextRenderable(renderer, {
    id: "keating-open-tui-activity",
    content: "SESSION\nnew session\n\nACTIVITY\n· No tool activity yet",
    fg: "#9d9485",
    width: "100%",
  });
  const inputFrame = new BoxRenderable(renderer, {
    id: "keating-open-tui-input-frame",
    width: "100%",
    height: 3,
    border: true,
    borderStyle: "single",
    borderColor: "#d6a84d",
    paddingLeft: 1,
    paddingRight: 1,
  });
  const input = new InputRenderable(renderer, {
    id: "keating-open-tui-input",
    width: "100%",
    placeholder: "Message Keating…",
    textColor: "#eee8dc",
    placeholderColor: "#81786b",
    backgroundColor: "#11100e",
    focusedBackgroundColor: "#11100e",
    focusedTextColor: "#ffffff",
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
  const renderTranscript = () => {
    transcript.content = transcriptText(entries, streaming);
    activity.content = activityText(entries, headerState);
    scroll.scrollTo({ y: scroll.scrollHeight, x: 0 });
  };
  const renderHeader = () => {
    header.content = headerText(headerState).replace(/^KEATING/, headerLabel.toUpperCase());
  };
  const appendEntry = (entry: TranscriptEntry) => {
    entries.push(entry);
    renderTranscript();
  };
  const updateResponsiveLayout = (width: number) => {
    activityRail.visible = showActivityRail(width);
  };
  updateResponsiveLayout(renderer.terminalWidth);
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
        borderColor: "#d6a84d",
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, { content: `${title}  ·  Esc cancels`, fg: "#d6a84d", height: 1 });
      const select = new SelectRenderable(renderer, {
        id: `keating-select-${Date.now()}`,
        flexGrow: 1,
        options: options.map((option) => ({ name: option, description: "", value: option })),
        showDescription: false,
        wrapSelection: true,
        selectedBackgroundColor: "#d6a84d",
        selectedTextColor: "#11100e",
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
        borderColor: "#d6a84d",
        padding: 1,
      });
      const titleView = new TextRenderable(renderer, {
        content: `${title}  ·  Enter submits  ·  Esc cancels`,
        fg: "#d6a84d",
        height: 1,
      });
      const dialogInput = new InputRenderable(renderer, {
        id: `keating-dialog-input-${Date.now()}`,
        width: "100%",
        value: prefill ?? "",
        placeholder: placeholder ?? "Type a response…",
        textColor: "#eee8dc",
        placeholderColor: "#81786b",
        backgroundColor: "#11100e",
        focusedBackgroundColor: "#11100e",
        focusedTextColor: "#ffffff",
      });
      modal.add(titleView);
      modal.add(dialogInput);
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
        ? "Keating is thinking…  ·  Enter queues a follow-up  ·  Ctrl+X stops"
        : "Ctrl+P commands  ·  Ctrl+M model  ·  Ctrl+T thinking  ·  Ctrl+N new  ·  Ctrl+X stop";
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
    presentSelect,
    presentConfirm(title, message) { return presentSelect(`${title}\n${message}`, ["Yes", "No"]).then((value) => value === undefined ? undefined : value === "Yes"); },
    presentInput(title, placeholder) { return presentTextInput(title, undefined, placeholder); },
    presentEditor(title, prefill) { return presentTextInput(title, prefill, "Edit response…"); },
  };
  const controller = new HostController(client, surface);
  controller.attach();
  await controller.initialize();

  const exitToShell = async () => {
    settled = true;
    settle?.("shell");
    renderer.destroy();
    await client.stop();
  };

  const runCommand = async (command: TuiCommand): Promise<void> => {
    switch (command.id) {
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
        return;
      case "shell":
        await exitToShell();
    }
  };

  const showCommandPalette = async () => {
    const options = TUI_COMMANDS.map(commandOption);
    const selected = await presentSelect("Keating commands", options);
    const index = selected === undefined ? -1 : options.indexOf(selected);
    if (index >= 0) await runCommand(TUI_COMMANDS[index]!);
  };

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
      "/model": "model",
      "/thinking": "thinking",
      "/new": "new-session",
      "/abort": "abort",
    };
    const commandId = slashCommands[message];
    if (commandId) {
      if (commandId === "palette") await showCommandPalette();
      else {
        const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
        if (command) await runCommand(command);
      }
      return;
    }
    appendEntry({ id: `user-${Date.now()}`, kind: "user", title: "You", body: message });
    try {
      if (busy) await client.followUp(message);
      else await client.prompt(message);
    } catch (error) {
      appendEntry({
        id: `submit-error-${Date.now()}`,
        kind: "error",
        title: "Message not sent",
        body: sanitizeDiagnostic(error),
      });
    }
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
      m: "model",
      t: "thinking",
      n: "new-session",
      x: "abort",
    };
    const commandId = commandByKey[key.name];
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
