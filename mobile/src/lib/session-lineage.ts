import { createId, type ChatMessage, type ChatSession } from "./types";

export interface SessionTreeRow {
  session: ChatSession;
  depth: number;
}

interface ForkOptions {
  throughMessageId?: string;
  now?: number;
  createMessageId?: () => string;
  createSessionId?: () => string;
}

export function createForkedSession(source: ChatSession, options: ForkOptions = {}): ChatSession {
  const now = options.now ?? Date.now();
  let messages = source.messages;
  if (options.throughMessageId) {
    const forkIndex = source.messages.findIndex((message) => message.id === options.throughMessageId);
    if (forkIndex < 0) throw new Error("The selected fork point is no longer in this lesson.");
    messages = source.messages.slice(0, forkIndex + 1);
  }

  const createMessageId = options.createMessageId ?? (() => createId("message"));
  const titleBase = source.title === "New lesson"
    ? "Untitled lesson"
    : source.title.replace(/^Branch · /, "");

  return {
    id: options.createSessionId?.() ?? createId("session"),
    title: `Branch · ${titleBase}`,
    createdAt: now,
    updatedAt: now,
    messages: messages.map((message): ChatMessage => {
      const clone = { ...message, id: createMessageId() };
      delete clone.feedback;
      delete clone.feedbackAt;
      return clone;
    }),
    parentSessionId: source.id,
    forkedFromMessageId: options.throughMessageId,
    forkedAt: now,
  };
}

/** Parent-first session ordering with stable, bounded indentation metadata. */
export function buildSessionTreeRows(sessions: readonly ChatSession[]): SessionTreeRow[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, ChatSession[]>();
  const roots: ChatSession[] = [];
  const byUpdated = (left: ChatSession, right: ChatSession) => right.updatedAt - left.updatedAt;

  for (const session of sessions) {
    if (session.parentSessionId && byId.has(session.parentSessionId) && session.parentSessionId !== session.id) {
      const siblings = children.get(session.parentSessionId) ?? [];
      siblings.push(session);
      children.set(session.parentSessionId, siblings);
    } else {
      roots.push(session);
    }
  }
  roots.sort(byUpdated);
  for (const siblings of children.values()) siblings.sort(byUpdated);

  const rows: SessionTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (session: ChatSession, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    rows.push({ session, depth });
    for (const child of children.get(session.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Malformed cycles stay visible instead of disappearing from the browser.
  for (const session of [...sessions].sort(byUpdated)) visit(session, 0);
  return rows;
}

export function parentSessionTitle(session: ChatSession, sessions: readonly ChatSession[]): string | null {
  if (!session.parentSessionId) return null;
  return sessions.find((candidate) => candidate.id === session.parentSessionId)?.title ?? "Deleted original";
}
