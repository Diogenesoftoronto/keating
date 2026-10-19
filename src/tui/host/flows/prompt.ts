/**
 * Sending a prompt: slash-command routing, explicit shell, `@file` resolution,
 * failed-send recovery and retry.
 */
import { type ComposerCommand, composerReferenceErrors, parseComposerInput, resolveComposerInput } from "../../composer.js";
import { type TuiPromptSendOutcome } from "../../prompt-recovery.js";
import { TUI_COMMANDS, type TuiCommand, sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { exitToShell, runCommandAndRefocus } from "./commands.js";
import { showCommandPalette, showTranscriptSearch, showUiActions } from "./pickers.js";

export type PromptDeps = Pick<HostContext, "client" | "controller" | "cwd" | "dialogs" | "listSessions" | "openExternalUrl" | "promptRecovery" | "renderer" | "sidebar" | "state" | "surface" | "view">;

export function presentPromptOutcome(deps: PromptDeps, outcome: TuiPromptSendOutcome, appendUser: boolean): void {
  const { state } = deps;
  const { appendEntry, idleStatus, status, composer: input } = deps.view;
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
    if (!state.busy) status.content = idleStatus();
    return;
  }
  input.value = outcome.message;
  appendEntry({
    id: `submit-error-${Date.now()}`,
    kind: "error",
    title: "Message not sent",
    body: `${sanitizeDiagnostic(outcome.error)}\n\nYour exact draft is restored below. Edit it or press Ctrl+R to retry.`,
  });
  status.content = "Message not sent. Exact draft restored · Ctrl+R retries it · /settings repairs provider access.";
}

export async function retryLastPrompt(deps: PromptDeps): Promise<void> {
  const { state, promptRecovery } = deps;
  const { status } = deps.view;
  const preserved = promptRecovery.draft;
  if (preserved !== null) {
    status.content = "Retrying the exact preserved prompt…";
  }
  presentPromptOutcome(deps, await promptRecovery.retry(state.busy), false);
}

export async function runExplicitShell(deps: PromptDeps, command: string, draft: string): Promise<void> {
  const { client } = deps;
  const { appendEntry, setFocusArea, status, composer: input } = deps.view;
  if (!command.trim()) {
    input.value = draft;
    status.content = "Shell mode needs a command. Edit the draft or press Esc.";
    setFocusArea("composer");
    return;
  }
  if (!client.bash) {
    input.value = draft;
    appendEntry({ id: `shell-unavailable-${Date.now()}`, kind: "error", title: "Shell unavailable", body: "This RPC host does not expose the shell runner. Your exact command remains in the composer." });
    setFocusArea("composer");
    return;
  }
  appendEntry({ id: `shell-command-${Date.now()}`, kind: "user", title: "Shell", body: `$ ${command}` });
  status.content = `Running shell command…  ·  ${command.slice(0, 80)}`;
  try {
    const result = await client.bash(command);
    const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
    const output = typeof record.output === "string" ? record.output : sanitizeDiagnostic(result);
    const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
    const cancelled = record.cancelled === true;
    const detail = cancelled ? "Cancelled" : exitCode === undefined ? "Completed" : `Exit code ${exitCode}`;
    appendEntry({
      id: `shell-result-${Date.now()}`,
      kind: cancelled || (exitCode !== undefined && exitCode !== 0) ? "error" : "tool",
      title: cancelled ? "Shell command cancelled" : exitCode !== undefined && exitCode !== 0 ? `Shell command failed (${exitCode})` : "Shell output",
      body: output || "(no output)",
      detail,
    });
    setFocusArea("composer");
  } catch (error) {
    input.value = draft;
    appendEntry({ id: `shell-error-${Date.now()}`, kind: "error", title: "Shell command failed", body: `${sanitizeDiagnostic(error)}\n\nThe exact command is back in the composer.` });
    status.content = "Shell command failed. Edit the preserved command and retry.";
    setFocusArea("composer");
  }
}

export async function submit(deps: PromptDeps, raw: string): Promise<void> {
  const { cwd, state, promptRecovery } = deps;
  const { appendEntry, status, composer: input } = deps.view;
  const message = raw.trim();
  if (!message) return;
  const localComposerCommands: ComposerCommand[] = [
    ...TUI_COMMANDS.map((command) => ({ name: command.id, description: command.description })),
    { name: "models", description: "Search and select an authenticated Pi model" },
  ];
  const parsed = parseComposerInput(raw, [...localComposerCommands, ...state.knownPiCommands]);
  input.value = "";
  if (parsed.mode === "shell") {
    await runExplicitShell(deps, parsed.shellCommand ?? "", raw);
    return;
  }
  if (parsed.mode === "command" && parsed.commandName === "shell") {
    await exitToShell(deps);
    return;
  }
  const slashCommands: Record<string, TuiCommand["id"] | "palette" | "search"> = {
    onboarding: "onboarding",
    setup: "setup",
    commands: "palette",
    sessions: "sessions",
    library: "library",
    review: "review",
    courses: "courses",
    settings: "settings",
    model: "model",
    models: "model",
    thinking: "thinking",
    new: "new-session",
    abort: "abort",
    retry: "retry",
    actions: "palette",
    find: "search",
    search: "search",
  };
  const commandId = parsed.mode === "command" && parsed.commandName ? slashCommands[parsed.commandName] : undefined;
  if (commandId === "search") {
    await showTranscriptSearch(deps);
    return;
  }
  if (parsed.mode === "command" && parsed.commandName === "actions") {
    await showUiActions(deps);
    return;
  }
  if (commandId) {
    if (commandId === "palette") await showCommandPalette(deps);
    else {
      const command = TUI_COMMANDS.find((candidate) => candidate.id === commandId);
      if (command) await runCommandAndRefocus(deps, command);
    }
    return;
  }
  const resolved = await resolveComposerInput(parsed, cwd);
  const referenceErrors = composerReferenceErrors(resolved);
  if (referenceErrors.length > 0) {
    input.value = raw;
    appendEntry({ id: `composer-reference-error-${Date.now()}`, kind: "error", title: "File reference not sent", body: `${referenceErrors.join("\n")}\n\nYour exact draft is preserved. Fix the @ path and press Enter again.` });
    status.content = "File reference failed. The draft remains in the composer.";
    return;
  }
  const attached = resolved.fileReferences.filter((reference) => reference.content !== undefined);
  appendEntry({
    id: `user-${Date.now()}`,
    kind: "user",
    title: "You",
    body: raw,
    ...(attached.length > 0 ? {
      detail: `Attached ${attached.length} file${attached.length === 1 ? "" : "s"}: ${attached.map((reference) => reference.path).join(", ")}`,
    } : {}),
  });
  presentPromptOutcome(deps, await promptRecovery.send(raw, state.busy, resolved.prompt), false);
}
