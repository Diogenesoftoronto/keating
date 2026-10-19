import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attachRecoveryEvents, restorePendingDraft, RUNTIME_DEBUG_EVENT_LIMIT } from "../src/tui/host/flows/recovery.js";
import { exitToShell, runCommand, runCommandAndRefocus } from "../src/tui/host/flows/commands.js";
import { showCommandPalette, showFileReferencePicker, showTranscriptSearch, showUiActions } from "../src/tui/host/flows/pickers.js";
import { presentPromptOutcome, retryLastPrompt, runExplicitShell, submit } from "../src/tui/host/flows/prompt.js";
import { showDebug, showSettings } from "../src/tui/host/flows/settings.js";
import { TUI_COMMANDS, type TranscriptEntry } from "../src/tui/view-model.js";
import { TUI_DEBUG_ACTIONS } from "../src/tui/debug.js";
import { TUI_SETTINGS_ACTIONS } from "../src/tui/settings.js";
import type { OpenTuiExitResult } from "../src/tui/shell-handoff.js";
import { choose, createFlowHarness, type FlowHarness } from "./tui-host-harness.js";

let harness: FlowHarness | undefined;
afterEach(async () => { await harness?.destroy(); harness = undefined; });

const entry = (id: string, title: string, body = ""): TranscriptEntry => ({ id, kind: "notice", title, body });

describe("showCommandPalette", () => {
  test("lists every local command first, then Pi commands, and runs the chosen local command", async () => {
    harness = await createFlowHarness();
    harness.state.knownPiCommands = [{ name: "skill:review", description: "Run a review" }, { name: "sessions" }];
    harness.script(choose("Change thinking"));
    await showCommandPalette(harness.ctx);
    const dialog = harness.dialogs[0]!;
    expect(dialog.title).toBe("Keating commands");
    const options = dialog.kind === "select" ? dialog.options : [];
    expect(options).toHaveLength(TUI_COMMANDS.length + 1); // "sessions" duplicates a local command and is dropped
    expect(options.at(-1)).toBe("/skill:review  —  Run a review");
    expect(harness.calls.controller).toContainEqual(["cycleThinking"]);
    expect(harness.state.interaction.focusArea).toBe("composer");
  });

  test("choosing a Pi command prefills the composer and focuses it", async () => {
    harness = await createFlowHarness();
    harness.state.knownPiCommands = [{ name: "/skill:review", description: "Run a review" }];
    harness.script(choose("/skill:review"));
    await showCommandPalette(harness.ctx);
    expect(harness.composer.value).toBe("/skill:review ");
  });
});

describe("showTranscriptSearch / showUiActions", () => {
  test("search offers numbered entries, jumps, and focuses the transcript", async () => {
    harness = await createFlowHarness();
    harness.ctx.view.appendEntry(entry("a", "Alpha", "first body"));
    harness.ctx.view.appendEntry(entry("b", "Beta", "second   body"));
    harness.script(choose("Beta"));
    await showTranscriptSearch(harness.ctx);
    const dialog = harness.dialogs[0]!;
    expect(dialog.kind === "select" && dialog.options).toEqual(["1. Alpha · first body", "2. Beta · second body"]);
    expect(harness.state.interaction.focusArea).toBe("transcript");
    expect(harness.status()).toContain("Showing transcript match 2/2");
  });

  test("an empty transcript explains instead of opening a dialog", async () => {
    harness = await createFlowHarness();
    await showTranscriptSearch(harness.ctx);
    expect(harness.dialogs).toEqual([]);
    expect(harness.entryTitles()).toEqual(["Transcript is empty"]);
  });

  test("document actions run the chosen control; no document and read-only are explained", async () => {
    harness = await createFlowHarness();
    await showUiActions(harness.ctx);
    expect(harness.entryTitles()).toEqual(["No active document"]);
    const ran: string[] = [];
    harness.state.activeUiDocument = { id: "doc", title: "Quiz" } as never;
    harness.state.activeUiControls = [];
    await showUiActions(harness.ctx);
    expect(harness.entryTitles().at(-1)).toBe("Document is read-only");
    harness.state.activeUiControls = [
      { id: "a", label: "Answer", description: "write", run: async () => { ran.push("a"); } },
      { id: "b", label: "Hint", run: async () => { ran.push("b"); } },
    ];
    harness.script(choose("Hint"));
    await showUiActions(harness.ctx);
    expect(harness.dialogs[0]!.title).toBe("Quiz actions");
    expect(harness.dialogs[0]!.kind === "select" && harness.dialogs[0].options).toEqual(["1. Answer — write", "2. Hint"]);
    expect(ran).toEqual(["b"]);
  });
});

