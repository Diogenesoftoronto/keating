import { afterEach, describe, expect, test } from "bun:test";
import { composerHint } from "../src/tui/host/flows/composer-hints.js";
import { SIDEBAR_NAVIGATION, createSidebarControl } from "../src/tui/host/flows/sidebar.js";
import { createKeypressHandler, invokeHostCommand, keyContext } from "../src/tui/host/keyboard.js";
import { createHostContext } from "../src/tui/host/context.js";
import { createHostState, dispatchInteraction } from "../src/tui/host/state.js";
import type { TuiSessionInfo } from "../src/tui/session-browser.js";
import { createFlowHarness, type FlowHarness } from "./tui-host-harness.js";

let harness: FlowHarness | undefined;
afterEach(async () => { await harness?.destroy(); harness = undefined; });

const session = (name: string): TuiSessionInfo => ({
  path: `/sessions/${name}.jsonl`, id: name, name, created: new Date(), modified: new Date(), messageCount: 2, firstMessage: name,
});

/** Build the real side panel on the harness's context, replacing the fake sidebar control. */
async function mountSidebar(options: Parameters<typeof createFlowHarness>[0] = {}) {
  harness = await createFlowHarness({ width: 120, height: 36, ...options });
  const handle = createHostContext({ ...harness.ctx });
  handle.bindController(harness.ctx.controller);
  const control = createSidebarControl({ ...handle.context, sidebar: harness.ctx.sidebar } as never, harness.parts.workspace);
  handle.bindSidebar(control);
  return { harness, control, ctx: handle.context };
}

describe("side panel wiring", () => {
  test("navigation exposes the documented leader hints", () => {
    expect(SIDEBAR_NAVIGATION.map((item) => [item.id, item.hint])).toEqual([
      ["commands", ":p"], ["new-session", ":n"], ["model", ":m"], ["library", ":l"], ["courses", ":o"], ["review", undefined], ["setup", undefined],
    ]);
  });

  test("mounts at the front of the workspace and paints the learner's sessions", async () => {
    const { harness, control } = await mountSidebar({ listSessions: async () => [session("one"), session("two")] });
    expect(harness.state.sidebar).not.toBeNull();
    expect(harness.parts.workspace.getChildren()[0]).toBe(harness.state.sidebar!.root);
    await control.refreshSessions();
    expect(harness.state.sidebarSessionTree.map((row) => row.item.path).sort()).toEqual(["/sessions/one.jsonl", "/sessions/two.jsonl"]);
  });

  test("the latest refresh wins when requests overlap", async () => {
    let release!: (value: TuiSessionInfo[]) => void;
    let calls = 0;
    const { harness, control } = await mountSidebar({
      listSessions: () => {
        calls += 1;
        return calls === 1 ? new Promise<TuiSessionInfo[]>((resolve) => { release = resolve; }) : Promise.resolve([session("fresh")]);
      },
    });
    const stale = control.refreshSessions();
    await control.refreshSessions();
    release([session("stale")]);
    await stale;
    expect(harness.state.sidebarSessionTree.map((row) => row.item.title)).toEqual(["fresh"]);
  });

  test("a listing failure empties the panel instead of throwing", async () => {
    const { harness, control } = await mountSidebar({ listSessions: async () => { throw new Error("disk"); } });
    await control.refreshSessions();
    expect(harness.state.sidebarSessionTree).toEqual([]);
  });

  test("toggle explains when the terminal is too small", async () => {
    const { harness, control } = await mountSidebar({ width: 60, height: 20 });
    control.toggle();
    expect(harness.state.sidebarExpanded).toBe(false);
    expect(harness.status()).toContain("88 columns × 22 rows");
  });

  test("toggle opens the panel and focuses it, then closes it back to the composer", async () => {
    const { harness, control } = await mountSidebar();
    control.toggle();
    expect(harness.state.sidebarExpanded).toBe(true);
    expect(harness.state.sidebar!.visible).toBe(true);
    expect(harness.state.interaction.focusArea).toBe("sidebar");
    control.toggle();
    expect(harness.state.sidebar!.visible).toBe(false);
    expect(harness.state.interaction.focusArea).toBe("composer");
  });
});

describe("composer hints", () => {
  test("slash prefixes suggest commands; unknown ones warn; plain text uses idle hints", () => {
    expect(composerHint("/mod", [])).toContain("/model");
    expect(composerHint("/zzzz", [])).toBe("Unknown / command will be passed to Pi · Ctrl+P opens local commands");
    expect(composerHint("!ls", [])).toContain("Shell mode");
    expect(composerHint("see @src", [])).toContain("@src recognized");
    expect(composerHint("hello", [])).toBeNull();
  });

  test("Pi-advertised commands are suggested too", () => {
    expect(composerHint("/skill", [{ name: "skill:review", description: "Review" }])).toContain("/skill:review");
  });
});

