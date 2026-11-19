import type { SessionTreeNode } from "./session-tree";

/**
 * Per-device placement of sessions in the library: Pinned, Recent, or the
 * collapsed Earlier group. Pure: storage and "now" are always parameters.
 * Never synced; it does not touch `SessionMetadata`.
 */
export const SESSION_PLACEMENT_STORAGE_KEY = "keating:session-placement:v1";
/** A family with no activity for this long moves to Earlier on its own. */
export const EARLIER_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const EARLIER_INITIAL_COUNT = 10;
export const EARLIER_PAGE_COUNT = 25;

export interface SessionPlacementState {
  version: 1;
  /** Root session id → when it was pinned (ISO). */
  pinned: Record<string, string>;
  /** Root session id → when the learner moved it to Earlier (ISO). */
  earlier: Record<string, string>;
  /** Root session id → when the learner moved it back to Recent (ISO). Blocks the 14-day rule. */
  kept: Record<string, string>;
  /** Whether the Earlier group is expanded. Defaults to closed. */
  earlierOpen: boolean;
}

export type SessionPlacementAction =
  | { type: "pin"; id: string }
  | { type: "unpin"; id: string }
  | { type: "moveToEarlier"; id: string }
  | { type: "moveToRecent"; id: string }
  | { type: "forget"; id: string }
  | { type: "setEarlierOpen"; open: boolean };

export type SessionSection = "pinned" | "recent" | "earlier";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function emptySessionPlacement(): SessionPlacementState {
  return { version: 1, pinned: {}, earlier: {}, kept: {}, earlierOpen: false };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && !Number.isNaN(Date.parse(entry))) record[key] = entry;
  }
  return record;
}

export function readSessionPlacement(storage: StorageLike | undefined): SessionPlacementState {
  if (!storage) return emptySessionPlacement();
  try {
    const raw = storage.getItem(SESSION_PLACEMENT_STORAGE_KEY);
    if (!raw) return emptySessionPlacement();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
      return emptySessionPlacement();
    }
    const value = parsed as Record<string, unknown>;
    return {
      version: 1,
      pinned: stringRecord(value.pinned),
      earlier: stringRecord(value.earlier),
      kept: stringRecord(value.kept),
      earlierOpen: value.earlierOpen === true,
    };
  } catch {
    return emptySessionPlacement();
  }
}

export function writeSessionPlacement(storage: StorageLike | undefined, state: SessionPlacementState): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_PLACEMENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Placement is a convenience; storage failures leave the list usable.
  }
}

function without(record: Record<string, string>, id: string): Record<string, string> {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
}

export function reduceSessionPlacement(
  state: SessionPlacementState,
  action: SessionPlacementAction,
  now: number,
): SessionPlacementState {
  const at = new Date(now).toISOString();
  switch (action.type) {
    case "pin":
      return { ...state, pinned: { ...state.pinned, [action.id]: at }, earlier: without(state.earlier, action.id) };
    case "unpin":
      return { ...state, pinned: without(state.pinned, action.id) };
    case "moveToEarlier":
      return {
        ...state,
        pinned: without(state.pinned, action.id),
        earlier: { ...state.earlier, [action.id]: at },
        kept: without(state.kept, action.id),
      };
    case "moveToRecent":
      return { ...state, earlier: without(state.earlier, action.id), kept: { ...state.kept, [action.id]: at } };
    case "forget":
      return {
        ...state,
        pinned: without(state.pinned, action.id),
        earlier: without(state.earlier, action.id),
        kept: without(state.kept, action.id),
      };
    case "setEarlierOpen":
      return state.earlierOpen === action.open ? state : { ...state, earlierOpen: action.open };
  }
}

/** Latest `lastModified` anywhere in a fork family, as epoch ms. */
export function familyActivity(root: SessionTreeNode): number {
  let latest = Date.parse(root.session.lastModified) || 0;
  for (const child of root.children) latest = Math.max(latest, familyActivity(child));
  return latest;
}

function familyContains(root: SessionTreeNode, id: string | undefined): boolean {
  if (!id) return false;
  if (root.session.id === id) return true;
  return root.children.some((child) => familyContains(child, id));
}

/** Where a fork family belongs. Placement always follows the family's root. */
export function sessionSection(
  root: SessionTreeNode,
  state: SessionPlacementState,
  now: number,
  activeSessionId?: string,
): SessionSection {
  const id = root.session.id;
  if (state.pinned[id]) return "pinned";
  const activity = familyActivity(root);
  const movedAt = state.earlier[id];
  // A family the learner moved returns to Recent once anyone in it is used again.
  if (movedAt) return activity > Date.parse(movedAt) ? "recent" : "earlier";
  if (state.kept[id] || familyContains(root, activeSessionId)) return "recent";
  return now - activity >= EARLIER_AFTER_MS ? "earlier" : "recent";
}

export interface SessionSections {
  pinned: SessionTreeNode[];
  recent: SessionTreeNode[];
  earlier: SessionTreeNode[];
}

/** Split recency-sorted fork-tree roots into sections without splitting a family. */
export function buildSessionSections(
  roots: SessionTreeNode[],
  state: SessionPlacementState,
  now: number,
  activeSessionId?: string,
): SessionSections {
  const sections: SessionSections = { pinned: [], recent: [], earlier: [] };
  for (const root of roots) sections[sessionSection(root, state, now, activeSessionId)].push(root);
  return sections;
}

export interface EarlierPage {
  /** Families to render under the Earlier header. */
  roots: SessionTreeNode[];
  /** How many more a "Show more" click would add (0 hides the button). */
  nextCount: number;
  /** Families not rendered yet. */
  remaining: number;
}

/**
 * What the Earlier group shows. Closed, it still shows the family holding
 * the open session so the current session never disappears.
 */
export function pageEarlierSessions(
  earlier: SessionTreeNode[],
  { open, limit, activeSessionId }: { open: boolean; limit: number; activeSessionId?: string },
): EarlierPage {
  const activeRoot = earlier.find((root) => familyContains(root, activeSessionId));
  if (!open) return { roots: activeRoot ? [activeRoot] : [], nextCount: 0, remaining: earlier.length };
  const shown = earlier.slice(0, Math.max(0, limit));
  if (activeRoot && !shown.includes(activeRoot)) shown.push(activeRoot);
  const remaining = earlier.length - shown.length;
  return { roots: shown, nextCount: Math.min(EARLIER_PAGE_COUNT, remaining), remaining };
}
