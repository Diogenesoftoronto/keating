/**
 * Client-side room state: the latest projected snapshot plus the transient
 * things only the socket knows (presence, typing, Keating's live preview).
 * Pure so the merge rules can be tested without a browser.
 */
import {
  mergeRoomMessages,
  type RoomMessage,
  type RoomRealtimeMessage,
  type RoomViewerSnapshot,
} from "./contracts";
import { previewAudienceIncludes } from "./facilitation";
import { projectRoomMessage } from "./operations";

export const TYPING_VISIBLE_MS = 4_000;

export interface RoomClientState {
  roomId: string | null;
  snapshot: RoomViewerSnapshot | null;
  presentAccountIds: string[];
  /** accountId → last typing signal (ms). */
  typing: Record<string, number>;
  preview: { turnId: string; text: string } | null;
  removed: boolean;
}

export const INITIAL_ROOM_CLIENT_STATE: RoomClientState = {
  roomId: null,
  snapshot: null,
  presentAccountIds: [],
  typing: {},
  preview: null,
  removed: false,
};

export type RoomClientAction =
  | { type: "socket"; message: RoomRealtimeMessage; at: number }
  | { type: "snapshot"; snapshot: RoomViewerSnapshot }
  | { type: "earlier"; messages: RoomMessage[]; hasEarlierMessages: boolean; roomId?: string; revision?: number }
  | { type: "reset"; roomId?: string };

function withPreview(state: RoomClientState, snapshot: RoomViewerSnapshot): RoomClientState["preview"] {
  const { turn } = snapshot.room;
  if (!state.preview || !previewAudienceIncludes(snapshot)) return null;
  return turn.status === "thinking" && turn.turnId === state.preview.turnId ? state.preview : null;
}

function mergeSnapshot(
  current: RoomViewerSnapshot | null,
  next: RoomViewerSnapshot,
): RoomViewerSnapshot {
  if (!current || current.room.id !== next.room.id ||
      current.room.revision !== next.room.revision ||
      (current.permissions.canOversee && !next.permissions.canOversee)) return next;
  // Cached pages are safe only when the authoritative revision agrees. A
  // missed edit/moderation may concern a message outside the server's tail.
  const firstIncoming = next.room.messages[0]?.seq ?? Number.POSITIVE_INFINITY;
  const earlier = current.room.messages.filter((message) => message.seq < firstIncoming);
  return {
    ...next,
    room: { ...next.room, messages: mergeRoomMessages(earlier, next.room.messages) },
    hasEarlierMessages: earlier.length > 0 ? current.hasEarlierMessages : next.hasEarlierMessages,
  };
}

/** Re-project cached pages too: a role change must revoke local private data. */
function projectSnapshot(snapshot: RoomViewerSnapshot): RoomViewerSnapshot {
  const oversee = snapshot.permissions.canOversee;
  return {
    ...snapshot,
    room: {
      ...snapshot.room,
      messages: snapshot.room.messages.flatMap((message) => {
        const projected = projectRoomMessage(message, snapshot.viewer);
        return projected ? [projected] : [];
      }),
      drafts: oversee ? snapshot.room.drafts : [],
      turn: oversee ? snapshot.room.turn : {
        ...snapshot.room.turn,
        requestedBy: undefined,
        lastOutcome: snapshot.room.turn.lastOutcome ? {
          kind: snapshot.room.turn.lastOutcome.kind,
          at: snapshot.room.turn.lastOutcome.at,
        } : undefined,
      },
    },
  };
}

/** Typing indicators drop as soon as that person's message lands. */
function clearTypingFor(typing: Record<string, number>, messages: readonly RoomMessage[]): Record<string, number> {
  const authors = new Set(messages.map((message) => message.authorAccountId).filter(Boolean));
  if (authors.size === 0) return typing;
  return Object.fromEntries(Object.entries(typing).filter(([accountId]) => !authors.has(accountId)));
}

export function roomClientReducer(state: RoomClientState, action: RoomClientAction): RoomClientState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_ROOM_CLIENT_STATE, roomId: action.roomId ?? null };
    case "snapshot": {
      if (state.removed || (state.roomId && action.snapshot.room.id !== state.roomId)) return state;
      if (state.snapshot && action.snapshot.room.revision < state.snapshot.room.revision) return state;
      const snapshot = projectSnapshot(mergeSnapshot(state.snapshot, action.snapshot));
      return { ...state, roomId: snapshot.room.id, snapshot, preview: withPreview(state, snapshot) };
    }
    case "earlier": {
      if (state.removed || !state.snapshot ||
          (action.roomId && action.roomId !== state.roomId) ||
          (action.revision !== undefined && action.revision !== state.snapshot.room.revision)) return state;
      return {
        ...state,
        snapshot: projectSnapshot({
          ...state.snapshot,
          room: {
            ...state.snapshot.room,
            messages: mergeRoomMessages(action.messages, state.snapshot.room.messages),
          },
          hasEarlierMessages: action.hasEarlierMessages,
        }),
      };
    }
    case "socket": {
      const { message } = action;
      if (state.removed || ("roomId" in message && state.roomId && message.roomId !== state.roomId)) return state;
      switch (message.type) {
        case "snapshot":
          return roomClientReducer(state, { type: "snapshot", snapshot: message.snapshot });
        case "room.patch": {
          if (!state.snapshot || message.snapshot.room.id !== state.roomId || message.revision < state.snapshot.room.revision) return state;
          const lostOversight = state.snapshot.permissions.canOversee && !message.snapshot.permissions.canOversee;
          const missedChanges = message.revision > state.snapshot.room.revision + 1;
          const snapshot = projectSnapshot({
            ...state.snapshot,
            ...message.snapshot,
            room: {
              ...message.snapshot.room,
              messages: mergeRoomMessages(lostOversight || missedChanges ? [] : state.snapshot.room.messages, message.messages),
            },
          });
          return {
            ...state,
            snapshot,
            typing: clearTypingFor(state.typing, message.messages),
            preview: withPreview(state, snapshot),
          };
        }
        case "presence":
          if (!Array.isArray(message.accountIds) || !message.accountIds.every((id) => typeof id === "string")) return state;
          return { ...state, presentAccountIds: message.accountIds };
        case "typing":
          return { ...state, typing: { ...state.typing, [message.accountId]: action.at } };
        case "keating.preview": {
          // The turn.begin patch always reaches a socket before that turn's
          // previews, so a preview for any other turn is stale.
          const turn = state.snapshot?.room.turn;
          if (!state.snapshot || !previewAudienceIncludes(state.snapshot) || turn?.status !== "thinking" || turn.turnId !== message.turnId) return state;
          return { ...state, preview: { turnId: message.turnId, text: message.text } };
        }
        case "removed":
          return { ...INITIAL_ROOM_CLIENT_STATE, roomId: state.roomId ?? message.roomId, removed: true };
        case "error":
          return state;
        default:
          return state;
      }
    }
  }
}

export function typingAccountIds(state: RoomClientState, now: number, exclude?: string): string[] {
  return Object.entries(state.typing)
    .filter(([accountId, at]) => accountId !== exclude && now - at < TYPING_VISIBLE_MS)
    .map(([accountId]) => accountId);
}
