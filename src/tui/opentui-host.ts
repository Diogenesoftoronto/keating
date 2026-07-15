import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";

import { launchRpcClient } from "../runtime/pi.js";

export type OpenTuiExitAction = "exit" | "shell";

interface RpcAgentMessage {
  role?: string;
  content?: unknown;
}

function messageText(message: RpcAgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: string; text?: string };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function eventMessage(event: unknown): RpcAgentMessage | null {
  if (!event || typeof event !== "object") return null;
  const message = (event as { message?: unknown }).message;
  return message && typeof message === "object" ? message as RpcAgentMessage : null;
}

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
    content: "Ask a question, continue a learning goal, or type /shell for Pi-specific UI extensions.",
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
  const renderTranscript = () => {
    transcript.content = [...turns, streaming].filter(Boolean).join("\n\n");
    scroll.scrollTo({ y: scroll.scrollHeight, x: 0 });
  };
  const appendNotice = (message: string) => {
    turns.push(`[Keating] ${message}`);
    renderTranscript();
  };

  const sendUiResponse = async (requestId: string, response: Record<string, unknown>) => {
    const internal = client as unknown as { send(command: Record<string, unknown>): Promise<unknown> };
    await internal.send({ type: "extension_ui_response", id: requestId, ...response });
  };

  client.onEvent((event: unknown) => {
    const candidate = event as { type?: string; id?: string; method?: string; message?: string; statusText?: string; text?: string };
    if (candidate.type === "message_update") {
      const message = eventMessage(event);
      if (message && (message as { role?: string }).role === "assistant") {
        streaming = `Keating\n${messageText(message)}`;
        renderTranscript();
      }
      return;
    }
    if (candidate.type === "message_end") {
      const message = eventMessage(event);
      if (message && (message as { role?: string }).role === "assistant") {
        streaming = "";
        turns.push(`Keating\n${messageText(message)}`);
        renderTranscript();
      }
      return;
    }
    if (candidate.type === "agent_start") {
      busy = true;
      status.content = "Keating is thinking…  ·  Enter queues a follow-up";
      return;
    }
    if (candidate.type === "agent_end") {
      busy = false;
      status.content = "Ready  ·  /shell switches to classic Pi  ·  Ctrl+C exits";
      return;
    }
    if (candidate.type !== "extension_ui_request") return;

    if (candidate.method === "notify" && candidate.message) appendNotice(candidate.message);
    if (candidate.method === "setStatus") status.content = candidate.statusText || "Ready";
    if (candidate.method === "set_editor_text" && typeof candidate.text === "string") input.value = candidate.text;
    if (["select", "confirm", "input", "editor"].includes(candidate.method ?? "") && candidate.id) {
      appendNotice("This extension requested a Pi-specific input surface. Switch with /shell to use it.");
      void sendUiResponse(candidate.id, { cancelled: true }).catch((error) => appendNotice(String(error)));
    }
  });

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
      appendNotice(error instanceof Error ? error.message : String(error));
    }
  };

  input.onSubmit = () => { void submit(input.value); };
  renderer.focusRenderable(input);
  renderer.start();
  if (initialPrompt?.trim()) void submit(initialPrompt);

  return result;
}
