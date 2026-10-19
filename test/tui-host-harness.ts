/**
 * Shared fixture for the OpenTUI host flow tests: a real test renderer, shell,
 * view, state and prompt recovery, with scripted dialogs and fake Pi client /
 * controller so a flow can be driven without a TTY or a Pi process. Dialogs
 * record every call so tests can assert which choices were offered.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import type { HostContext, HostSidebarControl } from "../src/tui/host/context.js";
import { createHostContext } from "../src/tui/host/context.js";
import type { SelectPresentationOptions, TextInputPresentationOptions, TuiDialogs } from "../src/tui/host/dialogs.js";
import { createTuiShell } from "../src/tui/host/shell.js";
import { createHostState, type HostState } from "../src/tui/host/state.js";
import { createHostSurface } from "../src/tui/host/surface.js";
import { createTuiTheme } from "../src/tui/host/theme.js";
import { createHostView } from "../src/tui/host/view.js";
import { TuiPromptRecovery } from "../src/tui/prompt-recovery.js";
import { createTuiPresentationProfile } from "../src/tui/terminal-profile.js";
import type { TuiProfile } from "../src/tui/profile.js";
import type { TranscriptEntry } from "../src/tui/view-model.js";

export interface SelectCall {
  kind: "select";
  title: string;
  options: string[];
  presentation: SelectPresentationOptions;
}
export interface TextCall {
  kind: "text";
  title: string;
  prefill: string | undefined;
  placeholder: string | undefined;
  presentation: TextInputPresentationOptions;
}
export type DialogCall = SelectCall | TextCall;

/** What a scripted dialog answers: a literal, a chooser over the offered options, or cancel. */
export type DialogAnswer = string | undefined | ((call: DialogCall) => string | undefined);

/** Answer with the first offered option containing `fragment`. */
export const choose = (fragment: string): DialogAnswer => (call) => {
  if (call.kind !== "select") throw new Error(`choose(${fragment}) used on a text dialog "${call.title}"`);
  const match = call.options.find((option) => option.includes(fragment));
  if (match === undefined) throw new Error(`No option containing "${fragment}" in ${JSON.stringify(call.options)}`);
  return match;
};

export interface FakeCalls {
  client: Array<[string, ...unknown[]]>;
  controller: Array<[string, ...unknown[]]>;
  sidebar: string[];
}

export interface FlowHarness {
  ctx: HostContext;
  state: HostState;
  cwd: string;
  /** Every dialog the flow opened, in order. */
  dialogs: DialogCall[];
  calls: FakeCalls;
  entries(): TranscriptEntry[];
  entryTitles(): string[];
  status(): string;
  composer: { value: string };
  /** Queue answers for the next dialogs. */
  script(...answers: DialogAnswer[]): void;
  parts: Awaited<ReturnType<typeof createTuiShell>>;
  setup: Awaited<ReturnType<typeof createTestRenderer>>;
  destroy(): Promise<void>;
}

export interface HarnessOptions {
  client?: Record<string, unknown>;
  controller?: Record<string, unknown>;
  listSessions?: HostContext["listSessions"];
  tuiProfile?: TuiProfile;
  width?: number;
  height?: number;
  /** Real project directory; defaults to a fresh temp dir removed on destroy. */
  cwd?: string;
}

const DEFAULT_PROFILE: TuiProfile = { schemaVersion: 1, displayName: "Learner", avatar: { kind: "learner" } };