describe("showFileReferencePicker", () => {
  test("replaces the active @reference with the chosen file and refocuses the composer", async () => {
    harness = await createFlowHarness();
    await mkdir(join(harness.cwd, "notes"), { recursive: true });
    await writeFile(join(harness.cwd, "notes", "essay.md"), "text");
    harness.composer.value = "read @notes/es please";
    // The active reference ends at the cursor, which is the end of the draft here.
    harness.composer.value = "read @notes/es";
    harness.script(choose("essay.md"));
    await showFileReferencePicker(harness.ctx);
    expect(harness.dialogs[0]!.title).toBe("Attach a project file to this prompt");
    expect(harness.composer.value).toBe("read @notes/essay.md");
    expect(harness.status()).toContain("will be attached");
  });

  test("no matches leaves the draft alone", async () => {
    harness = await createFlowHarness();
    harness.composer.value = "see @zzzz-no-such";
    await showFileReferencePicker(harness.ctx);
    expect(harness.dialogs).toEqual([]);
    expect(harness.composer.value).toBe("see @zzzz-no-such");
    expect(harness.status()).toContain("No project files match @zzzz-no-such");
  });
});

describe("runCommand", () => {
  test("new-session confirms when the transcript has content and refreshes the sidebar", async () => {
    harness = await createFlowHarness();
    harness.ctx.view.appendEntry(entry("a", "Alpha"));
    harness.script(choose("Yes"));
    await runCommand(harness.ctx, TUI_COMMANDS.find((c) => c.id === "new-session")!);
    expect(harness.dialogs[0]!.title).toBe("Start a new session?");
    expect(harness.calls.controller).toContainEqual(["newSession"]);
    expect(harness.calls.sidebar).toEqual(["refreshSessions"]);
  });

  test("new-session on an empty transcript skips the confirmation; declining does nothing", async () => {
    harness = await createFlowHarness();
    await runCommand(harness.ctx, TUI_COMMANDS.find((c) => c.id === "new-session")!);
    expect(harness.dialogs).toEqual([]);
    expect(harness.calls.controller).toContainEqual(["newSession"]);
    harness.ctx.view.appendEntry(entry("a", "Alpha"));
    harness.calls.controller.length = 0;
    harness.script(choose("No"));
    await runCommand(harness.ctx, TUI_COMMANDS.find((c) => c.id === "new-session")!);
    expect(harness.calls.controller).toEqual([]);
  });

  test("abort stops the response and restores the accepted draft", async () => {
    harness = await createFlowHarness();
    await harness.ctx.promptRecovery.send("my question", false);
    await runCommand(harness.ctx, TUI_COMMANDS.find((c) => c.id === "abort")!);
    expect(harness.calls.controller).toContainEqual(["abort"]);
    expect(harness.composer.value).toBe("my question");
    expect(harness.entryTitles()).toEqual(["Stopped draft restored"]);
  });

  test("runCommandAndRefocus returns focus to the composer", async () => {
    harness = await createFlowHarness();
    harness.state.interaction = { ...harness.state.interaction, focusArea: "transcript" };
    await runCommandAndRefocus(harness.ctx, TUI_COMMANDS.find((c) => c.id === "thinking")!);
    expect(harness.state.interaction.focusArea).toBe("composer");
  });

  test("exitToShell settles with the session path, destroys the renderer, and stops the client", async () => {
    harness = await createFlowHarness({ client: { stop: async () => {} } });
    let settled: OpenTuiExitResult | undefined;
    harness.state.settle = (result) => { settled = result; };
    await exitToShell(harness.ctx);
    expect(settled).toEqual({ action: "shell", sessionPath: "/sessions/current.jsonl" });
    expect(harness.state.settled).toBe(true);
    expect(harness.calls.client.map(([name]) => name)).toContain("stop");
  });

  test("a settled host no longer steals focus after a command", async () => {
    harness = await createFlowHarness();
    harness.state.settled = true;
    harness.state.interaction = { ...harness.state.interaction, focusArea: "transcript" };
    await runCommandAndRefocus(harness.ctx, TUI_COMMANDS.find((c) => c.id === "thinking")!);
    expect(harness.state.interaction.focusArea).toBe("transcript");
  });
});

