/**
 * Pure helpers for the sandbox panels: path navigation, file/diff display
 * decisions, commit defaults, and event-log formatting. No React or I/O.
 */
import type { KeatingAgentRuntimeConfig } from "../../keating/agent-runtime";
import { diffStrings, type LineDiff } from "../../keating/sandbox-engine";

export const WORKSPACE_ROOT = "/workspace";

export interface SandboxLogEvent {
  id: string;
  timestamp: number;
  tab: string;
  operation: string;
  ok: boolean;
  durationMs?: number | null;
  output: unknown;
}

export type PushSandboxEvent = (
  tab: string,
  operation: string,
  ok: boolean,
  output: unknown,
  durationMs?: number | null,
) => void;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function uid() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Parent directory of a VFS path; never goes above the workspace root. */
export function parentDirectory(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? WORKSPACE_ROOT : `/${parts.join("/")}`;
}

/** Placeholder editor content shown when a file cannot be read. */
export function fileReadFailureContent(error: unknown): string {
  return "// Error reading file:\n// " + errorMessage(error);
}

/** Line diff against the stored baseline; empty when there is no baseline. */
export function diffAgainstBaseline(
  result: { baseline?: string; current: string } | null | undefined,
): LineDiff[] {
  if (result && result.baseline !== undefined) return diffStrings(result.baseline, result.current);
  return [];
}

/** Whether the diff toggle should compute a diff (only when opening it). */
export function shouldComputeDiffOnToggle(currentlyShowing: boolean): boolean {
  return !currentlyShowing;
}

/** Commit message to use: the trimmed input, else a timestamped checkpoint. */
export function commitMessageOrDefault(input: string, now: number): string {
  return input.trim() || `checkpoint-${now}`;
}

/** Download file name for a portable sandbox bundle exported at `date`. */
export function portableExportFilename(date: Date): string {
  return `keating-sandbox-${date.toISOString().slice(0, 10)}.json`;
}

/** Changes worth showing in a commit diff (drops unchanged files). */
export function visibleChanges<T extends { status: string }>(changes: T[]): T[] {
  return changes.filter((c) => c.status !== "unchanged");
}

/** Human label for the runtime mode shown in the dialog header and overview. */
export function runtimeLabel(mode: KeatingAgentRuntimeConfig["mode"]): string {
  switch (mode) {
    case "browser-nodepod": return "NodePod · local";
    case "browser-only": return "This browser";
    case "host": return "Host machine";
    case "remote": return "Remote server";
    case "cloud": return "Cloud container";
    default: return "Unknown";
  }
}

/** Status pill text for the control bar. */
export function runtimeStatusLabel(state: { booting: boolean; nodePodActive: boolean; hasExecutionEndpoint: boolean }): string {
  if (state.booting) return "Starting…";
  if (state.nodePodActive) return "Running";
  return state.hasExecutionEndpoint ? "Configured" : "Stopped";
}

/** Whether a tab lives behind the "More" menu rather than the main nav. */
export function isAdvancedTab(tab: string): boolean {
  return ["snapshots", "vc", "probes"].includes(tab);
}

/** Message for the overview's failure banner when the newest event failed. */
export function failureBannerMessage(event: SandboxLogEvent): string {
  const output = event.output;
  return typeof output === "object" && output && "error" in output
    ? String((output as { error: unknown }).error)
    : "An operation failed. Open Activity for details.";
}

/** Friendly operation name used in the overview's recent-activity rows. */
export function recentEventLabel(operation: string): string {
  if (operation === "bootNodePod") return "NodePod started";
  if (operation === "teardownNodePod") return "NodePod stopped";
  return operation;
}

/** Whether a probe response counts as success (NodePod local output may carry `ok: false`). */
export function probeOutputOk(output: unknown): boolean {
  return !(output && typeof output === "object" && "ok" in output && (output as { ok: unknown }).ok === false);
}

/** Parses the probe payload textarea; blank means an empty object. */
export function parseProbePayload(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Probe payload is not valid JSON: ${errorMessage(error)}`);
  }
}
