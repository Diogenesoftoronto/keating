/**
 * Live status-line hints while the learner types: slash-command suggestions,
 * shell mode, and `@file` reference recognition. Pure presentation; it never
 * changes the composer text.
 */
import {
  activeComposerFileReference,
  commandSuggestions,
  parseComposerInput,
  type ComposerCommand,
} from "../../composer.js";
import { TUI_COMMANDS } from "../../view-model.js";
import type { HostContext } from "../context.js";

export type ComposerHintDeps = Pick<HostContext, "dialogs" | "state" | "view">;

/** Commands the composer recognises: local ones, `/models`, then whatever Pi advertises. */
export function composerCommands(piCommands: readonly ComposerCommand[]): ComposerCommand[] {
  return [
    ...TUI_COMMANDS.map((command) => ({ name: command.id, description: command.description })),
    { name: "models", description: "Search and select an authenticated Pi model" },
    ...piCommands,
  ];
}

/** The hint for the current composer text, or null when the idle hints apply. */
export function composerHint(text: string, piCommands: readonly ComposerCommand[]): string | null {
  const commands = composerCommands(piCommands);
  const parsed = parseComposerInput(text, commands);
  const activeReference = activeComposerFileReference(text);
  if (parsed.mode === "command" && !parsed.commandArgument) {
    const suggestions = commandSuggestions(parsed.commandName ?? "", commands);
    return suggestions.length > 0
      ? `${suggestions.slice(0, 5).map((suggestion) => `/${suggestion.name}`).join("  ·  ")}  ·  Enter sends`
      : "Unknown / command will be passed to Pi · Ctrl+P opens local commands";
  }
  if (parsed.mode === "shell") return "Shell mode · Enter runs exactly what follows ! · Ctrl+X stops an active response";
  if (activeReference || parsed.fileReferences.length > 0) {
    const reference = activeReference ? `@${activeReference.query}` : parsed.fileReferences.at(-1)?.token;
    return `${reference || "File reference"} recognized · Enter attaches contents · Tab browses project files`;
  }
  return null;
}

/** Composer INPUT handler: updates the status line unless a dialog or response owns it. */
export function updateComposerHint(deps: ComposerHintDeps): void {
  const { dialogs, state, view } = deps;
  if (dialogs.isOpen() || state.busy) return;
  view.status.content = composerHint(view.composer.value, state.knownPiCommands) ?? view.idleStatus();
}
