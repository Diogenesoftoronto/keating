import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

import { sessionsDir } from "../core/paths.js";

export type TuiSessionInfo = Pick<
  SessionInfo,
  "path" | "id" | "name" | "parentSessionPath" | "created" | "modified" | "messageCount" | "firstMessage"
>;

export interface TuiSessionItem extends TuiSessionInfo {
  active: boolean;
  title: string;
}

/** List the same project-scoped session directory used by Keating's Pi RPC. */
export function listProjectTuiSessions(cwd: string): Promise<TuiSessionInfo[]> {
  return SessionManager.list(cwd, sessionsDir(cwd));
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function sessionTitle(session: TuiSessionInfo): string {
  return compactText(session.name || session.firstMessage || session.id, 48) || "Untitled session";
}

export function tuiSessionItems(sessions: readonly TuiSessionInfo[], activePath?: string): TuiSessionItem[] {
  return [...sessions]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .map((session) => ({
      ...session,
      active: session.path === activePath,
      title: sessionTitle(session),
    }));
}

function relativeAge(modified: Date, now: Date): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - modified.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return modified.toISOString().slice(0, 10);
}

export function sessionOption(item: TuiSessionItem, index: number, now = new Date()): string {
  const active = item.active ? "ACTIVE" : "saved";
  const lineage = item.parentSessionPath ? " · fork" : "";
  const count = `${item.messageCount} message${item.messageCount === 1 ? "" : "s"}`;
  return `${index + 1}. ${item.title} · ${active}${lineage} · ${count} · ${relativeAge(item.modified, now)}`;
}

export const SESSION_ACTIONS = [
  "Resume session",
  "Resume and rename",
  "Fork whole current branch",
  "Fork from an earlier turn",
  "Cancel",
] as const;

export function forkMessageOption(message: { entryId: string; text: string }, index: number): string {
  return `${index + 1}. ${compactText(message.text, 72) || `Turn ${index + 1}`}`;
}