describe("showSettings / showDebug", () => {
  test("settings offers the documented actions and toggles retry against the current value", async () => {
    harness = await createFlowHarness({ client: { getState: async () => ({ autoRetryEnabled: false }) } });
    harness.script(choose("Toggle automatic retry"));
    await showSettings(harness.ctx);
    const dialog = harness.dialogs[0]!;
    expect(dialog.kind === "select" && dialog.options).toEqual([...TUI_SETTINGS_ACTIONS]);
    expect(harness.entryTitles()).toEqual(["Settings", "Automatic retry changed"]);
    expect(harness.calls.client.map(([name]) => name)).toContain("setAutoRetry");
  });

  test("settings can prepare the /shell handoff in the composer", async () => {
    harness = await createFlowHarness();
    harness.script(choose("Prepare /shell"));
    await showSettings(harness.ctx);
    expect(harness.composer.value).toBe("/shell");
  });

  test("debug offers its four views and clears the captured event ring", async () => {
    harness = await createFlowHarness();
    harness.state.runtimeDebugEvents.push({ at: "t", type: "agent_start", summary: "x" } as never);
    harness.script(choose("Clear captured runtime events"));
    await showDebug(harness.ctx);
    const dialog = harness.dialogs[0]!;
    expect(dialog.kind === "select" && dialog.options).toEqual([...TUI_DEBUG_ACTIONS]);
    expect(harness.state.runtimeDebugEvents).toEqual([]);
    expect(harness.entryTitles()).toContain("Runtime event ring cleared");
  });
});

describe("prompt flows", () => {
  test("submit sends a plain prompt, shows it as the learner turn, and clears the composer", async () => {
    harness = await createFlowHarness();
    harness.composer.value = "What is entropy?";
    await submit(harness.ctx, "What is entropy?");
    expect(harness.calls.client).toContainEqual(["prompt", "What is entropy?"]);
    expect(harness.entries().map((e) => [e.kind, e.body])).toEqual([["user", "What is entropy?"]]);
    expect(harness.composer.value).toBe("");
  });

  test("submit while busy queues a follow-up instead", async () => {
    harness = await createFlowHarness();
    harness.state.busy = true;
    await submit(harness.ctx, "and then?");
    expect(harness.calls.client).toContainEqual(["followUp", "and then?"]);
  });

  test("a blank prompt does nothing", async () => {
    harness = await createFlowHarness();
    await submit(harness.ctx, "   ");
    expect(harness.calls.client).toEqual([]);
    expect(harness.entries()).toEqual([]);
  });

  test("slash commands route to local flows instead of Pi", async () => {
    harness = await createFlowHarness();
    await submit(harness.ctx, "/thinking");
    expect(harness.calls.controller).toContainEqual(["cycleThinking"]);
    expect(harness.calls.client.map(([name]) => name)).not.toContain("prompt");
    harness.script(undefined);
    await submit(harness.ctx, "/commands");
    expect(harness.dialogs[0]!.title).toBe("Keating commands");
  });

  test("/shell exits to the classic interface", async () => {
    harness = await createFlowHarness({ client: { stop: async () => {} } });
    let settled: OpenTuiExitResult | undefined;
    harness.state.settle = (result) => { settled = result; };
    await submit(harness.ctx, "/shell");
    expect(settled?.action).toBe("shell");
  });

  test("an unreadable @file keeps the exact draft and sends nothing", async () => {
    harness = await createFlowHarness();
    await submit(harness.ctx, "summarise @missing-file.md");
    expect(harness.composer.value).toBe("summarise @missing-file.md");
    expect(harness.entryTitles()).toEqual(["File reference not sent"]);
    expect(harness.calls.client.map(([name]) => name)).not.toContain("prompt");
  });

  test("a failed send restores the draft and explains how to retry", async () => {
    harness = await createFlowHarness({ client: { failPrompt: "provider down" } });
    await submit(harness.ctx, "hello");
    expect(harness.composer.value).toBe("hello");
    expect(harness.entryTitles()).toEqual(["You", "Message not sent"]);
    expect(harness.status()).toContain("Exact draft restored");
    await retryLastPrompt(harness.ctx);
    expect(harness.calls.client.filter(([name]) => name === "prompt")).toHaveLength(2);
  });

  test("retry with nothing preserved says so", async () => {
    harness = await createFlowHarness();
    await retryLastPrompt(harness.ctx);
    expect(harness.entryTitles()).toEqual(["No failed prompt"]);
  });

  test("presentPromptOutcome clears the composer on success and restores it on failure", async () => {
    harness = await createFlowHarness();
    harness.composer.value = "x";
    presentPromptOutcome(harness.ctx, { ok: true, message: "x" }, true);
    expect(harness.composer.value).toBe("");
    expect(harness.entries().at(-1)!.kind).toBe("user");
    presentPromptOutcome(harness.ctx, { ok: false, message: "y", error: new Error("no") }, false);
    expect(harness.composer.value).toBe("y");
  });

  test("explicit shell runs through Pi, reports exit codes, and returns to the composer", async () => {
    harness = await createFlowHarness({ client: { bash: async () => ({ output: "boom", exitCode: 2 }) } });
    await runExplicitShell(harness.ctx, "false", "!false");
    expect(harness.calls.client).toContainEqual(["bash", "false"]);
    expect(harness.entries().map((e) => [e.kind, e.title])).toEqual([["user", "Shell"], ["error", "Shell command failed (2)"]]);
    expect(harness.state.interaction.focusArea).toBe("composer");
  });

  test("explicit shell without a command or runner preserves the draft", async () => {
    harness = await createFlowHarness();
    await runExplicitShell(harness.ctx, "  ", "!  ");
    expect(harness.composer.value).toBe("!  ");
    // Refocusing the composer repaints the idle hints over the message, as the host always did.
    expect(harness.status()).toBe(harness.ctx.view.idleStatus());
    await runExplicitShell(harness.ctx, "ls", "!ls");
    expect(harness.entryTitles()).toEqual(["Shell unavailable"]);
  });
});

