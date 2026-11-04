/** Turn freshly projected public room context into an on-device private chat. */
import {
  getPrivateForkSessionWriter,
  PRIVATE_FORK_CONTEXT_MAX_CHARS,
  privateForkExcerpt,
  privateForkId,
  quotePrivateForkText,
  resolvePrivateForkPassage,
  type PrivateForkSessionOptions,
  type PrivateForkSessionWriter,
} from "../keating/private-fork-provenance";
import { roomMessageSchema, type RoomMessage, type RoomPrivateForkContext } from "./contracts";

function messageUrl(roomId: string, messageId: string): string {
  return `/rooms/${roomId}#room-message-${privateForkId(messageId)}`;
}

function attributedQuote(roomId: string, message: RoomMessage, text: string, shortened: boolean): string {
  return [
    `${JSON.stringify(message.authorName)} (${message.kind === "keating" ? "Keating" : message.authorRole}), ${message.createdAt}${shortened ? " (excerpt)" : ""}`,
    `Source: ${messageUrl(roomId, message.id)}`,
    quotePrivateForkText(text),
  ].join("\n");
}

export function createRoomPrivateForkSessionAdapter(writer: PrivateForkSessionWriter) {
  return async (context: RoomPrivateForkContext, options: PrivateForkSessionOptions = {}): Promise<string> => {
    const roomId = privateForkId(context.roomId), sourceId = privateForkId(context.sourceMessageId);
    if (!Number.isSafeInteger(context.revision) || context.revision < 0 || !Number.isSafeInteger(context.sourceSeq)
      || context.sourceSeq < 1 || !Array.isArray(context.messages)) {
      throw new Error("The selected room point is invalid. Reload the room and choose it again.");
    }
    const matches = context.messages.filter(message => message.id === sourceId);
    if (matches.length !== 1) throw new Error("The selected room message is missing or ambiguous. Reload the room and choose it again.");
    const source = roomMessageSchema.parse(matches[0]);
    if (source.seq !== context.sourceSeq || source.audience !== "room" || source.hidden
      || (source.kind !== "chat" && source.kind !== "keating")) {
      throw new Error("The selected room message is no longer available as public context. Reload the room and choose it again.");
    }
    const passage = resolvePrivateForkPassage(source.body, {
      selectedText: context.selectedText, start: context.start, end: context.end, sourceHash: context.sourceHash,
    });
    const url = messageUrl(roomId, source.id);
    const candidates = context.messages
      .filter(message => message.seq <= source.seq && message.audience === "room" && !message.hidden
        && (message.kind === "chat" || message.kind === "keating"))
      .map(message => roomMessageSchema.parse(message))
      .sort((left, right) => left.seq - right.seq);
    if (new Set(candidates.map(message => message.id)).size !== candidates.length
      || new Set(candidates.map(message => message.seq)).size !== candidates.length) {
      throw new Error("The room transcript has ambiguous message identities. Reload it before creating a private continuation.");
    }
    const label = (text: string | undefined, max = 240) => JSON.stringify(privateForkExcerpt(text ?? "", max));
    const header = [
      `Private continuation from room ${label(context.roomTitle)}.`,
      `Source: ${url}`,
      `Captured room revision: ${context.revision}. Public conversation through message ${source.seq} only.`,
      `Topic: ${label(context.topic, 400)}`,
      `Goal: ${label(context.goal, 400)}`,
      ...(context.context?.courseTitle ? [`Course: ${label(context.context.courseTitle)}`] : []),
      ...(context.context?.lessonTitle ? [`Lesson: ${label(context.context.lessonTitle)}`] : []),
      ...(context.context?.lessonSummary ? [`Lesson summary: ${label(context.context.lessonSummary, 400)}`] : []),
      ...(context.context?.objectives?.length ? [`Objectives: ${context.context.objectives.slice(0, 4).map(objective => label(objective, 160)).join("; ")}`] : []),
    ].join("\n");
    const anchor = [
      "Chosen point:", attributedQuote(roomId, source, passage.quote, passage.quote !== source.body),
      `Exact source range (UTF-16): ${passage.start}–${passage.end}; source hash: ${passage.sourceHash}.`,
    ].join("\n");
    // Reserve space for the shared imported-context notice and the optional
    // 2,000-character focus. The anchor is kept even when earlier context is cut.
    let remaining = PRIVATE_FORK_CONTEXT_MAX_CHARS - 3_200 - header.length - anchor.length;
    if (remaining < 0) throw new Error("The selected room context is too large. Choose a shorter passage.");
    const previous: string[] = [];
    for (const message of candidates.filter(message => message.seq < source.seq).slice(-23).reverse()) {
      const text = privateForkExcerpt(message.body, 2_000);
      if (!text.trim()) continue;
      const quoted = attributedQuote(roomId, message, text, text !== message.body);
      if (quoted.length + 2 > remaining) break;
      previous.unshift(quoted);
      remaining -= quoted.length + 2;
    }
    const omitted = Math.max(0, candidates.length - 1 - previous.length);
    const content = [header,
      ...(omitted ? [`${omitted} earlier loaded message(s) omitted from this bounded context.`] : []),
      ...(previous.length ? ["Earlier public context:", ...previous] : []), anchor,
    ].join("\n\n");
    return writer({
      title: `Private: ${privateForkExcerpt(context.roomTitle, 100)}`,
      content,
      source: { kind: "room", roomId, sourceMessageId: source.id, sourceSeq: source.seq, revision: context.revision, url, passage },
    }, options);
  };
}

export async function createRoomPrivateForkSession(
  context: RoomPrivateForkContext,
  options?: { question?: string; key?: string },
): Promise<string> {
  return createRoomPrivateForkSessionAdapter(await getPrivateForkSessionWriter())(context, options);
}