describe("keyboard wiring", () => {
  test("keyContext reflects composer text, sidebar visibility and provider login", async () => {
    harness = await createFlowHarness();
    expect(keyContext(harness.ctx)).toMatchObject({
      composerAllowsLeader: true, fileReferenceActive: false, providerLoginActive: false, sidebarVisible: false, onboardingPageCount: 0,
    });
    harness.composer.value = "see @no";
    harness.state.activeProviderLoginAbort = new AbortController();
    expect(keyContext(harness.ctx)).toMatchObject({ composerAllowsLeader: false, fileReferenceActive: true, providerLoginActive: true });
  });

  function key(name: string, flags: { ctrl?: boolean } = {}) {
    const log: string[] = [];
    return { name, ...flags, preventDefault: () => log.push("prevent"), stopPropagation: () => log.push("stop"), log };
  }

  test("a colon on an empty composer arms the leader and shows the hint; the next key runs a command", async () => {
    harness = await createFlowHarness();
    const onKey = createKeypressHandler(harness.ctx);
    const colon = key(":");
    onKey(colon);
    expect(colon.log).toEqual(["prevent", "stop"]);
    expect(harness.state.interaction.leaderActive).toBe(true);
    expect(harness.status()).toContain(":m models");
    onKey(key("t"));
    await Promise.resolve();
    expect(harness.state.interaction.leaderActive).toBe(false);
    expect(harness.calls.controller).toContainEqual(["cycleThinking"]);
  });

  test("an unknown leader key reports and clears the composer", async () => {
    harness = await createFlowHarness();
    const onKey = createKeypressHandler(harness.ctx);
    onKey(key(":"));
    onKey(key("z"));
    expect(harness.status()).toContain("Unknown :z command");
    expect(harness.composer.value).toBe("");
  });

  test("Ctrl+B asks the sidebar to toggle", async () => {
    harness = await createFlowHarness();
    createKeypressHandler(harness.ctx)(key("b", { ctrl: true }));
    expect(harness.calls.sidebar).toEqual(["toggle"]);
  });

  test("an open modal keeps global shortcuts from firing", async () => {
    harness = await createFlowHarness();
    dispatchInteraction(harness.state, { type: "modal-open", scrollable: false });
    createKeypressHandler(harness.ctx)(key("t", { ctrl: true }));
    expect(harness.calls.controller).toEqual([]);
  });

  test("invokeHostCommand dispatches palette, actions, search and local commands", async () => {
    harness = await createFlowHarness();
    harness.script(undefined);
    invokeHostCommand(harness.ctx, "palette");
    await Promise.resolve();
    expect(harness.dialogs[0]!.title).toBe("Keating commands");
    invokeHostCommand(harness.ctx, "ui-actions");
    await Promise.resolve();
    expect(harness.entryTitles()).toContain("No active document");
    invokeHostCommand(harness.ctx, "thinking");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls.controller).toContainEqual(["cycleThinking"]);
  });

  test("onboarding keys advance the tour and skipping finishes it", async () => {
    harness = await createFlowHarness();
    dispatchInteraction(harness.state, { type: "onboarding-begin" });
    const onKey = createKeypressHandler(harness.ctx);
    onKey(key("space"));
    expect(harness.state.interaction.onboarding.pageIndex).toBe(1);
    onKey(key("escape"));
    expect(harness.state.interaction.onboarding.active).toBe(false);
    // finishOnboarding persists "seen" before it reports; wait for that write.
    for (let i = 0; i < 200 && !harness.status().includes("Tour skipped"); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(harness.status()).toContain("Tour skipped");
  });
});

describe("context and state", () => {
  test("reading the controller before it is bound is a programming error", async () => {
    harness = await createFlowHarness();
    const { context } = createHostContext({ ...harness.ctx });
    expect(() => context.controller).toThrow("before bindController");
    expect(context.sidebar.refreshSessions()).resolves.toBeUndefined();
  });

  test("createHostState starts idle on the composer with the learner profile", () => {
    const state = createHostState({ cwd: "/p", tuiProfile: { schemaVersion: 1, displayName: "Ada", avatar: { kind: "learner" } }, editorMode: "vim" });
    expect(state).toMatchObject({ busy: false, settled: false, entries: [], sidebar: null });
    expect(state.interaction).toMatchObject({ focusArea: "composer", vimState: "insert", editorMode: "vim", modal: null });
  });
});