export async function createFlowHarness(options: HarnessOptions = {}): Promise<FlowHarness> {
  const ownsCwd = options.cwd === undefined;
  const cwd = options.cwd ?? await mkdtemp(join(tmpdir(), "keating-tui-flow-"));
  const setup = await createTestRenderer({ width: options.width ?? 120, height: options.height ?? 36, exitOnCtrlC: false });
  const theme = createTuiPresentationProfile({ NO_COLOR: "1", TERM: "xterm" });
  const tuiTheme = createTuiTheme(theme);
  const parts = await createTuiShell(setup.renderer, tuiTheme);
  const state = createHostState({ cwd, tuiProfile: options.tuiProfile ?? DEFAULT_PROFILE, editorMode: "emacs" });

  const calls: FakeCalls = { client: [], controller: [], sidebar: [] };
  const record = (list: Array<[string, ...unknown[]]>, name: string, args: unknown[]) => { list.push([name, ...args]); };

  const client: Record<string, unknown> = {
    getAvailableModels: async () => [],
    getState: async () => ({}),
    getCommands: async () => [],
    getMessages: async () => [],
    getStderr: () => "",
    getSessionStats: async () => undefined,
    setThinkingLevel: async () => {},
    setAutoRetry: async () => {},
    setAutoCompaction: async () => {},
    setSteeringMode: async () => {},
    setFollowUpMode: async () => {},
    restart: async () => {},
    stop: async () => {},
    ...options.client,
  };
  // Every client method is logged; overrides keep their behaviour.
  const loggedClient = new Proxy(client, {
    get(target, prop: string) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => { record(calls.client, prop, args); return (value as (...a: unknown[]) => unknown)(...args); };
    },
  });
  const controllerImpl: Record<string, unknown> = {
    getCurrentSessionPath: () => "/sessions/current.jsonl",
    initialize: async () => {},
    resumeSession: async () => true,
    renameCurrentSession: async () => true,
    cloneCurrentSession: async () => true,
    forkMessages: async () => [],
    forkFromMessage: async () => true,
    newSession: async () => {},
    cycleThinking: async () => {},
    abort: async () => {},
    setModel: async () => {},
    ...options.controller,
  };
  const controller = new Proxy(controllerImpl, {
    get(target, prop: string) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => { record(calls.controller, prop, args); return (value as (...a: unknown[]) => unknown)(...args); };
    },
  });

  const queue: DialogAnswer[] = [];
  const dialogCalls: DialogCall[] = [];
  const answer = (call: DialogCall): string | undefined => {
    dialogCalls.push(call);
    if (queue.length === 0) throw new Error(`Unscripted dialog "${call.title}" (${call.kind})`);
    const next = queue.shift();
    return typeof next === "function" ? next(call) : next;
  };
  const dialogs: TuiDialogs = {
    presentSelect: async (title, options, presentation = {}) => answer({ kind: "select", title, options, presentation }),
    presentTextInput: async (title, prefill, placeholder, presentation = {}) =>
      answer({ kind: "text", title, prefill, placeholder, presentation }),
    isOpen: () => false,
    cancel: () => {},
    scroll: () => false,
    focusNext: () => {},
    focusPrevious: () => {},
    searchFocused: () => false,
  };

  const promptRecovery = new TuiPromptRecovery({
    prompt: async (message: string) => { record(calls.client, "prompt", [message]); if (client.failPrompt) throw new Error(String(client.failPrompt)); },
    followUp: async (message: string) => { record(calls.client, "followUp", [message]); },
  } as ConstructorParameters<typeof TuiPromptRecovery>[0]);
  const view = createHostView({ renderer: setup.renderer, theme: tuiTheme, parts, state, cwd, promptRecovery });
  const surface = createHostSurface({ state, view, dialogs });
  const handle = createHostContext({
    cwd,
    renderer: setup.renderer,
    client: loggedClient as unknown as HostContext["client"],
    state,
    theme: tuiTheme,
    view,
    dialogs,
    surface,
    promptRecovery,
    listSessions: options.listSessions ?? (async () => []),
    openExternalUrl: () => {},
  });
  handle.bindController(controller as unknown as HostContext["controller"]);
  const sidebar: HostSidebarControl = {
    refreshSessions: async () => { calls.sidebar.push("refreshSessions"); },
    toggle: () => { calls.sidebar.push("toggle"); },
  };
  handle.bindSidebar(sidebar);
  // Startup leaves the composer focused; later input.focus() calls must be no-ops, as in the host.
  view.setFocusArea("composer");

  return {
    ctx: handle.context,
    state,
    cwd,
    dialogs: dialogCalls,
    calls,
    entries: () => state.entries,
    entryTitles: () => state.entries.map((entry) => entry.title),
    status: () => parts.status.plainText,
    composer: parts.input,
    script: (...answers) => { queue.push(...answers); },
    parts,
    setup,
    async destroy() {
      setup.renderer.destroy();
      if (ownsCwd) await rm(cwd, { recursive: true, force: true });
    },
  };
}
