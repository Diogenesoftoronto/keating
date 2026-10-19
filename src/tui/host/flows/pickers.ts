/**
 * Selector dialogs that navigate or insert: transcript search, the command
 * palette, document actions and the `@file` reference picker.
 */
import { activeComposerFileReference, projectFileSuggestions } from "../../composer.js";
import { TUI_COMMANDS, commandOption } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { runCommandAndRefocus } from "./commands.js";
import { busySurfaceNotice } from "./common.js";

export type PickerDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "listSessions" | "openExternalUrl" | "promptRecovery" | "renderer" | "sidebar" | "state" | "surface" | "view">;

export async function showTranscriptSearch(deps: PickerDeps): Promise<void> {
  const { state, dialogs } = deps;
  const { appendEntry, setFocusArea, status } = deps.view;
  const { presentSelect } = dialogs;
  if (state.entries.length === 0) {
    appendEntry({ id: `search-empty-${Date.now()}`, kind: "notice", title: "Transcript is empty", body: "Send a prompt first, then press Ctrl+F to search titles and Markdown bodies." });
    return;
  }
  const options = state.entries.map((entry, index) => `${index + 1}. ${entry.title} · ${entry.body.replace(/\s+/g, " ").slice(0, 100)}`);
  const selected = await presentSelect("Transcript search · Enter jumps to a matching turn", options);
  if (selected === undefined) return;
  const index = options.indexOf(selected);
  if (index < 0) return;
  deps.view.revealEntry(index);
  setFocusArea("transcript");
  status.content = `Showing transcript match ${index + 1}/${state.entries.length} · Ctrl+F searches again`;
}

export async function showCommandPalette(deps: PickerDeps): Promise<void> {
  const { state, dialogs } = deps;
  const { setFocusArea, composer: input } = deps.view;
  const { presentSelect } = dialogs;
  const localOptions = TUI_COMMANDS.map(commandOption);
  const piCommands = state.knownPiCommands
    .filter((command) => !TUI_COMMANDS.some((local) => local.id === command.name.replace(/^\//, "")))
  const piOptions = piCommands.map((command) => `/${command.name.replace(/^\//, "")}  —  ${command.description ?? "Pi command"}`);
  const options = [...localOptions, ...piOptions];
  const selected = await presentSelect("Keating commands", options);
  const index = selected === undefined ? -1 : options.indexOf(selected);
  if (index < 0) return;
  if (index < TUI_COMMANDS.length) {
    await runCommandAndRefocus(deps, TUI_COMMANDS[index]!);
    return;
  }
  const command = piCommands[index - TUI_COMMANDS.length];
  if (command) {
    input.value = `/${command.name.replace(/^\//, "")} `;
    setFocusArea("composer");
  }
}

export async function showUiActions(deps: PickerDeps): Promise<void> {
  const { state, dialogs } = deps;
  const { appendEntry } = deps.view;
  const { presentSelect } = dialogs;
  if (!state.activeUiDocument) {
    appendEntry({ id: `ui-none-${Date.now()}`, kind: "notice", title: "No active document", body: "Interactive document controls appear here when Keating sends a canonical UI document." });
    return;
  }
  if (state.activeUiControls.length === 0) {
    appendEntry({ id: `ui-readonly-${Date.now()}`, kind: "notice", title: "Document is read-only", body: "This document has no applicable terminal actions in its current lifecycle." });
    return;
  }
  const options = state.activeUiControls.map((control, index) => `${index + 1}. ${control.label}${control.description ? ` — ${control.description}` : ""}`);
  const selected = await presentSelect(`${state.activeUiDocument.title || "Document"} actions`, options);
  if (selected === undefined) return;
  const index = options.indexOf(selected);
  const control = state.activeUiControls[index];
  if (control) await control.run();
}

export async function showFileReferencePicker(deps: PickerDeps): Promise<void> {
  const { cwd, dialogs } = deps;
  const { status, composer: input } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "File reference picker")) return;
  const draft = input.value;
  const activeReference = activeComposerFileReference(draft);
  if (!activeReference) return;
  status.content = "Finding project files…";
  const suggestions = await projectFileSuggestions(cwd, activeReference.query);
  if (suggestions.length === 0) {
    status.content = `No project files match @${activeReference.query}. The draft is unchanged.`;
    input.focus();
    return;
  }
  const selected = await presentSelect("Attach a project file to this prompt", suggestions);
  if (!selected) return;
  const escaped = selected.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const token = /\s/.test(selected) ? `@"${escaped}"` : `@${escaped}`;
  input.value = `${draft.slice(0, activeReference.start)}${token}${draft.slice(activeReference.end)}`;
  status.content = `${token} will be attached when you send · continue typing or press Enter`;
  input.focus();
}
