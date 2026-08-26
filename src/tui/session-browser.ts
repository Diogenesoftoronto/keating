import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";

import { sessionsDir } from "../core/paths.js";
import type { TerminalGlyphMode } from "./design-contract.js";
import { sacredSanitizeText, sacredTextWidth, sacredTruncateText } from "./sacred.js";

export type TuiSessionInfo = Pick<
  SessionInfo,
  "path" | "id" | "name" | "parentSessionPath" | "created" | "modified" | "messageCount" | "firstMessage"
>;

export interface TuiSessionItem extends TuiSessionInfo {
  active: boolean;
  title: string;
}

export interface TuiSessionTreeRow {
  item: TuiSessionItem;
  depth: number;
  isLast: boolean;
  ancestorContinues: readonly boolean[];
  hasChildren: boolean;
}

interface TuiSessionTreeNode {
  item: TuiSessionItem;
  path: string;
  parentPath?: string;
  children: TuiSessionTreeNode[];
  latestActivity: number;
}

/** List the same project-scoped session directory used by Keating's Pi RPC. */
export function listProjectTuiSessions(cwd: string): Promise<TuiSessionInfo[]> {
  return SessionManager.list(cwd, sessionsDir(cwd));
}

function compactText(value: string, maxWidth: number, glyphMode: TerminalGlyphMode = "unicode"): string {
  return sacredTruncateText(sacredSanitizeText(value, glyphMode), maxWidth, glyphMode);
}

function sessionTitle(session: TuiSessionInfo): string {
  return compactText(session.name || session.firstMessage || session.id, 48) || "Untitled session";
}

export function tuiSessionItems(sessions: readonly TuiSessionInfo[], activePath?: string): TuiSessionItem[] {
  const canonicalActivePath = canonicalSessionPath(activePath);
  return [...sessions]
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .map((session) => ({
      ...session,
      active: canonicalSessionPath(session.path) === canonicalActivePath,
      title: sessionTitle(session),
    }));
}

function canonicalSessionPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function sessionTreeNodes(
  sessions: readonly TuiSessionInfo[],
  activePath?: string,
): TuiSessionTreeNode[] {
  const items = tuiSessionItems(sessions, activePath);
  const byPath = new Map<string, TuiSessionTreeNode>();
  for (const item of items) {
    const path = canonicalSessionPath(item.path) ?? item.path;
    byPath.set(path, {
      item,
      path,
      parentPath: canonicalSessionPath(item.parentSessionPath),
      children: [],
      latestActivity: item.modified.getTime(),
    });
  }

  const wouldCreateCycle = (node: TuiSessionTreeNode, parent: TuiSessionTreeNode): boolean => {
    const seen = new Set<string>([node.path]);
    let cursor: TuiSessionTreeNode | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.path)) return true;
      seen.add(cursor.path);
      cursor = cursor.parentPath ? byPath.get(cursor.parentPath) : undefined;
    }
    return false;
  };

  const roots: TuiSessionTreeNode[] = [];
  for (const node of byPath.values()) {
    const parent = node.parentPath ? byPath.get(node.parentPath) : undefined;
    if (parent && parent !== node && !wouldCreateCycle(node, parent)) parent.children.push(node);
    else roots.push(node);
  }

  const updateLatestActivity = (node: TuiSessionTreeNode): number => {
    for (const child of node.children) {
      node.latestActivity = Math.max(node.latestActivity, updateLatestActivity(child));
    }
    return node.latestActivity;
  };
  const sortBySubtreeActivity = (nodes: TuiSessionTreeNode[]): void => {
    nodes.sort((left, right) => right.latestActivity - left.latestActivity);
    for (const node of nodes) sortBySubtreeActivity(node.children);
  };
  for (const root of roots) updateLatestActivity(root);
  sortBySubtreeActivity(roots);
  return roots;
}

/**
 * Build the cross-session fork forest used by the Sacred-style TreeView.
 * Paths remain opaque values; only the returned display helpers expose titles.
 */
export function tuiSessionTreeRows(
  sessions: readonly TuiSessionInfo[],
  activePath?: string,
): TuiSessionTreeRow[] {
  const rows: TuiSessionTreeRow[] = [];
  const walk = (
    node: TuiSessionTreeNode,
    depth: number,
    ancestorContinues: readonly boolean[],
    isLast: boolean,
  ): void => {
    rows.push({ item: node.item, depth, isLast, ancestorContinues, hasChildren: node.children.length > 0 });
    for (const [index, child] of node.children.entries()) {
      const childIsLast = index === node.children.length - 1;
      walk(child, depth + 1, [...ancestorContinues, depth > 0 ? !isLast : false], childIsLast);
    }
  };
  const roots = sessionTreeNodes(sessions, activePath);
  for (const [index, root] of roots.entries()) walk(root, 0, [], index === roots.length - 1);
  return rows;
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

function treePrefix(row: TuiSessionTreeRow, glyphMode: TerminalGlyphMode): string {
  const ancestors = row.ancestorContinues
    .map((continues) => glyphMode === "ascii"
      ? continues ? "| . " : ". . "
      : continues ? "│ . " : ". . ")
    .join("");
  const branch = glyphMode === "ascii"
    ? row.isLast ? "`---" : "|---"
    : row.isLast ? "└───" : "├───";
  const node = row.hasChildren ? (glyphMode === "ascii" ? "+ " : "╦ ") : "  ";
  return `${ancestors}${branch}${node}`;
}

/** Sacred TreeView row with a bounded label and an unmodified item value. */
export function sessionTreeOption(
  row: TuiSessionTreeRow,
  now = new Date(),
  glyphMode: TerminalGlyphMode = "unicode",
  width = 96,
): string {
  const prefix = treePrefix(row, glyphMode);
  const badges = [row.item.active ? "ACTIVE" : "", row.item.parentSessionPath ? "FORK" : ""]
    .filter(Boolean)
    .map((badge) => `[${badge}]`)
    .join(" ");
  const count = `${row.item.messageCount} msg`;
  const metadataSeparator = glyphMode === "ascii" ? " | " : " · ";
  const right = [badges, count, relativeAge(row.item.modified, now)].filter(Boolean).join(metadataSeparator);
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 96;
  if (safeWidth === 0) return "";
  const titleSeparator = right ? "  " : "";
  const titleWidth = Math.max(
    0,
    safeWidth - sacredTextWidth(prefix) - sacredTextWidth(right) - sacredTextWidth(titleSeparator),
  );
  const title = compactText(row.item.title, titleWidth, glyphMode);
  const option = `${prefix}${title}  ${right}`;
  return sacredTextWidth(option) <= safeWidth ? option : sacredTruncateText(option, safeWidth, glyphMode);
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
  const prefix = `${index + 1}. `;
  const available = Math.max(0, 72 - sacredTextWidth(prefix));
  const text = compactText(message.text, available) || compactText(`Turn ${index + 1}`, available);
  return sacredTruncateText(`${prefix}${text}`, 72);
}