describe("recovery", () => {
  test("restorePendingDraft puts the accepted draft back and explains; it is a no-op with nothing pending", async () => {
    harness = await createFlowHarness();
    expect(restorePendingDraft(harness.ctx, "boom")).toBeNull();
    expect(harness.entries()).toEqual([]);
    await harness.ctx.promptRecovery.send("draft", false);
    expect(restorePendingDraft(harness.ctx, "provider timeout")).toBe("draft");
    expect(harness.composer.value).toBe("draft");
    expect(harness.entries()[0]!.body).toContain("provider timeout");
    expect(harness.status()).toContain("Ctrl+R retries");
  });

  function fakeEvents() {
    const listeners: Array<(event: unknown) => void> = [];
    return {
      emit: (event: unknown) => listeners.forEach((l) => l(event)),
      client: { onEvent: (l: (event: unknown) => void) => { listeners.push(l); return () => { listeners.length = 0; }; } },
      listeners,
    };
  }

  test("a successful agent_end commits the pending prompt and refreshes sessions", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    const detach = attachRecoveryEvents({ ...harness.ctx, client: events.client as never });
    await harness.ctx.promptRecovery.send("hi", false);
    events.emit({ type: "agent_start" });
    events.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
    events.emit({ type: "agent_end" });
    expect(harness.ctx.promptRecovery.pendingDraft).toBeNull();
    expect(harness.ctx.promptRecovery.draft).toBeNull();
    expect(harness.calls.sidebar).toEqual(["refreshSessions"]);
    detach();
    expect(events.listeners).toHaveLength(0);
  });

  test("agent_end refreshes the sidebar that was bound after the subscription", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    const refreshed: string[] = [];
    // The host subscribes before the real side panel exists, then binds it.
    let sidebar = { refreshSessions: async () => { refreshed.push("placeholder"); }, toggle: () => {} };
    attachRecoveryEvents({ ...harness.ctx, client: events.client as never, get sidebar() { return sidebar; } });
    sidebar = { refreshSessions: async () => { refreshed.push("panel"); }, toggle: () => {} };
    events.emit({ type: "agent_start" });
    events.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
    events.emit({ type: "agent_end" });
    expect(refreshed).toEqual(["panel"]);
  });

  test("an errored assistant message restores the draft at agent_end", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    attachRecoveryEvents({ ...harness.ctx, client: events.client as never });
    await harness.ctx.promptRecovery.send("hi", false);
    events.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "rate limited" } });
    events.emit({ type: "agent_end" });
    expect(harness.composer.value).toBe("hi");
    expect(harness.entries()[0]!.body).toContain("rate limited");
  });

  test("agent_start clears a stale error so the next success is not restored", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    attachRecoveryEvents({ ...harness.ctx, client: events.client as never });
    await harness.ctx.promptRecovery.send("hi", false);
    events.emit({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } });
    events.emit({ type: "agent_start" });
    events.emit({ type: "agent_end" });
    expect(harness.composer.value).toBe("");
    expect(harness.entries()).toEqual([]);
  });

  test("activity phases follow tool and message events", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    attachRecoveryEvents({ ...harness.ctx, client: events.client as never });
    events.emit({ type: "tool_execution_start", toolName: "search" });
    expect([harness.state.activityPhase, harness.state.activityDetail]).toEqual(["tool", "search"]);
    events.emit({ type: "tool_execution_end" });
    expect([harness.state.activityPhase, harness.state.activityDetail]).toEqual(["thinking", undefined]);
    events.emit({ type: "message_update", message: { role: "assistant" } });
    expect(harness.state.activityPhase).toBe("responding");
    events.emit(null);
    events.emit("not an event");
  });

  test("the debug ring keeps only the most recent events", async () => {
    harness = await createFlowHarness();
    const events = fakeEvents();
    attachRecoveryEvents({ ...harness.ctx, client: events.client as never });
    for (let i = 0; i < RUNTIME_DEBUG_EVENT_LIMIT + 25; i += 1) events.emit({ type: "tool_execution_start", toolName: `t${i}` });
    expect(harness.state.runtimeDebugEvents.length).toBeLessThanOrEqual(RUNTIME_DEBUG_EVENT_LIMIT);
  });
});
