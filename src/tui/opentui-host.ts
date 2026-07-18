import {
  BoxRenderable,
  InputRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";

import { launchRpcClient } from "../runtime/pi.js";
import { HostController, type HostSurface } from "./host-controller.js";

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
    gap: 1,
    backgroundColor: "#11100e",
  });
  const header = new TextRenderable(renderer, {
    id: "keating-open-tui-header",
    content: "KEATING  ·  collaborative teaching host",
    fg: "#d6a84d",
    height: 1,
  });
  const status = new TextRenderable(renderer, {
    id: "keating-open-tui-status",
    content: "Pi RPC connected  ·  /shell switches to the classic Pi interface",
    fg: "#9d9485",
    height: 1,
  });
  const scroll = new ScrollBoxRenderable(renderer, {
    id: "keating-open-tui-transcript-scroll",
    flexGrow: 1,
    width: "100%",
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
  inputFrame.add(input);
  shell.add(header);
  shell.add(status);
  shell.add(scroll);
  shell.add(inputFrame);
  renderer.root.add(shell);

  const turns: string[] = [];
  let streaming = "";
  let busy = false;
  let dialogCancel: (() => void) | null = null;
  const renderTranscript = () => {
    transcript.content = [...turns, streaming].filter(Boolean).join("\n\n");
    scroll.scrollTo({ y: scroll.scrollHeight, x: 0 });
  };
  const appendTurn = (message: string) => {
    turns.push(message);
    renderTranscript();
  };

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
      status.content = `${title}  ·  Enter submits  ·  Esc cancels`;
      input.value = prefill ?? "";
      input.placeholder = placeholder ?? "Type a response…";
      const previousSubmit = input.onSubmit;
      let done = false;
      const finish = (value?: string) => {
        if (done) return;
        done = true;
        dialogCancel = null;
        input.onSubmit = previousSubmit;
        input.placeholder = "Message Keating…";
        input.value = "";
        status.content = "Ready  ·  /shell switches to classic Pi  ·  Ctrl+C exits";
        resolve(value);
      };
      dialogCancel = () => finish(undefined);
      input.onSubmit = () => finish(input.value);
      renderer.focusRenderable(input);
    });

  const surface: HostSurface = {
    appendTurn,
    setStreaming(text) { streaming = text ?? ""; renderTranscript(); },
    setStatus(text) { status.content = text; },
    setBusy(value) {
      busy = value;
      status.content = value
        ? "Keating is thinking…  ·  Enter queues a follow-up"
        : "Ready  ·  /shell switches to classic Pi  ·  Ctrl+C exits";
    },
    setEditorText(text) { input.value = text; },
    setWidget(key, lines, placement) {
      if (lines?.length) appendTurn(`[${key}${placement ? ` · ${placement}` : ""}]\n${lines.join("\n")}`);
    },
    setTitle(title) { header.content = title; },
    presentSelect,
    presentConfirm(title, message) { return presentSelect(`${title}\n${message}`, ["Yes", "No"]).then((value) => value === undefined ? undefined : value === "Yes"); },
    presentInput(title, placeholder) { return presentTextInput(title, undefined, placeholder); },
    presentEditor(title, prefill) { return presentTextInput(title, prefill, "Edit response…"); },
  };
  const controller = new HostController(client, surface);
  controller.attach();

  const submit = async (raw: string) => {
    const message = raw.trim();
    if (!message) return;
    input.value = "";
    if (message === "/shell") {
      settled = true;
      settle?.("shell");
      renderer.destroy();
      await client.stop();
      return;
    }
    turns.push(`You\n${message}`);
    renderTranscript();
    try {
      if (busy) await client.followUp(message);
      else await client.prompt(message);
    } catch (error) {
      appendTurn(`[Keating] ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  input.onSubmit = () => { void submit(input.value); };
  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "escape" && dialogCancel) {
      key.preventDefault();
      dialogCancel();
    }
  });
  renderer.focusRenderable(input);
  renderer.start();
  if (initialPrompt?.trim()) void submit(initialPrompt);

  return result;
}
