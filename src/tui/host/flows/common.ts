/**
 * Helpers shared by the OpenTUI host flows: the "busy" refusal notice, the
 * idle-status restore every flow ends with, the Pi command refresh, and the
 * Markdown fence used for source-only previews.
 */
import type { ComposerCommand } from "../../composer.js";
import type { HostContext } from "../context.js";

export type CommonDeps = Pick<HostContext, "state" | "view" | "dialogs">;

/**
 * Tell the learner a surface cannot open while a response streams.
 * Returns true when the caller must stop.
 */
export function busySurfaceNotice(deps: Pick<HostContext, "state" | "view">, surfaceName: string): boolean {
  if (!deps.state.busy) return false;
  deps.view.appendEntry({
    id: `${surfaceName.toLowerCase()}-busy-${Date.now()}`,
    kind: "notice",
    title: `${surfaceName} unavailable while responding`,
    body: `Stop the active response with Ctrl+X, then open ${surfaceName} again. Your conversation remains saved.`,
  });
  return true;
}

/** Put the idle hints back unless a response or another dialog owns the status line. */
export function restoreIdleStatus(deps: CommonDeps): void {
  if (!deps.state.busy && !deps.dialogs.isOpen()) deps.view.status.content = deps.view.idleStatus();
}

/** Re-read Pi's slash commands for composer hints; failures leave the list empty. */
export async function refreshKnownPiCommands(deps: Pick<HostContext, "state" | "client">): Promise<void> {
  try {
    deps.state.knownPiCommands = (await deps.client.getCommands?.() ?? []).map((command): ComposerCommand => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      ...(command.source ? { source: command.source } : {}),
    }));
  } catch {
    deps.state.knownPiCommands = [];
  }
}

/** A fenced block that cannot be closed early by backticks inside `source`. */
export function sourceBlock(label: string, source: string): string {
  const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `Source-only preview (${label}); terminal did not execute it.\n\n${fence}\n${source}\n${fence}`;
}
